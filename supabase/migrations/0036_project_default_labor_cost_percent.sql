  -- ============================================================================
  -- Per-project "Default Labor Cost %" (adviser feedback) — a rule-of-thumb
  -- ratio the Cost Estimate Breakdown's Task Form uses to auto-fill a task's
  -- Labor Estimate as this % of (Material + Equipment + Other), instead of
  -- the admin typing every labor cost from scratch. Still fully editable per
  -- task — this is just a starting suggestion, not an enforced constraint.
  -- ============================================================================

  alter table public.projects
    add column if not exists default_labor_cost_percent numeric
      check (default_labor_cost_percent is null or default_labor_cost_percent between 0 and 100);
