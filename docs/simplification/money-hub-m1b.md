# Money Hub M1b — complete scoped history and simpler movement UI

Date: 2026-11-07. Implementation: **Implemented locally**.
Verification: **Targeted checks passed**, with limits below.
Owner acceptance: **Pending**. Release: **Development activation only**.
Parent: [Money Hub](money-hub.md). Previous: [M1a](money-hub-m1a.md).

## Result

Movement history now applies native wallet/account/company, GL row/field and source
list/field permissions before classification, filtering, counting and aggregation.
Search and totals cover every matching permitted movement, including matches older
than the former 500-row cutoff. The history shows 50 results per page, complete counts,
whole-filter totals, company/date/currency scope, source links and keyboard-operable
transaction details. Seven days means today plus six preceding dates.

The movement screen uses a compact summary and six-column table, plain filters,
contained mobile table scrolling, original foreign account amounts, loading/empty/
inline retry states and guarded asynchronous requests. Search keeps keyboard focus
through rerenders. All variable history content and links are escaped. Russian and
Tajik labels are retained. This improves the **Movement** tab; the **Accounts** overview
and page-wide action hierarchy still need M1c. This is not a completed Hub redesign.

## Query and accounting contract

`get_money_movements` returns `rows`, `total_count`, `summary`, `start`, `page_length`,
`has_more`, company/currency/date scope, permitted-account versus single-account scope,
and supported source types. A page has at most 100 rows (the UI requests 50).
Deterministic order is posting date, GL creation and unique GL name, descending.
A page beyond the last result is clamped to the last valid page. This is offset paging
of current committed data, not an immutable snapshot across concurrent postings.

- GL uses native `frappe.get_list`, explicit company, unique permitted accounts,
  `is_cancelled=0` and posting dates, without a pre-filter result cap.
- Sources are native permission-scoped, submitted, same-company Payment Entries,
  Journal Entries, Sales/POS Invoices and Purchase Invoices. Names are queried in batches
  of 200; there is no per-row detail RPC or unrestricted metadata query.
- Unknown source types and denied/unposted sources are omitted before summaries and
  search. The UI discloses the supported source coverage and explains why its totals
  can differ from the full account balance. It does not reveal denied-source counts.
- Typed permitted Quick Expense links classify expenses. Customer, supplier and employee
  payments use their actual party type; receipts/refunds keep their actual direction.
  Journal remarks do not prove a tax, owner contribution or transfer. Such journals stay
  accounting entries until a trusted typed contract exists. No tax filter pretends otherwise.
- Shared-account wallet aliases do not duplicate GL rows. All-account labels retain
  aliases; a selected alias names the same account without narrowing it to a register.
- Negative debit/credit postings normalize into the direction of the actual cash change.
  Company totals use booked base amounts. Original account currency/amount remains on
  each leg; no inferred exchange rate or mixing of USD and TJS.
- Restricted base amount fields omit the movement rather than inventing zero. Restricted
  original amount fields remain missing. Native source field restrictions remain applied.

All-account views group each typed **Payment Entry Internal Transfer** into one event,
with its permitted account legs and a source → destination label derived only from
those legs. An unavailable side is labelled outside the selected accounts. `transfer_amount` is the paired minimum of incoming
and outgoing booked base amounts. That paired amount is excluded from both ordinary
inflow and outflow. Any difference/unpaired visible leg remains a movement across the
selected permitted-account boundary; this does not classify the difference as profit,
a fee or FX expense. No invisible destination/account is fetched or inferred.
A single-account view keeps its actual GL legs, including transfers.

`summary.ledger_in/out` retain normalized account-leg activity. Before additional
search/type/direction filters, event net equals the net of the same permitted GL legs.
The same identity holds for the selected matching events after filters; direction
filters operate on residual inflow/outflow, so a fully paired transfer does not match
incoming-only or outgoing-only in an all-account view. Decimal accumulation avoids
phantom transfer residuals from floating-point sums.

`get_money_feed` remains an array endpoint with its existing arguments/default limit.
It uses the secured query and retains transfer **legs** for compatibility. Filtering
now precedes its requested limit. New UI callers use the paged endpoint. Its old raw
SQL and unrestricted source/expense metadata queries were removed.

## Files

- `erpnext/accounts/page/money_hub/movement_history.py`: shared read-only query,
  permission-scoped metadata, grouping, classification, filtering and summaries.
- `money_hub.py`: new whitelisted paged endpoint, compatible array wrapper, corrected
  seven-day period. Existing financial write and M1a detail methods are preserved.
- `money_hub.js` / `.css`: migrated history, simpler summary/table/filters, keyboard
  controls/source links, currency/coverage explanations, pagination and robust states.
  The old Accounts positive-flow wording no longer calls cash flow profit.
- `test_movement_history.py` / `.cjs`: backend and UI regression fixtures.
- `test_shift_balances.py`: migrated two feed-query assertions from raw SQL to the
  native query contract; the prior balance cases remain intact.

No role grants, schema changes, POS/HRMS edits, posting, cancellation, commit or push.
Other pre-existing local expense/shift changes were preserved.

## Checks actually performed

