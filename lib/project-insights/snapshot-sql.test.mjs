import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const {PGlite}=createRequire(import.meta.url)('@electric-sql/pglite');

test('saved insight policies enforce project access, active sessions and snapshot identity',async()=>{
  const db=new PGlite();
  const actor='00000000-0000-0000-0000-000000000001';
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create function auth.uid() returns uuid language sql as $$select '${actor}'::uuid$$;
      create table projects(id bigint primary key); create table profiles(id uuid primary key);
      insert into projects values(1),(2); insert into profiles values('${actor}');
      create function app_session_is_active() returns boolean language sql as $$select current_setting('test.active')='yes'$$;
      create function invitation_setup_complete() returns boolean language sql as $$select true$$;
      create function project_access_level(bigint) returns text language sql as $$select case when $1=1 then 'view' else null end$$;
      create function system_backup_write_guard() returns trigger language plpgsql as $$begin
        if current_setting('test.maintenance')='on' then raise exception 'Saving paused'; end if; return new; end$$;
      set test.active='yes'; set test.maintenance='off';
      grant usage on schema public,auth to authenticated;`);
    await db.exec(readFileSync(new URL('../../supabase/migrations/0126_saved_project_ai_insights.sql',import.meta.url),'utf8'));
    await db.exec('set role authenticated');
    const write=(id=1)=>db.query('insert into project_ai_insights(project_id,analysis,generated_by) values($1,$2::jsonb,$3)',[id,JSON.stringify({projectId:id,summary:'Verified records',findings:[]}),actor]);
    await write();
    assert.equal((await db.query('select count(*)::int as n from project_ai_insights')).rows[0].n,1);
    await assert.rejects(write(2),/row-level security/);
    await db.exec("set test.active='no'");
    assert.equal((await db.query('select count(*)::int as n from project_ai_insights')).rows[0].n,0);
    await assert.rejects(write(),/row-level security/);
    await db.exec("set test.active='yes'; set test.maintenance='on'");
    await assert.rejects(db.exec("update project_ai_insights set analysis=analysis"),/Saving paused/);
    await db.exec("set test.maintenance='off'");
    await assert.rejects(db.exec("update project_ai_insights set analysis=jsonb_set(analysis,'{projectId}','2')"),/check constraint/);
    await db.exec('reset role');
    assert.equal((await db.query('select count(*)::int as n from projects')).rows[0].n,2);
    assert.equal((await db.query("select has_table_privilege('anon','project_ai_insights','select') as allowed")).rows[0].allowed,false);
  } finally {await db.close();}
});
