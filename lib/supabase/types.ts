import type { UserRole } from "@/lib/auth/roles";
import type { MaterialPurchase } from "@/lib/materials/purchases-model";
import type { CloseoutRecord } from "@/lib/reports/closeout-model";
import type { PunchItem } from "@/lib/reports/punch-list-model";
import type { QualityInspection } from "@/lib/reports/quality-inspection-model";
import type { Incident } from "@/lib/incidents/model";
import type { Sheet, SheetReview } from "@/lib/sheets/model";

export type ProjectStatus = "planning" | "ongoing" | "completed";

/** What happened to an account — see 0066_account_management.sql. */
export type AccountEventAction =
  | "created"
  | "edited"
  | "role_changed"
  | "activated"
  | "deactivated"
  | "password_reset_sent"
  | "password_set"
  | "signed_out"
  | "handed_over"
  | "deleted";

/**
 * Hand-written subset of the generated Supabase database types, covering
 * just what the auth feature needs. Once the schema grows, replace this
 * with `supabase gen types typescript` output.
 */
export interface Database {
  public: {
    Tables: {
      material_purchases: {
        Row: MaterialPurchase;
        Insert: Omit<MaterialPurchase,"id" | "amount" | "created_at">;
        Update: { received_quantity?: number };
        Relationships: [];
      };
      account_invitations: {
        Row: { id: string; email: string; role: UserRole; invited_by: string; created_at: string };
        Insert: { id?: string; email: string; role: UserRole; invited_by: string };
        Update: never;
        Relationships: [];
      };
      project_sheets: {
        Row: Sheet;
        Insert: Omit<Sheet, "id" | "created_at" | "reviewed_by" | "reviewed_name" | "reviewed_at" | "review_notes">;
        Update: { status?: Sheet["status"]; review_notes?: string };
        Relationships: [];
      };
      project_sheet_reviews: {
        Row: SheetReview & { reviewer_id: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      project_closeout_reports: {
        Row: CloseoutRecord;
        Insert: Pick<CloseoutRecord, "project_id"> & Partial<Omit<CloseoutRecord, "project_id">>;
        Update: Partial<Omit<CloseoutRecord, "project_id">>;
        Relationships: [];
      };
      project_punch_items: {
        Row: Omit<PunchItem, "assigned_to_name" | "identified_by_name" | "verified_by_name">;
        Insert: Omit<PunchItem, "id" | "assigned_to_name" | "identified_by_name" | "verified_by_name" | "verified_by" | "verified_at" | "resolved_at" | "created_at" | "updated_at"> & {
          verified_by?: string | null;
          verified_at?: string | null;
          resolved_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<PunchItem, "id" | "project_id" | "assigned_to_name" | "identified_by_name" | "verified_by_name" | "identified_by" | "created_at">>;
        Relationships: [];
      };
      project_quality_inspections: {
        Row: Omit<QualityInspection, "recorded_by_name">;
        Insert: Pick<QualityInspection, "project_id" | "inspection_type" | "area" | "inspected_on" | "inspector_name" | "result">
          & Partial<Omit<QualityInspection, "id" | "recorded_by_name" | "project_id" | "inspection_type" | "area" | "inspected_on" | "inspector_name" | "result">>;
        Update: Partial<Omit<QualityInspection, "id" | "project_id" | "recorded_by" | "recorded_by_name" | "created_at">>;
        Relationships: [];
      };
      project_safety_incidents: {
        Row: Incident;
        Insert: Omit<Incident, "id" | "created_at" | "context_name" | "reporter_name">;
        Update: never;
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          email: string;
          first_name: string;
          last_name: string;
          role: UserRole;
          status: "active" | "inactive";
          invitation_pending: boolean;
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
          invitation_pending?: boolean;
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
          /** ISO dates (YYYY-MM-DD) the site is off on top of its
           * non-working weekdays — see 0053_project_holidays.sql. */
          holidays: string[];
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
          holidays?: string[];
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
          holidays?: string[];
        };
        Relationships: [];
      };
      /** A project's calendar events — see 0055_project_events.sql. */
      project_events: {
        Row: {
          id: number;
          project_id: number;
          event_type: string;
          name: string;
          event_date: string;
          /** "HH:MM:SS"; meetings only, null for every other type. */
          start_time: string | null;
          end_time: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          project_id: number;
          event_type: string;
          name: string;
          event_date: string;
          start_time?: string | null;
          end_time?: string | null;
          created_by?: string | null;
        };
        Update: {
          event_type?: string;
          name?: string;
          event_date?: string;
          start_time?: string | null;
          end_time?: string | null;
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
          /** See 0072_estimate_category_milestone.sql — only a task-less
           * category's own; ignored once it has tasks. */
          is_milestone: boolean;
          /** See 0047_category_labor_estimate.sql's own comment — only
           * used while this category has no tasks yet; once it does,
           * the Labor Breakdown modal shows their rolled-up total
           * instead (see LaborBreakdownModalContent's own doc comment). */
          category_labor_estimate: number | null;
          /** A category's own Equipment / Other cost — see
           * 0056_category_equipment_other.sql. */
          category_equipment_estimate: number | null;
          equipment_cost_items: import("@/lib/cost-estimate/data").OtherCostItem[];
          category_other_estimate: number | null;
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
          material_direct_quantity?: number;
          material_direct_unit?: string | null;
          material_unit_cost?: number;
          category_material_estimate?: number;
          material_direct_amount?: number | null;
          planned_start_date?: string | null;
          planned_end_date?: string | null;
          priority?: string;
          is_milestone?: boolean;
          category_labor_estimate?: number;
          category_equipment_estimate?: number;
          category_other_estimate?: number;
          estimated_quantity?: number | null;
          unit?: string | null;
        };
        Update: {
          category_name?: string;
          material_direct_quantity?: number;
          material_direct_unit?: string | null;
          material_unit_cost?: number;
          category_material_estimate?: number;
          material_direct_amount?: number | null;
          planned_start_date?: string | null;
          planned_end_date?: string | null;
          priority?: string;
          is_milestone?: boolean;
          category_labor_estimate?: number;
          category_equipment_estimate?: number;
          category_other_estimate?: number;
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
          equipment_cost_items: import("@/lib/cost-estimate/data").OtherCostItem[];
          other_cost_estimate: number | null;
          total_estimate_cost: number | null;
          planned_start_date: string | null;
          planned_end_date: string | null;
          predecessor_task_id: number | null;
          is_milestone: boolean;
          priority: string;
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
          planned_start_date?: string | null;
          planned_end_date?: string | null;
          predecessor_task_id?: number | null;
          is_milestone?: boolean;
          priority?: string;
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
          planned_start_date?: string | null;
          planned_end_date?: string | null;
          predecessor_task_id?: number | null;
          is_milestone?: boolean;
          priority?: string;
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
      /** The bell's notifications — written only by triggers. See
       * 0061_notifications.sql. */
      notifications: {
        Row: {
          id: number;
          recipient_id: string;
          actor_id: string | null;
          actor_name: string | null;
          kind: "progress_override" | "material_request" | "equipment_request" | "sheet_submitted" | "safety_incident";
          project_id: number;
          project_name: string;
          item_kind: "task" | "category" | "material_request" | "equipment_request" | "sheet" | "incident";
          item_id: number;
          item_name: string;
          entry_date: string;
          read_at: string | null;
          created_at: string;
        };
        Insert: {
          recipient_id: string;
          actor_id?: string | null;
          actor_name?: string | null;
          kind?: "progress_override" | "material_request" | "equipment_request" | "sheet_submitted" | "safety_incident";
          project_id: number;
          project_name: string;
          item_kind: "task" | "category" | "material_request" | "equipment_request" | "sheet" | "incident";
          item_id: number;
          item_name: string;
          entry_date: string;
          read_at?: string | null;
        };
        Update: {
          read_at?: string | null;
        };
        Relationships: [];
      };
      /** See 0068_progress_attendance.sql. */
      task_progress_attendance: {
        Row: {
          id: number;
          progress_entry_id: number;
          worker_id: number | null;
          worker_name: string;
          hours: number;
          hourly_rate: number;
        };
        Insert: {
          progress_entry_id: number;
          worker_id: number | null;
          worker_name: string;
          hours: number;
          hourly_rate: number;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      category_progress_attendance: {
        Row: {
          id: number;
          progress_entry_id: number;
          worker_id: number | null;
          worker_name: string;
          hours: number;
          hourly_rate: number;
        };
        Insert: {
          progress_entry_id: number;
          worker_id: number | null;
          worker_name: string;
          hours: number;
          hourly_rate: number;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      /** See 0067_member_groups.sql. */
      member_groups: {
        Row: {
          id: number;
          name: string;
          description: string | null;
          created_by: string | null;
          created_by_name: string | null;
          created_at: string;
        };
        Insert: {
          name: string;
          description?: string | null;
          created_by?: string | null;
          created_by_name?: string | null;
        };
        Update: {
          name?: string;
          description?: string | null;
        };
        Relationships: [];
      };
      member_group_members: {
        Row: {
          group_id: number;
          worker_id: number;
        };
        Insert: {
          group_id: number;
          worker_id: number;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      /** See 0066_account_management.sql. */
      account_events: {
        Row: {
          id: number;
          actor_id: string;
          actor_name: string;
          target_id: string;
          target_name: string;
          action: AccountEventAction;
          details: string | null;
          created_at: string;
        };
        Insert: {
          actor_id: string;
          actor_name: string;
          target_id: string;
          target_name: string;
          action: AccountEventAction;
          details?: string | null;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      /** A main task's (category's) own itemized materials — the same
       * lines as estimate_task_material_assignments, one level up. See
       * 0058_category_material_lines.sql. */
      estimate_category_material_assignments: {
        Row: {
          id: number;
          category_id: number;
          material_name: string;
          specification: string | null;
          planned_quantity: number;
          unit: string | null;
          unit_cost: number;
          amount: number | null;
          created_at: string;
        };
        Insert: {
          id?: number;
          category_id: number;
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
      estimate_task_other_costs: {
        // A task's freely-added "Other cost" line items (Permit Fee,
        // Delivery Fee, ...) — a proper one-to-many relationship to
        // estimate_tasks rather than a jsonb blob, since every task's
        // set of other costs is independent of every other task's.
        Row: {
          id: number;
          task_id: number | null;
          category_id: number | null;
          quantity: number;
          unit: string | null;
          unit_cost: number | null;
          amount_override: number | null;
          cost_name: string;
          amount: number | null;
        };
        Insert: {
          // See estimate_categories.Insert's own comment on `id` above.
          id?: number;
          task_id?: number | null;
          category_id?: number | null;
          quantity?: number;
          unit?: string | null;
          unit_cost?: number | null;
          amount_override?: number | null;
          cost_name: string;
          amount?: number;
        };
        Update: {
          cost_name?: string;
          amount?: number;
          quantity?: number;
          unit?: string | null;
          unit_cost?: number | null;
          amount_override?: number | null;
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
        // The company Team (the admin's Team page) — real named people,
        // assigned straight to tasks/phases for accountability. Company-
        // wide since 0059_company_team.sql (was one roster per project).
        Row: {
          id: number;
          full_name: string;
          /** The member's title (e.g. Foreman, Mason). */
          trade: string | null;
          /** See 0060_team_member_details.sql. */
          contact_number: string | null;
          date_hired: string | null;
          /** See 0063_team_categories.sql. */
          category: "management" | "professional" | "skilled";
          employment_type: "employee" | "subcontractor";
          subcontractor_company: string | null;
          profile_id: string | null;
          /** Pesos an hour — see 0069_hourly_rates_work_hours.sql. */
          hourly_rate: number | null;
          /** Hours each day of the week, Monday first (7 values). */
          work_hours: number[];
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          full_name: string;
          trade?: string | null;
          contact_number?: string | null;
          date_hired?: string | null;
          category?: "management" | "professional" | "skilled";
          employment_type?: "employee" | "subcontractor";
          subcontractor_company?: string | null;
          profile_id?: string | null;
          hourly_rate?: number | null;
          work_hours?: number[];
          created_by?: string | null;
        };
        Update: {
          full_name?: string;
          trade?: string | null;
          contact_number?: string | null;
          date_hired?: string | null;
          category?: "management" | "professional" | "skilled";
          employment_type?: "employee" | "subcontractor";
          subcontractor_company?: string | null;
          profile_id?: string | null;
          hourly_rate?: number | null;
          work_hours?: number[];
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
          /** That day's spend per cost component — see
           * 0057_progress_entry_costs.sql. */
          labor_cost: number;
          material_cost: number;
          equipment_cost: number;
          other_cost: number;
          recorded_by: string | null;
          created_at: string;
        };
        Insert: {
          task_id: number;
          entry_date: string;
          quantity_completed?: number;
          labor_cost?: number;
          material_cost?: number;
          equipment_cost?: number;
          other_cost?: number;
          recorded_by?: string | null;
        };
        Update: {
          quantity_completed?: number;
          labor_cost?: number;
          material_cost?: number;
          equipment_cost?: number;
          other_cost?: number;
        };
        Relationships: [];
      };
      task_progress_material_entries: {
        // Materials actually used on one task_progress_entries row's own
        // day, matched to the task's planned lines by name + unit — see
        // 0050_task_progress_material_entries.sql for why not by id.
        Row: {
          id: number;
          progress_entry_id: number;
          material_name: string;
          unit: string | null;
          quantity_used: number;
          /** A material not on the planned lines' own unit cost — null
           * for a planned one (priced from the estimate). See 0073. */
          unit_cost: number | null;
          created_at: string;
        };
        Insert: {
          progress_entry_id: number;
          material_name: string;
          unit?: string | null;
          quantity_used?: number;
          unit_cost?: number | null;
        };
        Update: never;
        Relationships: [];
      };
      category_progress_material_entries: {
        // Same as task_progress_material_entries above, one level up —
        // materials used on a task-less phase's own day, matched to its
        // planned lines by name + unit. See 0070.
        Row: {
          id: number;
          progress_entry_id: number;
          material_name: string;
          unit: string | null;
          quantity_used: number;
          /** A material not on the planned lines' own unit cost — null
           * for a planned one (priced from the estimate). See 0073. */
          unit_cost: number | null;
          created_at: string;
        };
        Insert: {
          progress_entry_id: number;
          material_name: string;
          unit?: string | null;
          quantity_used?: number;
          unit_cost?: number | null;
        };
        Update: never;
        Relationships: [];
      };
      progress_override_logs: {
        // The override history — every saved or deleted Daily Progress
        // Update, who and exactly when, append-only. See 0071.
        Row: {
          id: number;
          project_id: number;
          task_id: number | null;
          category_id: number | null;
          entry_date: string;
          action: "saved" | "deleted";
          quantity_completed: number;
          labor_cost: number;
          material_cost: number;
          equipment_cost: number;
          other_cost: number;
          /** [{ name, unit, quantity }] */
          materials_used: unknown;
          /** [{ name, hours, rate }] */
          attendance: unknown;
          saved_by: string | null;
          saved_by_name: string | null;
          created_at: string;
        };
        Insert: {
          project_id: number;
          task_id?: number | null;
          category_id?: number | null;
          entry_date: string;
          action: "saved" | "deleted";
          quantity_completed?: number;
          labor_cost?: number;
          material_cost?: number;
          equipment_cost?: number;
          other_cost?: number;
          materials_used?: unknown;
          attendance?: unknown;
          saved_by?: string | null;
          saved_by_name?: string | null;
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
          /** That day's spend per cost component — see
           * 0057_progress_entry_costs.sql. */
          labor_cost: number;
          material_cost: number;
          equipment_cost: number;
          other_cost: number;
          recorded_by: string | null;
          created_at: string;
        };
        Insert: {
          category_id: number;
          entry_date: string;
          quantity_completed?: number;
          labor_cost?: number;
          material_cost?: number;
          equipment_cost?: number;
          other_cost?: number;
          recorded_by?: string | null;
        };
        Update: {
          quantity_completed?: number;
          labor_cost?: number;
          material_cost?: number;
          equipment_cost?: number;
          other_cost?: number;
        };
        Relationships: [];
      };
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
          price_amount: number;
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
      equipment_task_assignments: {
        Row: {
          id: number;
          equipment_assignment_id: number;
          project_id: number;
          task_id: number | null;
          task_name: string;
          assigned_by: string | null;
          assigned_at: string;
          released_at: string | null;
          release_reason: "moved" | "returned" | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          equipment_assignment_id: number;
          project_id: number;
          task_id?: number | null;
          task_name: string;
          assigned_by?: string | null;
          assigned_at?: string;
          released_at?: string | null;
          release_reason?: "moved" | "returned" | null;
          notes?: string | null;
        };
        Update: {
          task_id?: number | null;
          task_name?: string;
          assigned_at?: string;
          released_at?: string | null;
          release_reason?: "moved" | "returned" | null;
          notes?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    // See 0051_foreman_project_access.sql.
    Functions: {
      save_equipment_task_plans: {
        Args: { p_project_id: number; p_item_key: string; p_selected: number[]; p_previous: number[] };
        Returns: undefined;
      };
      equipment_tracking_data: {
        Args: { p_project_id: number };
        Returns: unknown;
      };
      record_equipment_operation: {
        Args: { p_project_id: number; p_input: unknown };
        Returns: undefined;
      };
      save_equipment_cost_breakdown: {
        Args: { p_project_id: number; p_changes: unknown };
        Returns: undefined;
      };
      save_other_cost_breakdown: {
        Args: { p_project_id: number; p_changes: unknown };
        Returns: undefined;
      };
      /** See 0066_account_management.sql. */
      account_has_history: {
        Args: { p_profile_id: string };
        Returns: boolean;
      };
      sign_out_everywhere: {
        Args: { p_user_id: string };
        Returns: undefined;
      };
      account_last_sign_ins: {
        Args: Record<string, never>;
        Returns: { profile_id: string; last_sign_in_at: string | null }[];
      };
      set_project_default_labor_cost_percent: {
        Args: { p_project_id: number; p_percent: number | null };
        Returns: undefined;
      };
      sync_equipment_status: {
        Args: { p_equipment_id: number };
        Returns: undefined;
      };
      move_equipment_to_task: {
        Args: {
          p_equipment_assignment_id: number;
          p_project_id: number;
          p_task_id: number;
          p_notes?: string | null;
        };
        Returns: undefined;
      };
      close_equipment_task_assignment: {
        Args: {
          p_equipment_assignment_id: number;
          p_project_id: number;
          p_released_at?: string;
        };
        Returns: undefined;
      };
      /** See 0060_team_member_details.sql. */
      /** See 0068_progress_attendance.sql. */
      attendance_elsewhere: {
        Args: {
          p_date: string;
          p_worker_ids: number[];
          p_task_id: number | null;
          p_category_id: number | null;
        };
        Returns: {
          worker_id: number;
          hours: number;
          item_name: string;
          project_name: string;
        }[];
      };
      team_hours_worked: {
        Args: Record<string, never>;
        Returns: {
          worker_id: number;
          project_id: number;
          project_name: string;
          hours: number;
        }[];
      };
      team_assignments: {
        Args: Record<string, never>;
        Returns: {
          worker_id: number;
          item_kind: "task" | "category" | "project";
          item_id: number;
          item_name: string;
          project_id: number;
          project_name: string;
          project_completed: boolean;
          start_date: string | null;
          end_date: string | null;
        }[];
      };
    };
    Enums: {
      user_role: UserRole;
    };
    CompositeTypes: Record<string, never>;
  };
}
