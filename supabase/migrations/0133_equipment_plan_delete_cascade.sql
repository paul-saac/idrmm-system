-- Intent: allow equipment deletion to remove its task allocations atomically.
-- The previous RESTRICT foreign key blocked deletion even for available items
-- with historical/completed task plans. Keep all other project, session, backup,
-- and archive guards unchanged. Saved progress and cost records are not deleted.
begin;
alter table public.equipment_task_plans
 drop constraint equipment_task_plans_equipment_id_fkey;
alter table public.equipment_task_plans
 add constraint equipment_task_plans_equipment_id_fkey
 foreign key (equipment_id) references public.equipment(id) on delete cascade;
notify pgrst,'reload schema';
commit;
