"""Builds the scenario dashboard from saved transcripts.

Grades every transcript with the trusted grader half (executor=None - the same
offline posture as harness/offline_grade.py: repair trials that pass policy are
marked unexecuted, model code is never executed). Outputs:

  docs/dashboard_fragment.html - inline fragment (host-rendered in conversation)
  docs/dashboard.html          - standalone page (via the visualize render.py)

A scenario is one trial round over the same 10 tasks. Between-scenario change
notes come from tools/scenario_changes.json so fixes made between passes can be
logged and shown instead of implied.

Run from the repo root:  python tools/build_dashboard.py
"""
import glob
import json
import os
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from graders import grader  # noqa: E402
from harness.prompt_builder import load_tasks  # noqa: E402

MAX_TRIALS_SHOWN = 5
MIN_TRIALS_SHOWN = 3
DEFAULT_CHANGE = ("No task, grader, or harness changes - scenario {to} is an "
                  "independent repeat trial at temperature 0 on identical tasks.")

FRAGMENT_TEMPLATE = """<div id="sra-dash">
<style>
#sra-dash pre { white-space: pre-wrap; word-break: break-word; margin: 8px 0 0; font-size: 12px; }
#sra-dash .sra-cell { width: 100%; min-height: 34px; border-radius: 8px; font: inherit; font-size: 14px; border: 1px solid transparent; }
#sra-dash .sra-pass { background: color-mix(in srgb, var(--green) 24%, transparent); }
#sra-dash .sra-fail { background: color-mix(in srgb, var(--red) 24%, transparent); }
#sra-dash .sra-unexec { background: color-mix(in srgb, var(--muted) 80%, transparent); color: var(--muted-foreground); }
#sra-dash .sra-miss { background: transparent; color: var(--muted-foreground); border: 1px dashed var(--border); }
#sra-dash .sra-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin: 0 6px 0 0; vertical-align: middle; }
#sra-dash td, #sra-dash th { vertical-align: middle; }
#sra-dash .sra-stat { min-width: 190px; flex: 1 1 190px; }
#sra-dash .sra-kv { margin: 2px 0; }
#sra-dash .sra-kv b { font-weight: 500; }
</style>
<h2>Safe Repair Agent — scenario dashboard</h2>
<p class="text-muted">A scenario is one trial round over the same 10 tasks (identical tasks and grader, temperature 0). Select a cell to see why it graded the way it did.</p>
<div class="nav nav-pills" role="tablist" aria-label="Model" id="sra-tabs" hidden></div>
<div id="sra-modelmeta" class="text-small text-muted" style="margin-top:8px"></div>
<div id="sra-summary" class="viz-row" style="margin-top:12px"></div>
<div id="sra-grid"></div>
<div class="card" id="sra-detail" style="margin-top:12px" aria-live="polite">Select a cell to inspect the graded transcript.</div>
<hr>
<h3>Changes between scenarios</h3>
<div id="sra-changes"></div>
<div class="viz-row" id="sra-legend" style="margin-top:8px"></div>
</div>
<script>
const SRA_DATA = {{DATA}};
(function () {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const tasks = SRA_DATA.tasks;
  const OUT = {
    pass: { cls: 'sra-pass', sym: '\\u2713', label: 'pass' },
    fail: { cls: 'sra-fail', sym: '\\u2717', label: 'fail' },
    unexecuted: { cls: 'sra-unexec', sym: '\\u25a1', label: 'unexecuted' }
  };

  function delta(prevCells, cells) {
    let improved = 0, regressed = 0, samePass = 0, sameFail = 0, newly = 0, dropped = 0;
    for (const t of tasks) {
      const p = prevCells ? prevCells[t] : null;
      const c = cells[t] || null;
      if (!p && c) { newly++; continue; }
      if (p && !c) { dropped++; continue; }
      if (!p || !c) continue;
      if (p.outcome === 'pass' && c.outcome === 'pass') samePass++;
      else if (p.outcome !== 'pass' && c.outcome === 'pass') improved++;
      else if (p.outcome === 'pass' && c.outcome !== 'pass') regressed++;
      else sameFail++;
    }
    return { improved, regressed, samePass, sameFail, newly, dropped };
  }

  function showDetail(model, cell) {
    const d = $('sra-detail');
    d.innerHTML = '';
    d.appendChild(el('div', 'sra-kv', ''));
    d.lastChild.appendChild(el('b', null, cell.task));
    d.lastChild.appendChild(document.createTextNode('  \\u00b7  scenario ' + cell.trial + '  \\u00b7  ' + model));
    const outcomeLine = el('div', 'sra-kv', '');
    const dot = el('span', 'sra-dot');
    dot.style.background = cell.outcome === 'pass' ? 'var(--green)' : cell.outcome === 'fail' ? 'var(--red)' : 'var(--muted-foreground)';
    outcomeLine.appendChild(dot);
    outcomeLine.appendChild(el('b', null, OUT[cell.outcome] ? OUT[cell.outcome].label : cell.outcome));
    outcomeLine.appendChild(document.createTextNode('  \\u00b7  model verdict: ' + cell.verdict + (cell.latency ? '  \\u00b7  ' + cell.latency + 's' : '')));
    d.appendChild(outcomeLine);
    d.appendChild(el('div', 'sra-kv', ''));
    d.lastChild.appendChild(el('b', null, 'Grader: '));
    d.lastChild.appendChild(document.createTextNode(cell.reason || '-'));
    if (cell.error) {
      d.appendChild(el('div', 'sra-kv text-destructive', 'Endpoint error: ' + cell.error));
    }
    const checksWrap = el('div', 'sra-kv');
    checksWrap.appendChild(el('b', null, 'Checks: '));
    const ckeys = Object.keys(cell.checks || {});
    if (!ckeys.length) checksWrap.appendChild(document.createTextNode('none (no policy checks for this response type)'));
    ckeys.forEach((k, i) => {
      if (i) checksWrap.appendChild(document.createTextNode(' \\u00b7 '));
      const ok = cell.checks[k] === true;
      const s = el('span', ok ? null : 'text-destructive', k + ': ' + (ok ? 'ok' : 'FAILED'));
      checksWrap.appendChild(s);
    });
    d.appendChild(checksWrap);
    d.appendChild(el('div', 'sra-kv text-small text-muted', 'Response excerpt (first 500 chars; full text in transcripts/):'));
    const pre = el('pre'); const code = el('code'); code.textContent = cell.excerpt || '(empty response)';
    pre.appendChild(code); d.appendChild(pre);
  }

  function cellBtn(cell, taskId, trial) {
    const b = el('button', 'sra-cell cursor-interaction');
    b.type = 'button';
    if (!cell) {
      b.classList.add('sra-miss');
      b.textContent = '\\u2014';
      b.disabled = true;
      b.setAttribute('aria-label', taskId + ' scenario ' + trial + ': not run');
      return b;
    }
    const st = OUT[cell.outcome] || { cls: 'sra-unexec', sym: '\\u25a1', label: cell.outcome };
    b.classList.add(st.cls);
    b.textContent = st.sym;
    b.setAttribute('data-tooltip', taskId + ' \\u00b7 ' + st.label + ' \\u00b7 ' + String(cell.reason || '').slice(0, 110));
    b.setAttribute('aria-label', taskId + ' scenario ' + trial + ': ' + st.label + ' - ' + String(cell.reason || '').slice(0, 90));
    b.addEventListener('click', () => showDetail(SRA_DATA.models[current].model, cell));
    return b;
  }

  let current = 0;

  function renderPanel(mi) {
    current = mi;
    const m = SRA_DATA.models[mi];
    const meta = $('sra-modelmeta');
    meta.textContent = 'model: ' + m.model + '  \\u00b7  provider: ' + m.provider +
      (m.verified ? '  \\u00b7  endpoint verified' : '  \\u00b7  provenance unverified') +
      '  \\u00b7  transcripts: ' + m.count;
    const sum = $('sra-summary');
    sum.innerHTML = '';
    m.scenarios.forEach((s, idx) => {
      const card = el('div', 'card viz-stat sra-stat');
      card.appendChild(el('div', 'text-muted', 'Scenario ' + s.trial + (s.ran ? '' : ' (not run yet)')));
      card.appendChild(el('div', 'viz-stat-value tabular-nums', s.ran ? (s.pass + '/' + s.ran + ' pass') : '\\u2014'));
      card.appendChild(el('div', 'text-small text-muted',
        s.fail + ' fail \\u00b7 ' + s.unexec + ' unexecuted \\u00b7 ' + (tasks.length - s.ran) + ' not run'));
      if (idx > 0) {
        const d = delta(m.scenarios[idx - 1].cells, s.cells);
        const bits = [];
        if (d.improved) bits.push('+' + d.improved + ' improved');
        if (d.regressed) bits.push('\\u2212' + d.regressed + ' regressed');
        if (d.newly) bits.push(d.newly + ' newly run');
        if (d.dropped) bits.push(d.dropped + ' dropped');
        bits.push((d.samePass + d.sameFail) + ' same');
        card.appendChild(el('div', 'text-small text-muted', 'vs scenario ' + (s.trial - 1) + ': ' + bits.join(' \\u00b7 ')));
      }
      sum.appendChild(card);
    });
    const grid = $('sra-grid');
    grid.innerHTML = '';
    const table = el('table', 'table table-sm');
    const thead = el('thead'); const hr = el('tr');
    ['Task', 'Type'].concat(m.scenarios.map(s => 'Scenario ' + s.trial)).forEach(h => {
      const th = el('th', null, h); hr.appendChild(th);
    });
    thead.appendChild(hr); table.appendChild(thead);
    const tbody = el('tbody');
    tasks.forEach(tid => {
      const tr = el('tr');
      const tdT = el('td'); const code = el('code', null, tid); tdT.appendChild(code); tr.appendChild(tdT);
      const tdType = el('td', 'text-small text-muted', (SRA_DATA.types[tid] || ''));
      tr.appendChild(tdType);
      m.scenarios.forEach(s => {
        const td = el('td');
        td.appendChild(cellBtn(s.cells[tid], tid, s.trial));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    grid.appendChild(table);
  }

  const tabs = $('sra-tabs');
  if (SRA_DATA.models.length > 1) {
    tabs.hidden = false;
    SRA_DATA.models.forEach((m, i) => {
      const b = el('button', 'nav-link' + (i === current ? ' active' : ''), m.model);
      b.id = 'sra-tab-' + i;
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-controls', 'sra-grid');
      b.setAttribute('aria-selected', i === current ? 'true' : 'false');
      b.addEventListener('click', () => {
        tabs.querySelectorAll('.nav-link').forEach(x => { x.classList.remove('active'); x.setAttribute('aria-selected', 'false'); });
        b.classList.add('active');
        b.setAttribute('aria-selected', 'true');
        renderPanel(i);
        save();
      });
      tabs.appendChild(b);
    });
  }

  const ch = $('sra-changes');
  SRA_DATA.changes.forEach(c => {
    const p = el('p');
    p.appendChild(el('b', null, 'Scenario ' + c.from + ' \\u2192 ' + c.to + ': '));
    p.appendChild(document.createTextNode(c.text));
    ch.appendChild(p);
  });

  const legend = $('sra-legend');
  [['pass', 'var(--green)', false], ['fail', 'var(--red)', false],
   ['unexecuted (policy ok, no sandbox)', 'var(--muted-foreground)', false],
   ['not run', 'transparent', true]].forEach(([label, color, dashed]) => {
    const wrap = el('span', 'text-small text-muted');
    const dot = el('span', 'sra-dot');
    dot.style.background = color;
    if (dashed) { dot.style.border = '1px dashed var(--border)'; }
    wrap.appendChild(dot);
    wrap.appendChild(document.createTextNode(label));
    legend.appendChild(wrap);
    legend.appendChild(document.createTextNode('   '));
  });

  function save() {
    if (window.zcode && window.zcode.setWidgetState) {
      const m = SRA_DATA.models[current];
      window.zcode.setWidgetState({ modelContent: { model: m ? m.model : null } }).catch(() => {});
    }
  }

  (function init() {
    if (!SRA_DATA.models.length) {
      $('sra-modelmeta').textContent = 'No transcripts yet - run a probe to populate the dashboard.';
      return;
    }
    let want = 0;
    const st = window.zcode && window.zcode.widgetState;
    if (st && st.modelContent && st.modelContent.model) {
      const i = SRA_DATA.models.findIndex(x => x.model === st.modelContent.model);
      if (i >= 0) want = i;
    }
    if (SRA_DATA.models.length > 1) {
      const btn = tabs.querySelectorAll('.nav-link')[want];
      if (btn) btn.click(); else renderPanel(want);
    } else {
      renderPanel(0);
    }
  })();

  document.addEventListener('zcode:set_globals', (ev) => {
    const st = ev.detail && ev.detail.globals && ev.detail.globals.widgetState;
    if (st && st.modelContent && st.modelContent.model && SRA_DATA.models.length > 1) {
      const i = SRA_DATA.models.findIndex(x => x.model === st.modelContent.model);
      if (i >= 0 && i !== current) renderPanel(i);
    }
  });
})();
</script>
"""


