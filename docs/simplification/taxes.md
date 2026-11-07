# Tax setup, calculation and payment

Status: Planned — awaiting implementation instruction.
Parent: [roadmap](README.md). Early dependency for [profit](money-hub.md) and [POS](pos-management.md).

## Purpose and existing foundation

Help an authorized user understand which configuration applies, how amounts were
calculated, what is due, what has been paid and what remains. Keep simple screens
connected to native tax templates, invoices, liability accounts and payments.

Existing code includes Retail Tax Settings, Money Hub Settings and Money Hub methods
such as `get_tax_summary`, `save_tax_settings`, `pay_tax` and `tax_for_range`, plus POS
tax application. Inspect all paths to determine the authoritative configuration and
remove inconsistencies coherently when authorized. The old root tax architecture and
hardcoded source defaults are investigation material, not verified current law.

## Proposed experience

- Guided configuration: company, applicable regime, effective date, configured accounts,
  templates and payment authority, with advanced fields progressively disclosed.
- Obligation view by period: calculation basis, applicable dated rules, adjustments,
  recorded/recognized amount, paid amount and remaining liability.
- Explain calculation using source transactions and original currencies/base amounts.
- Record payment through a permitted native workflow and retain proof/reference.
  A recorded payment is distinct from filing a return or transmitting money to a bank.
- Deadline/reminder view only after actual obligation dates are established.

## Rules and unresolved choices

- Q10 must establish jurisdiction, legal entity/regime, registration and effective dates.
  Research current authoritative jurisdiction-specific sources before implementing rates,
  thresholds, deadlines or payroll-related obligations. No rate in this plan is approved.
- Changes need effective dates/history. Do not apply today's settings retroactively to
  historical invoices or create side effects from opening a summary.
- Distinguish collected sales tax, recoverable input tax, tax expenses, tax liabilities
  and payments. Do not subtract a tax twice from profit or equate every tax payment to
  a new expense. Reconcile recognized amounts and settlement timing with native books.
- Decide treatment of returns, corrections, foreign currency, period closing and
  amendments; surface missing configuration/data instead of returning a false zero.
- Do not provision accounts or mutate POS Profiles from read-only reporting endpoints.
  Setup actions need explicit permissions and a reviewable native change.
- Manager/admin financial visibility does not automatically grant tax-setting/payment
  authority. Keep permitted company and record scope on server queries and actions.

## Phases and completion checks

| Phase | Work | Completion gate |
| --- | --- | --- |
| T0, early | Inventory current config/calculation paths and business obligations | Q10 answered; dated sources/configuration documented |
| T1 | Simplify setup and establish single authoritative configuration | Native templates/POS defaults agree; old settings mapped without silent conversion |
| T2 | Obligation/calculation history and native payment workflow | Due/paid/remaining reconcile, retries/cancellations correct |
| T3 | Connect profit, home and reminders | Same verified period amounts; incomplete obligations visibly identified |

Test tax-inclusive/exclusive invoices as applicable, discounts, returns, cancelled and
amended invoices/payments, effective-date changes, USD/base amounts, partial payment,
missing setup, cold install and denied roles. Reconcile against native accounts and
approved examples; do not submit real tax payments or filings during verification.

The full tax screen may follow Customer Hub, but T0 must start with Money Hub discovery
and before the POS setup guide. Profit can show a scoped provisional result until tax
coverage is verified; it must not silently treat unknown tax as zero.
