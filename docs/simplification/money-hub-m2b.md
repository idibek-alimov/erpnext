# Money Hub M2b — owner funds and optional owner loans

Date: 2026-11-07. Implementation: **Implemented locally**.
Verification: **Targeted checks passed**; owner acceptance **Pending**.
Release: **Local code and disposable-site schema only**. No intended-site activation.
Parent: [Money Hub](money-hub.md). Previous: [M2a](money-hub-m2a.md).
Next: M3a — reconcile and expose the first permission-scoped business-results service.

## Owner decision and read-only site assessment

The owner explicitly chose **both**: normal owner funds in/out, with loans and repayments
optional. This is recorded as [D17](decisions.md). It settles the feature choice in Q02;
actual company accounts still require explicit setup before intended-site posting.

Read-only queries against `radolfa.localhost` found one permitted company, Radolfa/TJS,
standard Equity/Liability groups and leaves, and no explicit owner-money mapping in
Company, Money Hub Settings, JE, PE or their custom fields. No account was assigned by
name: Capital Stock, Dividends Paid and generic loan accounts are not proof of owner
intent. The M2a transfer receipt table is also still absent from this site.

Native role checks found owner and manager could already read/create/submit/cancel JE;
cashier could not. Native JE authority alone therefore cannot express the simplified
owner-money action's policy. The new action requires Administrator, Retail Owner,
Accounts Manager or System Manager **and** native document permissions. Retail Manager
or Accounts User alone receives no new simplified owner-money posting authority.
These guards do not revoke existing advanced native JE permissions or grant profit,
payroll-detail, tax, shortage/surplus or POS-closing authority.

The assessment used a read-only database transaction and rollback. No existing financial
figures, personal staff data or credentials are copied into this report.

## Interface and explicit setup

Money Hub's secondary menu opens **Owner funds**. It defaults to adding ordinary owner
funds; withdrawal is the second normal choice. A check box reveals owner loans and
repayments. It displays the current loan account's balance over permitted GL entries,
with explicit company currency. This balance is independent of the history date filter.
A negative balance remains negative; it is not silently clamped to zero.

Native Dialog controls retain RU/TG wording, keyboard focus, current wallet currency,
foreign rate inputs, loading/retry/restricted states and native journal links. Dynamic
labels, notes and links are escaped. Managers can read available loan figures but the
posting action is disabled. Cashier cannot load this context. Closed dialogs and obsolete
company responses cannot render late results.

Opening the dialog creates no business data. An unconfigured company offers authorized
users two explicit paths:

- **Create dedicated owner accounts:** a native Account insert for Owner Contributions
  and Owner Withdrawals under the uniquely permitted Equity root, and Owner Loan under
  the uniquely permitted Liability root; all company-currency leaf accounts. The same
  transaction creates the company-specific Owner Money Settings. No opening balance or
  financial document is posted. An existing same-name account causes native duplicate
  validation, not an inferred assignment. A repeated setup returns the existing mapping.
- **Choose existing accounts:** open the native settings form. Account choosers filter
  selected company, leaf/enabled status and Equity/Liability root. Server validation
  independently enforces scope, type and currency. The loan account is optional.

Settings/native Account create/write permissions are retained. Guided setup and posting
share a company lock. Used mappings cannot be reassigned, including after cancellation;
configuration/history cannot be deleted or renamed. A current locking GL read prevents
an older snapshot from missing a just-posted use of an account during remapping.
Existing mappings are never silently overwritten. There is one explicit owner account
set per company; separate co-owner balances/loan terms need a further contract.

The native settings form's labels/help have Russian and Tajik translations. No company
on the owner development site has been configured or given new accounts by this work.

## Posting and calculation contract

Every successful command submits one native **Journal Entry**, retaining native create,
read, submit, accounting-dimension, account, period, multi-currency, audit and cancellation
validation. No financial document bypasses native permissions.

| Operation | Money-account leg | Dedicated counterpart |
| --- | --- | --- |
| Owner funds added | Debit cash/bank in original currency | Credit configured contribution Equity account in company currency |
| Owner funds withdrawn | Credit cash/bank in original currency | Debit configured withdrawal Equity account in company currency |
| Owner loan received | Debit cash/bank in original currency | Credit configured owner-loan Liability account in company currency |
| Owner loan repaid | Credit cash/bank in original currency | Debit that owner-loan Liability account in company currency |

Company, wallet and account identity/read scope are validated. Sources must be enabled
Cash/Bank leaf accounts; counterpart accounts must be enabled same-company leaves in the
required root and company currency. Tax, stock and party-payable account types cannot
be used as owner counterpart mappings. Contributions and withdrawals have distinct accounts.

