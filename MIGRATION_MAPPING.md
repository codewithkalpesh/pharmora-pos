# Migration Mapping

This document maps the existing Pharmora Business Manager concepts to the new canonical POS model without performing migration work.

## Mapping table

| OLD MODEL | NEW MODEL | DATA THAT MUST BE PRESERVED | TRANSFORMATION REQUIRED | RISK |
|---|---|---|---|---|
| Distributor | Supplier | distributor identity, contact details, outstanding balances, GST info, related purchase history | Rename and enforce supplier-facing semantics; transfer payable history into purchase/supplier payment records | High |
| PurchaseBill | Purchase | invoice number, invoice date, subtotal, GST, discount, grand total, status, supplier linkage, paid amount | Convert bill-level totals into canonical purchase + payment flow, preserve historical invoice references | High |
| DistributorPayment | SupplierPayment | payment date, amount, payment method, bill linkage, reference numbers, notes | Reconcile settlement against purchase liabilities and cashbook entries | High |
| CustomerCredit | CustomerCredit | customer balances, credit amounts, collection history, overdue status, due dates | Keep as derived balance records from payment history, not a manually editable source of truth | High |
| CashBook | CashbookEntry + reporting aggregates | inflow/outflow totals, category, source, notes, date, user | Reconcile with sale, purchase payment, expense, and bank transaction records via source reference | High |
| Expense | Expense | date, category, amount, description, receipt, payment method | Keep one canonical expense entity with traceable source references | Medium |
| BankAccount | BankAccount | account metadata, opening balance, active status, current balance | Recompute current balance from historical bank transactions rather than editing directly | High |
| BankTransaction | BankTransaction | transaction date, type, amount, running balance, transfer metadata, notes | Preserve source entity links and reconcile to cashbook flows | High |
| Product | Product | product identity, barcode, SKU, MRP, selling price, purchase price, GST, location, supplier | Keep product master stable, with batch/sale history attached | Medium |
| ProductBatch | ProductBatch | batch number, expiry, purchase rate, MRP, quantity, free quantity | Ensure stock and sale history remains batch aware | Medium |
| StockMovement | StockMovement | product, batch, before/after quantities, reason, source transaction, timestamp, user | Preserve detailed movement history and prevent silent stock changes | High |
| Notification | Notification | title, message, status, type, related entity, timestamp | Recreate reminder and warning semantics using canonical event sources | Low |
| Goal / PaymentGoal | SalesTarget + SalesTargetContribution | target amount, progress, completion date, contribution history | Convert recorded goals to a monthly sales target model, not ad hoc dashboard logic | Medium |

## Preservation rules

- Do not drop transaction IDs where they exist.
- Preserve dates, amounts, references, and supplier/customer identities.
- Preserve invoice identifiers and payment references.
- Keep stock movement history tied to product and batch.
- Keep all cash/bank ledger entries tied to a source entity.
- Prefer derived balances where practical over manually maintained totals.

## Design intent

The new canonical model is intentionally built around a single source of truth:

- Products and batches define inventory identity.
- Purchase and sale records define commercial events.
- Payment records define money movement.
- Cashbook and bank records reconcile money movement.
- StockMovement records preserve every stock-changing event.
- Notification, TelegramEvent, and ReportSnapshot keep operational communication and reporting references.
