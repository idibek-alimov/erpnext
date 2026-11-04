# ERPNext project guidance

## Purpose and approved direction

Simplify ERPNext for everyday business users while retaining its native documents,
validations, permissions, and audit trail. Product Catalog and Product Detail are the
owner-approved examples of the intended UI. For owner/manager screens, surface the
business question first: stock, sales, gross profit, inventory value, or exceptions.
Adapt other modules to their own users and workflows rather than copying product KPIs.

## UI defaults

- Use Frappe Desk page structure, native controls, typography, and theme variables.
- Favor compact headers, restrained summary figures, readable tables, and clear filters.
  Avoid e-commerce presentation, large product photos, decorative emojis, and badge clutter.
- Keep frequent actions prominent and occasional details behind menus, tabs, or links.
- Preserve Russian and Tajik wording, keyboard access, mobile usability, and useful
  loading, empty, error/retry, missing-data, and restricted-access states.
- Scope CSS to the page and escape dynamic content. Ignore obsolete search/filter responses.

For UI improvement or review, read `.agents/skills/erpnext-simple-desk/SKILL.md` in full.
Its `references/design-standard.md` contains the agreed visual and interaction defaults.
Read `references/product-rules.md` within that skill when stock, sales, or profit are involved.

## Business correctness

- Product sales default to this month; warehouse scope defaults to all permitted
  warehouses in the selected company. Current inventory is independent of sales dates.
- Current stock value uses ERPNext inventory valuation; gross profit uses historical
  product costs. Do not silently substitute today's buying price or call gross profit net profit.
- Account for returns, cancellations, units, currency, company, warehouses, and variants.
  Reconcile summaries, list rows, detail views, and native source documents at the same scope.
- Catalog summaries cover all matching results, not just the visible page. Missing
  sizes/colors can require a warning even when total model stock is healthy.
- Enforce server-side and row-level permissions, including invoices and warehouses.
  Reading Item alone must not expose unrestricted sales or financial data.
- Read-only screens must not mutate business records. Keep writes on authorized native
  document workflows and batch queries/cost lookups instead of using one detail call per row.

## Working and verification

This directory is the ERPNext Git root; the parent bench need not be a Git repository.
Check this repository's status and preserve unrelated edits. Use the customized origin,
not an official upstream fork. Commit/push/deployment requires task authorization.

Inspect the current implementation before proposing changes. Interviews and reviews
remain advisory; implement when asked. Reuse settled preferences and ask only material
unresolved business questions. Do not add repeated approval steps for routine authorized work.

Reference paths: `erpnext/stock/page/product_catalog/` and
`erpnext/stock/page/product_detail/`. Use the bench's existing `env/` and frontend tools;
discover current site/service/asset names rather than hardcoding historical examples.

Verify risky calculations and permissions with meaningful tests and scoped reconciliation.
For UI changes, inspect desktop/mobile rendering and relevant Russian/Tajik labels.
Distinguish local fixtures from checks against the authenticated running site.
Report completed checks and any remaining restart/operator action accurately.

Optional `.codex/agents/` roles support UI and data review when delegation is permitted
and useful. Their presence alone does not authorize spawning agents or extra side effects.
Keep stable product decisions in the skill references and update them after explicit owner
feedback; avoid distributing duplicated, drifting copies of those decisions.