Amounts/rates must be finite, positive and use supported precision. Company-currency
rate is exactly 1; foreign wallet rate is explicitly entered, with up to nine decimals.
Booked counterpart is original amount × rate, rounded with native currency precision.
Native JE independently balances the entries. The native `ignore_exchange_rate` flag
preserves an explicitly entered foreign rate of exactly 1; it skips rate lookup, not
permissions or accounting validation. There is no network rate download during posting.

A normal contribution/withdrawal changes Equity; a loan/repayment changes the designated
Liability balance. None of these actions posts revenue, COGS, expense, tax or payroll.
They must not be counted as business profit/spending merely because money moved.
Interest, loan agreements, multi-owner allocation and legal distribution rules are not
inferred. Native advanced accounting remains the escape hatch.

Repayment cannot exceed the booked loan owed through the posting date. This is a guarded
write validation over **full native account books**, not the possibly restricted display
subtotal; the authoritative figure is never returned by that validation or its error.
The query is parameterized by explicit company/account/date and excludes cancelled GL.
Current locking reads avoid a repeatable-read snapshot missing the previous repayment.
Company serialization makes simultaneous simple repayments see the updated amount.
Advanced native JE/cancellation can deliberately change this ledger independently; it
is not an automatically allocated loan-agreement subsystem. Such changes remain visible,
including a negative balance, and are not silently repaired by this hub.

Reimbursement of a cost already recognized must use its original approved claim/payable
workflow. The dialog explains this, and unsupported reimbursement/salary/supplier/tax/
expense operation keys are rejected. There is no second expense recognition and no new
claim/employee/supplier payment handoff in this increment.

## Durable recovery, native sources and history

`Owner Money Movement` is an immutable, non-financial service receipt. It retains actor,
company, operation, normalized intent hash, original wallet/owner accounts and JE link.
Receipt identity hashes the stable request key in a namespace separate from transfers.
The receipt is claimed before JE insertion; both commit/roll back in one transaction.
Only this private receipt insert/save is elevated after authorization. Native REST/form
receipt edits, creation, renaming and deletion are rejected by its controller.

The service locks actor then company **before** querying a potentially absent receipt,
avoiding competing missing-key gap locks for the same company. Reusing a key for another
actor or changed intent fails. Stable replay and outcome read the current native JE with
a locking read and recheck company, source and account permissions, including field-level
source serialization. They do not need fresh posting authority, active wallets or unchanged
configuration. Cancelled JE returns **cancelled**, never a replacement posting. The Link
retains the native source and prevents its deletion; native cancellation remains available.

Client request persistence is shared with transfers but stored separately per action,
user and company. It writes before sending and retains exact ID/intent through unknown
responses, reloads and stale dialogs. Foreign owner currency is also retained separately
from the server payload, so hiding/renaming a wallet cannot relabel its pending USD amount
as TJS. Inputs lock during send; a stale recovery dialog cannot create a new ID after
another tab confirms/clears the shared request. A changed page company cannot submit an
old dialog. Cancelled and submitted journals have distinct wording/native links. A storage
failure prevents sending. Setup/context failure cannot suppress recovery of an existing
pending request. Do not purge pending local storage to resolve an unknown outcome.

New endpoints are `get_owner_money_context`, `setup_owner_money`,
`record_owner_money_movement` and `get_owner_money_request_outcome`. Writes/outcomes are
POST-only. The new posting route does not exist on older workers, so old code cannot
silently discard a request key and execute an old financial write.

Movement history adds an **Owner funds/loans** filter and four RU/TG labels. Classification
requires a permitted typed receipt linked to an already readable, submitted JE; metadata
is batched in groups of at most 200. Remarks/account names never classify owner intent.
If receipt access is denied/unavailable, a readable JE keeps its generic label. Pre-upgrade
sites remain readable. Existing expense precedence, supported sources, transfer grouping,
whole-filter totals, native detail links and base/original currencies remain intact.

## Files changed and linked impact

- `erpnext/accounts/doctype/owner_money_settings/`: company-specific native configuration,
  account queries, validation and mapping-history protection.
- `erpnext/accounts/doctype/owner_money_movement/`: immutable request/source receipt.
- `erpnext/accounts/page/money_hub/owner_money.py`: explicit setup/context, source permissions,
  four JE commands, current loan balance validation and retry/outcome contract.
- `money_hub.py`: new scoped read/POST endpoints; `money_hub.js`: owner menu/dialog and shared
  persistence; `movement_history.py`: batched permitted typed owner classification.
