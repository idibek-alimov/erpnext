# Money Hub M1a — transaction details implementation and verification

Date: 2026-11-07. Implementation: **Implemented locally**.
Verification: **Targeted checks passed**, with limits below.
Owner acceptance: **Pending**. Release: **Development activation only**.
Parent: [Money Hub](money-hub.md). Audit: [M0 baseline](money-hub-baseline.md).

## Result and scope

Money Hub transaction details now use native source-document/company/account/ledger
permissions and preserve original document, payment-side and account currencies.
The dialog shows a compact authorized movement summary, source document, status,
counterparty, note, permitted account movements, items and payment allocations.
Source links are real links; tables stay within the dialog and support keyboard focus.
Failures show an inline retry, and closed/stale dialogs do not render late responses.

This is the first bounded M1 increment. Complete movement history, classification,
transfer grouping, full summaries and manager profit visibility are not completed by
this change. Existing money-feed SQL still needs M1b; do not mistake secured details
for a fully permission-scoped feed. Final profit work remains M3/M4.

## Files changed and why

- `erpnext/accounts/page/money_hub/money_hub.py`: restrict financial voucher types,
  require native source read and same company, require a native permission-scoped
  noncancelled wallet GL leg, apply field-level read permissions, filter referenced
  documents/accounts using batched native queries, return explicit original/base currencies
  and authorized movement values. Reads make no postings/provisioning/commits.
- `money_hub.js` in the same directory: replace the decorative receipt-style detail
  with a native compact dialog; pass selected company, use server-authorized values,
  escape variable text/links, add source links, currency labels and inline errors/retry.
  Suppress duplicate framework message dialogs because errors are handled in the detail.
- `money_hub.css`: add styles scoped to the new transaction-detail container, native
  theme variables, contained table scrolling and a one-column mobile metadata layout.
- `test_transaction_details.py`: 19 database-free permission/currency/read-only regression
  tests for the public method and referenced-document filtering.
- `test_transaction_details.cjs`: 8 database-free dialog tests for requests, stale values,
  escaping, retry, close/race behavior, currencies, source links and Tajik labels.
- Roadmap, Money Hub plan, audit and root tracker: record actual progress and M1b next.

Money Hub Python/JS already had unrelated local balance/expense changes. Those edits
were preserved. No ERPNext role helper, native schema, HRMS or POS source was changed.

## Verification performed

| Check | Result and scope |
| --- | --- |
| Backend unit fixtures | **24 passed**: 19 new detail tests plus 5 existing shared-wallet/base-currency/read-only balance regressions; no database connected |
| Dialog orchestration | **8 passed** with Node test runner; no site writes |
| Native read-only checks | On `radolfa.localhost`, a read-only SQL transaction exercised each role over existing sources: owner and manager each read 12 JEs, 18 PEs and 6 Sales Invoices; each had 38 Sales Invoice source-permission denials. Cashier detail access denied. Transaction rolled back |
| Authenticated native browser | Owner at 1440px and manager at 390px: real RPC/source detail, source link, responsive metadata/table containment, unsupported-type error/retry; no uncaught page errors |
| Labelled browser API fixtures | RU and TG at 1440px and 390px: original USD/account amounts versus TJS base amounts, escaped malicious-looking text, permitted reference links, keyboard link focus and no dialog overflow. These are fixtures, not real USD postings |
| Source checks | Python compilation, Node syntax, scoped ERPNext ESLint and scoped Git whitespace check passed. ESLint uses the existing legacy-config compatibility flag |
| Visual inspection | Inspected native desktop/mobile and labelled USD fixture screenshots; restrained dialog, native typography and bounded tables |

Representative commands from the bench root:

```bash
env/bin/python -m unittest erpnext.accounts.page.money_hub.test_transaction_details erpnext.accounts.page.money_hub.test_shift_balances -q
node --test apps/erpnext/erpnext/accounts/page/money_hub/test_transaction_details.cjs
node --check apps/erpnext/erpnext/accounts/page/money_hub/money_hub.js
ESLINT_USE_FLAT_CONFIG=false apps/posawesome/frontend/node_modules/.bin/eslint -c apps/erpnext/.eslintrc apps/erpnext/erpnext/accounts/page/money_hub/money_hub.js apps/erpnext/erpnext/accounts/page/money_hub/test_transaction_details.cjs
git -C apps/erpnext diff --check -- erpnext/accounts/page/money_hub
```

Private local browser harnesses/screenshots are under
`sites/radolfa.localhost/private/money-hub-m1a/`. Credentials are read from the earlier
private development setup, never printed or copied into project docs. The local
supervised Gunicorn web workers on port 8000 were gracefully reloaded to pick up Python
changes; the separate Docker service was not touched. Raw Desk Page JS/CSS is loaded
by Frappe's page asset loader; no unrelated frontend bundle build or site migration
was needed. Already-open browsers should hard-refresh.

## Limits and owner test

The inspected site's ledger contains only TJS and no staff advance/settlement/HRMS
claim examples. USD, payroll, cancellation races and field-permission variants have
fixture coverage where applicable, not a new real multi-currency/payroll posting.
Native Purchase/POS Invoice detail branches were covered by unit fixtures, not by
cash-linked examples in this site's successful native detail set. Hardware, complete
profit reconciliation and the remaining supplier/HRMS handoffs are not claimed.

Owner test: open Money Hub → movement history and choose an expense or payment. Check
its amount, company, currency, note, source link and available related rows against the
native source. Try desktop and a narrow window. A denied source must show a restricted/
unavailable state rather than exposing its contents. Do not post/cancel financial
documents just to test this read-only dialog.

## Next task: M1b

Implement a complete permission-scoped movement query and migrate the feed to it:

1. Native permitted GL/source queries before classification/aggregation; no unrestricted
   document metadata for denied sources. The 38 denied-invoice cases prove this matters.
2. Deterministic pagination and whole-filter summaries/counts. Apply operation/direction/
   search before paging; do not silently lose matches beyond 500 rows.
3. Explicit transfer event versus account-leg semantics, correct seven-day range, and
   source/party-aware classification for customer/supplier/employee activity. Do not
   infer owner money or tax solely from free text.
4. Preserve array endpoint compatibility until consumers migrate. Keep source links,
   error/loading states, current company/base/original currency scope and existing
   expense/shift contracts. Add native/fixture reconciliation beyond one page.

Do not change final profit or owner-money posting policy as an incidental feed patch.
