-- ============================================================================
-- Adds ONE new project seeded from IDR M&M's real signed Bill of
-- Materials (the "BILL OF MATERIALS" document, Items A-V) — Cost Estimate
-- Breakdown ONLY (Categories + Task Items). Does NOT touch Daily Logs,
-- Materials, Equipment, or Expenses, and does NOT delete any existing
-- project — this adds alongside whatever's already there.
--
-- ---------------------------------------------------------------------------
-- How the BOM maps onto this schema, and what's transcribed vs invented:
-- ---------------------------------------------------------------------------
-- Every BOM Division (A, B, C, ... O) becomes a Category. Every BOM
-- sub-item (G.1, G.2, ...) or single-line division becomes a Task Item.
--
-- MATERIAL ESTIMATE is transcribed from the BOM:
--   - Concrete Works (G.1-G.7) has no printed sub-item subtotal in the
--     source document, only one combined total for all of G — so each
--     task's material_estimate here is summed from its own material
--     lines by hand (qty x unit cost, self-checking). That sum came to
--     328,520 against the document's own printed G subtotal of 328,820 —
--     a 300-peso (0.09%) gap, negligible, left as-is rather than forced
--     to match.
--   - Every other itemized division (Roof, Ceiling, Painting, Tile,
--     Plumbing, Doors & Windows, Electrical) DOES print its own clear,
--     bolded Sub-total — that printed figure is used directly as the
--     one task's material_estimate, rather than re-deriving it by
--     transcribing 20-30 individual dense line items each, which is
--     both safer (the sub-total print is larger/clearer than the row
--     data) and exactly what was asked for.
--   - Earthworks (E) is the one place the printed sub-total (38,400)
--     doesn't reconcile with what's legible on its own two line items
--     (12 cu.m x 800 = 9,600; 25 cu.m x 400 = 10,000; 6 cu.m x 1,800 =
--     10,800 -> 30,400 total, an 8,000-peso / 21% gap). The self-checking
--     line-item math (30,400) is used here, not the unreconciled printed
--     subtotal — flag this one if the original document has a line this
--     couldn't account for.
--   - The flat, non-itemized divisions (Mobilization, Clearing of Area,
--     Clearing of Demolished Debris, Enclosure of Area, Power Tools,
--     the final Clearing) are single printed amounts, transcribed as-is.
--
-- LABOR, EQUIPMENT, and OTHER COST are NOT in the source BOM (it's a
-- Bill of MATERIALS — no labor/equipment breakdown by division, only one
-- unallocated project-wide "Labor Cost" total at the very bottom) — per
-- instruction, these are invented per task using typical PH
-- construction-trade proportions of that task's material cost (heavier
-- equipment share for earthworks/formwork/concrete pours, heavier labor
-- share for finishing trades), NOT derived from the document's own
-- bottom-of-page Labor Cost (310,817.15) or Total Project Cost
-- (1,223,866.15) figures — this project's own totals will legitimately
-- land higher than those two figures as a result, since it's a fuller
-- 4-component estimate instead of materials-plus-one-flat-labor-line.
--
-- planned_start_date/planned_end_date are also invented (sequenced in a
-- plausible construction order) so this project's Schedule/Gantt tab has
-- something real to show — still just estimate_tasks columns, so still
-- within "cost estimate breakdown" scope. predecessor_task_id is left
-- null throughout (out of scope for this seed).
--
-- Run manually in the Supabase SQL Editor.
-- ============================================================================

do $$
declare
  v_admin_id uuid;
  v_pm_id uuid;
  v_foreman_id uuid;
  v_project_id bigint;
  v_cat_general bigint;
  v_cat_earth bigint;
  v_cat_formworks bigint;
  v_cat_concrete bigint;
  v_cat_roof bigint;
  v_cat_ceiling bigint;
  v_cat_painting bigint;
  v_cat_tile bigint;
  v_cat_plumbing bigint;
  v_cat_doors bigint;
  v_cat_electrical bigint;