- `test_owner_money_native.py`, `test_owner_money.cjs`, extended history fixtures: regressions.
- `erpnext/translations/ru.csv` / `tg.csv`: six appended native settings labels/help each;
  existing translation edits/line endings preserved.
- Root tracker, decisions and master/Money Hub plans: D17, evidence and next task.

No HRMS/POS Awesome implementation, checkout, POS Profile, offline queue, receipt/printing,
supplier settlement, staff pay, tax formula or existing product/supplier screen was changed.
M2a transfer native contract and prior local changes are preserved.

## Verification performed

| Check | Evidence and result |
| --- | --- |
| Backend fixtures | **57 passed**: retained M1 cases plus three owner typed-history/source-permission/batching/remarks regressions |
| New native integration | **22 passed** on upgraded isolated `pos-shift-native.localhost`, `allow_tests=1`: explicit/idempotent setup, all four balanced native JE/GL routes without Income/Expense, partial/over repayment, USD/base and explicit rate 1 without lookup, invalid amounts/rates/company/roots/aliases, optional loans, native permissions before full-book validation, manager read-only/cashier denial, changed actor/intent, rollback, source cancellation/deletion, disabled-account recovery, used mapping protection and typed history |
| M2a native regression | **24 passed** on that isolated site: existing transfer/wallet/tax native contract retained |
| Concurrent repayment | **Passed** with two independent accounting actors/connections whose old snapshots both saw 150 TJS owed: concurrent 100 TJS repayments produced one submitted JE, one rejection and 50 TJS remaining. Committed fixtures retained only in a separate disposable test company |
| UI fixtures | **44 passed**: existing 34 plus ten owner dialog/default/optional-loan/restricted/schema/setup/retry/reload/cancellation/race and retained-currency cases |
| Browser fixtures | **4 passed**, RU/TG × 1440px/390px: authenticated real Desk/Dialog controls, all owner-money responses intercepted. Normal funds/optional loan switch, USD/rate, loan balance, keyboard, unknown/reload/same ID, submitted/cancelled native JE link, escaping and dark/mobile layout; no financial RPC reached the owner database. Desktop RU/mobile TG screenshots inspected |
| Static/docs | Python compilation, JS syntax, scoped ESLint and changed-path whitespace passed. 19 Markdown files/102 local links/newlines and six new translation rows per language checked |

Private harnesses/logs/screenshots are in ignored `private/money-hub-m2b/`. Native tests
ran sequentially with other native fixture suites; competing Account fixture builders
must not run together. The dedicated test DB/Redis containers were started for checks and returned to their
original stopped state afterward; isolated fixtures remain in those disposable volumes. Ordinary Docker services were unchanged.

Commands used the bench `env/bin/python` for the four backend fixture modules and private
`run-native.py`/`concurrency.py`; the M2a private native harness checked its 24 cases.
`node --test` ran five Money Hub suites; Playwright ran private `browser.cjs` against the
local authenticated Desk with intercepted APIs. `compileall`, `node --check`, scoped
ESLint and diff/link checks covered changed paths. ESLint emitted its existing legacy
configuration deprecation notice. Ruff/Black executables were unavailable; no installation
was attempted. No full checkout asset build was needed for the Desk page code.

## Activation and next task

Owner Money Settings/Movement schema and translations need the normal intended-site
backup/upgrade/cache/service activation with coordinated M2a/M2b code. Only the disposable
site received these DocTypes. There was no owner-site migration, account provisioning,
financial posting/cancellation, role grant, worker reload, commit or push. A final read-only
check confirmed both owner DocTypes and all three dedicated owner accounts remain absent
from the owner development site. Before schema
upgrade the new context reports upgrade-required and posting fails closed. Actual owner
company mapping is an explicit setup action, never a page-opening side effect.

Owner acceptance still needs setup/action/history/loan-balance review after authorized
activation. Reimbursement handoffs, separate co-owner/loan-agreement balances, hardware,
offline POS and production-scale ledger performance are not claimed complete here.

**Next task: M3a.** Trace and reconcile a first read-only business-results service against
native sources: period net sales/returns/tax exclusion, historical COGS, native recognized
expenses and payroll/tax source coverage. Apply D06 manager profit/cost visibility coherently
across affected helpers/APIs/reports with company/document scope before exposing its UI.
Keep financing/owner movements separate and mark unposted/missing payroll/tax information
explicitly; do not label cash change or incomplete costs final net profit. Start with the
M0 gap list and existing Home/ProductCostLookup/GrossProfitGenerator/native P&L contracts,
then choose the bounded service/UI increment based on source reconciliation.

Suggested future commit: `Add explicit owner funds and recoverable owner loan workflows`.
No commit was created.
