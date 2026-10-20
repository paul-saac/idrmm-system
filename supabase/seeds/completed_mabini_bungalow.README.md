# Completed bungalow demo

Run `completed_mabini_bungalow.sql` in the Supabase SQL editor for the database
used by this app. Run the entire file together. It is a data seed, not a schema
migration. It has not been applied to the live database by Codex.

## Requirements

- The current project, progress, attendance and equipment schema, including
  `progress_override_logs`, material unit costs (0073), equipment task
  assignments (0074), and project closeout reports (0075).
- At least one active administrator, project manager and foreman account.
  The seed uses the earliest active account in each role; it does not create
  accounts or change their roles, passwords or assignments on other projects.
- Run on or after September 15, 2026. The seed checks prerequisites before writing.

## Created data

| Item | Value |
| --- | --- |
| Project | DEMO - Mabini Bungalow (Completed) |
| Scenario | Fictional 72 m² bungalow in Lipa City, Batangas |
| Dates | June 1–September 15, 2026; September 12 target |
| Scope | 9 phases; 13 tasks plus standalone mobilization |
| Milestones | Foundation complete, structural frame complete, final completion |
| Completion | 100% with saved quantities on every work item |
| Progress entries | 94: 91 task entries and 3 phase entries |
| Override history | 95 records, including one earlier corrected snapshot |
| Materials | 38 planned lines; 308 dated usage entries |
| Unplanned material | 6 sealant tubes at ₱185 each, included once in actual cost |
| Labor | 6 demo workers with hourly rates and dated attendance |
| Equipment | 3 demo assets, returned, with task placement history |
| Planned cost | ₱1,135,850.00 |
| Logged actual cost | ₱1,161,260.00 |
| Allocated budget | ₱1,250,000.00 |

Values and people are fictional demonstration data, not actual business records
or verified market rates. The scenario includes material wastage, shortened
rain-affected shifts, and delayed fixture fitting. Closeout contains only the
lifecycle summary, final outcomes, recorded milestones and overall performance.

## After running

Refresh Projects and open **DEMO - Mabini Bungalow (Completed)**. Check its Gantt
progress modal, material usage, equipment costs, expenses, and closeout report.
The progress history is historical; today's inputs should remain empty.

All writes run in one transaction. Quantity, cost, attendance and material
reconciliation failures roll back the seed. Re-running refuses to create a
duplicate project. Existing projects and assets are not updated or deleted.
Only notifications generated for the new demo project within this transaction
are removed to avoid sending historical demo activity to user inboxes.

Validation: executed successfully in an isolated PostgreSQL-compatible test
database using a schema fixture based on the current application types, with
the actual 0075 migration and selected relational constraints. The app's own
progress calculation returned 100% for all 14 work items. This is not a live
Supabase/RLS or browser verification.
