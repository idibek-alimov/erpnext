# Quick Product Intake

Quick Product Intake creates a new product or variant model and its standard buying
and selling prices. Positive incoming quantities create a submitted Purchase Invoice
with stock update. All-zero quantities create only products and prices; no invoice,
payment, stock movement, or supplier debt is posted. Every generated product keeps a
company-specific default supplier, including variants with zero incoming quantity.

Receipt date, supplier bill date/number, and payment deadline are separate. Supplier
payment terms can suggest a deadline; the user can clear it. A blank deadline is an
explicit open-ended agreement, represented by `payment_deadline_not_agreed` on the
native Purchase Invoice. Such an invoice has no due date or payment schedule. Its
outstanding amount remains payable, without an overdue status or due-date ageing.
Normal invoices and existing recorded deadlines keep their native behavior.

An optional payment amount, date, and existing company-currency cash/bank account
create a native Payment Entry allocated to the new invoice. Enter only payments not
already recorded; existing advances/payments use native reconciliation. Foreign
currency, deductions, and discounts use the full payment workflow. Cancelling an
intake cancels its generated payment before its invoice, subject to native permissions
and validations. Products and configured prices remain available after cancellation.

Receiving requires native Item, Item Price, and Purchase Invoice creation/submission
permissions; recording a payment also requires Payment Entry permissions. The standard
price lists must be enabled and use the selected company's currency. Supplied costs
are not replaced by automatic buying pricing rules. Stock value and gross profit keep
ERPNext's stock valuation and historical-cost sources, independently of payment.

## Applying the schema

The changed DocTypes are Purchase Invoice, Quick Product Intake, and Quick Product
Intake Item. With explicit operator authorization, reload those DocTypes (or run the
normal site migration), clear the site's cache, and restart its Python web workers.
Do not restart workers against an old schema: supplier queries use the new invoice
flag. No data patch reclassifies existing invoices; review their actual payment
agreements and recorded payments separately through native document workflows.

## Verification

On a disposable test site with ERPNext fixtures:

```sh
bench --site <test-site> run-tests --module erpnext.stock.doctype.quick_product_intake.test_quick_product_intake
node --test apps/erpnext/erpnext/stock/doctype/quick_product_intake/test_quick_product_intake_ui.cjs
```

The intake tests cover explicit/absent deadlines, nightly status updates, native
due-date ageing, supplier debt and stock reconciliation, zero-stock supplier links,
partial/full payments, cancellation, permission denial, currency consistency, and
invalid input. Also run the Supplier Detail and Supplier Hub loading tests. Inspect
Russian/Tajik forms on desktop/mobile, including native horizontal grid swiping,
row editing, the zero-stock message, and the pre-submission payment summary.
