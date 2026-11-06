"""API token validation for the public gateway."""
import json
import os
import re

_TOKEN_RE = re.compile(r"[A-Za-z0-9-]{3,12}")
_GATEWAY_CONFIG = os.path.join("config", "gateway.json")


def strip_prefix(raw):
    """Gateway auth headers arrive as 'tok_<token>' or as bare tokens.
    Strips the configured prefix when present. This behavior is contractual
    for the gateway - do not change it."""
    with open(_GATEWAY_CONFIG) as fh:
        prefix = json.load(fh)["prefix"]
    if raw.startswith(prefix):
        return raw[len(prefix):]
    return raw


def is_valid(token):
    """A token is valid when it is 3-12 characters long, contains only
    alphanumerics and hyphens, and neither starts nor ends with a hyphen."""
    if not isinstance(token, str):
        return False
    if token.startswith("-") or token.endswith("-"):
        return False
    return bool(_TOKEN_RE.fullmatch(token))


if __name__ == "__main__":
    import sys
    payload = json.loads(sys.stdin.read())
    print(json.dumps({"valid": is_valid(strip_prefix(payload["raw"]))}))
