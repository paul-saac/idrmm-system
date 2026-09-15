-- ============================================================================
-- Folds the three "fixed" Survey questions (accidents/schedule delays/
-- weather delays — added directly as columns on daily_logs by
-- 0011_daily_log_survey.sql) into the dynamic
-- daily_log_survey_questions/daily_log_survey_answers pair from
-- 0033_daily_log_survey_questions.sql, so a project's Survey Questions
-- settings become the single source of truth for every question asked
-- on that project's Daily Logs — including these three, which are now
-- just regular rows an admin can rename, reorder, or delete like any
-- other question, instead of a separate hardcoded concept.
--
-- affects_delay_risk marks the (at most two, seeded below) questions
-- whose "Yes" answers count toward the Delay Risk Assessment's "Delay
-- Reports (30d)" stat — previously that stat read
-- weather_delays_occurred/schedule_delays_occurred directly off
-- daily_logs; now it counts daily_log_survey_answers joined to whichever
-- questions carry this flag. Not exposed in the Survey Questions
-- settings UI (no "counts toward delay risk" toggle in that mockup) —
-- only ever set by the seeding below, so an admin who deletes or
-- disables one of these two questions simply stops contributing to that
-- stat, same as any other data source that gets removed.
--
-- The six original columns on daily_logs are left in place, unused
-- going forward — dropping columns is a one-way door this migration
-- doesn't take; nothing in the app reads or writes them after this.
--
-- Run this AFTER 0033_daily_log_survey_questions.sql.
-- ============================================================================

alter table public.daily_log_survey_questions
  add column if not exists affects_delay_risk boolean not null default false;

-- Backfill: every existing project gets the same three defaults
-- 0011_daily_log_survey.sql always asked, seeded once each (guarded by
-- question_text so re-running this migration is a no-op).
insert into public.daily_log_survey_questions
  (project_id, question_text, is_required, sort_order, affects_delay_risk)
select p.id, 'Any accidents on site today?', true, 0, false
from public.projects p
where not exists (
  select 1 from public.daily_log_survey_questions q
  where q.project_id = p.id and q.question_text = 'Any accidents on site today?'
);

insert into public.daily_log_survey_questions
  (project_id, question_text, is_required, sort_order, affects_delay_risk)
select p.id, 'Any schedule delays occur?', true, 1, true
from public.projects p
where not exists (
  select 1 from public.daily_log_survey_questions q
  where q.project_id = p.id and q.question_text = 'Any schedule delays occur?'
);

insert into public.daily_log_survey_questions
  (project_id, question_text, is_required, sort_order, affects_delay_risk)
select p.id, 'Did weather cause any delays?', true, 2, true
from public.projects p
where not exists (
  select 1 from public.daily_log_survey_questions q
  where q.project_id = p.id and q.question_text = 'Did weather cause any delays?'
);

-- Carry over any answers already recorded on the old fixed columns so
-- they still show up once the app stops reading those columns.
insert into public.daily_log_survey_answers (daily_log_id, question_id, occurred, notes)
select dl.id, q.id, dl.accidents_occurred, dl.accidents_notes
from public.daily_logs dl
join public.daily_log_survey_questions q
  on q.project_id = dl.project_id and q.question_text = 'Any accidents on site today?'
where dl.accidents_occurred is not null or dl.accidents_notes is not null
on conflict (daily_log_id, question_id) do nothing;

insert into public.daily_log_survey_answers (daily_log_id, question_id, occurred, notes)
select dl.id, q.id, dl.schedule_delays_occurred, dl.schedule_delays_notes
from public.daily_logs dl
join public.daily_log_survey_questions q
  on q.project_id = dl.project_id and q.question_text = 'Any schedule delays occur?'
where dl.schedule_delays_occurred is not null or dl.schedule_delays_notes is not null
on conflict (daily_log_id, question_id) do nothing;

insert into public.daily_log_survey_answers (daily_log_id, question_id, occurred, notes)
select dl.id, q.id, dl.weather_delays_occurred, dl.weather_delays_notes
from public.daily_logs dl
join public.daily_log_survey_questions q
  on q.project_id = dl.project_id and q.question_text = 'Did weather cause any delays?'
where dl.weather_delays_occurred is not null or dl.weather_delays_notes is not null
on conflict (daily_log_id, question_id) do nothing;
