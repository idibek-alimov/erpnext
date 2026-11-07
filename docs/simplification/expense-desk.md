# Expense Desk

Status: Planned — awaiting implementation instruction.
Parent: [roadmap](README.md). Connected plan: [Money Hub](money-hub.md).

## Purpose and existing foundation

Every business cost should be recorded in ERPNext, with understandable category,
payment status and source. Managers need to find and explain spending, not enter
the same expense again from different screens.

Reuse `erpnext/accounts/page/expense_desk/`, `accounts/expense_services/`, Quick Expense,
Quick Expense Category, shared entry/history code and native expense/accounting records.
The [shared expense contract](../expense-workflow-contract.md), its phase reports and
the [shift-review contract](../../../posawesome/docs/shift-review-contract.md) already
describe substantial implemented work. Audit gaps before redesigning or rebuilding it.

## Proposed improvements

- Clear record-expense action: category, amount, actual payment source, date, description
  and optional receipt; preserve existing validation/confirmation/retry recovery.
- History and detail: category, paid/unpaid status where applicable, recipient, source,
  employee/shift/store context, supporting document and cancellation/correction history.
- Period/category/source totals over all matching results, with drill-down to records.
- Distinguish an expense paid now, a supplier bill payable later, an employee reimbursement
  and an advance for later spending. Route each to the existing authoritative workflow.
- Keep category administration/account mapping separate from everyday recording.
- Propose recurring-cost reminders later; scheduled reminders must not silently post bills.

## Rules and dependencies

- Expense category describes purpose; wallet/account describes funding. They are not
  interchangeable. Preserve company-specific category mappings.
- Do not record a second expense when paying an existing bill or reimbursing an approved
  claim. Transfers, stock purchases, staff advances and owner withdrawals need their
  distinct native treatment and Money Hub classification.
- Office and POS expense source policy remains governed by the shared contract. POS
  receipts permission does not imply spending permission. Keep cashier/manager actions
  separate and preserve closed-shift correction attribution.
- Manager profit visibility does not grant loss/surplus approval or cancellation rights.
- Native records outside Quick Expense must be included through source-aware history or
  clearly linked views; never imply a Quick Expense-only list covers every business cost.
- FX cases use supported native workflows until a verified simple form handles them.

## Phases and completion checks

| Phase | Work | Completion gate |
| --- | --- | --- |
| E0 | Review existing phase evidence, workflow gaps and cost coverage | List reuse, changes and deferred suggestions explicitly |
| E1 | Improve category, source and record/history clarity where needed | Ordinary expense and supplier/claim routes cannot double-post |
| E2 | Connect summaries and drill-down to Money Hub | Same scope/source precedence gives matching totals |
| E3 | Verify correction, retry, permissions and language/layout | Native cancellation, old records, POS/offline compatibility preserved |

Verify paid expense, unpaid bill/payment, employee claim/reimbursement, advance,
legacy records, receipt failure after a successful posting, duplicate retry, missing
mapping, cancellation and closed-shift correction. Use meaningful fixtures/test sites;
do not submit real expenses merely to verify a planning/UI task.

Open choices for later phases: missing recurring-cost workflows, category cleanup and
which native expense types belong directly in this history versus linked advanced views.
