# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import json
import frappe
from frappe import _
from frappe.utils import flt, cint, today, nowdate, getdate

from erpnext.stock.page.product_catalog.product_catalog import get_default_company, get_stores_warehouse
from erpnext.buying.page.supplier_hub.supplier_hub import make_quick_supplier_payment, get_payment_options


@frappe.whitelist()
def get_supplier_detail(supplier, company=None):
	"""Returns complete profile, financials, inventory list, invoices, and payments for Supplier Detail."""
	if not supplier:
		frappe.throw(_("Supplier is required"))

	company = company or get_default_company()
	currency = frappe.db.get_value("Company", company, "default_currency") or "TJS"

	# 1. Basic Supplier Doc
	supp = frappe.db.get_value(
		"Supplier",
		supplier,
		["name", "supplier_name", "mobile_no", "email_id", "country", "supplier_details"],
		as_dict=True,
	)
	if not supp:
		frappe.throw(_("Supplier {0} not found").format(supplier))

	# 2. Linked Contact Person & Address
	contact_name = frappe.db.sql(
		"""
		SELECT c.name, TRIM(CONCAT(COALESCE(c.first_name, ''), ' ', COALESCE(c.last_name, ''))) as full_name,
		       c.phone, c.mobile_no, c.email_id
		FROM `tabContact` c
		JOIN `tabDynamic Link` dl ON dl.parent = c.name
		WHERE dl.link_doctype = 'Supplier' AND dl.link_name = %s
		ORDER BY c.creation DESC LIMIT 1
		""",
		(supplier,),
		as_dict=True,
	)
	contact_person = contact_name[0].full_name if contact_name and contact_name[0].full_name.strip() else ""
	if contact_name and not supp.get("mobile_no"):
		supp["mobile_no"] = contact_name[0].mobile_no or contact_name[0].phone or ""
	if contact_name and not supp.get("email_id"):
		supp["email_id"] = contact_name[0].email_id or ""

	address_row = frappe.db.sql(
		"""
		SELECT a.address_line1, a.address_line2, a.city, a.country
		FROM `tabAddress` a
		JOIN `tabDynamic Link` dl ON dl.parent = a.name
		WHERE dl.link_doctype = 'Supplier' AND dl.link_name = %s
		ORDER BY a.creation DESC LIMIT 1
		""",
		(supplier,),
		as_dict=True,
	)
	address_str = ""
	if address_row:
		parts = [p for p in [address_row[0].city, address_row[0].address_line1, address_row[0].address_line2] if p]
		address_str = ", ".join(parts)

	# 3. Financial KPI Summary
	fin = frappe.db.sql(
		"""
		SELECT 
			COALESCE(SUM(grand_total), 0) as total_purchased,
			COALESCE(SUM(outstanding_amount), 0) as current_debt,
			COUNT(*) as invoice_count
		FROM `tabPurchase Invoice`
		WHERE supplier = %(supplier)s AND docstatus = 1 AND company = %(company)s
		""",
		{"supplier": supplier, "company": company},
		as_dict=True,
	)[0]

	debt = flt(fin.current_debt, 2)
	purchased = flt(fin.total_purchased, 2)
	paid = max(0.0, flt(purchased - debt, 2))

	# 4. Products from this Supplier (Aggregated by General Product Model Templates)
	item_rows = frappe.db.sql(
		"""
		SELECT DISTINCT pii.item_code
		FROM `tabPurchase Invoice Item` pii
		JOIN `tabPurchase Invoice` pi ON pi.name = pii.parent
		WHERE pi.supplier = %(supplier)s AND pi.docstatus = 1 AND pi.company = %(company)s AND pii.item_code IS NOT NULL
		UNION
		SELECT DISTINCT pri.item_code
		FROM `tabPurchase Receipt Item` pri
		JOIN `tabPurchase Receipt` pr ON pr.name = pri.parent
		WHERE pr.supplier = %(supplier)s AND pr.docstatus = 1 AND pr.company = %(company)s AND pri.item_code IS NOT NULL
		UNION
		SELECT DISTINCT parent as item_code
		FROM `tabItem Default`
		WHERE default_supplier = %(supplier)s
		""",
		{"supplier": supplier, "company": company},
		as_dict=True,
	)

	direct_items = [r.item_code for r in item_rows if r.item_code]
	parent_codes = set()

	if direct_items:
		items_meta = frappe.db.sql(
			"SELECT name, variant_of FROM `tabItem` WHERE name IN %(items)s",
			{"items": direct_items},
			as_dict=True,
		)
		for im in items_meta:
			if im.variant_of:
				parent_codes.add(im.variant_of)
			else:
				parent_codes.add(im.name)

	products = []
	tot_stock_qty = 0.0
	tot_stock_val = 0.0

	if parent_codes:
		parents = frappe.db.sql(
			"""
			SELECT 
				name as item_code, item_name, item_group, image, custom_short_code,
				has_variants, stock_uom
			FROM `tabItem`
			WHERE name IN %(parents)s AND disabled = 0
			ORDER BY item_name ASC
			""",
			{"parents": list(parent_codes)},
			as_dict=True,
		)

		variants_raw = frappe.db.sql(
			"""
			SELECT name, variant_of, custom_short_code
			FROM `tabItem`
			WHERE variant_of IN %(parents)s AND disabled = 0
			""",
			{"parents": list(parent_codes)},
			as_dict=True,
		)

		parent_to_variants = {}
		all_codes = set(parent_codes)
		for v in variants_raw:
			parent_to_variants.setdefault(v.variant_of, []).append(v)
			all_codes.add(v.name)

		# Balances and Valuation from tabBin
		bin_records = frappe.db.sql(
			"""
			SELECT item_code, SUM(actual_qty) as total_qty, SUM(stock_value) as total_stock_value
			FROM `tabBin`
			WHERE item_code IN %(codes)s
			GROUP BY item_code
			""",
			{"codes": list(all_codes)},
			as_dict=True,
		)
		stock_map = {b.item_code: flt(b.total_qty) for b in bin_records}
		stock_val_map = {b.item_code: flt(b.total_stock_value) for b in bin_records}

		# Prices from tabItem Price
		price_records = frappe.db.sql(
			"""
			SELECT item_code, price_list, price_list_rate
			FROM `tabItem Price`
			WHERE item_code IN %(codes)s
			  AND price_list IN ('Standard Selling', 'Standard Buying')
			ORDER BY modified DESC
			""",
			{"codes": list(all_codes)},
			as_dict=True,
		)
		selling_price_map = {}
		buying_price_map = {}
		for pr in price_records:
			if pr.price_list == "Standard Selling" and pr.item_code not in selling_price_map:
				selling_price_map[pr.item_code] = flt(pr.price_list_rate)
			elif pr.price_list == "Standard Buying" and pr.item_code not in buying_price_map:
				buying_price_map[pr.item_code] = flt(pr.price_list_rate)

		for p in parents:
			vars_for_p = parent_to_variants.get(p.item_code, [])
			v_count = len(vars_for_p)
			has_vars = 1 if (p.has_variants or v_count > 0) else 0

			codes_under_p = [v.name for v in vars_for_p] + [p.item_code]
			model_stock = sum(stock_map.get(c, 0.0) for c in codes_under_p)
			model_val = sum(stock_val_map.get(c, 0.0) for c in codes_under_p)

			# Selling price
			sell_values = [selling_price_map[c] for c in codes_under_p if c in selling_price_map and selling_price_map[c] > 0]
			selling_price = min(sell_values) if sell_values else 0.0
			price_varies = len(set(sell_values)) > 1

			# Cost / valuation rate
			if model_stock > 0 and model_val > 0:
				cost_rate = flt(model_val / model_stock, 2)
			else:
				buy_values = [buying_price_map[c] for c in codes_under_p if c in buying_price_map and buying_price_map[c] > 0]
				cost_rate = min(buy_values) if buy_values else 0.0

			# Stock status
			if model_stock <= 0:
				status = "out_of_stock"
				status_label_ru = "Нет в наличии"
				status_color = "red"
			elif model_stock <= 5:
				status = "low_stock"
				status_label_ru = "Мало"
				status_color = "orange"
			else:
				status = "in_stock"
				status_label_ru = "В наличии"
				status_color = "green"

			prod_dict = {
				"item_code": p.item_code,
				"item_name": p.item_name,
				"item_group": p.item_group,
				"image": p.image or "",
				"custom_short_code": p.custom_short_code or "",
				"has_variants": has_vars,
				"variant_count": v_count,
				"stock_uom": p.stock_uom or "Nos",
				"stock_qty": flt(model_stock, 2),
				"stock_value": flt(model_val, 2),
				"valuation_rate": flt(cost_rate, 2),
				"selling_price": flt(selling_price, 2),
				"price_varies": price_varies,
				"status": status,
				"status_label_ru": status_label_ru,
				"status_color": status_color,
			}
			products.append(prod_dict)
			tot_stock_qty += model_stock
			tot_stock_val += model_val

		# Sort: highest stock quantity first, then item name
		products.sort(key=lambda x: (-x["stock_qty"], x["item_name"]))

	# 5. Invoices List with Product & Model Breakdown
	invoices = frappe.db.sql(
		"""
		SELECT 
			name, posting_date, bill_no, grand_total, outstanding_amount, status, remarks
		FROM `tabPurchase Invoice`
		WHERE supplier = %(supplier)s AND docstatus = 1 AND company = %(company)s
		ORDER BY posting_date DESC, creation DESC
		LIMIT 150
		""",
		{"supplier": supplier, "company": company},
		as_dict=True,
	)

	if invoices:
		inv_names = [inv.name for inv in invoices]
		items_raw = frappe.db.sql(
			"""
			SELECT pii.parent, pii.item_code, pii.item_name, pii.qty, pii.rate, pii.amount,
			       i.custom_short_code, i.variant_of, i.image
			FROM `tabPurchase Invoice Item` pii
			LEFT JOIN `tabItem` i ON i.name = pii.item_code
			WHERE pii.parent IN %(invs)s
			""",
			{"invs": inv_names},
			as_dict=True,
		)

		parents_set = {r.variant_of for r in items_raw if r.variant_of}
		parents_meta = {}
		if parents_set:
			p_rows = frappe.db.sql(
				"SELECT name, item_name, custom_short_code, image FROM `tabItem` WHERE name IN %(parents)s",
				{"parents": list(parents_set)},
				as_dict=True,
			)
			parents_meta = {p.name: p for p in p_rows}

		items_by_inv = {}
		for r in items_raw:
			items_by_inv.setdefault(r.parent, []).append(r)

		for inv in invoices:
			inv["grand_total"] = flt(inv["grand_total"], 2)
			inv["outstanding_amount"] = flt(inv["outstanding_amount"], 2)

			inv_items = items_by_inv.get(inv.name, [])
			inv["total_qty"] = sum(flt(it.qty) for it in inv_items)

			first_it = inv_items[0] if inv_items else None
			parent = parents_meta.get(first_it.variant_of) if first_it and first_it.variant_of else None

			if parent:
				inv["model_id"] = parent.custom_short_code or parent.name
				inv["product_name"] = parent.item_name
				inv["image"] = parent.image or (first_it.image if first_it else "") or ""
			elif first_it:
				inv["model_id"] = first_it.custom_short_code or first_it.item_code
				inv["product_name"] = first_it.item_name
				inv["image"] = first_it.image or ""
			else:
				inv["model_id"] = ""
				inv["product_name"] = "Товары"
				inv["image"] = ""

			# Build variant summary string
			variants_list = []
			for it in inv_items[:6]:
				v_name = it.item_name or it.item_code
				q_val = cint(it.qty) if it.qty % 1 == 0 else it.qty
				variants_list.append(f"{v_name} × {q_val}")
			if len(inv_items) > 6:
				variants_list.append(f"+еще {len(inv_items) - 6}")
			inv["variants_summary"] = ", ".join(variants_list)
	else:
		invoices = []

	# 6. Payments List
	payments = frappe.db.sql(
		"""
		SELECT 
			name, posting_date, mode_of_payment, paid_from, paid_amount, reference_no, reference_date, status, owner, remarks
		FROM `tabPayment Entry`
		WHERE party_type = 'Supplier' AND party = %(supplier)s AND docstatus = 1 AND company = %(company)s
		ORDER BY posting_date DESC, creation DESC
		LIMIT 100
		""",
		{"supplier": supplier, "company": company},
		as_dict=True,
	)

	if payments:
		wallet_rows = frappe.db.get_all(
			"Money Wallet",
			filters={"company": company},
			fields=["name", "wallet_name", "wallet_type", "account", "icon"],
		)
		acc_to_wallet = {w.account: w for w in wallet_rows if w.account}

		pay_names = [p.name for p in payments]
		pay_refs = frappe.db.sql(
			"""
			SELECT parent, reference_doctype, reference_name, allocated_amount
			FROM `tabPayment Entry Reference`
			WHERE parent IN %(pays)s AND reference_doctype = 'Purchase Invoice'
			""",
			{"pays": pay_names},
			as_dict=True,
		)
		pay_refs_map = {}
		referenced_inv_names = set()
		for r in pay_refs:
			pay_refs_map.setdefault(r.parent, []).append(r)
			if r.reference_name:
				referenced_inv_names.add(r.reference_name)

		inv_meta_map = {}
		for inv in invoices:
			inv_meta_map[inv["name"]] = {
				"model_id": inv.get("model_id") or "",
				"product_name": inv.get("product_name") or "",
				"image": inv.get("image") or "",
				"bill_no": inv.get("bill_no") or "",
			}

		missing_inv_names = list(referenced_inv_names - set(inv_meta_map.keys()))
		if missing_inv_names:
			m_items_raw = frappe.db.sql(
				"""
				SELECT pii.parent, pii.item_code, pii.item_name,
				       i.custom_short_code, i.variant_of, i.image
				FROM `tabPurchase Invoice Item` pii
				LEFT JOIN `tabItem` i ON i.name = pii.item_code
				WHERE pii.parent IN %(invs)s
				""",
				{"invs": missing_inv_names},
				as_dict=True,
			)
			m_parents_set = {r.variant_of for r in m_items_raw if r.variant_of}
			m_parents_meta = {}
			if m_parents_set:
				p_rows = frappe.db.sql(
					"SELECT name, item_name, custom_short_code, image FROM `tabItem` WHERE name IN %(parents)s",
					{"parents": list(m_parents_set)},
					as_dict=True,
				)
				m_parents_meta = {p.name: p for p in p_rows}

			m_items_by_inv = {}
			for r in m_items_raw:
				m_items_by_inv.setdefault(r.parent, []).append(r)

			for inv_name in missing_inv_names:
				m_items = m_items_by_inv.get(inv_name, [])
				first_it = m_items[0] if m_items else None
				parent = m_parents_meta.get(first_it.variant_of) if first_it and first_it.variant_of else None
				if parent:
					inv_meta_map[inv_name] = {
						"model_id": parent.custom_short_code or parent.name,
						"product_name": parent.item_name,
						"image": parent.image or (first_it.image if first_it else "") or "",
					}
				elif first_it:
					inv_meta_map[inv_name] = {
						"model_id": first_it.custom_short_code or first_it.item_code,
						"product_name": first_it.item_name,
						"image": first_it.image or "",
					}
				else:
					inv_meta_map[inv_name] = {
						"model_id": "",
						"product_name": "Товары",
						"image": "",
					}

		for p in payments:
			p["paid_amount"] = flt(p["paid_amount"], 2)
			refs = pay_refs_map.get(p.name, [])
			p["invoice_name"] = refs[0].reference_name if refs else ""

			w = acc_to_wallet.get(p.get("paid_from"))
			if w:
				p["wallet_name"] = w.wallet_name
				p["wallet_icon"] = w.icon or ("💵" if w.wallet_type == "Till" else "🔐" if w.wallet_type == "Safe" else "📱" if w.wallet_type == "Mobile Wallet" else "🏦")
			else:
				p["wallet_name"] = ""
				p["wallet_icon"] = ""

			if p["invoice_name"] and p["invoice_name"] in inv_meta_map:
				meta = inv_meta_map[p["invoice_name"]]
				p["model_id"] = meta.get("model_id") or ""
				p["product_name"] = meta.get("product_name") or ""
				p["image"] = meta.get("image") or ""
			else:
				p["model_id"] = ""
				p["product_name"] = "Оплата поставщику"
				p["image"] = ""

			raw_rem = (p.get("remarks") or "").strip()
			cleaned_lines = []
			for line in raw_rem.split("\n"):
				l_str = line.strip()
				if not l_str:
					continue
				if l_str.startswith("Amount ") or l_str.startswith("Сумма "):
					continue
				cleaned_lines.append(l_str)
			p["clean_remarks"] = " ".join(cleaned_lines)

	return {
		"supplier": {
			"name": supp.name,
			"supplier_name": supp.supplier_name or supp.name,
			"mobile_no": supp.mobile_no or "",
			"email_id": supp.email_id or "",
			"contact_person": contact_person,
			"address": address_str,
			"notes": supp.supplier_details or "",
			"country": supp.country or "",
		},
		"kpi": {
			"current_debt": debt,
			"total_purchased": purchased,
			"total_paid": paid,
			"total_stock_qty": flt(tot_stock_qty, 2),
			"total_stock_value": flt(tot_stock_val, 2),
			"products_count": len(products),
			"invoices_count": len(invoices),
			"payments_count": len(payments),
		},
		"products": products,
		"invoices": invoices,
		"payments": payments,
		"currency": currency,
	}


