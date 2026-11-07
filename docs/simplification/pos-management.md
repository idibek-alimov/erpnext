# POS Profile setup and shift management

Status: Planned — awaiting implementation instruction.
Parent: [roadmap](README.md). Related: [attendance](attendance.md), [Windows](windows-apps.md).

## Purpose and existing foundation

Let a permitted ordinary user configure a register without understanding every ERP
field. Keep cashier checkout fast and give managers understandable opening/closing,
cash movements and shift review.

POS Profile is a native ERPNext configuration document; trace POS Awesome consumers,
custom fields, settings, hooks and source ownership. POS Awesome owns its shift/review
records and manager review page. Read its mandatory architecture/contracts/workflow/
verification documents before implementation. Existing closing/review/expense work is
covered by the [current shift plan](../../../../POS_SHIFT_DISCREPANCY_PLAN.md) and
[review contract](../../../posawesome/docs/shift-review-contract.md); reuse it.

## Proposed experience

- Guided register setup: store/company, warehouse, price list/currency, default customer,
  allowed staff, receipt setup, payment methods and tax configuration.
- Use understandable defaults and a final explanation of what will be created/changed.
  Retain advanced native settings and permissions; copying a profile should not copy
  unauthorized accounts/users or silently enable spending from every wallet.
- Explain payment acceptance separately from expense/transfer permission. Validate
  account/company/currency mappings before declaring a register ready.
- Manager shift list: open/closed shifts, sales, returns, expected/actual amounts and
  unresolved review status, with supporting source links and appropriate scope.
- Keep checkout, setup and manager investigation as separate tasks with clear navigation.

## Cross-feature contract

- Profile controls company, warehouse, customer/price fallback, currency, tax, methods,
  filters, stock policy, print format and offline loading. Do not hardcode hub defaults.
- Setup and profile edits must invalidate/reload scoped cache safely without clearing
  carts or queued invoices. Define effects on already-open shifts and old snapshots.
- Preserve scanner focus, touch/keyboard operation, return/refund behavior, receipts,
  backend invoice values, offline sync and duplicate-submission protection.
- Follow existing review policy: a shortage can remain pending review; cashier explanation
  alone does not resolve it; genuine loss/surplus posting keeps its separate approval.
- New profit visibility for managers does not change correction/payment/loss authority.
- Attendance salesperson enforcement follows the online/offline contract in the
  attendance plan. Never confuse salesperson commission attribution with cashier identity.
- Tax setup discovery must precede wizard defaults; do not embed guessed tax rates.

## Phases and completion checks

| Phase | Work | Completion gate |
| --- | --- | --- |
| P0 | Map profile fields, default providers and consumers; review existing shift evidence | Reuse/gap list and source ownership established |
| P1 | Guided profile creation/editing | Validate simple setup and advanced escape path with native permissions |
| P2 | Simplified manager shift navigation and remaining review gaps | Existing closing snapshots and unresolved amounts preserved |
| P3 | Attendance/customer/tax integration | No local duplicate rules; respective policy decisions settled |
| P4 | End-to-end and Windows handoff | Offline, printing and profile-change recovery evidenced |

Verify company/warehouse/price/customer/currency/method/tax defaults, shared accounts,
profile changes with queued carts, open/close/review/partial resolution, returns and
reversals, allowed/denied roles, RU/TG, browser/QZ/fiscal hardware where affected.
Use available scoped scripts and controlled test sites; do not close live shifts or
clear real offline queues as a verification shortcut.

Open choices: wizard defaults, scope of simple versus advanced settings, register
duplication, hardware requirements and policies for editing active register settings.
