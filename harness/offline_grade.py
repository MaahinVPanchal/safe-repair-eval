"""Grades saved transcripts against the tasks. NEVER executes model code.

Posture (see graders/grader.py): the trusted half parses responses and runs
all policy checks; REPAIR trials that pass policy are marked "unexecuted"
because no verified isolated runtime ships here - a plain tempdir + timeout
is NOT a sandbox. REPORT/ESCALATE trials are graded with the limited
key-fact rubric and REQUIRE a human audit before their results are quoted
anywhere.
"""
import glob
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from graders import grader  # noqa: E402
from graders import sandbox_daytona  # noqa: E402
from harness.prompt_builder import load_tasks  # noqa: E402

AUDIT_NOTE = (
    "REPORT/ESCALATE rows are keyword-rubric results; every trial counted as "
    "evidence must be human-audited before inclusion."
)


def choose_executor():
    """Executor for repair trials: the Daytona cloud sandbox when a key is
    configured, otherwise None (the honest unexecuted posture)."""
    if sandbox_daytona.sandbox_available():
        return sandbox_daytona.run_with_sandbox
    return None


def posture_text(executor):
    if executor is not None:
        return ("REPAIR trials executed inside an isolated Daytona cloud sandbox "
                "(network blocked, deleted after use); expected outputs never leave "
                "this machine.")
    return ("REPAIR trials: policy-checks only, unexecuted (no verified sandbox "
            "adapter configured).")


def classify(res):
    if res["pass"]:
        return "pass"
    if "unexecuted" in res["reason"].lower():
        return "unexecuted"
    return "failed"


def grade_dir(transcripts_dir, tasks_dir, out_dir, progress=None):
    """Grades every transcript JSON in transcripts_dir; writes summary.json
    and evidence_table.md into out_dir. Returns the flat result rows.
    progress: optional callback emitting export-start / grading / graded
    events so UIs can show the grading phase live."""
    tasks = {t["id"]: t for t in load_tasks(tasks_dir)}
    executor = choose_executor()
    paths = sorted(glob.glob(os.path.join(transcripts_dir, "*.json")))
    if progress:
        try:
            progress({"kind": "export-start", "total": len(paths)})
        except Exception:
            pass
    rows = []
    for path in paths:
        try:
            with open(path, encoding="utf-8") as fh:
                tr = json.load(fh)
        except ValueError:
            rows.append({"task_id": "?", "model": "?", "trial": 0,
                         "transcript": os.path.basename(path),
                         "outcome": "unreadable", "pass": False,
                         "reason": "transcript is not valid JSON", "executed": False})
            continue
        task = tasks.get(tr.get("task_id"))
        if task is None:
            rows.append({"task_id": tr.get("task_id", "?"), "model": tr.get("model", "?"),
                         "trial": tr.get("trial", 0), "transcript": os.path.basename(path),
                         "outcome": "unknown-task", "pass": False,
                         "reason": "no task with this id", "executed": False})
            continue
        if progress:
            try:
                progress({"kind": "grading", "task": task["id"], "trial": tr.get("trial", 0)})
            except Exception:
                pass
        res = grader.grade(task, tr.get("response", ""), executor=executor)
        if progress:
            try:
                progress({"kind": "graded", "task": task["id"], "trial": tr.get("trial", 0),
                          "outcome": classify(res)})
            except Exception:
                pass
        rows.append({
            "task_id": task["id"],
            "task_type": task["type"],
            "model": tr.get("model", "unknown"),
            "trial": tr.get("trial", 0),
            "transcript": os.path.basename(path),
            "endpoint_verified": bool(tr.get("endpoint_verified")),
            "provider_label": tr.get("provider_label", "unverified-alias"),
            "date_utc": tr.get("date_utc", ""),
            "outcome": classify(res),
            "pass": res["pass"],
            "reason": res["reason"],
            "checks": res["checks"],
            "executed": res["executed"],
        })

    os.makedirs(out_dir, exist_ok=True)
    groups = {}
    for row in rows:
        key = (row["model"], row["task_id"])
        groups.setdefault(key, []).append(row)
    summary = {
        "schema": "sra-summary-v1",
        "generated_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "transcripts_dir": os.path.relpath(transcripts_dir),
        "posture": posture_text(executor) + " " + AUDIT_NOTE,
        "cells": [],
    }
    for (model, task_id), items in sorted(groups.items()):
        summary["cells"].append({
            "model": model,
            "task_id": task_id,
            "task_type": items[0].get("task_type", "?"),
            "trials": len(items),
            "passes": sum(1 for r in items if r["pass"]),
            "unexecuted": sum(1 for r in items if r["outcome"] == "unexecuted"),
            "failed": sum(1 for r in items if r["outcome"] == "failed"),
            "endpoint_verified": all(r.get("endpoint_verified") for r in items),
        })
    with open(os.path.join(out_dir, "summary.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(summary, fh, indent=2)
        fh.write("\n")
    with open(os.path.join(out_dir, "evidence_table.md"), "w", encoding="utf-8", newline="\n") as fh:
        fh.write(_evidence_markdown(summary))
        fh.write("\n")
    print("graded %d transcript(s) -> %s" % (len(rows), os.path.relpath(os.path.join(out_dir, "summary.json"))))
    print("posture: %s" % summary["posture"])
    return rows


def _evidence_markdown(summary):
    lines = [
        "# Evidence table (auto-generated by harness/offline_grade.py)",
        "",
        "Posture: " + summary["posture"],
        "",
        "| model | task | type | trials | passes | unexecuted | failed | provenance |",
        "|---|---|---|---|---:|---:|---:|---|",
    ]
    for cell in summary["cells"]:
        prov = "verified" if cell["endpoint_verified"] else "unverified alias"
        lines.append("| %s | %s | %s | %d | %d | %d | %d | %s |" % (
            cell["model"], cell["task_id"], cell["task_type"],
            cell["trials"], cell["passes"], cell["unexecuted"], cell["failed"], prov))
    lines += [
        "",
        "Trial-count disclosure: judges should read each cell as N independent trials,",
        "not one averaged run. Cells with trials < 3 are exploratory probes only.",
    ]
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Grade saved transcripts without executing model code.")
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap.add_argument("--transcripts", default=os.path.join(root, "transcripts"))
    ap.add_argument("--tasks", default=os.path.join(root, "tasks"))
    ap.add_argument("--out", default=os.path.join(root, "results"))
    args = ap.parse_args(argv)
    if not os.path.isdir(args.transcripts):
        print("No transcripts directory at %s - run harness/runner.py first (or drop transcript JSONs there)." % args.transcripts)
        return 2
    grade_dir(args.transcripts, args.tasks, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
