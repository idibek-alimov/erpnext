# Agreed product experience and calculations

These decisions came from the owner interview and approved product screens. Apply them
to inventory/sales UI unless the owner explicitly changes them. Clarify different
business rules for a different module instead of silently generalizing these choices.

| Concern | Agreed behavior |
| --- | --- |
| Audience | Owner and manager |
| First questions | Total stock, units sold, gross profit made, cost value of stock still on hand |
| Initial sales period | This month |
| Period choices | Today, 7 days, this month, 30 days, all time |
| Initial warehouse scope | All permitted warehouses in the selected company |
| Current stock | Current quantity; does not change merely because the sales period changes |
| Inventory value | Current ERPNext stock valuation, not potential retail value or a buying-price fallback |
| Gross profit | Net sales revenue minus historical product cost; excludes allocated business expenses |
| Revenue | Company-currency net sales after discounts, excluding taxes |
| Returns | Visible separately; reverse net quantity, revenue, and cost/profit on the return posting date |
| Cancelled invoices | Excluded; do not subtract them again as if they were returns |
| Color selection | Narrows the detail KPIs, chart, history, and variant table |
| Stock alerts | Warnings only, not automated purchasing or a recommended order quantity |
| Variant alerts | Detect missing/low colors or sizes even when the model total is healthy |
| Sales chart | Two currency lines: sales revenue and gross profit |
| Sales history | Daily groups with links to the matching native Sales Invoices |
| Catalog summaries | All matching results, independent of current page or page size |
| Catalog default columns | Product, Current stock, Net sold, Gross profit, Stock value, Selling price |
| Optional columns | Purchase price and Revenue |

The existing low-stock convention is 5 units. Keep it consistent for these product
screens, but do not assume that threshold suits every future business or unit of measure.
The number of variants is not necessarily a number of unique sizes: colors also vary.

## Data and audit invariants

Use actual inventory valuation for current stock and the established ERPNext historical
cost machinery for profit, including delivery-note and return paths as relevant. Do not
revalue past sales with today's configured purchase price. Show or explain missing cost
data rather than silently introducing an unapproved estimate.

Respect stock UOM conversions, base/company currency, date boundaries, and the chosen
company/warehouse scope. Include historical or disabled variants where needed to make
the chosen stock/sales scope complete. A healthy product total does not prove all
variants are available.

Reconcile list, detail, summary, chart, history, and source documents at identical scope.
Net sold must reconcile with gross sold minus returned quantity; return cost reversals
must have the right sign. Catalogue aggregates must not change just from pagination.

Enforce native permissions, including row-level invoice and warehouse restrictions.
An Item read permission is not permission to reveal every invoice's revenue or profit.
Scope server queries before aggregating; hiding a column in the browser is not security.

Use native validated documents for receiving, reconciliation, sales, and cancellation.
Keep source-record links and audit trails. Opening a catalog/detail view must not
generate barcodes, change prices, post stock entries, or mutate accounting records.

Batch data access; do not fetch the complete product-detail endpoint separately for
each list row. For cost-heavy lists, calculate visible rows in a shared batch while
keeping the inventory summary across all matching results.
