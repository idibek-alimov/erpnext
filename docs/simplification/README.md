# ERPNext simplification roadmap

Updated: 2026-11-07. Status: implementation started; Money Hub M0, M1a/b/c, M2a/b and M3a completed locally, M3b next; owner review/activation pending.

For the current task, implementation/verification status, test queue and new-chat
instructions, start with the root
[ERP_SIMPLIFICATION.md](../../../../ERP_SIMPLIFICATION.md). This roadmap defines the
workstreams and dependencies; the root tracker must be updated as work proceeds.

## Purpose and authorization

Give the owner one place to decide what to improve next, understand dependencies,
and continue across conversations without rebuilding existing work or losing decisions.
The owner requested discussion and plan files, then explicitly said “start the
implementation” on 2026-11-07. Work began with Money Hub M0 and a bounded M1a detail
improvement. Track actual results in the root handoff and linked reports. The plans
alone do not authorize unrelated changes, real payments, commits, pushes or release.

The first priority is **understanding where money went and calculating profit**.
Plan every area now; implement in small, connected phases later. Existing uncommitted
ERPNext and POS Awesome work must be preserved.

## Navigation and proposed delivery order

The priority below is a proposal from the discussion, not a claim that every detailed
feature has owner approval. [Owner decisions](decisions.md) distinguish confirmed
requirements, recommendations, and unresolved choices.

| Order | Plan | Initial deliverable | Dependency / later completion |
| --- | --- | --- | --- |
| 0 | Baseline, described below | Inventory existing behavior, evidence, source ownership and gaps | First step of the first authorized implementation task |
| 1A | [Money Hub](money-hub.md) | Explain money movements, categories, sources/destinations and balances | Shared expense/shift contracts; native accounting and currency scope |
| 1B | [Expense Desk](expense-desk.md) | Close remaining recording/classification/history gaps | Reuse recent expense services and Desk work |
| 1C | [Money Hub: business results](money-hub.md) | Reconciled sales, historical costs and operating results, with completeness status | Start early; final payroll/tax coverage depends on their plans |
| 2 | [Staff Hub and pay](staff-hub.md) | Simple staff setup, terms and explainable pay statement | Final pay adjustments follow attendance policy; use Money Hub sources |
| 3 | [Attendance and schedules](attendance.md) | Online shared PIN station, manager entry, schedules and approvals | Employee identity; POS offline eligibility decision before enforcing attendance in POS |
| 4 | [POS configuration and shifts](pos-management.md) | Guided POS Profile setup and connected shift management | Money-source, tax-template and employee/attendance contracts |
| 5 | [Customer Hub and loyalty](customer-hub.md) | New hub/detail using existing customer and loyalty records | POS customer/pricing/offline contracts |
| 6 | [Taxes](taxes.md) | Simple setup, calculation explanation, obligations and payment history | Tax discovery starts in 1C and before POS configuration; jurisdiction/rules verified first |
| 7 | [Main page](home-dashboard.md) | Today's business overview and useful graphs/actions | Reuse verified services; sales-only improvements may be delivered earlier |
| Across stages | [Windows apps](windows-apps.md) | POS, management and attendance desktop experiences | Assess existing POS shell early; release each experience after its workflow is ready |

Staff delivery is intentionally split: establish identity/terms first, implement
attendance, then complete attendance-dependent pay. Profit reporting need not wait
for every later UI: use verified native postings now, label gaps, and add validated
sources as their workstreams finish. Do not advertise incomplete operating results as
final net profit.

## Baseline and existing work

These are source observations and existing document reports, not new live-site verification.

| Area | Existing foundation | What still needs assessment |
| --- | --- | --- |
| Approved product/supplier flows | Product Catalog, Product Detail, Quick Product Intake/Restock, Supplier Hub/Detail | Preserve approved UI, source links and calculations |
| Money | `erpnext/accounts/page/money_hub/`, Money Wallet, account-backed feed and transfers | Classification, complete history, currency handling, profit and permissions |
| Expenses and shifts | Shared expense services, Expense Desk, POS shift-review services/pages and phase reports | Reconcile remaining gaps with current evidence; do not rebuild |
| Staff | `erpnext/setup/page/staff_hub/`, `staff_detail/`, custom commission/incentive/advance/settlement DocTypes | Pay-source correctness, native HRMS overlap and simpler workflows |
| Customers | Native Customer, Loyalty Program and Loyalty Point Entry; POS customer flows | New hub/detail and simpler program management |
| Taxes | Retail Tax Settings, Money Hub Settings and tax methods in Money Hub | Establish one authoritative configuration/calculation path and dated rules |
| Home | `erpnext/setup/page/retail_home/` | Historical cost, expense/payroll completeness, taxes and manager visibility |
| Windows | POS Awesome `electron/`, package scripts and packaging audit | Existing runtime behavior, especially actual offline startup/recovery |

