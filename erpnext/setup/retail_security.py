# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

"""Retail OS security: 3 retail roles, page access, manager auth badges, financial masking."""

import random
import string

import frappe
from frappe import _

RETAIL_CASHIER = "Retail Cashier"
RETAIL_MANAGER = "Retail Manager"
RETAIL_OWNER = "Retail Owner"
RETAIL_ROLES = (RETAIL_CASHIER, RETAIL_MANAGER, RETAIL_OWNER)

# Standard Frappe roles each retail role needs so the underlying APIs/doctypes keep working.
ROLE_BUNDLES = {
	RETAIL_CASHIER: ["Sales User", "Stock User"],
	RETAIL_MANAGER: ["Sales User", "Stock User", "Stock Manager", "Purchase User", "Accounts User", "HR User"],
	RETAIL_OWNER: [
		"Sales User", "Sales Manager", "Stock User", "Stock Manager", "Purchase User", "Purchase Manager",
		"Accounts User", "Accounts Manager", "HR User", "HR Manager",
	],
}

_MANAGER_PAGES = [
	"posapp", "retail-home", "product-catalog", "product-detail", "supplier-hub", "supplier-detail",
	"expense-desk", "staff-hub", "staff-detail",
]
PAGE_ROLES = {
	RETAIL_CASHIER: ["posapp"],
	RETAIL_MANAGER: _MANAGER_PAGES,
	RETAIL_OWNER: _MANAGER_PAGES + ["money-hub"],
}

# Roles that may see profit, purchase cost and bank balances.
FINANCIAL_ROLES = {RETAIL_OWNER, "System Manager"}


def setup_retail_security():
	"""Idempotent. Runs on every `bench migrate` (after_migrate hook)."""
	for role in RETAIL_ROLES:
		if not frappe.db.exists("Role", role):
			frappe.get_doc({"doctype": "Role", "role_name": role, "desk_access": 1}).insert(
				ignore_permissions=True
			)
	frappe.db.set_value("Role", RETAIL_CASHIER, "home_page", "posapp")

	for role, pages in PAGE_ROLES.items():
		for page in pages:
			if not frappe.db.exists("Page", page):
				continue
			if not frappe.db.exists("Has Role", {"parent": page, "parenttype": "Page", "role": role}):
				doc = frappe.get_doc("Page", page)
				doc.append("roles", {"role": role})
				doc.flags.ignore_permissions = True
				doc.save()

	ensure_badge_field()
	frappe.db.commit()


def ensure_badge_field():
	from frappe.custom.doctype.custom_field.custom_field import create_custom_field

	if not frappe.db.exists("Custom Field", "User-custom_manager_badge"):
		create_custom_field(
			"User",
			{
				"fieldname": "custom_manager_badge",
				"label": "Штрихкод администратора",
				"fieldtype": "Data",
				"insert_after": "username",
				"description": "Barcode on manager badge (starts with MGR-)",
			},
		)


def apply_role_bundles(doc, method=None):
	"""User.validate: retail roles automatically bring the standard roles they depend on."""
	have = {r.role for r in doc.get("roles", [])}
	for retail_role, bundle in ROLE_BUNDLES.items():
		if retail_role in have:
			for r in bundle:
				if r not in have and frappe.db.exists("Role", r):
					doc.append("roles", {"role": r})
					have.add(r)


def can_see_financials(user=None):
	user = user or frappe.session.user
	if user == "Administrator":
		return True
	roles = set(frappe.get_roles(user))
	if roles & FINANCIAL_ROLES:
		return True
	# Only mask users who are retail staff; everyone else keeps classic ERPNext behaviour.
	return not (roles & {RETAIL_CASHIER, RETAIL_MANAGER})


@frappe.whitelist()
def get_or_create_manager_badge(user):
	"""Return the user's MGR- badge code, generating a unique one if missing. System Manager only."""
	frappe.only_for(("System Manager", RETAIL_OWNER))
	ensure_badge_field()
	code = frappe.db.get_value("User", user, "custom_manager_badge")
	if not code:
		for _i in range(20):
			code = "MGR-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=6))
			if not frappe.db.exists("User", {"custom_manager_badge": code}):
				break
		frappe.db.set_value("User", user, "custom_manager_badge", code)
	return {"code": code, "name": frappe.utils.get_fullname(user)}


@frappe.whitelist()
def regenerate_manager_badge(user):
	"""Invalidate a lost badge by issuing a new code."""
	frappe.only_for(("System Manager", RETAIL_OWNER))
	frappe.db.set_value("User", user, "custom_manager_badge", "")
	return get_or_create_manager_badge(user)
