import type { UserRole } from "@/lib/auth/roles";

export type ProjectStatus = "planning" | "ongoing" | "completed";

/**
 * Hand-written subset of the generated Supabase database types, covering
 * just what the auth feature needs. Once the schema grows, replace this
 * with `supabase gen types typescript` output.
 */
export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          first_name: string;
          last_name: string;
          role: UserRole;
          status: "active" | "inactive";
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string;
          first_name?: string;
          last_name?: string;
          role?: UserRole;
          status?: "active" | "inactive";
        };
        Update: {
          email?: string;
          first_name?: string;
          last_name?: string;
          role?: UserRole;
          status?: "active" | "inactive";
        };
        Relationships: [];
      };
      projects: {
        Row: {
          id: number;
          project_name: string;
          location: string | null;
          allocated_budget: number | null;
          default_labor_cost_percent: number | null;
          start_date: string | null;
          target_end_date: string | null;
          actual_end_date: string | null;
          status: ProjectStatus;
          project_manager_id: string;
          foreman_id: string;
          created_by: string;
          created_at: string | null;
          updated_at: string | null;
          /** The gantt_snapshots row the project's own schedule/cost data
           * currently matches — see lib/cost-estimate/undo-redo.ts. Null
           * means no undo/redo history has been recorded for this project
           * yet (never been through a tracked mutating action). */
          gantt_undo_cursor_id: number | null;
          /** ISO weekday numbers (1=Monday..7=Sunday) that count toward
           * Automatic Progress Completion's own working-day math — see
           * 0040_task_progress_tracking.sql. */
          working_days: number[];
        };
        Insert: {
          project_name: string;
          location?: string | null;
          allocated_budget?: number | null;
          default_labor_cost_percent?: number | null;
          start_date?: string | null;
          target_end_date?: string | null;
          actual_end_date?: string | null;
          status?: ProjectStatus;
          project_manager_id: string;
          foreman_id: string;
          created_by: string;
          working_days?: number[];
        };
        Update: {
          project_name?: string;
          location?: string | null;
          allocated_budget?: number | null;
          default_labor_cost_percent?: number | null;
          start_date?: string | null;
          target_end_date?: string | null;
          actual_end_date?: string | null;
          status?: ProjectStatus;
          project_manager_id?: string;
          foreman_id?: string;
          gantt_undo_cursor_id?: number | null;
          working_days?: number[];
        };
        Relationships: [];
      };
      estimate_categories: {
        // Row's numeric fields are nullable even though the DB column is
        // meant to be `not null default 0` — these tables were hand-built
        // before migration 0005, which only sets that default/constraint
        // on genuinely NEW columns (`add column if not exists` no-ops on
        // ones that already existed). Every reader must coalesce to 0.
        Row: {
          id: number;
          project_id: number;
          category_name: string;
          weight: number | null;
          /** See 0042_category_direct_cost.sql's own comment — a
           * category's own direct BOM line, same reasoning as a task's
           * own material_direct_quantity/unit/material_unit_cost. */
          material_direct_quantity: number | null;
          material_direct_unit: string | null;
          material_unit_cost: number | null;
          category_material_estimate: number | null;
          /** See 0043_amount_overrides.sql's own comment — null means
           * "compute from quantity * unit cost as normal"; a non-null
           * value means the Amount cell was typed directly (no clean
           * quantity/unit cost breakdown), so use this instead. */
          material_direct_amount: number | null;
          /** See 0044_category_schedule.sql's own comment — only used
           * while this category has no tasks yet; once it does, its own
           * start/end is a rollup of theirs instead (see
           * gantt-chart-view.tsx's own `tasks` useMemo). */
          planned_start_date: string | null;
          planned_end_date: string | null;
          /** See 0046_category_priority.sql's own comment — always
           * directly set, never a rollup of its tasks' own priorities. */
          priority: string;
          /** See 0047_category_labor_estimate.sql's own comment — only
           * used while this category has no tasks yet; once it does,
           * the Labor Breakdown modal shows their rolled-up total
           * instead (see LaborBreakdownModalContent's own doc comment). */
          category_labor_estimate: number | null;
          /** See 0048_category_progress_tracking.sql's own comment —
           * only used while this category has no tasks yet, same
           * asymmetric rule as planned_start_date/category_labor_estimate
           * above. */
          estimated_quantity: number | null;
          unit: string | null;
        };
        Insert: {
          // Only ever set explicitly by the undo/redo restore path (see
          // lib/cost-estimate/undo-redo.ts), to re-create a row with its
          // original id rather than a fresh one from the identity
          // sequence — see 0037_gantt_undo_redo.sql's own comment for why
          // that matters (predecessor_task_id and other references would
          // otherwise silently break across an undo/redo round trip).
          // Every other insert call in the app omits this, same as before.
          id?: number;
          project_id: number;
          category_name: string;
          weight?: number;
          material_direct_quantity?: number;
          material_direct_unit?: string | null;
          material_unit_cost?: number;
          category_material_estimate?: number;
          material_direct_amount?: number | null;
          planned_start_date?: string | null;
          planned_end_date?: string | null;
          priority?: string;
          category_labor_estimate?: number;
          estimated_quantity?: number | null;
          unit?: string | null;
        };
        Update: {
          category_name?: string;
          weight?: number;
          material_direct_quantity?: number;
          material_direct_unit?: string | null;
          material_unit_cost?: number;
          category_material_estimate?: number;
          material_direct_amount?: number | null;
          planned_start_date?: string | null;
          planned_end_date?: string | null;
          priority?: string;
          category_labor_estimate?: number;
          estimated_quantity?: number | null;
          unit?: string | null;
        };
        Relationships: [];
      };
      estimate_tasks: {
        // See estimate_categories above — Row's numeric fields are
        // nullable in practice, so every reader must coalesce to 0.
        Row: {
          id: number;
          project_id: number;
          category_id: number;
          task_name: string;
          estimated_quantity: number | null;
          unit: string | null;
          labor_estimate: number | null;
          material_estimate: number | null;
          equipment_estimate: number | null;
          other_cost_estimate: number | null;
          total_estimate_cost: number | null;
          weight: number | null;
          planned_start_date: string | null;
          planned_end_date: string | null;
          predecessor_task_id: number | null;
          is_milestone: boolean;
          priority: string;
          percent_complete: number;
          /** See 0041_material_line_costs.sql's own comment — a task's
           * own direct BOM line (no material breakdown), deliberately
           * separate from estimated_quantity/unit above. */
          material_direct_quantity: number | null;
          material_direct_unit: string | null;
          material_unit_cost: number | null;
          /** See 0043_amount_overrides.sql's own comment — same as
           * CostCategory's own material_direct_amount, one level down. */
          material_direct_amount: number | null;
        };
        Insert: {
          // See estimate_categories.Insert's own comment on `id` above —
          // same reasoning, same restore-only caller.
          id?: number;
          project_id: number;
          category_id: number;
          task_name: string;
          estimated_quantity?: number;
          unit?: string | null;
          labor_estimate?: number;
          material_estimate?: number;
          equipment_estimate?: number;
          other_cost_estimate?: number;
          total_estimate_cost?: number;
          weight?: number;
          planned_start_date?: string | null;
          planned_end_date?: string | null;
          predecessor_task_id?: number | null;
          is_milestone?: boolean;
          priority?: string;
          percent_complete?: number;
          material_direct_quantity?: number;
          material_direct_unit?: string | null;
          material_unit_cost?: number;
          material_direct_amount?: number | null;
        };
        Update: {
          category_id?: number;
          task_name?: string;
          estimated_quantity?: number;
          unit?: string | null;
          labor_estimate?: number;
          material_estimate?: number;
          equipment_estimate?: number;
          other_cost_estimate?: number;
          total_estimate_cost?: number;
          weight?: number;
          planned_start_date?: string | null;
          planned_end_date?: string | null;
          predecessor_task_id?: number | null;
          is_milestone?: boolean;
          priority?: string;
          percent_complete?: number;
          material_direct_quantity?: number;
          material_direct_unit?: string | null;
          material_unit_cost?: number;
          material_direct_amount?: number | null;
        };
        Relationships: [];
      };
      estimate_task_material_assignments: {
        Row: {
          id: number;
          task_id: number;
          material_name: string;
          specification: string | null;
          planned_quantity: number;
          unit: string | null;
          /** See 0041_material_line_costs.sql's own comment — this
           * line's own $/unit rate; Amount = planned_quantity * this. */
          unit_cost: number;
          /** See 0043_amount_overrides.sql's own comment — null means
           * "compute planned_quantity * unit_cost as normal"; a non-null
           * value means Amount was typed directly on this line. */
          amount: number | null;
          created_at: string;
        };
        Insert: {
          // See estimate_categories.Insert's own comment on `id` above.
          id?: number;
          task_id: number;
          material_name: string;
          specification?: string | null;
          planned_quantity?: number;
          unit?: string | null;
          unit_cost?: number;
          amount?: number | null;
        };
        Update: {
          material_name?: string;
          specification?: string | null;
          planned_quantity?: number;
          unit?: string | null;
          unit_cost?: number;
          amount?: number | null;
        };
        Relationships: [];
      };
      estimate_task_labor_assignments: {
        Row: {
          id: number;
          task_id: number;
          worker_role: string;
          planned_worker_count: number;
          created_at: string;
        };
        Insert: {
          // See estimate_categories.Insert's own comment on `id` above.
          id?: number;
          task_id: number;
          worker_role: string;
          planned_worker_count?: number;
        };
        Update: {
          worker_role?: string;
          planned_worker_count?: number;
        };
        Relationships: [];
      };
      estimate_task_other_costs: {
        // A task's freely-added "Other cost" line items (Permit Fee,
        // Delivery Fee, ...) — a proper one-to-many relationship to
        // estimate_tasks rather than a jsonb blob, since every task's
        // set of other costs is independent of every other task's.
        Row: {
          id: number;
          task_id: number;
          cost_name: string;
          amount: number | null;
        };
        Insert: {
          // See estimate_categories.Insert's own comment on `id` above.
          id?: number;
          task_id: number;
          cost_name: string;
          amount?: number;
        };
        Update: {
          cost_name?: string;
          amount?: number;
        };
        Relationships: [];
      };
      gantt_snapshots: {
        // See lib/cost-estimate/undo-redo.ts — an append-only per-project
        // history log powering the Gantt Chart's Undo/Redo. `snapshot` is
        // a full raw-row capture of the project's estimate_categories/
        // estimate_tasks (+ their 3 child tables) at that point in time;
        // typed loosely (unknown) since its shape is this app's own
        // GanttSnapshot type, not something Postgres itself constrains.
        Row: {
          id: number;
          project_id: number;
          snapshot: unknown;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          project_id: number;
          snapshot: unknown;
          created_by?: string | null;
        };
        Update: never;
        Relationships: [];
      };
      workers: {
        // The Gantt Chart's own "Manpower" roster (its own toolbar
        // button, next to Undo/Redo) — real named people currently or
        // soon working on one project, for task-level accountability.
        // Deliberately separate from estimate_task_labor_assignments'
        // role+headcount tally (a cost-estimation input, not this).
        Row: {
          id: number;
          project_id: number;
          full_name: string;
          trade: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          project_id: number;
          full_name: string;
          trade?: string | null;
          created_by?: string | null;
        };
        Update: {
          full_name?: string;
          trade?: string | null;
        };
        Relationships: [];
      };
      task_worker_assignments: {
        // Many-to-many: a task can have several workers, a worker can
        // appear on several tasks. Powers the Gantt task list's own
        // "Assigned" column.
        Row: {
          id: number;
          task_id: number;
          worker_id: number;
          created_at: string;
        };
        Insert: {
          task_id: number;
          worker_id: number;
        };
        Update: never;
        Relationships: [];
      };
      category_worker_assignments: {
        // Same idea as task_worker_assignments above, one level up — see
        // 0045_category_worker_assignments.sql.
        Row: {
          id: number;
          category_id: number;
          worker_id: number;
          created_at: string;
        };
        Insert: {
          category_id: number;
          worker_id: number;
        };
        Update: never;
        Relationships: [];
      };
      task_progress_entries: {
        // One row per task per calendar day a Progress Tracking Override
        // was recorded — see 0040_task_progress_tracking.sql.
        // quantity_completed is that day's own increment, not a running
        // total.
        Row: {
          id: number;
          task_id: number;
          entry_date: string;
          quantity_completed: number;
          labor_headcount: number;
          recorded_by: string | null;
          created_at: string;
        };
        Insert: {
          task_id: number;
          entry_date: string;
          quantity_completed?: number;
          labor_headcount?: number;
          recorded_by?: string | null;
        };
        Update: {
          quantity_completed?: number;
          labor_headcount?: number;
        };
        Relationships: [];
      };
      task_progress_material_usage: {
        // Materials consumed on one task_progress_entries row's own day
        // — each one is a real project_materials.quantity deduction, see
        // recordTaskProgress in lib/task-progress/actions.ts.
        Row: {
          id: number;
          progress_entry_id: number;
          material_id: number;
          quantity: number;
        };
        Insert: {
          progress_entry_id: number;
          material_id: number;
          quantity?: number;
        };
        Update: never;
        Relationships: [];
      };
      category_progress_entries: {
        // Same idea as task_progress_entries above, one level up — see
        // 0048_category_progress_tracking.sql.
        Row: {
          id: number;
          category_id: number;
          entry_date: string;
          quantity_completed: number;
          labor_headcount: number;
          recorded_by: string | null;
          created_at: string;
        };
        Insert: {
          category_id: number;
          entry_date: string;
          quantity_completed?: number;
          labor_headcount?: number;
          recorded_by?: string | null;
        };
        Update: {
          quantity_completed?: number;
          labor_headcount?: number;
        };
        Relationships: [];
      };
      category_progress_material_usage: {
        // Same idea as task_progress_material_usage above, one level up
        // — see 0048_category_progress_tracking.sql.
        Row: {
          id: number;
          progress_entry_id: number;
          material_id: number;
          quantity: number;
        };
        Insert: {
          progress_entry_id: number;
          material_id: number;
          quantity?: number;
        };
        Update: never;
        Relationships: [];
      };
      // The tables below (progress tracking, materials, equipment,
      // expenses) have no app code reading/writing them yet — the
      // "Progress"/"Materials"/"Equipment"/"Expenses" tabs are still
      // placeholders. Typed now so building those features later doesn't
      // require retrofitting this file from scratch.
      daily_logs: {
        Row: {
          id: number;
          project_id: number;
          submitted_by: string;
          log_date: string;
          status: "pending" | "approved" | "rejected";
          notes: string | null;
          reviewed_by: string | null;
          reviewed_at: string | null;
          accidents_occurred: boolean | null;
          accidents_notes: string | null;
          schedule_delays_occurred: boolean | null;
          schedule_delays_notes: string | null;
          weather_delays_occurred: boolean | null;
          weather_delays_notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          project_id: number;
          submitted_by: string;
          log_date?: string;
          status?: "pending" | "approved" | "rejected";
          notes?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          accidents_occurred?: boolean | null;
          accidents_notes?: string | null;
          schedule_delays_occurred?: boolean | null;
          schedule_delays_notes?: string | null;
          weather_delays_occurred?: boolean | null;
          weather_delays_notes?: string | null;
        };
        Update: {
          status?: "pending" | "approved" | "rejected";
          notes?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          accidents_occurred?: boolean | null;
          accidents_notes?: string | null;
          schedule_delays_occurred?: boolean | null;
          schedule_delays_notes?: string | null;
          weather_delays_occurred?: boolean | null;
          weather_delays_notes?: string | null;
        };
        Relationships: [];
      };
      daily_log_work_items: {
        Row: {
          id: number;
          daily_log_id: number;
          category_id: number;
          task_id: number;
          quantity_completed: number;
          unit: string | null;
          activity: string | null;
          attachment_paths: string[];
          created_at: string;
        };
        Insert: {
          daily_log_id: number;
          category_id: number;
          task_id: number;
          quantity_completed?: number;
          unit?: string | null;
          activity?: string | null;
          attachment_paths?: string[];
        };
        Update: {
          category_id?: number;
          task_id?: number;
          quantity_completed?: number;
          unit?: string | null;
          activity?: string | null;
          attachment_paths?: string[];
        };
        Relationships: [];
      };
      daily_log_labor_items: {
        Row: {
          id: number;
          daily_log_id: number;
          worker_role: string;
          worker_count: number;
          daily_rate: number;
          ot_hours: number;
          workers_rendered_overtime: number;
          workers_rendered_halfday: number;
          attachment_paths: string[];
          remarks: string | null;
          created_at: string;
        };
        Insert: {
          daily_log_id: number;
          worker_role: string;
          worker_count?: number;
          daily_rate?: number;
          ot_hours?: number;
          workers_rendered_overtime?: number;
          workers_rendered_halfday?: number;
          attachment_paths?: string[];
          remarks?: string | null;
        };
        Update: {
          worker_role?: string;
          worker_count?: number;
          daily_rate?: number;
          ot_hours?: number;
          workers_rendered_overtime?: number;
          workers_rendered_halfday?: number;
          attachment_paths?: string[];
          remarks?: string | null;
        };
        Relationships: [];
      };
      daily_log_material_procurement: {
        Row: {
          id: number;
          daily_log_id: number;
          procurement_type: "direct_purchase" | "supplier_delivery";
          supplier_name: string | null;
          material_request_id: number | null;
          additional_fees: number;
          attachment_paths: string[];
          remarks: string | null;
          created_at: string;
        };
        Insert: {
          daily_log_id: number;
          procurement_type?: "direct_purchase" | "supplier_delivery";
          supplier_name?: string | null;
          material_request_id?: number | null;
          additional_fees?: number;
          attachment_paths?: string[];
          remarks?: string | null;
        };
        Update: {
          procurement_type?: "direct_purchase" | "supplier_delivery";
          supplier_name?: string | null;
          material_request_id?: number | null;
          additional_fees?: number;
          attachment_paths?: string[];
          remarks?: string | null;
        };
        Relationships: [];
      };
      daily_log_material_procurement_items: {
        Row: {
          id: number;
          procurement_id: number;
          material_request_item_id: number | null;
          material_name: string;
          specification: string | null;
          quantity: number;
          unit: string | null;
          cost: number;
          created_at: string;
        };
        Insert: {
          procurement_id: number;
          material_request_item_id?: number | null;
          material_name: string;
          specification?: string | null;
          quantity?: number;
          unit?: string | null;
          cost?: number;
        };
        Update: {
          material_request_item_id?: number | null;
          material_name?: string;
          specification?: string | null;
          quantity?: number;
          unit?: string | null;
          cost?: number;
        };
        Relationships: [];
      };
      daily_log_equipment_acquisition: {
        Row: {
          id: number;
          daily_log_id: number;
          equipment_request_id: number | null;
          equipment_request_item_id: number | null;
          equipment_name: string;
          specification: string | null;
          quantity: number;
          acquisition_type: "rental" | "purchase";
          amount: number;
          attachment_paths: string[];
          remarks: string | null;
          created_at: string;
        };
        Insert: {
          daily_log_id: number;
          equipment_request_id?: number | null;
          equipment_request_item_id?: number | null;
          equipment_name: string;
          specification?: string | null;
          quantity?: number;
          acquisition_type?: "rental" | "purchase";
          amount?: number;
          attachment_paths?: string[];
          remarks?: string | null;
        };
        Update: {
          equipment_request_id?: number | null;
          equipment_request_item_id?: number | null;
          equipment_name?: string;
          specification?: string | null;
          quantity?: number;
          acquisition_type?: "rental" | "purchase";
          amount?: number;
          attachment_paths?: string[];
          remarks?: string | null;
        };
        Relationships: [];
      };
      daily_log_entry_flags: {
        Row: {
          id: number;
          daily_log_id: number;
          entry_type:
            | "work_item"
            | "labor_item"
            | "expense_item"
            | "material_usage_item"
            | "material_procurement"
            | "equipment_acquisition";
          entry_id: number;
          reason: string;
          flagged_by: string;
          flagged_at: string;
          resolved_by: string | null;
          resolved_at: string | null;
          entry_updated_at: string | null;
        };
        Insert: {
          daily_log_id: number;
          entry_type:
            | "work_item"
            | "labor_item"
            | "expense_item"
            | "material_usage_item"
            | "material_procurement"
            | "equipment_acquisition";
          entry_id: number;
          reason: string;
          flagged_by: string;
          flagged_at?: string;
          resolved_by?: string | null;
          resolved_at?: string | null;
          entry_updated_at?: string | null;
        };
        Update: {
          reason?: string;
          flagged_by?: string;
          flagged_at?: string;
          resolved_by?: string | null;
          resolved_at?: string | null;
          entry_updated_at?: string | null;
        };
        Relationships: [];
      };
      daily_log_survey_questions: {
        Row: {
          id: number;
          project_id: number;
          question_text: string;
          is_required: boolean;
          sort_order: number;
          affects_delay_risk: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          project_id: number;
          question_text: string;
          is_required?: boolean;
          sort_order?: number;
          affects_delay_risk?: boolean;
        };
        Update: {
          question_text?: string;
          is_required?: boolean;
          sort_order?: number;
          affects_delay_risk?: boolean;
          updated_at?: string;
        };
        Relationships: [];
      };
      daily_log_survey_answers: {
        Row: {
          id: number;
          daily_log_id: number;
          question_id: number;
          occurred: boolean | null;
          notes: string | null;
        };
        Insert: {
          daily_log_id: number;
          question_id: number;
          occurred?: boolean | null;
          notes?: string | null;
        };
        Update: {
          occurred?: boolean | null;
          notes?: string | null;
        };
        Relationships: [];
      };
      daily_log_expense_items: {
        Row: {
          id: number;
          daily_log_id: number;
          expense_category: string;
          amount: number;
          additional_fees: number;
          description: string | null;
          attachment_paths: string[];
          remarks: string | null;
          created_at: string;
        };
        Insert: {
          daily_log_id: number;
          expense_category: string;
          amount?: number;
          additional_fees?: number;
          description?: string | null;
          attachment_paths?: string[];
          remarks?: string | null;
        };
        Update: {
          expense_category?: string;
          amount?: number;
          additional_fees?: number;
          description?: string | null;
          attachment_paths?: string[];
          remarks?: string | null;
        };
        Relationships: [];
      };
      daily_log_material_usage_items: {
        Row: {
          id: number;
          daily_log_id: number;
          project_material_id: number;
          status: "available" | "low_stock" | "fully_consumed";
          activity: string | null;
          remarks: string | null;
          created_at: string;
        };
        Insert: {
          daily_log_id: number;
          project_material_id: number;
          status?: "available" | "low_stock" | "fully_consumed";
          activity?: string | null;
          remarks?: string | null;
        };
        Update: {
          project_material_id?: number;
          status?: "available" | "low_stock" | "fully_consumed";
          activity?: string | null;
          remarks?: string | null;
        };
        Relationships: [];
      };
      project_materials: {
        Row: {
          id: number;
          project_id: number;
          material_code: string;
          material_name: string;
          specification: string | null;
          quantity: number;
          unit: string | null;
          status: "available" | "low_stock" | "fully_consumed";
          recorded_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          project_id: number;
          material_code: string;
          material_name: string;
          specification?: string | null;
          quantity?: number;
          unit?: string | null;
          status?: "available" | "low_stock" | "fully_consumed";
          recorded_by: string;
        };
        Update: {
          material_code?: string;
          material_name?: string;
          specification?: string | null;
          quantity?: number;
          unit?: string | null;
          status?: "available" | "low_stock" | "fully_consumed";
        };
        Relationships: [];
      };
      material_requests: {
        Row: {
          id: number;
          project_id: number;
          mr_no: string;
          requested_by: string;
          request_date: string;
          date_required: string | null;
          priority: "routine" | "urgent" | "emergency";
          remarks: string | null;
          status: "submitted" | "approved" | "partially_fulfilled" | "fulfilled" | "canceled";
          approved_by: string | null;
          approved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          project_id: number;
          mr_no: string;
          requested_by: string;
          request_date?: string;
          date_required?: string | null;
          priority?: "routine" | "urgent" | "emergency";
          remarks?: string | null;
          status?: "submitted" | "approved" | "partially_fulfilled" | "fulfilled" | "canceled";
          approved_by?: string | null;
          approved_at?: string | null;
        };
        Update: {
          mr_no?: string;
          date_required?: string | null;
          priority?: "routine" | "urgent" | "emergency";
          remarks?: string | null;
          status?: "submitted" | "approved" | "partially_fulfilled" | "fulfilled" | "canceled";
          approved_by?: string | null;
          approved_at?: string | null;
        };
        Relationships: [];
      };
      material_request_items: {
        Row: {
          id: number;
          material_request_id: number;
          material_name: string;
          specification: string | null;
          quantity_needed: number;
          uom: string | null;
          purpose: string | null;
          quantity_fulfilled: number;
          created_at: string;
        };
        Insert: {
          material_request_id: number;
          material_name: string;
          specification?: string | null;
          quantity_needed?: number;
          uom?: string | null;
          purpose?: string | null;
          quantity_fulfilled?: number;
        };
        Update: {
          material_name?: string;
          specification?: string | null;
          quantity_needed?: number;
          uom?: string | null;
          purpose?: string | null;
          quantity_fulfilled?: number;
        };
        Relationships: [];
      };
      // Named "requisitions" to avoid colliding with the pre-existing,
      // unused public.equipment_requests table from 0007_equipment.sql
      // (dropped by 0025_schema_cleanup.sql) — see
      // 0020_equipment_requests.sql's header comment for why this is a
      // separate table rather than a rename.
      equipment_requisitions: {
        Row: {
          id: number;
          project_id: number;
          er_no: string;
          requested_by: string;
          request_date: string;
          date_required: string | null;
          priority: "routine" | "urgent" | "emergency";
          remarks: string | null;
          status: "submitted" | "approved" | "partially_fulfilled" | "fulfilled" | "canceled";
          approved_by: string | null;
          approved_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          project_id: number;
          er_no: string;
          requested_by: string;
          request_date?: string;
          date_required?: string | null;
          priority?: "routine" | "urgent" | "emergency";
          remarks?: string | null;
          status?: "submitted" | "approved" | "partially_fulfilled" | "fulfilled" | "canceled";
          approved_by?: string | null;
          approved_at?: string | null;
        };
        Update: {
          er_no?: string;
          date_required?: string | null;
          priority?: "routine" | "urgent" | "emergency";
          remarks?: string | null;
          status?: "submitted" | "approved" | "partially_fulfilled" | "fulfilled" | "canceled";
          approved_by?: string | null;
          approved_at?: string | null;
        };
        Relationships: [];
      };
      equipment_requisition_items: {
        Row: {
          id: number;
          equipment_request_id: number;
          equipment_name: string;
          specification: string | null;
          quantity_needed: number;
          uom: string | null;
          purpose: string | null;
          quantity_fulfilled: number;
          created_at: string;
        };
        Insert: {
          equipment_request_id: number;
          equipment_name: string;
          specification?: string | null;
          quantity_needed?: number;
          uom?: string | null;
          purpose?: string | null;
          quantity_fulfilled?: number;
        };
        Update: {
          equipment_name?: string;
          specification?: string | null;
          quantity_needed?: number;
          uom?: string | null;
          purpose?: string | null;
          quantity_fulfilled?: number;
        };
        Relationships: [];
      };
      equipment: {
        Row: {
          id: number;
          asset_tag: string;
          name: string;
          category: string | null;
          description: string | null;
          serial_number: string | null;
          status: "available" | "assigned" | "maintenance" | "retired";
          current_project_id: number | null;
          last_assigned_at: string | null;
          last_returned_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          asset_tag: string;
          name: string;
          category?: string | null;
          description?: string | null;
          serial_number?: string | null;
          status?: "available" | "assigned" | "maintenance" | "retired";
          current_project_id?: number | null;
          last_assigned_at?: string | null;
          last_returned_at?: string | null;
          created_by?: string | null;
        };
        Update: {
          name?: string;
          category?: string | null;
          description?: string | null;
          serial_number?: string | null;
          status?: "available" | "assigned" | "maintenance" | "retired";
          current_project_id?: number | null;
          last_assigned_at?: string | null;
          last_returned_at?: string | null;
        };
        Relationships: [];
      };
      equipment_assignments: {
        Row: {
          id: number;
          equipment_id: number;
          project_id: number;
          assigned_by: string;
          assigned_at: string;
          returned_at: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          equipment_id: number;
          project_id: number;
          assigned_by: string;
          assigned_at?: string;
          returned_at?: string | null;
          notes?: string | null;
        };
        Update: {
          assigned_at?: string;
          returned_at?: string | null;
          notes?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      user_role: UserRole;
    };
    CompositeTypes: Record<string, never>;
  };
}
