# Quick Product Restock

The native Desk form receives an existing stock product and its color/size variants.
Its order is Product, Delivery, Quantities and Prices, Payment, then Summary. Existing
product colors appear first; additional existing attribute values are available through
Add color / Add size. Products with additional variant attributes use the native Item
workflow.

## Receiving and prices

- Choose an explicit search result or scan an exact item code/barcode. A partial product
  name never silently selects the first match. Variant codes resolve to their main product.
- Stock shown in each row belongs only to the permitted receiving warehouse in the
  selected company. After receipt is a preview of that stock plus the entered quantity.
- Quantities and prices use the stock unit, even if an item has a different purchasing
  unit. Whole-number stock units reject fractional quantities.
- Apply delivery cost / Apply retail price affects incoming rows in selected colors.
  Individual overrides are kept unless Replace individual price overrides is selected.
- Generic Standard Buying/Selling prices use company currency and the stock unit.
  Expired, future, party-specific, batch, and packaging prices are not overwritten.
- Price update only must be explicitly enabled for a zero-quantity submission. It creates
  no invoice, receipt, payment, or supplier debt.

## Accounting and cancellation

The summary shows incoming quantity, purchase total, payment to record, and remaining
supplier debt. It describes this transaction; the linked Purchase Invoice is the source
for the current outstanding balance. Opening or editing a draft posts no stock or debt.

A receipt creates a native Purchase Invoice with Update Stock. The deadline is optional:
an empty deadline sets Payment Deadline Not Agreed on the invoice and does not produce
an invented due date. Supplier terms are suggestions which can be cleared. Supplier
invoice number/date are optional, secondary fields.

An optional partial/full payment creates a native Payment Entry allocated to that invoice.
Only permitted, existing cash/bank accounts in company currency are accepted. Record a
payment here only if it has not already been recorded. Foreign-currency payments,
deductions, taxes, and additional charges use the native Purchase Invoice/Payment Entry
workflow; a changed native invoice total is rejected instead of silently differing from
the summary.

Cancellation first cancels the generated payment and then the invoice through native
permissions and validations. Published price changes and newly created variants remain;
the summary explains that cancelling does not restore old prices.

## Permissions

Lookup endpoints require Restock and Item read access. Native item, warehouse, company,
supplier, attribute, and Item Price permissions still apply. Posting requires native
Purchase Invoice create/submit permissions; paying additionally requires Payment Entry
create/submit permissions. Creating variants or changing prices requires the corresponding
native Item/Item Attribute/Item Price permissions. Stock User alone is not an accounting
authorization. Roles are not assigned automatically by this feature.

## Validation and activation

Run the backend suite on a disposable test site with standard ERPNext test fixtures:

```sh
bench --site <test-site> run-tests --module erpnext.stock.doctype.quick_product_restock.test_quick_product_restock
node --test apps/erpnext/erpnext/stock/doctype/quick_product_restock/test_quick_product_restock_ui.cjs
```

The form introduces Restock payment, currency, summary, and child stock-unit fields.
Before using this code on an existing business site, an authorized operator must sync
the Quick Product Restock and Quick Product Restock Item DocTypes using the site's normal
migration procedure, then clear its metadata/translation caches and reload Desk. Python
workers which cache controllers need their normal reload. These are application source
changes; editing the files does not perform a business-site migration or deployment.
