# Attendance, schedules and POS eligibility

Status: Planned — awaiting implementation instruction.
Parent: [roadmap](README.md). Confirmed requirements: [D08–D12](decisions.md).

## Purpose and ownership to confirm

Provide a separate attendance screen and Windows experience. Show when staff should
work, holidays/days off, actual arrival/departure, lateness and absence. Use HRMS native
Employee Checkin, Shift Type/Assignment, Attendance, Holiday List and Leave records
where appropriate; inspect hooks, roster and Employee customization first. ERPNext's
Staff Hub presents authorized summaries. POS Awesome consumes eligibility, not payroll.

## Confirmed interaction

1. At the store's shared computer, the employee selects their name.
2. They enter their personal PIN and choose check in or check out.
3. The server records the trusted timestamp and assigned store/shift context, confirms
   the result, then clears the PIN/identity view for the next employee.
4. A manager may enter/correct attendance under their own authorized identity. Keep the
   affected employee, actual event time, recorded time, actor, reason and before/after history.

Attendance requires an online connection. A failed request must show a clear error and
allow outcome checking/retry without duplicate check-ins. No attendance offline queue.
Repeated taps and overnight shifts must not become misleading duplicate/day records.

## Proposed manager experience

- Today's roster: expected, checked in, late, absent, on leave/day off and checked out.
- Simple schedule and holiday/day-off setup, with employee and period views.
- Corrections and pending lateness fines with supporting schedule/check-in evidence.
- Approval/rejection history linked to Staff Detail and any resulting pay adjustment.

## Business and identity decisions before implementation

- Configure start/end times, workweek, overnight shifts, grace period, lateness threshold
  and exact boundary. 09:00 start and 09:20 arrival is an example, not a fixed setting.
- Agree fine amount, frequency/caps, exceptions, absence/early-departure policy and
  corrections after approval/payment. Do not invent automatic absence fines.
- Preserve leave, half-days, holidays, time zone and schedule effective dates consistently.
- Decide PIN reuse versus separate attendance credentials and PIN resets. Use protected
  server verification and bounded failed attempts; never expose/store plaintext PINs in
  lists, logs or an offline attendance cache. PIN entry must not grant a general Desk session.
- Limit kiosk data and actions to attendance; staff pay and financial summaries stay private.
- Approving attendance/fines needs its own role scope, not only a client-side button.

## POS eligibility: required contract and unresolved offline policy

The owner requires that an employee who has not attended cannot be selected as a POS
salesperson. Enforce online at selection and authoritative invoice validation, not only
by hiding names. Keep salesperson eligibility distinct from cashier login permission.
Cover employee/store/shift matching, disabled employees, leave, check-out, already-selected
salespersons, saved carts and corrections. Decide whether selection requires current
check-in or attendance in the relevant shift; the owner has not specified that boundary.

POS must still work offline while attendance remains online. **Q06 is a blocking policy
decision for offline eligibility enforcement**, not for building online attendance.
Propose an explicitly approved server-validated eligibility snapshot with scope/expiry
and auditable reconnect handling, or another owner-chosen policy. Do not silently allow
everyone, make offline check-ins, block all offline selling, discard queued invoices or
rewrite original salesperson attribution. No automatic grace duration is approved.

## Phases and checks

| Phase | Work | Completion gate |
| --- | --- | --- |
| A0 | Trace native scheduling/check-in ownership; settle rules and identity design | Q05/Q07 answered for selected scope |
| A1 | Online PIN check-in/out and manager entry/correction | Trusted timestamps, idempotency, privacy and audit verified |
| A2 | Roster/schedules, leave/holiday handling and proposed-fine approval | Date/threshold/overnight/approved-leave cases consistent |
| A3 | Staff pay integration | Only approved deductions count; corrections/reversals reconcile |
| A4 | POS online/offline eligibility contract and implementation | Q06 answered; selection, invoice/sync and saved carts tested together |

Test exact threshold boundaries, wrong PIN/attempt limits, response loss/retry, missed
check-out, multiple shifts, manager correction, rejected fine, reversal after settlement,
wrong store, internet loss and offline POS reconnect. Use fixtures, not real wage deductions.
