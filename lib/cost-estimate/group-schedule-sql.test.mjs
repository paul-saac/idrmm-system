import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';

const bin = process.env.IDRMM_TEST_PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\18\\bin';
const migration = readFileSync(new URL('../../supabase/migrations/0109_gantt_group_schedule_move.sql', import.meta.url), 'utf8');
test('group schedule migration is atomic, repeatable, project scoped and preserves actual progress', { skip: !existsSync(join(bin,'initdb.exe')), timeout: 60000 }, async t => {
  const temporary = mkdtempSync(join(tmpdir(),'idrmm-gantt-sql-'));
  const data = join(temporary,'data');
  const probe = createServer();
  await new Promise(resolve => probe.listen(0,'127.0.0.1',resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const run = (exe,args,input) => execFileSync(join(bin,exe),args,{input,encoding:'utf8',windowsHide:true,timeout:15000,
    stdio: exe === 'pg_ctl.exe' ? 'ignore' : ['pipe','pipe','pipe']});
  let started = false;
  try {
    try {
      run('initdb.exe',['-D',data,'-U','postgres','-A','trust','--no-locale','--encoding=UTF8']);
      run('pg_ctl.exe',['-D',data,'-l',join(temporary,'server.log'),'-o',`-h 127.0.0.1 -p ${port} -F`,'-w','-t','10','start']);
      started = true;
    } catch (error) {
      t.diagnostic(error.stderr?.toString().slice(-600) || error.message);
      t.skip('The isolated local PostgreSQL test server could not start. No live database was accessed.'); return;
    }
    const sql = text => run('psql.exe',['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],text).trim();
    sql(`create role anon; create role authenticated;
      create table projects(id bigint primary key,access text);
      create table estimate_categories(id bigint primary key,project_id bigint,planned_start_date date,planned_end_date date,is_milestone boolean default false,actual numeric default 0);
      create table estimate_tasks(id bigint primary key,project_id bigint,category_id bigint references estimate_categories(id),planned_start_date date,planned_end_date date,is_milestone boolean default false,actual numeric default 0);
      create function app_session_is_active() returns boolean language sql as $$select coalesce(current_setting('test.session',true),'active')='active'$$;
      create function project_access_level(project bigint) returns text language sql as $$select access from projects where id=project$$;
      create function system_backup_maintenance() returns boolean language sql as $$select coalesce(current_setting('test.maintenance',true),'false')='true'$$;
      insert into projects values(1,'edit'),(2,'edit'),(3,'view');
      insert into estimate_categories values(1,1,'2026-03-18','2026-04-15',false,40),(2,1,'2026-03-18','2026-04-15',false,60),(8,2,'2026-03-18','2026-04-15',false,80);
      insert into estimate_tasks values(1,1,2,'2026-03-20','2026-03-23',false,30),(2,1,2,'2026-03-25','2026-03-25',true,0),(8,2,8,'2026-03-20','2026-03-23',false,50);
      grant usage on schema public to authenticated;
      grant select on projects,estimate_categories,estimate_tasks to authenticated;
      grant update on estimate_categories,estimate_tasks to authenticated;`);
    sql(migration); sql(migration);
    const changes = [
      {kind:'category',id:1,start:'2026-03-21',end:'2026-04-18',previousStart:'2026-03-18',previousEnd:'2026-04-15'},
      {kind:'task',id:1,start:'2026-03-23',end:'2026-03-26',previousStart:'2026-03-20',previousEnd:'2026-03-23'},
      {kind:'task',id:2,start:'2026-03-28',end:'2026-03-28',previousStart:'2026-03-25',previousEnd:'2026-03-25'},
    ];
    const move = (rows,project=1,prefix='set role authenticated;') => sql(`${prefix}select move_selected_schedules(${project},'${JSON.stringify(rows)}'::jsonb);`);
    const snapshot = () => sql(`select 'c'||id||':'||planned_start_date||':'||planned_end_date||':'||actual from estimate_categories union all select 't'||id||':'||planned_start_date||':'||planned_end_date||':'||actual from estimate_tasks order by 1;`);
    const before = snapshot();
    // A later stale row must roll back an earlier valid update in the same call.
    assert.throws(()=>move([changes[0],{...changes[1],previousStart:'2026-01-01'}]));
    assert.equal(snapshot(),before);
    assert.throws(()=>move([changes[0],{...changes[1],id:8}])); assert.equal(snapshot(),before);
    assert.throws(()=>move([changes[0],changes[0]])); assert.equal(snapshot(),before);
    assert.throws(()=>move([{...changes[0],id:2}])); // Summary bars must expand to their actual children.
    assert.throws(()=>move(changes,3)); assert.equal(snapshot(),before);
    assert.throws(()=>move(changes,1,"set role authenticated;set test.session='expired';"));
    assert.throws(()=>move(changes,1,"set role authenticated;set test.maintenance='true';"));
    assert.throws(()=>move(changes,1,'set role anon;'));
    assert.throws(()=>move([{...changes[2],end:'2026-03-29'}])); assert.equal(snapshot(),before);
    move(changes);
    const after=snapshot(); assert.match(after,/c1:2026-03-21:2026-04-18:40/); assert.match(after,/t1:2026-03-23:2026-03-26:30/); assert.match(after,/t2:2026-03-28:2026-03-28:0/);
    assert.match(after,/t8:2026-03-20:2026-03-23:50/);
    assert.throws(()=>move(changes)); assert.equal(snapshot(),after);
  } finally {
    if (started || existsSync(join(data,'postmaster.pid'))) run('pg_ctl.exe',['-D',data,'-m','immediate','-w','stop']);
    const absolute=resolve(temporary), parent=resolve(tmpdir())+sep;
    if (!absolute.startsWith(parent) || !basename(absolute).startsWith('idrmm-gantt-sql-')) throw Error('Refusing to remove an unexpected test directory.');
    rmSync(absolute,{recursive:true,force:true});
  }
});
