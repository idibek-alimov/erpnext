"""Historical valuation, source permissions and date/billing reconciliation."""
from inspect import unwrap
from unittest.mock import patch

import frappe
from frappe.utils import add_days, today

from erpnext.stock.retail_costs import HistoricalCostLookup, invoice_rows
from .test_business_results_native import TestBusinessResultsNative


class TestInvoiceCostsNative(TestBusinessResultsNative):
	def setUp(self):
		super().setUp()
		frappe.clear_document_cache("Company", self.company)
		frappe.local.enable_perpetual_inventory = {}

	def stock_setup(self, currency="TJS"):
		self.seed = self.invoice(currency=currency)
		self.seed.cancel()
		inventory = self.book_account("Asset", "Stock")
		frappe.db.set_value("Company", self.company, {"enable_perpetual_inventory": 1, "default_inventory_account": inventory})
		frappe.clear_document_cache("Company", self.company)
		frappe.local.enable_perpetual_inventory = {}
		self.addCleanup(lambda: setattr(frappe.local, "enable_perpetual_inventory", {}))
		self.warehouse = frappe.get_doc(dict(doctype="Warehouse", warehouse_name="_Test Costs " + self.suffix,
			company=self.company, account=inventory, is_group=0)).insert().name
		item = frappe.get_doc("Item", self.item)
		item.is_stock_item = 1
		item.valuation_method = "FIFO"
		item.save()
		if not frappe.db.exists("Stock Entry Type", "Material Receipt"):
			frappe.get_doc(dict(doctype="Stock Entry Type", name="Material Receipt", purpose="Material Receipt", is_standard=1)).insert()
		from erpnext.stock.doctype.stock_entry.stock_entry_utils import make_stock_entry
		make_stock_entry(item_code=self.item, qty=20, target=self.warehouse, rate=40, company=self.company,
			posting_date=add_days(today(), -20), expense_account=self.expense, cost_center=self.cost_center)

	def sale(self, qty=2, date=None, update_stock=1, delivery=None, conversion=1):
		doc = frappe.copy_doc(self.seed)
		doc.docstatus = 0
		doc.set_posting_time = 1
		doc.posting_date = date or today()
		doc.posting_time = "12:00:00"
		doc.due_date = doc.posting_date
		doc.update_stock = update_stock
		doc.items[0].qty = qty
		doc.items[0].warehouse = self.warehouse
		if conversion != 1:
			doc.items[0].uom = "_Test Cost Box " + self.suffix
			doc.items[0].conversion_factor = conversion
		if delivery:
			doc.items[0].delivery_note = delivery.name
			doc.items[0].dn_detail = delivery.items[0].name
		doc.insert()
		doc.submit()
		return doc

	def delivery(self, qty=5, date=None, invoice=None):
		doc = frappe.get_doc(dict(doctype="Delivery Note", company=self.company, customer=self.customer,
			posting_date=date or today(), posting_time="13:00:00", set_posting_time=1,
			currency="TJS", conversion_rate=1, selling_price_list=self.selling, price_list_currency="TJS", plc_conversion_rate=1,
			items=[dict(item_code=self.item, qty=qty, rate=100, warehouse=self.warehouse,
				income_account=self.income, expense_account=self.cogs, cost_center=self.cost_center,
				against_sales_invoice=invoice.name if invoice else None, si_detail=invoice.items[0].name if invoice else None)]))
		doc.insert()
		doc.submit()
		return doc

	def test_delivery_before_invoice_partial_billing_is_not_full_delivery_cost(self):
		self.stock_setup()
		delivery = self.delivery(date=add_days(today(), -2))
		self.sale(qty=2, update_stock=0, delivery=delivery)
		out = self.read()
		self.assertEqual(out["ledger"]["cogs"], 0)
		self.assertEqual((out["reconciliation"]["invoice_date_cogs"], out["reconciliation"]["invoice_date_gross_profit"]), (80, 120))
		self.sale(qty=3, update_stock=0, delivery=delivery)
		self.assertEqual(self.read()["reconciliation"]["invoice_date_cogs"], 200)

	def test_invoice_before_delivery_unknown_until_linked_posted_fulfilment(self):
		self.stock_setup()
		invoice = self.sale(update_stock=0, date=add_days(today(), -2))
		self.assertIsNone(self.read(invoice.posting_date)["reconciliation"]["invoice_date_cogs"])
		self.delivery(qty=2, invoice=invoice)
		out = self.read(invoice.posting_date)
		self.assertEqual(out["ledger"]["cogs"], 0)
		self.assertEqual(out["reconciliation"]["invoice_date_cogs"], 80)
		self.assertEqual(out["invoice_costs"]["as_of"], today())

	def test_partial_fulfilment_does_not_fabricate_full_invoice_cost(self):
		self.stock_setup()
		invoice = self.sale(update_stock=0)
		self.delivery(qty=1, invoice=invoice)
		self.assertIsNone(self.read()["reconciliation"]["invoice_date_cogs"])
		self.assertEqual(self.read()["invoice_costs"]["unknown_rows"], 1)

	def test_later_period_return_reverses_original_cost_without_new_stock_posting(self):
		self.stock_setup()
		invoice = self.sale(date=add_days(today(), -2))
		from erpnext.accounts.doctype.sales_invoice.sales_invoice import make_sales_return
		doc = make_sales_return(invoice.name)
		doc.posting_date = today()
		doc.update_stock = 0
		doc.items[0].qty = -1
		doc.insert()
		doc.submit()
		self.assertEqual(self.read()["reconciliation"]["invoice_date_cogs"], -40)
		self.assertEqual(self.read()["reconciliation"]["invoice_date_gross_profit"], -60)

	def test_stock_uom_conversion_and_usd_base_revenue(self):
		self.stock_setup(currency="USD")
		uom = "_Test Cost Box " + self.suffix
		frappe.get_doc(dict(doctype="UOM", uom_name=uom)).insert()
		item = frappe.get_doc("Item", self.item)
		item.append("uoms", dict(uom=uom, conversion_factor=3))
		item.save()
		self.sale(qty=2, conversion=3)
		out = self.read()
		self.assertEqual((out["invoice_sales"]["net_sales"], out["reconciliation"]["invoice_date_cogs"]), (2200, 240))

	def test_warehouse_and_stock_ledger_restrictions_keep_cost_unknown(self):
		self.stock_setup()
		self.sale()
		user = self.user("Retail Manager")
		other = frappe.get_doc(dict(doctype="Warehouse", warehouse_name="_Test Restricted " + self.suffix,
			company=self.company, is_group=0)).insert().name
		frappe.get_doc(dict(doctype="User Permission", user=user, allow="Warehouse", for_value=other,
			apply_to_all_doctypes=0, applicable_for="Warehouse")).insert()
		frappe.set_user(user)
		self.assertIsNone(self.read()["reconciliation"]["invoice_date_cogs"])
		frappe.set_user("Administrator")
		original = frappe.has_permission
		with patch("frappe.has_permission", side_effect=lambda kind, *a, **kw: False if kind == "Stock Ledger Entry" else original(kind, *a, **kw)):
			self.assertIsNone(self.read()["reconciliation"]["invoice_date_cogs"])

	def test_native_gross_profit_report_and_export_share_source_gate(self):
		from erpnext.accounts.report.gross_profit.gross_profit import execute
		self.stock_setup()
		self.sale()
		frappe.set_user(self.user("Retail Manager"))
		filters = frappe._dict(company=self.company, from_date=today(), to_date=today(), group_by="Item Code")
		columns, data = execute(filters)[:2]
		self.assertTrue(columns)
		profit_column = next(index for index, column in enumerate(columns) if column.get("fieldname") == "gross_profit" or column.get("label") == "Gross Profit")
		self.assertEqual(data[0][profit_column], 120)
		from frappe.desk import query_report
		# Keep the native export/report pipeline; only bypass the replica/read-only
		# decorator so this connection can see its uncommitted disposable fixtures.
		with patch.object(query_report, "run", side_effect=lambda report_name, filters, **kw: query_report._run(report_name=report_name, filters=filters, **kw, ignore_prepared_report=True)):
			for kind, extension in (("CSV", "csv"), ("Excel", "xlsx")):
				params = frappe._dict(report_name="Gross Profit", file_format_type=kind, filters=filters, custom_columns="[]", visible_idx=[])
				_name, ext, content = query_report._export_query(params, frappe._dict(), populate_response=False)
				self.assertEqual(ext, extension)
				self.assertTrue(content)
				if kind == "CSV":
					self.assertIn("120", str(content))
				else:
					self.assertEqual(content[:2], b"PK")
		original = frappe.has_permission
		with patch("frappe.has_permission", side_effect=lambda kind, *a, **kw: False if kind == "Stock Ledger Entry" else original(kind, *a, **kw)):
			with self.assertRaises(frappe.ValidationError):
				execute(filters)

	def test_invoice_row_restriction_precedes_joined_query_and_cost_aggregation(self):
		self.stock_setup()
		invoice = self.sale()
		user = self.user("Retail Manager")
		frappe.get_doc(dict(doctype="User Permission", user=user, allow="Sales Invoice", for_value=invoice.name,
			apply_to_all_doctypes=0, applicable_for="Sales Invoice")).insert()
		self.sale(qty=1)
		frappe.set_user(user)
		rows, _headers = invoice_rows(self.company, today(), today())
		self.assertEqual({row.parent for row in rows}, {invoice.name})
		from erpnext.accounts.report.gross_profit.gross_profit import GrossProfitGenerator
		query = GrossProfitGenerator.__new__(GrossProfitGenerator)
		query.filters = frappe._dict(company=self.company, from_date=today(), to_date=today())
		self.assertEqual({row.parent for row in query.prepare_invoice_query().run(as_dict=True)}, {invoice.name})

	def test_bundle_uses_posted_component_cost_and_not_parent_purchase_price(self):
		self.stock_setup()
		bundle = frappe.get_doc(dict(doctype="Item", item_code="_Test Bundle " + self.suffix,
			item_name="Cost bundle", is_stock_item=0, item_group=self.item_group, stock_uom="Nos")).insert()
		frappe.get_doc(dict(doctype="Product Bundle", new_item_code=bundle.name,
			items=[dict(item_code=self.item, qty=2)])).insert()
		doc = frappe.copy_doc(self.seed)
		doc.docstatus = 0
		doc.update_stock = 1
		doc.posting_date = today()
		doc.due_date = today()
		doc.items[0].item_code = bundle.name
		doc.items[0].warehouse = self.warehouse
		doc.items[0].qty = 1
		doc.items[0].rate = 150
		doc.insert()
		doc.submit()
		self.assertTrue(doc.packed_items)
		rows, _ = invoice_rows(self.company, today(), today())
		lookup = HistoricalCostLookup(rows, self.company)
		self.assertEqual(self.read()["reconciliation"]["invoice_date_cogs"], 80, repr((dict(lookup.stock), dict(lookup.packed))))

	def test_nonstock_uses_dated_net_purchase_cost_and_denied_purchase_is_unknown(self):
		invoice = self.invoice()
		self.assertIsNone(self.read()["reconciliation"]["invoice_date_cogs"])
		group = frappe.get_doc(dict(doctype="Supplier Group", supplier_group_name="_Test Cost Group " + self.suffix,
			is_group=0)).insert().name
		supplier = frappe.get_doc(dict(doctype="Supplier", supplier_name="_Test Cost Supplier " + self.suffix,
			supplier_group=group, supplier_type="Company")).insert().name
		buying = frappe.get_doc(dict(doctype="Price List", price_list_name="_Test Cost Buying " + self.suffix,
			currency="TJS", buying=1, enabled=1)).insert().name
		purchase = frappe.get_doc(dict(doctype="Purchase Invoice", company=self.company, supplier=supplier,
			posting_date=add_days(today(), -1), posting_time="09:00:00", set_posting_time=1, due_date=today(), currency="TJS", conversion_rate=1,
			buying_price_list=buying, price_list_currency="TJS", plc_conversion_rate=1,
			items=[dict(item_code=self.item, qty=2, price_list_rate=75, rate=60, discount_percentage=20,
				expense_account=self.expense, cost_center=self.cost_center)]))
		purchase.insert()
		purchase.submit()
		self.assertEqual(purchase.items[0].base_net_amount / purchase.items[0].stock_qty, 60)
		self.assertEqual(self.read()["reconciliation"]["invoice_date_cogs"], 60)
		original = frappe.has_permission
		with patch("frappe.has_permission", side_effect=lambda kind, *a, **kw: False if kind == "Purchase Invoice" else original(kind, *a, **kw)):
			self.assertIsNone(self.read()["reconciliation"]["invoice_date_cogs"])
