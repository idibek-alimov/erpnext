# Customer Hub, Customer Detail and loyalty

Status: Planned — awaiting implementation instruction. New hub/detail requested.
Parent: [roadmap](README.md). Decisions: [D14 and Q09](decisions.md).

## Purpose and existing foundation

Managers need to find a customer, see what they bought and spent, and understand their
loyalty balance. Use native Customer/Contact/Address, Sales Invoice/payment/receivable
records, Loyalty Program and Loyalty Point Entry. POS already selects customers and
uses customer-dependent pricing; do not build a second customer/points ledger.

Inspect existing loyalty hooks and downstream consumers before changing lifecycle
behavior. If public storefront/web synchronization is affected, read Web Sync guidance
and trace its contract; this plan does not authorize changes to that integration.

## Proposed experience

- Hub: simple search, customer identity/contact, spending for the selected period, last
  purchase, outstanding balance and loyalty points as useful optional columns.
- Detail: compact identity/contact, period/lifetime spending clearly distinguished,
  purchase history with invoice/product links, payments/debt, and loyalty activity.
- Explain sales after returns separately from amounts actually paid. Current debt and
  current usable points are balances, not the same thing as period purchase activity.
- Simple customer creation/editing and duplicate warnings with authorized native merge
  workflows; never silently merge customers by phone number.
- Loyalty setup: understandable earning and redemption rules, point value, expiry,
  exclusions and optional tiers, with examples based on configured native behavior.

## Rules and dependencies

- Handle anonymous/default walk-in customer separately; do not imply all walk-in sales
  belong to a known person's purchase history or loyalty account.
- State the spending definition, discounts/taxes/currency and lifetime/period scope.
  Show returns separately, exclude cancellations and preserve historical purchases.
- Loyalty must reconcile with native entries after returns, redemption, expiry,
  cancellation and amendments. Editing a program must not rewrite old transactions.
- POS customer changes affect price list, discounts, taxes, payment/invoice payload,
  receipt and offline cache. Coordinate all relevant consumers.
- Offline redemption requires an explicit double-spend policy. Preserve existing POS
  behavior until a tested replacement is authorized; do not assume real-time points
  balance while disconnected.
- Enforce customer/invoice/company and financial permissions before aggregation.
  Kiosk attendance and ordinary cashier access do not expose customer-wide financial data.

## Phases and checks

| Phase | Work | Completion gate |
| --- | --- | --- |
| C0 | Inspect native customer/loyalty and POS contracts | Q09 narrowed for selected phase; spending/balance definitions agreed |
| C1 | New hub and detail with source-linked history | Complete totals, correct debt and permitted customer scope |
| C2 | Simple customer management and loyalty setup | Native validation, duplicate handling and dated program behavior preserved |
| C3 | POS/offline integration and verification | Pricing/points/invoice/receipt/reconnect remain consistent |

Test purchases and partial returns, unpaid/part-paid invoices, cancellation, unallocated
credit, duplicate/default customer, loyalty earn/redeem/expire/reverse, pagination and
restricted records. Verify search and returning from detail retain useful filters.

Unresolved: earning rate, redemption value/limits, expiry, tiers, tax inclusion in
displayed spending, identity rules and offline redemption. These choices need not delay
the initial source inventory or a read-only customer history.
