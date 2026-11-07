# Staff Hub, Staff Detail and pay

Status: Planned — awaiting implementation instruction.
Parent: [roadmap](README.md). Decisions: [D06–D11, Q01/Q07/Q08](decisions.md).

## Purpose and source ownership

Make employee setup, salary, commission, bonuses, fines, avans and settlement easy to
understand. Staff Hub answers who works here and what needs attention; Staff Detail
explains an employee's terms, earnings, prior payments and remaining amount owed.

Existing ERPNext sources: `erpnext/setup/page/staff_hub/`, `staff_detail/`, Staff
Commission Scheme/Tier, Staff Incentive, Staff Advance and Staff Settlement. The local
scheme already offers `Total Sales Revenue` and `Gross Profit Margin` bases. Confirm
the calculation semantics; the UI should say percentage of gross profit amount when
that is what is calculated, not imply a percentage of a percentage.

HRMS owns native payroll, Employee Advance, Expense Claim and roster/attendance behavior.
Trace current Employee ownership/hooks and compare custom settlement with native salary
and accounting workflows before changing anything. Do not create parallel liabilities
or move existing custom records merely to make app boundaries look uniform.

## Proposed experience

- Staff list: employee, role/store, active status and a small set of relevant totals.
- Simple onboarding: identity/contact, job, working location, pay terms, commission and
  permitted access. Attendance must work for staff without a cashier login if needed.
- Staff Detail: compact identity and tabs for pay statement, sales/commission, advances,
  adjustments, attendance and employment/settings. Show only role-authorized data.
- Pay statement: base earnings, commission, bonuses, approved deductions, advances
  already allocated, previous balance, payments and remaining payable, with source links.
- Simple commission choice: percentage of sales or percentage of gross profit, then rate.
  Preserve advanced existing tiers behind additional settings; avoid rebuilding the engine.
- Distinct actions for bonus, proposed/approved deduction, advance and salary settlement.

## Rules requiring shared calculations

- Hub, detail, preview and submitted settlement must use the same source/calculation.
  Trace posted, accrued, paid and outstanding separately; arbitrary date filters must
  not silently reinterpret monthly salary as earned entirely on payment day.
- Effective dates matter for salary/scheme changes. Historical settlements must remain
  explainable after settings change. Decide returns after settlement and negative-margin
  treatment before recalculating commission (Q08).
- Gross-profit commission uses validated historical costs. Sales commission clearly
  states discounts, returns and tax treatment. Missing costs cannot mean zero cost.
- Advances cannot reduce pay twice or be expensed again at settlement. Distinguish salary
  advances from employee spending advances/reimbursements and retain native allocations.
- Audit current submission/payment/fallback paths. A failed posting must not present a
  settlement as paid; retry/cancel/amend must preserve correct balances and allocations.
- Attendance fines affect pay only after manager approval. A later approved correction
  must reverse/recompute the corresponding adjustment without silently changing paid history.
- A till shortage is not automatically a staff fine, debt or salary deduction.
- Profit visibility alone does not expose employee salary, bank or personal information.

## Phases

| Phase | Deliverable | Dependency / gate |
| --- | --- | --- |
| S0 | Audit custom/native payroll, source calculations and permission boundaries | Read ERPNext and HRMS guidance; choose authoritative liability/payment routes |
| S1 | Simplify staff list/detail and onboarding/terms | Employee identity and existing records preserved; no broad role grants |
| S2 | Explainable commission and pay statement | Q08 settled; list/detail/preview match source documents |
| S3 | Attendance-adjustment integration | [Attendance](attendance.md) approval/correction contract ready |
| S4 | Verified advance/settlement/payment and Money Hub integration | Exactly-once native postings, allocations, reversals and profit-period mapping |

S1 precedes attendance. S3/S4 can follow attendance while Money Hub uses verified native
payroll data or clearly identifies incomplete payroll recognition.

## Verification

Cover both commission bases, returns and discounts, split sales attribution, missing
cost, effective-date changes, bonus/rejected fine/approved fine, advance allocation,
partial payment, negative/zero payable, duplicate retry and cancellation. Reconcile
employee payable/advance balances, native accounting and Money Hub. Verify manager,
cashier, employee-self and unauthorized company paths separately.
