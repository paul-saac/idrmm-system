-- Intent: connect failed or conditional quality inspections to their governing
-- standard, corrective action, punch-list resolution, and later reinspection.
begin;

alter table public.project_quality_inspections
  add column if not exists standard_reference text not null default '' check (length(standard_reference) <= 500),
  add column if not exists nonconformance_description text not null default '' check (length(nonconformance_description) <= 5000),
  add column if not exists corrective_action_required text not null default '' check (length(corrective_action_required) <= 5000),
  add column if not exists punch_item_id bigint references public.project_punch_items(id) on delete set null,
  add column if not exists reinspection_reference text not null default '' check (length(reinspection_reference) <= 150);

create index if not exists project_quality_inspections_punch_item
  on public.project_quality_inspections(punch_item_id)
  where punch_item_id is not null;

commit;
