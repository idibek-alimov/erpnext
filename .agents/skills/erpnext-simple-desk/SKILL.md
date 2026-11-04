---
name: erpnext-simple-desk
description: Simplify or review this project's internal ERPNext Desk screens for everyday business users, following the owner-approved Product Catalog and Product Detail style. Use for related hubs, lists, record views, filters, and business summaries; not for the public storefront or unrelated application work.
---

# ERPNext Simple Desk

Turn the user's business task into a calm, usable native Desk experience. Preserve
ERPNext's accounting, stock, permission, and audit behavior beneath the simplified UI.

## Establish the scope

Read the applicable `AGENTS.md`. Determine whether the request is an interview,
review, implementation, or diagnosis; the skill does not expand that authorization.
Inspect the target page, backend methods, native documents, and current reference pages.
Identify its audience, the first question to answer, frequent action, and key exceptions.
Reuse existing owner decisions. Ask focused questions only where an unresolved choice
would materially change behavior or calculation; otherwise proceed within the request.

Read [the design standard](references/design-standard.md) for UI work.
Read [the product rules](references/product-rules.md) when the task includes inventory,
sales, profit, product variants, or product-to-invoice navigation. Those defaults belong
to the product experience; do not impose its KPI set on payroll, suppliers, or expenses.

## Design and implement

Use the current catalog and detail code as implementation references, not immutable
templates or proof that every underlying rule is correct. Prioritize identity, relevant
summary figures, clear scope, then supporting tables/detail. Make advanced information
available progressively and retain links to native records.

Use the local Frappe implementation and established page patterns. Reuse the app's
controls, formatting, translations, and theme tokens. Keep CSS isolated to the screen.
Include responsive and keyboard behavior and explicit loading, empty, failure/retry,
missing-data, and permission-limited states. Preserve useful navigation/filter state
and prevent late responses from rendering obsolete scope.

For financial summaries, trace each figure to its source and permissions before showing
it. Batch related data access and share business rules across list/detail paths where
practical. Do not change documents merely by opening a page or bypass native validations
to make a simplified action work.

## Verify and hand off

Match verification to the changed behavior. Financial/permission changes need meaningful
edge cases and source reconciliation; a spacing adjustment does not need a new test suite.
Compare totals under identical company, warehouse, date, and variant scopes. Check
pagination independence, returns/cancellations, UOM/currency, and missing data when relevant.

For visible changes, render desktop and mobile, inspect important Russian/Tajik labels,
and exercise the affected filters/actions/states. Check console errors and page overflow.
Label fixture previews as fixtures; do not claim authenticated or live-site verification
when only mocked/local data was used. Run relevant formatting, syntax, and diff checks.

Review usability and data correctness as distinct concerns. If subagent review is
authorized and helpful, `erpnext_ui_reviewer` and `erpnext_data_reviewer` provide focused
roles. Otherwise perform those checks directly; do not enable delegation or alter session
settings merely to apply the skill.

Report the result, evidence, and practical limitations concisely. Discover actual runtime
names before cache/restart operations, and do not claim an unavailable privileged action
succeeded. Record new explicit owner preferences in the relevant reference file so later
work uses the same decisions.
