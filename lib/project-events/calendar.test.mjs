import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { computeExpectedProgress } from '../task-progress/calculate.ts';
import { ganttBarColors } from '../../components/projects/progress/gantt-bar-colors.ts';
const require=createRequire(import.meta.url);
const {PGlite}=require('@electric-sql/pglite');
const migration=readFileSync(new URL('../../supabase/migrations/0118_project_calendar_holidays.sql',import.meta.url),'utf8');

test('national holidays seed idempotently and working-day choices update the real schedule baseline',async()=>{
 const db=new PGlite();try {
  await db.exec(`create role anon;create role authenticated;
   create table system_backup_state(maintenance boolean,recovery_required boolean);
   create table projects(id bigint primary key,project_name text,holidays date[] not null default '{}');
   create table project_events(id bigint generated always as identity primary key,project_id bigint references projects(id),event_type text,name text,event_date date);
   create function sync_project_holidays() returns trigger language plpgsql as $$begin return null;end$$;
   create trigger project_events_sync_holidays after insert or update or delete on project_events for each row execute function sync_project_holidays();
   insert into projects values(1,'Test Project','{}');
   insert into project_events(project_id,event_type,name,event_date) values(1,'holiday','Local site holiday','2026-10-15');`);
  await db.exec(migration);
  const count=(await db.query('select count(*)::int as n from project_events')).rows[0].n;
  await db.exec(migration);assert.equal((await db.query('select count(*)::int as n from project_events')).rows[0].n,count);
  assert.ok((await db.query("select 1 from project_events where name='Local site holiday'")).rows.length);
  await db.exec("insert into projects(id,project_name) values(2,'New Project')");
  assert.equal((await db.query('select count(*)::int as n from project_events where project_id=2')).rows[0].n,count-1);
  const holidays=async()=> (await db.query("select array_to_json(holidays)::json as days from projects where id=1")).rows[0].days;
  const schedule={plannedStartDate:'2026-11-02',plannedEndDate:'2026-11-04',workingDays:[1,2,3,4,5],today:new Date(2026,10,2)};
  const before=computeExpectedProgress({...schedule,holidays:await holidays()});
  assert.equal(before.totalWorkingDays,2);assert.equal(before.elapsedWorkingDays,0);
  await db.exec("update project_events set is_working_day=true where project_id=1 and event_date='2026-11-02'");
  const after=computeExpectedProgress({...schedule,holidays:await holidays()});
  assert.equal(after.totalWorkingDays,3);assert.equal(after.elapsedWorkingDays,1);
  assert.equal((await holidays()).includes('2026-02-25'),false,'official special working day is not excluded');
  assert.equal((await holidays()).includes('2026-03-20'),true);
  assert.equal((await holidays()).includes('2026-05-27'),true);
  assert.ok((await holidays()).includes('2027-03-25'));
  await db.exec("update project_events set is_working_day=false where project_id=1 and event_date='2026-11-02'");
  assert.equal((await holidays()).includes('2026-11-02'),true);
 }finally{await db.close()}
});

test('calendar uses the same category colors and a saved-event callback instead of refresh alone',()=>{
 assert.equal(ganttBarColors(42,'standalone').backgroundColor,ganttBarColors(42,'subtask').backgroundColor);
 assert.equal(ganttBarColors(42,'milestone').backgroundColor,'#155dfc');
 const chart=readFileSync(new URL('../../components/projects/progress/gantt-chart-view.tsx',import.meta.url),'utf8');
 assert.match(chart,/colors: ganttBarColors\(colorId/);
 assert.match(chart,/onSaved=\{applyCalendarResult\}/);
 const modal=readFileSync(new URL('../../components/projects/progress/project-event-modal-content.tsx',import.meta.url),'utf8');
 assert.ok(modal.indexOf('onSaved(result)')<modal.indexOf('router.refresh()'));
 assert.match(modal,/Include in working days/);
});
