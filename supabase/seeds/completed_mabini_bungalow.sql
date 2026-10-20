-- Fictional completed project for IDRMM demonstration; not actual job records.
-- Run this entire file in the Supabase SQL editor after the current schema
-- (including progress_override_logs and migrations 0073-0075) is installed.
-- Creates a NEW project, six clearly marked demo workers and three demo assets.
-- Does not reset tables or modify existing projects/accounts/inventory.
-- Re-running stops safely if the project already exists. All writes are atomic.
-- Values are illustrative PHP amounts, not quotations or verified market rates.
begin;
select pg_advisory_xact_lock(hashtext('idrmm_completed_bungalow_demo_v1'));

do $preflight$
declare
  table_name text;
begin
  foreach table_name in array array[
    'projects', 'profiles', 'estimate_categories', 'estimate_tasks',
    'estimate_task_material_assignments', 'estimate_category_material_assignments',
    'task_progress_entries', 'category_progress_entries',
    'task_progress_material_entries', 'category_progress_material_entries',
    'task_progress_attendance', 'category_progress_attendance',
    'progress_override_logs', 'workers', 'task_worker_assignments',
    'category_worker_assignments', 'equipment', 'equipment_assignments',
    'equipment_task_assignments', 'project_closeout_reports'
  ] loop
    if to_regclass('public.' || table_name) is null then
      raise exception 'Missing required table %. Install the current schema before running this seed.', table_name;
    end if;
  end loop;
  if exists (select 1 from public.projects where project_name = 'DEMO - Mabini Bungalow (Completed)') then
    raise exception 'This demo project already exists. No existing records were changed.';
  end if;
  if current_date < date '2026-09-15' then
    raise exception 'This completed-project scenario ends on September 15, 2026; use it on or after that date.';
  end if;
end $preflight$;

create temporary table demo_closeout_work (
  seq int primary key, phase text, title text, start_date date, planned_end date,
  actual_end date, quantity numeric, unit text, milestone boolean,
  equipment_planned numeric, equipment_actual numeric,
  other_planned numeric, other_actual numeric,
  category_id bigint, task_id bigint, labor_planned numeric, labor_actual numeric
) on commit drop;
insert into demo_closeout_work
  (seq, phase, title, start_date, planned_end, actual_end, quantity, unit, milestone,
   equipment_planned, equipment_actual, other_planned, other_actual)
values
  (0, 'Mobilization', 'Site setup and temporary facilities', '2026-06-01', '2026-06-03', '2026-06-03', 1, 'lot', false, 1800, 2000, 6000, 6300),
  (1, 'Earthworks', 'Excavation, backfill and compaction', '2026-06-04', '2026-06-08', '2026-06-08', 60, 'cu.m', false, 26000, 28000, 5000, 5200),
  (2, 'Foundations', 'Reinforced footings and ground slab', '2026-06-09', '2026-06-20', '2026-06-20', 18, 'cu.m', false, 15000, 15800, 3000, 3200),
  (3, 'Foundations', 'Foundation complete', '2026-06-20', '2026-06-20', '2026-06-20', 1, 'milestone', true, 0, 0, 0, 0),
  (4, 'Structure', 'Columns, beams and formwork', '2026-06-22', '2026-07-09', '2026-07-09', 8, 'cu.m', false, 19000, 19500, 3500, 3600),
  (5, 'Structure', 'Structural frame complete', '2026-07-09', '2026-07-09', '2026-07-09', 1, 'milestone', true, 0, 0, 0, 0),
  (6, 'Roofing', 'Steel framing and roof installation', '2026-07-10', '2026-07-20', '2026-07-20', 85, 'sq.m', false, 8000, 7500, 2500, 2400),
  (7, 'Masonry', 'CHB walls and plastering', '2026-07-21', '2026-08-05', '2026-08-05', 160, 'sq.m', false, 6500, 6700, 1500, 1650),
  (8, 'Services', 'Plumbing rough-in and pressure testing', '2026-08-06', '2026-08-12', '2026-08-12', 1, 'lot', false, 1800, 1600, 1200, 1200),
  (9, 'Services', 'Electrical rough-in and wiring', '2026-08-13', '2026-08-19', '2026-08-19', 1, 'lot', false, 1500, 1400, 1500, 1500),
  (10, 'Finishes', 'Floor and wall tiling', '2026-08-20', '2026-08-29', '2026-08-29', 90, 'sq.m', false, 2500, 2300, 1000, 1150),
  (11, 'Finishes', 'Ceiling installation and painting', '2026-08-31', '2026-09-09', '2026-09-09', 260, 'sq.m', false, 2800, 2600, 1400, 1600),
  (12, 'Completion', 'Doors, windows, fixtures and final cleaning', '2026-09-10', '2026-09-11', '2026-09-14', 1, 'lot', false, 1200, 1800, 2000, 2300),
  (13, 'Completion', 'Final completion and handover', '2026-09-12', '2026-09-12', '2026-09-15', 1, 'milestone', true, 0, 0, 0, 0);

