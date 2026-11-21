import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function load(path, mocks) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, require: name => mocks[name] ?? {}, console, FormData });
  return exports;
}

test('project permissions distinguish purchasing, planning and field logging without granting project access', async () => {
  for (const role of ['super_admin', 'admin', 'project_manager', 'foreman', null]) {
    for (const level of ['edit', 'view', 'none']) {
      const profile = role ? { id: 'user', role } : null;
      const auth = load('./project-access.ts', {
        '@/lib/auth/session': { getSessionProfile: async () => profile },
        '@/lib/auth/roles': { isAdminRole: role => ['super_admin', 'admin'].includes(role) },
        '@/lib/supabase/server': { createClient: async () => ({ rpc: async () => ({ data: level }) }) },
      });
      assert.equal(Boolean(await auth.requireProjectPurchaseAccess(1)), level === 'edit' && ['super_admin', 'admin'].includes(role));
      assert.equal(Boolean(await auth.requireProjectPlanningAccess(1)), level === 'edit' && ['super_admin', 'admin', 'project_manager'].includes(role));
      assert.equal(Boolean(await auth.requireProjectAccess(1)), level === 'edit' && !!role, 'Foremen retain daily accomplishment access');
      assert.equal(Boolean(await auth.requireProjectAccess(1, 'view')), level !== 'none' && !!role);
      assert.equal(await auth.requireProjectPlanningAccess(-1), null);
    }
  }
});

test('purchase and baseline mutations reject forbidden callers before accessing records or uploading attachments', async () => {
  const mocks = {
    '@/lib/auth/project-access': {
      requireProjectPurchaseAccess: async () => null,
      requireProjectPlanningAccess: async () => null,
      requireProjectAccess: async () => ({ role: 'foreman' }),
      requireAdminOrForeman: async () => ({ role: 'foreman' }),
    },
    '@/lib/supabase/server': { createClient() { assert.fail('An unauthorized mutation reached Supabase'); } },
  };
  const purchases = load('../materials/purchase-actions.ts', mocks);
  assert.ok((await purchases.saveMaterialPurchase(1, new FormData())).error);
  assert.ok((await purchases.deleteMaterialPurchase(1, 1)).error);
  assert.ok((await purchases.updateMaterialReceipt(1, 1, 5, 0)).error);
  const planning = load('../cost-estimate/actions.ts', mocks);
  // All public mutations must check authorization, including future additions.
  for (const [name, action] of Object.entries(planning)) {
    if (typeof action !== 'function') continue;
    const result = await action(1, 1, new FormData());
    assert.ok(result?.error, `${name} must reject field-only access`);
  }
  const history = load('../cost-estimate/undo-redo-actions.ts', mocks);
  assert.ok((await history.undoGanttAction(1)).error);
  assert.ok((await history.redoGanttAction(1)).error);
  await assert.rejects(history.resetGanttHistory(1), /not authorized/);
  const allocations = load('../equipment/tracking-actions.ts', mocks);
  assert.ok((await allocations.saveEquipmentPlans(1, 'task-1', [1], [])).error);
  const workers = load('../workers/actions.ts', mocks);
  assert.ok((await workers.setTaskWorkers(1, 1, [1])).error);
  assert.ok((await workers.setCategoryWorkers(1, 1, [1])).error);
  const extraction = load('../bom-import/actions.ts', mocks);
  assert.ok((await extraction.extractBomFromFile(new FormData())).error);
});

