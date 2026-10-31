import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';

const bin = process.env.IDRMM_TEST_PG_BIN ?? 'C:\\Program Files\\PostgreSQL\\18\\bin';
const links = readFileSync(new URL('../../supabase/migrations/0112_estimate_predecessor_successor.sql', import.meta.url),'utf8');
const team = readFileSync(new URL('../../supabase/migrations/0113_team_management_records.sql', import.meta.url),'utf8');
test('dependency and Team migrations enforce integrity, permissions and preserve existing records', { skip: !existsSync(join(bin,'initdb.exe')), timeout: 60000 }, async t => {
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

    sql(`create role anon;create role authenticated;
      create table projects(id bigint primary key,access text);
      create table estimate_categories(id bigint primary key,project_id bigint,category_name text,is_milestone boolean default false,predecessor_category_id bigint,predecessor_task_id bigint,actual numeric default 40);
      create table estimate_tasks(id bigint primary key,project_id bigint,category_id bigint,is_milestone boolean default false,predecessor_category_id bigint,predecessor_task_id bigint,actual numeric default 30);
      create function app_session_is_active() returns boolean language sql as $$select coalesce(current_setting('test.session',true),'active')='active'$$;
      create function project_access_level(project bigint) returns text language sql as $$select access from projects where id=project$$;
      create function system_backup_maintenance() returns boolean language sql as $$select coalesce(current_setting('test.maintenance',true),'false')='true'$$;
      insert into projects values(1,'edit'),(2,'edit'),(3,'view');
      insert into estimate_categories(id,project_id,category_name) values(1,1,'Start'),(2,1,'Group'),(3,1,'Finish'),(4,1,'Branch'),(8,2,'Other');
      insert into estimate_tasks(id,project_id,category_id) values(1,1,2),(2,1,2),(8,2,8);
      grant usage on schema public to authenticated;grant select on projects,estimate_categories,estimate_tasks to authenticated;
      grant update on estimate_categories,estimate_tasks to authenticated;`);
    sql(links);sql(links);
    const arg=v=>v===null?'null':typeof v==='string'?"'"+v+"'":String(v);
    const save=(source,pred=null,next=null,previous=null,prefix='set role authenticated;')=>sql(prefix+'select save_estimate_links('+[1,...source,...(pred??[null,null]),...(next??[null,null]),null,null,...(previous??[null,null])].map(arg).join(',')+');');
    const snapshot=()=>sql('select row_to_json(c) from estimate_categories c order by id;select row_to_json(t) from estimate_tasks t order by id;');
    const clean=snapshot();
    save(['task',1],['category',1],['task',2]);
    assert.equal(sql('select predecessor_category_id from estimate_tasks where id=1'),'1');
    assert.equal(sql('select predecessor_task_id from estimate_tasks where id=2'),'1');
    assert.equal(sql('select actual from estimate_tasks where id=1'),'30');
    const beforeCycle=snapshot();
    assert.throws(()=>save(['category',1],['task',2]),/circular dependency/);assert.equal(snapshot(),beforeCycle);
    assert.throws(()=>save(['category',2],['task',1]),/circular dependency/);assert.equal(snapshot(),beforeCycle);
    assert.throws(()=>save(['task',1],['category',2]),/circular dependency/);assert.equal(snapshot(),beforeCycle);
    assert.throws(()=>save(['task',1],['category',8]),/same project/);
    assert.throws(()=>save(['task',1],['task',1]),/itself/);
    assert.throws(()=>save(['task',1],null,null,null,"set role authenticated;set test.session='expired';"),/permission/);
    assert.throws(()=>save(['task',1],null,null,null,"set role authenticated;set test.maintenance='true';"),/paused/);
    assert.throws(()=>save(['task',1],null,null,null,'set role anon;'),/permission denied/);
    assert.throws(()=>sql("set role authenticated;select save_estimate_links(3,'task',1,null,null,null,null);"),/permission/);
    assert.equal(snapshot(),beforeCycle);
    // Branches configured through other rows' predecessor fields survive editing this source.
    save(['category',3],['category',1]);save(['category',4],['category',1]);
    save(['category',1],null,['task',1],['task',1]);
    assert.equal(sql('select count(*) from estimate_categories where predecessor_category_id=1'),'2');
    save(['category',1],null,null,['category',3]);
    assert.equal(sql('select predecessor_category_id from estimate_categories where id=3'),'');
    assert.equal(sql('select predecessor_category_id from estimate_categories where id=4'),'1');
    const branches=snapshot();
    assert.throws(()=>save(['category',1],null,null,['category',3]),/changed in another session/);assert.equal(snapshot(),branches);
    assert.notEqual(snapshot(),clean);
    sql(`create table profiles(id uuid primary key,first_name text,last_name text,role text,status text);
      create table workers(id bigint generated by default as identity primary key,full_name text,trade text,category text,employment_type text,profile_id uuid);
      create table assignments(worker_id bigint references workers(id));
      insert into profiles values('00000000-0000-0000-0000-000000000001','Test','Manager','project_manager','active'),('00000000-0000-0000-0000-000000000002','Same','Name','foreman','active');
      insert into workers(full_name,trade,category,employment_type,profile_id) values('Test Manager','Mason','management','employee','00000000-0000-0000-0000-000000000001'),('Unlinked Mason','Mason','management','employee',null),('Same Name','Mason','skilled','employee',null);
      insert into assignments values(1);`);
    sql(team);sql(team);
    assert.equal(sql('select trade from workers where id=1'),'Project Manager');
    assert.equal(sql('select category from workers where id=2'),'skilled');
    assert.equal(sql('select worker_id from assignments'),'1');
    sql("update workers set trade='Mason',category='skilled' where id=1;");
    assert.equal(sql('select trade from workers where id=1'),'Project Manager');
    sql("select ensure_team_member('00000000-0000-0000-0000-000000000002');");
    assert.equal(sql('select count(*) from workers'),'4');
    assert.equal(sql('select profile_id from workers where id=3'),'');
    sql("update profiles set role='foreman' where id='00000000-0000-0000-0000-000000000001';select ensure_team_member('00000000-0000-0000-0000-000000000001');");
    assert.equal(sql('select trade from workers where id=1'),'Foreman');
    assert.throws(()=>sql("set role authenticated;select ensure_team_member('00000000-0000-0000-0000-000000000001');"),/permission denied/);
  } finally {
    if (started || existsSync(join(data,'postmaster.pid'))) run('pg_ctl.exe',['-D',data,'-m','immediate','-w','stop']);
    const absolute=resolve(temporary), parent=resolve(tmpdir())+sep;
    if (!absolute.startsWith(parent) || !basename(absolute).startsWith('idrmm-gantt-sql-')) throw Error('Refusing to remove an unexpected test directory.');
    rmSync(absolute,{recursive:true,force:true});
  }
});
