# Phase 3 — complete paid expense history

Implemented locally, 2026-11-05. Business rules remain D1–D5 in the
[shared expense contract](expense-workflow-contract.md). Phase 2
[migration and source/category setup](expense-services-phase-2.md) are still required.
No business records were rewritten, assigned to guessed shifts, reposted or cancelled.

## Reporting contract

- One canonical source identity is `source_doctype:source_name`. The original `name`,
  DocType, amendment parent, submission/cancellation status and backing accounting links
  remain available. Identical names in different DocTypes do not collide.
- ERPNext owns the history service; POS Awesome supplies an optional descriptor for
  historical **POS Cash Movement Expense**. Deposit is excluded at the native source
  query. There is no ERPNext import of POS Awesome.
- JE, PE and PI are backing evidence, not additional reporting adapters. Supplier bills,
  claims, accrual expenses and later settlements are not added as separate costs. The
  figures describe paid-out expense records, not all company accrual expense or balances.
  Historical party-based Quick Expenses keep their original native accounting treatment;
  inclusion in this history does not recategorize an advance or repair its old posting.
- Each source is compiled through `frappe.get_list(run=False)` with native permissions,
  User Permissions, shares and permission-query hooks intact. Desk history also uses a
  native permitted POS Profile subquery; absent register read permission keeps office
  records available without revealing register records. Permission-filtered sources are
  combined before the shared outer filters, aggregate and page query. No unrestricted
  financial query is used as a fallback.
- Company, dates, category, funding source, register/shift, recipient, search and status
  have the same scope for rows and aggregates. A legacy category has `legacy:<account>`
  identity; it is not guessed into a modern category. Historical employee party IDs and
  permitted current descriptive recipient names both work in the recipient filter.
- POS history uses the supplied validated shift, including overnight activity. Manager
  expenses participate through their stored shift relationship, irrespective of
  `created_from_pos`. Unlinked records stay out of current-shift totals. Desk marks
  unassigned register-account spending without changing it. Date/account alone never
  assigns a shift.
- Funding classification comes from Account type and wallet metadata. Cash, Bank,
  Mobile Wallet and Other remain distinguishable. Bank total includes mobile wallets;
  `mobile_total` is its subset. Alias wallets use EXISTS, so they cannot multiply an amount.
  A disabled historical wallet can still filter readable history; that does not authorize
  new spending from it.
- Aggregates cover every matching submitted source, independently of the visible page.
  Default page size is 50, bounded at 200; stable ordering is creation/DocType/name.
  `has_more` and `next_start` support paging. `matching_count` counts the selected history
  statuses; `period_count` and paid totals count submitted records only. Optional draft,
  cancelled and all-status history never adds those amounts to posted totals.
- Read endpoints create no setup or business records and do not commit transactions.

## API and consumers

`get_filtered_expenses` accepts `status`, `limit_start` and `limit_page_length` in addition
to its prior filters, and returns `recent_expenses`, full `summary`, `has_more`, `next_start`.
Initialization accepts the same scope, so refreshing after a command preserves filters.
`get_expense_detail` accepts an optional `source_doctype`; the default remains Quick
Expense. POS Awesome validates native read access for its legacy detail adapter.

Both existing screens now page history, use the full scoped totals, show actual funding
accounts, retain native source links and offer optional status history. Cancellation in
the shared screen targets Quick Expense only; old movement cancellation remains on its
existing manager-guarded movement/native route. Obsolete responses are ignored. Failed
scope refreshes do not present the old totals as current. A small scoped CSS fix contains
mobile history; the full visual redesign remains Phase 5.

## Unknown command results

`expense_requests.js` preserves the original operation ID and intent in actor-scoped
localStorage across tabs/reloads. It migrates old sessionStorage evidence without
changing the request. A late response cannot clear a different pending operation.
This is result-confirmation evidence, not a new offline Quick Expense posting queue.

POS preparation/submission guards and the closing dialog check pending shift expense
and cancellation evidence as well as existing financial queues. The cashier restores
and retries the original request from Expenses; the server returns its authorized
original result. Unknown/malformed evidence is retained. Phase 4 must also provide an independent Check
result action for a completed request whose original wallet/category is no longer
selectable; the scoped outcome API already exists. A completed/cancelled result
must be reviewed before another intent is accepted. Closing totals must then be refreshed.

## Files and verification

- `erpnext/accounts/expense_services/history.py`: shared source/permission/filter,
  classification, aggregation and page service.
- `expense_services/policy.py`: native register-read restriction for financial query scope.
- `accounts/page/expense_desk/expense_desk.py`: compatible read adapters and detail dispatch.
- `expense_desk.js` / `.css`: paging, typed source navigation, optional status, scoped
  refresh/error handling and mobile containment; existing entry layout preserved.
- `public/js/expense_requests.js`: persistent operation evidence and safe ID-specific clearing.
- RU/TG translations; SQL history, read endpoint and browser-helper regressions.

SQL regression fixtures execute the actual union/filter/classification/aggregation/page
SQL against an isolated in-memory SQLite database. They cover more than 200 records,
permission-filtered inputs, alias wallets, manager/shift scope, unassigned history,
transfers, cancellation/drafts, employee-party records, search and typed identities.
The **native Frappe permission compiler is mocked** in these fixtures. They are not
MariaDB, native permission/GL, migration or concurrency verification.

The combined Phase 3 verification and POS file map are in the
[POS completion report](../../posawesome/docs/expense-history-phase-3.md).
Before rollout, use a migrated disposable `allow_tests` site to verify native permission
SQL, original document/GL behavior, two-connection retry/close races and old-cache upgrade.
Both configured sites currently have `allow_tests = false`; neither was migrated or used
for financial test transactions. Phase 6/9 still own full native closing/review validation.