const bin = process.env.IDRMM_TEST_PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\18\\bin';
test('database permissions protect purchases and baselines through RLS and definer RPCs while preserving actual logs', {
  skip: !existsSync(join(bin, 'initdb.exe')), timeout: 60000,
}, async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'idrmm-workflow-permissions-'));
  const data = join(temporary, 'data');
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const run = (exe, args, input) => execFileSync(join(bin, exe), args, {
    input, encoding: 'utf8', windowsHide: true, timeout: 15000,
    stdio: exe === 'pg_ctl.exe' ? 'ignore' : ['pipe', 'pipe', 'pipe'],
  });
  let started = false;
  try {
    run('initdb.exe', ['-D', data, '-U', 'postgres', '-A', 'trust', '--no-locale', '--encoding=UTF8']);
    run('pg_ctl.exe', ['-D', data, '-l', join(temporary, 'server.log'), '-o', `-h 127.0.0.1 -p ${port} -F`, '-w', '-t', '10', 'start']);
    started = true;
    const sql = input => run('psql.exe', ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], input).trim();
    sql(`create role anon; create role authenticated; create schema auth; create schema storage;
      create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
      create function get_my_role() returns text language sql as $$select current_setting('test.role',true)$$;
      create function app_session_is_active() returns boolean language sql as $$select coalesce(current_setting('test.session',true),'active')='active'$$;
      create function invitation_setup_complete() returns boolean language sql as $$select coalesce(current_setting('test.invite',true),'complete')='complete'$$;
      create table system_backup_state(maintenance boolean,recovery_required boolean);
      insert into system_backup_state values(false,false);
      create table projects(id bigint primary key,access text,start_date date,target_end_date date,working_days int[],holidays date[],allocated_budget numeric,default_labor_cost_percent numeric,gantt_undo_cursor_id bigint,status text);
      insert into projects(id,access) values(1,'edit'),(2,'view'),(3,'none');
      create function project_access_level(p_id bigint) returns text language sql security definer as $$select access from projects where id=p_id$$;
      create table estimate_categories(id bigint primary key,project_id bigint references projects on delete cascade);
      create table estimate_tasks(id bigint primary key,project_id bigint references projects on delete cascade,category_id bigint references estimate_categories on delete cascade);
      create table material_purchases(id bigint primary key,project_id bigint references projects on delete cascade,quantity numeric);
      create table task_progress_entries(id bigint primary key,task_id bigint references estimate_tasks on delete cascade,quantity numeric);
      create table category_progress_entries(id bigint primary key,category_id bigint references estimate_categories on delete cascade,quantity numeric);
      create function _access_row_project(t text,r jsonb) returns bigint language plpgsql security definer as $$begin
        if t='projects' then return (r->>'id')::bigint; end if;
        if r ? 'project_id' then return (r->>'project_id')::bigint; end if;
        if r ? 'task_id' then return (select project_id from estimate_tasks where id=(r->>'task_id')::bigint); end if;
        return (select project_id from estimate_categories where id=(r->>'category_id')::bigint);
      end$$;
      create table storage.objects(id bigint primary key,bucket_id text);
      grant usage on schema public,auth,storage to authenticated;
    `);
    const indirect = ['estimate_category_material_assignments', 'estimate_task_material_assignments', 'estimate_task_other_costs', 'task_worker_assignments', 'category_worker_assignments'];
    for (const table of indirect) {
      const column = table.startsWith('category_') || table.startsWith('estimate_category_') ? 'category_id' : 'task_id';
      const parent = column === 'task_id' ? 'estimate_tasks' : 'estimate_categories';
      sql(`create table ${table}(id bigint primary key,${column} bigint references ${parent} on delete cascade);`);
    }
    for (const table of ['estimate_dependencies', 'gantt_snapshots', 'equipment_task_plans']) {
      sql(`create table ${table}(id bigint primary key,project_id bigint references projects on delete cascade);`);
    }
    sql(`grant select,insert,update,delete on all tables in schema public,storage to authenticated;
      do $$declare r record;begin
        for r in select schemaname,tablename from pg_tables where schemaname in ('public','storage') loop
          execute format('alter table %I.%I enable row level security',r.schemaname,r.tablename);
          execute format('create policy existing_access on %I.%I to authenticated using(true) with check(true)',r.schemaname,r.tablename);
        end loop;
      end$$;
      insert into estimate_categories values(10,1); insert into estimate_tasks values(10,1,10);
      insert into material_purchases values(10,1,5);
      insert into estimate_task_material_assignments values(10,10);
      create function test_rename_task() returns void language sql security definer as $$update estimate_tasks set category_id=10 where id=10$$;
      create function test_purchase() returns void language sql security definer as $$update material_purchases set quantity=9 where id=10$$;
    `);
    const migration = readFileSync(new URL('../../supabase/migrations/0144_project_planning_and_purchase_roles.sql', import.meta.url), 'utf8');
    sql(migration); sql(migration);
    const as = (role, statement, flags = '') => sql(`set role authenticated;set test.actor='00000000-0000-0000-0000-000000000001';set test.role='${role}';${flags}${statement}`);
    for (const role of ['foreman', 'project_manager']) {
      assert.throws(() => as(role, 'insert into material_purchases values(11,1,5)'), /policy|cannot change/);
      assert.throws(() => as(role, 'select test_purchase()'), /cannot change/);
      assert.equal(as(role, 'delete from material_purchases where id=10 returning id'), '');
      assert.equal(as(role, 'select quantity from material_purchases where id=10'), '5');
      assert.throws(() => as(role, "insert into storage.objects values(1,'purchase-receipts')"), /policy/);
      as(role, "insert into storage.objects values(2,'incident-evidence');delete from storage.objects where id=2");
    }
    for (const role of ['admin', 'super_admin']) {
      as(role, 'insert into material_purchases values(11,1,6);update material_purchases set quantity=7 where id=11;delete from material_purchases where id=11');
      as(role, "insert into storage.objects values(1,'purchase-receipts');delete from storage.objects where id=1");
      assert.throws(() => as(role, 'insert into material_purchases values(11,2,6)'), /edit access/);
    }
    assert.throws(() => as('foreman', 'select test_rename_task()'), /cannot change/);
    assert.throws(() => as('foreman', 'insert into estimate_categories values(11,1)'), /policy|cannot change/);
    assert.throws(() => as('foreman', 'insert into estimate_task_material_assignments values(11,10)'), /policy|cannot change/);
    assert.throws(() => as('foreman', 'update projects set gantt_undo_cursor_id=10 where id=1'), /cannot change/);
    for (const role of ['admin', 'super_admin', 'project_manager']) {
      as(role, 'select test_rename_task();insert into estimate_tasks values(11,1,10);delete from estimate_tasks where id=11');
      as(role, 'update projects set default_labor_cost_percent=30 where id=1');
      assert.throws(() => as(role, 'insert into estimate_tasks values(11,2,null)'), /edit access/);
      assert.throws(() => as(role, 'insert into estimate_tasks values(11,1,10)', "set test.session='expired';"), /cannot change|policy/);
      assert.throws(() => as(role, 'insert into estimate_tasks values(11,1,10)', "set test.invite='pending';"), /cannot change|policy/);
    }
    as('foreman', 'insert into task_progress_entries values(1,10,25);update task_progress_entries set quantity=30 where id=1;insert into category_progress_entries values(1,10,15)');
    assert.equal(sql('select quantity from task_progress_entries where id=1'), '30');
    assert.equal(as('foreman', 'select count(*) from estimate_tasks'), '1');
    // A trusted no-JWT maintenance connection can still restore data.
    sql('insert into estimate_tasks values(11,1,10);delete from estimate_tasks where id=11');
    // Parent cascades retain the existing project deletion behavior.
    as('admin', 'delete from projects where id=1');
    assert.equal(sql('select count(*) from material_purchases'), '0');
  } finally {
    if (started) run('pg_ctl.exe', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    rmSync(temporary, { recursive: true, force: true });
  }
});
