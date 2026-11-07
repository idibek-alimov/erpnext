# Money Hub M2a — authorized writes and recoverable native transfers

Date: 2026-11-07. Implementation: **Implemented locally**.
Verification: **Targeted native/fixture checks passed**; owner acceptance **Pending**.
Release: **Not activated on the owner development site**; receipt schema installed only
on the isolated disposable test site. Parent: [Money Hub](money-hub.md).
Previous: [M1c](money-hub-m1c.md). Next: M2b owner-money mapping and recording.

## Result and authority

Money Hub's `create_wallet`, `update_wallet`, `transfer_money`, `save_tax_settings` and
`pay_tax` are POST-only commands. They retain the existing Money Hub role gate and add
native document permissions. Visibility does not grant financial posting, POS Profile
editing, tax editing, payroll-detail access or genuine-loss approval. No business-site roles/grants changed; test role assignments were disposable fixtures.

Company read access and each selected wallet/account's native read permission are
checked. Wallet updates additionally require native wallet write access. Wallet/account
company identities must match; posting sources must be enabled Cash/Bank leaf accounts.
Account currency uses the native company fallback for older blank-currency accounts.
Native Account, Money Wallet, Mode of Payment, POS Profile, Payment Entry and Journal
Entry insert/save/submit validations and permissions remain enabled.

Commands use savepoints without explicit commits. Errors roll back their compound
changes; successful HTTP requests use Frappe's normal transaction boundary. Responses
contain command results rather than running balance/tax reads after posting, so an
unrelated summary failure cannot turn a successful write into an apparent failed write.
The browser refreshes current balance scope separately after a confirmed transfer.

The legacy `import_existing_accounts` provisioner remains used by Staff Detail/Tax Desk
source discovery; it is not called by Money Hub reads or M2a commands. Its cross-hub
read-side wallet creation/elevated save/commit remains an S0/T0 source-discovery issue.
This increment secures the listed command endpoints, not every legacy bench mutation.

`create_wallet` creates a company-currency account and optional authorized opening JE
and payment method. Negative/non-finite/overprecision openings and invalid commissions
are rejected. `update_wallet` rejects cross-company input before saving/renaming.
Company-row locks serialize wallet administration. Existing native rename checks remain.

## POS payment-method contract

Only the affected wallet's Mode of Payment is synchronized, and only when POS acceptance,
visibility or its method actually changes. Commission/name-only edits do not repair or
rewrite profile payment tables. Unrelated native methods/defaults remain. Another active
accepted wallet alias can retain the same method. No arbitrary fallback Cash method is
invented. Enabled profiles in the company are considered; every changed profile requires
native write permission. A denial rolls back the wallet, account, method and opening JE.

Existing POS Profile company/payment settings remain the checkout/opening/cache source.
The existing native profile save/hooks perform their usual cache/notification behavior.
Pricing, warehouse, stock, taxes, invoice payloads, offline queues, receipts and printing
logic were not edited. The POS counted-cash transfer service retains its own closing
provenance and request identity; it does not call the generic Money Hub transfer command.
The [shift contract](../../../posawesome/docs/shift-review-contract.md) now records this
transaction boundary instead of its historical explicit-commit warning.

## Native transfer and recovery contract

`transfer_money` takes the original wallet/amount/kind/note/company arguments plus a
required stable `client_request_id`, optional `received_amount`, `source_exchange_rate`
and `target_exchange_rate`. Its result is a native source outcome, **not** the old Hub
snapshot. The Desk caller is updated together and uses the new `record_money_transfer` route
(an alias of the secured command). That route is absent from older workers, so they
cannot discard unknown new arguments and execute the old non-idempotent transfer during
a mixed-code reload. Only the Desk caller of the generic action was found. Other old
callers must upgrade: a missing request key fails closed.

- A native **Payment Entry / Internal Transfer** records the movement. Distinct wallet
  names sharing one account cannot transfer to each other. Cross-company, disabled,
  group, non-Cash/Bank and unreadable sources/destinations are rejected.
- Amounts retain source/destination currencies and supported precision. Company-currency
  rates are exactly 1. Foreign rates are explicitly supplied, finite and positive, with
  at most nine decimal places; they are never guessed or downloaded during posting.
- Same-currency accounts require equal original amounts and rates. Different currencies
  require the destination amount and relevant rates. Rounded booked base amounts must
  balance, and native PE validation independently enforces zero difference. Fees or FX
  differences require the advanced native Payment Entry workflow; the simple form does
  not silently create a fee, gain/loss or owner transaction.
