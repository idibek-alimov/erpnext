# Expense Desk — Phase 5 completion

Completed locally 2026-11-06. The owner authorized the next unfinished phase in the
bench-root `POS_SHIFT_DISCREPANCY_PLAN.md`. No site migration, role assignment,
deployment, business expense, reversal, shift closing, transfer or real File upload
was performed. All earlier local phases are preserved.

## Result

`/app/expense-desk` now leads with company/currency and three figures: Paid expenses,
Paid in cash, and Paid through bank/wallets. They cover **all matching submitted
records**, independently of pagination; drafts and cancellations remain visible when
requested but never increase paid totals. Other historical source types and missing
shift attribution are disclosed separately. These are period expenses, not balances
or missing-money amounts.

The list defaults to **This month**, with the server's explicit date range. Today,
yesterday, last seven days, custom dates and all history are available. Source,
category and search are primary filters; company, register, opening shift, recipient
and status are under More filters. State stays in the cached Desk page when opening
native documents and returning; returning refreshes the records. Reset retains the
selected company. Search/date edits immediately invalidate old results and figures;
late requests cannot replace newer scope. Errors/offline/invalid custom dates show
dashes and a useful retry state instead of stale figures or believable zeroes.

The default table has Date, Expense/category and note, Paid from, Amount, Recorded by.
Details show original document identity/status, amount, company/date/category/source,
recipient, note, correction/cancellation reason, shift, receipt and native accounting
or amendment links. Source identities include DocType: a Quick Expense and legacy
POS Cash Movement with the same name remain separate records. Deposit/transfers and
backing Journal Entries are not separately counted as expenses.

The native **Record expense** dialog asks for Category, Amount and Paid from. Date,
note, optional descriptive recipient and private receipt are secondary. Category IDs
are submitted unchanged, never translated display labels. Ordinary entry independently
requests **Desk** sources even if history is currently filtered to a register. It
cannot inherit POS spending permission from a history filter. No arbitrary category,
source/account, company currency or balance is guessed.

The secondary **Correct a POS expense** action requires manager capability, native
POS discovery permissions, the installed POS adapter, an explicit submitted opening
shift, an approved register funding account and a reason. The server derives profile
from that shift. Required register notes are disclosed and required using the same
stored profile setting already enforced by the POS adapter. Correction source requests
ignore late responses after changing the selected shift. Both ordinary and correction
entry use the existing shared commands, category mappings, policy and native posting.
A closed-shift expense does **not** resolve a discrepancy or edit the closing snapshot.

Manager cancellation is available only on a current readable Quick Expense detail
with native document cancellation permission. It requires a reason, the fetched
modified version and a stable original request ID. Its wording explains that reversal
does not physically return money. A replacement is recorded after confirmed
cancellation; no automatic second expense is generated. Historical Cash Movements
retain their native document correction workflow.

Unknown record/cancellation requests remain visible independently of current sources,
categories, company/filter success or form validation. **Check result** performs a
read using the original ID; **Retry original request** resends saved original intent
through the existing helper. A missing result, denied read, corrupt evidence or
submitted-but-not-cancelled document does not become a successful cancellation or
remove its evidence. No queue reset/discard action was introduced. Confirmed posting
is reported separately from a subsequent history refresh failure.

Receipts use the native FileUploader with private uploads, no web link/file-browser
substitution and no public toggle. Only native private upload results are accepted
for new attachments. Recording is blocked while upload is open or an attempted upload
remains unconfirmed; users can retry or explicitly remove the optional receipt.
Late upload callbacks after the uploader closes cannot replace the attachment.
Existing local public/private File paths retain native download links. Permission
checks and File propagation remain in the existing backend. Nothing is uploaded merely
by opening this page. Removing a form attachment does not delete a native File.

Personal spending and unpaid supplier bills have explanatory handoffs; native Expense
Claim/Purchase Invoice links appear only with corresponding boot read permission.
Naming a recipient does not create an Employee party, advance, debt or payroll action.
Shift Review navigation is gated until its real page/services exist in Phases 6–7;
current native shift links work now. No working-looking review approval is exposed.

## Files and reasons

Paths relative to ERPNext unless marked POS Awesome or bench:

