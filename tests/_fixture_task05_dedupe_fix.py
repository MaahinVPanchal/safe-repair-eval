"""Customer row deduplication for the nightly CRM import."""
import json
import os

_CONTRACT_PATH = os.path.join("config", "import_contract.json")


def load_contract():
    with open(_CONTRACT_PATH) as fh:
        return json.load(fh)


def normalize(row):
    """Trim whitespace on every string field. The import contract requires
    rows to be normalized BEFORE dedupe (normalized emails must collide);
    do not reorder normalization and dedupe."""
    return {k: (v.strip() if isinstance(v, str) else v) for k, v in row.items()}


def dedupe(rows):
    """Return rows unique by the contract's key field, keeping the FIRST
    occurrence of each key and preserving first-seen input order."""
    contract = load_contract()
    key_field = contract["key_field"]
    seen = {}
    for row in rows:
        row = normalize(row)
        if row[key_field] not in seen:
            seen[row[key_field]] = row
    return list(seen.values())


if __name__ == "__main__":
    import sys
    payload = json.loads(sys.stdin.read())
    print(json.dumps({"rows": dedupe(payload["rows"])}))