begin
  select id into v_admin_id from public.profiles where role = 'admin' order by created_at limit 1;
  select id into v_pm_id from public.profiles where role = 'project_manager' order by created_at limit 1;
  select id into v_foreman_id from public.profiles where role = 'foreman' order by created_at limit 1;

  if v_admin_id is null then
    raise exception 'No admin profile found — create an admin account first.';
  end if;
  if v_pm_id is null then
    raise exception 'No project_manager profile found — create one first (Accounts page).';
  end if;
  if v_foreman_id is null then
    raise exception 'No foreman profile found — create one first (Accounts page).';
  end if;

  -- ---- Project ----------------------------------------------------------
  insert into public.projects (
    project_name, location, status, start_date, target_end_date,
    allocated_budget, project_manager_id, foreman_id, created_by
  ) values (
    'Casa Grande Residence',
    'Lipa City, Batangas',
    'planning',
    '2026-10-01',
    '2027-03-31',
    1600000,
    v_pm_id,
    v_foreman_id,
    v_admin_id
  ) returning id into v_project_id;

  -- ======================================================================
  -- General Requirements (A, B, C, D, P, Q)
  -- ======================================================================
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'General Requirements', 12.70)
  returning id into v_cat_general;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_general, 'Mobilization', 1, 'lot',
    25000, 20000, 8000, 2000,
    55000, 3.67, '2026-10-01', '2026-10-05'
  );

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_general, 'Clearing of Area', 1, 'lot',
    12000, 5000, 6000, 0,
    23000, 1.54, '2026-10-03', '2026-10-06'
  );

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_general, 'Clearing of Demolished Debris', 1, 'lot',
    18000, 15000, 10000, 0,
    43000, 2.87, '2026-10-05', '2026-10-08'
  );

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_general, 'Enclosure of Area', 1, 'lot',
    10000, 15000, 0, 1000,
    26000, 1.74, '2026-10-06', '2026-10-10'
  );

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_general, 'Power Tools', 1, 'lot',
    0, 15000, 5000, 0,
    20000, 1.34, '2026-10-01', '2026-10-01'
  );

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_general, 'Final Site Clearing', 1, 'lot',
    8000, 10000, 5000, 0,
    23000, 1.54, '2027-03-20', '2027-03-31'
  );

  -- ======================================================================
  -- Earthworks (E)
  -- ======================================================================
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Earthworks', 5.64)
  returning id into v_cat_earth;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_earth, 'Excavation', 12, 'cu.m',
    12000, 9600, 18000, 0,
    39600, 2.65, '2026-10-08', '2026-10-14'
  );

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_earth, 'Backfilling / Filling & Compacting', 31, 'cu.m',
    14000, 20800, 10000, 0,
    44800, 2.99, '2026-10-13', '2026-10-18'
  );

  -- ======================================================================
  -- Formworks & Scaffoldings (F)
  -- ======================================================================
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Formworks & Scaffoldings', 0.77)
  returning id into v_cat_formworks;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_formworks, 'Formworks & Scaffoldings', 1, 'lot',
    6000, 2500, 3000, 0,
    11500, 0.77, '2026-10-16', '2026-10-22'
  );

  -- ======================================================================
  -- Concrete Works (G.1 - G.7; no G.5 in the source document)
  -- ======================================================================
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Concrete Works', 36.51)
  returning id into v_cat_concrete;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_concrete, 'Concrete Footings', 12, 'cu.m',
    9000, 14420, 4000, 0,
    27420, 1.83, '2026-10-20', '2026-10-27'
  );

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_concrete, 'Concrete Columns', 8, 'cu.m',
    16000, 27960, 6000, 0,
    49960, 3.34, '2026-10-25', '2026-11-03'
  );

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_concrete, 'Wall Footing', 10, 'cu.m',
    8500, 14580, 3500, 0,
    26580, 1.78, '2026-10-27', '2026-11-02'
  );

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_concrete, 'Concrete Beams', 15, 'cu.m',
    22000, 41310, 8000, 0,
    71310, 4.76, '2026-11-01', '2026-11-10'
  );

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_concrete, 'Slab on Grade', 35, 'cu.m',
    45000, 96900, 18000, 0,
    159900, 10.68, '2026-11-08', '2026-11-20'
  );

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_concrete, 'CHB Wall & Plastering', 1800, 'nos',
    70000, 133350, 8000, 0,
    211350, 14.12, '2026-11-18', '2026-12-10'
  );

  -- ======================================================================
  -- Roof & Roof Framing (H)
  -- ======================================================================
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Roof & Roof Framing', 7.22)
  returning id into v_cat_roof;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_roof, 'Roof & Roof Framing', 120, 'm2',
    35000, 63095, 10000, 0,
    108095, 7.22, '2026-12-08', '2026-12-22'
  );

  -- ======================================================================
  -- Ceiling Works (I)
  -- ======================================================================
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Ceiling Works', 0.97)
  returning id into v_cat_ceiling;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_ceiling, 'Ceiling Works', 60, 'm2',
    6000, 7500, 1000, 0,
    14500, 0.97, '2026-12-20', '2026-12-28'
  );

  -- ======================================================================
  -- Painting Works (J)
  -- ======================================================================
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Painting Works', 7.49)
  returning id into v_cat_painting;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_painting, 'Painting Works', 300, 'm2',
    40000, 70059, 2000, 0,
    112059, 7.49, '2027-02-10', '2027-02-28'
  );

  -- ======================================================================
  -- Tile Works (K)
  -- ======================================================================
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Tile Works', 2.96)
  returning id into v_cat_tile;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_tile, 'Tile Works', 170, 'm2',
    18000, 24795, 1500, 0,
    44295, 2.96, '2027-01-20', '2027-02-05'
  );

  -- ======================================================================
  -- Plumbing (L)
  -- ======================================================================
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Plumbing', 14.39)
  returning id into v_cat_plumbing;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_plumbing, 'Plumbing', 1, 'lot',
    60000, 147440, 5000, 3000,
    215440, 14.39, '2026-12-22', '2027-01-18'
  );

  -- ======================================================================
  -- Doors and Windows (M)
  -- ======================================================================
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Doors and Windows', 5.81)
  returning id into v_cat_doors;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_doors, 'Doors and Windows', 20, 'unit',
    25000, 60010, 2000, 0,
    87010, 5.81, '2027-01-25', '2027-02-10'
  );

  -- ======================================================================
  -- Electrical (O)
  -- ======================================================================
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Electrical', 5.55)
  returning id into v_cat_electrical;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_electrical, 'Electrical', 1, 'lot',
    30000, 49130, 2000, 2000,
    83130, 5.55, '2026-12-22', '2027-01-15'
  );

end $$;
