# Money Hub M1c — account overview and scoped balances

Date: 2026-11-07. Implementation: **Implemented locally**.
Verification: **Targeted checks passed**; owner acceptance **Pending**.
Release: **Development activation only**.
Parent: [Money Hub](money-hub.md). Previous: [M1b](money-hub-m1b.md).

## Result and UI

Accounts now has four restrained summary figures and one native-style row per account,
replacing the colored wallet cards, duplicate alias balances and separate group panels.
Current balance follows account identity, then opening balance and today's inflow/outflow.
Foreign balance retains its currency below booked company-currency value. Account links
open native records; Movements opens the selected account's permitted source history.

Expense navigation is the primary action; Transfer and Refresh remain visible on desktop.
Cross-module links and wallet administration are secondary menu items. Create Wallet is
shown only with native create permission; existing native wallet forms remain available.
This changes presentation, not backend posting authority. Transfer/wallet/tax write
permission, retry and FX weaknesses identified in M0 remain for M2.

One “Include inactive wallets” checkbox controls both tabs. Active-wallet accounts are
the default; checking it includes permitted inactive-wallet accounts in both rows and
totals. A shared account with an active alias still includes its whole visible ledger.
Multiple aliases count once and use native Account type for cash/bank classification,
regardless of conflicting alias names/types. Hidden/active filtering never invents
register-level account attribution. This is an implementation policy, not a new owner
business decision or permission grant.

Summary/table/explanation use theme tokens, RU/TG labels, real links, keyboard controls,
contained mobile table scrolling and explicit empty/error/retry/missing-amount states.
Late responses cannot restore obsolete scope. Background movement loads update the count
without replacing the focused Accounts table. Visual checks caught and corrected dark
active-tab contrast. Current balance was moved beside identity for narrow screens.

## Accounting and permission contract

`get_money_hub_data` now builds a single ledger snapshot through `as_of=today()`:

- Require the existing role gate plus native company, wallet, cash/bank leaf Account and
  GL read scope before querying figures. Account batches are at most 200 unique names.
- Native `frappe.get_list("GL Entry")` applies GL row and field permissions, explicit
  company/account scope, `is_cancelled=0` and `posting_date <= as_of` before summing.
  No raw aggregate SQL, unrestricted metadata query or per-wallet balance call.
- Opening is every visible posting before the date; activity is postings on the date;
  closing is every visible posting through that date. Opening + incoming − outgoing =
  closing. Future postings are excluded. The previous no-date `get_balance_on` call
  could include future postings, and `_today_movement` bypassed GL row permissions.
- Amounts round each GL debit/credit using the configured native currency precision,
  with decimal half-away rounding, matching native `get_balance_on` semantics at an
  explicit date. Currency-specific field precision remains the display precision.
- Company totals use stored base debit/credit. Original account balances use stored
  account-currency values; no guessed conversion or mixed-currency sum.
- Negative debit/credit entries follow their cash direction. Account activity includes
  internal transfers; aggregate change retains their net. It is not sales or profit.
- Missing base amount fields invalidate that account's base figures and the affected
  summary totals; they never become partial/zero balances. Missing original amounts
  remain missing. Missing account/date identity fails closed. A visible empty ledger
  account is zero. A row-restricted ledger is labelled available-posting scope, not a
  claim of a complete company/account statement.

Balances intentionally use **all permitted GL source types** without fetching denied
source documents. The owner previously approved account-balance visibility. Movement
history has the additional source-read/five-supported-type restrictions from M1b, so
its net may differ. The UI explains this distinction, physical count versus accounting
balance, separate shift differences, and unposted/offline POS sales.

`wallets`, `pos_tills`, `safes`, `bank_wallets`, original `totals` keys and currencies
remain for existing consumers (Home and POS verification paths). New `accounts`,
`as_of`, `balance_scope`, `include_hidden` and `totals.opening_balance` support the UI.
When `include_hidden=1`, totals now include those displayed hidden accounts; previously
hidden rows could be returned while silently excluded from totals.
`get_money_movements` adds an optional trailing `include_hidden` argument (default 1
preserves M1b API behavior); the UI passes its checkbox scope explicitly. Legacy array
history and native transaction details retain historical access.

## Files and linked impact

- `account_balances.py`: batched permission-scoped snapshot and rounding/missing values.
- `money_hub.py`: remove raw `_today_movement`; compose the snapshot, aliases and totals;
  restrict linked accounts to native Cash/Bank leaf scope; extend paged scope argument.
- `movement_history.py`: accept the explicit active/inactive wallet scope.
- `money_hub.js` / `.css`: overview, page actions, scope toggle, navigation and focus/theme fixes.
- `test_account_balances.py`, `test_account_overview.cjs`: snapshot/overview regressions.
- Existing balance/history tests: retain prior cases, migrate balance-helper assertions
  and add checkbox scope propagation coverage.