| Check | Result and scope |
| --- | --- |
| Backend fixtures | **41 passed**: 17 movement-query, 19 M1a detail and 5 existing balance tests. Covers 601 rows/older search, page-independent totals, source/type/company/account restrictions, transfer pairing/partial scope/FX difference, aliases, typed expenses, employees, returns/negative debit, USD/base, missing amounts, exact seven days and read-only behavior |
| Node fixtures | **14 passed**: 6 movement orchestration/render tests and 8 existing detail tests. Covers server totals, company/page arguments, stale responses, inline retry, empty/Tajik states, escaping, original currency and source links |
| Native read-only site reconciliation | `radolfa.localhost`: owner and manager each paged 36 events at 10 per page. Every event and constituent GL leg reconciled to the authorized native transaction detail; all pages had identical whole-filter totals/counts. Compatible array had 42 legs and the same net. Cashier access denied. SQL transaction read-only and rolled back |
| Native browser | Owner 1440px and manager 390px: source links, keyboard detail opening, search/empty/focus retention, filter reset, permission failure and retry, no horizontal page overflow or uncaught page errors |
| Labelled browser API fixtures | RU/TG × 1440/390px: 601 results, 50-row pages, stable whole-filter totals on next page, USD/TJS labels, escaping, table keyboard focus and no page overflow. No USD records were posted |
| Source checks | Python compilation, Node syntax, scoped ESLint and Git whitespace checks passed; existing legacy ESLint-config deprecation notice only; 16 Markdown files/83 local links and whitespace/newlines checked |
| Visual inspection | Native desktop/mobile and fixture RU/TG screenshots inspected; readable summary, plain table, contained horizontal scrolling. Accounts overview remains for M1c |

Representative commands from bench root:

```bash
env/bin/python -m unittest erpnext.accounts.page.money_hub.test_movement_history erpnext.accounts.page.money_hub.test_transaction_details erpnext.accounts.page.money_hub.test_shift_balances -q
node --test apps/erpnext/erpnext/accounts/page/money_hub/test_movement_history.cjs apps/erpnext/erpnext/accounts/page/money_hub/test_transaction_details.cjs
node --check apps/erpnext/erpnext/accounts/page/money_hub/money_hub.js
ESLINT_USE_FLAT_CONFIG=false apps/posawesome/frontend/node_modules/.bin/eslint -c apps/erpnext/.eslintrc apps/erpnext/erpnext/accounts/page/money_hub/money_hub.js apps/erpnext/erpnext/accounts/page/money_hub/test_movement_history.cjs apps/erpnext/erpnext/accounts/page/money_hub/test_transaction_details.cjs
git -C apps/erpnext diff --check -- erpnext/accounts/page/money_hub docs/simplification
```

Private development harnesses/screenshots are under
`sites/radolfa.localhost/private/money-hub-m1b/`; credentials were read from the earlier
private setup, not copied into code/docs. The discovered local supervised Gunicorn
workers were gracefully refreshed for Python changes; Docker was not touched. No
migration or unrelated asset build. Existing browser tabs should hard-refresh.

The browser permission test confirmed native Frappe's 403 dialog still appears despite
`silent:true`; after dismissing it the inline retry succeeds. The page does not disable
framework authentication or permission behavior. An initial fixture assertion assumed
Russian thousands separators for Tajik; the harness was corrected to accept Tajik's
comma grouping/dot decimals. Both languages then passed.

## Limits and owner acceptance

The actual site's successful native set is TJS only; native USD, payroll, cash-linked
Purchase/POS Invoice examples and new cancellation postings were not created. Those
branches have applicable fixture coverage, not native end-to-end posting evidence.
The 601-row test is a fixture; local site timings around 0.02–0.10s on 42 permitted
legs do not prove production-scale performance. The query deliberately reads all
permitted GL rows in the date scope and batches source metadata; optimize against a
representative larger dataset without reintroducing pre-filter truncation if needed.

Full account balances and today's account activity still use the earlier overview
service; source-restricted history is not a complete statement of all account activity.
Overview GL row scope, hidden-wallet policy and hierarchy are next. Unsupported source
types, typed tax/owner/legacy movement provenance, broader manager profit visibility,
financial-write authorization/retries/FX and final profit remain outside M1b.

Owner test: open Money Hub → Movement. Change dates, search and account/type/direction.
Confirm totals represent every matching result, source links/details match native
records, and the selected account shows its transfer leg while all accounts show one
paired event. With a large fixture/test dataset, move between pages and confirm totals
stay fixed. Check a narrow window. Do not post real transactions to test the screen.

## Next task: M1c — Accounts overview and balance/activity scope

Before M2 writes, finish the main Hub's read-only experience:

1. Inspect `get_money_hub_data`, `_today_movement` and native balance helpers. Establish
   ledger row/field scope for balances and today's account activity; explain differences
   from source-restricted movement history and reconcile current/opening/activity figures.
2. Set a coherent enabled/hidden/shared-account policy across overview and history,
   retaining historical access and avoiding duplicate aliases or invented register scope.
3. Simplify Accounts overview to compact relevant figures and native account rows;
   improve page-wide action hierarchy and remove decorative clutter. Preserve M1a/b.
4. Verify native allowed/denied balances and read-only behavior plus Accounts/Movement
   desktop/mobile/RU/TG navigation. Do not change financial-write authority here.
5. Then select M2's concrete native owner-money/transfer write contract. Q02 mapping,
   retries and FX/payment permission checks must precede new simplified posting actions.
