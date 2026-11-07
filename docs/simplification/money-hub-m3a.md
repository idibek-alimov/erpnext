# Money Hub M3a — posted results and financial visibility

Date: 2026-11-07. Implementation: **Implemented locally**. Owner acceptance: **Pending**.
Release: **Not released**; no intended-site worker reload, schema upgrade or role grants.
Parent: [Money Hub](money-hub.md). Current pointer: [root tracker](../../../../ERP_SIMPLIFICATION.md).

## Result and boundary

The first read-only results service uses permitted posted GL income/expense rows once.
Home uses it in place of its independent Quick Expense/Staff Settlement/tax-estimate
formula. Its UI says **Result from postings**, with an explicit provisional explanation.
It no longer presents that formula as final net profit. D06 manager profit/cost visibility
is implemented in the shared retail policy; native document/company permissions remain.

This completes the bounded M3a foundation, not all of M3. Invoice-date analytical COGS
and gross profit remain unavailable in the new service until M3b reconciles the delivery,
bundle, nonstock and return paths. M3c will build the Money Hub Business results tab.
Q03 financial basis/allocation and Q04 store attribution are not settled by this pilot.

## Posted-results contract

Endpoint: `money_hub.get_business_results(company, from_date, to_date)`.
Implementation: `accounts/page/money_hub/business_results.py`.

- Defaults to this month through today. Explicit dates must be ordered, end no later
  than today and cover at most 366 inclusive days. No silent all-time truncation.
- Company must be natively readable. Requires Account and GL Entry read permission;
  native `get_list` row/field restrictions apply before aggregation. Account lists use
  permitted company leaf Income/Expense accounts, including disabled historical accounts.
- GL queries use company, inclusive dates, noncancelled rows and permitted account
  batches of at most 200. Period Closing Voucher rows are excluded. Default company
  finance book plus blank/null-book rows are included; alternative books are excluded.
  Opening P&L entries remain included, matching native P&L at the tested date/book scope.
- Income is credit minus debit; recognized expense is debit minus credit. The COGS
  subtotal uses native Account type `Cost of Goods Sold`, never a translated name.
  Other expenses equal all recognized expenses less that COGS subtotal. The posted
  result equals income less all recognized expenses. It is not cash in minus cash out.
- GL base debit/credit use native global currency precision with Decimal row rounding.
  Per-account original amounts retain account currency and are never mixed into base
  totals. Missing original fields return null; missing required base/classification
  fields reject the request instead of fabricating a partial total.
- No salary slip, employee name/pay, bank identity, custom settlement breakdown, voucher
  remarks or employee allocation is fetched. Payroll expense already posted to GL is
  part of recognized expenses; this creates no new payroll-detail access.
- Response always says `provisional`, `final_profit: false` and permission-scoped.
  It explicitly identifies unposted costs, payroll/tax coverage, offline POS, analytical
  invoice COGS and store allocation as unverified. Native restrictions may hide rows;
  no unrestricted query is used to discover or announce hidden amounts/counts.

The account breakdown contains only permitted account names/types and their base/original
totals. It is not a source-voucher drilldown and does not bypass voucher read permission.
Native GL access is the authority for these aggregate book figures, as for M1 balances.

## Sales, cost timing and source precedence

Submitted, nonopening Sales Invoices supply `base_net_total`, net of discounts and taxes.
Returns retain their own posting date and negative base amount; cancelled invoices are
excluded. Original net totals are grouped by currency, separate from company-base totals.
Missing invoice read permission means unknown, not zero. Missing required fields fail
closed. Submitted unconsolidated POS Invoices are a separate informational subtotal;
they are never added to SI sales or ledger income. Consolidated POS is excluded from
that subtotal even when its linked SI belongs to another period. Unsent offline POS
cannot be discovered by this server and is always explicitly unknown.

The income-minus-invoice-sales diagnostic need not be zero: other income, permissions,
opening entries, dates, finance books and consolidation may explain differences. Do not
turn that difference into a balancing adjustment. Invoice sales currently include all
permitted SIs in the company/date scope; a book-specific GL comparison is diagnostic.

| Source | Recognition precedence in this service |
| --- | --- |
| Quick Expense / legacy expense / custom document | Count its native expense GL once. Never add the custom amount to its backing JE/PE |
| Native expense PI or JE | Expense-account GL on its posting date, including unpaid expense invoices |
| Supplier stock purchase and payable settlement | Asset/liability/cash legs do not become another expense; actual Expense legs still count |
| HRMS Expense Claim and reimbursement | Claim's native expense GL is authoritative; later payable settlement does not repeat recognition |
| HRMS payroll | Accrual JE expense GL counts; salary-slip totals and subsequent payments are not added |
| Custom Staff Settlement / advance | Count only actual native Expense GL, with no inferred accrued salary. Existing fallback/misposting/allocation gaps remain S0/M4 work |
| Owner funds, loans, repayments and internal transfers | Equity/Liability/Asset legs excluded by root type; actual fees/FX Expense legs still count |
| Collected sales tax / tax payment | Liability/cash movements do not reduce profit again. Actual Expense GL counts once; no tax estimate is calculated or added |

Source trace: Retail Home previously used SI `qty * incoming_rate`, Quick Expense only,
custom submitted Staff Settlements and `tax_for_range` with exceptions converted to zero.
Native P&L uses Income/Expense GL and excludes period-closing entries. Product Detail's
`ProductCostLookup` reuses GrossProfitGenerator for historical valuation. HRMS payroll
creates an accrual JE; Expense Claim creates expense/payable GL. Those controllers were
read, not changed. Actual HRMS payroll/claim execution is not verified by this increment.

