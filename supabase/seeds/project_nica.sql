-- ============================================================================
-- Project Nica: realistic sample data for the Team and one full project,
-- laid out like IDR M&M's Bill of Materials (Items A to Q).
--
-- Team
--   * Tidies the members already there: a proper role for each (informal
--     ones like "Tagapuk-pok" become Carpenter, Mason, ...), and fills in
--     any missing contact number, date hired, company or rate.
--   * Adds 5 engineers & architects, 14 skilled workers and 5
--     subcontractors. A name already on the Team is skipped.
--   * Adds 6 groups, filled by role.
--
-- Project Nica
--   * 16 phases, 19 tasks and 100 Material Breakdown lines, with labor,
--     equipment and other costs (about P1.37M against a P1.5M budget),
--     scheduled from 14 Oct 2026 to 27 Feb 2027, Monday to Saturday.
--   * Holidays and site events on the calendar.
--   * A crew on every task, matched by role. Set v_assign_crew to false to
--     skip that.
--
-- Run it once in the Supabase SQL editor, on the same Supabase project as
-- the app's .env (NEXT_PUBLIC_SUPABASE_URL). It all happens in one go: if
-- any part fails, nothing is saved. It stops if "Project Nica" already
-- exists.
--
-- Project manager and foreman: the first active ones who aren't already
-- on another unfinished project. If all of them are, it uses the first one
-- anyway, and the last column of the result below shows the overlap.
--
-- Prices: typical Batangas-area retail, 2026. Pay: daily rates (P550 to
-- P900 a day), stored as the hourly Default Rate (a day's pay / 8 hours).
-- Each task's material, other and total cost is computed here the way the
-- app computes it (lib/cost-estimate/actions.ts), so the weights are
-- correct from the start.
-- ============================================================================

do $$
declare
  v_assign_crew constant boolean := true;

  v_admin_id uuid;
  v_admin_name text;
  v_pm_id uuid;
  v_foreman_id uuid;
  v_project_id bigint;
  v_title text;
  v_category text;
  v_next int := 0;
  r record;
begin
  -- The newest tables and columns this uses (migrations 0040, 0067, 0069).
  -- Missing means the SQL editor is on a different database from the app.
  if to_regclass('public.member_groups') is null
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'workers'
                       and column_name = 'hourly_rate')
     or not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'projects'
                       and column_name = 'working_days') then
    raise exception 'This database is missing newer migrations. Is the SQL editor open on the same Supabase project as the app''s .env?';
  end if;

  if exists (select 1 from public.projects where project_name = 'Project Nica') then
    raise exception 'A project named "Project Nica" already exists. Delete or rename it first.';
  end if;

  -- Accounts -----------------------------------------------------------------
  select id, btrim(first_name || ' ' || last_name) into v_admin_id, v_admin_name
    from public.profiles
   where role in ('admin', 'super_admin') and status = 'active'
   order by role = 'admin' desc, created_at
   limit 1;

  select p.id into v_pm_id
    from public.profiles p
   where p.role = 'project_manager' and p.status = 'active'
   order by exists (select 1 from public.projects x
                     where x.project_manager_id = p.id and x.status <> 'completed'),
            p.created_at
   limit 1;

  select p.id into v_foreman_id
    from public.profiles p
   where p.role = 'foreman' and p.status = 'active'
   order by exists (select 1 from public.projects x
                     where x.foreman_id = p.id and x.status <> 'completed'),
            p.created_at
   limit 1;

  if v_admin_id is null or v_pm_id is null or v_foreman_id is null then
    raise exception 'This needs an active admin, project manager and foreman account (Manage Accounts).';
  end if;

  -- ==========================================================================
  -- TEAM
  -- ==========================================================================

  -- 1. Members already on the Team: a proper role each. A PM / foreman
  --    account keeps its account's role; a known title keeps its usual
  --    spelling; an informal one is translated; anything else gets a
  --    common role for its table. A member filed under the wrong table
  --    (e.g. an engineer under Skilled Workers) moves to the right one.
  for r in
    select w.id, w.category, p.role::text as account_role, t.title as known_title,
           lower(regexp_replace(coalesce(w.trade, ''), '[^a-zA-Z]', '', 'g')) as k
      from public.workers w
      left join public.profiles p on p.id = w.profile_id
      left join (values
        ('Project Manager'), ('Foreman'), ('Site Supervisor'), ('Timekeeper'),
        ('Warehouseman'), ('Safety Officer'), ('Architect'), ('Civil Engineer'),
        ('Structural Engineer'), ('Project Engineer'), ('Site Engineer'),
        ('Electrical Engineer'), ('Mechanical Engineer'), ('Sanitary Engineer'),
        ('Quantity Surveyor'), ('Mason'), ('Carpenter'), ('Steelman'), ('Electrician'),
        ('Plumber'), ('Welder'), ('Painter'), ('Tile Setter'), ('Equipment Operator'),
        ('Driver'), ('Helper'), ('Roofer'), ('Glass & Aluminum Installer')
      ) as t(title)
        on lower(regexp_replace(t.title, '[^a-zA-Z]', '', 'g'))
         = lower(regexp_replace(coalesce(w.trade, ''), '[^a-zA-Z]', '', 'g'))
     order by w.id
  loop
    v_title := coalesce(
      case r.account_role
        when 'project_manager' then 'Project Manager'
        when 'foreman' then 'Foreman'
      end,
      r.known_title,
      case
        when r.k ~ '(elect|elekt).*(engr|engineer)'                     then 'Electrical Engineer'
        when r.k ~ '(engr|engineer|inhinyero)'                          then 'Civil Engineer'
        when r.k ~ '(arch|arki)'                                        then 'Architect'
        when r.k ~ '(foreman|kapatas|capataz)'                          then 'Foreman'
        when r.k ~ '(karpin|karpen|carpen|anluwage|panday|pukpok)'      then 'Carpenter'
        when r.k ~ '(mason|kantero|palitada|tagahalo)'                  then 'Mason'
        when r.k ~ '(steel|bakal|barero|rebar|bender)'                  then 'Steelman'
        when r.k ~ '(weld|hinang)'                                      then 'Welder'
        when r.k ~ '(pint|paint)'                                       then 'Painter'
        when r.k ~ '(elect|elekt|kuryente)'                             then 'Electrician'
        when r.k ~ '(plumb|tubero)'                                     then 'Plumber'
        when r.k ~ '(tile|baldosa)'                                     then 'Tile Setter'
        when r.k ~ '(operator|backhoe|bakho)'                           then 'Equipment Operator'
        when r.k ~ '(driver|drayber|tsuper|tsoper)'                     then 'Driver'
        when r.k ~ '(roof|bubong)'                                      then 'Roofer'
        when r.k ~ '(helper|katulong|buhat|kargador|peon|labor|utility)' then 'Helper'
      end);

    if v_title is null then
      if r.category = 'management' then
        v_title := 'Site Supervisor';
      elsif r.category = 'professional' then
        v_title := 'Site Engineer';
      else
        v_title := (array['Mason', 'Carpenter', 'Steelman', 'Painter',
                          'Electrician', 'Plumber', 'Welder', 'Tile Setter'])[1 + v_next % 8];
        v_next := v_next + 1;
      end if;
    end if;

    v_category := case
      when r.account_role is not null then 'management'
      when v_title in ('Project Manager', 'Foreman', 'Site Supervisor', 'Timekeeper',
                       'Warehouseman', 'Safety Officer') then 'management'
      when v_title in ('Architect', 'Civil Engineer', 'Structural Engineer', 'Project Engineer',
                       'Site Engineer', 'Electrical Engineer', 'Mechanical Engineer',
                       'Sanitary Engineer', 'Quantity Surveyor') then 'professional'
      else 'skilled'
    end;

    update public.workers
       set trade = v_title, category = v_category
     where id = r.id
       and (trade is distinct from v_title or category is distinct from v_category);
  end loop;

  -- 2. New members ------------------------------------------------------------
  for r in
    select * from (values
      -- name                         role                          table           type             company                            contact          hired         P/day  hours, Mon to Sun
      ('Mark Anthony Dimaculangan',  'Project Engineer',           'professional', 'employee',      null,                              '0917 845 2361', '2019-06-03', null,  null),
      ('Kristine Joy Macalintal',    'Civil Engineer',             'professional', 'employee',      null,                              '0927 314 8852', '2021-02-15', null,  null),
      ('Ramon Katigbak',             'Structural Engineer',        'professional', 'employee',      null,                              '0918 552 0473', '2020-08-10', null,  null),
      ('Patricia Mae Mendoza',       'Architect',                  'professional', 'employee',      null,                              '0945 207 6619', '2022-01-17', null,  null),
      ('Lorenzo Ilagan',             'Site Engineer',              'professional', 'employee',      null,                              '0956 731 4408', '2023-05-08', null,  null),

      ('Rogelio Magpantay',          'Mason',                      'skilled',      'employee',      null,                              '0919 662 1047', '2018-03-12', 750,   '{8,8,8,8,8,8,0}'),
      ('Danilo Marasigan',           'Mason',                      'skilled',      'employee',      null,                              '0921 408 3395', '2019-09-02', 750,   '{8,8,8,8,8,8,0}'),
      ('Jerome Aguila',              'Mason',                      'skilled',      'employee',      null,                              '0935 117 2864', '2023-07-24', 700,   '{8,8,8,8,8,8,0}'),
      ('Ernesto Dimayuga',           'Carpenter',                  'skilled',      'employee',      null,                              '0928 770 5512', '2017-11-06', 750,   '{8,8,8,8,8,8,0}'),
      ('Arnel Landicho',             'Carpenter',                  'skilled',      'employee',      null,                              '0966 239 8170', '2021-04-19', 750,   '{8,8,8,8,8,8,0}'),
      ('Jomar Malabanan',            'Steelman',                   'skilled',      'employee',      null,                              '0977 584 0926', '2022-06-13', 700,   '{8,8,8,8,8,8,0}'),
      ('Ronaldo Comia',              'Steelman',                   'skilled',      'employee',      null,                              '0915 903 4471', '2020-10-05', 700,   '{8,8,8,8,8,8,0}'),
      ('Edwin Atienza',              'Welder',                     'skilled',      'employee',      null,                              '0929 416 7738', '2019-01-21', 800,   '{8,8,8,8,8,0,0}'),
      ('Rommel Lualhati',            'Painter',                    'skilled',      'employee',      null,                              '0947 352 6083', '2024-02-05', 700,   '{8,8,8,8,8,4,0}'),
      ('Reynaldo De Castro',         'Electrician',                'skilled',      'employee',      null,                              '0995 128 4457', '2018-08-27', 800,   '{8,8,8,8,8,8,0}'),
      ('Alvin Lontoc',               'Plumber',                    'skilled',      'employee',      null,                              '0961 470 9932', '2021-11-08', 750,   '{8,8,8,8,8,8,0}'),
      ('Joel Matibag',               'Tile Setter',                'skilled',      'employee',      null,                              '0936 815 2290', '2022-09-19', 750,   '{8,8,8,8,8,0,0}'),
      ('Noel Bathan',                'Equipment Operator',         'skilled',      'employee',      null,                              '0998 263 7105', '2020-03-16', 900,   '{8,8,8,8,8,8,0}'),
      ('Christopher Umali',          'Driver',                     'skilled',      'employee',      null,                              '0949 590 1836', '2023-01-09', 700,   '{8,8,8,8,8,8,0}'),

      ('Rodel Panganiban',           'Electrician',                'skilled',      'subcontractor', 'Bayani Electrical Services',      '0917 520 6684', '2024-03-04', null,  null),
      ('Arturo Mercado',             'Plumber',                    'skilled',      'subcontractor', 'Lipa Plumbing & Sanitary Works',  '0918 734 2259', '2023-10-16', null,  null),
      ('Jayson Castillo',            'Glass & Aluminum Installer', 'skilled',      'subcontractor', 'JMC Aluminum & Glass Works',      '0926 418 7790', '2024-06-10', null,  null),
      ('Benjie Manalo',              'Roofer',                     'skilled',      'subcontractor', 'Southern Luzon Roofing Services', '0939 602 5148', '2022-11-21', null,  null),
      ('Marlon Recio',               'Equipment Operator',         'skilled',      'subcontractor', 'RDC Heavy Equipment Rental',      '0908 345 9921', '2025-01-13', null,  null)
    ) as v(name, trade, category, employment, company, contact, hired, daily_rate, hours)
  loop
    insert into public.workers (
      full_name, trade, category, employment_type, subcontractor_company,
      contact_number, date_hired, hourly_rate, work_hours, created_by
    )
    select r.name, r.trade, r.category, r.employment, r.company,
           r.contact, r.hired::date, round(r.daily_rate / 8.0, 2),
           coalesce(r.hours, '{8,8,8,8,8,0,0}')::numeric[], v_admin_id
     where not exists (select 1 from public.workers w
                        where lower(btrim(w.full_name)) = lower(r.name));
  end loop;

  -- 3. Blanks on anyone: contact number, date hired, company, rate -----------
  update public.workers w
     set contact_number =
           (array['0917', '0918', '0919', '0921', '0927', '0928', '0935', '0945',
                  '0947', '0956', '0961', '0966', '0977', '0995', '0998'])[1 + (w.id % 15)::int]
           || ' ' || lpad(((w.id * 7919 + 311) % 1000)::text, 3, '0')
           || ' ' || lpad(((w.id * 104729 + 4421) % 10000)::text, 4, '0')
   where coalesce(btrim(w.contact_number), '') = '';

  update public.workers w
     set date_hired = date '2018-01-08' + ((w.id * 389) % 2400)::int
   where w.date_hired is null;

  update public.workers w
     set subcontractor_company = case w.trade
           when 'Electrician'                then 'Bayani Electrical Services'
           when 'Plumber'                    then 'Lipa Plumbing & Sanitary Works'
           when 'Roofer'                     then 'Southern Luzon Roofing Services'
           when 'Equipment Operator'         then 'RDC Heavy Equipment Rental'
           when 'Glass & Aluminum Installer' then 'JMC Aluminum & Glass Works'
           else 'Batangas Builders Subcontracting'
         end
   where w.employment_type = 'subcontractor'
     and coalesce(btrim(w.subcontractor_company), '') = '';

  -- Rates are for skilled employees only (subcontractors bill by contract).
  update public.workers w
     set hourly_rate = round(case w.trade
           when 'Equipment Operator' then 900
           when 'Welder'             then 800
           when 'Electrician'        then 800
           when 'Steelman'           then 700
           when 'Painter'            then 700
           when 'Driver'             then 700
           when 'Helper'             then 550
           else 750
         end / 8.0, 2)
   where w.category = 'skilled' and w.employment_type = 'employee' and w.hourly_rate is null;

  -- 4. Groups, filled by role. A group that already exists keeps its own
  --    details; only members it's missing are added.
  for r in
    select * from (values
      ('Masonry Crew',           'CHB walls, plastering and concrete pours.',
         array['Mason'],                                 '{}'::text[],                          false),
      ('Formworks & Rebar Crew', 'Formworks, scaffolding and rebar for footings, columns and beams.',
         array['Carpenter', 'Steelman', 'Welder'],       '{}'::text[],                          false),
      ('Finishing Crew',         'Ceilings, tiling and painting.',
         array['Carpenter', 'Painter', 'Tile Setter'],   '{}'::text[],                          false),
      ('MEP Team',               'Electrical and plumbing works, with our subcontractors.',
         array['Electrician', 'Plumber'],                '{}'::text[],                          true),
      ('Equipment & Hauling',    'Heavy equipment, trucking and deliveries.',
         array['Equipment Operator', 'Driver'],          '{}'::text[],                          true),
      ('Site Engineering',       'Engineers, architect and site management.',
         '{}'::text[],                                   array['professional', 'management'],  false)
    ) as v(name, description, roles, sections, with_subcontractors)
  loop
    insert into public.member_groups (name, description, created_by, created_by_name)
    select r.name, r.description, v_admin_id, v_admin_name
     where not exists (select 1 from public.member_groups g
                        where lower(btrim(g.name)) = lower(btrim(r.name)));

    insert into public.member_group_members (group_id, worker_id)
    select g.id, w.id
      from public.member_groups g
      join public.workers w
        on (w.trade = any (r.roles) or w.category = any (r.sections))
       and (r.with_subcontractors or w.employment_type = 'employee')
     where lower(btrim(g.name)) = lower(btrim(r.name))
    on conflict do nothing;
  end loop;

  -- ==========================================================================
  -- PROJECT NICA
  -- ==========================================================================

  insert into public.projects (
    project_name, location, status, start_date, target_end_date, allocated_budget,
    project_manager_id, foreman_id, created_by, working_days
  ) values (
    'Project Nica', 'Lipa City, Batangas', 'ongoing', '2026-10-14', '2027-02-27', 1500000,
    v_pm_id, v_foreman_id, v_admin_id, '{1,2,3,4,5,6}'
  )
  returning id into v_project_id;

  -- Phases, in BOM order (the app lists them in the order they're added).
  -- A phase with tasks gets its dates and costs from them. A standalone
  -- phase (no tasks) carries its own: a lump-sum material amount, or
  -- Material Breakdown lines further down (Enclosure, Formworks).
  for r in
    select * from (values
      -- phase                            priority  starts        ends          qty   unit    lump sum  labor  equipment
      ('MOBILIZATION',                    'high',   '2026-10-14', '2026-10-15', 1,    'lot',  20000,    6000,  6000),
      ('CLEARING OF AREA',                'medium', '2026-10-16', '2026-10-17', 150,  'sq.m', 5000,     4500,  0),
      ('CLEARING OF DEMOLISHED DEBRIS',   'medium', '2026-10-19', '2026-10-21', 12,   'cu.m', 15000,    6800,  8000),
      ('ENCLOSURE OF AREA',               'medium', '2026-10-16', '2026-10-21', 48,   'm',    null,     7500,  0),
      ('EARTHWORKS',                      'medium', null,         null,         null, null,   null,     null,  null),
      ('FORMWORKS & SCAFFOLDINGS',        'medium', '2026-10-26', '2026-11-28', 1,    'lot',  null,     18000, 8000),
      ('CONCRETE WORKS',                  'high',   null,         null,         null, null,   null,     null,  null),
      ('ROOF & ROOF FRAMING',             'high',   null,         null,         null, null,   null,     null,  null),
      ('CEILING WORKS',                   'medium', null,         null,         null, null,   null,     null,  null),
      ('PAINTING WORKS',                  'medium', null,         null,         null, null,   null,     null,  null),
      ('TILE WORKS',                      'medium', null,         null,         null, null,   null,     null,  null),
      ('PLUMBING',                        'medium', null,         null,         null, null,   null,     null,  null),
      ('DOORS AND WINDOWS',               'medium', null,         null,         null, null,   null,     null,  null),
      ('ELECTRICAL',                      'medium', null,         null,         null, null,   null,     null,  null),
      ('POWER TOOLS',                     'low',    '2026-10-14', '2026-10-14', 1,    'lot',  15000,    0,     0),
      ('FINAL SITE CLEARING',             'medium', '2027-02-22', '2027-02-27', 1,    'lot',  10000,    13500, 5000)
    ) as v(name, priority, starts, ends, qty, unit, lump_sum, labor, equipment)
  loop
    insert into public.estimate_categories (
      project_id, category_name, priority, planned_start_date, planned_end_date,
      estimated_quantity, unit, material_direct_amount, category_material_estimate,
      category_labor_estimate, category_equipment_estimate, category_other_estimate
    ) values (
      v_project_id, r.name, r.priority, r.starts::date, r.ends::date,
      r.qty, r.unit, r.lump_sum, coalesce(r.lump_sum, 0),
      coalesce(r.labor, 0), coalesce(r.equipment, 0), 0
    );
  end loop;

  -- Tasks, in order within each phase ----------------------------------------
  for r in
    select * from (values
      -- phase                  task                                  priority  starts        ends          qty  unit    labor  equipment
      ('EARTHWORKS',            'Excavation',                         'medium', '2026-10-22', '2026-10-28', 24,  'cu.m', 13500, 30000),
      ('EARTHWORKS',            'Backfilling / Filling & Compacting', 'medium', '2026-11-06', '2026-11-12', 31,  'cu.m', 13500, 6000),
      ('CONCRETE WORKS',        'Concrete Footings',                  'high',   '2026-10-27', '2026-11-03', 4.5, 'cu.m', 21000, 4600),
      ('CONCRETE WORKS',        'Wall Footings',                      'medium', '2026-10-30', '2026-11-05', 2.8, 'cu.m', 13500, 4600),
      ('CONCRETE WORKS',        'Concrete Column',                    'high',   '2026-11-04', '2026-11-14', 3.2, 'cu.m', 30000, 6900),
      ('CONCRETE WORKS',        'Slab on Grade',                      'medium', '2026-11-13', '2026-11-19', 60,  'sq.m', 18000, 4600),
      ('CONCRETE WORKS',        'Concrete Beams',                     'high',   '2026-11-16', '2026-11-25', 3.6, 'cu.m', 27000, 6900),
      ('CONCRETE WORKS',        'CHB Wall & Plastering',              'medium', '2026-11-23', '2026-12-12', 180, 'sq.m', 48000, 9000),
      ('ROOF & ROOF FRAMING',   'Roof Framing',                       'high',   '2026-12-09', '2026-12-17', 80,  'sq.m', 18000, 3000),
      ('ROOF & ROOF FRAMING',   'Roofing Sheets & Flashing',          'medium', '2026-12-18', '2026-12-29', 80,  'sq.m', 18000, 0),
      ('CEILING WORKS',         'Ceiling Framing & Boards',           'medium', '2027-01-04', '2027-01-09', 60,  'sq.m', 9000,  0),
      ('PAINTING WORKS',        'Wall & Ceiling Painting',            'medium', '2027-02-04', '2027-02-20', 300, 'sq.m', 33800, 0),
      ('TILE WORKS',            'Floor & Wall Tiling',                'medium', '2027-01-11', '2027-01-22', 50,  'sq.m', 16500, 0),
      ('PLUMBING',              'Septic Tank',                        'medium', '2026-11-02', '2026-11-09', 1,   'unit', 15800, 0),
      ('PLUMBING',              'Plumbing Rough-in',                  'medium', '2026-11-26', '2026-12-07', 1,   'lot',  13500, 0),
      ('PLUMBING',              'Plumbing Fixtures',                  'medium', '2027-01-25', '2027-01-30', 1,   'lot',  9000,  0),
      ('DOORS AND WINDOWS',     'Doors & Windows Installation',       'medium', '2027-01-25', '2027-02-03', 11,  'set',  13500, 0),
      ('ELECTRICAL',            'Electrical Rough-in',                'medium', '2026-11-26', '2026-12-07', 1,   'lot',  13500, 0),
      ('ELECTRICAL',            'Electrical Fixtures & Devices',      'medium', '2027-01-18', '2027-01-23', 1,   'lot',  9000,  0)
    ) as v(phase, name, priority, starts, ends, qty, unit, labor, equipment)
  loop
    insert into public.estimate_tasks (
      project_id, category_id, task_name, priority, planned_start_date, planned_end_date,
      estimated_quantity, unit, labor_estimate, equipment_estimate
    )
    select v_project_id, c.id, r.name, r.priority, r.starts::date, r.ends::date,
           r.qty, r.unit, r.labor, r.equipment
      from public.estimate_categories c
     where c.project_id = v_project_id and c.category_name = r.phase;
    if not found then
      raise exception 'Task "%" names an unknown phase "%"', r.name, r.phase;
    end if;
  end loop;

  -- Task Material Breakdown lines --------------------------------------------
  -- Concrete is Class A (1:2:4): per cu.m about 9 bags cement, 0.5 cu.m
  -- sand and 1.0 cu.m gravel. CHB walls take 12.5 blocks per sq.m.
  for r in
    select * from (values
      -- task                                 material                       specification                       qty    unit      unit cost
      ('Backfilling / Filling & Compacting',  'Filling Material (Escombro)', null,                               25,    'cu.m',   400),
      ('Backfilling / Filling & Compacting',  'Gravel Fill',                 'G1',                               6,     'cu.m',   1800),

      ('Concrete Footings',                   'Portland Cement',             'Type 1, 40 kg',                    41,    'bag',    280),
      ('Concrete Footings',                   'Washed Sand',                 'S1',                               2.3,   'cu.m',   1500),
      ('Concrete Footings',                   'Crushed Gravel',              '3/4"',                             4.5,   'cu.m',   1700),
      ('Concrete Footings',                   'Deformed Bar 12mm',           '6m, Grade 40',                     32,    'pcs',    340),
      ('Concrete Footings',                   'Tie Wire',                    '#16 GI',                           6,     'kg',     85),

      ('Wall Footings',                       'Portland Cement',             'Type 1, 40 kg',                    26,    'bag',    280),
      ('Wall Footings',                       'Washed Sand',                 'S1',                               1.4,   'cu.m',   1500),
      ('Wall Footings',                       'Crushed Gravel',              '3/4"',                             2.8,   'cu.m',   1700),
      ('Wall Footings',                       'Deformed Bar 12mm',           '6m, Grade 40',                     18,    'pcs',    340),
      ('Wall Footings',                       'Deformed Bar 10mm',           '6m, Grade 33',                     15,    'pcs',    230),
      ('Wall Footings',                       'Tie Wire',                    '#16 GI',                           4,     'kg',     85),

      ('Concrete Column',                     'Portland Cement',             'Type 1, 40 kg',                    29,    'bag',    280),
      ('Concrete Column',                     'Washed Sand',                 'S1',                               1.6,   'cu.m',   1500),
      ('Concrete Column',                     'Crushed Gravel',              '3/4"',                             3.2,   'cu.m',   1700),
      ('Concrete Column',                     'Deformed Bar 16mm',           '6m, Grade 40 (main bars)',         36,    'pcs',    580),
      ('Concrete Column',                     'Deformed Bar 10mm',           '6m, Grade 33 (ties)',              40,    'pcs',    230),
      ('Concrete Column',                     'Tie Wire',                    '#16 GI',                           8,     'kg',     85),

      ('Slab on Grade',                       'Portland Cement',             'Type 1, 40 kg',                    54,    'bag',    280),
      ('Slab on Grade',                       'Washed Sand',                 'S1',                               3,     'cu.m',   1500),
      ('Slab on Grade',                       'Crushed Gravel',              '3/4"',                             6,     'cu.m',   1700),
      ('Slab on Grade',                       'Gravel Bedding',              'G1, 100mm thick',                  6,     'cu.m',   1200),
      ('Slab on Grade',                       'Deformed Bar 10mm',           '6m, Grade 33, 0.40m both ways',    45,    'pcs',    230),
      ('Slab on Grade',                       'Tie Wire',                    '#16 GI',                           8,     'kg',     85),
      ('Slab on Grade',                       'Polyethylene Sheet',          '6 mil vapor barrier',              2,     'roll',   1250),

      ('Concrete Beams',                      'Portland Cement',             'Type 1, 40 kg',                    33,    'bag',    280),
      ('Concrete Beams',                      'Washed Sand',                 'S1',                               1.8,   'cu.m',   1500),
      ('Concrete Beams',                      'Crushed Gravel',              '3/4"',                             3.6,   'cu.m',   1700),
      ('Concrete Beams',                      'Deformed Bar 16mm',           '6m, Grade 40 (main bars)',         24,    'pcs',    580),
      ('Concrete Beams',                      'Deformed Bar 10mm',           '6m, Grade 33 (stirrups)',          30,    'pcs',    230),
      ('Concrete Beams',                      'Tie Wire',                    '#16 GI',                           10,    'kg',     85),

      ('CHB Wall & Plastering',               'Concrete Hollow Block',       '4" (100mm)',                       2250,  'pcs',    18),
      ('CHB Wall & Plastering',               'Portland Cement',             'Type 1, 40 kg',                    150,   'bag',    280),
      ('CHB Wall & Plastering',               'Washed Sand',                 'S1',                               12,    'cu.m',   1500),
      ('CHB Wall & Plastering',               'Deformed Bar 10mm',           '6m, Grade 33, 0.80m O.C.',         60,    'pcs',    230),
      ('CHB Wall & Plastering',               'Tie Wire',                    '#16 GI',                           10,    'kg',     85),

      ('Roof Framing',                        'C-Purlin',                    '2" x 4" x 1.5mm, 6m',              28,    'pcs',    750),
      ('Roof Framing',                        'Angle Bar',                   '2" x 2" x 3/16", 6m',              10,    'pcs',    980),
      ('Roof Framing',                        'Welding Rod',                 'E6013, 1/8"',                      10,    'kg',     180),
      ('Roof Framing',                        'Anchor Bolt',                 '16mm x 300mm, with nuts',          24,    'pcs',    85),
      ('Roof Framing',                        'Red Oxide Primer',            null,                               4,     'gal',    650),

      ('Roofing Sheets & Flashing',           'Long Span Roofing',           '0.4mm, pre-painted',               64,    'l.m',    340),
      ('Roofing Sheets & Flashing',           'Tekscrew',                    '2.5", box of 100',                 4,     'box',    350),
      ('Roofing Sheets & Flashing',           'Ridge Roll & Flashing',       '0.4mm, pre-painted',               6,     'pcs',    450),

      ('Ceiling Framing & Boards',            'Metal Furring',               '0.5mm, 5m',                        45,    'pcs',    85),
      ('Ceiling Framing & Boards',            'Fiber Cement Board',          '4.5mm, 4 ft x 8 ft',               21,    'sheet',  420),
      ('Ceiling Framing & Boards',            'Wall Angle',                  '0.5mm, 3m',                        20,    'pcs',    65),
      ('Ceiling Framing & Boards',            'Blind Rivets & Screws',       null,                               1,     'lot',    750),

      ('Wall & Ceiling Painting',             'Concrete Neutralizer',        null,                               6,     'gal',    450),
      ('Wall & Ceiling Painting',             'Masonry Skimcoat',            '20 kg',                            40,    'bag',    380),
      ('Wall & Ceiling Painting',             'Acrylic Masonry Primer',      null,                               12,    'gal',    820),
      ('Wall & Ceiling Painting',             'Semi-Gloss Latex Paint',      null,                               30,    'gal',    890),
      ('Wall & Ceiling Painting',             'Quick-Dry Enamel',            'doors & trims',                    6,     'gal',    980),
      ('Wall & Ceiling Painting',             'Paint Thinner',               null,                               8,     'gal',    350),
      ('Wall & Ceiling Painting',             'Brushes, Rollers & Trays',    null,                               1,     'lot',    3500),

      ('Floor & Wall Tiling',                 'Floor Tiles',                 '60 x 60 cm, 1.44 sq.m per box',    25,    'box',    620),
      ('Floor & Wall Tiling',                 'Wall Tiles',                  '30 x 60 cm, 1.44 sq.m per box',    12,    'box',    480),
      ('Floor & Wall Tiling',                 'Tile Adhesive',               '25 kg',                            10,    'bag',    280),
      ('Floor & Wall Tiling',                 'Tile Grout',                  '2 kg',                             10,    'bag',    75),

      ('Septic Tank',                         'Concrete Hollow Block',       '6" (150mm)',                       400,   'pcs',    24),
      ('Septic Tank',                         'Portland Cement',             'Type 1, 40 kg',                    40,    'bag',    280),
      ('Septic Tank',                         'Washed Sand',                 'S1',                               3,     'cu.m',   1500),
      ('Septic Tank',                         'Crushed Gravel',              '3/4"',                             2,     'cu.m',   1700),
      ('Septic Tank',                         'Deformed Bar 10mm',           '6m, Grade 33',                     30,    'pcs',    230),

      ('Plumbing Rough-in',                   'PPR Pipe',                    '20mm, 4m',                         20,    'length', 280),
      ('Plumbing Rough-in',                   'PVC Sanitary Pipe',           '4", 3m',                           12,    'length', 520),
      ('Plumbing Rough-in',                   'PVC Sanitary Pipe',           '2", 3m',                           10,    'length', 260),
      ('Plumbing Rough-in',                   'Pipe Fittings',               'elbows, tees, wyes',               1,     'lot',    9500),
      ('Plumbing Rough-in',                   'PVC Solvent Cement',          '400cc',                            4,     'can',    220),
      ('Plumbing Rough-in',                   'Teflon Tape',                 null,                               20,    'pcs',    25),

      ('Plumbing Fixtures',                   'Water Closet',                'complete set',                     2,     'set',    6500),
      ('Plumbing Fixtures',                   'Lavatory with Faucet',        null,                               2,     'set',    3800),
      ('Plumbing Fixtures',                   'Kitchen Sink with Faucet',    'stainless',                        1,     'set',    6500),
      ('Plumbing Fixtures',                   'Shower Set',                  null,                               2,     'set',    2800),
      ('Plumbing Fixtures',                   'Floor Drain',                 '4"',                               4,     'pcs',    350),
      ('Plumbing Fixtures',                   'Water Tank',                  '1,000 L, polyethylene',            1,     'pc',     9500),

      ('Doors & Windows Installation',        'Panel Door with Jamb',        '0.80 x 2.10m, solid wood',         3,     'set',    6500),
      ('Doors & Windows Installation',        'Flush Door with Jamb',        '0.70 x 2.10m',                     2,     'set',    3800),
      ('Doors & Windows Installation',        'Aluminum Sliding Window',     'with 6mm clear glass',             6,     'set',    4200),
      ('Doors & Windows Installation',        'Door Lockset',                'keyed',                            5,     'pcs',    950),
      ('Doors & Windows Installation',        'Butt Hinges',                 '4"',                               10,    'pair',   220),

      ('Electrical Rough-in',                 'PVC Conduit',                 '20mm, 3m',                         60,    'pcs',    75),
      ('Electrical Rough-in',                 'THHN Wire',                   '3.5 sq.mm, 150m roll',             2,     'roll',   4300),
      ('Electrical Rough-in',                 'THHN Wire',                   '2.0 sq.mm, 150m roll',             2,     'roll',   2600),
      ('Electrical Rough-in',                 'Utility & Junction Boxes',    null,                               40,    'pcs',    35),
      ('Electrical Rough-in',                 'Panel Board with Breakers',   '8 branches',                       1,     'set',    6800),

      ('Electrical Fixtures & Devices',       'LED Downlight',               '6", 12W',                          20,    'pcs',    380),
      ('Electrical Fixtures & Devices',       'Wall Switch',                 '1- and 2-gang',                    15,    'pcs',    180),
      ('Electrical Fixtures & Devices',       'Convenience Outlet',          'duplex',                           20,    'pcs',    220),
      ('Electrical Fixtures & Devices',       'Aircon Outlet',               '220V',                             3,     'pcs',    450)
    ) as v(task, material, spec, qty, unit, unit_cost)
  loop
    insert into public.estimate_task_material_assignments
      (task_id, material_name, specification, planned_quantity, unit, unit_cost)
    select t.id, r.material, r.spec, r.qty, r.unit, r.unit_cost
      from public.estimate_tasks t
     where t.project_id = v_project_id and t.task_name = r.task;
    if not found then
      raise exception 'Material "%" names an unknown task "%"', r.material, r.task;
    end if;
  end loop;

  -- Standalone phases' Material Breakdown lines -------------------------------
  for r in
    select * from (values
      -- phase                       material              specification           qty  unit     unit cost
      ('ENCLOSURE OF AREA',          'Plain GI Sheet',     'Ga. 26, 8 ft',         24,  'pcs',   420),
      ('ENCLOSURE OF AREA',          'Coco Lumber',        '2" x 3" x 10 ft',      30,  'pcs',   120),
      ('ENCLOSURE OF AREA',          'Common Wire Nails',  '3"',                   5,   'kg',    75),
      ('ENCLOSURE OF AREA',          'Umbrella Nails',     '2.5"',                 4,   'kg',    120),

      ('FORMWORKS & SCAFFOLDINGS',   'Marine Plywood',     '1/2", 4 ft x 8 ft',    30,  'sheet', 850),
      ('FORMWORKS & SCAFFOLDINGS',   'Coco Lumber',        '2" x 2" x 12 ft',      150, 'pcs',   95),
      ('FORMWORKS & SCAFFOLDINGS',   'Coco Lumber',        '2" x 3" x 12 ft',      60,  'pcs',   140),
      ('FORMWORKS & SCAFFOLDINGS',   'Common Wire Nails',  'assorted',             20,  'kg',    75),
      ('FORMWORKS & SCAFFOLDINGS',   'Form Oil',           null,                   2,   'gal',   450)
    ) as v(phase, material, spec, qty, unit, unit_cost)
  loop
    insert into public.estimate_category_material_assignments
      (category_id, material_name, specification, planned_quantity, unit, unit_cost)
    select c.id, r.material, r.spec, r.qty, r.unit, r.unit_cost
      from public.estimate_categories c
     where c.project_id = v_project_id and c.category_name = r.phase;
    if not found then
      raise exception 'Material "%" names an unknown phase "%"', r.material, r.phase;
    end if;
  end loop;

  -- Other costs, itemized ----------------------------------------------------
  for r in
    select * from (values
      ('Excavation',           'Hauling of excess soil (4 trips)', 10000),
      ('Concrete Footings',    'Concrete cylinder test',           1500),
      ('Concrete Column',      'Concrete cylinder test',           1500),
      ('Slab on Grade',        'Concrete cylinder test',           1500),
      ('Plumbing Rough-in',    'Plumbing permit',                  2500),
      ('Electrical Rough-in',  'Electrical permit & inspection',   3500)
    ) as v(task, cost_name, amount)
  loop
    insert into public.estimate_task_other_costs (task_id, cost_name, amount)
    select t.id, r.cost_name, r.amount
      from public.estimate_tasks t
     where t.project_id = v_project_id and t.task_name = r.task;
    if not found then
      raise exception 'Other cost "%" names an unknown task "%"', r.cost_name, r.task;
    end if;
  end loop;

  -- Stored totals, the way the app computes them: material = its lines,
  -- other = its items, total = labor + material + equipment + other.
  update public.estimate_tasks t
     set material_estimate = coalesce((
           select sum(coalesce(m.amount, m.planned_quantity * m.unit_cost))
             from public.estimate_task_material_assignments m
            where m.task_id = t.id), 0),
         other_cost_estimate = coalesce((
           select sum(o.amount)
             from public.estimate_task_other_costs o
            where o.task_id = t.id), 0)
   where t.project_id = v_project_id;

  update public.estimate_tasks
     set total_estimate_cost = labor_estimate + material_estimate + equipment_estimate + other_cost_estimate
   where project_id = v_project_id;

  update public.estimate_categories c
     set category_material_estimate = (
           select sum(coalesce(m.amount, m.planned_quantity * m.unit_cost))
             from public.estimate_category_material_assignments m
            where m.category_id = c.id)
   where c.project_id = v_project_id
     and exists (select 1 from public.estimate_category_material_assignments m
                  where m.category_id = c.id);

  -- Calendar events. A holiday is also a day off: a trigger copies the
  -- holiday dates to projects.holidays (0055_project_events.sql).
  for r in
    select * from (values
      -- type          name                                       date          starts   ends
      ('meeting',      'Kick-off meeting with the client',        '2026-10-14', '09:00', '10:00'),
      ('delivery',     'Delivery: GI sheets & coco lumber',       '2026-10-15', null,    null),
      ('meeting',      'Weekly site meeting',                     '2026-10-19', '08:00', '09:00'),
      ('delivery',     'Delivery: cement, sand & gravel',         '2026-10-24', null,    null),
      ('delivery',     'Delivery: deformed bars & tie wire',      '2026-10-24', null,    null),
      ('meeting',      'Weekly site meeting',                     '2026-10-26', '08:00', '09:00'),
      ('inspection',   'Rebar inspection: footings',              '2026-10-31', null,    null),
      ('meeting',      'Weekly site meeting',                     '2026-11-02', '08:00', '09:00'),
      ('delivery',     'Delivery: CHB',                           '2026-11-21', null,    null),
      ('inspection',   'Structural inspection: columns & beams',  '2026-11-25', null,    null),
      ('holiday',      'Bonifacio Day',                           '2026-11-30', null,    null),
      ('delivery',     'Delivery: roofing materials',             '2026-12-07', null,    null),
      ('holiday',      'Feast of the Immaculate Conception',      '2026-12-08', null,    null),
      ('holiday',      'Christmas Eve',                           '2026-12-24', null,    null),
      ('holiday',      'Christmas Day',                           '2026-12-25', null,    null),
      ('holiday',      'Rizal Day',                               '2026-12-30', null,    null),
      ('holiday',      'Last Day of the Year',                    '2026-12-31', null,    null),
      ('holiday',      'New Year''s Day',                         '2027-01-01', null,    null),
      ('inspection',   'Final inspection & turnover',             '2027-02-27', null,    null)
    ) as v(event_type, name, event_date, starts, ends)
  loop
    insert into public.project_events
      (project_id, event_type, name, event_date, start_time, end_time, created_by)
    values
      (v_project_id, r.event_type, r.name, r.event_date::date, r.starts::time, r.ends::time, v_admin_id);
  end loop;

  -- Crew, matched by role: the first members with that role (oldest on the
  -- Team first) go on each standalone phase or task.
  if v_assign_crew then
    for r in
      select * from (values
        -- phase or task                         role                          type             how many
        ('MOBILIZATION',                         'Driver',                     'employee',      1),
        ('MOBILIZATION',                         'Carpenter',                  'employee',      2),
        ('CLEARING OF AREA',                     'Mason',                      'employee',      3),
        ('CLEARING OF DEMOLISHED DEBRIS',        'Equipment Operator',         'employee',      1),
        ('CLEARING OF DEMOLISHED DEBRIS',        'Driver',                     'employee',      1),
        ('ENCLOSURE OF AREA',                    'Carpenter',                  'employee',      2),
        ('FORMWORKS & SCAFFOLDINGS',             'Carpenter',                  'employee',      2),
        ('Excavation',                           'Equipment Operator',         'subcontractor', 1),
        ('Excavation',                           'Mason',                      'employee',      2),
        ('Backfilling / Filling & Compacting',   'Equipment Operator',         'employee',      1),
        ('Backfilling / Filling & Compacting',   'Mason',                      'employee',      2),
        ('Concrete Footings',                    'Mason',                      'employee',      3),
        ('Concrete Footings',                    'Steelman',                   'employee',      2),
        ('Wall Footings',                        'Mason',                      'employee',      2),
        ('Wall Footings',                        'Steelman',                   'employee',      2),
        ('Concrete Column',                      'Mason',                      'employee',      3),
        ('Concrete Column',                      'Steelman',                   'employee',      2),
        ('Slab on Grade',                        'Mason',                      'employee',      3),
        ('Slab on Grade',                        'Steelman',                   'employee',      1),
        ('Concrete Beams',                       'Mason',                      'employee',      3),
        ('Concrete Beams',                       'Steelman',                   'employee',      2),
        ('CHB Wall & Plastering',                'Mason',                      'employee',      3),
        ('Roof Framing',                         'Welder',                     'employee',      1),
        ('Roof Framing',                         'Carpenter',                  'employee',      2),
        ('Roofing Sheets & Flashing',            'Roofer',                     'subcontractor', 1),
        ('Roofing Sheets & Flashing',            'Carpenter',                  'employee',      1),
        ('Ceiling Framing & Boards',             'Carpenter',                  'employee',      2),
        ('Wall & Ceiling Painting',              'Painter',                    'employee',      2),
        ('Floor & Wall Tiling',                  'Tile Setter',                'employee',      2),
        ('Septic Tank',                          'Mason',                      'employee',      2),
        ('Septic Tank',                          'Plumber',                    'employee',      1),
        ('Plumbing Rough-in',                    'Plumber',                    'employee',      1),
        ('Plumbing Rough-in',                    'Plumber',                    'subcontractor', 1),
        ('Plumbing Fixtures',                    'Plumber',                    'employee',      1),
        ('Plumbing Fixtures',                    'Plumber',                    'subcontractor', 1),
        ('Doors & Windows Installation',         'Carpenter',                  'employee',      2),
        ('Doors & Windows Installation',         'Glass & Aluminum Installer', 'subcontractor', 1),
        ('Electrical Rough-in',                  'Electrician',                'employee',      1),
        ('Electrical Rough-in',                  'Electrician',                'subcontractor', 1),
        ('Electrical Fixtures & Devices',        'Electrician',                'employee',      1),
        ('Electrical Fixtures & Devices',        'Electrician',                'subcontractor', 1),
        ('FINAL SITE CLEARING',                  'Mason',                      'employee',      2),
        ('FINAL SITE CLEARING',                  'Driver',                     'employee',      1)
      ) as v(target, trade, employment, how_many)
    loop
      if not exists (select 1 from public.estimate_categories c
                      where c.project_id = v_project_id and c.category_name = r.target)
         and not exists (select 1 from public.estimate_tasks t
                          where t.project_id = v_project_id and t.task_name = r.target) then
        raise exception 'Crew row names an unknown phase or task "%"', r.target;
      end if;

      insert into public.category_worker_assignments (category_id, worker_id)
      select c.id, w.id
        from public.estimate_categories c
       cross join lateral (select id from public.workers
                            where trade = r.trade and employment_type = r.employment
                            order by id
                            limit r.how_many) w
       where c.project_id = v_project_id and c.category_name = r.target
      on conflict do nothing;

      insert into public.task_worker_assignments (task_id, worker_id)
      select t.id, w.id
        from public.estimate_tasks t
       cross join lateral (select id from public.workers
                            where trade = r.trade and employment_type = r.employment
                            order by id
                            limit r.how_many) w
       where t.project_id = v_project_id and t.task_name = r.target
      on conflict do nothing;
    end loop;
  end if;
end $$;

-- What was created.
select p.project_name,
       pm.first_name || ' ' || pm.last_name as project_manager,
       fm.first_name || ' ' || fm.last_name as foreman,
       (select count(*) from public.estimate_categories c where c.project_id = p.id) as phases,
       (select count(*) from public.estimate_tasks t where t.project_id = p.id) as tasks,
       (select coalesce(sum(t.total_estimate_cost), 0) from public.estimate_tasks t
         where t.project_id = p.id)
     + (select coalesce(sum(c.category_labor_estimate + c.category_material_estimate
                            + c.category_equipment_estimate + c.category_other_estimate), 0)
          from public.estimate_categories c
         where c.project_id = p.id
           and not exists (select 1 from public.estimate_tasks t where t.category_id = c.id))
       as total_estimate,
       p.allocated_budget,
       (select count(*) from public.workers
         where category = 'skilled' and employment_type = 'employee') as skilled_workers,
       (select count(*) from public.workers
         where category = 'professional' and employment_type = 'employee') as engineers_architects,
       (select count(*) from public.workers
         where employment_type = 'subcontractor') as subcontractors,
       (select count(*) from public.member_groups) as groups,
       (select count(*) from public.task_worker_assignments a
          join public.estimate_tasks t on t.id = a.task_id where t.project_id = p.id)
     + (select count(*) from public.category_worker_assignments a
          join public.estimate_categories c on c.id = a.category_id where c.project_id = p.id)
       as crew_assignments,
       (select string_agg(x.project_name, ', ')
          from public.projects x
         where x.id <> p.id and x.status <> 'completed'
           and (x.project_manager_id = p.project_manager_id or x.foreman_id = p.foreman_id))
       as pm_or_foreman_also_on
  from public.projects p
  join public.profiles pm on pm.id = p.project_manager_id
  join public.profiles fm on fm.id = p.foreman_id
 where p.project_name = 'Project Nica';
