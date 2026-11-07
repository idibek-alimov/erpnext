# Phase 2 — shared paid-expense services

Local implementation, 2026-11-05. No site migration, configuration changes, live financial
posting, deployment, commit or push was performed. The bench-root
`POS_SHIFT_DISCREPANCY_PLAN.md` controls the remaining phases.

## Implemented behavior

ERPNext owns `erpnext/accounts/expense_services/`. Expense Desk and POS Expenses call
its shared record/cancel/outcome services. The Quick Expense controller and permission
hooks also enforce policy on native forms, REST writes, list queries, amendment,
cancellation and submitted-history deletion. POS Awesome registers an optional stored
shift/profile validator; ERPNext does not import POS Awesome. POS context fails closed
when the adapter is unavailable.

Normal POS entry requires the authenticated shift owner, a submitted open shift, matching
company/profile, permitted register and today's posting date. Manager corrections use
`entry_context = "POS Correction"`, a specific opening shift and a reason. That path
can record an omitted expense against a closed shift; it does not change the original
closing count or resolve a discrepancy. Allocation/review services belong to Phase 6.

### Explicit setup

Use native setup forms after the schema upgrade on a controlled site:

1. **Money Wallet:** account/company must be valid, enabled, and in company currency.
   `Registers Allowed to Pay Expenses` is the explicit list of POS Profiles allowed
   to spend from that wallet. The funding account must also occur in the stored
   register's payment-method account mappings. Alif, Dushanbe City and Eskata can be
   configured this way; receiving customer payments alone grants no spending permission.
2. **Office sources:** enable `Allow Office Expenses` for a Safe/office wallet. Tills,
   wallets assigned to registers, POS receipt wallets and accounts used by register
   payment methods are excluded from ordinary Desk entry. Use the manager correction
   context and an explicit shift for those sources.
3. **Quick Expense Category:** configure one `Company Accounts` row per company, with
   the expense account and optional cost center. The legacy `default_account` remains
   usable only for that account's own company. Company cost center is the explicit
   native fallback when the category has none. Invalid/missing mappings are rejected;
   no account-name guesses or arbitrary expense-account selection remain.
4. **Roles:** Retail Cashier records/reads its own permitted shift expenses. Retail
   Manager, Retail Owner and Accounts Manager handle ordinary corrections/cancellations
   within permitted scope. Accounts User retains ordinary office entry. Native Quick
   Expense read/create/submit/cancel permissions and User Permissions also apply.
   Generic Sales User, POS Manager, POS User, supervisor and technical System Manager
   roles alone do not grant the new shared business capability. Administrator retains
   its native exceptional access. No roles were assigned to users.
5. **Legacy Cash Movement:** existing feature flags, configured limits, remarks,
   Cash-only source rules and Deposit routing remain separate. A repeatable POS patch
   adds missing Custom Fields/columns without changing configured register values or
   redistributing payment methods. Direct document writes now check the active owner,
   feature configuration, accounts and currencies, including Deposit writes so relabeling
   an expense cannot bypass the guard. Legacy expense targets require the profile's
   configured default/allowlist. Managers cancel expenses with a reason; posted expense
   history cannot be deleted. Old request IDs cannot return another actor's movement.

The new wallet permissions default off. No wallets, mappings, accounts, profile payments
or business records are silently enabled or rewritten. Standard DocType sync installs
new child tables/columns; `repair_expense_source_settings` repairs missing legacy POS
source metadata/columns. The service reports an upgrade/setup error on an unmigrated site.

Account/category initialization and legacy-category deletion were removed from Expense
Desk reads. Money Hub no longer imports/calls the removed account-creation helper.
Its separate existing wallet-import/payment-receiving behavior is outside this change;
expense authorization does not invoke it or reuse `accept_in_pos` as spending permission.

### Posting, currency and audit

An ordinary business-paid expense creates one native Journal Entry: debit the configured
expense, credit the selected funding account. Cash/Bank voucher type follows the actual
account. Native mandatory fields, dimensions, account/period/budget and GL validation
remain enabled. The recipient name is descriptive; selecting/matching an employee no
longer creates an Employee Payment Entry.

New supplier bills, payments of existing bills, Expense Claims, Employee Advances,
payroll, recoveries, foreign currency and cases requiring unsupported dimensions use
native accounting/HRMS forms. The simple form does not construct supplier invoices or
employee payable/advance entries. Historical Quick Expense PI/PE/JE links remain readable
and their native cancellation chain is preserved. Receipt access is checked before posting;
attachment links include the Quick Expense and its backing accounting documents.

Amounts must be finite, positive and representable at native company-currency precision.
Cashier entry cannot backdate spending; managers can select a permitted native posting
date for an explicit correction. Company/account/cost-center User Permissions apply,
including restrictions specifically applicable to Quick Expense. Source discovery exposes
no bank/wallet balances; missing balances are hidden, never displayed as zero.

Record/cancel commands use stable operation IDs, an actor/intent fingerprint, unique
columns, actor/document locking and savepoints. A retry with the same intent returns its
persisted outcome. Changed intent or another actor's ID is rejected. Cancellation also
requires a reason and current document version. A native client cannot forge the service's
request fingerprint; an internal object identity protects those metadata fields.
No command commits halfway through posting, cancellation or a page refresh.

Successful commands return the authoritative expense and native links; frontends refresh
history separately. A failed refresh cannot undo a confirmed financial success. The shared
browser helper retains uncertain IDs/input in tab session storage and reuses them after a
reload. It blocks edited intent while the outcome is unknown. Outcomes can also be checked
with `get_expense_request_outcome`. New manager cancellation dialogs require a reason;
failed cancellation retains input. Russian/Tajik translations cover the main new actions,
source/setup errors and retry messages.

The public closing submission locks the same opening-shift row used by new expense
posting. Full native Desk closing recalculation/guards, discrepancy records, allocations,
manager approval and transfer reconciliation remain Phase 6 work.

## Deliberate phase boundary

Phase 3 still needs complete paginated/aggregated history beyond 150 rows, historical Cash
Movement inclusion once, closed-shift old-queue retry recovery, richer source classification,
and unified sync/financial-pending handling. No historical expense is inferred from date
or reposted. The existing duplicate Expense/Deposit queue endpoints and payload shape remain;
forbidden requests fail without clearing/remapping the queue. Full POS/Desk redesign,
receipt interactions and connected Shift Review follow in Phases 4–8.

Before rollout: rehearse migrations and permissions on a disposable site; choose actual
company accounts/cost centers and explicit register/wallet grants; verify native GL and
reversals, two-connection concurrency, authenticated UI and legacy queues. The available
sites do not provide an approved migrated test environment, so no business transaction
was used as a test. Native integration tests now use `_Test Company` fixtures and require
`allow_tests`; the old business-company/employee-payment manual test was removed.

Verification counts and commands are recorded in the POS phase report. Fixture/native
construction tests are not evidence of a live GL posting or a production migration.
