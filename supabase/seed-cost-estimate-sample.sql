-- ============================================================================
-- Sample Cost Estimate Breakdown data for testing — NOT a migration, just
-- a one-off script. Run `select id, project_name from public.projects;`
-- first, then paste that id into v_project_id below before running this.
--
-- Creates 3 categories / 8 tasks / 3 Other Cost Items, with
-- total_estimate_cost and weight pre-computed by hand so everything
-- (Cost Estimate Breakdown, Progress Overview's phase bars, the stat
-- cards) reads correctly the moment you load the page — no need to
-- re-save anything through the UI first.
--
--   Foundation            ₱180,000  (38.30%)
--     Concrete Footings   ₱80,000   (17.02%) — has 2 Other Cost Items
--     Rebar Installation  ₱65,000   (13.83%) — has 1 Other Cost Item
--     Excavation          ₱35,000   (7.45%)
--   Structural Framework  ₱190,000  (40.43%)
--     Steel Column Install ₱75,000  (15.96%) — has 1 Other Cost Item
--     Beam Assembly       ₱55,000   (11.70%)
--     Concrete Slab Pouring ₱60,000 (12.77%)
--   Roofing                ₱100,000 (21.27%)
--     Roof Truss Installation ₱55,000 (11.70%)
--     Roofing Membrane Application ₱45,000 (9.57%)
--   Project total: ₱470,000, weights sum to 100.00%
--
-- Safe to run more than once — it always adds a fresh set of rows (no
-- "on conflict"), so if you want a clean slate, delete the categories
-- for this project first: this cascades to their tasks and Other Cost
-- Items automatically.
--   delete from public.estimate_categories where project_id = <id>;
-- ============================================================================

do $$
declare
  v_project_id bigint := 1; -- <-- CHANGE THIS to your project's actual id
  v_cat_foundation bigint;
  v_cat_structural bigint;
  v_cat_roofing bigint;
  v_task_footings bigint;
  v_task_rebar bigint;
  v_task_steel bigint;
begin
  -- --- Foundation -------------------------------------------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Foundation', 38.30)
  returning id into v_cat_foundation;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight
  ) values (
    v_project_id, v_cat_foundation, 'Concrete Footings', 50, 'm²',
    15000, 40000, 20000, 5000, 80000, 17.02
  ) returning id into v_task_footings;

  insert into public.estimate_task_other_costs (task_id, cost_name, amount) values
    (v_task_footings, 'Permit Fee', 2000),
    (v_task_footings, 'Delivery Fee', 3000);

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight
  ) values (
    v_project_id, v_cat_foundation, 'Rebar Installation', 2000, 'kg',
    18000, 32000, 10000, 5000, 65000, 13.83
  ) returning id into v_task_rebar;

  insert into public.estimate_task_other_costs (task_id, cost_name, amount) values
    (v_task_rebar, 'Delivery Fee', 5000);

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight
  ) values (
    v_project_id, v_cat_foundation, 'Excavation', 150, 'm³',
    10000, 5000, 20000, 0, 35000, 7.45
  );

  -- --- Structural Framework ----------------------------------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Structural Framework', 40.43)
  returning id into v_cat_structural;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight
  ) values (
    v_project_id, v_cat_structural, 'Steel Column Installation', 150, 'm²',
    20000, 35000, 15000, 5000, 75000, 15.96
  ) returning id into v_task_steel;

  insert into public.estimate_task_other_costs (task_id, cost_name, amount) values
    (v_task_steel, 'Testing Fee', 5000);

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight
  ) values (
    v_project_id, v_cat_structural, 'Beam Assembly', 2000, 'kg',
    18000, 27000, 10000, 0, 55000, 11.70
  );

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight
  ) values (
    v_project_id, v_cat_structural, 'Concrete Slab Pouring', 50, 'm²',
    15000, 35000, 10000, 0, 60000, 12.77
  );

  -- --- Roofing -------------------------------------------------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Roofing', 21.27)
  returning id into v_cat_roofing;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight
  ) values (
    v_project_id, v_cat_roofing, 'Roof Truss Installation', 2000, 'kg',
    18000, 27000, 10000, 0, 55000, 11.70
  );

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight
  ) values (
    v_project_id, v_cat_roofing, 'Roofing Membrane Application', 50, 'm²',
    10000, 25000, 10000, 0, 45000, 9.57
  );
end $$;
