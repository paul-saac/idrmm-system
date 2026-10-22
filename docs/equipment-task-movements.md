# Task equipment and progress movements

Apply `supabase/migrations/0087_equipment_progress_movements.sql` after 0086.

- Gantt **Assigned Equipment** plans tools/machines from Inventory. Planning does not move equipment, reserve it exclusively, or create expenses. The same asset may be planned for multiple tasks; actual deployment remains exclusive.
- Progress override **Tools & Equipment** records Deploy, Used / remained, Transfer, and Return through **Record activity**. These records save immediately and independently of Save progress / Cancel. Date defaults to today in Asia/Manila, matching the current-day override workflow. Backdated physical movement is deliberately not supported.
- Each inventory asset tag is one physical unit. Rentals must also be registered individually in Inventory. This does not introduce pooled quantities or an ownership-classification field.
- Returning to company storage makes an asset available. Returning to a rental supplier retires its inventory record so it cannot be assigned again accidentally; history remains available.
- Movement and usage history appears in the progress modal and Equipment → Equipment monitoring. Project/task/date are stable logical links; deleting or overriding progress does not delete or replay movements.
- Correct a mistaken transfer by recording the reverse transfer and entering a correction reason in Notes. Return a mistaken deployment, or redeploy a mistaken return. Original records remain; there is no destructive edit/delete of movement history.
- A transaction locks the physical asset, validates current placement and destination, updates existing checkout/task-placement records, and appends the event. A request UUID makes retries idempotent; Used / remained has a unique per-asset/task/date constraint.
- Admins and the project's assigned PM/FM may act; other projects are rejected by the database RPC as well as the server action. New tables are read-only to authenticated clients outside the validated RPC.
- Existing Equipment monitoring placement history remains visible alongside the new activity journal. Old movements are not inferred or backfilled.

Regression test: `node lib/equipment/tracking.test.mjs` with PGlite available. Alternatively pass its installed module URL as the final argument. It uses an isolated in-memory database, not project data.
