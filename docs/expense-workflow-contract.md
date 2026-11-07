# Shared expense workflow contract

Phase 1 design contract, 2026-11-05; implementation status updated 2026-11-06.
The owner-approved rules remain canonical. Implementation through Phase 8 and Phase 9
isolated native verification/release handoff are complete locally. See the
[Phase 9 report](expense-release-phase-9.md) and
[release runbook](../../posawesome/docs/shift-review-release.md). This is not deployment
or certification of the intended business site's setup, installed-app handoffs or hardware.

This is the canonical contract for ordinary expenses shared by ERPNext Expense Desk
and POS Awesome. POS-specific shift/review rules are defined in
[the POS shift review contract](../../posawesome/docs/shift-review-contract.md).
The bench-root `POS_SHIFT_DISCREPANCY_PLAN.md` controls phased delivery.

Phase 2 implementation is now present locally; see the [implementation/setup report](expense-services-phase-2.md).
Phase 3 complete history/retry compatibility is implemented locally; see the
[history report](expense-history-phase-3.md). Phase 4 POS UI and independent result checking
are implemented locally; see the [POS report](../../posawesome/docs/pos-expense-ui-phase-4.md).
Phase 5 ERPNext Desk UI is implemented locally; see the [Desk report](expense-desk-phase-5.md).
Phase 6 discrepancy services are implemented locally; see the
[backend report](../../posawesome/docs/shift-review-phase-6.md). The Phase 7 manager page and
Phase 8 connected journey are also implemented locally; see the
[journey report](../../posawesome/docs/shift-review-phase-8.md). No live deployment
or site migration is implied by this contract.

## Owner decisions

The owner explicitly answered the following questions during Phase 1:

| ID | Agreed rule |
| --- | --- |
| D1 | A cashier may close a shift with missing money; the difference remains Pending review. |
| D2 | POS expense payments use only that register's approved till/wallets. Desk normally uses permitted Safe/office accounts; POS accounts are available through a deliberate authorized manager correction. |
| D3 | Business Alif, Dushanbe City and Eskata wallets can all pay expenses. Each still needs explicit permission in the relevant register configuration. |
| D4 | A confirmed cash loss or surplus adjustment requires the owner or Accounts Manager. An authorized store manager may handle ordinary expense corrections. |
| D5 | Managers handle cancellation/correction of recorded expenses. Cashiers do not cancel their own submitted expenses, even while the shift is open. |

These choices do not choose actual GL accounts, grant new site roles, enable every
wallet on every register or authorize production financial postings.

## Ownership and dependency direction

| Owner | Responsibility |
| --- | --- |
| ERPNext | Quick Expense and category/company mapping, funding-wallet/account validation, ordinary expense posting, list/detail/summary queries and Expense Desk UI. |
| POS Awesome | Authenticated register/shift context, permitted POS expense sources, old Cash Movement compatibility, offline entry/sync and shift attribution/review. |
| ERPNext native accounting | Journal Entry, Payment Entry, Purchase Invoice, GL validation, currency, account/company/dimensions, accounting periods and cancellation/amendment rules. |
| HRMS | Native Expense Claim/Employee Advance approval, employee payable/advance accounting, reimbursement tracking and employee Payment Entry override/hooks. |

ERPNext must not import POS Awesome to perform an ordinary office expense. Define an
optional context-validation extension which POS Awesome registers when installed.
ERPNext owns the shared service; the POS adapter establishes trusted shift context.
If a request includes POS context but its validator is unavailable, reject that context
instead of treating it as an unrestricted Desk expense. Optional POS links/navigation
must tolerate a site with ERPNext but without POS Awesome.

No second posting service is to be embedded in Vue or Desk JavaScript. Both frontends
call the same server services. The controller/event validation must cover native forms
and direct API writes as well, so bypassing the simplified screen grants no extra access.

## Business event and posting routes

