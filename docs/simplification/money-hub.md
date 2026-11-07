# Money Hub and profit reporting

Status: In progress — M0 complete; M1a/b/c and M2a/b implemented and verified locally; M3a/b/c implemented locally; M4a coverage audit next. Priority: first.
Parent: [roadmap](README.md). Requirements: [D02–D06 and open questions](decisions.md).

Evidence: [M0 baseline and source map](money-hub-baseline.md),
[M1a transaction-detail implementation/checks](money-hub-m1a.md),
[M1b history/totals/UI implementation/checks](money-hub-m1b.md),
[M1c account overview/balance implementation/checks](money-hub-m1c.md),
[M2a authorized writes/native transfer implementation/checks](money-hub-m2a.md),
[M2b owner funds/loans implementation/checks](money-hub-m2b.md),
[M3a posted-results/visibility implementation/checks](money-hub-m3a.md),
[M3b historical-cost/source implementation/checks](money-hub-m3b.md),
[M3c Business results tab/checks](money-hub-m3c.md).
Owner acceptance is pending; no production release or final-profit verification.

## Purpose and existing foundation

Admins/managers need to understand where money went and what the business earned.
Existing source: `erpnext/accounts/page/money_hub/`, Money Wallet, Money Hub Settings,
native Account/GL Entry/Payment Entry/Journal Entry and invoice records. Existing
profit code is in `erpnext/setup/page/retail_home/retail_home.py`.

M1b removes pre-filter history truncation, applies native GL/source permissions and
returns paged results with whole-filter summaries. Typed internal transfers are events
in all-account scope and legs in single-account/legacy views. Source coverage and
permission restrictions are explicit. M1c now provides native GL row/field-scoped
account snapshots through today, opening/activity/closing reconciliation, shared/hidden
account scope and a compact Accounts UI. Overview balances and source-restricted history
use different disclosed source scopes. M2a write contracts and M2b owner funds/loans are implemented locally. Actual company
owner-account setup/activation is pending; final profit remains open.
Home now uses M3a's native permission-scoped posted-results service. The earlier
Quick Expense/Staff Settlement/tax-estimate formula has been replaced by recognized
Income/Expense GL, with invoice sales and unmerged POS separate. Its labels explicitly
say provisional posted results. M3b now adds shared invoice-date historical costs with native evidence and explicit
missing-data status. Payroll/tax completeness and final profit remain pending; see
the linked reports.

## Proposed experience

- Money movements: compact balances, incoming/outgoing summary, source/destination,
  category, counterparty, date and store filters, readable transaction history.
- Transaction detail: why money moved, amount/currency, source/destination, related
  invoice/expense/payment/shift, actor and correction/reversal links.
- Business results: net sales, historical cost of goods sold, gross profit, operating
  expenses, payroll, relevant taxes/other recognized costs and resulting profit/loss.
- Explain completeness and the reporting period. Pending offline POS invoices and
  unposted/unapproved obligations cannot silently become zero activity.
- Prominent permitted actions: record expense, transfer, supplier payment and owner
  money in/out. Keep account administration and advanced accounting secondary.

## Calculation and accounting contract to establish

- Use native ledger balances and authoritative posted documents. Opening balance,
  period activity and closing balance must reconcile at identical scope.
- A transfer has two account legs but one business event. Show its destination without
  inflating company external income/spending. One-account views still show its leg.
- Distinguish sales revenue, receipts against debt, supplier purchases/payments,
  operating expenses, payroll/advances, refunds, taxes, financing and owner money.
- Buying stock or paying an existing payable must not expense the purchase again.
  Expense Claim reimbursement and settlement of an already recognized cost must not
  create a second expense. Advances require their own balance and later allocation.
- Owner money is visible separately. Final native equity/loan/receivable treatment
  depends on configured company/transaction facts; do not guess from a free-text name.
- Gross profit uses historical sale cost, including delivery/return paths. Revenue
  excludes collected sales taxes; discounts/returns/cancellations follow native dates.
- Business results must include native expense postings beyond Quick Expense. Define
  source precedence so JE, PI, payroll, payment and custom-document links count once.
- Cash spending and recognized expenses are separate views. Explain timing rather than
  calculating profit from cash inflow minus cash outflow.
- TJS reporting uses booked base amounts/rates; USD activity keeps original currency.
  Review fees, exchange differences and settlement effects; never sum TJS and USD raw.
- Store filters require proven attribution and a policy for shared/unassigned costs.
  Restricted data must not be labelled a complete company profit figure.

## Delivery phases

