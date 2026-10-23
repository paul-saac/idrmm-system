-- ============================================================================
-- IDRMM Realistic Ongoing Project Seed (~50% Complete as of October 23, 2026)
--
-- Project: "Grand Horizon Commercial Center"
-- Location: National Highway, Brgy. Sto. Tomas, Batangas City
-- Allocated Budget: ₱4,250,000.00
-- Schedule: 2026-08-10 to 2027-01-16 (approx. 23 weeks)
-- Today Anchor: 2026-10-23 (Week 11, exactly ~52% through schedule)
--
-- Features Populated:
--  1. Project Header (ongoing, 6-day work week, PH holidays, default labor 30%)
--  2. Cost Estimate WBS (6 Categories, 14 Tasks with realistic weights, dates,
--     BOM Material Breakdown lines, itemized Other Costs, equipment cost items JSONB)
--  3. Company Team & Worker Assignments (Skilled craftsmen, rates, hourly attendance)
--  4. Saved Task Progress Tracking (Daily Progress Updates up to 2026-10-23,
--     with labor attendance, planned & unplanned material usage, itemized equipment & other costs)
--  5. Override History Logs (for progress modal history tab)
--  6. Multi-Item Material Purchases (Batches with line items, receipt quantities,
--     plus unassigned warehouse stocks for the unplanned material stock picker)
--  7. Project Materials Inventory (Available, low stock, fully consumed)
--  8. Material Requests & Line Items (Fulfilled, approved, submitted)
--  9. Equipment Assets, Project Assignments, Task Placements & Requisitions
-- 10. Project Calendar Events (Meetings, inspections, deliveries, holidays)
-- 11. Daily Logs & Surveys (For legacy log history & forecasting / EVM delay risk)
--
-- SAFE TO RE-RUN: Cleans up any prior run of this specific project without
-- touching other projects or user profiles.
-- ============================================================================

do $$
declare
  v_admin_id uuid;
  v_pm_id uuid;
  v_foreman_id uuid;
  v_project_id bigint;

  -- Categories
  v_cat_prelim bigint;
  v_cat_substructure bigint;
  v_cat_superstructure bigint;
  v_cat_masonry bigint;
  v_cat_roofing bigint;
  v_cat_finishes bigint;

  -- Tasks
  v_t_permits bigint;
  v_t_mobilization bigint;
  v_t_excavation bigint;
  v_t_footings bigint;
  v_t_foundation_pour bigint;
  v_t_columns_1f bigint;
  v_t_slab_2f bigint;
  v_t_columns_roof bigint;
  v_t_chb_perimeter bigint;
  v_t_chb_partitions bigint;
  v_t_steel_trusses bigint;
  v_t_metal_roofing bigint;
  v_t_plastering bigint;
  v_t_mep_roughins bigint;
  v_t_finishes_tile bigint;

  -- Workers
  v_w_danilo bigint;
  v_w_roberto bigint;
  v_w_nelson bigint;
  v_w_arnel bigint;
  v_w_joel bigint;
  v_w_edgardo bigint;
  v_w_rommel bigint;
  v_w_reynaldo bigint;

  -- Equipment
  v_eq_excavator bigint;
  v_eq_mixer bigint;
  v_eq_vibrator bigint;
  v_eq_scaffolding bigint;
  v_eq_welder bigint;
  v_eq_compactor bigint;

  -- Equipment Assignments
  v_ea_excavator bigint;
  v_ea_mixer bigint;
  v_ea_vibrator bigint;
  v_ea_scaffolding bigint;
  v_ea_welder bigint;

  -- Progress Entry IDs
  v_prog_id bigint;

  -- Purchase Batch UUIDs
  v_batch_1 uuid := gen_random_uuid();
  v_batch_2 uuid := gen_random_uuid();
  v_batch_3 uuid := gen_random_uuid();
  v_batch_4 uuid := gen_random_uuid();

  -- Project Material Stock IDs
  v_pm_cement bigint;
  v_pm_rebar16 bigint;
  v_pm_rebar12 bigint;
  v_pm_sand bigint;
  v_pm_gravel bigint;
  v_pm_plywood bigint;
  v_pm_chb150 bigint;
  v_pm_tiewire bigint;
  v_pm_gheet bigint;
  v_pm_floodlight bigint;

  -- Material & Equipment Request IDs
  v_mr_id bigint;
  v_er_id bigint;

  -- Daily Log IDs
  v_log_id bigint;
  v_proc_id bigint;
  v_q_accidents bigint;
  v_q_schedule_delays bigint;
  v_q_weather_delays bigint;
