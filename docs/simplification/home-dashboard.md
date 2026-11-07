# Main page and today's business overview

Status: Planned — awaiting implementation instruction.
Parent: [roadmap](README.md). Uses [Money Hub](money-hub.md) and other verified module services.

M3a now replaces Home's former independent profit formula with a permission-scoped
posted-results service and provisional labels; see [M3a evidence](money-hub-m3a.md).
Its native shift/stock/supplier alerts are scoped to permitted records/company. This
is a correctness increment under Money Hub, not completion of H0–H3 or final profit.

## Purpose and existing foundation

The first page should answer how the store is doing today and what needs attention.
Existing source is `erpnext/setup/page/retail_home/`, including `get_business_pulse`,
`get_pnl`, sales/cost/expense/payroll/tax helpers and alerts. Existing navigation and
role handling must be inspected alongside the page; do not create a second home by default.

Old retail specifications describe a complete home, but current cost/payroll/tax
coverage and alerts need verification. In particular, inspect actual POS Awesome shift
review records rather than assuming native POS Closing Entry represents its review queue.

## Proposed experience

- Today first: sales after returns, returns, completed sales count and average sale,
  with an explicit definition of tax inclusion and which records count.
- Compact useful trends: sales over the day and daily comparison; add gross-profit
  trend only from verified historical cost. Compare matching elapsed time when appropriate.
- Current permitted balances and financial result with clear scope/completeness labels.
- Needs attention: unresolved shift review, unpaid/overdue supplier obligations, missing
  attendance/pending adjustments, staff payments and tax deadlines where configured.
- A few frequent actions and links to each simplified hub. Advanced native access
  remains available according to permissions.

## Calculation, access and interaction rules

- Reuse Money Hub/product services and definitions; the dashboard must not have a second
  approximate profit engine. Show current balances separately from selected-period activity.
- Today's gross profit is not final net profit. Pending costs, payroll, taxes and unsynced
  POS activity must be explained; unknown values are not zero.
- Define invoice/receipt counting with returns, POS consolidation and cancellation to
  prevent counting original and merged records twice. Totals/charts/detail links agree.
- Admins/managers may see profit/cost in permitted scope under D06. Staff and kiosk users
  get their appropriate start screen and cannot query hidden management data directly.
- Alerts link to owning workflows and inherit their permissions. Do not approve a fine,
  post an expense or resolve a shortage by viewing/clicking an informational summary.
- Keep dates/time zones/company/store/currency consistent; avoid combining unidentified
  shared-store costs into a purported exact store profit figure.

## Phases and checks

| Phase | Work | Completion gate |
| --- | --- | --- |
| H0 | Audit home/native links, formulas, alerts and role behavior | Reuse/gap list tied to source services |
| H1, optional early | Simplify sales overview/navigation | Today's figures, count and comparison windows reconcile |
| H2 | Verified financial summaries and needs-attention links | Money/payroll/tax/attendance/review services ready for each shown item |
| H3 | Responsive/chart/localization and scope verification | RU/TG, mobile, dark/theme states, loading/error/empty/restricted states verified |

Test no-sales day, only returns, cancelled invoices, midnight boundaries, open and
closed shifts, pending offline sync, old unresolved review, missing tax/payroll data,
restricted company and manager-versus-cashier access. Verify charts and clickable
totals navigate to the same scoped source history without mutating records.

Final metric selection/layout and period defaults are recommendations for review;
do not automatically copy Product Catalog's month default onto the requested Today view.
