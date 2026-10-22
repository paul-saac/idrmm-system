# Material purchases and stock

Apply `supabase/migrations/0085_material_purchases.sql` in Supabase after the preceding migrations before opening project workspaces with this version.

- Materials > Material purchases > Record purchase: enter the invoice date, supplier, optional reference and one or more material lines. This is a purchase/invoice ledger, not an order or payment ledger.
- Received quantities may be zero or partial. Click a received quantity to enter the new cumulative received amount, never an incremental amount. A receipt changes stock, not the expense.
- Expenses uses invoice line amounts for materials. Current task/phase progress costs supply the other three categories. Historical usage valuations are not added to material purchase expenses.
- Materials used today accepts quantities, including unplanned materials, without charging another material expense. Historical usage and cost values remain stored. The older planned-versus-used table labels its monetary figures as usage values, not purchase spending.
- Stock uses opening/legacy stock plus receipts minus current saved progress usage. Correcting/replacing a saved day therefore recalculates the balance rather than deducting it a second time. Match material names and units; different units are not automatically converted.
- Existing Add Material quantities are treated as opening/legacy quantities. Reconcile them against the dates covered by usage history before relying on availability. Negative balances remain visible; no receipt or purchase history is fabricated.
- Purchase lines are immutable; only received quantities can be corrected. Supplier/invoice/price corrections, returns, payment tracking and receipt attachments are not included in this first version.
- Legacy Daily Log reports remain separate and have not been silently migrated to this ledger.

Validation: purchase input/stock model tests and isolated PostgreSQL-compatible migration checks cover calculated amounts, repeat submissions, project isolation, receipt bounds and preserving amounts when receipt quantities change. Verify live RLS and UI using a dedicated test project before rollout.
