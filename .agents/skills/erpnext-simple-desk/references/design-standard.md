# Approved Desk design standard

The owner approved the Product Catalog and Product Detail work in November 2026 and
asked future ERPNext improvements to follow the same direction. This is persistent
project preference, not a requirement to make every module look identical.

## Appearance

- Keep the familiar ERPNext Desk character: native page title/actions, modest typography,
  theme-aware surfaces, thin borders, restrained radii, and consistent spacing.
- Use compact record identity. Photos are small and secondary; a product detail should
  feel like an ERP record rather than an e-commerce showcase.
- Favor quiet horizontal table dividers and normal-case headings. Limit nested panels,
  decorative backgrounds, colored pills, strong grids, oversized headings, and emoji.
- Use color for meaningful stock states, errors, and negative results, paired with text.
  Normal figures do not all need bright colors or bold weight.
- Use theme tokens instead of a hardcoded light-only palette. Scope rules beneath a
  screen-specific class; never redefine shared Desk indicators globally.

## Information hierarchy

Lead with the user's business question and most useful action. Follow with a few
well-labelled summary figures, scope controls, and an understandable table or history.
Use tabs/menus/optional columns for occasional detail and advanced ERPNext access.
Do not add a chart unless a trend or relationship is useful to this screen's task.

The catalog's approved default table is six columns: Product, Current stock, Net sold,
Gross profit, Stock value, Selling price. Purchase price and Revenue are optional.
Product identity combines a small thumbnail, name, code, and muted category; variant
counts use quiet text. Keep enough width for the name and align numeric columns right.
Other screens should choose their own minimum useful column set rather than inheriting six.

Keep frequent actions prominent. Place occasional actions and cross-module navigation
in a secondary menu. Preserve useful native source links and an advanced form escape hatch.

## Scope and language

Label filters and totals so their period and scope are clear. Keep current balances
distinct from period activity. Use sensible initial filters, a clear reset, and retain
useful state when returning from a detail page. Linked records should inherit relevant
scope where doing so makes comparisons coherent.

Use ordinary business language and consistent Russian/Tajik terminology. Financial
terms must retain their meaning in both languages: gross profit is not net profit.
Use consistent currency, precision, units, and number alignment. Show a missing price
as missing rather than presenting it as a free item.

## Interaction quality

Provide explicit loading, empty, failure/retry, missing-image, and restricted-access
states. Keep search and filter changes responsive and reject stale responses. Ensure
empty results still allow changing/resetting filters.

Use real links for navigable records, accessible control names, visible keyboard focus,
and keyboard-operable controls. Text must accompany color-based warnings. On mobile,
wrap filters and summaries sensibly and contain horizontal scrolling within the table;
the entire page must not overflow. A wide table may keep record identity visible while
scrolling its numeric columns.

## Implementation references

Paths below are relative to the ERPNext repository root:

- `erpnext/stock/page/product_catalog/product_catalog.js` and `.css`: list hierarchy,
  summary figures, filter state, optional columns, and contained table scrolling.
- `erpnext/stock/page/product_catalog/catalog_data.py`: scoped list data and summaries.
- `erpnext/stock/page/product_detail/product_detail.js` and `.css`: compact record view,
  period/color/warehouse filters, chart, tabs, and source-document navigation.
- `erpnext/stock/page/product_detail/product_detail.py`: inventory and historical cost lookup.

Inspect the current files before reuse; they can evolve. Temporary screenshots and
particular local products are not durable design assets or test specifications.

## Supplier Hub

The owner approved a Supplier Hub with current outstanding in red, period gross profit
in green (losses remain red), period purchases (initially this month), and current linked
stock value. Show amounts without repeated currency symbols; state company currency
in the scope text. Gross profit replaces overdue in the summary and default rows;
overdue remains available through the payment filter and Supplier Detail. Keep the
default table to Supplier, Outstanding, Gross profit, Stock value, Period purchases,
and Last purchase. Put counts, quantity, payments, and lifetime purchases in optional
columns; put company, warehouse, numeric stock conditions, and sorting in additional
filters. Keep unrelated module links in the page menu.

All summaries follow the search and filters across every matching result, independent
of pagination. Current balances/stock do not follow the purchase period. Use native
payable allocation and company currency, keep unallocated credits/advances separate,
and source payment activity from Payment Entries rather than purchases minus debt.
Supplier stock means linked products, not proven ownership of particular units. A
product may appear in several supplier rows; count it once in the summary and explain
shared links. The same linked-product scope applies to gross profit: use net sales less
historical costs for the selected period/company/warehouses, including returns, with
Sales Invoice permissions. Count shared product profit once in the filtered summary.
Do not imply stock-lot supplier attribution. Restrict inventory to permitted
items/warehouses within the company.

## Supplier Detail

The owner approved an invoice-first record view in the same restrained style as Product
Detail. Show compact supplier identity/contact links, four current/period summary figures
(outstanding, period gross profit, period purchases, current linked stock value), then Invoices,
Payments, Products, and Details tabs. Default to unpaid invoices across all posting dates;
the purchase/payment period must never hide older unpaid debt. Use due dates and overdue
days, expandable invoice contents, native document links, and complete paginated history.
Use the Hub's shared accounting/inventory source and keep unallocated credits separate.
Match the Hub's amounts without repeated currency symbols, red debt, and green gross
profit (red losses). Use the same historical-cost, linked-product profit calculation
and company/warehouse/period scope; invoice search/status/date filters affect the list
only. Keep unpaid invoice status text (including “Не оплачено”) and positive remaining
balances red. Retain overdue invoice status, due dates, and overdue days in the list.
Foreign-currency document contents/allocations retain their currency code for clarity.

Keep contact details readable; editing opens the native Supplier form and selected primary
Contact/Address records. A supplier statement opens native General Ledger with supplier,
company, and date filters, retaining native print/export and opening/closing balances.
The compact payment dialog pays one invoice through a permitted existing account/wallet,
with native Payment Entry construction and create/submit permissions. Foreign currency
and payments involving deductions/discounts use the full ERPNext payment workflow.
Opening the page or account chooser must never initialize wallets or write business data.

Supplier loading must stay responsive with large variant catalogs: discover supplier links
before fetching Item metadata, keep generated IN lists bounded, and retain native query
validation and row permissions. Tab-only requests reuse the current header and avoid
inventory work. Browser-held results are revalidated against committed document changes,
current access, and a short expiry; explicit Refresh and returning from native documents
request fresh data. Keep totals independent of pagination and test uncached timings.

## Quick Product Intake

The owner confirmed that suppliers do not always agree a payment deadline. Keep the
deadline optional: no agreed deadline must not silently become today's deadline or
produce an overdue warning. An unpaid balance without a deadline still counts as
outstanding supplier debt. Carry this meaning through the native source documents and
supplier summaries when implementing the reviewed intake improvements.

Allow creating products and variants with zero incoming quantity. Preserve their supplier
relationship even without a purchase invoice. When all quantities are zero, clearly show
that only products were created: no goods were received and no invoice or supplier debt
was created. Quick Product Restock remains outside this intake review's scope.

The approved intake layout follows Product, Receiving, Prices and variants, Payment,
then Summary. Keep supplier bill details and generated document links secondary. Use
one native Create Variants action, preserve quantities and row price overrides, label
the cost-based percentage as markup, and show incoming quantity, purchase total,
payment to record, and remaining debt before submission. Submitted intake summaries
describe the intake transaction; link to the invoice for its current balance. Preserve
company scope when opening Product Detail or Supplier Detail.