| Event | Route and effect |
| --- | --- |
| Small business expense paid now | One Quick Expense, backed by native accounting. For a direct paid expense without an existing liability, debit the configured expense and credit the actual funding account. |
| Supplier invoice already exists | Link/use that Purchase Invoice and pay its payable through the native payment workflow; do not create a second Quick Expense cost. |
| New supplier bill/unpaid expense | Native Purchase Invoice/payable workflow, optionally paid later. Do not reduce cash until money is actually paid. |
| Staff paid personally | Native approved Expense Claim/reimbursement workflow. No POS cash outflow until the company pays; settlement must not book the expense twice. |
| Money advanced to staff for later spending | Native Employee Advance/accounting workflow; an advance is not immediately a tea/taxi expense. |
| Till to Safe | Internal transfer, not an expense; excluded from expense totals. Preserve old Cash Movement Deposit records and their journal links. |
| Real cash loss or surplus | POS review and approved native adjustment; no ordinary taxi/tea category used to conceal the discrepancy. |
| Established recoverable shortage | Accountant-approved native claim/receivable route with evidence and tracking. No automatic cashier debt, Employee Advance or payroll deduction. |

A recipient/employee name on a business-paid meal is descriptive. It must not silently
switch posting to an employee advance, reimbursement, salary or recovery workflow.
Existing employee-party Quick Expense records retain their documents/history; new
generic entry must not infer an Employee party merely from a recipient-name match.

These are workflow contracts, not tax/deductibility or jurisdiction-specific payroll advice.

## Funding sources and configuration

1. A source identifies company, enabled wallet where configured, ledger account, account
   currency, source type and relevant profile/method. It is an actual payment source,
   separate from the expense category/account describing the cost.
2. POS candidates come from the stored profile context plus explicit expense-spending
   configuration. Apply both the register assignment and spend authorization. `accept_in_pos`
   means customer receipts only; it is not permission to spend. D3 establishes that all
   three mobile wallets are capable of payment, not permission for every cashier/profile.
3. Desk ordinary entry defaults to permitted Safe/office sources. Posting against a POS
   till/wallet in a shift context requires the explicit manager correction path and an
   unambiguous opening-shift link. Shared accounts cannot be assigned from date alone.
4. Source discovery, validation, history and correction must use the same resolver.
   Verify enabled leaf account, Cash/Bank type appropriate to the operation, company,
   currency, user capability and scope. Never pick the first company cash account as a fallback.
5. Support accounts shared by profiles and payment-method aliases without duplicating
   the wallet, balance, expense or correction. Keep original mode labels for audit.
6. Reconcile existing Cash-only source-override settings with the new expense policy
   explicitly; do not accidentally change Cash Movement Deposit into unrestricted Bank payment.
   Missing installed columns from Phase 0 require an additive, repeatable setup/migration.
7. Category identity is shared; accounting mapping is company-specific. Use an explicit
   configured mapping/cost center and permitted dimensions, validate the account belongs
   to the company and has the correct type. Do not guess from English account names or
   silently fall back to an arbitrary expense account.
8. Do not enable/disable expense entry solely from old flags without a documented migration.
   The current Quick Expense screen and Cash Movement screen have different flag behavior.
   Preserve valid existing capability and require explicit setup for expanded sources.
9. For an initial simple form, company-currency supported sources are the minimum.
   Unsupported currency cases route to native forms until proper rate/date/rounding is
   implemented and tested. Never assume a foreign source amount equals company currency.
10. Funding-source selection must not expose whole company bank balances to cashiers or
    store managers. Return only permitted source identity and necessary transaction data;
    apply financial visibility separately from permission to record an expense. On
    2026-11-06 the owner explicitly allowed Retail Managers to view full cash/bank
    balances in **Money Hub**, using native wallet/account/ledger/company read permissions.
    Source pickers still return no balances; profit/cost visibility and loss approval
    retain their separate owner/accounting restrictions.

## Role and action matrix

All cells assume permitted company/account/record scope and native validation. These are
business capabilities, not blanket role grants. Map explicitly in Phase 2.

| Action | Cashier | Store manager/reviewer | Owner / Accounts Manager |
| --- | --- | --- | --- |
| Record normal expense | Own active shift, approved source/category | Permitted Desk sources or authorized POS correction | Permitted sources and authorized correction |
| Read expense history/details/receipt | Own permitted shift/register scope | Assigned/permitted company/register scope | Permitted company/account scope |
| Save input before posting | Yes; local/draft input, not an accounting success | Yes | Yes |
| Cancel/amend a submitted expense | No; request correction | Yes, authorized manager path with reason and native rules | Yes, same validation/audit rules |
| Change closed-shift attribution | No | Explicit audited correction, correct shift/source | Same |
| Investigate shift difference | Own explanation/status only | Yes, within assigned scope | Yes |
| View Money Hub cash/bank balances | No | Yes, native company/account/ledger read scope | Yes, native scope |
| Approve cash loss/surplus | No | No, unless also explicitly an owner/Accounts Manager | Yes, configured accounts and submitted native posting required |
| Configure company accounting mappings | No | Only if separately delegated native setup permission | Subject to native setup permission |
| Delete posted financial history | No | No | No destructive history deletion through this feature |