| File | Reason |
| --- | --- |
| `accounts/page/expense_desk/expense_desk.js` (under `erpnext/`) | Native page actions, list/filter/totals, entry/correction/detail/cancellation dialogs, private receipt handling and independent recovery. |
| Same directory `expense_desk.css` | Fully scoped native theme tokens, quiet tables/summaries and contained mobile scrolling. |
| Same directory `expense_desk.json` | Include existing Retail Owner/Retail Manager/Accounts User business capabilities in Page discovery; backend permissions still govern. No users/roles assigned. |
| Same directory `expense_desk.py` | Add native capabilities, historical filter metadata, resolved date range, per-document cancel capability and optional adapter note requirement. No setup writes. |
| `erpnext/accounts/expense_services/history.py` | Historical category/account choices from permission-compiled transaction scope; `account:` history filtering with company/User Permissions, independent of spending grants; authoritative period dates. |
| `erpnext/accounts/expense_services/test_expense_history.py` | Execute historical choice/account filtering, denial and month-boundary checks against isolated SQL fixtures. |
| `erpnext/accounts/expense_services/test_expense_queries.py` | Read-only query fixtures, capability gates and native per-document cancellation permission. |
| `erpnext/accounts/page/expense_desk/test_expense_desk.cjs` | 17 meaningful UI orchestration/recovery/scope/escaping/receipt tests. |
| `erpnext/translations/ru.csv`, `tg.csv` | 71 additional Phase 5 labels/messages per language, preserving existing entries and line endings. |
| POS Awesome `posawesome/posawesome/api/expense_context.py` | Add the existing register note requirement to the validated context; no scope/posting-policy change. |
| POS Awesome same directory `test_expense_context.py` | Stored register note requirement regression. |
| `docs/expense-workflow-contract.md`, POS Awesome `docs/FEATURE_CONTRACTS.md` | Link the new local UI completion and preserve the later discrepancy boundary. |
| Bench `POS_SHIFT_DISCREPANCY_PLAN.md` | Mark Phase 5 locally complete and leave Phase 6 pending owner instruction. |

The Product Catalog/Product Detail JS/CSS and canonical `erpnext-simple-desk` design
standard were inspected. Their restrained identity, controls, tables, source links,
theme variables and responsive intent were adapted to expenses. Product KPIs and
warehouse defaults were not copied. No framework or HRMS source was changed.

## Verification

- 132 combined Python unit/isolated SQL tests passed for shared policy/commands,
  query/history, POS context, legacy retries, source repair, closing and summary.
  Two standalone loyalty tests also passed: **134 backend checks** in total.
- `node --test erpnext/accounts/page/expense_desk/test_expense_desk.cjs
  erpnext/accounts/expense_services/test_expense_requests.cjs`: **32 tests passed**
  (17 new Desk orchestration checks plus 15 existing shared-helper checks).
- `bench build --app erpnext`: passed production JS/CSS and translation compilation.
  Existing Browserslist age advisory only. Used the existing `/usr/local/bin/bench`;
  the bench virtualenv has no separate `env/bin/bench` executable.
- Scoped ESLint using ERPNext's existing `.eslintrc`: passed. Existing ESLint config
  deprecation advisory only. JavaScript syntax, Prettier, Python AST/JSON/translation
  checks and both app whitespace checks passed.
- **17 Chromium rendered fixture scenarios**: RU/TG × desktop 1440/tablet 834/mobile
  390 × light/dark (12), plus unknown/lost-response recovery with removed config,
  explicit shift correction with required note, error/invalid-custom/offline totals,
  manager cancellation/version/reason, and restricted detail/entry rendering.
  Canonical category/source submission, independent period totals after paging,
  filter interactions, native record URLs, no page errors and no whole-page horizontal
  overflow were checked. Desktop, mobile dark, entry and detail screenshots were
  visually inspected. Search was exercised by keyboard.

Browser fixtures rendered the actual page script/CSS, actual shared request helper,
existing native Desk stylesheet and jQuery, with mocked APIs and stand-ins for native
Dialog/Link controls. They do **not** prove authenticated site navigation, native
autocomplete/dialog focus/keyboard traps, File storage/download/sharing, GL reversal,
MariaDB permission compilation, live concurrency or hardware printing. These remain
controlled migrated disposable-site Phase 9 checks. No new browser dependency was
installed; an existing cached Chromium executable was selected explicitly.

Phase 5 adds no accounting schema. Its Page role metadata and the earlier Phase 2
schema/source/category setup still need the authorized migration/activation workflow.
No live site caches were cleared or services restarted. Native ordinary Quick Expense
form behavior and all POS queues/closing guards remain on the shared services.

## Next phase

Phase 6 implements immutable discrepancy snapshots, pending review on closing,
resolution allocations and approved native accounting adjustments. In the existing
missing-50 example, this phase **still does not** remove fictitious till cash or mark
the difference resolved. Phase 7 supplies the manager Shift Review UI; Phase 8 connects
its navigation. Wait for the owner's next-phase instruction.

Suggested commit subject, only if committing is later authorized:
`feat(accounts): simplify Expense Desk with scoped entry and result recovery`