| Phase | Deliverable | Completion gate |
| --- | --- | --- |
| M0 | Source/permission inventory, movement taxonomy and current P&L gap list | Map each total to documents; establish reconciliation examples and Q01–Q04 scope |
| M1 | Complete scoped money history and detail, correct grouping/classification | Pagination-independent totals; transfers/returns/reversals and source links reconcile |
| M2 | Simple authorized recording/navigation for owner money and transfers | Approved native mapping; duplicate/retry protection and cancellation behavior |
| M3 | Early business-results view using verified sources | Historical costs and expense coverage reconcile; missing payroll/tax data explicit |
| M4 | Complete payroll/tax integration and final profit labels | Recognition/allocation policy settled, native P&L reconciled, no double counting |
| M5 | UI, permission and performance verification | All matching results, desktop/mobile/RU/TG and allowed/denied paths verified |

Current phase progress:

- M0: complete with source audit, development data coverage and gap/reconciliation list.
- M1a: secure, currency-correct native transaction details implemented locally; targeted
  backend/native/browser checks passed. This completes only the first part of M1.
- M1b: implemented locally — permission-scoped history, deterministic pagination,
  whole-filter totals, typed transfer/party classification and simpler Movement UI.
  41 backend and 14 UI tests, native reconciliation and desktop/mobile/RU/TG checks
  passed; see the linked report for supported-source and performance limits.
- M1c: implemented locally — native account snapshots, explicit dates/opening/activity,
  coherent inactive/shared-account scope and simpler Accounts/page actions. 54 backend
  and 22 UI cases, native reconciliation and desktop/mobile/RU/TG checks passed.
  Owner review and production-scale performance remain pending.
- M2a: implemented locally — native write authority, atomic wallet/POS changes, explicit
  legacy tax-account mapping and currency-aware PE transfers with durable receipts,
  original-ID reload/retry and cancellation recovery. 54 retained backend fixtures,
  24 new native integration cases, 34 UI cases and 20 linked native cases passed;
  two-connection retry and 4 RU/TG desktop/mobile dialog fixtures passed. Receipt schema
  upgraded only on the disposable site; intended-site activation/acceptance pending.
- M2b: implemented locally after D17 — normal owner funds and optional loans/repayments,
  explicit company settings/setup, native JE/immutable receipts, loan balances/current
  repayment checks and source-linked history. 57 backend fixtures, 22 owner-native cases,
  24 M2a native regressions, 44 UI cases, two-actor repayment safety and four RU/TG browser
  fixtures passed. Company account configuration and intended-site activation/acceptance
  remain explicit pending steps, not page-opening side effects.
- M3a: implemented locally — native scoped posted-results service, distinct SI/POS sales,
  shared manager profit/cost policy, corrected provisional Home and native scoped alerts.
  90 backend fixtures, 16 results-native cases, 22 owner-native regressions, 54 Node cases,
  4 RU/TG browser fixtures and actual-site read-only P&L reconciliation passed. Report
  eligibility is verified; full analytical cost/source/report row scope remains M3b.
- M3b: implemented locally — shared native historical invoice costs across Delivery Notes,
  partial billing, UOM, returns, bundles, nonstock and foreign/base paths; source/field/row
  permissions, corrected consumers and native report/export checks. 120 backend cases,
  26 native cases including CSV/XLSX, 54 Node regressions, 4 RU/TG Catalog/Detail browser
  contexts and actual-site read-only reconciliation passed. Unknown costs remain explicit.
- M3c: implemented locally — native-style Business results tab, independent company/period
  controls, separate posted/invoice figures, full permitted account breakdown/native links,
  explicit missing costs/completeness and company-correct toolbar dialog context. 122 backend
  cases, 73 Node cases, four RU/TG desktop/mobile browser contexts and actual-site read-only
  native P&L/navigation checks passed. Activation/owner acceptance remain pending.
- M4a: next — audit expense/payroll/tax source-to-GL coverage, recognition versus payment,
  unposted obligations and duplicate-backed documents before further integration. Trace
  actual HRMS/custom staff and both tax settings paths under their owning app guidance;
  produce a bounded reconciliation report and concrete follow-up. Q03/Q04/Q10 remain open.
- M4/M5 remain incomplete. Phase-specific UI checks do not finish M5.

M1 and Expense Desk improvements are the first practical work. M3 starts before new
staff/tax screens are complete; M4 follows their verified data contracts. Manager
visibility is implemented locally with native permissions; intended-site activation and
owner acceptance remain pending.

## Verification and limits

Fixtures should include till-to-safe transfer; paid/unpaid supplier invoice; stock
purchase followed by sale/return; ordinary expense/reimbursement; payroll advance and
settlement; owner contribution/withdrawal; USD supplier settlement; cancelled posting;
shared-account transactions; more records than a page/feed limit; restricted company
and native sources. Compare ledger, money feed, result detail and existing product
gross profit at identical scope. Opening screens must create no business data.

Final tax rules and actual company owner-money setup remain unresolved; this file provides no rates
or legal/accounting configuration. Use verified jurisdiction-specific sources when
those calculations are implemented.