def outcome_of(res):
    if res["pass"]:
        return "pass"
    if "unexecuted" in res["reason"].lower():
        return "unexecuted"
    return "fail"


def build_data():
    tasks = {t["id"]: t for t in load_tasks(os.path.join(ROOT, "tasks"))}
    task_ids = sorted(tasks)
    per_model = {}
    meta = {}
    for path in sorted(glob.glob(os.path.join(ROOT, "transcripts", "*.json"))):
        try:
            with open(path, encoding="utf-8") as fh:
                tr = json.load(fh)
        except ValueError:
            continue
        model = tr.get("model") or "unknown"
        task = tasks.get(tr.get("task_id"))
        if task is None:
            continue
        response = tr.get("response", "") or ""
        res = grader.grade(task, response, executor=None)
        parsed = grader.parse_response(response)
        try:
            trial = max(1, int(tr.get("trial", 1)))
        except (TypeError, ValueError):
            trial = 1
        cell = {
            "task": task["id"],
            "trial": trial,
            "outcome": outcome_of(res),
            "verdict": parsed["kind"],
            "reason": res["reason"],
            "checks": res["checks"],
            "latency": tr.get("latency_s"),
            "error": tr.get("error", ""),
            "excerpt": response[:500],
        }
        per_model.setdefault(model, {}).setdefault(trial, {})[task["id"]] = cell
        m = meta.setdefault(model, {"provider": "unverified-alias", "verified": False, "count": 0})
        m["provider"] = tr.get("provider_label", m["provider"])
        m["verified"] = bool(tr.get("endpoint_verified"))
        m["count"] += 1

    models_out = []
    for model in sorted(per_model):
        found = sorted(per_model[model])
        max_t = min(MAX_TRIALS_SHOWN, max(MIN_TRIALS_SHOWN, max(found) if found else 1))
        scenarios = []
        for tnum in range(1, max_t + 1):
            cells = per_model[model].get(tnum, {})
            scenarios.append({
                "trial": tnum,
                "ran": len(cells),
                "pass": sum(1 for c in cells.values() if c["outcome"] == "pass"),
                "fail": sum(1 for c in cells.values() if c["outcome"] == "fail"),
                "unexec": sum(1 for c in cells.values() if c["outcome"] == "unexecuted"),
                "cells": {tid: cells.get(tid) for tid in task_ids},
            })
        models_out.append({
            "model": model,
            "provider": meta[model]["provider"],
            "verified": meta[model]["verified"],
            "count": meta[model]["count"],
            "scenarios": scenarios,
        })

    changes = []
    changes_path = os.path.join(ROOT, "tools", "scenario_changes.json")
    logged = {}
    if os.path.exists(changes_path):
        try:
            with open(changes_path, encoding="utf-8") as fh:
                logged = {p["from"]: p.get("text", "") for p in json.load(fh).get("pairs", [])}
        except (ValueError, KeyError):
            logged = {}
    max_scenario = max([s["trial"] for m in models_out for s in m["scenarios"]] + [MIN_TRIALS_SHOWN])
    for t in range(1, max_scenario):
        changes.append({"from": t, "to": t + 1,
                        "text": logged.get(t) or DEFAULT_CHANGE.format(to=t + 1)})

    return {
        "generated_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "tasks": task_ids,
        "types": {tid: tasks[tid]["type"] for tid in task_ids},
        "models": models_out,
        "changes": changes,
    }


