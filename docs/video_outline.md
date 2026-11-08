# Video recording script (≤ 5 min) — Safe Repair Agent

Recording checklist before you start:
- Both servers up: `python tools\eval_server.py` (terminal 1) + `npm run dev` in
  `dashboard-app` (terminal 2) → http://localhost:5173
- Browser logged into GitHub (for the repo shots), dashboard open on Scenario 1
- Repo page ready: github.com/MaahinVPanchal/safe-repair-eval → README.md

---

## 0:00–0:25 — The hook (the thesis)

**Screen:** README.md on GitHub, scrolled to the top.

**Say:**
> "Every coding benchmark grades one thing: did the code pass the tests. None of
> them ask the question that matters in production — **should this code have been
> written at all?** Safe Repair Agent is an eval with 10 tasks where the correct
> answer is sometimes 'fix this bug'… and sometimes 'this bug report is wrong — I
> refuse'. Four models tested. Every trial graded by a trusted grader, with
> repairs executed inside an isolated cloud sandbox. Here's what they did."

## 0:25–1:00 — Which models we tested (and the ones that died)

**Screen:** README → "Results" section (scoreboard table + bar chart).

**Say:**
> "The ladder: Qwen2.5-Coder 3B locally, 7 trials each. 7B locally. Qwen3.8-27B
> on Groq. And DeepSeek-V4-Pro — a frontier reasoning model — on Nebius. Three
> trials per task each, temperature zero, 140 valid trials total."
>
> "And honestly — three models died getting here. Groq removed Llama-3.1-8B from
> its lineup mid-run and gated the 70B and 120B — 403s on the same key that
> worked that morning. That's all documented in HOSTED_NOTES, with the failed
> probes archived in the repo. An eval should show you its failures too."

## 1:00–2:00 — How testing is done (the pipeline, live)

**Screen:** Dashboard → "How it works" tab. Hover the steps as you narrate.

**Say:**
> "Every trial runs this 7-step pipeline. Step 1 — the prompt: the task brief,
> the task's repo files, and the response contract, assembled into one prompt.
> Nothing hidden. Step 2 — one HTTP call to the model's endpoint at temperature
> zero. Step 3 — the model must answer with exactly one verdict: REPAIR with
> full file contents, REPORT the stale fact, or ESCALATE the missing decision.
> Step 4 — policy checks before anything executes: protected files must be
> byte-identical, diffs within budget, no new imports. Step 5 — the repair runs
> inside an isolated Daytona cloud sandbox with the network blocked. Step 6 —
> black-box compare: the sandbox returns stdout, our machine holds the expected
> outputs. Step 7 — evidence: every outcome lands here with its raw transcript."

**Show:** Terminal tab → click a SEND line → the actual prompt expands inline →
click RESPONSE → the model's full answer.

## 2:00–2:40 — Why Daytona (and where Ollama fits)

**Screen:** "How it works" tab → step 5 card + credentials table.

**Say:**
> "Why a cloud sandbox? Because step 5 executes code written by an AI model —
> untrusted by definition. Daytona gives us a fresh isolated environment with the
> network blocked, no expected outputs inside, deleted when idle. Our machine
> never runs that code. And we keep one warm sandbox and reuse it — the free
> tier caps concurrent sandboxes and denies deletes, so the adapter restarts a
> stopped one instead of hitting the cap."
>
> "Local models run through Ollama — no key, same pipeline. That's how the 3B
> ran seven trials locally. One caveat we hit: the 7B locally crashed this
> machine's CPU, so the bigger models moved to hosted endpoints — which is
> exactly what the provider dropdown is for."

## 2:40–3:40 — Results: what the numbers show

**Screen:** Results tab → Scenario 1 (3B) → executive summary cards. Then
Scenario tabs for 27B and DeepSeek.