Existing role bundles in `erpnext/setup/retail_security.py` establish Retail Cashier,
Retail Manager and Retail Owner. Retail Manager includes Accounts User/Stock Manager;
Retail Owner includes Accounts Manager. Therefore Accounts User or Stock Manager alone
must not grant discrepancy approval. Generic Sales User, POS Manager or supervisor
labels do not automatically grant the new financial capability without explicit mapping.

Preserve ordinary native Accounts User permissions for existing accounting workflows;
they do not automatically grant POS shift access or review approval. Administrator's
native exceptional access remains auditable. System Manager technical access alone
must not be silently treated as D4 business approval through the new workflow.
Existing manual Journal Entry permissions are not globally redesigned here; a manual
entry never resolves a POS discrepancy solely because its accounts/amount happen to match.

## Server command/query contract

Names below describe responsibilities; implementation may retain existing public method
names as adapters to a shared service. No new endpoints are implemented in Phase 1.

| Responsibility | Required contract |
| --- | --- |
| Get context/sources/categories | Read only; current permitted scope, validated mappings, no account/category/wallet creation. |
| List/get expense and summaries | Same permission and filter scope; summaries aggregate all matching records independently of pagination; no receipt/employee leakage. |
| Record expense | Category, finite positive amount, explicit funding source, note/optional recipient/receipt and stable request ID. Server sets actor and validates scope/shift/date. |
| Get request outcome | Revalidate caller scope; return authoritative pending/submitted/failed result and document links after a timeout. |
| Cancel/correct expense | Explicit target, reason, record version and stable request ID; manager capability; native reversal/amendment and linked-review updates atomically. |
| POS correction context | Server validates manager, shift/account/company and review/version. Caller `from_pos`, `created_from_pos`, role or approval flags are not credentials. |

Successful command returns persisted source identity, posted amount/currency, funding
account and native document links, plus authoritative status. Do not call success until
required documents submit. Failure preserves user input and creates no partial financial
success. Financial services must not call page initialization helpers or commit halfway
through posting/allocating; respect the separately documented Money Hub commit boundary.

Use a stable unique operation ID with scope/payload fingerprint. Same ID and same intent
returns the original authorized result; same ID with changed intent is rejected. Lock
or otherwise serialize duplicate/concurrent writes; never return another user's result
just because an ID exists. Cancellation/amendment has its own tracked operation.

## History, cash flow and expense recognition

- A canonical economic event has one source identity, with linked generated JE/PE/PI
  treated as backing evidence rather than additional expenses. Use typed source IDs
  and funding legs so alias accounts cannot duplicate amounts.
- Keep ordinary Quick Expenses and historical Cash Movement Expense records visible
  once. A legacy queued Cash Movement remains on its compatible posting path with its
  original request ID; never resubmit it as a new Quick Expense during migration.
- Cash Movement Deposit and generic internal transfers remain movement history.
- POS visibility is driven by correct shift/account relationships, not only the screen
  origin flag. Manager-recorded shift expenses appear in cashier closing/history when permitted.
- Draft/cancelled records do not enter posted paid-expense totals. Receipt/category/source
  filters and totals use one query scope across all matching pages, including more than 150 rows.
- Clearly label the initial report as paid expenses in its supported sources. Do not call
  cash-outflow totals all company accrual expenses. Claims, bills and their later payments
  need native links and any reporting adapter must explicitly avoid counting cost twice.
- Read-only inventory found five unlinked expenses; do not assign them to shifts from a
  date/account guess or repost their GL entries. Historical correction is an explicit audit task.

## UI contract and references

POS: compact Category / Amount / Paid from form, secondary note/recipient/receipt,
current-shift history and distinct queue/submitting/error/submitted states. No casual
cashier cancellation of submitted spending. Shared business rules run on the server.

ERPNext: native Expense Desk list/detail, a primary Record expense action, a few scoped
paid-expense figures, quiet rows and progressive detail. Follow the project's approved
Product Catalog/Product Detail design language and Russian/Tajik support. Use explicit
period/source/category filters; keep account balances distinct. Manager Shift Review is
one connected screen owned by POS Awesome, not a second expense system.

