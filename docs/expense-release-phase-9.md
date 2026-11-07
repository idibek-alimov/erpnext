# Summary

Subsequent development activation: the owner declared the local MariaDB data disposable
and selected `radolfa.localhost:8000`. That local site is now migrated and configured;
see the [development setup report](../../posawesome/docs/shift-review-development-setup.md)
for current access, test records and the later cashier-startup/closing, manager balance
read permission and shared expense-dialog fixes. The report
below remains the original isolated Phase 9 verification evidence.

Phase 9 local verification/release handoff, 2026-11-06, alongside POS Awesome's review
workflow. The owner also explicitly included fixing the Retail Tax Settings cold-install
blocker. Existing expense/Desk/Money Hub edits were preserved. No production migration,
role/account setup, supplier creation, tax change, accounting transaction, deployment,
commit or push was performed. All writes were native disposable-site fixtures.

# Files Changed

- `erpnext/accounts/doctype/quick_expense/quick_expense.py`: retain an already attached
  private receipt instead of duplicating its Quick Expense File while sharing it with
  the backing native journal. Native tests verify one attachment per target.
- `erpnext/accounts/page/expense_desk/expense_desk.js`: accessible names on native company/
  register/opening scope inputs, matching the visible labels.
- `erpnext/accounts/expense_services/native_test_support.py`: small native test-company,
  fiscal-year and Transit-master setup; requires `allow_tests`. No broad Account fixture
  recursion, business-company names or accounting validation bypass.
- `erpnext/accounts/doctype/quick_expense/test_quick_expense.py`: use that test setup so
  native GL/idempotency/cancellation tests run independently on a disposable site.
- `erpnext/accounts/doctype/retail_tax_settings/retail_tax_settings.json`: remove the
  nonexistent supplier Link default that blocked initialization of native singles on
  fresh installation. Existing explicit company tax setup still provisions its supplier;
  existing supplier/tax rates/accounts/templates are not changed by removing a default.
- `erpnext/accounts/doctype/retail_tax_settings/test_retail_tax_settings.py`: three native
  tests for read-only initialization, explicit setup/rerun and configured supplier retention.
- This report and the shared contract: rollout/evidence pointers.

# Linked Features Checked

Ordinary spending still creates one native JE. POS account/profile/shift authorization,
company/category mapping, native scope, manager cancellation, original request identity
and private receipt checks remain enforced. A cashier's recipient text does not become an
employee/supplier payment. Money Hub base GL balances and foreign account originals were
reconciled against a real multi-currency journal, including duplicate wallet aliases.
Expense Desk shares its detail renderer with Shift Review; no navigation posts spending.
The tax change affects fresh Link defaults, not approved tax calculation or posting rules.

# Commands Run

See [POS Phase 9 evidence](../../posawesome/docs/shift-review-phase-9.md) for full commands:
232 scoped backend fixtures, 19 native tests,2 actual database-connection scenarios,
50 Vue/offline tests, 46 Node tests, 46 rendered browser fixture cases and 6 authenticated
EN/RU/TG desktop/mobile cases with native controls/RPCs and scoped Axe. Native ERPNext
suites are `erpnext.accounts.doctype.quick_expense.test_quick_expense` and
`erpnext.accounts.doctype.retail_tax_settings.test_retail_tax_settings`.

The current combined app source installed on a second clean site without the earlier
Retail Tax Settings workaround. Full migrations/reruns and a SQL backup/restore were
rehearsed on dedicated disposable databases, preserving financial/review record hashes.
Build/type/lint/asset checks and CRLF-aware diff checks passed; hardware was not tested.

# Risks / Notes

Update ERPNext and POS Awesome together and follow the
[shared release runbook](../../posawesome/docs/shift-review-release.md). Choose company
account/category/dimension/source grants and actual native role/User Permissions before
rollout. Do not assign Accounts User to a cashier as a shortcut for register-read access.
Historical unassigned records remain unchanged and need evidence-based investigation.
Native HRMS claim/supplier settlement, bank reconciliation, private-file backup restore,
the intended full historical site upgrade and printer/QZ operation remain operator gates.

Suggested commit, only if authorized:
`fix(accounts): validate expense release and allow clean tax settings install`