Home still consumes `totals` and POS has native tests of the wallet/base balance contract;
those names and alias rows remain. Neither app's calculation, checkout, shift, offline
queue or profile logic was edited. No new schema, roles, grants, business postings,
financial cancellations, migration, commit or push.

## Verification actually performed

| Check | Result / scope |
| --- | --- |
| Backend fixtures | **54 passed**: 12 snapshot/overview cases, 5 retained balance cases, 18 history cases and 19 detail cases. Includes rounding, USD/base, negative postings, missing fields, company/account scope, unique/batched accounts, exact dates, historical search/paging/transfers and no writes |
| UI fixtures | **22 passed**: 8 account overview, 6 movement and 8 detail cases. Includes one row per account, missing/escaped values, scope requests/races, retry, background focus preservation and currencies |
| Native read-only reconciliation | Owner and manager each: 6 accounts with both checkbox scopes; company/original balances match native `get_balance_on` at an explicit date, account and total opening/activity/closing identities match, aliases count once. Historical snapshot 2026-11-04 has nonzero activity and excludes later existing postings; native balances also match. Cashier denied. Transaction read-only and rolled back |
| Authenticated native browser | Owner 1440px and manager 390px: 6 account rows, native links, table keyboard focus, selected account → Movement → Accounts, checkbox scope, failed-read/retry without stale balances, no page overflow/uncaught errors |
| Labelled browser API fixtures | RU/TG × 1440/390px: USD versus TJS, shared aliases counted once, inactive account toggle changes rows/totals, escaped text, light/dark rendering and no page overflow. Not real USD/hidden-account postings |
| Regression browser | Existing M1b native and RU/TG/large-history fixture harness rerun for affected history navigation/loading |
| Source checks | Python compilation, Node syntax, scoped ESLint and Git whitespace checks; legacy ESLint-config deprecation notice only. 17 Markdown files/88 local links and whitespace checked |
| Visual review | Inspected native desktop/mobile and fixture dark/light screenshots; corrected dark-tab contrast and prioritized current account balance on mobile |

Commands from bench root:

```bash
env/bin/python -m unittest erpnext.accounts.page.money_hub.test_account_balances erpnext.accounts.page.money_hub.test_shift_balances erpnext.accounts.page.money_hub.test_movement_history erpnext.accounts.page.money_hub.test_transaction_details -q
node --test apps/erpnext/erpnext/accounts/page/money_hub/test_account_overview.cjs apps/erpnext/erpnext/accounts/page/money_hub/test_movement_history.cjs apps/erpnext/erpnext/accounts/page/money_hub/test_transaction_details.cjs
git -C apps/erpnext diff --check -- erpnext/accounts/page/money_hub docs/simplification
```

Private harnesses/screenshots: `sites/radolfa.localhost/private/money-hub-m1c/`.
Discovered the running supervised local Gunicorn and gracefully refreshed its Python
workers. Docker was not touched. Native Desk page JS/CSS needs no unrelated bundle
build; hard-refresh existing browser tabs. Credentials remain in the private earlier setup.

## Limits and owner test

The site has six active TJS accounts and no actual inactive-only/USD accounts in this
check. Inactive/shared/USD and restricted amount-field behavior have fixture coverage;
no business documents or user permissions were created to manufacture coverage.
Existing native read scope was checked; an additional live GL row restriction was not
installed. Large-ledger performance and POS native tests that post disposable financial
fixtures were not run against this business site. The shared totals/alias API was
preserved and read-only reconciliation passed; this is not fresh POS/hardware testing.

All permitted historical GL rows through the date are read in account batches. This
avoids permission-bypassing sums, but needs representative larger-ledger performance
checks during M5. Source-history coverage, final profit/tax/payroll, manager profit
policy and existing backend financial-write risks remain as previously recorded.

Owner test: refresh Money Hub → Accounts. Compare a balance to its native ledger at the
shown date, then check opening + incoming − outgoing. Open Movements for that account
and note the additional source permission restrictions. Try the inactive checkbox,
narrow window and Russian/Tajik. No financial posting is needed to review the screen.

## Next task: M2a — secure existing writes and establish native transfers

Inspect `create_wallet`, `update_wallet`, `transfer_money`, `pay_tax` and their callers/
POS profile effects before editing. Establish native create/write/submit and company/
wallet/account permission checks; read visibility must not imply posting authority.
Implement a concrete transfer contract with distinct account identities, correct
source/destination currencies, native validation and durable duplicate/retry outcomes.
Preserve existing expense/shift contracts and do not post to the business site for tests.
Owner-money mapping (Q02) remains unresolved: inspect existing native account treatment
and prepare a concrete recommendation before requesting a material business choice.
Do not guess an equity/loan mapping from names or remarks. M3/M4 profit remains later.
