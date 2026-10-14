-- ============================================================================
-- Sample data for "Project Nica" — fills in what its cost estimate is
-- missing so it reads like a real small residential job:
--
--   1. Estimated quantity + unit on every standalone category and task
--   2. Material Breakdown lines on tasks that have no materials at all
--      (Concrete Beams, Slab on Grade, CHB Wall & Plastering)
--   3. Equipment cost on tasks that have none (backhoe, compactor, mixer)
--   4. Itemized Other costs on a few tasks (hauling, cylinder tests)
--   5. Recomputes each task's stored material / total cost the same way
--      the app does (lib/cost-estimate/actions.ts), so weights update
--
-- Seed data, not a schema migration — run it once in the Supabase SQL
-- editor. Only fills blanks: anything already entered (a quantity, a
-- material list, an equipment cost) is left alone, so re-running it
-- changes nothing. Rows are matched by name; a task whose name differs
-- from the lists below is simply skipped — the query at the very bottom
-- shows what every row ended up with.
--
-- Prices: typical Batangas-area retail, 2026.
-- ============================================================================

do $$
declare
  v_project_id bigint;
  v_found int;
  v_rows int;
begin
  select count(*) into v_found from public.projects where project_name = 'Project Nica';
  if v_found <> 1 then
    raise exception 'Expected exactly one project named "Project Nica", found %', v_found;
  end if;
  select id into v_project_id from public.projects where project_name = 'Project Nica';

  -- 1a. Standalone categories (no tasks under them): quantity + unit ------
  update public.estimate_categories c
     set estimated_quantity = v.qty,
         unit = v.unit
    from (values
      ('MOBILIZATION',                    1,   'lot'),
      ('CLEARING OF AREA',                150, 'sq.m'),
      ('CLEARING OF DEMOLISHED DEBRIS',   12,  'cu.m'),
      ('ENCLOSURE OF AREA',               48,  'm'),
      ('FORMWORKS & SCAFFOLDINGS',        1,   'lot')
    ) as v(name, qty, unit)
   where c.project_id = v_project_id
     and upper(trim(c.category_name)) = v.name
     and coalesce(c.estimated_quantity, 0) = 0
     and not exists (select 1 from public.estimate_tasks t where t.category_id = c.id);
  get diagnostics v_rows = row_count;
  raise notice 'Category quantities set: %', v_rows;

  -- 1b. Tasks: quantity + unit --------------------------------------------
  update public.estimate_tasks t
     set estimated_quantity = v.qty,
         unit = v.unit
    from (values
      ('Excavation',                          24,  'cu.m'),
      ('Backfilling / Filling & Compacting',  18,  'cu.m'),
      ('Concrete Footings',                   4.5, 'cu.m'),
      ('Concrete Column',                     3.2, 'cu.m'),
      ('Wall Footings',                       2.8, 'cu.m'),
      ('Concrete Beams',                      3.6, 'cu.m'),
      ('Slab on Grade',                       60,  'sq.m'),
      ('CHB Wall & Plastering',               180, 'sq.m')
    ) as v(name, qty, unit)
   where t.project_id = v_project_id
     and lower(trim(t.task_name)) = lower(v.name)
     and coalesce(t.estimated_quantity, 0) = 0;
  get diagnostics v_rows = row_count;
  raise notice 'Task quantities set: %', v_rows;

  -- 2. Material Breakdown lines — only for a task with no material cost
  --    and no material lines yet (a lump-sum task is left as it is, so
  --    nothing gets counted twice).
  --    Concrete is Class A (1:2:4): per cu.m ~9 bags cement, 0.5 cu.m
  --    sand, 1.0 cu.m gravel. CHB wall: 12.5 blocks per sq.m.
  insert into public.estimate_task_material_assignments
    (task_id, material_name, specification, planned_quantity, unit, unit_cost)
  select t.id, v.material, v.spec, v.qty, v.unit, v.unit_cost
    from public.estimate_tasks t
    join (values
      -- Concrete Beams: 3.6 cu.m
      ('Concrete Beams', 'Portland Cement',      'Type 1, 40 kg',                  33,   'bag',  280),
      ('Concrete Beams', 'Washed Sand',          'S1',                             1.8,  'cu.m', 1500),
      ('Concrete Beams', 'Crushed Gravel',       '3/4"',                           3.6,  'cu.m', 1700),
      ('Concrete Beams', 'Deformed Bar 16mm',    '6m, Grade 40 (main bars)',       24,   'pcs',  580),
      ('Concrete Beams', 'Deformed Bar 10mm',    '6m, Grade 33 (stirrups)',        30,   'pcs',  230),
      ('Concrete Beams', 'Tie Wire',             '#16 GI',                         10,   'kg',   85),
      -- Slab on Grade: 60 sq.m x 100mm = 6 cu.m
      ('Slab on Grade',  'Portland Cement',      'Type 1, 40 kg',                  54,   'bag',  280),
      ('Slab on Grade',  'Washed Sand',          'S1',                             3,    'cu.m', 1500),
      ('Slab on Grade',  'Crushed Gravel',       '3/4"',                           6,    'cu.m', 1700),
      ('Slab on Grade',  'Gravel Bedding',       'G1, 100mm thick',                6,    'cu.m', 1200),
      ('Slab on Grade',  'Deformed Bar 10mm',    '6m, Grade 33, 0.40m both ways',  45,   'pcs',  230),
      ('Slab on Grade',  'Tie Wire',             '#16 GI',                         8,    'kg',   85),
      ('Slab on Grade',  'Polyethylene Sheet',   '6 mil vapor barrier',            2,    'roll', 1250),
      -- CHB Wall & Plastering: 180 sq.m
      ('CHB Wall & Plastering', 'Concrete Hollow Block', '4" (100mm)',             2250, 'pcs',  18),
      ('CHB Wall & Plastering', 'Portland Cement',       'Type 1, 40 kg',          150,  'bag',  280),
      ('CHB Wall & Plastering', 'Washed Sand',           'S1',                     12,   'cu.m', 1500),
      ('CHB Wall & Plastering', 'Deformed Bar 10mm',     '6m, Grade 33, 0.80m O.C.', 60, 'pcs',  230),
      ('CHB Wall & Plastering', 'Tie Wire',              '#16 GI',                 10,   'kg',   85)
    ) as v(task_name, material, spec, qty, unit, unit_cost)
      on lower(trim(t.task_name)) = lower(v.task_name)
   where t.project_id = v_project_id
     and coalesce(t.material_estimate, 0) = 0
     and not exists (
       select 1 from public.estimate_task_material_assignments m where m.task_id = t.id
     );
  get diagnostics v_rows = row_count;
  raise notice 'Material lines added: %', v_rows;

  -- 3. Equipment — only where a task has none yet ------------------------
  update public.estimate_tasks t
     set equipment_estimate = v.amount
    from (values
      ('Excavation',                          30000), -- backhoe w/ operator & fuel, 2 days x 15,000
      ('Backfilling / Filling & Compacting',  6000),  -- plate compactor, 4 days x 1,500
      ('Concrete Footings',                   4600),  -- one-bagger mixer + vibrator, 2 days x 2,300
      ('Concrete Column',                     6900),  -- mixer + vibrator, 3 days
      ('Wall Footings',                       4600),  -- mixer + vibrator, 2 days
      ('Concrete Beams',                      6900),  -- mixer + vibrator, 3 days
      ('Slab on Grade',                       4600),  -- mixer + vibrator, 2 days
      ('CHB Wall & Plastering',               9000)   -- mixer, 6 days x 1,500
    ) as v(name, amount)
   where t.project_id = v_project_id
     and lower(trim(t.task_name)) = lower(v.name)
     and coalesce(t.equipment_estimate, 0) = 0;
  get diagnostics v_rows = row_count;
  raise notice 'Equipment costs set: %', v_rows;

  -- 4. Other costs, itemized — only where a task has none yet ------------
  insert into public.estimate_task_other_costs (task_id, cost_name, amount)
  select t.id, v.cost_name, v.amount
    from public.estimate_tasks t
    join (values
      ('Excavation',         'Hauling of excess soil (4 trips)', 10000),
      ('Concrete Footings',  'Concrete cylinder test',            1500),
      ('Concrete Column',    'Concrete cylinder test',            1500),
      ('Slab on Grade',      'Concrete cylinder test',            1500)
    ) as v(task_name, cost_name, amount)
      on lower(trim(t.task_name)) = lower(v.task_name)
   where t.project_id = v_project_id
     and coalesce(t.other_cost_estimate, 0) = 0
     and not exists (select 1 from public.estimate_task_other_costs o where o.task_id = t.id);
  get diagnostics v_rows = row_count;
  raise notice 'Other cost items added: %', v_rows;

  -- A task's Other is the sum of its items.
  update public.estimate_tasks t
     set other_cost_estimate = items.total
    from (
      select task_id, sum(coalesce(amount, 0)) as total
        from public.estimate_task_other_costs
       group by task_id
    ) as items
   where t.id = items.task_id
     and t.project_id = v_project_id
     and coalesce(t.other_cost_estimate, 0) = 0;

  -- 5. Stored costs, recomputed the way the app does --------------------
  -- Material (only on tasks that just got their first lines): the task's
  -- own direct line + every material line.
  update public.estimate_tasks t
     set material_estimate =
           coalesce(t.material_direct_amount,
                    coalesce(t.material_direct_quantity, 0) * coalesce(t.material_unit_cost, 0))
         + lines.total
    from (
      select task_id,
             sum(coalesce(amount, planned_quantity * unit_cost)) as total
        from public.estimate_task_material_assignments
       group by task_id
    ) as lines
   where t.id = lines.task_id
     and t.project_id = v_project_id
     and coalesce(t.material_estimate, 0) = 0;

  -- Total = labor + material + equipment + other, for every task.
  update public.estimate_tasks t
     set total_estimate_cost =
           coalesce(t.labor_estimate, 0)
         + coalesce(t.material_estimate, 0)
         + coalesce(t.equipment_estimate, 0)
         + coalesce(t.other_cost_estimate, 0)
   where t.project_id = v_project_id;
end $$;

-- What every row ended up with (a task still showing 0 / no unit had a
-- name that didn't match the lists above).
select c.category_name,
       t.task_name,
       coalesce(t.estimated_quantity, c.estimated_quantity) as estimated_quantity,
       coalesce(t.unit, c.unit) as unit,
       coalesce(t.labor_estimate, c.category_labor_estimate) as labor,
       coalesce(t.material_estimate, c.category_material_estimate) as material,
       t.equipment_estimate as equipment,
       t.other_cost_estimate as other,
       coalesce(t.total_estimate_cost,
                coalesce(c.category_labor_estimate, 0) + coalesce(c.category_material_estimate, 0)) as total,
       (select count(*) from public.estimate_task_material_assignments m where m.task_id = t.id) as material_lines
  from public.estimate_categories c
  join public.projects p on p.id = c.project_id and p.project_name = 'Project Nica'
  left join public.estimate_tasks t on t.category_id = c.id
 order by c.id, t.id;