- `Money Hub Transfer` is a new non-submittable service receipt. Its primary key hashes
  the stable request key; actor, company, normalized intent fingerprint and native PE
  link are retained. The receipt is claimed **before** PE insertion, and both commit or
  roll back together. This bookkeeping record alone uses a narrowly scoped elevated
  insert/save after authorization; no financial document bypasses permissions.
- Receipt create/edit/rename/delete is rejected outside the service, including native
  REST/form writes. Its Link prevents deletion of the native source. Native cancellation
  remains available with native permissions; receipts are not financial documents and
  do not block cancellation. Replaying a cancelled request returns **cancelled** and
  never creates a replacement. Amendments remain native explicit operations.
- A User-row lock serializes the actor's commands through transaction end; the receipt's
  unique primary key also prevents another actor from claiming the same operation.
  Reusing a key for another actor or changed intent is rejected. Retries normalize
  numerical representations, so `100` and `100.00` are one intent.
- Replay/outcome check current Company, PE and Account read scope, including field-level
  source serialization. They follow the native PE's current status. A locking source
  read sees the first committed PE even if a concurrent retry already established an
  older MariaDB repeatable-read snapshot. Read-only recovery does not need new posting
  authority, but cannot bypass revoked native source read access.
- `get_transfer_request_outcome` is POST-only and returns the native result or serialized
  `not_found`. A missing receipt alone is not proof that a delayed request cannot arrive.

The Desk dialog labels original currencies and shows foreign amount/rate inputs only
when relevant. It suggests a different account rather than another alias. The client
persists exact intent plus UUID in local storage, scoped to user and company, before
sending. Unknown results retain the original ID/values across closing/reloading. Changed
intent is blocked until the prior request is confirmed. Inputs lock while submitting;
an already-open recovery dialog retains its original ID even if another tab confirms
and clears shared storage. A changed page company cannot post an old dialog's intent. Explicit server rejection plus
a serialized `not_found` allows editing; an ordinary timeout does not. Confirmed submitted
and cancelled outcomes link to the native PE and are worded differently. Storage failure
prevents sending. Do not clear this pending state as a troubleshooting shortcut.

This does not make independent transfers by different people/devices one business intent.
The operator must review native history before deliberately creating a new request.

## Legacy tax writes and owner-money boundary

`save_tax_settings` now requires native settings write permission and cannot silently
move singleton settings to another company. Finite non-negative values/rates are checked.
It no longer provisions an expense account from a guessed tax name. `tax_account` is
editable in the existing native settings form for authorized configuration.

`pay_tax` requires native settings read, explicit same-company Expense/Liability leaf account mapping and
native JE create/submit authority. Foreign-currency payments are directed to native
accounting. It no longer guesses an account or writes singleton settings after posting.
This secures the existing action; it does **not** validate its legal regime, calculation,
recognition basis or completeness. There is no new simplified tax-payment UI or retry
protocol; T0 must establish those contracts before promoting that action. Existing tax
summary/profit formula gaps from M0 remain, including the two settings sources.

Q02 remains unresolved. Source inspection confirms native Account `root_type` separates
Equity/Liability/Asset from Income/Expense, and JE/PE are the accounting owners. Recommended
M2b configuration, **not approved mappings or new accounts**:

| Business intent | Proposed native treatment to confirm |
| --- | --- |
| Permanent owner investment / personal drawings | Explicit designated equity capital/drawings accounts; separate incoming/outgoing labels and native JE links |
| Owner money the business must repay / repayment | Explicit designated owner-loan liability account and repayment balance; no sale/expense inferred from cash direction |
| Repay an owner for a business expense already recognized | Settle/link the original approved payable/claim through its native workflow; do not recognize the expense again |

Before new owner-money postings, ask whether ordinary funds added are permanent capital
or a repayable loan, and whether withdrawals are personal drawings or loan repayments.
Then confirm the actual company/account mapping and authorized roles. Do not choose from
account names, remarks or the presence of cash. Independent M3 source review can proceed
while those choices are pending; final profit remains M3/M4.

## Files and linked impact

- `erpnext/accounts/page/money_hub/money_commands.py`: common command scope/numbers,
  savepoints, native transfer, durable intent and current-read recovery.
- `money_hub.py`: secure existing write wrappers, native compound wallet/POS operations,
  explicit tax mapping, POST-only endpoints and command-result response shapes.
- `money_hub.js`: original-currency dialog, persisted retry/reload recovery, cancellation
  wording and native result links. M1 overview/history/details remain intact.
- `erpnext/accounts/doctype/money_hub_transfer/`: immutable receipt controller/schema.
- `erpnext/accounts/doctype/money_hub_settings/money_hub_settings.json`: explicit native
  tax-account configuration; no new tax rules or grants.
