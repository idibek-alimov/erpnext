# Money Hub M0 — source and calculation baseline

Date: 2026-11-07. Status: M0 source audit complete; [M1a implemented and checked locally](money-hub-m1a.md); M1b next.
Parent: [Money Hub plan](money-hub.md). Current pointer: [root tracker](../../../../ERP_SIMPLIFICATION.md).

## Authorization, source context and scope

The owner said “start the implementation” after approving the root continuation
workflow. Work starts with M0 and proceeds to a bounded M1 change. No full accounting,
payroll, tax or role rewrite is included in this first increment.

Inspected working trees: ERPNext HEAD `a25993f6b47d36d6009d6391294f164641fcbac9`,
POS Awesome HEAD `2721803395b8013dbb1c735e1f7b4d5c8c24aff6`, HRMS HEAD
`8f833dafb0a4b554f0714ef32a2974613632163e`. ERPNext/POS have substantial pre-existing
uncommitted expense/shift changes; HRMS was clean. Those changes are part of the inspected
baseline and are preserved. Source observations below apply to those working trees,
not only committed HEADs. No claim of fresh Windows, printer or complete accounting verification.

## Source map

| Business event / figure | Existing authoritative records and current consumers | Finding / treatment |
| --- | --- | --- |
| Current cash/bank balance | Money Wallet → Account → native `get_balance_on`; `money_hub.get_money_hub_data` | Base/company currency and original foreign account balance separated; aliases counted once in balance summary |
| Money activity/history | GL Entry cash/bank legs, `get_money_feed`, `_feed_classify`; Vue closing uses its own established shift contract | Ledger/account activity, not profit; native source permissions and complete pagination need strengthening |
| Sales / returns | Sales Invoice, POS Invoice, invoice payment/GL records, closing/consolidation | Home sums Sales Invoice; verify consolidated versus unmerged POS and returns before treating it as all sales |
| Product cost / gross profit | Stock valuation and historical sale cost; Product Detail `ProductCostLookup` reuses GrossProfitGenerator | Home instead sums `qty * incoming_rate`; delivery, UOM, nonstock/bundle and return paths need reconciliation |
| Supplier invoice / payment | Purchase Invoice payable, Payment Entry allocations, Supplier Hub native queries | Payment settles liability; it must not expense stock a second time. USD needs original/account/base amounts |
| Paid ordinary expense | Quick Expense → native JE/legacy PE; shared `expense_services.commands/history` | Shared history supports native permission-scoped adapters; generated backing voucher is evidence, not another expense |
| Legacy POS expense / deposit | POS Cash Movement via registered history adapter, native JE and shift records | Keep prior source identity; deposit is a transfer. Money classifier currently lacks full legacy event provenance |
| Other operating costs | Native Purchase Invoice expense rows, JE, HRMS approved Expense Claim and payroll postings | Home `_expenses` reads only Quick Expense, so it is not a complete cost ledger |
| Employee spending advance / reimbursement | HRMS Employee Advance, Expense Claim and EmployeePaymentEntry override | Advance balance and settlement are distinct from expense recognition; no records on inspected development site |
| Custom salary advance / settlement | Staff Advance/Staff Settlement → employee PE or fallback JE | Existing broad fallbacks/early Paid state and allocation scope need S0 audit; no sample records on inspected site |
| Owner money in/out | Native JE/PE and configured equity/loan/receivable accounts | No explicit trusted owner-money contract discovered in Money Hub; do not infer treatment from remarks |
| Till/safe transfer | Payment Entry Internal Transfer and account GL legs | Existing all-wallet feed lists both legs; incoming/outgoing sums inflate activity if read as external receipts/spending |
| Taxes | Retail Tax Settings controls templates/POS application; separate Money Hub Settings controls Hub/Home estimate/payment helpers | Two independent configuration/calculation paths; dated rules and actual obligations unresolved (T0) |
| Profit permissions | `setup/retail_security.py:can_see_financials`, Home APIs | Retail Manager still excluded; owner target now permits managers. No runtime grant made in M0 |

## Confirmed gaps, in priority order

1. **Transaction-detail access and currency:** public authenticated detail method accepts
   arbitrary DocType/name, loads the document without checking its read permission,
   company or cash-account participation, and labels original amounts with the selected
   company's currency. UI omits company in the request, assumes posted status and leaves
   a spinner on failure. Several dynamic strings are interpolated unescaped. Fix first.
2. **History completeness:** SQL limits to 500 GL rows before operation/direction/search
   filtering. Client summaries sum only returned rows. Older matches are invisible;
   response has no complete count/summary or pagination contract. Ordering lacks a final
   unique tie-breaker; “7 days” currently includes today plus seven earlier dates.