begin
  -- --------------------------------------------------------------------------
  -- 0. Identify Admin, PM, and Foreman profiles
  -- --------------------------------------------------------------------------
  select id into v_admin_id from public.profiles where role in ('admin', 'super_admin') order by created_at limit 1;
  select id into v_pm_id from public.profiles where role = 'project_manager' order by created_at limit 1;
  select id into v_foreman_id from public.profiles where role = 'foreman' order by created_at limit 1;

  if v_admin_id is null then
    raise exception 'No admin profile found in public.profiles. Please register an admin account first.';
  end if;
  if v_pm_id is null then v_pm_id := v_admin_id; end if;
  if v_foreman_id is null then v_foreman_id := v_admin_id; end if;

  -- Clean up previous run of this seed project if exists (cascades cleanly)
  delete from public.projects where project_name = 'Grand Horizon Commercial Center';

  -- --------------------------------------------------------------------------
  -- 1. Project Header
  -- --------------------------------------------------------------------------
  insert into public.projects (
    project_name, location, status, start_date, target_end_date,
    allocated_budget, project_manager_id, foreman_id, created_by,
    working_days, default_labor_cost_percent
  ) values (
    'Grand Horizon Commercial Center',
    'National Highway, Brgy. Sto. Tomas, Batangas City',
    'ongoing',
    '2026-08-10',
    '2027-01-16',
    4250000.00,
    v_pm_id,
    v_foreman_id,
    v_admin_id,
    '{1,2,3,4,5,6}',
    30
  ) returning id into v_project_id;

  -- --------------------------------------------------------------------------
  -- 2. Project Events & Holidays
  -- --------------------------------------------------------------------------
  insert into public.project_events (project_id, event_type, name, event_date)
  values
    (v_project_id, 'holiday', 'Ninoy Aquino Day', '2026-08-21'),
    (v_project_id, 'holiday', 'National Heroes Day', '2026-08-31'),
    (v_project_id, 'holiday', 'All Saints'' Day', '2026-11-01'),
    (v_project_id, 'holiday', 'All Souls'' Day (Special Working/Non-Working)', '2026-11-02'),
    (v_project_id, 'holiday', 'Bonifacio Day', '2026-11-30'),
    (v_project_id, 'holiday', 'Christmas Day', '2026-12-25'),
    (v_project_id, 'holiday', 'Rizal Day', '2026-12-30');

  insert into public.project_events (project_id, event_type, name, event_date, start_time, end_time)
  values
    (v_project_id, 'meeting', 'Weekly Project Coordination Meeting', '2026-10-19', '09:00:00', '10:30:00'),
    (v_project_id, 'meeting', 'Weekly Project Coordination Meeting', '2026-10-26', '09:00:00', '10:30:00');

  insert into public.project_events (project_id, event_type, name, event_date)
  values
    (v_project_id, 'inspection', 'Structural Foundation Official LGU Inspection', '2026-09-18'),
    (v_project_id, 'inspection', '2nd Floor Slab Rebar Quality Clearance Inspection', '2026-10-14'),
    (v_project_id, 'inspection', 'Upcoming Structural Steel Framing Inspection', '2026-11-06'),
    (v_project_id, 'delivery', 'Major Rebar Grade 40 Batch 2 Delivery (8 tons)', '2026-09-22'),
    (v_project_id, 'delivery', 'CHB 150mm & Portland Cement Batch Delivery', '2026-10-16'),
    (v_project_id, 'delivery', 'Structural Steel Trusses Delivery Batch', '2026-11-04');

  -- --------------------------------------------------------------------------
  -- 3. Company Team Members (Workers Roster)
  -- --------------------------------------------------------------------------
  insert into public.workers (full_name, trade, contact_number, date_hired, category, employment_type, hourly_rate, work_hours)
  values
    ('Danilo Ramos', 'Head Carpenter & Formwork Lead', '+63 917 123 4501', '2026-01-15', 'skilled', 'employee', 95.00, '{8,8,8,8,8,8,0}'),
    ('Roberto Bautista', 'Master Mason & Tile Setter', '+63 918 234 5612', '2026-02-01', 'skilled', 'employee', 95.00, '{8,8,8,8,8,8,0}'),
    ('Nelson Santos', 'Senior Steelman & Rebar Fabricator', '+63 920 345 6723', '2026-02-15', 'skilled', 'employee', 90.00, '{8,8,8,8,8,8,0}'),
    ('Arnel Mendoza', 'Mason & Plasterer', '+63 921 456 7834', '2026-03-01', 'skilled', 'employee', 85.00, '{8,8,8,8,8,8,0}'),
    ('Joel Mercado', 'Formwork Carpenter', '+63 922 567 8945', '2026-03-10', 'skilled', 'employee', 85.00, '{8,8,8,8,8,8,0}'),
    ('Edgardo Cruz', 'Master Electrician', '+63 923 678 9056', '2026-04-01', 'skilled', 'employee', 100.00, '{8,8,8,8,8,8,0}'),
    ('Rommel Garcia', 'Plumber & Pipefitter', '+63 924 789 0167', '2026-04-15', 'skilled', 'employee', 90.00, '{8,8,8,8,8,8,0}'),
    ('Reynaldo Flores', 'General Skilled Worker & Finisher', '+63 925 890 1278', '2026-05-01', 'skilled', 'employee', 80.00, '{8,8,8,8,8,8,0}')
  on conflict do nothing;

  select id into v_w_danilo from public.workers where full_name = 'Danilo Ramos' limit 1;
  select id into v_w_roberto from public.workers where full_name = 'Roberto Bautista' limit 1;
  select id into v_w_nelson from public.workers where full_name = 'Nelson Santos' limit 1;
  select id into v_w_arnel from public.workers where full_name = 'Arnel Mendoza' limit 1;
  select id into v_w_joel from public.workers where full_name = 'Joel Mercado' limit 1;
  select id into v_w_edgardo from public.workers where full_name = 'Edgardo Cruz' limit 1;
  select id into v_w_rommel from public.workers where full_name = 'Rommel Garcia' limit 1;
  select id into v_w_reynaldo from public.workers where full_name = 'Reynaldo Flores' limit 1;

  -- --------------------------------------------------------------------------
  -- 4. Equipment Catalog & Project Assignments
  -- --------------------------------------------------------------------------
  insert into public.equipment (asset_tag, name, category, description, serial_number, status, created_by)
  values
    ('EQ-EXC-002', 'CAT Mini Excavator 305E', 'Heavy Equipment', '5-ton hydraulic mini excavator with standard digging bucket', 'CAT305E-882194', 'available', v_admin_id),
    ('EQ-MIX-003', 'Boman Concrete Mixer 1-Bagger', 'Concrete Machinery', 'Heavy duty diesel engine one-bagger portable mixer', 'BM-1B-449102', 'available', v_admin_id),
    ('EQ-VIB-004', 'Robin High Frequency Vibrator 5.0HP', 'Concrete Machinery', '5.0HP gasoline poker concrete vibrator 38mm x 6m shaft', 'RB-VIB-77123', 'available', v_admin_id),
    ('EQ-SCF-008', 'Pipe Scaffolding System (40 Sets)', 'Site Staging & Safety', 'Heavy-duty tubular galvanized frame scaffolding with catwalks', 'SCF-SET-40G', 'available', v_admin_id),
    ('EQ-WLD-003', 'Powerweld Arc Welder 300A Inverter', 'Metalworking Tools', 'Portable IGBT DC inverter arc welding machine 300A', 'PW-300A-9011', 'available', v_admin_id),
    ('EQ-CMP-002', 'Mikasa Plate Compactor 90kg', 'Compaction Equipment', 'Gasoline forward vibrating plate compactor 90kg', 'MK-PC-90-552', 'available', v_admin_id)
  on conflict (asset_tag) do update set updated_at = now();

  select id into v_eq_excavator from public.equipment where asset_tag = 'EQ-EXC-002';
  select id into v_eq_mixer from public.equipment where asset_tag = 'EQ-MIX-003';
  select id into v_eq_vibrator from public.equipment where asset_tag = 'EQ-VIB-004';
  select id into v_eq_scaffolding from public.equipment where asset_tag = 'EQ-SCF-008';
  select id into v_eq_welder from public.equipment where asset_tag = 'EQ-WLD-003';
  select id into v_eq_compactor from public.equipment where asset_tag = 'EQ-CMP-002';

  -- Checkouts to this project
  -- 1) Excavator: assigned Aug 10, returned Sep 15
  insert into public.equipment_assignments (equipment_id, project_id, assigned_by, assigned_at, returned_at, notes)
  values (v_eq_excavator, v_project_id, v_admin_id, '2026-08-10 08:00:00+08', '2026-09-15 17:00:00+08', 'Used for site clearing and footing excavation, returned in good order.')
  returning id into v_ea_excavator;

  -- 2) Mixer: assigned Aug 24, still active on site
  insert into public.equipment_assignments (equipment_id, project_id, assigned_by, assigned_at, returned_at, notes)
  values (v_eq_mixer, v_project_id, v_admin_id, '2026-08-24 08:00:00+08', null, 'Active on site for continuous batching and slab works.')
  returning id into v_ea_mixer;
  update public.equipment set status = 'assigned', current_project_id = v_project_id where id = v_eq_mixer;

  -- 3) Vibrator: assigned Sep 20, still active on site
  insert into public.equipment_assignments (equipment_id, project_id, assigned_by, assigned_at, returned_at, notes)
  values (v_eq_vibrator, v_project_id, v_admin_id, '2026-09-20 08:00:00+08', null, 'Active on site for column and suspended slab pours.')
  returning id into v_ea_vibrator;
  update public.equipment set status = 'assigned', current_project_id = v_project_id where id = v_eq_vibrator;

  -- 4) Scaffolding: assigned Sep 25, still active on site
  insert into public.equipment_assignments (equipment_id, project_id, assigned_by, assigned_at, returned_at, notes)
  values (v_eq_scaffolding, v_project_id, v_admin_id, '2026-09-25 08:00:00+08', null, '40 frame sets installed for 2nd floor slab falsework and perimeter masonry.')
  returning id into v_ea_scaffolding;
  update public.equipment set status = 'assigned', current_project_id = v_project_id where id = v_eq_scaffolding;

  -- 5) Welder: assigned Oct 15, still active on site
  insert into public.equipment_assignments (equipment_id, project_id, assigned_by, assigned_at, returned_at, notes)
  values (v_eq_welder, v_project_id, v_admin_id, '2026-10-15 08:00:00+08', null, 'Active on site for rebar splice welding and truss anchor embeds.')
  returning id into v_ea_welder;
  update public.equipment set status = 'assigned', current_project_id = v_project_id where id = v_eq_welder;

  -- --------------------------------------------------------------------------
  -- 5. Cost Estimate WBS: Categories & Tasks
  -- --------------------------------------------------------------------------

  -- --------------------------------------------------------------------------
  -- CATEGORY 1: Preliminaries & General Requirements (Weight: 8.00%) - 100% DONE
  -- --------------------------------------------------------------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Preliminaries & General Requirements', 8.00)
  returning id into v_cat_prelim;

  -- Task 1.1: Building Permits, Safety Enclosure & Signages
  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date, priority,
    equipment_cost_items
  ) values (
    v_project_id, v_cat_prelim, 'Building Permits, Safety Enclosure & Signages', 1, 'lot',
    35000.00, 48000.00, 12000.00, 45000.00,
    140000.00, 3.29, '2026-08-10', '2026-08-18', 'high',
    '[{"id": 1, "costName": "Power Generator Fuel & Tools Rental", "amount": 12000.00}]'::jsonb
  ) returning id into v_t_permits;

  insert into public.estimate_task_material_assignments (task_id, material_name, specification, planned_quantity, unit, unit_cost, amount)
  values
    (v_t_permits, 'Temporary Enclosure Plain GI Sheet', 'Gauge 26, 8ft', 60, 'sheet', 390.00, 23400.00),
    (v_t_permits, 'Coco Lumber 2x3x12', 'Rough framing lumber', 350, 'bd.ft', 42.00, 14700.00),
    (v_t_permits, 'Tarpaulin Project Signboards', 'Official LGU & DOLE specs 4x8 ft', 4, 'pc', 1250.00, 5000.00),
    (v_t_permits, 'Common Wire Nails (Assorted)', '1.5", 2.5", 3"', 45, 'kg', 110.00, 4900.00);

  insert into public.estimate_task_other_costs (task_id, cost_name, quantity, unit, unit_cost, amount)
  values
    (v_t_permits, 'LGU Building Permit Processing & Filing Fee', 1, 'lot', 30000.00, 30000.00),
    (v_t_permits, 'DOLE Construction Safety & Health Program (CSHP) Approval', 1, 'lot', 15000.00, 15000.00);

  -- Task 1.2: Site Mobilization & Temporary Facilities (Bunkhouse & Storage)
  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date, priority,
    equipment_cost_items
  ) values (
    v_project_id, v_cat_prelim, 'Site Mobilization & Temporary Facilities', 1, 'lot',
    55000.00, 95000.00, 25000.00, 25000.00,
    200000.00, 4.71, '2026-08-12', '2026-08-22', 'medium',
    '[{"id": 1, "costName": "Hauling Truck & Equipment Transport", "amount": 25000.00}]'::jsonb
  ) returning id into v_t_mobilization;

  insert into public.estimate_task_material_assignments (task_id, material_name, specification, planned_quantity, unit, unit_cost, amount)
  values
    (v_t_mobilization, 'Ordinary Plywood 1/4"', 'Commercial grade', 40, 'sheet', 380.00, 15200.00),
    (v_t_mobilization, 'Coco Lumber 2x2x12 & 2x3x12', 'Rough framing', 900, 'bd.ft', 42.00, 37800.00),
    (v_t_mobilization, 'Corrugated GI Roofing Sheet', 'Gauge 26, 8ft', 35, 'sheet', 410.00, 14350.00),
    (v_t_mobilization, 'PVC Water Piping & Site Submeter Fixtures', 'Standard commercial', 1, 'lot', 12500.00, 12500.00),
    (v_t_mobilization, 'Temporary Electrical Power Board & Breakers', '60A Main Breaker panel', 1, 'lot', 15150.00, 15150.00);

  insert into public.estimate_task_other_costs (task_id, cost_name, quantity, unit, unit_cost, amount)
  values
    (v_t_mobilization, 'Meralco Temporary Construction Power Tapping Fee', 1, 'lot', 15000.00, 15000.00),
    (v_t_mobilization, 'Water Utility Temporary Line Connection Fee', 1, 'lot', 10000.00, 10000.00);

  -- --------------------------------------------------------------------------
  -- CATEGORY 2: Substructure & Foundation Works (Weight: 22.00%) - 100% DONE
  -- --------------------------------------------------------------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Substructure & Foundation Works', 22.00)
  returning id into v_cat_substructure;

  -- Task 2.1: Site Clearing, Layout & Foundation Excavation
  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date, priority,
    equipment_cost_items
  ) values (
    v_project_id, v_cat_substructure, 'Site Clearing, Layout & Foundation Excavation', 145, 'cu.m',
    55000.00, 25000.00, 75000.00, 35000.00,
    190000.00, 4.47, '2026-08-24', '2026-09-05', 'high',
    '[{"id": 1, "costName": "CAT Mini Excavator Operation & Diesel", "amount": 60000.00}, {"id": 2, "costName": "Plate Compactor Sub-base Compaction", "amount": 15000.00}]'::jsonb
  ) returning id into v_t_excavation;

  insert into public.estimate_task_material_assignments (task_id, material_name, specification, planned_quantity, unit, unit_cost, amount)
  values
    (v_t_excavation, 'Batter Board Lumber 2x2x10', 'Good lumber', 300, 'bd.ft', 44.00, 13200.00),
    (v_t_excavation, 'Nylon String #8 & Staking Pegs', 'Site layout guide', 1, 'lot', 3800.00, 3800.00),
    (v_t_excavation, 'Gravel Bedding (G-1)', 'Crushed base course', 10, 'cu.m', 800.00, 8000.00);

  insert into public.estimate_task_other_costs (task_id, cost_name, quantity, unit, unit_cost, amount)
  values
    (v_t_excavation, 'Soil Hauling & Disposal of Excess Excavated Soil', 12, 'truckload', 2500.00, 30000.00),
    (v_t_excavation, 'Soil Treatment & Anti-Termite Chemical Application', 145, 'sq.m', 34.48, 5000.00);

  -- Task 2.2: Footings & Tie Beams Reinforcement & Formworks
  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date, priority,
    equipment_cost_items
  ) values (
    v_project_id, v_cat_substructure, 'Footings & Tie Beams Reinforcement & Formworks', 85, 'l.m',
    95000.00, 245000.00, 20000.00, 15000.00,
    375000.00, 8.82, '2026-09-01', '2026-09-15', 'high',
    '[{"id": 1, "costName": "Bar Cutter & Bender Electric Rental", "amount": 20000.00}]'::jsonb
  ) returning id into v_t_footings;

  insert into public.estimate_task_material_assignments (task_id, material_name, specification, planned_quantity, unit, unit_cost, amount)
  values
    (v_t_footings, 'Deformed Steel Bar 16mm x 6m', 'Grade 40 PNS49', 240, 'pc', 485.00, 116400.00),
    (v_t_footings, 'Deformed Steel Bar 12mm x 6m', 'Grade 40 PNS49', 180, 'pc', 285.00, 51300.00),
    (v_t_footings, 'G.I. Tie Wire #16', 'Annealed black tie wire', 80, 'kg', 85.00, 6800.00),
    (v_t_footings, 'Phenolic Board 1/2" x 4'' x 8''', 'High-density film faced', 45, 'sheet', 1150.00, 51750.00),
    (v_t_footings, 'Coco Lumber Bracing 2x3x12', 'Form bracing', 400, 'bd.ft', 42.00, 16800.00),
    (v_t_footings, 'Concrete Spacer Blocks 50mm', 'Precast 3000 PSI', 200, 'pc', 9.75, 1950.00);

  insert into public.estimate_task_other_costs (task_id, cost_name, quantity, unit, unit_cost, amount)
  values
    (v_t_footings, 'Mill Test Certificates Verification & Bar Sample Tensile Testing', 1, 'lot', 15000.00, 15000.00);

  -- Task 2.3: Foundation Concrete Pouring & Curing
  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date, priority, is_milestone,
    equipment_cost_items
  ) values (
    v_project_id, v_cat_substructure, 'Foundation Concrete Pouring & Curing', 42, 'cu.m',
    75000.00, 240000.00, 35000.00, 20000.00,
    370000.00, 8.71, '2026-09-08', '2026-09-19', 'high', true,
    '[{"id": 1, "costName": "One-Bagger Concrete Mixer Fuel & Operation", "amount": 18000.00}, {"id": 2, "costName": "Robin Concrete Vibrator Unit Rental", "amount": 17000.00}]'::jsonb
  ) returning id into v_t_foundation_pour;

  insert into public.estimate_task_material_assignments (task_id, material_name, specification, planned_quantity, unit, unit_cost, amount)
  values
    (v_t_foundation_pour, 'Portland Cement Type 1', '40kg bag (Republic / Holcim)', 380, 'bag', 245.00, 93100.00),
    (v_t_foundation_pour, 'Washed Sand Aggregates', 'Clean coarse sand', 24, 'cu.m', 950.00, 22800.00),
    (v_t_foundation_pour, 'Crushed Gravel 3/4"', 'Sound washed gravel', 32, 'cu.m', 1250.00, 40000.00),
    (v_t_foundation_pour, 'Ready-Mix Concrete 3000 PSI @ 28 Days', 'Pumpcrete mix (footings bulk)', 20, 'cu.m', 4100.00, 82000.00),
    (v_t_foundation_pour, 'Curing Compound Membrane', 'Water-retention liquid spray', 2, 'pail', 1050.00, 2100.00);

  insert into public.estimate_task_other_costs (task_id, cost_name, quantity, unit, unit_cost, amount)
  values
    (v_t_foundation_pour, 'Independent Lab Concrete Cylinder Compressive Strength Test (3 sets)', 3, 'set', 4000.00, 12000.00),
    (v_t_foundation_pour, 'Concrete Pumpcrete Boom Minimum Mobilization Fee', 1, 'lot', 8000.00, 8000.00);

  -- --------------------------------------------------------------------------
  -- CATEGORY 3: Reinforced Concrete Superstructure (Weight: 30.00%) - ACTIVE (~65% done)
  -- --------------------------------------------------------------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Reinforced Concrete Superstructure', 30.00)
  returning id into v_cat_superstructure;

  -- Task 3.1: Ground to Second Floor Columns (100% DONE)
  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date, priority,
    equipment_cost_items
  ) values (
    v_project_id, v_cat_superstructure, 'Ground to Second Floor Columns', 16, 'columns',
    80000.00, 215000.00, 30000.00, 15000.00,
    340000.00, 8.00, '2026-09-21', '2026-10-06', 'high',
    '[{"id": 1, "costName": "Concrete Mixer & Vibrator Operation", "amount": 18000.00}, {"id": 2, "costName": "Column Form Clamps & Scaffolding Staging", "amount": 12000.00}]'::jsonb
  ) returning id into v_t_columns_1f;

  insert into public.estimate_task_material_assignments (task_id, material_name, specification, planned_quantity, unit, unit_cost, amount)
  values
    (v_t_columns_1f, 'Deformed Steel Bar 16mm x 6m', 'Grade 40 PNS49 main bars', 210, 'pc', 485.00, 101850.00),
    (v_t_columns_1f, 'Deformed Steel Bar 10mm x 6m', 'Grade 40 PNS49 lateral ties', 160, 'pc', 215.00, 34400.00),
    (v_t_columns_1f, 'G.I. Tie Wire #16', 'Annealed black tie wire', 50, 'kg', 85.00, 4250.00),
    (v_t_columns_1f, 'Portland Cement Type 1', '40kg bag', 190, 'bag', 245.00, 46550.00),
    (v_t_columns_1f, 'Washed Sand Aggregates', 'Clean coarse sand', 12, 'cu.m', 950.00, 11400.00),
    (v_t_columns_1f, 'Crushed Gravel 3/4"', 'Sound aggregate', 13, 'cu.m', 1250.00, 16250.00),
    (v_t_columns_1f, 'Phenolic Board 1/2" x 4'' x 8''', 'Formworks face', 20, 'sheet', 1150.00, 23000.00);

  insert into public.estimate_task_other_costs (task_id, cost_name, quantity, unit, unit_cost, amount)
  values
    (v_t_columns_1f, 'Column Concrete Compressive Test Sampling', 2, 'set', 4000.00, 8000.00),
    (v_t_columns_1f, 'Safety Netting & Staging Perimeter Wrap', 1, 'lot', 7000.00, 7000.00);

  -- Task 3.2: 2nd Floor Suspended Slab & Girders Concreting (ACTIVE ~75% DONE - RECENTLY POURED)
  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date, priority, is_milestone,
    equipment_cost_items
  ) values (
    v_project_id, v_cat_superstructure, '2nd Floor Suspended Slab & Girders Concreting', 185, 'sq.m',
    140000.00, 395000.00, 50000.00, 25000.00,
    610000.00, 14.35, '2026-10-05', '2026-10-24', 'high', true,
    '[{"id": 1, "costName": "Pumpcrete Boom Truck Daily Rate", "amount": 32000.00}, {"id": 2, "costName": "High Frequency Concrete Vibrator Units (2 sets)", "amount": 18000.00}]'::jsonb
  ) returning id into v_t_slab_2f;

  insert into public.estimate_task_material_assignments (task_id, material_name, specification, planned_quantity, unit, unit_cost, amount)
  values
    (v_t_slab_2f, 'Deformed Steel Bar 16mm x 6m', 'Grade 40 PNS49 beam mains', 260, 'pc', 485.00, 126100.00),
    (v_t_slab_2f, 'Deformed Steel Bar 12mm x 6m', 'Grade 40 PNS49 slab mat', 320, 'pc', 285.00, 91200.00),
    (v_t_slab_2f, 'Deformed Steel Bar 10mm x 6m', 'Grade 40 PNS49 stirrups', 220, 'pc', 215.00, 47300.00),
    (v_t_slab_2f, 'G.I. Tie Wire #16', 'Annealed black tie wire', 95, 'kg', 85.00, 8075.00),
    (v_t_slab_2f, 'Ready-Mix Concrete 3500 PSI @ 28 Days', 'Pumpcrete commercial slab mix', 25, 'cu.m', 4300.00, 107500.00),
    (v_t_slab_2f, 'Phenolic Board 1/2" x 4'' x 8''', 'Soffit forms', 35, 'sheet', 1150.00, 40250.00),
    (v_t_slab_2f, 'Coco Lumber Joists & Stiffeners 2x3x12', 'Soffit framing', 650, 'bd.ft', 42.00, 27300.00);

  insert into public.estimate_task_other_costs (task_id, cost_name, quantity, unit, unit_cost, amount)
  values
    (v_t_slab_2f, 'Structural Engineering Slab Deflection & Quality Inspection Fee', 1, 'lot', 15000.00, 15000.00),
    (v_t_slab_2f, 'Slab Concrete Cylinder Compressive Strength Lab Tests', 2, 'set', 5000.00, 10000.00);

  -- Task 3.3: Second Floor to Roof Beam Columns & Framing (ACTIVE ~20% DONE)
  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date, priority,
    equipment_cost_items
  ) values (
    v_project_id, v_cat_superstructure, 'Second Floor to Roof Beam Columns & Framing', 16, 'columns',
    75000.00, 195000.00, 30000.00, 25000.00,
    325000.00, 7.65, '2026-10-19', '2026-11-07', 'medium',
    '[{"id": 1, "costName": "Scaffolding Tower Staging Rental", "amount": 18000.00}, {"id": 2, "costName": "Concrete Mixer Batching", "amount": 12000.00}]'::jsonb
  ) returning id into v_t_columns_roof;

  insert into public.estimate_task_material_assignments (task_id, material_name, specification, planned_quantity, unit, unit_cost, amount)
  values
    (v_t_columns_roof, 'Deformed Steel Bar 16mm x 6m', 'Grade 40 PNS49 main bars', 180, 'pc', 485.00, 87300.00),
    (v_t_columns_roof, 'Deformed Steel Bar 10mm x 6m', 'Grade 40 lateral ties', 140, 'pc', 215.00, 30100.00),
    (v_t_columns_roof, 'Portland Cement Type 1', '40kg bag', 160, 'bag', 245.00, 39200.00),
    (v_t_columns_roof, 'Washed Sand Aggregates', 'Clean coarse sand', 10, 'cu.m', 950.00, 9500.00),
    (v_t_columns_roof, 'Crushed Gravel 3/4"', 'Graded stone', 12, 'cu.m', 1250.00, 15000.00),
    (v_t_columns_roof, 'G.I. Tie Wire #16', 'Black tie wire', 40, 'kg', 85.00, 3400.00);

  insert into public.estimate_task_other_costs (task_id, cost_name, quantity, unit, unit_cost, amount)
  values
    (v_t_columns_roof, 'Scaffolding Delivery & Erection Hauling', 1, 'lot', 15000.00, 15000.00),
    (v_t_columns_roof, 'Concrete Testing Cylinders (2 sets)', 2, 'set', 5000.00, 10000.00);

  -- --------------------------------------------------------------------------
  -- CATEGORY 4: Masonry & Wall Enclosure (Weight: 15.00%) - ACTIVE (~25% done)
  -- --------------------------------------------------------------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Masonry & Wall Enclosure', 15.00)
  returning id into v_cat_masonry;

  -- Task 4.1: Perimeter CHB 150mm Wall Laying (ACTIVE ~40% DONE)
  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date, priority,
    equipment_cost_items
  ) values (
    v_project_id, v_cat_masonry, 'Perimeter CHB 150mm Wall Laying', 340, 'sq.m',
    110000.00, 245000.00, 20000.00, 10000.00,
    385000.00, 9.06, '2026-10-15', '2026-11-14', 'medium',
    '[{"id": 1, "costName": "Masonry Mixer Batching & Tools", "amount": 12000.00}, {"id": 2, "costName": "Scaffolding Mobile Staging", "amount": 8000.00}]'::jsonb
  ) returning id into v_t_chb_perimeter;

  insert into public.estimate_task_material_assignments (task_id, material_name, specification, planned_quantity, unit, unit_cost, amount)
  values
    (v_t_chb_perimeter, 'Concrete Hollow Blocks (CHB) 150mm (6")', 'Load-bearing 700 PSI', 4200, 'pc', 24.00, 100800.00),
    (v_t_chb_perimeter, 'Portland Cement Type 1', '40kg bag (mortar & core fill)', 320, 'bag', 245.00, 78400.00),
    (v_t_chb_perimeter, 'Washed Sand Aggregates', 'Screened fine plastering sand', 28, 'cu.m', 950.00, 26600.00),
    (v_t_chb_perimeter, 'Deformed Steel Bar 10mm x 6m', 'Grade 40 wall reinforcement', 160, 'pc', 215.00, 34400.00),
    (v_t_chb_perimeter, 'G.I. Tie Wire #16', 'Wall bar ties', 40, 'kg', 85.00, 3400.00);

  insert into public.estimate_task_other_costs (task_id, cost_name, quantity, unit, unit_cost, amount)
  values
    (v_t_chb_perimeter, 'CHB Compressive Strength Testing (LGU requirement)', 2, 'set', 5000.00, 10000.00);

  -- Task 4.2: Interior 100mm CHB Partition Walls (UPCOMING 0%)
  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date, priority
  ) values (
    v_project_id, v_cat_masonry, 'Interior 100mm CHB Partition Walls', 260, 'sq.m',
    80000.00, 160000.00, 10000.00, 2500.00,
    252500.00, 5.94, '2026-11-09', '2026-11-28', 'low'
  ) returning id into v_t_chb_partitions;

  insert into public.estimate_task_material_assignments (task_id, material_name, specification, planned_quantity, unit, unit_cost, amount)
  values
    (v_t_chb_partitions, 'Concrete Hollow Blocks (CHB) 100mm (4")', 'Standard commercial non-load', 3200, 'pc', 19.50, 62400.00),
    (v_t_chb_partitions, 'Portland Cement Type 1', '40kg bag', 210, 'bag', 245.00, 51450.00),
    (v_t_chb_partitions, 'Washed Sand Aggregates', 'Screened sand', 18, 'cu.m', 950.00, 17100.00),
    (v_t_chb_partitions, 'Deformed Steel Bar 10mm x 6m', 'Grade 40 wall reinforcement', 120, 'pc', 215.00, 25800.00),
    (v_t_chb_partitions, 'G.I. Tie Wire #16', 'Tie wire', 25, 'kg', 85.00, 2125.00);

  insert into public.estimate_task_other_costs (task_id, cost_name, quantity, unit, unit_cost, amount)
  values
    (v_t_chb_partitions, 'Waste Debris Bagging & Disposal', 1, 'lot', 2500.00, 2500.00);

  -- --------------------------------------------------------------------------
  -- CATEGORY 5: Structural Steel & Metal Roofing (Weight: 13.00%) - UPCOMING 0%
  -- --------------------------------------------------------------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Structural Steel & Metal Roofing', 13.00)
  returning id into v_cat_roofing;

  -- Task 5.1: Structural Steel Roof Trusses Fabrication & Erection
  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date, priority,
    equipment_cost_items
  ) values (
    v_project_id, v_cat_roofing, 'Structural Steel Roof Trusses Fabrication & Erection', 1, 'lot',
    85000.00, 210000.00, 25000.00, 15000.00,
    335000.00, 7.88, '2026-11-09', '2026-11-28', 'high',
    '[{"id": 1, "costName": "Inverter Arc Welding Machines (2 units)", "amount": 15000.00}, {"id": 2, "costName": "Crane / Boom Truck Hoist for Trusses Erection", "amount": 10000.00}]'::jsonb
  ) returning id into v_t_steel_trusses;

  insert into public.estimate_task_material_assignments (task_id, material_name, specification, planned_quantity, unit, unit_cost, amount)
  values
    (v_t_steel_trusses, 'Angle Bar 2" x 2" x 1/4" x 6m', 'Standard structural A36', 75, 'pc', 1350.00, 101250.00),
    (v_t_steel_trusses, 'Angle Bar 1-1/2" x 1-1/2" x 3/16" x 6m', 'Web members A36', 50, 'pc', 880.00, 44000.00),
    (v_t_steel_trusses, 'C-Purlins 2" x 4" x 1.5mm x 6m', 'Galvanized cold-formed', 85, 'pc', 580.00, 49300.00),
    (v_t_steel_trusses, 'Welding Electrodes E6013 (20kg/box)', 'Specialized mild steel', 4, 'box', 2150.00, 8600.00),
    (v_t_steel_trusses, 'Red Oxide Primer & Epoxy Reducer', 'Anti-corrosion paint', 1, 'lot', 6850.00, 6850.00);

  insert into public.estimate_task_other_costs (task_id, cost_name, quantity, unit, unit_cost, amount)
  values
    (v_t_steel_trusses, 'Structural Welder Trade Certification & Third-Party Inspection', 1, 'lot', 15000.00, 15000.00);

  -- Task 5.2: Pre-painted Rib-Type Long Span Roofing & Gutters
  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date, priority
  ) values (
    v_project_id, v_cat_roofing, 'Pre-painted Rib-Type Long Span Roofing & Gutters', 220, 'sq.m',
    45000.00, 155000.00, 10000.00, 7500.00,
    217500.00, 5.12, '2026-11-23', '2026-12-08', 'medium'
  ) returning id into v_t_metal_roofing;

  insert into public.estimate_task_material_assignments (task_id, material_name, specification, planned_quantity, unit, unit_cost, amount)
  values
    (v_t_metal_roofing, 'Pre-painted Rib-Type Long Span Roofing 0.4mm', 'Baguio Green / Pacific Blue', 220, 'sq.m', 460.00, 101200.00),
    (v_t_metal_roofing, 'Double Sided Aluminum Foil Thermal Insulation 10mm', 'PE foam barrier', 220, 'sq.m', 145.00, 31900.00),
    (v_t_metal_roofing, 'Pre-painted Box Gutter 0.4mm x 8ft', 'Formed metal gutter', 16, 'pc', 650.00, 10400.00),
    (v_t_metal_roofing, 'Tekscrews 2-1/2" with Neoprene Washer', 'Self-drilling screws', 1500, 'pc', 3.50, 5250.00),
    (v_t_metal_roofing, 'Silicone Sealant Waterproofing Cartridges', 'Neutral cure UV resistant', 15, 'tube', 280.00, 4200.00);

  insert into public.estimate_task_other_costs (task_id, cost_name, quantity, unit, unit_cost, amount)
  values
    (v_t_metal_roofing, 'Roof Fall Protection Safety Harnesses & Lifeline System', 1, 'lot', 7500.00, 7500.00);

  -- --------------------------------------------------------------------------
  -- CATEGORY 6: Architectural Finishes & MEP Rough-ins (Weight: 12.00%) - UPCOMING 0%
  -- --------------------------------------------------------------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Architectural Finishes & MEP Rough-ins', 12.00)
  returning id into v_cat_finishes;

  -- Task 6.1: Cement Plastering & Skim Coating
  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date, priority
  ) values (
    v_project_id, v_cat_finishes, 'Cement Plastering & Skim Coating', 600, 'sq.m',
    85000.00, 95000.00, 15000.00, 5000.00,
    200000.00, 4.71, '2026-11-30', '2026-12-19', 'medium'
  ) returning id into v_t_plastering;

  insert into public.estimate_task_material_assignments (task_id, material_name, specification, planned_quantity, unit, unit_cost, amount)
  values
    (v_t_plastering, 'Portland Cement Type 1', '40kg bag', 220, 'bag', 245.00, 53900.00),
    (v_t_plastering, 'Fine Plastering Screened Sand', 'Fine aggregate', 20, 'cu.m', 950.00, 19000.00),
    (v_t_plastering, 'Skim Coat White Finishing Compound', '20kg bag', 45, 'bag', 420.00, 18900.00),
    (v_t_plastering, 'Plaster Bonding Agent Acrylic Additive', 'Waterproofing modifier', 2, 'pail', 1600.00, 3200.00);

  insert into public.estimate_task_other_costs (task_id, cost_name, quantity, unit, unit_cost, amount)
  values
    (v_t_plastering, 'Scaffolding Extension Platforms Rental', 1, 'lot', 5000.00, 5000.00);

  -- Task 6.2: Electrical Conduits & Plumbing Pipe Rough-ins
  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date, priority
  ) values (
    v_project_id, v_cat_finishes, 'Electrical Conduits & Plumbing Pipe Rough-ins', 1, 'lot',
    65000.00, 105000.00, 10000.00, 10000.00,
    190000.00, 4.47, '2026-12-07', '2026-12-24', 'high'
  ) returning id into v_t_mep_roughins;

  insert into public.estimate_task_material_assignments (task_id, material_name, specification, planned_quantity, unit, unit_cost, amount)
  values
    (v_t_mep_roughins, 'PVC Sanitary Pipe Series 1000 4" x 10ft', 'Standard drainage pipe', 25, 'pc', 850.00, 21250.00),
    (v_t_mep_roughins, 'PPR Hot & Cold Water Pipe PN20 1/2" x 4m', 'Polypropylene pressure pipe', 40, 'pc', 340.00, 13600.00),
    (v_t_mep_roughins, 'uPVC Electrical Conduit Pipe 1/2" x 10ft', 'Thick-wall rigid electrical', 120, 'pc', 115.00, 13800.00),
    (v_t_mep_roughins, 'THHN Copper Wire 3.5mm2 (150m roll)', 'Stranded building wire', 4, 'roll', 4850.00, 19400.00),
    (v_t_mep_roughins, 'Main Distribution Panel Board & Branches', '12 Branches NEMA 1', 2, 'unit', 7800.00, 15600.00),
    (v_t_mep_roughins, 'Assorted PVC Junction Boxes & Utility Boxes', 'Standard deep type', 1, 'lot', 8500.00, 8500.00);

  insert into public.estimate_task_other_costs (task_id, cost_name, quantity, unit, unit_cost, amount)
  values
    (v_t_mep_roughins, 'Sanitary Water Pressure Testing & Inspection Signoff', 1, 'lot', 10000.00, 10000.00);

  -- Task 6.3: Tile Works, Painting & Fixtures Installation
  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date, priority
  ) values (
    v_project_id, v_cat_finishes, 'Tile Works, Painting & Fixtures Installation', 1, 'lot',
    50000.00, 60000.00, 5000.00, 5000.00,
    120000.00, 2.82, '2026-12-18', '2027-01-16', 'low'
  ) returning id into v_t_finishes_tile;

  insert into public.estimate_task_material_assignments (task_id, material_name, specification, planned_quantity, unit, unit_cost, amount)
  values
    (v_t_finishes_tile, 'Ceramic Floor Tiles 60cm x 60cm Glazed', 'Non-skid commercial', 120, 'box', 360.00, 43200.00),
    (v_t_finishes_tile, 'Tile Adhesive Heavy Duty (25kg)', 'Polymer modified', 30, 'bag', 280.00, 8400.00),
    (v_t_finishes_tile, 'Acrylic Latex Semi-Gloss White Paint', '16L per tin', 4, 'pail', 2100.00, 8400.00);

  insert into public.estimate_task_other_costs (task_id, cost_name, quantity, unit, unit_cost, amount)
  values
    (v_t_finishes_tile, 'Final Site Punchlisting & Turnover Deep Clean', 1, 'lot', 5000.00, 5000.00);

  -- Predecessors linking
  update public.estimate_tasks set predecessor_task_id = v_t_permits where id = v_t_mobilization;
  update public.estimate_tasks set predecessor_task_id = v_t_mobilization where id = v_t_excavation;
  update public.estimate_tasks set predecessor_task_id = v_t_excavation where id = v_t_footings;
  update public.estimate_tasks set predecessor_task_id = v_t_footings where id = v_t_foundation_pour;
  update public.estimate_tasks set predecessor_task_id = v_t_foundation_pour where id = v_t_columns_1f;
  update public.estimate_tasks set predecessor_task_id = v_t_columns_1f where id = v_t_slab_2f;
  update public.estimate_tasks set predecessor_task_id = v_t_slab_2f where id = v_t_columns_roof;
  update public.estimate_tasks set predecessor_task_id = v_t_columns_1f where id = v_t_chb_perimeter;
  update public.estimate_tasks set predecessor_task_id = v_t_chb_perimeter where id = v_t_chb_partitions;
  update public.estimate_tasks set predecessor_task_id = v_t_columns_roof where id = v_t_steel_trusses;
  update public.estimate_tasks set predecessor_task_id = v_t_steel_trusses where id = v_t_metal_roofing;
  update public.estimate_tasks set predecessor_task_id = v_t_chb_partitions where id = v_t_plastering;
  update public.estimate_tasks set predecessor_task_id = v_t_chb_perimeter where id = v_t_mep_roughins;
  update public.estimate_tasks set predecessor_task_id = v_t_plastering where id = v_t_finishes_tile;

  -- --------------------------------------------------------------------------
  -- 6. Task Worker Assignments (Active Crew on Tasks)
  -- --------------------------------------------------------------------------
  insert into public.task_worker_assignments (task_id, worker_id)
  values
    (v_t_excavation, v_w_reynaldo),
    (v_t_footings, v_w_nelson),
    (v_t_footings, v_w_danilo),
    (v_t_foundation_pour, v_w_roberto),
    (v_t_foundation_pour, v_w_reynaldo),
    (v_t_columns_1f, v_w_nelson),
    (v_t_columns_1f, v_w_danilo),
    (v_t_slab_2f, v_w_danilo),
    (v_t_slab_2f, v_w_joel),
    (v_t_slab_2f, v_w_nelson),
    (v_t_slab_2f, v_w_roberto),
    (v_t_columns_roof, v_w_nelson),
    (v_t_columns_roof, v_w_danilo),
    (v_t_chb_perimeter, v_w_roberto),
    (v_t_chb_perimeter, v_w_arnel),
    (v_t_chb_perimeter, v_w_reynaldo),
    (v_t_steel_trusses, v_w_nelson),
    (v_t_mep_roughins, v_w_edgardo),
    (v_t_mep_roughins, v_w_rommel)
  on conflict do nothing;

  -- --------------------------------------------------------------------------
  -- 7. Equipment Task Placements (Active physical equipment placed on tasks)
  -- --------------------------------------------------------------------------
  insert into public.equipment_task_assignments (
    equipment_assignment_id, project_id, task_id, task_name,
    assigned_by, assigned_at, notes
  ) values
    (v_ea_mixer, v_project_id, v_t_slab_2f, '2nd Floor Suspended Slab & Girders Concreting', v_admin_id, '2026-10-06 08:00:00+08', 'Positioned at ground batching bay feeding the hoist.'),
    (v_ea_vibrator, v_project_id, v_t_slab_2f, '2nd Floor Suspended Slab & Girders Concreting', v_admin_id, '2026-10-14 08:00:00+08', 'Operating on second floor deck for beam and slab consolidation.'),
    (v_ea_scaffolding, v_project_id, v_t_chb_perimeter, 'Perimeter CHB 150mm Wall Laying', v_admin_id, '2026-10-15 08:00:00+08', 'Tower staging erected around gridlines A and D.'),
    (v_ea_welder, v_project_id, v_t_columns_roof, 'Second Floor to Roof Beam Columns & Framing', v_admin_id, '2026-10-19 08:00:00+08', 'Welding rebar splices and structural base plates on 2F level.');

  -- --------------------------------------------------------------------------
  -- 8. Multi-Item Material Purchases (Batches with full receipt tracking)
  -- --------------------------------------------------------------------------
  -- Batch 1: August 11, 2026 - Initial foundation materials
  insert into public.material_purchases (
    project_id, batch_id, line_number, purchase_date, supplier, invoice_number,
    material_name, unit, quantity, unit_price, received_quantity, price_amount, recorded_by
  ) values
    (v_project_id, v_batch_1, 1, '2026-08-11', 'Batangas Solid Steel & Aggregates Corp', 'INV-2026-0811', 'Portland Cement Type 1', 'bag', 400, 240.00, 400, 96000.00, v_admin_id),
    (v_project_id, v_batch_1, 2, '2026-08-11', 'Batangas Solid Steel & Aggregates Corp', 'INV-2026-0811', 'Washed Sand Aggregates', 'cu.m', 25, 920.00, 25, 23000.00, v_admin_id),
    (v_project_id, v_batch_1, 3, '2026-08-11', 'Batangas Solid Steel & Aggregates Corp', 'INV-2026-0811', 'Crushed Gravel 3/4"', 'cu.m', 35, 1200.00, 35, 42000.00, v_admin_id),
    (v_project_id, v_batch_1, 4, '2026-08-11', 'Batangas Solid Steel & Aggregates Corp', 'INV-2026-0811', 'Deformed Steel Bar 16mm x 6m', 'pc', 250, 480.00, 250, 120000.00, v_admin_id),
    (v_project_id, v_batch_1, 5, '2026-08-11', 'Batangas Solid Steel & Aggregates Corp', 'INV-2026-0811', 'G.I. Tie Wire #16', 'kg', 90, 80.00, 90, 7200.00, v_admin_id);

  -- Batch 2: September 05, 2026 - Superstructure Rebar & Plywood
  insert into public.material_purchases (
    project_id, batch_id, line_number, purchase_date, supplier, invoice_number,
    material_name, unit, quantity, unit_price, received_quantity, price_amount, recorded_by
  ) values
    (v_project_id, v_batch_2, 1, '2026-09-05', 'Southern Luzon Hardware Trading', 'SLH-44912', 'Deformed Steel Bar 16mm x 6m', 'pc', 260, 485.00, 260, 126100.00, v_admin_id),
    (v_project_id, v_batch_2, 2, '2026-09-05', 'Southern Luzon Hardware Trading', 'SLH-44912', 'Deformed Steel Bar 12mm x 6m', 'pc', 320, 280.00, 320, 89600.00, v_admin_id),
    (v_project_id, v_batch_2, 3, '2026-09-05', 'Southern Luzon Hardware Trading', 'SLH-44912', 'Deformed Steel Bar 10mm x 6m', 'pc', 220, 210.00, 220, 46200.00, v_admin_id),
    (v_project_id, v_batch_2, 4, '2026-09-05', 'Southern Luzon Hardware Trading', 'SLH-44912', 'Phenolic Board 1/2" x 4'' x 8''', 'sheet', 50, 1140.00, 50, 57000.00, v_admin_id),
    (v_project_id, v_batch_2, 5, '2026-09-05', 'Southern Luzon Hardware Trading', 'SLH-44912', 'Coco Lumber 2x3x12', 'bd.ft', 700, 40.00, 700, 28000.00, v_admin_id);

  -- Batch 3: October 10, 2026 - Masonry CHB & Cement
  insert into public.material_purchases (
    project_id, batch_id, line_number, purchase_date, supplier, invoice_number,
    material_name, unit, quantity, unit_price, received_quantity, price_amount, recorded_by
  ) values
    (v_project_id, v_batch_3, 1, '2026-10-10', 'Apex Block & Masonry Supply', 'ABM-1029', 'Concrete Hollow Blocks (CHB) 150mm (6")', 'pc', 2500, 23.50, 2500, 58750.00, v_admin_id),
    (v_project_id, v_batch_3, 2, '2026-10-10', 'Apex Block & Masonry Supply', 'ABM-1029', 'Portland Cement Type 1', 'bag', 200, 242.00, 200, 48400.00, v_admin_id),
    (v_project_id, v_batch_3, 3, '2026-10-10', 'Apex Block & Masonry Supply', 'ABM-1029', 'Washed Sand Aggregates', 'cu.m', 20, 930.00, 20, 18600.00, v_admin_id);

  -- Batch 4: October 18, 2026 - Warehouse General Supplies (Includes items NOT assigned to any task!)
  -- These unassigned items will populate the Unplanned Material Stock Picker Modal!
  insert into public.material_purchases (
    project_id, batch_id, line_number, purchase_date, supplier, invoice_number,
    material_name, unit, quantity, unit_price, received_quantity, price_amount, recorded_by
  ) values
    (v_project_id, v_batch_4, 1, '2026-10-18', 'CitiHardware Lipa Branch', 'CHW-88219', 'Plain GI Sheet 0.4mm', 'sheet', 40, 395.00, 40, 15800.00, v_admin_id),
    (v_project_id, v_batch_4, 2, '2026-10-18', 'CitiHardware Lipa Branch', 'CHW-88219', 'Industrial LED Floodlight 50W', 'pc', 10, 850.00, 10, 8500.00, v_admin_id),
    (v_project_id, v_batch_4, 3, '2026-10-18', 'CitiHardware Lipa Branch', 'CHW-88219', 'Nylon Rope #8 (200m spool)', 'roll', 4, 620.00, 4, 2480.00, v_admin_id),
    (v_project_id, v_batch_4, 4, '2026-10-18', 'CitiHardware Lipa Branch', 'CHW-88219', 'Heavy-Duty Extension Cord 30m with Reel', 'set', 3, 1450.00, 3, 4350.00, v_admin_id),
    (v_project_id, v_batch_4, 5, '2026-10-18', 'CitiHardware Lipa Branch', 'CHW-88219', 'Rubber Safety Boots Steel Toe', 'pair', 12, 450.00, 12, 5400.00, v_admin_id);

  -- --------------------------------------------------------------------------
  -- 9. Project Materials Inventory (Stock Tracking Table)
  -- --------------------------------------------------------------------------
  insert into public.project_materials (
    project_id, material_code, material_name, specification, quantity, unit, status, recorded_by
  ) values
    (v_project_id, 'MAT-CEM-01', 'Portland Cement Type 1', '40kg bag (Republic / Holcim)', 280, 'bag', 'available', v_admin_id)
    returning id into v_pm_cement;

  insert into public.project_materials (
    project_id, material_code, material_name, specification, quantity, unit, status, recorded_by
  ) values
    (v_project_id, 'MAT-STL-16', 'Deformed Steel Bar 16mm x 6m', 'Grade 40 PNS49', 85, 'pc', 'available', v_admin_id)
    returning id into v_pm_rebar16;

  insert into public.project_materials (
    project_id, material_code, material_name, specification, quantity, unit, status, recorded_by
  ) values
    (v_project_id, 'MAT-STL-12', 'Deformed Steel Bar 12mm x 6m', 'Grade 40 PNS49', 110, 'pc', 'available', v_admin_id)
    returning id into v_pm_rebar12;

  insert into public.project_materials (
    project_id, material_code, material_name, specification, quantity, unit, status, recorded_by
  ) values
    (v_project_id, 'MAT-AGG-SND', 'Washed Sand Aggregates', 'Clean coarse sand', 14, 'cu.m', 'available', v_admin_id)
    returning id into v_pm_sand;

  insert into public.project_materials (
    project_id, material_code, material_name, specification, quantity, unit, status, recorded_by
  ) values
    (v_project_id, 'MAT-AGG-GRV', 'Crushed Gravel 3/4"', 'Sound aggregate', 8, 'cu.m', 'low_stock', v_admin_id)
    returning id into v_pm_gravel;

  insert into public.project_materials (
    project_id, material_code, material_name, specification, quantity, unit, status, recorded_by
  ) values
    (v_project_id, 'MAT-WOD-PLY', 'Phenolic Board 1/2" x 4'' x 8''', 'High-density film faced', 18, 'sheet', 'low_stock', v_admin_id)
    returning id into v_pm_plywood;

  insert into public.project_materials (
    project_id, material_code, material_name, specification, quantity, unit, status, recorded_by
  ) values
    (v_project_id, 'MAT-BLK-150', 'Concrete Hollow Blocks (CHB) 150mm (6")', 'Load-bearing 700 PSI', 1450, 'pc', 'available', v_admin_id)
    returning id into v_pm_chb150;

  insert into public.project_materials (
    project_id, material_code, material_name, specification, quantity, unit, status, recorded_by
  ) values
    (v_project_id, 'MAT-STL-TIE', 'G.I. Tie Wire #16', 'Annealed black tie wire', 12, 'kg', 'low_stock', v_admin_id)
    returning id into v_pm_tiewire;

  insert into public.project_materials (
    project_id, material_code, material_name, specification, quantity, unit, status, recorded_by
  ) values
    (v_project_id, 'MAT-GEN-SHT', 'Plain GI Sheet 0.4mm', 'Warehouse stock - 8ft length', 40, 'sheet', 'available', v_admin_id)
    returning id into v_pm_gheet;

  insert into public.project_materials (
    project_id, material_code, material_name, specification, quantity, unit, status, recorded_by
  ) values
    (v_project_id, 'MAT-GEN-LED', 'Industrial LED Floodlight 50W', 'Warehouse staging light', 10, 'pc', 'available', v_admin_id)
    returning id into v_pm_floodlight;

  -- --------------------------------------------------------------------------
  -- 10. Saved Task Progress Tracking (Daily Progress Updates up to 2026-10-23)
  -- --------------------------------------------------------------------------

  -- ---------------------------------------------------------
  -- Task 2.1 (Excavation) - Completed on 2026-09-04
  -- ---------------------------------------------------------
  insert into public.task_progress_entries (
    task_id, entry_date, quantity_completed, labor_cost, material_cost, equipment_cost, other_cost,
    recorded_by, remarks
  ) values (
    v_t_excavation, '2026-09-04', 145.0, 52000.00, 0, 72000.00, 32000.00,
    v_foreman_id, 'Final soil excavation and trench trimming completed. Ready for footing layout.'
  ) returning id into v_prog_id;

  insert into public.task_progress_attendance (progress_entry_id, worker_id, worker_name, hours, hourly_rate)
  values
    (v_prog_id, v_w_reynaldo, 'Reynaldo Flores', 8, 80.00);

  insert into public.task_progress_material_entries (progress_entry_id, material_name, unit, quantity_used, unit_cost)
  values
    (v_prog_id, 'Batter Board Lumber 2x2x10', 'bd.ft', 300, null),
    (v_prog_id, 'Nylon String #8 & Staking Pegs', 'lot', 1, null),
    (v_prog_id, 'Gravel Bedding (G-1)', 'cu.m', 10, null);

  insert into public.task_progress_equipment_cost_entries (progress_entry_id, cost_name, amount, unplanned)
  values
    (v_prog_id, 'CAT Mini Excavator Operation & Diesel', 58000.00, false),
    (v_prog_id, 'Plate Compactor Sub-base Compaction', 14000.00, false);

  insert into public.task_progress_other_cost_entries (progress_entry_id, cost_name, amount, unplanned)
  values
    (v_prog_id, 'Soil Hauling & Disposal of Excess Excavated Soil', 27000.00, false),
    (v_prog_id, 'Soil Treatment & Anti-Termite Chemical Application', 5000.00, false);

  insert into public.progress_override_logs (
    project_id, task_id, entry_date, action, quantity_completed,
    labor_cost, material_cost, equipment_cost, other_cost,
    materials_used, attendance, equipment_costs, other_costs, saved_by, saved_by_name
  ) values (
    v_project_id, v_t_excavation, '2026-09-04', 'saved', 145.0,
    52000.00, 0, 72000.00, 32000.00,
    '[{"name": "Batter Board Lumber 2x2x10", "quantity": 300, "unit": "bd.ft"}, {"name": "Gravel Bedding (G-1)", "quantity": 10, "unit": "cu.m"}]'::jsonb,
    '[{"hours": 8, "worker_name": "Reynaldo Flores", "hourly_rate": 80.00}]'::jsonb,
    '[{"name": "CAT Mini Excavator Operation & Diesel", "amount": 58000.00, "unplanned": false}]'::jsonb,
    '[{"name": "Soil Hauling & Disposal of Excess Excavated Soil", "amount": 27000.00, "unplanned": false}]'::jsonb,
    v_foreman_id, 'Site Foreman'
  );

  -- ---------------------------------------------------------
  -- Task 2.3 (Foundation Concrete Pouring) - Completed on 2026-09-18
  -- ---------------------------------------------------------
  insert into public.task_progress_entries (
    task_id, entry_date, quantity_completed, labor_cost, material_cost, equipment_cost, other_cost,
    recorded_by, remarks
  ) values (
    v_t_foundation_pour, '2026-09-18', 42.0, 72000.00, 0, 34000.00, 19500.00,
    v_foreman_id, 'Full foundation footing and tie beam pour passed official engineering inspection.'
  ) returning id into v_prog_id;

  insert into public.task_progress_attendance (progress_entry_id, worker_id, worker_name, hours, hourly_rate)
  values
    (v_prog_id, v_w_roberto, 'Roberto Bautista', 8, 95.00),
    (v_prog_id, v_w_reynaldo, 'Reynaldo Flores', 8, 80.00);

  insert into public.task_progress_material_entries (progress_entry_id, material_name, unit, quantity_used, unit_cost)
  values
    (v_prog_id, 'Portland Cement Type 1', 'bag', 380, null),
    (v_prog_id, 'Washed Sand Aggregates', 'cu.m', 24, null),
    (v_prog_id, 'Crushed Gravel 3/4"', 'cu.m', 32, null),
    (v_prog_id, 'Ready-Mix Concrete 3000 PSI @ 28 Days', 'cu.m', 20, null);

  insert into public.task_progress_equipment_cost_entries (progress_entry_id, cost_name, amount, unplanned)
  values
    (v_prog_id, 'One-Bagger Concrete Mixer Fuel & Operation', 17500.00, false),
    (v_prog_id, 'Robin Concrete Vibrator Unit Rental', 16500.00, false);

  insert into public.task_progress_other_cost_entries (progress_entry_id, cost_name, amount, unplanned)
  values
    (v_prog_id, 'Independent Lab Concrete Cylinder Compressive Strength Test (3 sets)', 12000.00, false),
    (v_prog_id, 'Concrete Pumpcrete Boom Minimum Mobilization Fee', 7500.00, false);

  -- ---------------------------------------------------------
  -- Task 3.1 (1F Columns) - Completed on 2026-10-05
  -- ---------------------------------------------------------
  insert into public.task_progress_entries (
    task_id, entry_date, quantity_completed, labor_cost, material_cost, equipment_cost, other_cost,
    recorded_by, remarks
  ) values (
    v_t_columns_1f, '2026-10-05', 16.0, 78000.00, 0, 28500.00, 14000.00,
    v_foreman_id, 'All 16 columns ground to second floor stripped and checked. Excellent finish.'
  ) returning id into v_prog_id;

  insert into public.task_progress_attendance (progress_entry_id, worker_id, worker_name, hours, hourly_rate)
  values
    (v_prog_id, v_w_nelson, 'Nelson Santos', 8, 90.00),
    (v_prog_id, v_w_danilo, 'Danilo Ramos', 8, 95.00);

  insert into public.task_progress_material_entries (progress_entry_id, material_name, unit, quantity_used, unit_cost)
  values
    (v_prog_id, 'Deformed Steel Bar 16mm x 6m', 'pc', 210, null),
    (v_prog_id, 'Deformed Steel Bar 10mm x 6m', 'pc', 160, null),
    (v_prog_id, 'Portland Cement Type 1', 'bag', 190, null),
    (v_prog_id, 'Phenolic Board 1/2" x 4'' x 8''', 'sheet', 20, null);

  -- ---------------------------------------------------------
  -- Task 3.2 (2F Suspended Slab & Girders) - Active Today (~75% complete)
  -- Overridden with today's date: 2026-10-23
  -- Includes UNPLANNED Material, UNPLANNED Equipment & UNPLANNED Other Cost!
  -- ---------------------------------------------------------
  insert into public.task_progress_entries (
    task_id, entry_date, quantity_completed, labor_cost, material_cost, equipment_cost, other_cost,
    recorded_by, remarks
  ) values (
    v_t_slab_2f, '2026-10-23', 140.0, 3000.00, 0, 34500.00, 18500.00,
    v_foreman_id, 'Major slab pour achieved. Concrete curing blankets installed and continuous water wetting initiated.'
  ) returning id into v_prog_id;

  -- 4 workers present today on the slab
  insert into public.task_progress_attendance (progress_entry_id, worker_id, worker_name, hours, hourly_rate)
  values
    (v_prog_id, v_w_danilo, 'Danilo Ramos', 8, 95.00),
    (v_prog_id, v_w_joel, 'Joel Mercado', 8, 85.00),
    (v_prog_id, v_w_nelson, 'Nelson Santos', 8, 90.00),
    (v_prog_id, v_w_roberto, 'Roberto Bautista', 8, 95.00);

  -- Materials used today: planned + unplanned items!
  insert into public.task_progress_material_entries (progress_entry_id, material_name, unit, quantity_used, unit_cost)
  values
    (v_prog_id, 'Deformed Steel Bar 16mm x 6m', 'pc', 240, null),
    (v_prog_id, 'Deformed Steel Bar 12mm x 6m', 'pc', 300, null),
    (v_prog_id, 'Ready-Mix Concrete 3500 PSI @ 28 Days', 'cu.m', 25, null),
    (v_prog_id, 'G.I. Tie Wire #16', 'kg', 85, null),
    -- UNPLANNED MATERIAL (Notice unit_cost is NOT null):
    (v_prog_id, 'Rapid Hardening Concrete Accelerator Additive', 'gallon', 4, 850.00),
    (v_prog_id, 'Heavy-Duty Plastic Curing Tarpaulin (6m x 10m)', 'roll', 2, 1200.00);

  -- Equipment costs: planned items + unplanned item
  insert into public.task_progress_equipment_cost_entries (progress_entry_id, cost_name, amount, unplanned)
  values
    (v_prog_id, 'Pumpcrete Boom Truck Daily Rate', 32000.00, false),
    -- UNPLANNED EQUIPMENT COST:
    (v_prog_id, 'Emergency Vibrator Flexible Shaft Replacement', 2500.00, true);

  -- Other costs: planned item + unplanned item
  insert into public.task_progress_other_cost_entries (progress_entry_id, cost_name, amount, unplanned)
  values
    (v_prog_id, 'Structural Engineering Slab Deflection & Quality Inspection Fee', 15000.00, false),
    -- UNPLANNED OTHER COST:
    (v_prog_id, 'Nighttime Pour Concrete Crew Overtime Meal Allowance', 3500.00, true);

  insert into public.progress_override_logs (
    project_id, task_id, entry_date, action, quantity_completed,
    labor_cost, material_cost, equipment_cost, other_cost,
    materials_used, attendance, equipment_costs, other_costs, saved_by, saved_by_name
  ) values (
    v_project_id, v_t_slab_2f, '2026-10-23', 'saved', 140.0,
    2920.00, 0, 34500.00, 18500.00,
    '[{"name": "Deformed Steel Bar 16mm x 6m", "quantity": 240, "unit": "pc"}, {"name": "Ready-Mix Concrete 3500 PSI @ 28 Days", "quantity": 25, "unit": "cu.m"}, {"name": "Rapid Hardening Concrete Accelerator Additive", "quantity": 4, "unit": "gallon", "unit_cost": 850.00}]'::jsonb,
    '[{"hours": 8, "worker_name": "Danilo Ramos", "hourly_rate": 95.00}, {"hours": 8, "worker_name": "Joel Mercado", "hourly_rate": 85.00}, {"hours": 8, "worker_name": "Nelson Santos", "hourly_rate": 90.00}, {"hours": 8, "worker_name": "Roberto Bautista", "hourly_rate": 95.00}]'::jsonb,
    '[{"name": "Pumpcrete Boom Truck Daily Rate", "amount": 32000.00, "unplanned": false}, {"name": "Emergency Vibrator Flexible Shaft Replacement", "amount": 2500.00, "unplanned": true}]'::jsonb,
    '[{"name": "Structural Engineering Slab Deflection & Quality Inspection Fee", "amount": 15000.00, "unplanned": false}, {"name": "Nighttime Pour Concrete Crew Overtime Meal Allowance", "amount": 3500.00, "unplanned": true}]'::jsonb,
    v_foreman_id, 'Site Foreman'
  );

  -- ---------------------------------------------------------
  -- Task 4.1 (Perimeter CHB 150mm) - Active (~40% complete)
  -- Overridden with entry date: 2026-10-22
  -- ---------------------------------------------------------
  insert into public.task_progress_entries (
    task_id, entry_date, quantity_completed, labor_cost, material_cost, equipment_cost, other_cost,
    recorded_by, remarks
  ) values (
    v_t_chb_perimeter, '2026-10-22', 135.0, 1360.00, 0, 8000.00, 5000.00,
    v_foreman_id, 'Ground floor perimeter masonry reaching lintel beam height.'
  ) returning id into v_prog_id;

  insert into public.task_progress_attendance (progress_entry_id, worker_id, worker_name, hours, hourly_rate)
  values
    (v_prog_id, v_w_arnel, 'Arnel Mendoza', 8, 85.00),
    (v_prog_id, v_w_reynaldo, 'Reynaldo Flores', 8, 80.00);

  insert into public.task_progress_material_entries (progress_entry_id, material_name, unit, quantity_used, unit_cost)
  values
    (v_prog_id, 'Concrete Hollow Blocks (CHB) 150mm (6")', 'pc', 1650, null),
    (v_prog_id, 'Portland Cement Type 1', 'bag', 120, null),
    (v_prog_id, 'Washed Sand Aggregates', 'cu.m', 10, null),
    (v_prog_id, 'Deformed Steel Bar 10mm x 6m', 'pc', 65, null);

  insert into public.task_progress_equipment_cost_entries (progress_entry_id, cost_name, amount, unplanned)
  values
    (v_prog_id, 'Scaffolding Mobile Staging', 8000.00, false);

  insert into public.task_progress_other_cost_entries (progress_entry_id, cost_name, amount, unplanned)
  values
    (v_prog_id, 'CHB Compressive Strength Testing (LGU requirement)', 5000.00, false);

  -- --------------------------------------------------------------------------
  -- 11. Material Requests & Line Items
  -- --------------------------------------------------------------------------
  -- Request 1: Foundation Steel & Cement - Fulfilled
  insert into public.material_requests (
    project_id, mr_no, requested_by, request_date, date_required, priority, remarks, status, approved_by, approved_at
  ) values (
    v_project_id, 'MR-2026-001', v_foreman_id, '2026-08-11 08:30:00+08', '2026-08-15', 'routine',
    'Initial batch of Grade 40 rebar and Portland cement for footing foundation works.', 'fulfilled', v_admin_id, '2026-08-11 11:00:00+08'
  ) returning id into v_mr_id;

  insert into public.material_request_items (material_request_id, material_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values
    (v_mr_id, 'Portland Cement Type 1', '40kg bag', 400, 'bag', 'Footings & tie beams', 400),
    (v_mr_id, 'Deformed Steel Bar 16mm x 6m', 'Grade 40 PNS49', 240, 'pc', 'Footings reinforcement', 240),
    (v_mr_id, 'G.I. Tie Wire #16', 'Annealed black', 80, 'kg', 'Footing steel fixing', 80);

  -- Request 2: Superstructure Suspended Slab Materials - Fulfilled
  insert into public.material_requests (
    project_id, mr_no, requested_by, request_date, date_required, priority, remarks, status, approved_by, approved_at
  ) values (
    v_project_id, 'MR-2026-002', v_foreman_id, '2026-09-28 09:15:00+08', '2026-10-04', 'urgent',
    'Second floor deck slab rebar, joists lumber and phenolic forms.', 'fulfilled', v_admin_id, '2026-09-28 14:00:00+08'
  ) returning id into v_mr_id;

  insert into public.material_request_items (material_request_id, material_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values
    (v_mr_id, 'Deformed Steel Bar 16mm x 6m', 'Grade 40 PNS49', 260, 'pc', '2F girder main reinforcement', 260),
    (v_mr_id, 'Deformed Steel Bar 12mm x 6m', 'Grade 40 PNS49', 320, 'pc', '2F slab top/bottom matting', 320),
    (v_mr_id, 'Phenolic Board 1/2" x 4'' x 8''', 'High-density film faced', 35, 'sheet', 'Slab soffit falsework', 35);

  -- Request 3: Masonry Block Supply - Approved
  insert into public.material_requests (
    project_id, mr_no, requested_by, request_date, date_required, priority, remarks, status, approved_by, approved_at
  ) values (
    v_project_id, 'MR-2026-003', v_foreman_id, '2026-10-14 10:00:00+08', '2026-10-20', 'routine',
    'Masonry concrete hollow blocks and mortar cement for second floor and perimeter.', 'approved', v_admin_id, '2026-10-15 09:30:00+08'
  ) returning id into v_mr_id;

  insert into public.material_request_items (material_request_id, material_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values
    (v_mr_id, 'Concrete Hollow Blocks (CHB) 150mm (6")', 'Load-bearing 700 PSI', 2000, 'pc', 'Perimeter wall continuation', 0),
    (v_mr_id, 'Portland Cement Type 1', '40kg bag', 150, 'bag', 'CHB mortar and core filling', 0);

  -- Request 4: Upcoming Electrical Conduits & Plumbing - Submitted
  insert into public.material_requests (
    project_id, mr_no, requested_by, request_date, date_required, priority, remarks, status
  ) values (
    v_project_id, 'MR-2026-004', v_foreman_id, '2026-10-22 16:30:00+08', '2026-11-05', 'routine',
    'Advance procurement for upcoming MEP rough-in before plastering works commence.', 'submitted'
  ) returning id into v_mr_id;

  insert into public.material_request_items (material_request_id, material_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values
    (v_mr_id, 'uPVC Electrical Conduit Pipe 1/2" x 10ft', 'Rigid conduit', 120, 'pc', 'Lighting and power rough-ins', 0),
    (v_mr_id, 'PVC Sanitary Pipe Series 1000 4" x 10ft', 'Standard drainage', 25, 'pc', 'Main soil stacks', 0);

  -- --------------------------------------------------------------------------
  -- 12. Equipment Requisitions
  -- --------------------------------------------------------------------------
  -- ER-001: Foundation excavation backhoe - Fulfilled
  insert into public.equipment_requisitions (
    project_id, er_no, requested_by, request_date, date_required, priority, remarks, status, approved_by, approved_at
  ) values (
    v_project_id, 'ER-2026-001', v_foreman_id, '2026-08-11 09:00:00+08', '2026-08-18', 'urgent',
    'Mini excavator required for deep trench and column footing excavations.', 'fulfilled', v_admin_id, '2026-08-11 14:00:00+08'
  ) returning id into v_er_id;

  insert into public.equipment_requisition_items (equipment_request_id, equipment_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values
    (v_er_id, 'CAT Mini Excavator 305E', '5-ton hydraulic bucket excavator', 1, 'unit', 'Foundation excavation', 1);

  -- ER-002: Suspended slab staging & scaffolding - Approved
  insert into public.equipment_requisitions (
    project_id, er_no, requested_by, request_date, date_required, priority, remarks, status, approved_by, approved_at
  ) values (
    v_project_id, 'ER-2026-002', v_foreman_id, '2026-09-20 11:00:00+08', '2026-09-25', 'routine',
    'Pipe scaffolding system for second floor elevated slab falsework support.', 'approved', v_admin_id, '2026-09-21 08:30:00+08'
  ) returning id into v_er_id;

  insert into public.equipment_requisition_items (equipment_request_id, equipment_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values
    (v_er_id, 'Pipe Scaffolding System (40 Sets)', 'Galvanized tubular steel frames with braces and catwalks', 1, 'set', 'Suspended slab shoring & perimeter safety', 0);

  -- ER-003: Roof truss welding machine - Submitted
  insert into public.equipment_requisitions (
    project_id, er_no, requested_by, request_date, date_required, priority, remarks, status
  ) values (
    v_project_id, 'ER-2026-003', v_foreman_id, '2026-10-21 14:00:00+08', '2026-11-02', 'routine',
    'Inverter welding unit for structural steel truss fabrication on site.', 'submitted'
  ) returning id into v_er_id;

  insert into public.equipment_requisition_items (equipment_request_id, equipment_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values
    (v_er_id, 'Powerweld Arc Welder 300A Inverter', 'Heavy-duty 300A DC inverter with 10m welding cables', 1, 'unit', 'Structural steel roof trusses fabrication', 0);

  -- --------------------------------------------------------------------------
  -- 13. Daily Logs & Surveys (For legacy log history & EVM / delay-risk forecasting)
  -- --------------------------------------------------------------------------
  -- Insert project survey questions (Standard default set)
  insert into public.daily_log_survey_questions (project_id, question_text, is_required, sort_order, affects_delay_risk)
  values (v_project_id, 'Any accidents on site today?', true, 0, false)
  returning id into v_q_accidents;

  insert into public.daily_log_survey_questions (project_id, question_text, is_required, sort_order, affects_delay_risk)
  values (v_project_id, 'Any schedule delays occur?', true, 1, true)
  returning id into v_q_schedule_delays;

  insert into public.daily_log_survey_questions (project_id, question_text, is_required, sort_order, affects_delay_risk)
  values (v_project_id, 'Any weather delays occur?', true, 2, true)
  returning id into v_q_weather_delays;

  -- Log 1: August 28, 2026 (Foundation excavation) - Approved
  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-08-28', 'approved', v_admin_id, '2026-08-29 08:30:00+08')
  returning id into v_log_id;

  if v_q_accidents is not null then
    insert into public.daily_log_survey_answers (daily_log_id, question_id, occurred, notes)
    values (v_log_id, v_q_accidents, false, 'No safety incidents or lost-time injuries reported.');
  end if;
  if v_q_weather_delays is not null then
    insert into public.daily_log_survey_answers (daily_log_id, question_id, occurred, notes)
    values (v_log_id, v_q_weather_delays, false, 'Clear sunny skies throughout the workday.');
  end if;

  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_substructure, v_t_excavation, 25, 'cu.m', 'Excavation of Footings F1 to F4 using mini excavator');

  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values
    (v_log_id, 'Excavator Operator', 1, 1200.00),
    (v_log_id, 'Skilled Laborer', 4, 750.00);

  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_pm_gravel, 'available', 'Spread 2 cu.m gravel bed under footings F1-F4');

  insert into public.daily_log_expense_items (daily_log_id, expense_category, amount, description)
  values (v_log_id, 'Permits & Licenses', 15000.00, 'LGU engineering site inspection & excavation clearance fee');

  insert into public.daily_log_equipment_acquisition (
    daily_log_id, equipment_request_id, equipment_name, specification, quantity, acquisition_type, amount, remarks
  ) values (
    v_log_id, v_er_id, 'CAT Mini Excavator 305E', '5-ton hydraulic bucket excavator', 1, 'rental', 60000.00, 'Excavator mobilized for site excavation'
  );

  -- Log 2: September 15, 2026 (Footing rebar inspection) - Approved
  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-09-15', 'approved', v_admin_id, '2026-09-16 09:00:00+08')
  returning id into v_log_id;

  if v_q_accidents is not null then
    insert into public.daily_log_survey_answers (daily_log_id, question_id, occurred, notes)
    values (v_log_id, v_q_accidents, false, 'Zero accidents.');
  end if;
  if v_q_schedule_delays is not null then
    insert into public.daily_log_survey_answers (daily_log_id, question_id, occurred, notes)
    values (v_log_id, v_q_schedule_delays, false, 'Work progressing ahead of target dates.');
  end if;

  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_substructure, v_t_footings, 15, 'l.m', 'Rebar fabrication and spacer block positioning for tie beams');

  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values
    (v_log_id, 'Head Steelman', 1, 950.00),
    (v_log_id, 'Rebar Fitter', 3, 750.00);

  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values
    (v_log_id, v_pm_rebar16, 'available', 'Cut and tied 45 pcs 16mm rebar'),
    (v_log_id, v_pm_tiewire, 'available', 'Used 15 kg tie wire');

  insert into public.daily_log_material_procurement (daily_log_id, procurement_type, supplier_name)
  values (v_log_id, 'direct_purchase', 'Batangas Solid Steel & Aggregates Corp')
  returning id into v_proc_id;

  insert into public.daily_log_material_procurement_items (procurement_id, material_name, specification, quantity, unit, cost)
  values (v_proc_id, 'CWN Nails 2.5" & Tie Wire #16', 'Per site requisition', 50, 'kg', 4250.00);

  -- Log 3: October 03, 2026 (Heavy Rain / Weather delay) - Approved
  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-10-03', 'approved', v_admin_id, '2026-10-04 10:15:00+08')
  returning id into v_log_id;

  if v_q_accidents is not null then
    insert into public.daily_log_survey_answers (daily_log_id, question_id, occurred, notes)
    values (v_log_id, v_q_accidents, false, 'All crew safe.');
  end if;
  if v_q_weather_delays is not null then
    insert into public.daily_log_survey_answers (daily_log_id, question_id, occurred, notes)
    values (v_log_id, v_q_weather_delays, true, 'Heavy afternoon monsoon rains forced concrete mixer operations to pause at 1:30 PM.');
  end if;

  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_superstructure, v_t_columns_1f, 3, 'columns', 'Column forms reinforcement and bracing prior to rain stop');

  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values
    (v_log_id, 'Lead Carpenter', 1, 900.00),
    (v_log_id, 'Carpenter Helper', 2, 650.00);

  -- Log 4: October 20, 2026 (Slab Preparation & Deck inspection) - Approved
  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-10-20', 'approved', v_admin_id, '2026-10-21 08:45:00+08')
  returning id into v_log_id;

  if v_q_accidents is not null then
    insert into public.daily_log_survey_answers (daily_log_id, question_id, occurred, notes)
    values (v_log_id, v_q_accidents, false, 'Clean safety record.');
  end if;

  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values
    (v_log_id, v_cat_superstructure, v_t_slab_2f, 45, 'sq.m', 'Falsework check and bottom mat rebar placement for second floor'),
    (v_log_id, v_cat_masonry, v_t_chb_perimeter, 20, 'sq.m', 'Ground level south wall CHB laying');

  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values
    (v_log_id, 'Formwork Carpenter', 3, 850.00),
    (v_log_id, 'Steelman', 2, 850.00),
    (v_log_id, 'Mason', 2, 800.00);

  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values
    (v_log_id, v_pm_rebar12, 'available', 'Installed 65 pcs 12mm rebar in slab mat'),
    (v_log_id, v_pm_chb150, 'available', 'Laid 250 pcs CHB 150mm with mortar');

  insert into public.daily_log_expense_items (daily_log_id, expense_category, amount, description)
  values (v_log_id, 'Testing & Inspection', 8000.00, 'Structural slab reinforcement verification and deflection test report');

  -- Log 5: October 23, 2026 (Today's Active Log) - Pending Review
  insert into public.daily_logs (project_id, submitted_by, log_date, status)
  values (v_project_id, v_foreman_id, '2026-10-23', 'pending')
  returning id into v_log_id;

  if v_q_accidents is not null then
    insert into public.daily_log_survey_answers (daily_log_id, question_id, occurred, notes)
    values (v_log_id, v_q_accidents, false, 'Normal operations, zero safety incidents.');
  end if;
  if v_q_weather_delays is not null then
    insert into public.daily_log_survey_answers (daily_log_id, question_id, occurred, notes)
    values (v_log_id, v_q_weather_delays, false, 'Fair weather on site.');
  end if;

  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values
    (v_log_id, v_cat_superstructure, v_t_slab_2f, 25, 'sq.m', 'Second floor suspended slab concrete finishing and initial curing water spray'),
    (v_log_id, v_cat_masonry, v_t_chb_perimeter, 18, 'sq.m', 'Perimeter wall laying gridlines 1 to 3');

  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values
    (v_log_id, 'Head Mason', 1, 950.00),
    (v_log_id, 'Formwork Lead', 1, 950.00),
    (v_log_id, 'Skilled Mason / Finisher', 2, 850.00),
    (v_log_id, 'Construction Helper', 4, 650.00);

  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values
    (v_log_id, v_pm_cement, 'available', '35 bags used for slab surface touch-up and masonry mortar'),
    (v_log_id, v_pm_chb150, 'available', '220 pcs CHB 150mm laid');

  raise notice 'Successfully seeded ongoing project "Grand Horizon Commercial Center" (ID: %)', v_project_id;
end $$;
