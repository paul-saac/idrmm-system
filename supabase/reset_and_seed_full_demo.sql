-- ============================================================================
-- FULL RESET + comprehensive realistic seed.
--
-- Deletes every existing project (cascades to estimate_categories/tasks,
-- daily_logs + every daily_log_* child table, project_materials,
-- material_requests(+items), equipment_requisitions(+items),
-- equipment_assignments) and the standalone equipment catalog, then
-- creates ONE large, realistic construction project exercising every
-- major feature of the app in one place:
--   - Cost Estimate Breakdown + Schedule/Gantt (13 phases, 39 tasks,
--     realistic overlapping planned dates)
--   - Daily Logs: approved/pending/rejected statuses, weather + schedule
--     delay flags (with >= 3 inside the trailing 30 days before "today"
--     so the delay-risk qualitative nudge actually triggers), one
--     flagged (disputed) labor entry
--   - Materials: a 16-item project stock list (mixed available/
--     low_stock/fully_consumed) + material usage history logged against
--     it, plus 6 Material Requests across every status
--   - Equipment: a 10-item catalog + assignment history to this project,
--     plus 5 Equipment Requisitions across every status
--   - Expenses: NOT a separate table (lib/expenses/data.ts computes it
--     live from approved daily_logs' labor/material-procurement/
--     equipment-acquisition/other-expense child rows) — populated
--     automatically by the daily logs below.
--
-- Your 4 existing accounts (super_admin/admin/project_manager/foreman)
-- are NOT touched — only project-scoped data and the equipment catalog
-- are deleted, nothing in auth/profiles.
--
-- "Today" is pinned to 2026-09-13 (this environment's actual current date)
-- so the project opens already showing a natural mid-project snapshot:
--   Preliminary, Sitework, Foundation, Structural Framing, Roofing -> 100%
--   Masonry & Walls, Electrical Rough-in, Plumbing Rough-in -> partial
--   Everything after (Finishes, Flooring, Fixtures, Painting, Cleanup) -> 0%
-- Total budget: ₱18,000,000
--
-- Run manually in the Supabase SQL Editor. Requires
-- 0027_estimate_task_schedule.sql and 0034_daily_log_survey_defaults.sql
-- to already be applied.
-- ============================================================================

do $$
declare
  v_admin_id uuid;
  v_pm_id uuid;
  v_foreman_id uuid;
  v_project_id bigint;
  v_q_accidents bigint;
  v_q_schedule_delays bigint;
  v_q_weather_delays bigint;
  v_log_id bigint;
  v_mr_id bigint;
  v_er_id bigint;
  v_proc_id bigint;
  v_flag_entry_id bigint;
  v_cat_1 bigint;
  v_cat_2 bigint;
  v_cat_3 bigint;
  v_cat_4 bigint;
  v_cat_5 bigint;
  v_cat_6 bigint;
  v_cat_7 bigint;
  v_cat_8 bigint;
  v_cat_9 bigint;
  v_cat_10 bigint;
  v_cat_11 bigint;
  v_cat_12 bigint;
  v_cat_13 bigint;
  v_task_1 bigint;
  v_task_2 bigint;
  v_task_3 bigint;
  v_task_4 bigint;
  v_task_5 bigint;
  v_task_6 bigint;
  v_task_7 bigint;
  v_task_8 bigint;
  v_task_9 bigint;
  v_task_10 bigint;
  v_task_11 bigint;
  v_task_12 bigint;
  v_task_13 bigint;
  v_task_14 bigint;
  v_task_15 bigint;
  v_task_16 bigint;
  v_task_17 bigint;
  v_task_18 bigint;
  v_task_19 bigint;
  v_task_20 bigint;
  v_task_21 bigint;
  v_task_22 bigint;
  v_task_23 bigint;
  v_task_24 bigint;
  v_task_25 bigint;
  v_task_26 bigint;
  v_task_27 bigint;
  v_task_28 bigint;
  v_task_29 bigint;
  v_task_30 bigint;
  v_task_31 bigint;
  v_task_32 bigint;
  v_task_33 bigint;
  v_task_34 bigint;
  v_task_35 bigint;
  v_task_36 bigint;
  v_task_37 bigint;
  v_task_38 bigint;
  v_task_39 bigint;
  v_mat_1 bigint;
  v_mat_2 bigint;
  v_mat_3 bigint;
  v_mat_4 bigint;
  v_mat_5 bigint;
  v_mat_6 bigint;
  v_mat_7 bigint;
  v_mat_8 bigint;
  v_mat_9 bigint;
  v_mat_10 bigint;
  v_mat_11 bigint;
  v_mat_12 bigint;
  v_mat_13 bigint;
  v_mat_14 bigint;
  v_mat_15 bigint;
  v_mat_16 bigint;
  v_eq_1 bigint;
  v_eq_2 bigint;
  v_eq_3 bigint;
  v_eq_4 bigint;
  v_eq_5 bigint;
  v_eq_6 bigint;
  v_eq_7 bigint;
  v_eq_8 bigint;
  v_eq_9 bigint;
  v_eq_10 bigint;
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

  -- ---- Full reset: delete every existing project (cascades through
  -- everything project-scoped) and the standalone equipment catalog.
  -- Profiles/accounts are untouched.
  delete from public.projects;
  delete from public.equipment;

  -- ---- Project --------------------------------------------------------
  insert into public.projects (
    project_name, location, status, start_date, target_end_date,
    allocated_budget, project_manager_id, foreman_id, created_by
  ) values (
    'Sunrise Villas – Phase 1',
    'Sunrise Villas Subdivision, Phase 1, Batangas City',
    'ongoing',
    '2026-03-02',
    '2027-01-15',
    18000000,
    v_pm_id,
    v_foreman_id,
    v_admin_id
  ) returning id into v_project_id;

  -- Survey questions (0033/0034) — every project starts with these
  -- three by default (see seedDefaultSurveyQuestions); this raw-SQL
  -- seed inserts new project rows directly, bypassing createProject, so
  -- it seeds them itself the same way.
  insert into public.daily_log_survey_questions
    (project_id, question_text, is_required, sort_order, affects_delay_risk)
  values (v_project_id, 'Any accidents on site today?', true, 0, false)
  returning id into v_q_accidents;

  insert into public.daily_log_survey_questions
    (project_id, question_text, is_required, sort_order, affects_delay_risk)
  values (v_project_id, 'Any schedule delays occur?', true, 1, true)
  returning id into v_q_schedule_delays;

  insert into public.daily_log_survey_questions
    (project_id, question_text, is_required, sort_order, affects_delay_risk)
  values (v_project_id, 'Did weather cause any delays?', true, 2, true)
  returning id into v_q_weather_delays;

  -- ======================================================================
  -- Cost Estimate Breakdown + Schedule
  -- ======================================================================
  -- ---- Category: Preliminary & Mobilization (weight 3%) --------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Preliminary & Mobilization', 3)
  returning id into v_cat_1;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_1, 'Site Mobilization & Temporary Facilities', 1, 'lot',
    108000, 43200, 43200, 21600,
    216000, 1.2, '2026-03-02', '2026-03-08'
  ) returning id into v_task_1;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_1, 'Permits & Approvals Processing', 1, 'lot',
    67500, 27000, 27000, 13500,
    135000, 0.75, '2026-03-06', '2026-03-12'
  ) returning id into v_task_2;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_1, 'Site Survey & Layout', 1, 'lot',
    94500, 37800, 37800, 18900,
    189000, 1.05, '2026-03-10', '2026-03-14'
  ) returning id into v_task_3;

  -- ---- Category: Sitework & Earthworks (weight 5%) --------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Sitework & Earthworks', 5)
  returning id into v_cat_2;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_2, 'Site Clearing & Demolition', 1200, 'm2',
    81000, 27000, 148500, 13500,
    270000, 1.5, '2026-03-10', '2026-03-23'
  ) returning id into v_task_4;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_2, 'Excavation for Foundation', 850, 'm3',
    121500, 40500, 222750, 20250,
    405000, 2.25, '2026-03-20', '2026-04-02'
  ) returning id into v_task_5;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_2, 'Backfilling & Grading', 600, 'm3',
    67500, 22500, 123750, 11250,
    225000, 1.25, '2026-03-30', '2026-04-10'
  ) returning id into v_task_6;

  -- ---- Category: Foundation (weight 10%) --------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Foundation', 10)
  returning id into v_cat_3;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_3, 'Footing Excavation & Formworks', 420, 'm3',
    189000, 243000, 81000, 27000,
    540000, 3, '2026-04-01', '2026-04-18'
  ) returning id into v_task_7;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_3, 'Reinforcement & Concrete Pouring (Footings)', 380, 'm3',
    315000, 405000, 135000, 45000,
    900000, 5, '2026-04-15', '2026-05-03'
  ) returning id into v_task_8;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_3, 'Foundation Waterproofing', 900, 'm2',
    126000, 162000, 54000, 18000,
    360000, 2, '2026-04-30', '2026-05-15'
  ) returning id into v_task_9;

  -- ---- Category: Structural Framing (Superstructure) (weight 20%) --------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Structural Framing (Superstructure)', 20)
  returning id into v_cat_4;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_4, 'Column & Beam Formworks', 2400, 'm2',
    324000, 540000, 162000, 54000,
    1080000, 6, '2026-05-05', '2026-06-12'
  ) returning id into v_task_10;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_4, 'Reinforcement Installation', 45000, 'kg',
    378000, 630000, 189000, 63000,
    1260000, 7, '2026-06-09', '2026-07-18'
  ) returning id into v_task_11;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_4, 'Concrete Pouring (Columns, Beams, Slabs)', 1100, 'm3',
    378000, 630000, 189000, 63000,
    1260000, 7, '2026-07-15', '2026-08-20'
  ) returning id into v_task_12;

  -- ---- Category: Roofing (weight 8%) --------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Roofing', 8)
  returning id into v_cat_5;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_5, 'Roof Truss Installation', 380, 'lm',
    172800, 345600, 28800, 28800,
    576000, 3.2, '2026-08-10', '2026-08-21'
  ) returning id into v_task_13;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_5, 'Roof Sheathing & Insulation', 950, 'm2',
    129600, 259200, 21600, 21600,
    432000, 2.4, '2026-08-18', '2026-08-30'
  ) returning id into v_task_14;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_5, 'Roofing Materials Installation', 950, 'm2',
    129600, 259200, 21600, 21600,
    432000, 2.4, '2026-08-27', '2026-09-05'
  ) returning id into v_task_15;

  -- ---- Category: Masonry & Walls (weight 10%) --------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Masonry & Walls', 10)
  returning id into v_cat_6;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_6, 'CHB Wall Laying (Ground Floor)', 1400, 'm2',
    288000, 360000, 36000, 36000,
    720000, 4, '2026-07-20', '2026-08-14'
  ) returning id into v_task_16;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_6, 'CHB Wall Laying (Upper Floors)', 1250, 'm2',
    252000, 315000, 31500, 31500,
    630000, 3.5, '2026-08-11', '2026-09-05'
  ) returning id into v_task_17;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_6, 'Wall Plastering', 2650, 'm2',
    180000, 225000, 22500, 22500,
    450000, 2.5, '2026-09-02', '2026-09-25'
  ) returning id into v_task_18;

  -- ---- Category: Electrical Rough-in (weight 7%) --------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Electrical Rough-in', 7)
  returning id into v_cat_7;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_7, 'Conduit & Wiring Rough-in', 3200, 'lm',
    220500, 346500, 0, 63000,
    630000, 3.5, '2026-09-01', '2026-09-16'
  ) returning id into v_task_19;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_7, 'Panel Board Installation', 6, 'pcs',
    88200, 138600, 0, 25200,
    252000, 1.4, '2026-09-14', '2026-09-29'
  ) returning id into v_task_20;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_7, 'Electrical Fixtures Rough-in', 180, 'pcs',
    132300, 207900, 0, 37800,
    378000, 2.1, '2026-09-27', '2026-10-10'
  ) returning id into v_task_21;

  -- ---- Category: Plumbing Rough-in (weight 7%) --------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Plumbing Rough-in', 7)
  returning id into v_cat_8;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_8, 'Water Supply Line Rough-in', 1400, 'lm',
    176400, 277200, 0, 50400,
    504000, 2.8, '2026-09-01', '2026-09-16'
  ) returning id into v_task_22;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_8, 'Sanitary & Sewer Line Rough-in', 1100, 'lm',
    176400, 277200, 0, 50400,
    504000, 2.8, '2026-09-14', '2026-09-29'
  ) returning id into v_task_23;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_8, 'Fixture Rough-in', 90, 'pcs',
    88200, 138600, 0, 25200,
    252000, 1.4, '2026-09-27', '2026-10-10'
  ) returning id into v_task_24;

  -- ---- Category: Wall & Ceiling Finishes (weight 10%) --------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Wall & Ceiling Finishes', 10)
  returning id into v_cat_9;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_9, 'Ceiling Framing & Installation', 2100, 'm2',
    324000, 324000, 0, 72000,
    720000, 4, '2026-10-05', '2026-10-23'
  ) returning id into v_task_25;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_9, 'Wall Skim Coating', 2650, 'm2',
    283500, 283500, 0, 63000,
    630000, 3.5, '2026-10-20', '2026-11-07'
  ) returning id into v_task_26;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_9, 'Drywall Installation (Partitions)', 780, 'm2',
    202500, 202500, 0, 45000,
    450000, 2.5, '2026-11-04', '2026-11-20'
  ) returning id into v_task_27;

  -- ---- Category: Flooring (weight 6%) --------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Flooring', 6)
  returning id into v_cat_10;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_10, 'Floor Leveling & Screeding', 2000, 'm2',
    97200, 210600, 0, 16200,
    324000, 1.8, '2026-11-01', '2026-11-15'
  ) returning id into v_task_28;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_10, 'Tile Installation (Ground Floor)', 1000, 'm2',
    129600, 280800, 0, 21600,
    432000, 2.4, '2026-11-12', '2026-11-26'
  ) returning id into v_task_29;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_10, 'Tile Installation (Upper Floors)', 1000, 'm2',
    97200, 210600, 0, 16200,
    324000, 1.8, '2026-11-23', '2026-12-05'
  ) returning id into v_task_30;

  -- ---- Category: Doors, Windows & Fixtures (weight 6%) --------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Doors, Windows & Fixtures', 6)
  returning id into v_cat_11;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_11, 'Door Frame & Door Installation', 46, 'pcs',
    108000, 302400, 0, 21600,
    432000, 2.4, '2026-11-15', '2026-11-27'
  ) returning id into v_task_31;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_11, 'Window Installation', 62, 'pcs',
    94500, 264600, 0, 18900,
    378000, 2.1, '2026-11-25', '2026-12-07'
  ) returning id into v_task_32;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_11, 'Cabinetry & Built-in Fixtures', 1, 'lot',
    67500, 189000, 0, 13500,
    270000, 1.5, '2026-12-05', '2026-12-15'
  ) returning id into v_task_33;

  -- ---- Category: Painting & Finishing (weight 5%) --------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Painting & Finishing', 5)
  returning id into v_cat_12;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_12, 'Surface Preparation & Primer', 3800, 'm2',
    121500, 135000, 0, 13500,
    270000, 1.5, '2026-12-01', '2026-12-15'
  ) returning id into v_task_34;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_12, 'Interior Painting', 3800, 'm2',
    162000, 180000, 0, 18000,
    360000, 2, '2026-12-12', '2026-12-27'
  ) returning id into v_task_35;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_12, 'Exterior Painting', 1600, 'm2',
    121500, 135000, 0, 13500,
    270000, 1.5, '2026-12-24', '2027-01-05'
  ) returning id into v_task_36;

  -- ---- Category: Final Cleanup & Turnover (weight 3%) --------------------
  insert into public.estimate_categories (project_id, category_name, weight)
  values (v_project_id, 'Final Cleanup & Turnover', 3)
  returning id into v_cat_13;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_13, 'Punch List Corrections', 1, 'lot',
    129600, 21600, 21600, 43200,
    216000, 1.2, '2027-01-05', '2027-01-11'
  ) returning id into v_task_37;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_13, 'Final Cleaning', 1, 'lot',
    113400, 18900, 18900, 37800,
    189000, 1.05, '2027-01-08', '2027-01-14'
  ) returning id into v_task_38;

  insert into public.estimate_tasks (
    project_id, category_id, task_name, estimated_quantity, unit,
    labor_estimate, material_estimate, equipment_estimate, other_cost_estimate,
    total_estimate_cost, weight, planned_start_date, planned_end_date
  ) values (
    v_project_id, v_cat_13, 'Turnover Documentation', 1, 'lot',
    81000, 13500, 13500, 27000,
    135000, 0.75, '2027-01-11', '2027-01-15'
  ) returning id into v_task_39;

  -- ======================================================================
  -- Materials (project stock)
  -- ======================================================================
  insert into public.project_materials (project_id, material_code, material_name, specification, quantity, unit, status, recorded_by)
  values (v_project_id, 'MAT-001', 'Portland Cement', '40kg bag', 850, 'bag', 'low_stock', v_foreman_id)
  returning id into v_mat_1;

  insert into public.project_materials (project_id, material_code, material_name, specification, quantity, unit, status, recorded_by)
  values (v_project_id, 'MAT-002', 'Rebar 12mm dia', 'Grade 40, 6m length', 3200, 'kg', 'available', v_foreman_id)
  returning id into v_mat_2;

  insert into public.project_materials (project_id, material_code, material_name, specification, quantity, unit, status, recorded_by)
  values (v_project_id, 'MAT-003', 'Rebar 10mm dia', 'Grade 40, 6m length', 1800, 'kg', 'available', v_foreman_id)
  returning id into v_mat_3;

  insert into public.project_materials (project_id, material_code, material_name, specification, quantity, unit, status, recorded_by)
  values (v_project_id, 'MAT-004', 'CHB 6"', 'Load-bearing', 4200, 'pcs', 'available', v_foreman_id)
  returning id into v_mat_4;

  insert into public.project_materials (project_id, material_code, material_name, specification, quantity, unit, status, recorded_by)
  values (v_project_id, 'MAT-005', 'CHB 4"', 'Non load-bearing', 1500, 'pcs', 'low_stock', v_foreman_id)
  returning id into v_mat_5;

  insert into public.project_materials (project_id, material_code, material_name, specification, quantity, unit, status, recorded_by)
  values (v_project_id, 'MAT-006', 'Sand', 'Washed, fine', 120, 'm3', 'available', v_foreman_id)
  returning id into v_mat_6;

  insert into public.project_materials (project_id, material_code, material_name, specification, quantity, unit, status, recorded_by)
  values (v_project_id, 'MAT-007', 'Gravel 3/4"', 'Crushed', 95, 'm3', 'available', v_foreman_id)
  returning id into v_mat_7;

  insert into public.project_materials (project_id, material_code, material_name, specification, quantity, unit, status, recorded_by)
  values (v_project_id, 'MAT-008', 'Plywood 1/2"', 'Marine grade, 4x8', 40, 'sheet', 'low_stock', v_foreman_id)
  returning id into v_mat_8;

  insert into public.project_materials (project_id, material_code, material_name, specification, quantity, unit, status, recorded_by)
  values (v_project_id, 'MAT-009', 'Lumber 2x4x8', 'Coco lumber', 3800, 'bd ft', 'available', v_foreman_id)
  returning id into v_mat_9;

  insert into public.project_materials (project_id, material_code, material_name, specification, quantity, unit, status, recorded_by)
  values (v_project_id, 'MAT-010', 'GI Sheet Roofing', 'Corrugated, 0.4mm', 0, 'm2', 'fully_consumed', v_foreman_id)
  returning id into v_mat_10;

  insert into public.project_materials (project_id, material_code, material_name, specification, quantity, unit, status, recorded_by)
  values (v_project_id, 'MAT-011', 'Roof Insulation', 'Double-sided foil', 150, 'm2', 'available', v_foreman_id)
  returning id into v_mat_11;

  insert into public.project_materials (project_id, material_code, material_name, specification, quantity, unit, status, recorded_by)
  values (v_project_id, 'MAT-012', 'PVC Pipe 4"', 'Sanitary grade', 600, 'lm', 'available', v_foreman_id)
  returning id into v_mat_12;

  insert into public.project_materials (project_id, material_code, material_name, specification, quantity, unit, status, recorded_by)
  values (v_project_id, 'MAT-013', 'THHN Wire 12mm', 'Stranded copper', 2100, 'lm', 'available', v_foreman_id)
  returning id into v_mat_13;

  insert into public.project_materials (project_id, material_code, material_name, specification, quantity, unit, status, recorded_by)
  values (v_project_id, 'MAT-014', 'Ceramic Tiles 60x60', 'Matte finish', 300, 'm2', 'available', v_foreman_id)
  returning id into v_mat_14;

  insert into public.project_materials (project_id, material_code, material_name, specification, quantity, unit, status, recorded_by)
  values (v_project_id, 'MAT-015', 'Paint - Latex White', 'Flat finish', 45, 'gal', 'available', v_foreman_id)
  returning id into v_mat_15;

  insert into public.project_materials (project_id, material_code, material_name, specification, quantity, unit, status, recorded_by)
  values (v_project_id, 'MAT-016', 'Nails Assorted', '1" to 4"', 25, 'kg', 'low_stock', v_foreman_id)
  returning id into v_mat_16;

  -- ======================================================================
  -- Equipment catalog
  -- ======================================================================
  insert into public.equipment (asset_tag, name, category, description, serial_number, status, current_project_id, created_by)
  values ('EQ-001', 'Concrete Mixer', 'Heavy Equipment', '1-bagger portable mixer', 'CM-2024-118', 'assigned', v_project_id, v_admin_id)
  returning id into v_eq_1;

  insert into public.equipment (asset_tag, name, category, description, serial_number, status, current_project_id, created_by)
  values ('EQ-002', 'Bar Cutter', 'Power Tool', 'Electric rebar cutter, up to 32mm', 'BC-2023-045', 'assigned', v_project_id, v_admin_id)
  returning id into v_eq_2;

  insert into public.equipment (asset_tag, name, category, description, serial_number, status, current_project_id, created_by)
  values ('EQ-003', 'Bar Bender', 'Power Tool', 'Electric rebar bender, up to 32mm', 'BB-2023-046', 'available', null, v_admin_id)
  returning id into v_eq_3;

  insert into public.equipment (asset_tag, name, category, description, serial_number, status, current_project_id, created_by)
  values ('EQ-004', 'Scaffolding Set A', 'Scaffolding', 'Steel frame scaffolding, 6-story set', null, 'assigned', v_project_id, v_admin_id)
  returning id into v_eq_4;

  insert into public.equipment (asset_tag, name, category, description, serial_number, status, current_project_id, created_by)
  values ('EQ-005', 'Scaffolding Set B', 'Scaffolding', 'Steel frame scaffolding, 4-story set', null, 'available', null, v_admin_id)
  returning id into v_eq_5;

  insert into public.equipment (asset_tag, name, category, description, serial_number, status, current_project_id, created_by)
  values ('EQ-006', 'Welding Machine', 'Power Tool', 'Inverter welding machine, 200A', 'WM-2022-089', 'assigned', v_project_id, v_admin_id)
  returning id into v_eq_6;

  insert into public.equipment (asset_tag, name, category, description, serial_number, status, current_project_id, created_by)
  values ('EQ-007', 'Backhoe Loader', 'Heavy Equipment', 'Wheeled backhoe loader', 'BH-2021-012', 'available', null, v_admin_id)
  returning id into v_eq_7;

  insert into public.equipment (asset_tag, name, category, description, serial_number, status, current_project_id, created_by)
  values ('EQ-008', 'Water Pump', 'Power Tool', 'Trash pump, 4-inch', 'WP-2024-033', 'maintenance', null, v_admin_id)
  returning id into v_eq_8;

  insert into public.equipment (asset_tag, name, category, description, serial_number, status, current_project_id, created_by)
  values ('EQ-009', 'Generator Set 10kVA', 'Power Tool', 'Diesel genset, 10kVA', 'GS-2023-071', 'assigned', v_project_id, v_admin_id)
  returning id into v_eq_9;

  insert into public.equipment (asset_tag, name, category, description, serial_number, status, current_project_id, created_by)
  values ('EQ-010', 'Hand Tools Set', 'Hand Tool', 'Complete carpentry hand tool set', null, 'available', null, v_admin_id)
  returning id into v_eq_10;

  -- ---- Equipment assignment history --------------------------------
  insert into public.equipment_assignments (equipment_id, project_id, assigned_by, assigned_at, notes)
  values (v_eq_1, v_project_id, v_admin_id, '2026-03-22T08:00:00+08', 'Checked out for Concrete Mixer site work')
  ;

  insert into public.equipment_assignments (equipment_id, project_id, assigned_by, assigned_at, notes)
  values (v_eq_2, v_project_id, v_admin_id, '2026-03-27T08:00:00+08', 'Checked out for Bar Cutter site work')
  ;

  insert into public.equipment_assignments (equipment_id, project_id, assigned_by, assigned_at, notes)
  values (v_eq_4, v_project_id, v_admin_id, '2026-04-06T08:00:00+08', 'Checked out for Scaffolding Set A site work')
  ;

  insert into public.equipment_assignments (equipment_id, project_id, assigned_by, assigned_at, notes)
  values (v_eq_6, v_project_id, v_admin_id, '2026-04-16T08:00:00+08', 'Checked out for Welding Machine site work')
  ;

  insert into public.equipment_assignments (equipment_id, project_id, assigned_by, assigned_at, notes)
  values (v_eq_9, v_project_id, v_admin_id, '2026-05-01T08:00:00+08', 'Checked out for Generator Set 10kVA site work')
  ;

  insert into public.equipment_assignments (equipment_id, project_id, assigned_by, assigned_at, returned_at, notes)
  values (v_eq_7, v_project_id, v_admin_id, '2026-04-02T08:00:00+08', '2026-04-18T17:00:00+08', 'Excavation work for foundation, returned after backfilling complete')
  ;

  -- ======================================================================
  -- Material Requests
  -- ======================================================================
  insert into public.material_requests (project_id, mr_no, requested_by, request_date, date_required, priority, remarks, status)
  values (v_project_id, 'MR-2026-001', v_foreman_id, '2026-03-12', '2026-03-19', 'urgent', 'Cement and rebar running low, need restock before Masonry ramps up.', 'submitted')
  returning id into v_mr_id;
  insert into public.material_request_items (material_request_id, material_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values (v_mr_id, 'Portland Cement', '40kg bag', 500, 'bag', 'Wall plastering and finishing works', 0);
  insert into public.material_request_items (material_request_id, material_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values (v_mr_id, 'Rebar 12mm dia', 'Grade 40, 6m', 1000, 'kg', 'Column reinforcement, upper floors', 0);

  insert into public.material_requests (project_id, mr_no, requested_by, request_date, date_required, priority, remarks, status, approved_by, approved_at)
  values (v_project_id, 'MR-2026-002', v_foreman_id, '2026-04-06', '2026-04-13', 'routine', 'CHB delivery for ground floor walls.', 'approved', v_admin_id, '2026-04-08')
  returning id into v_mr_id;
  insert into public.material_request_items (material_request_id, material_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values (v_mr_id, 'CHB 6"', 'Load-bearing', 2000, 'pcs', 'Ground floor load-bearing walls', 0);

  insert into public.material_requests (project_id, mr_no, requested_by, request_date, date_required, priority, remarks, status, approved_by, approved_at)
  values (v_project_id, 'MR-2026-003', v_foreman_id, '2026-05-01', '2026-05-08', 'routine', 'Plywood and lumber for formworks.', 'partially_fulfilled', v_admin_id, '2026-05-03')
  returning id into v_mr_id;
  insert into public.material_request_items (material_request_id, material_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values (v_mr_id, 'Plywood 1/2"', 'Marine grade, 4x8', 60, 'sheet', 'Column and beam formworks', 35);
  insert into public.material_request_items (material_request_id, material_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values (v_mr_id, 'Lumber 2x4x8', 'Coco lumber', 800, 'bd ft', 'Formwork bracing', 800);

  insert into public.material_requests (project_id, mr_no, requested_by, request_date, date_required, priority, remarks, status, approved_by, approved_at)
  values (v_project_id, 'MR-2026-004', v_foreman_id, '2026-05-26', '2026-06-02', 'urgent', 'Roofing materials for scheduled roof installation.', 'fulfilled', v_admin_id, '2026-05-28')
  returning id into v_mr_id;
  insert into public.material_request_items (material_request_id, material_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values (v_mr_id, 'GI Sheet Roofing', 'Corrugated, 0.4mm', 950, 'm2', 'Roofing materials installation', 950);
  insert into public.material_request_items (material_request_id, material_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values (v_mr_id, 'Roof Insulation', 'Double-sided foil', 950, 'm2', 'Roof insulation layer', 950);

  insert into public.material_requests (project_id, mr_no, requested_by, request_date, date_required, priority, remarks, status, approved_by, approved_at)
  values (v_project_id, 'MR-2026-005', v_foreman_id, '2026-06-20', '2026-06-27', 'routine', 'Electrical wiring supplies for rough-in.', 'fulfilled', v_admin_id, '2026-06-22')
  returning id into v_mr_id;
  insert into public.material_request_items (material_request_id, material_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values (v_mr_id, 'THHN Wire 12mm', 'Stranded copper', 3200, 'lm', 'Conduit and wiring rough-in', 3200);

  insert into public.material_requests (project_id, mr_no, requested_by, request_date, date_required, priority, remarks, status)
  values (v_project_id, 'MR-2026-006', v_foreman_id, '2026-07-15', '2026-07-22', 'routine', 'Duplicate of MR-2026-002, canceled.', 'canceled')
  returning id into v_mr_id;
  insert into public.material_request_items (material_request_id, material_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values (v_mr_id, 'CHB 4"', 'Non load-bearing', 500, 'pcs', 'Partition walls', 0);

  -- ======================================================================
  -- Equipment Requisitions
  -- ======================================================================
  insert into public.equipment_requisitions (project_id, er_no, requested_by, request_date, date_required, priority, remarks, status, approved_by, approved_at)
  values (v_project_id, 'ER-2026-001', v_foreman_id, '2026-03-17', '2026-03-22', 'urgent', 'Backhoe needed for foundation excavation.', 'fulfilled', v_admin_id, '2026-03-18')
  returning id into v_er_id;
  insert into public.equipment_requisition_items (equipment_request_id, equipment_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values (v_er_id, 'Backhoe Loader', 'Wheeled, standard bucket', 1, 'unit', 'Excavation for foundation', 1);

  insert into public.equipment_requisitions (project_id, er_no, requested_by, request_date, date_required, priority, remarks, status, approved_by, approved_at)
  values (v_project_id, 'ER-2026-002', v_foreman_id, '2026-04-16', '2026-04-21', 'routine', 'Additional scaffolding for upper floor masonry.', 'approved', v_admin_id, '2026-04-17')
  returning id into v_er_id;
  insert into public.equipment_requisition_items (equipment_request_id, equipment_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values (v_er_id, 'Scaffolding Set', 'Steel frame, 4-story', 2, 'set', 'Upper floor CHB wall laying', 0);

  insert into public.equipment_requisitions (project_id, er_no, requested_by, request_date, date_required, priority, remarks, status, approved_by, approved_at)
  values (v_project_id, 'ER-2026-003', v_foreman_id, '2026-05-16', '2026-05-21', 'routine', 'Welding machine rental for structural steel work.', 'fulfilled', v_admin_id, '2026-05-17')
  returning id into v_er_id;
  insert into public.equipment_requisition_items (equipment_request_id, equipment_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values (v_er_id, 'Welding Machine', 'Inverter, 200A', 1, 'unit', 'Structural steel welding', 1);

  insert into public.equipment_requisitions (project_id, er_no, requested_by, request_date, date_required, priority, remarks, status, approved_by, approved_at)
  values (v_project_id, 'ER-2026-004', v_foreman_id, '2026-06-15', '2026-06-20', 'urgent', 'Generator for site power during rough-in.', 'fulfilled', v_admin_id, '2026-06-16')
  returning id into v_er_id;
  insert into public.equipment_requisition_items (equipment_request_id, equipment_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values (v_er_id, 'Generator Set', 'Diesel, 10kVA', 1, 'unit', 'Site power for electrical rough-in', 1);

  insert into public.equipment_requisitions (project_id, er_no, requested_by, request_date, date_required, priority, remarks, status)
  values (v_project_id, 'ER-2026-005', v_foreman_id, '2026-07-15', '2026-07-20', 'routine', 'Power tools bundle for finishing works.', 'submitted')
  returning id into v_er_id;
  insert into public.equipment_requisition_items (equipment_request_id, equipment_name, specification, quantity_needed, uom, purpose, quantity_fulfilled)
  values (v_er_id, 'Power Tools Bundle', 'Drills, sanders, grinders', 1, 'lot', 'Upcoming finishing works', 0);

  -- ======================================================================
  -- Daily Logs (one per calendar day; work items, labor, and — on
  -- selected days — material procurement/usage, equipment acquisition,
  -- other expenses, weather/schedule delay flags, and one disputed entry
  -- ======================================================================
  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-03-04', 'approved', v_admin_id, '2026-03-05')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_1, v_task_1, 1, 'lot', 'Site Mobilization & Temporary Facilities — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_procurement (daily_log_id, procurement_type, supplier_name)
  values (v_log_id, 'direct_purchase', 'ABC Construction Supply')
  returning id into v_proc_id;
  insert into public.daily_log_material_procurement_items (procurement_id, material_name, specification, quantity, unit, cost)
  values (v_proc_id, 'Assorted construction materials', 'Per site requisition', 103, 'lot', 5871);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_1, 'low_stock', 'Used Portland Cement for ongoing site work');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-03-08', 'approved', v_admin_id, '2026-03-09')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_1, v_task_2, 1, 'lot', 'Permits & Approvals Processing — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_2, 'available', 'Used Rebar 12mm dia for ongoing site work');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-03-11', 'approved', v_admin_id, '2026-03-12')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_1, v_task_3, 1, 'lot', 'Site Survey & Layout — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_procurement (daily_log_id, procurement_type, supplier_name)
  values (v_log_id, 'direct_purchase', 'ABC Construction Supply')
  returning id into v_proc_id;
  insert into public.daily_log_material_procurement_items (procurement_id, material_name, specification, quantity, unit, cost)
  values (v_proc_id, 'Assorted construction materials', 'Per site requisition', 109, 'lot', 7739);

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-03-15', 'approved', v_admin_id, '2026-03-16')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_2, v_task_4, 660, 'm2', 'Site Clearing & Demolition — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_3, 'available', 'Used Rebar 10mm dia for ongoing site work');
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_4, 'available', 'Used CHB 6" for ongoing site work');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-03-20', 'approved', v_admin_id, '2026-03-21')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_2, v_task_4, 540, 'm2', 'Site Clearing & Demolition — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_procurement (daily_log_id, procurement_type, supplier_name)
  values (v_log_id, 'direct_purchase', 'ABC Construction Supply')
  returning id into v_proc_id;
  insert into public.daily_log_material_procurement_items (procurement_id, material_name, specification, quantity, unit, cost)
  values (v_proc_id, 'Assorted construction materials', 'Per site requisition', 112, 'lot', 8736);
  insert into public.daily_log_expense_items (daily_log_id, expense_category, amount, description)
  values (v_log_id, 'Permits & Licenses', 45000, 'Building permit renewal and inspection fees');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-03-25', 'approved', v_admin_id, '2026-03-26')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_2, v_task_5, 468, 'm3', 'Excavation for Foundation — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_5, 'low_stock', 'Used CHB 4" for ongoing site work');
  insert into public.daily_log_equipment_acquisition (daily_log_id, equipment_name, quantity, acquisition_type, amount, remarks)
  values (v_log_id, 'Backhoe Loader', 1, 'rental', 18000, 'Backhoe Loader for site work');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-03-30', 'approved', v_admin_id, '2026-03-31')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_2, v_task_5, 382, 'm3', 'Excavation for Foundation — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_procurement (daily_log_id, procurement_type, supplier_name)
  values (v_log_id, 'direct_purchase', 'ABC Construction Supply')
  returning id into v_proc_id;
  insert into public.daily_log_material_procurement_items (procurement_id, material_name, specification, quantity, unit, cost)
  values (v_proc_id, 'Assorted construction materials', 'Per site requisition', 115, 'lot', 9775);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_6, 'available', 'Used Sand for ongoing site work');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-04-03', 'approved', v_admin_id, '2026-04-04')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_2, v_task_6, 330, 'm3', 'Backfilling & Grading — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_7, 'available', 'Used Gravel 3/4" for ongoing site work');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-04-07', 'approved', v_admin_id, '2026-04-08')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_2, v_task_6, 270, 'm3', 'Backfilling & Grading — progress update');
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_3, v_task_7, 231, 'm3', 'Footing Excavation & Formworks — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 10, 950);
  insert into public.daily_log_material_procurement (daily_log_id, procurement_type, supplier_name)
  values (v_log_id, 'direct_purchase', 'ABC Construction Supply')
  returning id into v_proc_id;
  insert into public.daily_log_material_procurement_items (procurement_id, material_name, specification, quantity, unit, cost)
  values (v_proc_id, 'Assorted construction materials', 'Per site requisition', 118, 'lot', 10856);

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-04-14', 'approved', v_admin_id, '2026-04-15')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_3, v_task_7, 189, 'm3', 'Footing Excavation & Formworks — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_8, 'low_stock', 'Used Plywood 1/2" for ongoing site work');
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_9, 'available', 'Used Lumber 2x4x8 for ongoing site work');
  insert into public.daily_log_equipment_acquisition (daily_log_id, equipment_name, quantity, acquisition_type, amount, remarks)
  values (v_log_id, 'Bar Cutter', 1, 'purchase', 42000, 'Bar Cutter for site work');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-04-21', 'approved', v_admin_id, '2026-04-22')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_3, v_task_8, 209, 'm3', 'Reinforcement & Concrete Pouring (Footings) — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_procurement (daily_log_id, procurement_type, supplier_name)
  values (v_log_id, 'direct_purchase', 'ABC Construction Supply')
  returning id into v_proc_id;
  insert into public.daily_log_material_procurement_items (procurement_id, material_name, specification, quantity, unit, cost)
  values (v_proc_id, 'Assorted construction materials', 'Per site requisition', 124, 'lot', 13144);
  insert into public.daily_log_expense_items (daily_log_id, expense_category, amount, description)
  values (v_log_id, 'Waste Disposal', 12000, 'Debris hauling and disposal, excavation phase');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-04-29', 'approved', v_admin_id, '2026-04-30')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_3, v_task_8, 171, 'm3', 'Reinforcement & Concrete Pouring (Footings) — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_10, 'fully_consumed', 'Used GI Sheet Roofing for ongoing site work');
  insert into public.daily_log_equipment_acquisition (daily_log_id, equipment_name, quantity, acquisition_type, amount, remarks)
  values (v_log_id, 'Bar Bender', 1, 'rental', 8500, 'Bar Bender for site work');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-05-05', 'approved', v_admin_id, '2026-05-06')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_3, v_task_9, 495, 'm2', 'Foundation Waterproofing — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_procurement (daily_log_id, procurement_type, supplier_name)
  values (v_log_id, 'direct_purchase', 'ABC Construction Supply')
  returning id into v_proc_id;
  insert into public.daily_log_material_procurement_items (procurement_id, material_name, specification, quantity, unit, cost)
  values (v_proc_id, 'Assorted construction materials', 'Per site requisition', 127, 'lot', 14351);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_11, 'available', 'Used Roof Insulation for ongoing site work');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-05-11', 'approved', v_admin_id, '2026-05-12')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_3, v_task_9, 405, 'm2', 'Foundation Waterproofing — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_12, 'available', 'Used PVC Pipe 4" for ongoing site work');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-05-18', 'approved', v_admin_id, '2026-05-19')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_4, v_task_10, 1320, 'm2', 'Column & Beam Formworks — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_procurement (daily_log_id, procurement_type, supplier_name)
  values (v_log_id, 'direct_purchase', 'ABC Construction Supply')
  returning id into v_proc_id;
  insert into public.daily_log_material_procurement_items (procurement_id, material_name, specification, quantity, unit, cost)
  values (v_proc_id, 'Assorted construction materials', 'Per site requisition', 130, 'lot', 15600);
  insert into public.daily_log_equipment_acquisition (daily_log_id, equipment_name, quantity, acquisition_type, amount, remarks)
  values (v_log_id, 'Scaffolding Set A', 1, 'rental', 15000, 'Scaffolding Set A for site work');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-06-03', 'approved', v_admin_id, '2026-06-04')
  returning id into v_log_id;
  insert into public.daily_log_survey_answers (daily_log_id, question_id, occurred, notes)
  values (v_log_id, v_q_weather_delays, true, 'Heavy rain halted concrete pouring for the day.');
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_4, v_task_10, 1080, 'm2', 'Column & Beam Formworks — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_13, 'available', 'Used THHN Wire 12mm for ongoing site work');
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_14, 'available', 'Used Ceramic Tiles 60x60 for ongoing site work');
  insert into public.daily_log_equipment_acquisition (daily_log_id, equipment_name, quantity, acquisition_type, amount, remarks)
  values (v_log_id, 'Welding Machine', 1, 'rental', 6500, 'Welding Machine for site work');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-06-23', 'approved', v_admin_id, '2026-06-24')
  returning id into v_log_id;
  insert into public.daily_log_survey_answers (daily_log_id, question_id, occurred, notes)
  values (v_log_id, v_q_schedule_delays, true, 'Rebar delivery delayed by supplier by about a week.');
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_4, v_task_11, 24750, 'kg', 'Reinforcement Installation — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950)
  returning id into v_flag_entry_id;
  insert into public.daily_log_entry_flags (daily_log_id, entry_type, entry_id, reason, flagged_by)
  values (v_log_id, 'labor_item', v_flag_entry_id, 'Worker count looks off compared to the crew roster for this day — please verify before this counts toward Expenses.', v_admin_id);
  insert into public.daily_log_material_procurement (daily_log_id, procurement_type, supplier_name)
  values (v_log_id, 'direct_purchase', 'ABC Construction Supply')
  returning id into v_proc_id;
  insert into public.daily_log_material_procurement_items (procurement_id, material_name, specification, quantity, unit, cost)
  values (v_proc_id, 'Assorted construction materials', 'Per site requisition', 133, 'lot', 16891);

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-07-08', 'approved', v_admin_id, '2026-07-09')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_4, v_task_11, 20250, 'kg', 'Reinforcement Installation — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_15, 'available', 'Used Paint - Latex White for ongoing site work');
  insert into public.daily_log_equipment_acquisition (daily_log_id, equipment_name, quantity, acquisition_type, amount, remarks)
  values (v_log_id, 'Water Pump', 1, 'rental', 5200, 'Water Pump for site work');
  insert into public.daily_log_expense_items (daily_log_id, expense_category, amount, description)
  values (v_log_id, 'Site Security Services', 28000, 'Monthly site security guard services');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-07-28', 'approved', v_admin_id, '2026-07-29')
  returning id into v_log_id;
  insert into public.daily_log_survey_answers (daily_log_id, question_id, occurred, notes)
  values (v_log_id, v_q_weather_delays, true, 'Typhoon signal no. 1 raised; work suspended as a precaution.');
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_4, v_task_12, 605, 'm3', 'Concrete Pouring (Columns, Beams, Slabs) — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_procurement (daily_log_id, procurement_type, supplier_name)
  values (v_log_id, 'direct_purchase', 'ABC Construction Supply')
  returning id into v_proc_id;
  insert into public.daily_log_material_procurement_items (procurement_id, material_name, specification, quantity, unit, cost)
  values (v_proc_id, 'Assorted construction materials', 'Per site requisition', 136, 'lot', 18224);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_16, 'low_stock', 'Used Nails Assorted for ongoing site work');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-07-29', 'approved', v_admin_id, '2026-07-30')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_6, v_task_16, 539, 'm2', 'CHB Wall Laying (Ground Floor) — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_1, 'low_stock', 'Used Portland Cement for ongoing site work');
  insert into public.daily_log_expense_items (daily_log_id, expense_category, amount, description)
  values (v_log_id, 'Temporary Utilities', 15500, 'Temporary water and electricity connection fees');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-08-08', 'approved', v_admin_id, '2026-08-09')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_6, v_task_16, 441, 'm2', 'CHB Wall Laying (Ground Floor) — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_procurement (daily_log_id, procurement_type, supplier_name)
  values (v_log_id, 'direct_purchase', 'ABC Construction Supply')
  returning id into v_proc_id;
  insert into public.daily_log_material_procurement_items (procurement_id, material_name, specification, quantity, unit, cost)
  values (v_proc_id, 'Assorted construction materials', 'Per site requisition', 148, 'lot', 23976);
  insert into public.daily_log_entry_flags (daily_log_id, entry_type, entry_id, reason, flagged_by)
  values (v_log_id, 'material_procurement', v_proc_id, 'Supplier receipt total doesn''t match the logged cost — please re-check before this counts toward Expenses.', v_admin_id);

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-08-11', 'approved', v_admin_id, '2026-08-12')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_4, v_task_12, 495, 'm3', 'Concrete Pouring (Columns, Beams, Slabs) — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_2, 'available', 'Used Rebar 12mm dia for ongoing site work');
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_3, 'available', 'Used Rebar 10mm dia for ongoing site work');
  insert into public.daily_log_equipment_acquisition (daily_log_id, equipment_name, quantity, acquisition_type, amount, remarks)
  values (v_log_id, 'Scaffolding Set B', 1, 'rental', 12000, 'Scaffolding Set B for site work');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-08-14', 'approved', v_admin_id, '2026-08-15')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_5, v_task_13, 209, 'lm', 'Roof Truss Installation — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_procurement (daily_log_id, procurement_type, supplier_name)
  values (v_log_id, 'direct_purchase', 'ABC Construction Supply')
  returning id into v_proc_id;
  insert into public.daily_log_material_procurement_items (procurement_id, material_name, specification, quantity, unit, cost)
  values (v_proc_id, 'Assorted construction materials', 'Per site requisition', 139, 'lot', 19599);

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-08-18', 'approved', v_admin_id, '2026-08-19')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_5, v_task_13, 171, 'lm', 'Roof Truss Installation — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_4, 'available', 'Used CHB 6" for ongoing site work');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-08-20', 'approved', v_admin_id, '2026-08-21')
  returning id into v_log_id;
  insert into public.daily_log_survey_answers (daily_log_id, question_id, occurred, notes)
  values (v_log_id, v_q_weather_delays, true, 'Continuous rain over the weekend delayed masonry work.');
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_6, v_task_17, 481, 'm2', 'CHB Wall Laying (Upper Floors) — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_procurement (daily_log_id, procurement_type, supplier_name)
  values (v_log_id, 'direct_purchase', 'ABC Construction Supply')
  returning id into v_proc_id;
  insert into public.daily_log_material_procurement_items (procurement_id, material_name, specification, quantity, unit, cost)
  values (v_proc_id, 'Assorted construction materials', 'Per site requisition', 151, 'lot', 25519);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_5, 'low_stock', 'Used CHB 4" for ongoing site work');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-08-22', 'approved', v_admin_id, '2026-08-23')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_5, v_task_14, 523, 'm2', 'Roof Sheathing & Insulation — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_6, 'available', 'Used Sand for ongoing site work');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-08-27', 'approved', v_admin_id, '2026-08-28')
  returning id into v_log_id;
  insert into public.daily_log_survey_answers (daily_log_id, question_id, occurred, notes)
  values (v_log_id, v_q_schedule_delays, true, 'Electrical materials backordered, rough-in paused on 2 tasks.');
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_5, v_task_14, 427, 'm2', 'Roof Sheathing & Insulation — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_procurement (daily_log_id, procurement_type, supplier_name)
  values (v_log_id, 'direct_purchase', 'ABC Construction Supply')
  returning id into v_proc_id;
  insert into public.daily_log_material_procurement_items (procurement_id, material_name, specification, quantity, unit, cost)
  values (v_proc_id, 'Assorted construction materials', 'Per site requisition', 142, 'lot', 21016);

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-08-30', 'approved', v_admin_id, '2026-08-31')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_5, v_task_15, 523, 'm2', 'Roofing Materials Installation — progress update');
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_6, v_task_17, 394, 'm2', 'CHB Wall Laying (Upper Floors) — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 10, 950);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_7, 'available', 'Used Gravel 3/4" for ongoing site work');
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_8, 'low_stock', 'Used Plywood 1/2" for ongoing site work');
  insert into public.daily_log_expense_items (daily_log_id, expense_category, amount, description)
  values (v_log_id, 'Site Security Services', 28000, 'Monthly site security guard services');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-09-03', 'approved', v_admin_id, '2026-09-04')
  returning id into v_log_id;
  insert into public.daily_log_survey_answers (daily_log_id, question_id, occurred, notes)
  values (v_log_id, v_q_schedule_delays, true, 'Plumbing crew short-staffed this week; behind on rough-in.');
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_5, v_task_15, 427, 'm2', 'Roofing Materials Installation — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_procurement (daily_log_id, procurement_type, supplier_name)
  values (v_log_id, 'direct_purchase', 'ABC Construction Supply')
  returning id into v_proc_id;
  insert into public.daily_log_material_procurement_items (procurement_id, material_name, specification, quantity, unit, cost)
  values (v_proc_id, 'Assorted construction materials', 'Per site requisition', 145, 'lot', 22475);

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-09-06', 'approved', v_admin_id, '2026-09-07')
  returning id into v_log_id;
  insert into public.daily_log_survey_answers (daily_log_id, question_id, occurred, notes)
  values (v_log_id, v_q_weather_delays, true, 'Afternoon thunderstorms cut the work day short.');
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_7, v_task_19, 792, 'lm', 'Conduit & Wiring Rough-in — progress update');
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_8, v_task_22, 308, 'lm', 'Water Supply Line Rough-in — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 10, 950);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_9, 'available', 'Used Lumber 2x4x8 for ongoing site work');
  insert into public.daily_log_equipment_acquisition (daily_log_id, equipment_name, quantity, acquisition_type, amount, remarks)
  values (v_log_id, 'Generator Set 10kVA', 1, 'rental', 9000, 'Generator Set 10kVA for site work');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-09-10', 'approved', v_admin_id, '2026-09-11')
  returning id into v_log_id;
  insert into public.daily_log_survey_answers (daily_log_id, question_id, occurred, notes)
  values (v_log_id, v_q_schedule_delays, true, 'Waiting on additional scaffolding before masonry can continue upstairs.');
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_6, v_task_18, 1020, 'm2', 'Wall Plastering — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_procurement (daily_log_id, procurement_type, supplier_name)
  values (v_log_id, 'direct_purchase', 'ABC Construction Supply')
  returning id into v_proc_id;
  insert into public.daily_log_material_procurement_items (procurement_id, material_name, specification, quantity, unit, cost)
  values (v_proc_id, 'Assorted construction materials', 'Per site requisition', 154, 'lot', 27104);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_10, 'fully_consumed', 'Used GI Sheet Roofing for ongoing site work');
  insert into public.daily_log_expense_items (daily_log_id, expense_category, amount, description)
  values (v_log_id, 'Insurance', 22000, 'Contractor''s all-risk insurance premium, quarterly');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-09-12', 'approved', v_admin_id, '2026-09-13')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_7, v_task_19, 648, 'lm', 'Conduit & Wiring Rough-in — progress update');
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_8, v_task_22, 252, 'lm', 'Water Supply Line Rough-in — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 10, 950);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_11, 'available', 'Used Roof Insulation for ongoing site work');

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at)
  values (v_project_id, v_foreman_id, '2026-09-13', 'approved', v_admin_id, '2026-09-14')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_6, v_task_18, 835, 'm2', 'Wall Plastering — progress update');
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_7, v_task_20, 3, 'pcs', 'Panel Board Installation — progress update');
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_7, v_task_21, 81, 'pcs', 'Electrical Fixtures Rough-in — progress update');
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_8, v_task_23, 440, 'lm', 'Sanitary & Sewer Line Rough-in — progress update');
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_8, v_task_24, 36, 'pcs', 'Fixture Rough-in — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 16, 950);
  insert into public.daily_log_material_procurement (daily_log_id, procurement_type, supplier_name)
  values (v_log_id, 'direct_purchase', 'ABC Construction Supply')
  returning id into v_proc_id;
  insert into public.daily_log_material_procurement_items (procurement_id, material_name, specification, quantity, unit, cost)
  values (v_proc_id, 'Assorted construction materials', 'Per site requisition', 154, 'lot', 27104);

  -- ---- Additional logs for status variety (pending / rejected) —
  -- real work items, same as every approved log; only excluded from
  -- progress/expenses because they're not approved yet. -----------
  insert into public.daily_logs (project_id, submitted_by, log_date, status)
  values (v_project_id, v_foreman_id, '2026-09-11', 'pending')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_7, v_task_21, 24, 'pcs', 'Electrical Fixtures Rough-in — progress update, pending review');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 10, 950);
  insert into public.daily_log_material_usage_items (daily_log_id, project_material_id, status, activity)
  values (v_log_id, v_mat_13, 'available', 'Used THHN Wire 12mm for electrical fixtures rough-in');

  insert into public.daily_logs (project_id, submitted_by, log_date, status)
  values (v_project_id, v_foreman_id, '2026-09-09', 'pending')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_8, v_task_23, 88, 'lm', 'Sanitary & Sewer Line Rough-in — progress update, pending review');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);
  insert into public.daily_log_material_procurement (daily_log_id, procurement_type, supplier_name)
  values (v_log_id, 'direct_purchase', 'ABC Construction Supply')
  returning id into v_proc_id;
  insert into public.daily_log_material_procurement_items (procurement_id, material_name, specification, quantity, unit, cost)
  values (v_proc_id, 'PVC fittings and solvent cement', 'Sanitary grade', 40, 'lot', 6200);

  insert into public.daily_logs (project_id, submitted_by, log_date, status, reviewed_by, reviewed_at, notes)
  values (v_project_id, v_foreman_id, '2026-07-15', 'rejected', v_admin_id, '2026-07-16', 'Rejected: missing photo documentation for the reported work — please resubmit with attachments.')
  returning id into v_log_id;
  insert into public.daily_log_work_items (daily_log_id, category_id, task_id, quantity_completed, unit, activity)
  values (v_log_id, v_cat_4, v_task_11, 1350, 'kg', 'Reinforcement Installation — progress update');
  insert into public.daily_log_labor_items (daily_log_id, worker_role, worker_count, daily_rate)
  values (v_log_id, 'Laborer', 8, 950);

  raise notice 'Seeded project id % ("Sunrise Villas – Phase 1")', v_project_id;
end $$;

