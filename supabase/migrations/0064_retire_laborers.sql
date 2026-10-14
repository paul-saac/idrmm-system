-- Laborers stop being a Team category — the Team page's tables are now DDD
-- Management, Skilled Workers, Engineers & Architects and Subcontractors.
-- Anyone filed under it moves to skilled (nobody is removed).
--
-- Run this AFTER 0063_team_categories.sql.

alter table public.workers drop constraint if exists workers_category_check;

update public.workers
set category = 'skilled'
where category = 'laborer';

alter table public.workers
  add constraint workers_category_check
  check (category in ('management', 'professional', 'skilled'));