Before editing an area, read its owning app's `AGENTS.md`, the ERPNext Simple Desk
skill when applicable, its current controller/hooks and the native source documents.
Follow the actual source owner; a Desk route does not transfer ownership to ERPNext.
POS Awesome requires its architecture, feature contracts, workflow and verification
documents. HR/payroll work also requires HRMS guidance.

Useful existing contracts:

- [Shared expense contract](../expense-workflow-contract.md).
- [POS shift-review contract](../../../posawesome/docs/shift-review-contract.md).
- [Existing shift/expense implementation handoff](../../../../POS_SHIFT_DISCREPANCY_PLAN.md).
- [Legacy retail specifications](../../../../docs/retail_os/).
- [Desktop packaging audit](../../../posawesome/docs/electron/packaging-audit.md).

Legacy specifications contain old completion claims and role rules. Preserve their
history, but verify the source and use the dated owner decisions here for this new
roadmap. The earlier shift/expense contract continues to govern that work unless a
specific later owner decision changes it. New financial visibility does not broaden
shortage/loss approval or posting rights.

## Shared requirements

- Native Desk styling, compact identity, plain business language, source-document links,
  Russian/Tajik support, keyboard use, mobile layouts and clear loading/error/empty states.
- One store today; keep company, store, warehouse, register and account distinct so later
  stores can be added. Do not invent a second company or attribute shared costs by guesswork.
- TJS primary reporting; occasional USD supplier activity retains original amounts,
  currencies, native exchange rates and company-currency equivalents.
- Every business expense is to be recorded in ERPNext. This is an operating requirement,
  not evidence that historical data is already complete.
- Admins and managers may see profit and purchase costs within their permitted scope.
  Cashier and attendance access must remain narrower. Visibility does not confer payment,
  settings, salary-detail, role-management or loss-approval authority.
- Use native documents, validation, audit trails and server-side row permissions. No
  additional financial ledger or payroll engine solely for simplified screens.
- Summary totals cover all matching records and reconcile at the same date/company/store/
  currency scope. Read-only requests must not create wallets, accounts, settings or postings.
- POS alone requires offline work. Attendance and manager/admin workflows are online.

## Status and continuation rules

Money Hub is **In progress**: M0 complete, M1a/b/c and M2a/b implemented/checked locally,
M3a posted results/financial visibility are also implemented locally; see the
[M3a report](money-hub-m3a.md). M3b invoice-date costs/source scope is next, followed by
M3c's Money Hub results tab. Owner acceptance and intended-site activation remain pending.
See its [baseline](money-hub-baseline.md), [M1a report](money-hub-m1a.md),
[M1b report](money-hub-m1b.md) and [M1c report](money-hub-m1c.md).
The other eight workstreams remain **Planned** under this new roadmap.
Completed older phases remain older completed phases; do not reset them to unfinished.
Use these states for new phases: Planned, Ready, In progress, Blocked, Verified locally,
and Released. Record an actual blocker and its affected phase. Local verification and
release are different states.

When implementation is requested, update the selected plan with:

1. Authorized scope and the exact phase being started.
2. Existing source/verification baseline and relevant unresolved business decisions.
3. Changes made, affected contracts, and meaningful calculation/permission/UI checks.
4. Evidence, unresolved limitations, current status and the next task.

Do not turn recommendations into confirmed requirements or silently change another
workstream's contract. Ask only questions needed for the selected phase. No app builds
or live financial transactions are necessary to validate these planning documents.

## Next task, when instructed

Continue Money Hub M3b: reconcile the invoice-date historical-cost bridge and native
SI/PI/warehouse/company permissions, including classic cost/report/export and legacy
product/supplier metadata paths. Preserve the M3a posted-results service, provisional
Home labels and D06 manager policy. Build the Money Hub results tab in M3c after the
service/source reconciliation. Final payroll/tax allocation and net profit remain M4.
Read the root tracker and M3a report for evidence and precise boundaries. Update this
roadmap, the Money Hub plan and root tracker after implementation/testing.
