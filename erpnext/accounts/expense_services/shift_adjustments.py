"""Native cash discrepancy posting. POS owns review allocation; no commit is made here."""

import json

import frappe
from frappe import _
from erpnext.accounts.expense_services import policy


def validate_setup(setup):
    company = setup.get("company")
    policy.check_company(company)
    currency = frappe.get_cached_value("Company", company, "default_currency")
    for field, root_types in (("shortage_account", {"Expense"}), ("surplus_account", {"Income", "Liability"})):
        name = setup.get(field)
        if not name:
            continue
        doc = frappe.get_cached_doc("Account", name)
        if doc.company != company or doc.root_type not in root_types or doc.is_group or doc.disabled or (doc.account_currency or currency) != currency:
            frappe.throw(_("Configure an enabled company-currency shortage expense account and an approved surplus account."))
        policy.check_user_scope("Account", name)
    if setup.get("cost_center"):
        doc = frappe.get_cached_doc("Cost Center", setup["cost_center"])
        if doc.company != company or doc.is_group or doc.disabled:
            frappe.throw(_("Select an enabled cost center in the review company."))
        policy.check_user_scope("Cost Center", doc.name)
    dimensions = json.loads(setup.get("dimensions_json") or "{}")
    if not isinstance(dimensions, dict):
        frappe.throw(_("Accounting dimensions must be a JSON object."))
    from erpnext.accounts.doctype.accounting_dimension.accounting_dimension import get_accounting_dimensions
    allowed = get_accounting_dimensions(as_list=False)
    mapping = {row.fieldname: row.document_type for row in allowed}
    for key, name in dimensions.items():
        if key not in mapping or not isinstance(name, str) or not name:
            frappe.throw(_("Select valid native accounting dimensions."))
        policy.check_user_scope(mapping[key], name)
    return dimensions


def post_cash_adjustment(company, account, signed_amount, posting_date, setup, reference, reason):
    # The caller also checks D4. Keep this permission boundary independently enforced.
    if frappe.session.user != "Administrator" and not {"Retail Owner", "Accounts Manager"}.intersection(frappe.get_roles()):
        frappe.throw(_("Only the owner or Accounts Manager can approve a loss or surplus."), frappe.PermissionError)
    if setup.get("company") != company:
        frappe.throw(_("Adjustment settings must belong to the review company."))
    dimensions = validate_setup(setup)
    funding = policy.validate_account(account, company)
    if funding.account_type != "Cash":
        frappe.throw(_("Bank and card differences require native settlement or reconciliation, not a cash-loss adjustment."))
    amount = policy.positive_amount(abs(signed_amount), policy.currency_precision(company))
    counterpart = setup.get("shortage_account" if signed_amount < 0 else "surplus_account")
    if not counterpart:
        frappe.throw(_("Configure the company shortage or surplus account before posting this adjustment."))
    if not posting_date or not (reason or "").strip():
        frappe.throw(_("An adjustment date and approval reason are required."))
    for permission in ("create", "submit"):
        if not frappe.has_permission("Journal Entry", permission):
            frappe.throw(_("Native Journal Entry create and submit permissions are required."), frappe.PermissionError)
    doc = frappe.new_doc("Journal Entry")
    doc.company = company
    doc.voucher_type = "Journal Entry"
    doc.posting_date = posting_date
    doc.user_remark = _("Shift review {0}: {1}").format(reference, reason)
    debit_account, credit_account = (counterpart, account) if signed_amount < 0 else (account, counterpart)
    for name, side in ((debit_account, "debit_in_account_currency"), (credit_account, "credit_in_account_currency")):
        doc.append("accounts", dict(dimensions, account=name, cost_center=setup.get("cost_center"), **{side: float(amount)}))
    # Native roles, dimensions, periods and GL validation remain active.
    doc.insert()
    doc.submit()
    return doc


def post_shift_transfer(company, source_wallet, target_wallet, amount, reference):
    """Native Internal Transfer without Money Hub's commit/refresh boundary."""
    from erpnext.accounts.page.money_hub.money_hub import _check_permission
    _check_permission()  # Preserve the existing money-movement capability.
    for permission in ("create", "submit"):
        if not frappe.has_permission("Payment Entry", permission):
            frappe.throw(_("Native Payment Entry create and submit permissions are required for a safe transfer."), frappe.PermissionError)
    wallets = [frappe.get_cached_doc("Money Wallet", name) for name in (source_wallet, target_wallet)]
    for wallet in wallets:
        if wallet.company != company or not wallet.enabled:
            frappe.throw(_("Select enabled transfer wallets in the closing company."))
        policy.validate_account(wallet.account, company)
    if wallets[1].wallet_type != "Safe" or wallets[0].account == wallets[1].account:
        frappe.throw(_("Choose a distinct Safe account for counted cash."))
    if frappe.get_cached_value("Account", wallets[0].account, "account_type") != "Cash":
        frappe.throw(_("The counted-cash source must be a Cash account."))
    value = policy.positive_amount(amount, policy.currency_precision(company))
    doc = frappe.get_doc(dict(doctype="Payment Entry", company=company, payment_type="Internal Transfer",
        posting_date=frappe.utils.today(), paid_from=wallets[0].account, paid_to=wallets[1].account,
        paid_amount=float(value), received_amount=float(value), source_exchange_rate=1, target_exchange_rate=1,
        reference_no=reference, reference_date=frappe.utils.today(), custom_remarks=1,
        remarks=_("Counted cash transferred after closing {0}. This does not resolve a shift difference.").format(reference)))
    doc.insert()
    doc.submit()
    return doc