- `test_money_commands_native.py`, `test_transfer_requests.cjs`: native and UI regressions.
- Linked POS shift contract and root/roadmap/Money Hub status documents updated.

## Verification performed

| Check | Result and scope |
| --- | --- |
| Existing backend fixtures | **54 passed**: M1 snapshots, balances, whole-filter/paged history and native-detail scope |
| Native M2a integration | **24 passed** on isolated `pos-shift-native.localhost`, `allow_tests=1`: native TJS↔USD and USD↔USD amounts/GL, same-account aliases, invalid rates/amounts, native Accounts Manager posting, Stock Manager denial, company/account User Permissions, changed actor/intent, revoked native read, rollback after native submit failure, receipt tampering/deletion, cancellation/retry/source retention, wallet opening, POS method/alias preservation and denied-profile compound rollback, tax scope/configuration |
| Concurrent native retry | **Passed**, two independent connections to that disposable database: one receipt, one submitted PE, identical returned source and fresh-session outcome recovery. Native test fixtures/results retained only there |
| UI fixtures | **34 passed**: existing 22 plus 12 persistence/reload/ambiguity/rejection/cancelled/wrong-company/storage-scope/stale-dialog/company-change cases |
| Native Desk dialog browser fixtures | RU/TG × 1440px/390px using real authenticated Desk/Dialog controls with **all transfer responses intercepted**: currencies/rates, alias-aware default, unknown outcome/reload/original ID, submitted versus cancelled wording/link, escaping, dark theme and no page overflow. No financial RPC reached the owner database |
| Linked native expense/shift/tax checks | **20 passed** on the same isolated site: 3 Quick Expense, 14 native shift workflow and 3 Retail Tax Settings cases; separate from M2a cases |
| Static checks | Python compilation, JS syntax, scoped ESLint and changed-path whitespace checks; no checkout asset build needed for Desk page code |

Private harnesses/logs/screenshots are under the development site's ignored
`private/money-hub-m2a/`. Fixtures are explicitly separate from native production-data
verification. The configured `qpr-test.localhost` database was unreachable; testing used
the already provisioned isolated native bench/database instead. Its dedicated test DB
and Redis containers were started for the checks and returned to their original stopped
state afterward; test fixtures/receipts remain only in their isolated volumes. Production
Docker services were not changed.

## Commands and suggested commit

Checks actually run from the bench used `env/bin/python -m unittest` for the four
M1 backend modules; `node --test` for the four Money Hub `.cjs` suites; and private
`run-native.py`, `concurrency.py` and `browser.cjs` harnesses under `private/money-hub-m2a/`.
The existing `private/pos-shift-development/run-native.py` ran the 20 linked native cases.
Run the native fixture suite and the concurrency harness **sequentially**. One verification
attempt ran both fixture builders together and deadlocked during native Account nested-set
creation (MariaDB 1213, then cleanup savepoint 1305). This was a test-orchestration failure
before the transfer case; the sequential rerun passed all 24 cases, and the independent
two-connection transfer rehearsal passed. Do not run competing Account fixture builders
against the same disposable company.
Static checks used `compileall`, `node --check`, scoped `eslint` with the ERPNext config,
and `git diff --check` on changed paths. Documentation checks passed for 18 Markdown
files, 95 local links and whitespace/newlines.
The legacy ESLint config emitted its existing deprecation notice; no lint failures.

Suggested future commit message: `Secure Money Hub writes and make native transfers recoverable`.
No commit was created.

## Activation, limits and next task

The new receipt DocType and settings metadata require a site upgrade before M2a transfer
posting. Only the disposable site received targeted schema reloads. No owner-site
migration, role grant, financial posting/cancellation, worker reload, commit or push was
performed in this increment. M1's existing development activation is historical, not
M2a activation. Without the receipt table, new transfer commands fail closed with an
upgrade message; old callers lacking a stable key also fail closed after activation.

Before intended-site use, take the normal backup/upgrade path, install the receipt
DocType/settings metadata with the coordinated code, restart the actual local services,
and verify intended native roles plus owner acceptance. Do not reset the site, purge
pending local storage or offline queues to activate it. Hardware/offline checkout and
large-ledger performance remain separate release gates. Browser checks here do not prove
an owner-site native financial submission.

**Next implementation task: M2b — settle Q02 and implement explicit owner-money flows.**
Use the concrete choices above, inspect configured native accounts without guessing,
and obtain the mapping decision before posting actions. Reuse this native permission/
request pattern; preserve the separate expense/shift/tax contracts. M3/M4 final profit,
manager profit-access policy and M5 performance remain pending.
