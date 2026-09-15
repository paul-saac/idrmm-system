-- ============================================================================
-- Per-project custom survey questions for the Daily Log's own Survey
-- section. 0011_daily_log_survey.sql deliberately stored the original
-- three questions (accidents/schedule delays/weather delays) directly as
-- columns on daily_logs, "since there's a fixed, small set of questions,
-- not a dynamic/growing list" — this migration is exactly that
-- growing-list case arriving: a Project Manager can now add their own
-- extra questions on top of those three fixed ones (e.g. "Any equipment
-- breakdowns?" for a project running heavy machinery). The original three
-- stay exactly as they are, untouched, on daily_logs — this is additive,
-- not a replacement.
--
-- daily_log_survey_questions is the question *bank*: one row per custom
-- question a project has defined, editable independently of any log
-- (add/edit/remove a question any time; existing daily_log_survey_answers
-- rows for it disappear along with it via cascade — a v1 simplification,
-- same "no history preserved past deletion" tradeoff every other
-- daily-log child table already accepts). sort_order controls display
-- order in both the settings modal and the Add Daily Log survey step.
--
-- daily_log_survey_answers is one row per (daily log, question) pair
-- actually answered — same occurred+notes shape as the three fixed
-- columns, so the UI can render a custom question identically to a
-- built-in one. Always reads the question's *current* wording (no text
-- snapshot on the answer) — editing a question's phrasing after logs
-- already answered it re-labels those historical answers too, another
-- v1 simplification.
--
-- Admin-only RLS, same caveat as every other Daily Logs table in this
-- app: a Project Manager managing their own project's questions is the
-- real end state, but that role has no dashboard built yet.
--
-- Run this AFTER 0032_estimate_sort_order_undo.sql.
-- ============================================================================

create table if not exists public.daily_log_survey_questions (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  question_text text not null,
  is_required boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_daily_log_survey_questions_project_id
  on public.daily_log_survey_questions (project_id);

alter table public.daily_log_survey_questions enable row level security;

drop policy if exists "Admins can view daily log survey questions" on public.daily_log_survey_questions;
create policy "Admins can view daily log survey questions" on public.daily_log_survey_questions
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create daily log survey questions" on public.daily_log_survey_questions;
create policy "Admins can create daily log survey questions" on public.daily_log_survey_questions
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update daily log survey questions" on public.daily_log_survey_questions;
create policy "Admins can update daily log survey questions" on public.daily_log_survey_questions
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete daily log survey questions" on public.daily_log_survey_questions;
create policy "Admins can delete daily log survey questions" on public.daily_log_survey_questions
  for delete using (public.get_my_role() = 'admin');

create table if not exists public.daily_log_survey_answers (
  id bigint generated always as identity primary key,
  daily_log_id bigint not null references public.daily_logs (id) on delete cascade,
  question_id bigint not null references public.daily_log_survey_questions (id) on delete cascade,
  occurred boolean,
  notes text,
  unique (daily_log_id, question_id)
);

create index if not exists idx_daily_log_survey_answers_daily_log_id
  on public.daily_log_survey_answers (daily_log_id);
create index if not exists idx_daily_log_survey_answers_question_id
  on public.daily_log_survey_answers (question_id);

alter table public.daily_log_survey_answers enable row level security;

drop policy if exists "Admins can view daily log survey answers" on public.daily_log_survey_answers;
create policy "Admins can view daily log survey answers" on public.daily_log_survey_answers
  for select using (public.get_my_role() = 'admin');

drop policy if exists "Admins can create daily log survey answers" on public.daily_log_survey_answers;
create policy "Admins can create daily log survey answers" on public.daily_log_survey_answers
  for insert with check (public.get_my_role() = 'admin');

drop policy if exists "Admins can update daily log survey answers" on public.daily_log_survey_answers;
create policy "Admins can update daily log survey answers" on public.daily_log_survey_answers
  for update using (public.get_my_role() = 'admin');

drop policy if exists "Admins can delete daily log survey answers" on public.daily_log_survey_answers;
create policy "Admins can delete daily log survey answers" on public.daily_log_survey_answers
  for delete using (public.get_my_role() = 'admin');
