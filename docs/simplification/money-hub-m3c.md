# Money Hub M3c — Business results tab

Date: 2026-11-07. Implementation: **Implemented locally**. Verification: **Passed**
within the scope below. Owner acceptance and intended-site activation: **Pending**.
Parent: [Money Hub](money-hub.md). Current pointer: [root tracker](../../../../ERP_SIMPLIFICATION.md).
Calculation contracts: [M3a posted results](money-hub-m3a.md) and
[M3b historical costs](money-hub-m3b.md).

## Behavior and scope

Money Hub now has a **Business results** tab at `/app/money-hub/results`. It loads
`get_business_results` independently of the Accounts/Movement reads, so readable
financial results do not require a Money Wallet to exist. Opening or filtering the
tab creates no wallets, accounts, settings or financial documents.

The compact native Company Link and period controls default to this month through
today. Today, seven days and custom dates are available; the server retains its
366-day inclusive maximum, no-future and ordered-date validation. Results show the
returned company, exact dates, reporting currency and configured finance book.
Movement filters and the inactive-wallet checkbox do not alter the results scope.
Refresh and returning to the tab retain its company and period.

The page separates two calculations:

- Posted income, posted COGS, other recognized expenses and the posted result come
  directly from M3a's permitted Income/Expense GL. The visible equation is income
  minus COGS minus other expenses. Cash transfers, inventory purchases or settlement
  payments are not automatically treated as additional period expenses.
- Sales Invoice net sales, historical COGS and gross profit come from M3b. Sales are
  after discounts/returns and exclude sales taxes. This analysis is not added to the
  posted expenses again. Recorded zero is displayed as zero; missing total cost or
  gross profit stays a dash. The known-cost subtotal is labelled a partial amount.

The invoice section explicitly dates the fulfilment cost evidence **available as of
today**. A later linked delivery can change analysis of an earlier invoice period;
GL expenses retain their posting period. Returns are identified as already included,
and original invoice currencies/base equivalents are available in an expandable
reconciliation section. Different currencies are never added as raw amounts.

All permitted nonzero account rows are available in the expandable breakdown without
client truncation, with category, base amount and original account amount/currency.
Native Account links, General Ledger by account, the period P&L and submitted nonopening
Sales Invoice list retain company/date scope. Report links use native Report role,
reference-DocType report permission and disabled-state gates; the destination still
enforces its own native permissions. This adds no report, export, payment or payroll
grant. It does not establish that every advanced native report has identical scope.

The tab says the result is provisional and not final net profit. It explains native
row scope, separate unmerged POS amounts, unknown unsent offline activity, unposted
obligations, unverified payroll/tax coverage and unconfigured store allocation.
No new payroll, tax or recognition policy was inferred.

## Interaction and implementation

Loading, empty permitted ledger, denied/missing data, errors and retry have explicit
RU/TG states. Changing company text or dates clears prior totals and invalidates older
responses. Company/date mismatches and malformed responses cannot render. Custom dates
apply only when the user presses Show. Late results after a tab change are ignored.
Native Link defaults use `set_input`, matching native FieldGroup initialization;
user-entered Link changes still validate normally. This avoids an asynchronous default
validation race that left the company field briefly empty in the browser check.

Toolbar Transfer, Owner funds and Create wallet resolve the selected results company's
native wallet context before opening the existing dialog. A denied context leaves the
readable results intact and explains the missing wallet/account access; a scope change
while loading prevents the dialog from opening for the old company. These checks do
not change the underlying M2 write contracts or request-ID recovery.

Styles use Desk theme variables, a restrained summary strip, expandable details and
contained table scrolling. Filters wrap on mobile; controls have labels, keyboard
access and visible focus. No chart or additional frontend dependency was introduced.

Changed files relative to the ERPNext repository:

- `erpnext/accounts/page/money_hub/money_hub.js` and `.css`.
- `erpnext/accounts/page/money_hub/business_results.py`: optional navigation flags
  and explicit reporting precision; M3a/b totals and permissions remain authoritative.
- `erpnext/accounts/page/money_hub/test_business_results.cjs` and `.py`.
- Root tracker, roadmap, Money Hub plan and this report.

## Checks on 2026-11-07

- **122 database-free backend cases passed**, including two new native-navigation
  gating cases and retained Money Hub/product/supplier/cost regressions.
- **73 Node cases passed**: 19 new results cases plus 54 retained Money Hub/Home/retail
  route cases. New coverage includes independent loading without wallets, scope/date
  validation, server-default company, stale/malformed/wrong-company responses, retry,
  missing versus zero, separate posted/analytical/POS totals, all 601 account rows,
  currency/precision, escaping, native links and scoped toolbar dialog orchestration.
- **Four authenticated Desk browser fixture contexts passed**: RU owner and TG manager
  at 1440px and 390px, each in light/dark themes. Financial results were intercepted;
  current JS/CSS was injected over the existing native Desk page without restarting
  workers or changing business data. Checked known/unknown costs, company input
  invalidation, presets/custom dates, late responses, loading/empty/error/retry/403,
  scoped native link URLs, original USD, keyboard focus, route tabs and no page overflow
  or uncaught page errors. Native 403 feedback was closed before exercising inline retry.
  Desktop RU and mobile RU/TG screenshots were visually inspected.
- **Development-site read-only transaction passed** for the actual owner/manager users:
  posted results still reconcile to native P&L, known analytical figures reconcile,
  completeness remains explicit, and navigation eligibility agrees with native Report
  entry gates. A patched-denied report capability hides the links independently of
  financial-result readability. Existing product/supplier/Home reads still load;
  cashier results access is denied. Transaction rolled back. This uses current Python
  in a fresh bench process, not reloaded HTTP workers.
- JavaScript syntax, scoped ESLint, changed Python syntax and scoped whitespace passed.
  Documentation validation passed for 24 Markdown files and 125 local links, including
  newlines/whitespace, after updating the tracker.

Private harnesses, logs and screenshots are under the development site's
`private/money-hub-m3c/`. No real financial posting, role grants, migration, worker reload,
cache activation, commit, push or deployment. Disposable database fixtures were not
needed or rerun in this UI increment; the earlier M3b native evidence remains historical.
No dedicated test containers were started this session.

## Owner review and next work

After the normal intended-site activation, review Money Hub → Business results as
owner and manager: company/period, posted totals against native P&L, permitted account
drilldown, invoice gross profit and missing-cost explanation. Review a USD expense,
return and unmerged POS example where available. This is pending owner acceptance.

**Next increment: M4a — expense/payroll/tax coverage audit and reconciliation plan.**
Trace Quick Expense, custom Staff Settlement, native HRMS Salary Slip/Payroll Entry,
Expense Claim/Advance, supplier reimbursement/payment and tax liability/payment paths
to the authoritative GL. Identify recognized, paid, unposted and duplicate-backed
sources; document missing native coverage and tests needed before changing formulas.
Read ERPNext/HRMS/POS guidance according to actual source ownership and reuse the
expense/shift contracts. Actual HRMS execution needs an appropriately installed test
site; absence from the current disposable site is a coverage gap, not zero payroll.
Audit the two existing tax settings paths without inventing a tax regime.

Q03 recognition/cutoff/allocation, Q04 store attribution and Q10 actual tax regime remain
open. The audit can proceed without selecting tax rates or publishing final profit.
M4 final-profit integration and M5 advanced report/cache/performance verification remain
incomplete. Owner activation/acceptance and M2 schema/account setup remain separate queues.
