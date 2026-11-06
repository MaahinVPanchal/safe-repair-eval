# Video outline (<= 5 minutes) — Safe Repair Agent

One continuous screen recording, terminal + editor only. No slides claims beyond
what the repo shows. Save as a script; record after probes exist and swap real
numbers in.

## 0:00–0:30 — The gap
- Static coding benchmarks collapsed under audit (retractions, defect rates,
  harness effects). What's missing is not "can it code" but: does it repair
  **safely**, honestly, and does it **stop when it should**?
- One sentence of scope honesty: single-shot constrained repair, not long-horizon
  tool agents — stated up front, not hidden.

## 0:30–1:30 — The eval
- Show `tasks/`: 10 tasks, three families —
  1. constrained repair: real bug, protected configs, diff budgets, tempting
     out-of-scope cleanups;
  2. stale/contradictory bug reports: correct answer is REPORT with evidence;
  3. calibration traps: a decision genuinely missing from the repo; correct answer
     is ESCALATE.
- Show the response contract: exactly one of REPAIR / REPORT / ESCALATE.
- Key design point: a perfect patch on a REPORT/ESCALATE trap **fails** — the
  calibration signal is separable from coding ability.

## 1:30–2:45 — The grader
- Show `graders/grader.py`: trusted half never executes model code; policy checks
  before anything else (byte-identical protected paths, diff budget, path
  validation, import allowlist, secret lint as an explicitly heuristic check).
- Black-box hidden checks: candidate gets inputs only, returns JSON; trusted side
  compares against outputs held outside the runtime; nothing inspectable in the
  candidate runtime.
- Be explicit about the posture: no verified sandbox ships here, so model code is
  never executed — repair trials are marked `unexecuted`, stated, not faked.

## 2:45–3:45 — Evidence and honesty
- Show `tests/test_grader.py` run: 51/51 (paraphrase-in, wrong-keyword-out pairs
  for the rubric; planted violations each fail).
- Show a real transcript file: model id, provenance labeled, full prompt+response,
  saved before grading.
- Show the evidence table with trial counts; state the 3–5-trials-per-cell rule and
  the human-audit requirement for REPORT/ESCALATE rows.
- If a model passed everything: say that plainly — a clean pass is a finding.

## 3:45–4:30 — Limitations (say them, don't bury them)
- Single-shot reduction (no agent loop).
- Keyword rubric sharpness for REPORT/ESCALATE + human-audit gate.
- No sandbox yet → repair execution gap, and what the sandbox adapter needs.
- Packaging assumptions (ZIP "code only" wording unverified; resubmission conflict
  unresolved).

## 4:30–5:00 — Reproducibility and roadmap
- One command: `python run_eval.py --selftest`; `--offline`; `--probe`.
- Python 3.12 stdlib only, no installs, free-first.
- Roadmap: sandbox adapter for executed repair evidence; judge-graded expansion of
  the REPORT/ESCALATE rubric; more trials per model.

## Rubric mapping (for the outline, not the video)
- task design & clarity (20) → section 2
- grader reliability/determinism (20) → section 3 + self-test counts
- real-world relevance (15) → section 1
- evidence of model limitations (15) → section 4 (real transcripts only)
- reproducibility (15) → section 5
- human-review/spot-checkability (10) → evidence table + transcript format
- insight (5) → calibration-vs-ability separability, stated scope
