"""Native install/setup regression. Run only on a disposable migrated test site."""

from uuid import uuid4

import frappe
from frappe.tests.utils import FrappeTestCase

from erpnext.accounts.expense_services.native_test_support import ensure_test_company
from erpnext.accounts.doctype.retail_tax_settings.retail_tax_settings import (
	DEFAULT_TAX_SUPPLIER,
	ensure_tax_supplier,
)


class TestRetailTaxSettingsInstallation(FrappeTestCase):
	@classmethod
	def setUpClass(cls):
		ensure_test_company()
		# These standard masters normally come from the setup wizard, which a
		# cold-install regression deliberately has not run.
		if not frappe.db.exists("Supplier Group", "All Supplier Groups"):
			frappe.get_doc(dict(doctype="Supplier Group", supplier_group_name="All Supplier Groups", is_group=1)).insert()
		if not frappe.db.exists("Supplier Group", "Services"):
			frappe.get_doc(dict(doctype="Supplier Group", supplier_group_name="Services",
				parent_supplier_group="All Supplier Groups")).insert()
		super().setUpClass()

	def setUp(self):
		frappe.set_user("Administrator")
		frappe.db.savepoint("retail_tax_installation")
		self.addCleanup(lambda: frappe.db.rollback(save_point="retail_tax_installation"))

	def test_native_single_read_has_no_nonexistent_supplier_default_or_provisioning(self):
		self.assertFalse(frappe.get_meta("Retail Tax Settings").get_field("tax_authority_supplier").default)
		before = frappe.db.count("Supplier")
		frappe.get_single("Retail Tax Settings")
		self.assertEqual(frappe.db.count("Supplier"), before)

	def test_explicit_company_setup_still_provisions_default_supplier_idempotently(self):
		before = frappe.db.count("GL Entry")
		settings = frappe.get_single("Retail Tax Settings")
		settings.company = "_Test Company"
		settings.tax_authority_supplier = None
		settings.save()
		self.assertEqual(settings.tax_authority_supplier, DEFAULT_TAX_SUPPLIER)
		self.assertTrue(frappe.db.exists("Supplier", DEFAULT_TAX_SUPPLIER))
		self.assertTrue(settings.sales_tax_template)
		suppliers = frappe.db.count("Supplier")
		settings.save()
		self.assertEqual(frappe.db.count("Supplier"), suppliers)
		self.assertEqual(frappe.db.count("GL Entry"), before)

	def test_existing_deliberately_configured_supplier_is_preserved(self):
		name = ensure_tax_supplier("_Test Tax Authority " + uuid4().hex[:8])
		settings = frappe.get_single("Retail Tax Settings")
		settings.company = "_Test Company"
		settings.tax_authority_supplier = name
		settings.save()
		self.assertEqual(settings.tax_authority_supplier, name)
