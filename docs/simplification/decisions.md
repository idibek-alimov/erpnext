# Owner decisions and unresolved choices

Recorded: 2026-11-07. Parent: [master roadmap](README.md).

## Confirmed by the owner

| ID | Decision |
| --- | --- |
| D01 | Plan the full set of simplifications before implementation. Start implementation only when the owner says to. |
| D02 | Money management has first priority, specifically understanding where money went and calculating profit. |
| D03 | There is one store today and more are planned. TJS is primary; USD is occasionally used to pay suppliers. |
| D04 | Every business expense is to be recorded in ERPNext so reporting can account for it. This describes the intended process, not verified historical completeness. |
| D05 | The owner puts personal money into the business and takes business money for personal use; both need understandable recording and reporting. |
| D06 | Admins and managers can see profit and purchase costs. Apply company/record scope; this decision does not itself grant other financial actions or salary access. |
| D07 | Staff commission must offer percentage of sales or percentage of gross profit, with simplified setup. |
| D08 | A separate attendance experience uses a shared computer at the store: select employee, enter that employee's PIN, check in/out. |
| D09 | Managers can record and correct attendance; retain who made each entry/correction. |
| D10 | Attendance includes schedules, holidays/days off, actual arrival/departure, lateness and absence. Employees who have not attended must not be selectable as POS salespersons. |
| D11 | Lateness beyond a configurable threshold produces a proposed fine requiring manager approval before it affects pay. The 09:00/09:20 example is not an approved universal threshold or amount. |
| D12 | Attendance stays online. Only POS requires offline work; manager/admin workflows can stay online. |
| D13 | Windows desktop experiences are wanted for POS, managers/admins, and employee attendance. Simplified hubs come first, with advanced access according to permissions. |
| D14 | Customer Hub is new: spending, purchases, loyalty points and simpler loyalty-program management are required. |
| D15 | Simplify POS Profile creation and related POS/shift management, taxes from configuration to payment, and a main page with today's sales figures and graphs. |
| D16 | Maintain a root Markdown handoff for new chats showing what is implemented, what needs verification and what to do next. Update it as implementation/testing proceeds; entrypoint is `ERP_SIMPLIFICATION.md`. |
| D17 | On 2026-11-07 the owner chose both owner-money paths: ordinary owner funds in/out as the normal action, with loans/repayments optional and a separate amount owed. Actual company account mapping remains explicit setup; no existing account is selected by name. |

## Recommendations, not additional owner approvals

- Proposed delivery order and phase splits are in the master roadmap.
- M2a records a [concrete native owner-money mapping proposal](money-hub-m2a.md):
  separate capital/drawings, repayable owner loans and existing-expense reimbursement.
  D17 subsequently selected both feature paths; the actual company account mapping
  still requires explicit setup. See the [M2b implementation](money-hub-m2b.md).
- Money Hub has separate Money movements and Business results views.
- Reuse the existing desktop shell and provide three focused desktop experiences;
  whether this means three installers or one installer with separate modes remains open.
- A shared Needs attention list links to the responsible module instead of duplicating
  its approval or correction logic.
- Begin with simple fixed-percentage commission setup while retaining advanced schemes.
- Use explainable provisional results until all required costs/obligations are verified.

## Decisions needed during the relevant phase

Do not ask all of these at once or treat them as blockers to writing plans.

| ID | Choice to settle | Needed before |
| --- | --- | --- |
| Q01 | Exact site role mapping for admin/manager and their company/store scope; payroll-detail and payment capabilities remain separate | Implementing financial visibility or sensitive staff access |
| Q02 | D17 selects normal owner funds plus optional loans/repayments; M2b implements explicit Equity/Liability routes. Actual per-company accounts require setup; existing-expense reimbursements retain their original source workflow | Intended-site owner-money activation/posting; no account is inferred from names |
| Q03 | Financial reporting basis, period cut-off, payroll/rent allocation and profit labels, reconciled to native accounting | Publishing final net-profit calculations |
| Q04 | Company structure, future store dimension, shared accounts/costs and attribution of transactions without a store | Store-specific profit reports |
| Q05 | Workweek/shifts, grace period, exact threshold boundary, fine amount/cap/frequency, absence rules and approval/correction policy | Attendance penalties or payroll changes |
| Q06 | Attendance evidence trusted by offline POS: permitted snapshot age, shift scope, revocation, preselected staff, and reconnect conflicts | Enforcing attendance eligibility in offline POS |
| Q07 | Whether to reuse POS PIN credentials, and how to serve employees without POS login accounts; PIN provisioning/reset authority | Attendance authentication design |
| Q08 | Commission basis details: discounts, tax exclusion, attribution/splits, returns, negative margin, period cut-off and dated scheme changes | Revised commission calculation or settlement |
| Q09 | Loyalty earning/redemption, expiry, tiers, returns, customer identity/duplicate handling, and offline redemption policy | Loyalty configuration or checkout changes |
| Q10 | Applicable jurisdiction, actual business tax regime, registration and effective dates, filing/payment obligations | New tax calculations or tax-setting changes |
| Q11 | Windows versions/devices, installer structure, server access, signing/update/distribution and hardware expectations | Desktop architecture/release |

## Permission change precedence

D06 supersedes the earlier owner-only target for profit/cost visibility in legacy
retail specifications and the 2026-11-06 balance-only policy. [M3a](money-hub-m3a.md) implements the shared admin/manager visibility policy locally,
with native company/account/GL restrictions and denied cashier/Guest tests. Native
manager report/export eligibility was checked; [M3b](money-hub-m3b.md) adds source/field/row and native report/export checks;
advanced grouping/cache/performance remain M5. No role grants, payroll-detail grants or intended-site activation
were made. Actual company/store role mapping and final financial basis remain Q01/Q03/Q04.

Existing expense/shift policies still apply: manager expense correction and genuine
shortage/surplus approval are separate. Do not infer automatic employee debt or
payroll deductions from a shift shortage. Attendance fines have their own policy and
approval; they do not resolve missing till money.
