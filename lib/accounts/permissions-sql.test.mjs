import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';

const bin = process.env.IDRMM_TEST_PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\18\\bin';
const migration = readFileSync(new URL('../../supabase/migrations/0111_admin_account_access.sql', import.meta.url), 'utf8');
test('account access and request approvals enforce Admin/Super Admin privileges through direct SQL calls', { skip: !existsSync(join(bin,'initdb.exe')), timeout: 60000 }, async t => {
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
    const sql = text => run('psql.exe',['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-qAt'],text).trim();
    sql(`create role anon;create role authenticated;create schema auth;
      create function auth.uid() returns uuid language sql as $$select coalesce(nullif(current_setting('test.actor',true),''),'00000000-0000-0000-0000-000000000001')::uuid$$;
      create table profiles(id uuid primary key,role text,status text default 'active',invitation_pending boolean default false,first_name text,last_name text);
      create table projects(id bigint primary key,project_name text,location text,project_manager_id uuid,foreman_id uuid);
      create table project_account_access(project_id bigint references projects(id),profile_id uuid references profiles(id),access_level text,granted_by uuid,updated_at timestamptz default now(),primary key(project_id,profile_id));
      create table account_events(actor_id uuid,actor_name text,target_id uuid,target_name text,action text,details text);
      create table material_requests(id bigint generated always as identity primary key,status text not null default 'draft',approved_by uuid,approved_at timestamptz);
      create table equipment_requests(like material_requests including all);
      create function app_session_is_active() returns boolean language sql as $$select coalesce(current_setting('test.session',true),'active')='active'$$;
      create function system_backup_maintenance() returns boolean language sql as $$select coalesce(current_setting('test.maintenance',true),'false')='true'$$;
      create function project_access_level(project bigint) returns text language sql as $$select coalesce(current_setting('test.access',true),'edit')$$;
      create function get_my_role() returns text language sql as $$select case when role='super_admin' then 'admin' else role end from profiles where id=auth.uid()$$;
      create function _project_access_level(project bigint,profile uuid) returns text language sql as $$select coalesce((select access_level from project_account_access where project_id=project and profile_id=profile),'edit')$$;
      insert into profiles(id,role) values('00000000-0000-0000-0000-000000000001','admin'),('00000000-0000-0000-0000-000000000002','super_admin'),('00000000-0000-0000-0000-000000000003','project_manager'),('00000000-0000-0000-0000-000000000004','foreman');
      insert into projects values(1,'Project A','Location','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000004');
      grant usage on schema public,auth to authenticated;grant select,insert,update on material_requests,equipment_requests to authenticated;grant usage,select on all sequences in schema public to authenticated;
    `);
    sql(migration);sql(migration);
    const actor=id=>`set role authenticated;set test.actor='00000000-0000-0000-0000-${String(id).padStart(12,'0')}';`;
    const target="'00000000-0000-0000-0000-000000000004'";
    const editor=id=>sql(actor(id)+`select project_account_access_editor(${target});`);
    const save=(id,level,previous,extra='')=>sql(actor(id)+extra+`select save_project_account_access(${target},'[{"id":1,"level":"${level}","previous":"${previous}"}]');`);
    const grants=()=>sql('select count(*) from project_account_access');
    for(const id of [3,4]) {
      assert.equal(sql(actor(id)+'select can_manage_project_access(1);').split('\n').at(-1),'f');
      assert.throws(()=>editor(id),/Project access management denied/);
      assert.throws(()=>save(id,'view','edit'),/Project access management denied/);
      assert.equal(grants(),'0');
    }
    assert.throws(()=>sql(`set role anon;select project_account_access_editor(${target});`),/permission denied/);
    for(const id of [1,2])assert.equal(JSON.parse(editor(id).split('\n').at(-1)).projects.length,1);
    save(1,'view','edit');assert.equal(grants(),'1');
    assert.throws(()=>save(2,'none','edit'),/Access changed/);
    save(2,'none','view');assert.equal(sql('select access_level from project_account_access'),'none');
    assert.throws(()=>save(1,'edit','none',"set test.session='expired';"),/management denied/);
    assert.throws(()=>save(1,'edit','none',"set test.maintenance='true';"),/Saving is temporarily paused/);
    sql("update profiles set status='inactive' where role='admin'");assert.throws(()=>editor(1),/management denied/);
    sql("update profiles set status='active',invitation_pending=true where role='admin'");assert.throws(()=>editor(1),/management denied/);
    sql("update profiles set invitation_pending=false where role='admin'");
    // The same database trigger protects both request tables, even on INSERT.
    for(const table of ['material_requests','equipment_requests']) {
      for(const id of [3,4]) {
        assert.throws(()=>sql(actor(id)+`insert into ${table}(status) values('approved');`),/Only administrators/);
        assert.throws(()=>sql(actor(id)+`insert into ${table}(status) values('fulfilled');`),/Only administrators/);
        assert.throws(()=>sql(actor(id)+`insert into ${table}(status,approved_by) values('draft',${target});`),/Only administrators/);
      }
      const id=sql(actor(4)+`insert into ${table}(status) values('submitted') returning id;`).split('\n').find(row=>/^\d+$/.test(row));
      assert.ok(id);
      assert.throws(()=>sql(actor(3)+`update ${table} set status='approved' where id=${id};`),/Only administrators/);
      assert.throws(()=>sql(actor(4)+`update ${table} set status='fulfilled' where id=${id};`),/Only administrators/);
      sql(actor(1)+`update ${table} set status='approved',approved_by=auth.uid(),approved_at=now() where id=${id};`);
      sql(actor(4)+`update ${table} set status='partially_fulfilled' where id=${id};`);
      sql(actor(3)+`update ${table} set status='fulfilled' where id=${id};`);
      assert.throws(()=>sql(actor(4)+`update ${table} set approved_at=null where id=${id};`),/Only administrators/);
      sql(actor(2)+`insert into ${table}(status,approved_by,approved_at) values('approved',auth.uid(),now());`);
    }

  } finally {
    if (started || existsSync(join(data,'postmaster.pid'))) run('pg_ctl.exe',['-D',data,'-m','immediate','-w','stop']);
    const absolute=resolve(temporary), parent=resolve(tmpdir())+sep;
    if (!absolute.startsWith(parent) || !basename(absolute).startsWith('idrmm-gantt-sql-')) throw Error('Refusing to remove an unexpected test directory.');
    rmSync(absolute,{recursive:true,force:true});
  }
});