Native stock-sale/return tests reconcile ledger COGS with the existing ProductCostLookup
on a simple FIFO sale. They do not prove invoice-period COGS equals ledger-period COGS
for delivery-before-invoice, partial billing, bundles or nonstock costs. The service
therefore returns null analytical COGS/gross profit rather than a guessed figure.

## Permission and Home changes

`setup/retail_security.py` now includes Retail Manager in financial roles and rejects
Guest. Administrator/owner/system manager retain access. Classic nonretail ERPNext
behavior remains subject to native permissions. `require_financial_access` supplements
native access; it grants no roles, document permissions, payment or approval rights.

The simplified Product Catalog, Product Detail/Overview, Supplier Hub/legacy details
and Supplier Detail/invoice-item entrypoints apply the retail policy server-side.
Cashier/Guest cannot call them directly to bypass the Desk route guard. Existing native
company/source rules remain inside those implementations. This is not a complete audit
or rewrite of every legacy product/supplier metadata query or classic accounting report.

Home's P&L and pulse use the new results service. Legacy transport keys `net`,
`net_profit_today` and `net_profit_month` remain for compatibility but represent posted
results; `basis`, completeness and the updated UI carry the meaning. Legacy salaries,
taxes and analytical gross are null. Home's sales comparison now uses native SI list
permissions. Its shift, low-stock and supplier alerts are retained using native parent,
child, item and warehouse scope, with company filters before aggregation. Low-stock
checks use stock items only. The existing native POS Closing Entry alert still needs
H0 reconciliation with POS Awesome Shift Review; no new loss-approval logic is added.

RU/TG labels, unavailable-value dashes, scoped native P&L link, labelled date controls,
loading/error/retry and stale-response guards are included. A small scoped CSS adjustment
keeps long labels apart from amounts on mobile. This is a correctness correction to
Home, not completion of H0–H3 or the Money Hub results-tab redesign.

Native Gross Profit and P&L report eligibility and GL export permission were checked
for manager/cashier. Their existing Accounts User/GL permissions provide manager access;
no report/DocType permission grants were added. CSV/Excel content and every classic
Gross Profit source-row restriction were not newly verified. M3b must audit those
historical-cost/report paths before advertising a fully reconciled analytical result.

## Verification on 2026-11-07

- **90 database-free backend cases passed:** retained Money Hub 57, new results 9,
  and 24 Product Catalog/Detail/Supplier Hub calculation regressions.
- **16 new disposable native cases passed:** native P&L reconciliation, recognized
  expense then payable settlement, financing/transfer/advance exclusion, prior period,
  cancellation, USD original/base, default/alternative finance books, manager/owner/native
  accounting visibility, cashier/Guest API denial, company/account restrictions, denied
  GL access, Home semantics, SI returns/original currency, collected tax, FIFO stock
  sale/return and historical ProductCostLookup comparison. The unmerged-POS case uses
  an intercepted POS list over native SI/GL; it is not a full native POS closing test.
- **22 owner-money native regressions passed** after the shared visibility change.
- **54 Node cases passed:** retained 44 Money Hub, 6 new Home and 4 cashier-route cases.
- **4 authenticated Desk browser fixtures passed:** RU/TG × 1440/390px, posted/provisional
  labels, unknown POS amount, scoped report link, custom dates and keyboard focus,
  dark theme/no page overflow, permission failure/native dialog dismissal/retry.
  Home financial APIs were intercepted; screenshot inspection covered desktop/mobile.
- **Actual development site, read-only transaction:** owner and manager current-month
  results reconcile to native P&L; scoped Home pulse/alerts load; cashier denied. The
  transaction was rolled back. No posting, migration, financial setup or grants.
- Python compile, JavaScript syntax, scoped ESLint and changed-file whitespace checks
  passed. Existing ESLint configuration deprecation only. No frontend bundle build was
  needed for these native Desk page files; no POS/frontend/package dependency changes.
- Tracker/plan validation passed for 19 Markdown files and 106 local links, including
  final-newline and trailing-whitespace checks.

The disposable `allow_tests` site used the existing dedicated DB/Redis containers;
native financial test cases roll back. Their initial stopped state was restored after
checks. Native harnesses/logs/browser screenshots are private under the development
site's `money-hub-m3a` directory, not in published docs. Ordinary Docker services and
business-site workers were not restarted. No commit, push or deployment.

Useful repeat commands from the bench root:

```sh
env/bin/python -m unittest erpnext.accounts.page.money_hub.test_business_results -q
node --test apps/erpnext/erpnext/setup/page/retail_home/test_retail_home.cjs
```

On a suitable disposable migrated `allow_tests` site, run the native module
`erpnext.accounts.page.money_hub.test_business_results_native`. Do not run native fixture
builders concurrently; do not post real business transactions to verify this view.

## Next: M3b, then M3c

1. Extend `business_results.py` with a permission-safe invoice-date historical-cost
   bridge using the approved ProductCostLookup/GrossProfitGenerator machinery. Reconcile
   Delivery Note before/after invoice, partial billing, stock UOM, returns in later
   periods, bundles, nonstock purchases and foreign/base amounts. Missing evidence
   remains unknown; never fall back silently to current buying prices.
2. Audit native/source permissions in those shared cost/report/export paths and legacy
   product/supplier cost metadata; test restricted SI/PI/warehouse/company cases.
   Do not mistake report eligibility for proof that every underlying query is scoped.
3. M3c: create the compact Money Hub Business results view over the reconciled service,
   with permitted account/source drilldown, dates, errors/completeness and native links.
4. M4: verify actual payroll, staff settlements/advances, claims, tax regime/recognition
   and period allocation before final-profit labels. Q03/Q04/Q10 remain open. Owner
   review, intended-site activation and production-scale performance remain pending.