UI details remain in roadmap phases 4, 5 and 7; this contract does not freeze mockup
geometry or impose product sales/inventory defaults on expenses.

## Concrete code trace and gaps to address

Paths in this table are relative to the owning app repository.

| Source | Current evidence / later change |
| --- | --- |
| ERPNext `erpnext/accounts/page/expense_desk/expense_desk.py` | Both frontends call it. Source discovery includes all company Bank accounts; no robust POS source/shift enforcement. Create/cancel broadens roles from a supplied profile and uses ignore_permissions. Initialization mutates setup; totals derive from a 150-row slice. |
| ERPNext `erpnext/accounts/doctype/quick_expense/quick_expense.py` and JSON | Native record/controller. Current fallback mappings choose arbitrary accounts; supplied source short-circuits scope resolution. Submit creates JE or supplier PI+PE or employee PE; cancel reverses linked records. No stable request ID yet. |
| ERPNext `erpnext/accounts/doctype/quick_expense_category/quick_expense_category.json` | Category has one default_account, not a company mapping. Shared controller currently does not resolve it uniformly across UIs. |
| ERPNext `erpnext/accounts/page/money_hub/money_hub.py` / Money Wallet | Wallet types and receiving flag exist; sync currently propagates receipt methods company-wide. Internal Transfer posts PE and commits; imports/setup can write on page load. |
| ERPNext `erpnext/setup/retail_security.py` | Retail role bundles and financial visibility must be preserved; manager visibility differs from owner/global balances. |
| POS Awesome `frontend/src/posapp/components/pos/expenses/PosExpenseDesk.vue` | Shared ERPNext endpoints; passes current profile/shift, but has fallback profile selection and employee-name→party inference. Bank totals use presence of profile incorrectly. |
| POS Awesome `posawesome/posawesome/api/cash_movement/` and controller | Separate Expense/Deposit records, feature flags, Cash-only source validator, own-open-shift create and weaker direct-document guard coverage. JE posted from on_submit; ID exists, but duplicate outcome/security/closed-shift retries require care. |
| POS Awesome `frontend/src/offline/cash_movements.ts` | Legacy queue persists method/payload and retries cash_movement entity; compatibility and close guards must survive unified expense entry. |
| HRMS `hrms/hr/doctype/expense_claim/expense_claim.py` | Approval/self-approval checks, expense/payable GL and optional paid claim, cancellation/repost and reimbursement tracking. |
| HRMS `hrms/overrides/employee_payment_entry.py`, `hrms/hooks.py` | Employee PE controller and payment/JE lifecycle updates for claims/advances; preserve them in native routes. |

## Configuration and acceptance gates

Phase 1 fixes the business contract, not the site account list. Before enabling posting,
Phase 2 must validate/configure per-company category accounts, permitted source/profile
rows, currencies and dimensions. Before loss/surplus actions in Phase 6, require explicit
approved company accounts and a reviewer capability; missing setup disables that action
with an explanation, rather than creating accounts during page load.

No automatic amount threshold, discrepancy clearing account, employee liability, salary
deduction or historical write-off is authorized. Existing expense amount limits, where
configured, remain effective; any new limit is a separate explicit configuration choice.
Specialized recovery continues via native/accountant workflow, not a new payroll feature.

Contract acceptance checks for later code:

1. Cashier records tea costing 20: permitted source decreases by 20 once; recipient does not create debt.
2. All three mobile wallets can be selected only for profiles explicitly allowed to spend.
3. Manager records a missing shift expense with correct attribution; cashier cannot cancel it.
4. Store manager can investigate/correct expenses but cannot approve a true cash loss.
5. Opening/listing/filtering performs no setup writes; >150-record totals reconcile.
6. Expense cancellation updates accounting and linked review consistently, including closed shifts.
7. Old offline payloads, direct forms, failed requests and duplicate IDs cannot bypass the rules.
8. An existing supplier bill/claim is not expensed again when paid.

Official reference workflows (local customized code is the implementation authority):
[Journal Entry](https://docs.frappe.io/erpnext/journal-entry),
[Payment Entry](https://docs.frappe.io/erpnext/payment-entry),
[Expense Claim](https://docs.frappe.io/hr/expense-claim).

Phase 1 verification is code/contract review and document consistency only. No runtime
code, schema, site roles, bank balances or business documents changed. Runtime tests
and build evidence from Phase 0 remain historical, not rerun claims for new functionality.