@frappe.whitelist()
def save_supplier_info(supplier, supplier_name=None, mobile_no=None, email_id=None, contact_person=None, address=None, notes=None):
	"""Updates supplier profile, contact person, address, and notes directly from General Info tab."""
	if not supplier:
		frappe.throw(_("Supplier is required"))

	doc = frappe.get_doc("Supplier", supplier)
	if supplier_name and supplier_name.strip():
		doc.supplier_name = supplier_name.strip()
	doc.mobile_no = mobile_no or ""
	doc.email_id = email_id or ""
	doc.supplier_details = notes or ""
	doc.flags.ignore_permissions = True
	doc.save()

	# Update or Create Contact if contact_person provided
	if contact_person and contact_person.strip():
		parts = contact_person.strip().split(" ", 1)
		first_name = parts[0]
		last_name = parts[1] if len(parts) > 1 else ""

		existing_contact = frappe.db.sql(
			"""
			SELECT c.name FROM `tabContact` c
			JOIN `tabDynamic Link` dl ON dl.parent = c.name
			WHERE dl.link_doctype = 'Supplier' AND dl.link_name = %s
			LIMIT 1
			""",
			(supplier,),
		)
		if existing_contact:
			c = frappe.get_doc("Contact", existing_contact[0][0])
			c.first_name = first_name
			c.last_name = last_name
			if mobile_no:
				c.mobile_no = mobile_no
			if email_id:
				c.email_id = email_id
			c.flags.ignore_permissions = True
			c.save()
		else:
			c = frappe.new_doc("Contact")
			c.first_name = first_name
			c.last_name = last_name
			c.mobile_no = mobile_no
			c.email_id = email_id
			c.append("links", {"link_doctype": "Supplier", "link_name": supplier})
			c.flags.ignore_permissions = True
			c.insert()

	# Update or Create Address if address provided
	if address and address.strip():
		existing_addr = frappe.db.sql(
			"""
			SELECT a.name FROM `tabAddress` a
			JOIN `tabDynamic Link` dl ON dl.parent = a.name
			WHERE dl.link_doctype = 'Supplier' AND dl.link_name = %s
			LIMIT 1
			""",
			(supplier,),
		)
		if existing_addr:
			a = frappe.get_doc("Address", existing_addr[0][0])
			a.address_line1 = address.strip()
			a.flags.ignore_permissions = True
			a.save()
		else:
			a = frappe.new_doc("Address")
			a.address_title = supplier
			a.address_line1 = address.strip()
			a.city = address.strip()
			a.append("links", {"link_doctype": "Supplier", "link_name": supplier})
			a.flags.ignore_permissions = True
			a.insert()

	return {
		"success": True,
		"message": _("Supplier information successfully saved"),
	}
