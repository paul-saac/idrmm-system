# IDRMM project essentials

- Construction project management: Next.js App Router, React, Tailwind, Supabase. Confirm current APIs and role policies in source; historical notes may be stale.
- Main flow: projects -> cost estimate categories/tasks -> Gantt and saved progress -> material/equipment/expense views. Legacy Daily Logs and forecasting coexist; do not silently mix their data sources.
- Expense and equipment cost ledgers use current saved task/category progress entries, not append-only override history or automatic estimated progress. Saved material cost already includes priced usage; avoid double counting.
- Record clicks reuse the read-only progress modal with planned/actual cards and history. Keep Gantt editing available.
- Match existing UI patterns. Use "Planned" for estimate costs; reserve "Budget" for the allocated project budget.
- Preserve milestone/predecessor values when editing forms that do not expose them.
- SQL migrations: sequential `supabase/migrations/NNNN_description.sql`, with an intent header. Inspect the latest number; do not assume an old migration count.
- Never query live data for "Sunrise Villas – Phase 1" without explicit permission.
- Start with `components/projects/project-detail-page.tsx` (loading) and `project-detail-view.tsx` (composition), then the relevant feature directory. Forecasting lives in `lib/forecasting/data.ts`.
- Historical session export: `C:/Users/HP-Victus/.codex/reference/idrmm-session-export-archived-2026-10-19.md`. Read only for specific historical questions, not routinely; current source takes precedence.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
