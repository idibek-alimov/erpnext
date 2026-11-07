# Money Hub M3b — historical invoice costs and source permissions

Date: 2026-11-07. Implementation: **Implemented locally**. Verification: passed within
the scope below. Owner acceptance and intended-site activation: **Pending**.
Parent: [Money Hub](money-hub.md). Current pointer: [root tracker](../../../../ERP_SIMPLIFICATION.md).

## What changed

`erpnext/stock/retail_costs.py` is now the shared source for invoice-date historical costs.
Product Detail's `ProductCostLookup` remains a compatibility import over that service.
Product Catalog, Product Detail, Supplier Hub/Detail and Money Hub use the shared
permission-scoped invoice rows and valuation evidence. Reads create no business records.

Money Hub's existing `get_business_results` response now includes `invoice_costs` and
fills `reconciliation.invoice_date_cogs` / `invoice_date_gross_profit` when complete.
Posted ledger results remain separate and unchanged. A missing cost makes total analytical
COGS/gross profit null; the known-cost subtotal is explicitly partial. No current buying
price, latest Item Price, estimated stock rate or fabricated zero fills a gap.

The new service follows the same native stock valuation principle as ERPNext Gross Profit:
allocate recorded stock valuation to invoiced stock quantity. The older lookup's previous-
stock-value/estimated-rate fallback has been replaced by the actual noncancelled Stock
Ledger Entry `stock_value_difference / actual_qty`. The native report's exact-SLE path now
uses that same posted delta and native SLE read permissions. A recorded zero valuation is
known zero; absent/restricted valuation is unknown.

## Calculation and timing contract

- Submitted nonopening Sales Invoices and their native permitted child rows define sales.
  Revenue uses discounted, tax-exclusive `base_net_amount` in company currency. Original
  invoice currency totals remain in M3a's separate sales section.
- Stock quantities use stock UOM. Exact stock-updating SI or linked Delivery Note SLEs
  provide the cost. Partial billing allocates only the invoiced quantity, not the entire
  delivery's cost. Packed bundle components use the native parent-item SLE reference and
  their recorded component quantities; every required component must be readable/valued.
- Invoice-first deliveries are discovered only through typed `against_sales_invoice` and
  `si_detail` links. Incomplete fulfilment remains unknown. Unlinked Sales Order delivery
  estimates are not silently allocated to an invoice.
- Returns reverse revenue and historical cost on their own invoice date. A physical stock
  return uses its native valuation. A return without a new stock movement may reverse the
  explicitly linked original invoice line's cost, provided that original is permitted.
  Ambiguous original lines remain unknown. Native price-adjustment debit notes cost zero.
- Nonstock cost follows native Gross Profit's dated latest-purchase approach, with company,
  native PI/child permissions, project/cost-center matching, time cutoff, stock quantity
  and discounted base amount. No permitted purchase evidence means unknown. These remain
  analytical purchase costs, not proof that an operating expense should be deducted again.
- Source documents and valuations must be posted by today. Analytical results for an
  older invoice period use **recorded fulfilment costs available as of today**, including
  a linked delivery posted after that invoice period. This is explicitly returned as
  `as_of` and `basis`; it is not an immutable period-end snapshot. M3c must show this scope.
  Ledger COGS still belongs to the native GL posting period and can legitimately differ.
- Visible child revenue and document quantities reconcile to readable SI totals, so a
  missing/restricted zero-revenue line cannot silently disappear from a complete cost.
  Failed reconciliation or any missing cost leaves analytical totals unavailable, with
  allowed-row reason codes/counts. Final-profit status remains false under M3a.

Q03/Q04 financial recognition, allocation and store policy remain open. This bounded
analytical contract does not approve final net-profit, payroll or tax rules.

## Permission and consumer changes

All new source lookups use native lists and field permissions. SI/DN/PI parents are resolved
within company/submitted/date scope before querying their children, with parent identifiers
batched at 200. Item, Warehouse and Stock Ledger Entry access also apply. Cost calculations
after evidence loading perform no database calls per sale line. Native source restrictions
produce unavailable cost instead of access to hidden amounts or document identities.

The native Gross Profit report now applies company/retail access, required-field checks,
permitted SI/Item/Warehouse scope and scoped return rows. Its nonstock cost uses the shared
permitted dated PI evidence. A cost-evidence check prevents the native display/export
pipeline from converting missing cost to zero. CSV and XLSX use that same report execution.
The classic report retains its own grouping/returned-invoice presentation; do not assert
that every native grouping is the invoice-period view. Prepared-report caches, every
advanced grouping and production-scale performance remain M5 review work.