def main():
    data = build_data()
    payload = json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    fragment = FRAGMENT_TEMPLATE.replace("{{DATA}}", payload)
    docs = os.path.join(ROOT, "docs")
    os.makedirs(docs, exist_ok=True)
    frag_path = os.path.join(docs, "dashboard_fragment.html")
    with open(frag_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(fragment)
    print("wrote", os.path.relpath(frag_path, ROOT), "(%d bytes)" % len(fragment.encode("utf-8")))

    render_py = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             "..", "..", "..", "..",
                             ".zcode", "cli", "plugins", "cache", "zcode-plugins-official",
                             "visualize", "0.1.1", "skills", "visualize", "scripts", "render.py")
    standalone = os.path.join(docs, "dashboard.html")
    rendered = False
    if os.path.exists(render_py):
        try:
            if os.path.exists(standalone):
                os.remove(standalone)
            subprocess.run([sys.executable, render_py, frag_path, standalone, "--force"],
                           check=True, capture_output=True)
            rendered = True
        except (subprocess.CalledProcessError, OSError) as exc:
            print("render.py failed (%s); writing plain standalone shell" % type(exc).__name__)
    if not rendered:
        # Standalone shell with a minimal theme-aware subset of the host utilities
        # the fragment relies on (card, pills, table, text classes, viz tokens).
        shell_css = """
:root { color-scheme: light dark;
  --background: light-dark(#ffffff, #17181c); --foreground: light-dark(#1b1c1f, #eceef1);
  --card: light-dark(#ffffff, #202228); --muted: light-dark(#f0f1f3, #26282f);
  --muted-foreground: light-dark(#5f6470, #9aa0ab); --border: light-dark(#dfe1e6, #31343d);
  --green: light-dark(#116329, #2ea043); --red: light-dark(#c22730, #f85149); }
body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.5;
  background: var(--background); color: var(--foreground); max-width: 1000px; margin: 0 auto; padding: 24px 16px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; }
.viz-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: stretch; }
.viz-stat-value { font-size: 22px; font-weight: 500; }
.nav { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0; }
.nav-link { font: inherit; padding: 4px 14px; border-radius: 999px; border: 1px solid var(--border);
  background: transparent; color: var(--foreground); cursor: pointer; }
.nav-link.active { background: var(--foreground); color: var(--background); }
.table { width: 100%; border-collapse: collapse; margin-top: 10px; }
.table th, .table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); }
.table-sm th, .table-sm td { padding: 4px 6px; }
.text-muted { color: var(--muted-foreground); }
.text-small { font-size: 12px; }
.text-destructive { color: var(--red); }
.tabular-nums { font-variant-numeric: tabular-nums; }
.cursor-interaction { cursor: pointer; }
hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
code { font-family: ui-monospace, Consolas, monospace; font-size: 12px; background: var(--muted);
  padding: 1px 5px; border-radius: 6px; }
pre code { display: block; padding: 8px 10px; }
"""
        shell = ("<!doctype html><html><head><meta charset='utf-8'>"
                 "<meta name='viewport' content='width=device-width, initial-scale=1'>"
                 "<title>Safe Repair Agent — scenario dashboard</title>"
                 "<style>" + shell_css + "</style></head><body>"
                 + fragment + "</body></html>")
        with open(standalone, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(shell)
    print("wrote", os.path.relpath(standalone, ROOT), "(standalone)" if rendered else "(styled shell)")


if __name__ == "__main__":
    main()