**Say:**
> "The scoreboard: DeepSeek-V4-Pro, 77 percent — eleven of twelve executed
> repairs pass. Qwen3.8-27B, 70 percent. 7B, fifty. 3B, twenty. But the number
> that matters is the recklessness index — of the calibration traps, where the
> right answer is to STOP: the 3B patches ninety-plus percent of them. Even the
> frontier model still falls for a third."
>
> "And the repairs themselves — now they actually execute. The 3B's dedupe fix
> passed all seven trials. But its billing, rate-limiter and token repairs ran
> and FAILED — one of them dropped the CLI entrypoint entirely: exit zero, no
> output on a live input. The visible test still passed — the function imported
> fine. The black-box cases caught what the unittest couldn't."

## 3:40–4:30 — Live demo: a trap cell, end to end + the audit click

**Screen:** Scenario 1 → task02 row ("Bug report names a test that does not
exist") → click a red ✗ cell.

**Say:**
> "Here's a trap cell in the inspector. Section 1 — what was sent: the prompt
> with the fabricated bug report. Section 2 — the model's answer: it wrote a
> patch. Section 3 — the grader: fail, required REPORT, got REPAIR. The bug
> doesn't exist — the model 'fixed' nothing, confidently."
>
> "Now the human layer: this eval's natural-language grading is keyword-based —
> so we don't ask you to trust it. I audit every one of these myself — confirm
> or reject the verdict — and it writes to a permanent audit log in the repo.
> That's results slash human_audit_log.json — the audit the rubric asks for."

**Click:** ✓ Confirm grader verdict → show the ✓ recorded state → then show
`results/human_audit_log.json` on GitHub.

**Where the trap cells are:** Results tab → rows for tasks 2, 3, 7, 8, 9 and 10
— the "Tests" column says *stale / contradictory report* or *calibration trap*.
Every colored cell in those rows opens this same inspector.

## 4:30–5:00 — Reproducibility + close

**Screen:** README → Results section (chart) → then terminal: `python run_eval.py --selftest` (51/51 flashes).

**Say:**
> "Reproducing this is one command per step: self-test the grader — 51 checks —
> run any provider from the dashboard, re-grade offline. 140 raw transcripts,
> every claim traceable. Repo, transcripts, audit log — all in the submission.
> Safe Repair Agent: because the most dangerous coding agent isn't the one that
> fails… it's the one that never says stop."

---

## 4:45–5:00 alt — Repo tour (if you have 15 spare seconds)

**Screen:** README → "Repo layout — every folder explained" section.

**Say:**
> "Every folder is annotated in the README: `tasks` is the eval and never talks
> to a model; `graders` is the judge plus the Daytona executor; `harness` runs
> and saves evidence before grading; `transcripts` is every probe verbatim,
> failures archived too; `results` is the scoreboard, the provider-failure log
> and the human audit; `dashboard-app` is the UI you just watched. The full
> annotated tree is in the README — and the adversarial audit that scored the
> early version 61/100 is in docs, with every finding fixed on camera tonight."

## Shot list (quick reference)

| Time | Screen | Action |
|---|---|---|
| 0:00 | GitHub README top | scroll slowly |
| 0:25 | README Results table + chart | slow scroll |
| 1:00 | Dashboard → How it works | hover steps 1→7 |
| 1:45 | Dashboard → Terminal | click SEND, click RESPONSE |
| 2:00 | How it works → step 5 + credentials table | point at Daytona row |
| 2:40 | Results → Scenario 1 exec cards → Scenario 3 → Scenario 4 | tab through |
| 3:40 | Results → task02 red cell → inspector 1/2/3 | scroll sections |
| 4:15 | Inspector audit block → click Confirm | show ✓ recorded |
| 4:25 | GitHub → human_audit_log.json | show entry |
| 4:35 | Terminal: selftest 51/51 | end card |
| (alt) | README Repo layout section | one line per folder |

## Numbers on screen (memorize / have visible)

- DeepSeek-V4-Pro: **77% overall · 11/12 repairs · 67% traps**
- Qwen3.8-27B: **70% overall · 9/12 repairs · 67% traps**
- Qwen2.5-7B: **50%** · Qwen2.5-3B: **20% overall · 92% of repairs failed in sandbox**
- 3B trap calibration: **17%** — patches everything
- 51/51 grader self-tests · 140 valid trials · 56 sandbox executions · 0 unexecuted
