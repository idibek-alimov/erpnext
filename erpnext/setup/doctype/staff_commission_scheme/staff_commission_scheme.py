# Copyright (c) 2026, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import flt


class StaffCommissionScheme(Document):
	def calculate_commission(self, amount):
		"""
		Calculates commission amount and effective percentage for a given volume/profit amount.
		Returns (effective_percent, commission_amount).
		"""
		amount = flt(amount)
		if amount <= 0:
			return 0.0, 0.0

		if self.calculation_type == "Fixed Percentage":
			rate = flt(self.fixed_rate)
			comm = flt(amount * rate / 100.0, 2)
			return rate, comm

		if self.calculation_type == "Tiered / Slab Rate":
			sorted_tiers = sorted(self.tiers or [], key=lambda t: flt(t.from_amount))
			if not sorted_tiers:
				return 0.0, 0.0

			if self.tier_method == "Total Volume Slab":
				matched_tier = None
				for tier in sorted_tiers:
					from_amt = flt(tier.from_amount)
					to_amt = flt(tier.to_amount) if flt(tier.to_amount) > 0 else float("inf")
					if from_amt <= amount <= to_amt:
						matched_tier = tier
						break

				if not matched_tier and amount > flt(sorted_tiers[-1].from_amount):
					matched_tier = sorted_tiers[-1]

				rate = flt(matched_tier.commission_percent) if matched_tier else 0.0
				comm = flt(amount * rate / 100.0, 2)
				return rate, comm

			# Default: Progressive Bracket
			total_comm = 0.0
			for tier in sorted_tiers:
				from_amt = flt(tier.from_amount)
				to_amt = flt(tier.to_amount) if flt(tier.to_amount) > 0 else amount

				if amount > from_amt:
					bracket_cap = min(amount, to_amt)
					taxable_in_tier = bracket_cap - from_amt
					if taxable_in_tier > 0:
						rate = flt(tier.commission_percent)
						total_comm += taxable_in_tier * (rate / 100.0)

			total_comm = flt(total_comm, 2)
			effective_rate = flt((total_comm / amount * 100.0), 2) if amount else 0.0
			return effective_rate, total_comm

		return 0.0, 0.0