3. **Event classification:** every Pay PE is labelled supplier payment and every Receive
   PE customer payment, regardless of party type. Journal tax classification uses remark
   substrings; owner money and employee pay are not reliable types. Internal transfers
   produce two visible legs, and aliases choose a last-wallet label rather than provenance.
4. **Query scope:** feed starts with permitted wallets/accounts and GL type permission
   but executes raw GL SQL and unrestricted metadata lookups. Native row/field queries
   must scope ledger and source metadata before aggregates and details. Do not rely on
   the browser or account list alone as proof of source-document permission.
5. **Profit completeness:** Home cost calculation differs from approved product historical
   cost service; Quick Expense-only costs and submitted Staff Settlement-only payroll miss
   native expenses/accruals. Tax exceptions become zero; missing setup also gives zero.
   Home raw SQL does not establish native invoice/warehouse row scope. Do not label a
   redesigned result final net profit until M3/M4 reconciliation resolves these issues.
6. **Financial writes:** wallet/create/edit, transfer and tax helpers broadly use elevated
   writes/explicit commits. Transfer fixes both rates at 1 and has no stable request key.
   Native document checks do not establish intended manager write authority. M2 must
   address permissions, alias accounts, currency, duplicate requests and outcomes coherently.
7. **Other module boundaries:** Staff Hub's initial employee SQL lacks a company condition
   despite receiving company, and custom settlement paths need review; Home shift alerts
   read native POS Closing Entry rather than the new POS Awesome review lifecycle. Track
   under S0/H0 instead of including their totals as verified Money Hub inputs.

## Evidence actually collected in M0

- Source/controller/query review of Money Hub, Home, approved product-cost adapter,
  shared expense services/contracts, staff advance/settlement and HRMS payment ownership.
- Existing five database-free `test_shift_balances` tests rerun: **5 passed**. They
  cover base/original currency, shared accounts, wallet/account scope and read-only behavior;
  they do not prove native full-feed permissions or final profit.
- Local `radolfa.localhost:8000` ping returned 200. Direct **read-only SQL transaction**,
  rolled back, inspected aggregate record coverage without printing people/documents.
  Counts: 511 GL rows, 23 Payment Entries, 32 JEs, 98 Sales Invoices, 2 POS Invoices,
  8 Purchase Invoices, 11 Quick Expenses and 2 POS Shift Reviews. There were no Staff
  Advance, Staff Settlement, Expense Claim or Employee Advance records. Ledger currency
  coverage was TJS only. Thus existing data cannot validate payroll or USD cases.
- Earlier expense/shift Phase 9 and development reports remain historical evidence.
  Owner acceptance, physical devices and full HRMS/supplier handoffs are not newly passed.

## Bounded first implementation: M1a transaction details

Implement secure, source-linked, currency-correct read-only details before replacing
the complete feed. Keep the existing public method name and established source fields,
add explicit company/document/account currencies and scoped ledger movements, and use
a compact native dialog with errors/retry and real authorized source links.

Acceptance checks:

1. Only supported financial voucher types; reject arbitrary DocTypes before loading them.
2. Require current native wallet/company/account/ledger scope, source-document read
   permission, same company and a visible noncancelled cash/bank GL leg.
3. Apply source field-level read permissions. Do not expose denied referenced documents
   or restricted account rows. No provisioning, posting or commit while reading.
4. Original invoice/payment/account amounts retain their own currency; ledger/base values
   have company currency. Never display USD values as TJS or infer conversion at rate 1.
5. Rendering uses authorized server amounts, correct posted/cancelled handling, escaped
   dynamic text, keyboard-accessible source links, bounded tables and retry/error states.
6. Test allowed and denied paths, currencies, stale rows, references, response races,
   RU/TG desktop/mobile rendering. Distinguish fixtures from actual-site checks.

Next after M1a: **M1b complete movement query** with native permission-scoped sources,
deterministic server pagination, full matching summaries and typed source classification.
Keep legacy array method compatibility until all consumers migrate. Transfers need an
explicit event/leg contract; do not silently change their meaning through a row limit.

## Decisions needed later, not blockers to M1a

Q01: use existing native role/company/account/source permissions now; future manager
profit grant remains a separate coordinated change. Q02: owner-money posting mapping
requires company treatment/configuration before M2. Q03: payroll/rent/tax recognition
and final profit labels need reconciliation before M3/M4. Q04: first-store views use
company scope; no unverified store allocation of shared records. Existing confirmed
TJS/USD requirements require preserving currencies, not guessing legal/account mappings.
