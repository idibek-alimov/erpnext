"""Native financial and permission reconciliation on a disposable allow_tests site."""
import unittest
from uuid import uuid4
from inspect import unwrap
from unittest.mock import patch

import frappe
from frappe.tests.utils import FrappeTestCase
from frappe.utils import add_days, get_first_day, today

from erpnext.setup.retail_security import can_see_financials

from . import business_results as results, money_hub, owner_money
from .test_money_commands_native import TestMoneyCommandsNative


class TestBusinessResultsNative(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		if not getattr(frappe.local, "site", None) or not frappe.conf.get("allow_tests"):
			raise unittest.SkipTest("A disposable allow_tests site is required")
		from erpnext.accounts.expense_services.native_test_support import ensure_test_company
		ensure_test_company()
		for name, abbr in (("_Test Money TJS", "MHT"), ("_Test Money Other", "MHO")):
			if not frappe.db.exists("Company", name):
				frappe.get_doc(dict(doctype="Company", company_name=name, abbr=abbr, country="Tajikistan",
					default_currency="TJS", chart_of_accounts="Standard", create_chart_of_accounts_based_on="Standard Template",
					enable_perpetual_inventory=0)).insert()
		frappe.db.commit()
		super().setUpClass()
	account = TestMoneyCommandsNative.account
	wallet = TestMoneyCommandsNative.wallet
	def user(self, *roles):
		frappe.set_user("Administrator")
		email = "results-" + uuid4().hex + "@example.invalid"
		frappe.get_doc(dict(doctype="User", email=email, first_name="Native Results Test", send_welcome_email=0,
			roles=[dict(role=role) for role in roles])).insert()
		return email

	def setUp(self):
		TestMoneyCommandsNative.setUp(self)
		self.income = self.book_account("Income", "Income Account")
		self.expense = self.book_account("Expense", "Expense Account")
		self.cogs = self.book_account("Expense", "Cost of Goods Sold")
		self.liability = self.book_account("Liability", "")
		self.asset = self.book_account("Asset", "")
		self.cost_center = frappe.get_doc("Company", self.company).cost_center

	def book_account(self, root, kind):
		parent = frappe.db.get_value("Account", dict(company=self.company, root_type=root,
			is_group=1, parent_account=["is", "not set"]), "name")
		return frappe.get_doc(dict(doctype="Account", account_name=f"_Test Results {root} {kind} {self.suffix}",
			company=self.company, parent_account=parent, account_type=kind or None, is_group=0)).insert().name

	def post(self, debit, credit, amount, date=None, **fields):
		doc = frappe.get_doc(dict(doctype="Journal Entry", company=self.company,
			posting_date=date or today(), accounts=[dict(account=debit, debit_in_account_currency=amount, cost_center=self.cost_center),
				dict(account=credit, credit_in_account_currency=amount, cost_center=self.cost_center)], **fields))
		doc.insert()
		doc.submit()
		return doc

	def read(self, date=None):
		return unwrap(money_hub.get_business_results)(company=self.company, from_date=date or today(), to_date=date or today())

	def test_native_pnl_income_expenses_cogs_and_source_precedence(self):
		self.post(self.cash, self.income, 1000)
		self.post(self.cogs, self.asset, 400)
		self.post(self.expense, self.liability, 100)
		self.post(self.liability, self.cash, 100)
		out = self.read()
		self.assertEqual((out["ledger"]["income"], out["ledger"]["cogs"], out["ledger"]["other_expenses"], out["ledger"]["result"]), (1000, 400, 100, 500))
		from erpnext.accounts.report.profit_and_loss_statement.profit_and_loss_statement import execute
		filters = frappe._dict(company=self.company, filter_based_on="Date Range", period_start_date=today(),
			period_end_date=today(), periodicity="Monthly", accumulated_values=0, include_default_book_entries=1)
		native = execute(filters)
		self.assertEqual(native[4][-1]["value"], out["ledger"]["result"])
		self.assertFalse(out["completeness"]["final_profit"])
		self.assertIsNone(out["reconciliation"]["invoice_date_gross_profit"])

	def test_financing_transfers_advances_and_stock_purchases_do_not_expense_cash(self):
		owner_money.configure(self.company, create_accounts=True)
		for operation in ("contribution", "withdrawal", "loan_received", "loan_repayment"):
			owner_money.record(self.company, operation, self.source, 100, self.suffix + operation)
		self.post(self.bank, self.cash, 50)
		self.post(self.asset, self.liability, 200)
		self.post(self.liability, self.cash, 100)
		self.post(self.asset, self.cash, 30)
		self.assertEqual(self.read()["ledger"]["result"], 0)

	def test_native_cancellation_and_previous_period(self):
		old = add_days(get_first_day(today()), -1)
		self.post(self.expense, self.cash, 45, date=old)
		doc = self.post(self.expense, self.cash, 20)
		self.assertEqual(self.read()["ledger"]["total_expenses"], 20)
		doc.cancel()
		self.assertEqual(self.read()["ledger"]["total_expenses"], 0)
		self.assertEqual(self.read(old)["ledger"]["total_expenses"], 45)

	def test_native_foreign_expense_keeps_booked_base_and_original(self):
		foreign_expense = frappe.get_doc("Account", self.expense)
		foreign_expense.account_currency = "USD"
		foreign_expense.save()
		doc = frappe.get_doc(dict(doctype="Journal Entry", company=self.company, posting_date=today(), multi_currency=1,
			accounts=[dict(account=self.expense, account_currency="USD", exchange_rate=11,
				debit_in_account_currency=10, cost_center=self.cost_center),
				dict(account=self.cash, exchange_rate=1, credit_in_account_currency=110)]))
		doc.flags.ignore_exchange_rate = True
		doc.insert()
		doc.submit()
		out = self.read()
		self.assertEqual(out["ledger"]["total_expenses"], 110)
		row = next(row for row in out["ledger"]["accounts"] if row["account"] == self.expense)
		self.assertEqual((row["base_amount"], row["account_amount"], row["account_currency"]), (110, 10, "USD"))

	def test_default_finance_book_excludes_alternative_book(self):
		for title in ("Default", "Other"):
			frappe.get_doc(dict(doctype="Finance Book", finance_book_name=title + self.suffix)).insert()
		frappe.db.set_value("Company", self.company, "default_finance_book", "Default" + self.suffix)
		self.post(self.expense, self.cash, 10)
		self.post(self.expense, self.cash, 20, finance_book="Default" + self.suffix)
		self.post(self.expense, self.cash, 40, finance_book="Other" + self.suffix)
		self.assertEqual(self.read()["ledger"]["total_expenses"], 30)

	def test_manager_owner_and_native_accounting_visibility(self):
		self.post(self.expense, self.cash, 12)
		for roles in (("Retail Manager",), ("Retail Owner",), ("Accounts User",)):
			with self.subTest(roles=roles):
				frappe.set_user(self.user(*roles))
				self.assertTrue(can_see_financials())
				self.assertEqual(self.read()["ledger"]["total_expenses"], 12)
				frappe.set_user("Administrator")

	def test_cashier_and_guest_cannot_use_results_home_or_product_supplier_apis(self):
		from erpnext.setup.page.retail_home import retail_home
		from erpnext.stock.page.product_catalog.product_catalog import get_catalog
		from erpnext.stock.page.product_detail.product_detail import get_product_detail, get_product_overview
		from erpnext.buying.page.supplier_hub.supplier_hub import get_supplier_hub_data
		from erpnext.buying.page.supplier_detail.supplier_detail import get_supplier_detail, get_invoice_items
		user = self.user("Retail Cashier")
		for actor in (user, "Guest"):
			frappe.set_user(actor)
			self.assertFalse(can_see_financials())
			for function, args in ((money_hub.get_business_results, dict(company=self.company)),
				(retail_home.get_pnl, dict(company=self.company)), (retail_home.get_business_pulse, dict(company=self.company)),
				(get_catalog, {}), (get_product_detail, dict(item_code="secret")), (get_product_overview, dict(item_code="secret")),
				(get_supplier_hub_data, {}), (get_supplier_detail, dict(supplier="secret")),
				(get_invoice_items, dict(supplier="secret", invoice="secret", company=self.company))):
				with self.subTest(actor=actor, api=function.__name__), self.assertRaises(frappe.PermissionError):
					unwrap(function)(**args)

	def test_native_company_and_account_restrictions_before_aggregation(self):
		self.post(self.expense, self.cash, 12)
		other = self.book_account("Expense", "")
		self.post(other, self.cash, 28)
		user = self.user("Retail Manager")
		frappe.get_doc(dict(doctype="User Permission", user=user, allow="Account", for_value=self.expense,
			apply_to_all_doctypes=0, applicable_for="Account")).insert()
		frappe.set_user(user)
		out = self.read()
		self.assertEqual(out["ledger"]["total_expenses"], 12)
		self.assertEqual([row["account"] for row in out["ledger"]["accounts"]], [self.expense])
		frappe.set_user("Administrator")
		frappe.get_doc(dict(doctype="User Permission", user=user, allow="Company", for_value="_Test Money Other",
			apply_to_all_doctypes=1)).insert()
		frappe.set_user(user)
		with self.assertRaises(frappe.PermissionError):
			self.read()

	def test_missing_native_gl_permission_denied_without_payroll_reads(self):
		user = self.user("Retail Manager")
		frappe.set_user(user)
		original = frappe.has_permission
		with patch.object(results.frappe, "has_permission", side_effect=lambda kind, *a, **kw: False if kind == "GL Entry" else original(kind, *a, **kw)):
			with self.assertRaises(frappe.PermissionError):
				self.read()

	def test_home_uses_posted_results_and_never_custom_payroll_or_tax_estimates(self):
		from erpnext.setup.page.retail_home import retail_home
		self.post(self.expense, self.cash, 12)
		out = unwrap(retail_home.get_pnl)(company=self.company, period="today")
		self.assertEqual(out["net"], -12)
		self.assertIsNone(out["salaries"])
		self.assertIsNone(out["taxes"])
		self.assertEqual(out["basis"], "posted_general_ledger")

	def invoice(self, qty=1, date=None, currency="TJS", rate=100, return_against=None):
		if not hasattr(self, "customer"):
			for kind, field, name in (("Customer Group", "customer_group_name", "All Customer Groups"),
				("Territory", "territory_name", "All Territories"), ("Item Group", "item_group_name", "All Item Groups")):
				if not frappe.db.exists(kind, name):
					frappe.get_doc(dict(doctype=kind, is_group=1, **{field: name})).insert()
			self.customer_group = frappe.get_doc(dict(doctype="Customer Group", customer_group_name="_Test Results " + self.suffix,
				parent_customer_group="All Customer Groups", is_group=0)).insert().name
			self.territory = frappe.get_doc(dict(doctype="Territory", territory_name="_Test Results " + self.suffix,
				parent_territory="All Territories", is_group=0)).insert().name
			self.item_group = frappe.get_doc(dict(doctype="Item Group", item_group_name="_Test Results " + self.suffix,
				parent_item_group="All Item Groups", is_group=0)).insert().name
			if not frappe.db.exists("UOM", "Nos"):
				frappe.get_doc(dict(doctype="UOM", uom_name="Nos")).insert()
			self.selling = frappe.get_doc(dict(doctype="Price List", price_list_name="_Test Results Price " + self.suffix,
				currency=currency, selling=1, enabled=1)).insert().name
			self.receivable = self.book_account("Asset", "Receivable")
			account = frappe.get_doc("Account", self.receivable)
			account.account_currency = currency
			account.save()
			self.customer = frappe.get_doc(dict(doctype="Customer", customer_name="_Test Results Customer " + self.suffix,
				customer_group=self.customer_group, territory=self.territory, customer_type="Individual", default_currency=currency,
				accounts=[dict(company=self.company, account=self.receivable)])).insert().name
			self.item = frappe.get_doc(dict(doctype="Item", item_code="_Test Results Item " + self.suffix,
				item_name="Results item", item_group=self.item_group, stock_uom="Nos", is_stock_item=0)).insert().name
		doc = frappe.get_doc(dict(doctype="Sales Invoice", company=self.company, customer=self.customer,
			posting_date=date or today(), due_date=date or today(), set_posting_time=1, currency=currency,
			selling_price_list=self.selling, price_list_currency=currency, plc_conversion_rate=1, debit_to=self.receivable,
			conversion_rate=11 if currency == "USD" else 1, is_return=1 if qty < 0 else 0, return_against=return_against,
			items=[dict(item_code=self.item, qty=qty, rate=rate, income_account=self.income,
				expense_account=self.cogs, cost_center=self.cost_center)]))
		doc.insert()
		doc.submit()
		return doc

	def test_invoice_sales_returns_cancellation_and_original_currency(self):
		old = add_days(get_first_day(today()), -1)
		doc = self.invoice(qty=2, date=old, currency="USD")
		self.assertEqual(self.read(old)["invoice_sales"]["net_sales"], 2200)
		returned = self.invoice(qty=-1, currency="USD", return_against=doc.name)
		out = self.read()
		self.assertEqual((out["invoice_sales"]["net_sales"], out["invoice_sales"]["returns"]), (-1100, 1100))
		self.assertEqual(out["invoice_sales"]["by_currency"][0]["net_total"], -100)
		self.assertEqual(out["ledger"]["income"], -1100)
		returned.cancel()
		self.assertEqual(self.read()["invoice_sales"]["net_sales"], 0)

	def test_tax_collected_is_not_revenue_or_an_extra_profit_deduction(self):
		# Native Sales Invoice tax posts to a Liability account; base_net_total excludes it.
		doc = self.invoice()
		doc.cancel()
		tax = self.book_account("Liability", "Tax")
		doc = frappe.copy_doc(doc)
		doc.docstatus = 0
		doc.append("taxes", dict(charge_type="On Net Total", account_head=tax, rate=10, description="Native collected tax"))
		doc.insert()
		doc.submit()
		self.assertEqual(doc.base_grand_total, 110)
		out = self.read()
		self.assertEqual((out["invoice_sales"]["net_sales"], out["ledger"]["income"], out["ledger"]["total_expenses"]), (100, 100, 0))

	def test_unmerged_pos_separate_from_booked_sales_and_no_duplicate_after_merge(self):
		# Query-level consolidation provenance, including a link to a prior-period SI.
		original = frappe.get_list
		seen = []
		def listed(kind, **kwargs):
			seen.append((kind, kwargs))
			if kind == "POS Invoice":
				return [frappe._dict(base_net_total=200, net_total=200, currency="TJS", is_return=0)]
			return original(kind, **kwargs)
		self.invoice()
		with patch.object(results.frappe, "get_list", side_effect=listed):
			out = self.read()
		self.assertEqual((out["invoice_sales"]["net_sales"], out["invoice_sales"]["unmerged_pos_net_sales"], out["ledger"]["income"]), (100, 200, 100))
		query = next(kwargs for kind, kwargs in seen if kind == "POS Invoice")
		self.assertIn(["consolidated_invoice", "=", ""], query["or_filters"])

	def test_stock_sale_and_return_use_historical_valuation_not_current_buying_price(self):
		from erpnext.stock.doctype.stock_entry.stock_entry_utils import make_stock_entry
		from erpnext.stock.page.product_detail.product_detail import ProductCostLookup
		from erpnext.accounts.report.gross_profit.gross_profit import GrossProfitGenerator
		inventory = self.book_account("Asset", "Stock")
		frappe.db.set_value("Company", self.company, {"enable_perpetual_inventory": 1, "default_inventory_account": inventory})
		frappe.clear_document_cache("Company", self.company)
		frappe.local.enable_perpetual_inventory = {}
		self.addCleanup(lambda: setattr(frappe.local, "enable_perpetual_inventory", {}))
		warehouse = frappe.get_doc(dict(doctype="Warehouse", warehouse_name="_Test Results " + self.suffix,
			company=self.company, account=inventory, is_group=0)).insert().name
		# Create masters through the invoice helper, then cancel its nonstock invoice.
		seed = self.invoice()
		seed.cancel()
		item = frappe.get_doc("Item", self.item)
		item.is_stock_item = 1
		item.valuation_method = "FIFO"
		item.save()
		if not frappe.db.exists("Stock Entry Type", "Material Receipt"):
			frappe.get_doc(dict(doctype="Stock Entry Type", name="Material Receipt", purpose="Material Receipt", is_standard=1)).insert()
		make_stock_entry(item_code=self.item, qty=5, target=warehouse, rate=40, company=self.company,
			posting_date=add_days(today(), -10), expense_account=self.expense, cost_center=self.cost_center)
		doc = frappe.get_doc(dict(doctype="Sales Invoice", company=self.company, customer=self.customer, posting_date=today(),
			due_date=today(), currency="TJS", conversion_rate=1, update_stock=1, debit_to=self.receivable,
			selling_price_list=self.selling, price_list_currency="TJS", plc_conversion_rate=1,
			items=[dict(item_code=self.item, qty=2, rate=100, warehouse=warehouse, income_account=self.income,
				expense_account=self.cogs, cost_center=self.cost_center)]))
		doc.insert()
		doc.submit()
		buying = frappe.get_doc(dict(doctype="Price List", price_list_name="_Test Results Buying " + self.suffix,
			currency="TJS", buying=1, enabled=1)).insert().name
		frappe.get_doc(dict(doctype="Item Price", item_code=self.item, price_list=buying, currency="TJS", price_list_rate=999)).insert()
		out = self.read()
		self.assertEqual((out["ledger"]["cogs"], out["invoice_sales"]["net_sales"]), (80, 200))
		query = GrossProfitGenerator.__new__(GrossProfitGenerator)
		query.filters = frappe._dict(company=self.company, from_date=today(), to_date=today())
		si = frappe.qb.DocType("Sales Invoice")
		rows = query.prepare_invoice_query().where(si.name == doc.name).run(as_dict=True)
		self.assertEqual(ProductCostLookup(rows, self.company).cost(rows[0]), 80)
		from erpnext.accounts.doctype.sales_invoice.sales_invoice import make_sales_return
		returned = make_sales_return(doc.name)
		returned.items[0].qty = -1
		returned.insert()
		returned.submit()
		out = self.read()
		self.assertEqual((out["ledger"]["cogs"], out["invoice_sales"]["net_sales"]), (40, 100))

	def test_native_purchase_invoice_expense_then_payment_is_counted_once(self):
		seed = self.invoice()
		seed.cancel()
		group = frappe.get_doc(dict(doctype="Supplier Group", supplier_group_name="_Test Results " + self.suffix,
			is_group=0)).insert().name
		supplier = frappe.get_doc(dict(doctype="Supplier", supplier_name="_Test Results Supplier " + self.suffix,
			supplier_group=group, supplier_type="Company")).insert().name
		buying = frappe.get_doc(dict(doctype="Price List", price_list_name="_Test Results Buying " + self.suffix,
			currency="TJS", buying=1, enabled=1)).insert().name
		doc = frappe.get_doc(dict(doctype="Purchase Invoice", company=self.company, supplier=supplier,
			posting_date=today(), due_date=today(), currency="TJS", conversion_rate=1,
			buying_price_list=buying, price_list_currency="TJS", plc_conversion_rate=1,
			items=[dict(item_code=self.item, qty=1, rate=75, expense_account=self.expense, cost_center=self.cost_center)]))
		doc.insert()
		doc.submit()
		self.assertEqual(self.read()["ledger"]["total_expenses"], 75)
		from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry
		payment = get_payment_entry("Purchase Invoice", doc.name, bank_account=self.cash)
		payment.insert()
		payment.submit()
		self.assertEqual(self.read()["ledger"]["total_expenses"], 75)

	def test_native_financial_report_and_export_permissions_are_not_granted_to_cashier(self):
		from frappe.desk.query_report import get_report_doc
		from frappe.permissions import can_export
		for role, allowed in (("Retail Manager", True), ("Retail Cashier", False)):
			frappe.set_user(self.user(role))
			for name in ("Profit and Loss Statement", "Gross Profit"):
				if allowed:
					self.assertEqual(get_report_doc(name).name, name)
				else:
					with self.assertRaises(frappe.PermissionError):
						get_report_doc(name)
			self.assertEqual(bool(can_export("GL Entry")), allowed)