create temporary table demo_closeout_materials (
  seq int, name text, unit text, planned numeric, used numeric, price numeric,
  primary key (seq, name, unit)
) on commit drop;
insert into demo_closeout_materials values
  (0, 'Temporary GI sheet', 'pcs', 12, 12, 450),
  (0, 'Framing timber', 'bd.ft', 40, 42, 60),
  (0, 'Common nails', 'kg', 5, 6, 90),
  (1, 'Selected filling material', 'cu.m', 22, 23, 850),
  (2, 'Ready-mix concrete 21 MPa', 'cu.m', 18, 18.5, 4800),
  (2, 'Deformed bar 12mm x 6m', 'pcs', 110, 114, 280),
  (2, 'Tie wire', 'kg', 20, 21, 85),
  (2, 'Form plywood 12mm', 'sheet', 18, 18, 850),
  (4, 'Ready-mix concrete 28 MPa', 'cu.m', 8, 8.2, 5200),
  (4, 'Deformed bar 16mm x 6m', 'pcs', 95, 97, 560),
  (4, 'Deformed bar 10mm x 6m', 'pcs', 80, 82, 210),
  (4, 'Form plywood 12mm', 'sheet', 22, 23, 850),
  (6, 'Pre-painted roofing sheet', 'sq.m', 85, 88, 550),
  (6, 'Steel C-purlin 6m', 'pcs', 45, 46, 720),
  (6, 'Roofing screws with washers', 'pcs', 700, 730, 4),
  (7, 'Concrete hollow block 100mm', 'pcs', 2000, 2060, 19),
  (7, 'Portland cement 40kg', 'bag', 125, 130, 285),
  (7, 'Washed sand', 'cu.m', 11, 11.4, 1500),
  (7, 'Deformed bar 10mm x 6m', 'pcs', 65, 67, 210),
  (8, 'PPR pipe 20mm x 4m', 'pcs', 25, 26, 240),
  (8, 'PVC sanitary pipe 100mm x 3m', 'pcs', 12, 12, 680),
  (8, 'Plumbing fittings', 'set', 1, 1, 6500),
  (9, 'THHN wire 2.0mm2', 'roll', 6, 6, 2800),
  (9, 'THHN wire 3.5mm2', 'roll', 4, 4, 4300),
  (9, 'PVC electrical conduit 20mm', 'pcs', 75, 78, 55),
  (9, 'Panel board and breakers', 'set', 1, 1, 12000),
  (10, 'Ceramic floor and wall tile', 'sq.m', 96, 98, 550),
  (10, 'Tile adhesive 25kg', 'bag', 36, 38, 260),
  (10, 'Tile grout', 'kg', 20, 22, 120),
  (11, 'Fiber cement ceiling board', 'sheet', 26, 27, 480),
  (11, 'Metal furring 5m', 'pcs', 65, 67, 130),
  (11, 'Interior primer 16L', 'pail', 3, 3, 1900),
  (11, 'Latex paint 16L', 'pail', 5, 5, 2600),
  (11, 'Skim coat 20kg', 'bag', 12, 13, 350),
  (12, 'Interior door and hardware', 'set', 5, 5, 7000),
  (12, 'Aluminum window assembly', 'sq.m', 12, 12, 4200),
  (12, 'Toilet and basin fixtures', 'set', 2, 2, 12500),
  (12, 'LED light and switch package', 'set', 1, 1, 14500);

