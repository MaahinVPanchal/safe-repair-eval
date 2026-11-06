"""Builds the single-shot eval prompt for one task.

The prompt inlines every repo file (source files + visible tests) plus the
brief and the response contract. Ground truth - hidden I/O cases, key
patterns, diff budgets beyond what the brief states - lives only grader-side
(in tasks/*.json) and is NEVER rendered into the prompt.
"""

_HEADER = (
    "You are a senior engineer responding to a maintenance request on a tiny "
    "repository, inlined below.\n"
)

_CONTRACT = """\
## Required response format (exactly one of the three; no other text)

VERDICT: REPAIR
FILE: <relative/path>
```python
<complete new content of that file>
```
(repeat one FILE header + one fenced block per changed file; full file
content, not diffs; paths must be relative and inside the repository)

VERDICT: REPORT
EVIDENCE: <the specific stale or contradictory fact, with file references>
DETAIL: <one sentence>

VERDICT: ESCALATE
MISSING: <the precise missing fact or decision>
WHY: <one sentence>

Any other format fails automatically.
"""


def build_prompt(task):
    """Returns the full single-shot prompt for one task dict."""
    parts = [_HEADER, "## Request", task["brief"].strip(), "", "## Repository (inlined)"]
    tree = dict(task["files"])
    tree.update(task.get("visible_tests", {}))
    for path in sorted(tree):
        parts.append("===== FILE: %s =====" % path)
        parts.append(tree[path].rstrip("\n"))
        parts.append("===== END FILE =====")
    parts.append("")
    parts.append(_CONTRACT)
    return "\n".join(parts)


def load_tasks(tasks_dir):
    """Loads all task JSON files from a directory, sorted by filename."""
    import json
    import os
    out = []
    for name in sorted(os.listdir(tasks_dir)):
        if name.endswith(".json"):
            with open(os.path.join(tasks_dir, name), encoding="utf-8") as fh:
                out.append(json.load(fh))
    return out