Current buying-price metadata now needs native Item Price permission and the company
currency. Product Detail's initial stock metadata now uses permitted company warehouses;
variant metadata uses native Item lists. The old Supplier Hub detail endpoint now reuses
the scoped supplier context and native PI/PE/price queries, retaining its response keys,
original document currencies and 50-record legacy lists. It no longer uses unrestricted
cross-company Bin/invoice/payment SQL. Its unpaid-invoice endpoint also uses the retail
guard and native supplier/company/PI scope, including direct cashier/Guest denial checks.
This is not a full rewrite of unrelated pricing rules,
all product mutation APIs or all native accounting reports.

Catalog/Detail show a dash and RU/TG explanation for unavailable historical cost/profit.
Daily history preserves null profit; a chart omits its unavailable profit line instead of
plotting zero. Sales and current inventory remain usable. Supplier summaries already
propagate null profit. Supplier revision policy includes SLE/DN read capabilities and a
version change so browser-held summaries do not reuse the previous cost policy.

## Files and verification

Primary changes:

- `stock/retail_costs.py`, `stock/test_retail_costs.py`.
- `accounts/page/money_hub/business_results.py`, `test_invoice_costs_native.py` and the
  retained native results test's empty-invoice zero expectation.
- `stock/page/product_catalog/catalog_data.py` / `.js`; Product Detail `.py` / `.js`.
- `buying/page/supplier_hub/supplier_data.py`, `supplier_hub.py`, `supplier_revision.py`
  and its historical-cost consumer test.
- `accounts/report/gross_profit/gross_profit.py`; tracker and linked plans.
- Five native report/cost-error translations appended to each of `translations/ru.csv`
  and `translations/tg.csv`, preserving the existing file bytes/line endings.

Checks on 2026-11-07:

- **120 database-free backend cases passed**, including 10 cost-evidence tests, retained
  Money Hub/product/supplier calculations, supplier loading and Supplier Detail checks.
- **26 disposable native cases passed**: 10 new invoice-cost cases plus 16 retained M3a
  financial/permission cases. Coverage includes exact FIFO sale/return, DN before/after SI,
  partial billing, incomplete delivery, later-period return, bundle component valuation,
  discounted nonstock PI/denied PI, stock UOM, USD/base, company/account/SI/warehouse/SLE
  restrictions, manager/cashier/Guest, native P&L and native Gross Profit/export gates.
- Native CSV and XLSX generation passed over disposable native financial fixtures. Only
  the framework's replica/read-only wrapper was bypassed in that test so the same
  connection could see its uncommitted test documents; report/export code and permissions
  ran normally. This is not an authenticated export of actual business records.
- **54 retained Node tests passed** for Money Hub, Home and cashier routing.
- **4 authenticated RU/TG desktop/mobile browser contexts passed**, each checking Catalog
  and Product Detail with intercepted financial fixtures: unknown profit, explanation,
  retained revenue, dark theme, no console errors and no page overflow. Screenshots were
  inspected; this is eight fixture screen renders, not live financial acceptance.
- **Development site read-only transaction passed**: owner/manager cost completeness is
  explicit, known analytical figures reconcile, Home loads and posted results still
  reconcile to native P&L; product variant metadata and legacy supplier reads load;
  cashier denied. Rolled back, with no financial writes.
- Changed Python syntax, JavaScript syntax, scoped ESLint and whitespace checks passed.
  Native Desk page edits require no POS/frontend build or dependency installation.
- Documentation validation passed for 20 Markdown files and 113 local links, including
  newlines/whitespace. The ten appended RU/TG translation entries parse correctly.

Private harnesses/logs/screenshots are under the development site's `money-hub-m3b` directory.
The isolated `allow_tests` site used dedicated DB/Redis containers, returned to their
initial stopped state afterward. No business-site upgrade, worker reload, role grants,
payments, commit, push or deployment. Native fixture builders must run sequentially.

Limits: no new final payroll/tax completeness claim; no actual Windows/offline checkout
test; advanced native report grouping/cache and high-volume query plans need M5 review.
Unlinked deliveries, ambiguous returns and missing nonstock evidence remain explicit
unknowns rather than new inferred accounting rules.

## Next: M3c Business results UI

Add the Money Hub results tab over `get_business_results`: compact company/period controls,
posted income/COGS/other expenses/result, separately labelled invoice sales/historical gross
profit, permitted account breakdown/native links and completeness/error/retry states.
Explain fulfilment costs **as of today**, ledger versus invoice timing, unmerged/offline POS
and missing payroll/tax/store allocation. Keep all-result totals and native scope, reject
obsolete responses, verify RU/TG/desktop/mobile and leave final net profit to M4.