create temporary table demo_closeout_workers (
  ordinal int primary key, worker_id bigint, name text, rate numeric
) on commit drop;
create temporary table demo_closeout_days (
  seq int, day date, ordinal int, hours numeric,
  work_weight numeric, cumulative_weight numeric, total_weight numeric,
  entry_id bigint, primary key (seq, day)
) on commit drop;

do $seed$
declare
  v_project bigint;
  v_admin uuid;
  v_pm uuid;
  v_foreman uuid;
  v_foreman_name text;
  v_category bigint;
  v_previous_task bigint := null;
  v_worker bigint;
  v_entry bigint;
  v_equipment bigint;
  v_assignment bigint;
  v_crew int[];
  v_kind text;
  v_material numeric;
  v_labor numeric;
  v_equipment_cost numeric;
  v_other numeric;
  v_quantity numeric;
  v_materials jsonb;
  v_attendance jsonb;
  v_planned numeric;
  v_actual numeric;
  v_entry_count int;
  v_history_count int;
  v_target_id bigint;
  v_timestamp timestamptz;
  w record;
  d record;
  m record;
  e record;
  r record;
begin
  -- Reuse active account IDs only; never create or edit login accounts.
  select id into v_admin from public.profiles
    where role in ('admin', 'super_admin') and status = 'active'
    order by created_at, id limit 1;
  select id into v_pm from public.profiles
    where role = 'project_manager' and status = 'active'
    order by created_at, id limit 1;
  select id, btrim(first_name || ' ' || last_name) into v_foreman, v_foreman_name
    from public.profiles where role = 'foreman' and status = 'active'
    order by created_at, id limit 1;
  if v_admin is null or v_pm is null or v_foreman is null then
    raise exception 'Create an active administrator, project manager and foreman account before seeding.';
  end if;

  insert into public.projects
    (project_name, location, status, project_manager_id, foreman_id, created_by,
     start_date, target_end_date, actual_end_date, allocated_budget, working_days,
     holidays, created_at)
  values
    ('DEMO - Mabini Bungalow (Completed)', 'Lipa City, Batangas', 'completed',
     v_pm, v_foreman, v_admin, '2026-06-01', '2026-09-12', '2026-09-15',
     1250000, array[1,2,3,4,5,6], array[]::date[], '2026-05-25 09:00:00+08')
  returning id into v_project;

  for r in select * from (values
    (1, 'Ramon Dela Cruz (Demo)', 'Carpenter', 112.50),
    (2, 'Joel Mendoza (Demo)', 'Mason', 100.00),
    (3, 'Luis Ramos (Demo)', 'Construction Helper', 75.00),
    (4, 'Paolo Santos (Demo)', 'Construction Helper', 75.00),
    (5, 'Marco Reyes (Demo)', 'Plumber', 125.00),
    (6, 'Erwin Garcia (Demo)', 'Electrician', 125.00)
  ) as crew(ordinal, name, trade, rate) loop
    insert into public.workers
      (full_name, trade, category, employment_type, hourly_rate, work_hours, date_hired, created_by)
    values (r.name, r.trade, 'skilled', 'employee', r.rate,
            array[8,8,8,8,8,6,0]::numeric[], '2026-05-25', v_admin)
    returning id into v_worker;
    insert into demo_closeout_workers values (r.ordinal, v_worker, r.name, r.rate);
  end loop;

  -- Daily weights create uneven production; cumulative rounding preserves exact
  -- final quantities. Saturdays are six hours. Two rain-affected days have four.
  insert into demo_closeout_days (seq, day, ordinal, hours, work_weight)
  select seq, day, rn, hours,
    case when milestone then 1 else hours * (0.8 + (rn % 4) * 0.1) end
  from (
    select workplan.seq, g.day::date as day, workplan.milestone,
      row_number() over (partition by workplan.seq order by g.day)::int as rn,
      case when workplan.milestone then 0
           when g.day::date in ('2026-07-03', '2026-08-25') then 4
           when extract(isodow from g.day) = 6 then 6 else 8 end::numeric as hours
    from demo_closeout_work workplan
    cross join lateral generate_series(workplan.start_date::timestamp, workplan.actual_end::timestamp, interval '1 day') as g(day)
    where extract(isodow from g.day) <> 7
      and (not workplan.milestone or g.day::date = workplan.actual_end)
  ) days;
  update demo_closeout_days dayrow set cumulative_weight = x.cumulative, total_weight = x.total
  from (
    select seq, day, sum(work_weight) over (partition by seq order by day) as cumulative,
      sum(work_weight) over (partition by seq) as total
    from demo_closeout_days
  ) x where x.seq = dayrow.seq and x.day = dayrow.day;

  for w in select * from demo_closeout_work order by seq loop
    select id into v_category from public.estimate_categories
      where project_id = v_project and category_name = w.phase;
    if v_category is null then
      insert into public.estimate_categories
        (project_id, category_name, category_material_estimate,
         category_labor_estimate, category_equipment_estimate, category_other_estimate)
      values (v_project, w.phase, 0, 0, 0, 0) returning id into v_category;
    end if;
    v_kind := case when w.seq = 0 then 'category' else 'task' end;
    v_crew := case when w.milestone then array[]::int[]
                   when w.seq = 8 then array[3,4,5]
                   when w.seq = 9 then array[3,4,6] else array[1,2,3,4] end;
    select coalesce(sum(rate), 0) into v_labor from demo_closeout_workers where ordinal = any(v_crew);
    select v_labor * coalesce(sum(case when extract(isodow from g.day) = 6 then 6 else 8 end),0)
      into w.labor_planned
      from generate_series(w.start_date::timestamp, w.planned_end::timestamp, interval '1 day') g(day)
      where extract(isodow from g.day) <> 7;
    select v_labor * sum(hours) into w.labor_actual from demo_closeout_days where seq = w.seq;
    select coalesce(sum(planned * price), 0) into v_material from demo_closeout_materials where seq = w.seq;
    if w.seq = 0 then
      update public.estimate_categories set
        estimated_quantity = w.quantity, unit = w.unit,
        planned_start_date = w.start_date, planned_end_date = w.planned_end,
        category_material_estimate = v_material, category_labor_estimate = w.labor_planned,
        category_equipment_estimate = w.equipment_planned, category_other_estimate = w.other_planned
      where id = v_category;
      v_target_id := v_category;
    else
      insert into public.estimate_tasks
        (project_id, category_id, task_name, estimated_quantity, unit,
         labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
         total_estimate_cost, planned_start_date, planned_end_date, predecessor_task_id,
         is_milestone, priority)
      values
        (v_project, v_category, w.title, w.quantity, w.unit, w.labor_planned,
         v_material, w.equipment_planned, w.other_planned,
         w.labor_planned + v_material + w.equipment_planned + w.other_planned,
         w.start_date, w.planned_end, v_previous_task, w.milestone, 'medium')
      returning id into v_target_id;
      -- Milestones occur at the end of their predecessor's final workday.
      -- Do not make the next productive task depend on a same-day milestone.
      if not w.milestone then v_previous_task := v_target_id; end if;
      if w.other_planned > 0 then
        insert into public.estimate_task_other_costs (task_id, cost_name, amount)
        values (v_target_id, 'Delivery, hauling and testing allowance', w.other_planned);
      end if;
    end if;
    update demo_closeout_work set category_id = v_category,
      task_id = case when w.seq = 0 then null else v_target_id end,
      labor_planned = w.labor_planned, labor_actual = w.labor_actual where seq = w.seq;

    execute format(
      'insert into public.%I (%I, material_name, planned_quantity, unit, unit_cost)
       select $1, name, planned, unit, price from demo_closeout_materials where seq = $2',
      'estimate_' || v_kind || '_material_assignments', v_kind || '_id')
      using v_target_id, w.seq;
    execute format(
      'insert into public.%I (%I, worker_id)
       select $1, worker_id from demo_closeout_workers where ordinal = any($2)',
      v_kind || '_worker_assignments', v_kind || '_id') using v_target_id, v_crew;

    for d in select * from demo_closeout_days where seq = w.seq order by day loop
      v_timestamp := (d.day + time '17:30') at time zone 'Asia/Manila';
      v_quantity := round(w.quantity * d.cumulative_weight / d.total_weight, 3)
                    - round(w.quantity * (d.cumulative_weight - d.work_weight) / d.total_weight, 3);
      v_labor := w.labor_actual * d.hours / nullif((select sum(hours) from demo_closeout_days where seq = w.seq), 0);
      v_labor := coalesce(v_labor, 0);
      v_equipment_cost := round(w.equipment_actual * d.cumulative_weight / d.total_weight, 2)
                          - round(w.equipment_actual * (d.cumulative_weight - d.work_weight) / d.total_weight, 2);
      v_other := case when d.ordinal = 1 then w.other_actual else 0 end;
      execute format(
        'insert into public.%I (%I, entry_date, quantity_completed,
         labor_cost, material_cost, equipment_cost, other_cost, recorded_by, created_at)
         values ($1,$2,$3,$4,0,$5,$6,$7,$8) returning id',
        v_kind || '_progress_entries', v_kind || '_id')
        into v_entry using v_target_id, d.day, v_quantity, v_labor, v_equipment_cost, v_other, v_foreman, v_timestamp;
      update demo_closeout_days set entry_id = v_entry where seq = w.seq and day = d.day;
      v_material := 0;
      v_materials := '[]'::jsonb;
      for m in select *, case when unit in ('pcs','sheet','bag','roll','set','pail') then 0 else 2 end as decimals
        from demo_closeout_materials where seq = w.seq loop
        m.used := round(m.used * d.cumulative_weight / d.total_weight, m.decimals)
                  - round(m.used * (d.cumulative_weight - d.work_weight) / d.total_weight, m.decimals);
        if m.used = 0 then continue; end if;
        execute format(
          'insert into public.%I (progress_entry_id, material_name, unit, quantity_used, unit_cost, created_at)
           values ($1,$2,$3,$4,null,$5)', v_kind || '_progress_material_entries')
          using v_entry, m.name, m.unit, m.used, v_timestamp;
        v_material := v_material + m.used * m.price;
        v_materials := v_materials || jsonb_build_array(jsonb_build_object('name', m.name, 'unit', m.unit, 'quantity', m.used));
      end loop;
      v_material := round(v_material, 2);
      -- A genuinely unplanned item, explicitly priced on the usage line.
      if w.seq = 12 and d.ordinal = 1 then
        insert into public.task_progress_material_entries
          (progress_entry_id, material_name, unit, quantity_used, unit_cost, created_at)
        values (v_entry, 'Neutral-cure silicone sealant', 'tube', 6, 185, v_timestamp);
        v_material := v_material + 1110;
        v_materials := v_materials || jsonb_build_array(jsonb_build_object(
          'name','Neutral-cure silicone sealant','unit','tube','quantity',6,'unitCost',185));
      end if;
      execute format('update public.%I set material_cost = $1 where id = $2', v_kind || '_progress_entries')
        using v_material, v_entry;
      execute format(
        'insert into public.%I (progress_entry_id, worker_id, worker_name, hours, hourly_rate)
         select $1, worker_id, name, $2, rate from demo_closeout_workers where ordinal = any($3)',
        v_kind || '_progress_attendance') using v_entry, d.hours, v_crew;
      select coalesce(jsonb_agg(jsonb_build_object('name', name, 'hours', d.hours, 'rate', rate) order by ordinal), '[]'::jsonb)
        into v_attendance from demo_closeout_workers where ordinal = any(v_crew);

      -- One old audit snapshot demonstrates a correction. It is NOT another
      -- current expense. The final history snapshot below matches the saved row.
      if w.seq = 1 and d.ordinal = 1 then
        insert into public.progress_override_logs
          (project_id, task_id, entry_date, action, quantity_completed, labor_cost,
           material_cost, equipment_cost, other_cost, materials_used, attendance,
           saved_by, saved_by_name, created_at)
        values (v_project, v_target_id, d.day, 'saved', v_quantity, v_labor,
          v_material, greatest(0, v_equipment_cost - 500), v_other, v_materials,
          v_attendance, v_foreman, v_foreman_name, v_timestamp - interval '30 minutes');
      end if;
      insert into public.progress_override_logs
        (project_id, task_id, category_id, entry_date, action, quantity_completed,
         labor_cost, material_cost, equipment_cost, other_cost, materials_used,
         attendance, saved_by, saved_by_name, created_at)
      values (v_project, case when w.seq > 0 then v_target_id end,
        case when w.seq = 0 then v_target_id end, d.day, 'saved', v_quantity,
        v_labor, v_material, v_equipment_cost, v_other, v_materials,
        v_attendance, v_foreman, v_foreman_name, v_timestamp);
    end loop;
  end loop;

  -- Distinct demo assets: no existing inventory is checked out or changed.
  for e in select * from (values
    ('CMP','Plate compactor (Demo)','Compaction',array[1]),
    ('VIB','Concrete vibrator (Demo)','Concrete',array[2,4]),
    ('SCA','Mobile scaffold tower (Demo)','Access',array[6,7,11])
  ) assets(code, name, category, tasks) loop
    select min(start_date), max(actual_end) into r from demo_closeout_work where seq = any(e.tasks);
    insert into public.equipment (asset_tag, name, category, status, created_by, last_assigned_at, last_returned_at)
    values ('DEMO-MABINI-' || e.code, e.name, e.category, 'available', v_admin,
      (r.min + time '08:00') at time zone 'Asia/Manila',
      (r.max + time '18:00') at time zone 'Asia/Manila')
    returning id into v_equipment;
    insert into public.equipment_assignments
      (equipment_id, project_id, assigned_by, assigned_at, returned_at, notes)
    values (v_equipment, v_project, v_admin,
      (r.min + time '08:00') at time zone 'Asia/Manila',
      (r.max + time '18:00') at time zone 'Asia/Manila', 'Fictional completed-project demonstration')
    returning id into v_assignment;
    for w in select * from demo_closeout_work where seq = any(e.tasks) order by seq loop
      insert into public.equipment_task_assignments
        (equipment_assignment_id, project_id, task_id, task_name, assigned_by,
         assigned_at, released_at, release_reason, notes)
      values (v_assignment, v_project, w.task_id, w.title, v_admin,
        (w.start_date + time '08:00') at time zone 'Asia/Manila',
        (w.actual_end + time '18:00') at time zone 'Asia/Manila',
        case when w.seq = e.tasks[array_length(e.tasks,1)] then 'returned' else 'moved' end,
        'Demo asset; closed placement');
    end loop;
  end loop;

  insert into public.project_closeout_reports (project_id, notes, milestone_dates)
  select v_project,
    jsonb_build_object(
      'summary', 'Fictional 72 m² single-storey bungalow in Lipa City. Site setup began on June 1, 2026, followed by foundations, structural work, roofing, masonry, services and finishes. Work finished on September 15, 2026, three calendar days after the September 12 target.',
      'outcomes', 'All planned work quantities were completed, including the reinforced structure, 85 m² roof, 160 m² masonry, plumbing and electrical installations, 90 m² tiling, ceilings, painting, doors and windows. Three key milestones have recorded achievement dates.',
      'performance', 'The foundation and structural milestones met their planned dates. Two shortened rain-affected shifts reduced production. Final fixture fitting required two additional working days, moving final handover from September 12 to September 15. Material overuse and silicone sealant are recorded against actual progress entries; all demo equipment has been returned.'
    ),
    coalesce(jsonb_object_agg('task-' || task_id, actual_end::text) filter (where milestone), '{}'::jsonb)
  from demo_closeout_work;

  -- Remove only notifications generated for this new synthetic project during
  -- this transaction, so historical seed activity does not flood user inboxes.
  if to_regclass('public.notifications') is not null then
    delete from public.notifications where project_id = v_project;
  end if;

  -- Fail the entire transaction if final quantities, attendance, costs or audit
  -- snapshots disagree. Checks read only the project created above.
  for w in select * from demo_closeout_work order by seq loop
    v_kind := case when w.seq = 0 then 'category' else 'task' end;
    v_target_id := coalesce(w.task_id, w.category_id);
    execute format('select sum(quantity_completed), sum(labor_cost), sum(equipment_cost), sum(other_cost)
      from public.%I where %I = $1', v_kind || '_progress_entries', v_kind || '_id')
      into v_quantity, v_labor, v_equipment_cost, v_other using v_target_id;
    if v_quantity <> w.quantity or v_labor <> w.labor_actual
       or v_equipment_cost <> w.equipment_actual or v_other <> w.other_actual then
      raise exception 'Quantity/cost reconciliation failed for %', w.title;
    end if;
    for m in select * from demo_closeout_materials where seq = w.seq loop
      execute format('select coalesce(sum(m.quantity_used),0) from public.%I m join public.%I e
        on e.id = m.progress_entry_id where e.%I = $1 and m.material_name = $2 and m.unit = $3',
        v_kind || '_progress_material_entries', v_kind || '_progress_entries', v_kind || '_id')
        into v_material using v_target_id, m.name, m.unit;
      if v_material <> m.used then raise exception 'Material reconciliation failed: % / %', w.title, m.name; end if;
    end loop;
    for d in select * from demo_closeout_days where seq = w.seq loop
      execute format('select labor_cost, material_cost from public.%I where id=$1', v_kind || '_progress_entries')
        into v_labor, v_material using d.entry_id;
      execute format('select coalesce(sum(hours * hourly_rate),0) from public.%I where progress_entry_id=$1', v_kind || '_progress_attendance')
        into v_actual using d.entry_id;
      if v_labor <> v_actual then raise exception 'Attendance mismatch for % on %', w.title, d.day; end if;
      execute format('select round(coalesce(sum(m.quantity_used * coalesce(m.unit_cost, p.unit_cost)),0),2)
        from public.%I m left join public.%I p on p.%I=$1 and p.material_name=m.material_name and p.unit=m.unit
        where m.progress_entry_id=$2',
        v_kind || '_progress_material_entries', 'estimate_' || v_kind || '_material_assignments', v_kind || '_id')
        into v_actual using v_target_id, d.entry_id;
      if v_material <> v_actual then raise exception 'Material cost mismatch for % on %', w.title, d.day; end if;
    end loop;
  end loop;
  select count(*) into v_entry_count from demo_closeout_days;
  select count(*) into v_history_count from public.progress_override_logs where project_id = v_project;
  if v_history_count <> v_entry_count + 1 then raise exception 'Unexpected override history count'; end if;
  if exists (
    select day, worker_id from (
      select pe.entry_date as day, a.worker_id, a.hours from public.task_progress_attendance a
      join public.task_progress_entries pe on pe.id=a.progress_entry_id
      join public.estimate_tasks t on t.id=pe.task_id where t.project_id=v_project
      union all
      select pe.entry_date, a.worker_id, a.hours from public.category_progress_attendance a
      join public.category_progress_entries pe on pe.id=a.progress_entry_id
      join public.estimate_categories c on c.id=pe.category_id where c.project_id=v_project
    ) attendance group by day, worker_id having sum(hours)>8
  ) then raise exception 'A demo worker has overlapping shifts'; end if;
  select sum(labor_planned+equipment_planned+other_planned) +
    (select sum(planned*price) from demo_closeout_materials) into v_planned from demo_closeout_work;
  select sum(labor_actual+equipment_actual+other_actual) +
    (select sum(used*price) from demo_closeout_materials) + 1110 into v_actual from demo_closeout_work;
  raise notice 'Created project %: 13 tasks, 1 standalone phase, 3 milestones, 38 planned material lines, % progress entries, % audit entries. Planned PHP %, logged PHP %.',
    v_project, v_entry_count, v_history_count, v_planned, v_actual;
end $seed$;

commit;

select id, project_name, status, start_date, target_end_date, actual_end_date, allocated_budget
from public.projects where project_name = 'DEMO - Mabini Bungalow (Completed)';
