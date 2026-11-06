"""Billing totals for Acme Cloud invoices."""
import json
from decimal import Decimal, ROUND_HALF_UP


def load_discount():
    with open("config/rates.json") as fh:
        return json.load(fh)["volume_discount_pct"]


def compute_total(items, tax_rate):
    """items: list of {"price": float, "qty": int}. Returns final charge.

    Volume discount applies when the pre-tax subtotal exceeds 1000.
    """
    subtotal = sum(it["price"] * it["qty"] for it in items)
    if subtotal > 1000:
        subtotal *= (100 - load_discount()) / 100
    total = subtotal * (1 + tax_rate)
    return float(Decimal(str(total)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


if __name__ == "__main__":
    import sys
    payload = json.loads(sys.stdin.read())
    print(json.dumps({"total": compute_total(payload["items"], payload["tax_rate"])}))
