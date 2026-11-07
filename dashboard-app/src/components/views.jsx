import React, { useEffect, useRef, useState } from 'react'
import {
  Bot, Box, CheckCircle2, Database, FileText, GitCompare, Loader2,
  MinusCircle, Send, ShieldCheck, XCircle
} from 'lucide-react'
import { cn } from '../lib/utils'
import { Badge, Button, Card, Input } from './ui'

/* ─────────────── shared tiny bits ─────────────── */

export const OUT = {
  pass: { label: 'pass', sym: '✓', icon: CheckCircle2, cls: 'cell-pass' },
  fail: { label: 'fail', sym: '✗', icon: XCircle, cls: 'cell-fail' },
  unexecuted: { label: 'not executed', sym: '◻', icon: MinusCircle, cls: 'cell-unexec' }
}

export const TYPE_LABEL = {
  repair: 'constrained repair',
  report: 'stale / contradictory report',
  escalate: 'calibration trap'
}

export function outcomeOf(response) {
  return /VERDICT:/.test(String(response || '')) ? 'unexecuted' : 'fail'
}

export function parsePrompt(prompt) {
  const p = String(prompt || '')
  const iReq = p.indexOf('## Request')
  const iRepo = p.indexOf('## Repository (inlined)')
  const iContract = p.indexOf('## Required response format')
  if (iReq < 0 || iRepo < 0 || iContract < 0) return { request: p, repository: '', contract: '' }
  return {
    request: p.slice(iReq + 10, iRepo).trim(),
    repository: p.slice(iRepo + 22, iContract).trim(),
    contract: p.slice(iContract + 27).trim()
  }
}

export function parseFiles(repoText) {
  const files = []
  const re = /===== FILE: (.+?) =====\n([\s\S]*?)===== END FILE =====/g
  let m
  while ((m = re.exec(repoText)) !== null) files.push({ path: m[1], content: m[2].replace(/\n$/, '') })
  return files
}

export function taskStatus(scenario, taskId) {
  let saw = null
  for (const t of scenario.trials) {
    const c = t.cells[taskId]
    if (!c) continue
    if (c.outcome === 'pass') return 'pass'
    if (c.outcome === 'fail') saw = saw || 'fail'
    if (c.outcome === 'unexecuted') saw = saw || 'unexecuted'
  }
  return saw || 'notrun'
}

export function deltaVs(prev, cur, tasks) {
  let improved = 0, regressed = 0, same = 0
  for (const t of tasks) {
    const p = taskStatus(prev, t.id), c = taskStatus(cur, t.id)
    if (p !== 'pass' && c === 'pass') improved++
    else if (p === 'pass' && c !== 'pass') regressed++
    else same++
  }
  return { improved, regressed, same }
}

export function OutcomeBadge({ outcome }) {
  const Icon = outcome === 'pass' ? CheckCircle2 : outcome === 'fail' ? XCircle : MinusCircle
  return (
    <Badge kind={outcome}>
      <Icon size={11} className="mr-1 inline" />{OUT[outcome] ? OUT[outcome].label : outcome}
    </Badge>
  )
}

/* ─────────────── How it works ─────────────── */

const PIPELINE = [
  { id: 'prompt', title: 'Build the prompt', who: 'BUILT-IN', cred: null, icon: FileText,
    desc: 'The task brief, the task\'s repo files (the bug is in there) and the response contract are assembled into one prompt. Nothing hidden.' },
  { id: 'send', title: 'Send to the model', who: 'YOU · provider key', cred: 'Gemini / Groq / Nebius / OpenRouter key — none needed for local Ollama', icon: Send,
    desc: 'One HTTP call to the provider\'s OpenAI-compatible endpoint at temperature 0.' },
  { id: 'response', title: 'Model answers', who: 'THE MODEL', cred: null, icon: Bot,
    desc: 'Exactly one verdict: REPAIR (full file contents) on repairs, REPORT (the stale fact) on wrong bug reports, ESCALATE (the missing decision) on traps.' },
  { id: 'policy', title: 'Policy checks', who: 'BUILT-IN', cred: null, icon: ShieldCheck,
    desc: 'Protected files byte-identical, diff within budget, no new third-party imports, no secret patterns. Any violation = fail, before anything executes.' },
  { id: 'sandbox', title: 'Sandbox execution', who: 'YOU · Daytona key (optional)', cred: 'Without a Daytona key this step is skipped and repair trials stay "not executed"', icon: Box,
    desc: 'The repair runs in an isolated Daytona cloud sandbox: network blocked, expected outputs absent, deleted after use.' },
  { id: 'compare', title: 'Black-box compare', who: 'BUILT-IN', cred: null, icon: GitCompare,
    desc: 'The sandbox returns stdout only. Your machine compares it against expected outputs that never left it.' },
  { id: 'grade', title: 'Evidence', who: 'BUILT-IN', cred: null, icon: Database,
    desc: 'The outcome lands in the grid, evidence table and transcript files. Every claim traces to a raw transcript.' }
]

export function HowItWorks({ providers, sandboxOk, ollamaModels, lastEvent, running }) {
  const modelKeyStatus = providers.filter(p => p.key_url)
    .map(p => `${p.name}: ${p.has_key ? '✓' : '✗'}`).join(' · ')

  function stepStatus(id) {
    if (!lastEvent || !running) return 'idle'
    const map = { start: 'send', done: 'response', 'export-start': 'policy', grading: 'sandbox', graded: 'grade', 'export-done': 'grade' }
    const active = map[lastEvent.kind]
    if (!active) return 'idle'
    if (id === 'prompt') return 'done'
    const my = PIPELINE.findIndex(p => p.id === id)
    const act = PIPELINE.findIndex(p => p.id === active)
    if (my < act) return 'done'
    if (my === act) return lastEvent.kind === 'graded' || lastEvent.kind === 'export-done' ? 'done' : 'live'
    return 'idle'
  }

  return (
    <main className="space-y-4">
      <Card className="p-5">
        <h2 className="text-base font-semibold">How a scenario runs — the 7-step pipeline</h2>
        <p className="mt-1 text-sm text-muted">
          Every scenario, for every model, runs this exact pipeline — 10 tasks per trial
          round, nothing hidden. Status chips go LIVE as a run progresses.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PIPELINE.map(s => {
            const st = stepStatus(s.id)
            const Icon = s.icon
            return (
              <div key={s.id} className={cn(
                'rounded-xl border p-3 transition-colors',
                st === 'live' && 'border-bad/60 bg-bad/5',
                st === 'done' && 'border-ok/50',
                st === 'idle' && 'border-line'
              )}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-medium"><Icon size={14} />{s.title}</div>
                  <Badge kind={s.who.startsWith('YOU') ? 'you' : 'pass'}>{s.who}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted">{s.desc}</div>
                {s.cred && <div className="mt-1 text-xs text-warn"><b>Credential:</b> {s.cred}</div>}
                <div className={cn('mt-2 text-xs font-medium',
                  st === 'live' && 'text-bad', st === 'done' && 'text-ok', st === 'idle' && 'text-faint')}>
                  {st === 'live' ? '● LIVE' : st === 'done' ? '✓ done' : '· idle'}
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-base font-semibold">Credentials — who provides what</h2>
        <div className="mt-3 space-y-3 text-sm">
          <CredRow who="YOU" what="Model provider key" need="Steps 2–3 — every model call (any one provider per scenario)">
            {modelKeyStatus || '—'}
          </CredRow>
          <CredRow who="YOU (optional)" what="Daytona key (cloud sandbox)"
            need="Step 5 only — executing repairs. Without it, repair trials stay honestly “not executed”">
            {sandboxOk === null ? '…' : sandboxOk
              ? <span className="text-ok">✓ present — repairs will execute</span>
              : <span>✗ absent — step skipped</span>}
          </CredRow>
          <CredRow who="YOUR machine (no key)" what="Local Ollama models" need="Local scenarios (1–2)">
            {ollamaModels.length ? `${ollamaModels.length} installed` : 'none found'}
          </CredRow>
          <CredRow who="BUILT-IN" what="10 tasks + trusted grader + expected outputs" need="Every step">
            <span className="text-ok">✓ shipped in this repo — expected outputs never leave your machine</span>
          </CredRow>
        </div>
        <p className="mt-3 text-xs text-muted">
          Manage keys in the <b>⚙ Settings</b> tab — stored in the gitignored <code>.env</code> on
          your machine, never rendered back, and never leaving it except as the credential itself.
        </p>
      </Card>
    </main>
  )
}

function CredRow({ who, what, need, children }) {
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-1 border-b border-line pb-2 last:border-0">
      <span className="w-44 shrink-0"><Badge kind={who.startsWith('YOU') ? 'you' : 'pass'}>{who}</Badge></span>
      <span className="min-w-40 flex-1 font-medium">{what}</span>
      <span className="min-w-56 flex-1 text-xs text-muted">{need}</span>
      <span className="min-w-24 text-xs">{children}</span>
    </div>
  )
}

/* ─────────────── Terminal ─────────────── */

export function TerminalView({ runState, termLines, onInspect }) {
  const termRef = useRef(null)
  const eventsCount = runState ? (runState.events || []).length : 0
  const model = (runState && runState.config && runState.config.model) || 'unknown'
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [eventsCount])

  return (
    <main>
      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold"><FileText size={16} />Run terminal</h2>
        <p className="mt-1 text-sm text-muted">
          What the runner sends, what the model answers, and how the trusted grader judges it —
          one block per trial, live during a run. Click a line to expand it; "open full
          inspector" shows the complete record.
        </p>
        <div className="terminal mt-3" ref={termRef}>
          {termLines.length
            ? termLines.map((ev, i) => <TermLine key={i} ev={ev} model={model} onInspect={onInspect} />)
            : <div className="tline t-dim">no run events yet — launch one from the "+ Run Scenario" tab</div>}
        </div>
      </Card>
    </main>
  )
}

function TermLine({ ev, onInspect, model }) {
  const [open, setOpen] = useState(false)
  const [fetchState, setFetchState] = useState(null)
  const t = ev.utc || ''

  function ensureRecord() {
    if (fetchState || !ev.task || !model) return
    setFetchState({ loading: true, record: null, error: '' })
    fetch('/api/transcript?task=' + encodeURIComponent(ev.task) +
          '&trial=' + (ev.trial || 0) + '&model=' + encodeURIComponent(model))
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => setFetchState({ loading: false, record: ok ? j : null, error: ok ? '' : (j.error || 'not saved yet') }))
      .catch(err => setFetchState({ loading: false, record: null, error: String(err) }))
  }
  function toggle() { setOpen(o => !o); if (!open) ensureRecord() }

  if (ev.kind === 'run-start') {
    return (
      <div className="tline t-dim">
        ── run start · {ev.model} · {ev.trials} trial(s) · {ev.tasks ? `${ev.tasks.length} test cases: ${ev.tasks.join(', ')}` : ''} ──
      </div>
    )
  }
  if (ev.kind === 'start') {
    return (
      <div className="tline t-send tline-clickable" onClick={toggle} title="click to see the actual prompt content">
        <span className="t-time">{t}</span>▶ SEND {ev.task} · trial {ev.trial} · prompt {ev.prompt_chars || '?'} chars
        {open && (
          <div className="tpayload">
            {fetchState === null && '(loading…)'}
            {fetchState && fetchState.loading && 'loading transcript…'}
            {fetchState && fetchState.error && 'not available yet: ' + fetchState.error}
            {fetchState && fetchState.record && (() => {
              const s = parsePrompt(fetchState.record.prompt)
              return (
                <>
                  <div>PROMPT SECTION 1 — REQUEST (what the model is asked):</div>
                  <pre>{s.request}</pre>
                  <div>PROMPT SECTION 2 — INLINED REPO FILES: {parseFiles(s.repository).map(f => f.path).join(', ')}</div>
                  <div>PROMPT SECTION 3 — RESPONSE CONTRACT: VERDICT REPAIR / REPORT / ESCALATE</div>
                  <button className="linklike" onClick={e => { e.stopPropagation(); onInspect(ev.task, ev.trial, model, null) }}>open full inspector ↗</button>
                </>
              )
            })()}
          </div>
        )}
      </div>
    )
  }
  if (ev.kind === 'done') {
    const graded = ev.outcome === 'pass' || ev.outcome === 'fail' || ev.outcome === 'unexecuted'
    return (
      <div className="tline t-recv tline-clickable" onClick={toggle} title="click to see the model's full answer">
        <span className="t-time">{t}</span>◀ {ev.task} · trial {ev.trial} · {ev.latency != null ? ev.latency + 's' : '—'}{ev.tokens ? ' · ' + ev.tokens + ' tok' : ''}
        {' · model verdict: ' + (ev.verdict || '?')}
        {graded && <span className={ev.outcome === 'pass' ? 't-ok' : ev.outcome === 'fail' ? 't-bad' : 't-dim'}> · GRADED {ev.outcome.toUpperCase()}</span>}
        {ev.reason ? <span className="t-dim"> — {ev.reason}</span> : null}
        {open && (
          <div className="tpayload">
            {fetchState === null && '(loading…)'}
            {fetchState && fetchState.loading && 'loading transcript…'}
            {fetchState && fetchState.error && 'not available yet: ' + fetchState.error}
            {fetchState && fetchState.record && (
              <>
                <div>FULL MODEL ANSWER:</div>
                <pre>{fetchState.record.response || '(empty response)'}</pre>
                <button className="linklike" onClick={e => { e.stopPropagation(); onInspect(ev.task, ev.trial, model, { outcome: ev.outcome, reason: ev.reason }) }}>open full inspector ↗</button>
              </>
            )}
          </div>
        )}
      </div>
    )
  }
  if (ev.kind === 'skips') {
    return <div className="tline t-dim"><span className="t-time">{t}</span>– {ev.count} already-saved trials skipped (resume-safe, nothing overwritten)</div>
  }
  if (ev.kind === 'skip') {
    return <div className="tline t-dim"><span className="t-time">{t}</span>– skip {ev.task} · trial {ev.trial} (already saved)</div>
  }
  if (ev.kind === 'export-start') {
    return <div className="tline t-dim"><span className="t-time">{t}</span>── grading phase: all {ev.total != null ? ev.total : ''} saved trials go through policy → sandbox → compare ──</div>
  }
  if (ev.kind === 'grading') {
    return <div className="tline t-recv"><span className="t-time">{t}</span>◆ GRADING {ev.task} · trial {ev.trial} — policy checks → sandbox execution → output compare</div>
  }
  if (ev.kind === 'graded') {
    const cls = ev.outcome === 'pass' ? 't-ok' : ev.outcome === 'fail' ? 't-bad' : 't-dim'
    return <div className="tline t-recv"><span className="t-time">{t}</span>◆ GRADED {ev.task} · trial {ev.trial} → <span className={cls}>{String(ev.outcome || '').toUpperCase()}</span></div>
  }
  if (ev.kind === 'run-complete') {
    return <div className="tline t-ok"><span className="t-time">{t}</span>✔ run complete — {ev.transcripts_total} transcripts on disk</div>
  }
  if (ev.kind === 'export-done') {
    return <div className="tline t-ok"><span className="t-time">{t}</span>✔ dashboard data re-exported</div>
  }
  if (ev.kind === 'run-error') {
    return <div className="tline t-bad"><span className="t-time">{t}</span>✗ run error: {ev.error}</div>
  }
  return null
}

/* ─────────────── Task grid ─────────────── */

export function TaskGrid({ data, scenario, maxTrials, cellFor, onInspect }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-card">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-subtle text-left text-[11px] uppercase tracking-wider text-muted">
            <th className="w-10 px-3 py-2 font-medium">#</th>
            <th className="px-3 py-2 font-medium">Task</th>
            <th className="px-3 py-2 font-medium">Tests</th>
            <th className="px-3 py-2 font-medium">Expected</th>
            <th className="px-3 py-2 text-center font-medium" colSpan={Math.max(maxTrials, 1)}>Trials</th>
          </tr>
        </thead>
        <tbody>
          {data.tasks.map((t, i) => (
            <tr key={t.id} className="border-t border-line transition-colors hover:bg-accent/5">
              <td className="px-3 py-3 text-muted">{i + 1}</td>
              <td className="px-3 py-3">
                <div className="font-medium">{t.title}</div>
                <div className="mt-0.5 text-xs text-muted"><code>{t.id}</code> · {t.probes}</div>
              </td>
              <td><Badge kind={t.type}>{TYPE_LABEL[t.type]}</Badge></td>
              <td className="max-w-44 px-3 py-3 text-xs text-muted">{t.expected}</td>
              <td className="px-3 py-3" colSpan={Math.max(maxTrials, 1)}>
                <div className="grid justify-start gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(maxTrials, 1)}, 52px)` }}>
                  {Array.from({ length: Math.max(maxTrials, 1) }, (_, k) => k + 1).map(n => {
                    const { state, cell } = cellFor(t, n)
                    if (state === 'live-start') {
                      return (
                        <button key={n} className={cn('cell cell-live')} title={`Trial ${n}: probing now…`}>
                          <Loader2 size={14} className="animate-spin" />
                        </button>
                      )
                    }
                    const c = state === 'data' || state === 'live-done' ? cell : null
                    const st = c ? (OUT[c.outcome] || { sym: '✗', cls: 'cell-fail', label: c.outcome || 'ungraded' }) : null
                    return (
                      <button
                        key={n}
                        className={c ? cn('cell cell-clickable', st.cls) : 'cell cell-notrun'}
                        title={c ? `Trial ${n}: ${st.label} — click to inspect` : `Trial ${n}: not run`}
                        onClick={() => c && onInspect(t, n, scenario.model,
                          { outcome: c.outcome, reason: c.reason, checks: c.checks, verdict: c.verdict })}
                      >
                        {c ? st.sym : '—'}
                      </button>
                    )
                  })}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ─────────────── Inspector modal ─────────────── */

export function InspectorModal({ inspector, onClose, onAudit, auditedFor }) {
  const [auditNote, setAuditNote] = useState('')
  const [auditSent, setAuditSent] = useState(false)
  if (!inspector) return null
  const rec = inspector.record
  const sections = rec ? parsePrompt(rec.prompt) : null
  const files = rec ? parseFiles(sections.repository) : []
  const graded = rec ? (inspector.prefill && inspector.prefill.outcome
    ? { outcome: inspector.prefill.outcome, reason: inspector.prefill.reason || '', checks: inspector.prefill.checks || {},
        verdict: inspector.prefill.verdict || String(rec.response || '').match(/VERDICT:\s*(\w+)/)?.[1] || '—' }
    : { outcome: outcomeOf(rec.response), reason: 'grading summary lands with the export — raw response below',
        checks: {}, verdict: String(rec.response || '').match(/VERDICT:\s*(\w+)/)?.[1] || '—' }) : null
  const audited = rec && inspector.task && onAudit && auditedFor
    ? auditedFor(inspector.task.id, inspector.trial, inspector.model) : null
  const auditable = rec && inspector.task && inspector.task.type !== 'repair' &&
    graded && (graded.outcome === 'pass' || graded.outcome === 'fail')
  return (
    <div className="fixed inset-0 z-60 overflow-y-auto bg-black/55 p-4 backdrop-blur-sm" style={{ animation: 'fadeIn 0.18s ease' }} onClick={onClose}>
      <Card
        className="mx-auto mb-8 w-full max-w-4xl p-5"
        style={{ animation: 'rise 0.22s cubic-bezier(0.2,0.9,0.3,1.2)' }}
        onClick={e => e.stopPropagation()}
      >
        <button className="absolute right-3 top-3 h-8 w-8 rounded-lg border border-line bg-card text-sm hover:bg-subtle" onClick={onClose} aria-label="Close inspector">✕</button>
        {inspector.loading && <span className="muted text-muted">Loading transcript…</span>}
        {inspector.error && <span className="text-bad">Transcript error: {inspector.error}</span>}
        {rec && (
          <>
            <h2 className="text-base font-semibold">{inspector.task.title} <span className="font-normal text-muted">— trial {inspector.trial} · {inspector.model}</span></h2>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
              <OutcomeBadge outcome={graded.outcome} />
              <span>model verdict: <b>{graded.verdict}</b></span>
              <span>expected: <b>{inspector.task.type.toUpperCase()}</b></span>
              {rec.latency_s != null && <span>{rec.latency_s}s</span>}
              {rec.usage && rec.usage.total_tokens ? <span>{rec.usage.total_tokens} tokens</span> : null}
            </div>

            <h3 className="mt-4 font-semibold">1 · What was sent to the model</h3>
            <div className="text-xs text-muted">
              POST <code>{rec.base_url}/chat/completions</code> · model <code>{rec.model}</code> ·
              temperature <code>{String(rec.temperature)}</code> · {rec.prompt.length} chars ·
              sha256 <code>{String(rec.prompt_sha256).slice(0, 16)}…</code> · sent {rec.date_utc}
            </div>
            <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-line bg-subtle p-3 font-mono text-xs">{sections.request}</pre>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-xs text-accent">Inlined repository files ({files.length}) — click to expand each</summary>
              {files.map(f => (
                <details key={f.path} className="ml-3 mt-1">
                  <summary className="cursor-pointer font-mono text-xs">{f.path}</summary>
                  <pre className="mt-1 max-h-60 overflow-auto rounded-lg border border-line bg-subtle p-2 font-mono text-xs">{f.content}</pre>
                </details>
              ))}
            </details>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-xs text-accent">Response contract the model must follow</summary>
              <pre className="mt-1 rounded-lg border border-line bg-subtle p-2 font-mono text-xs">{sections.contract}</pre>
            </details>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-xs text-accent">Show the full raw prompt ({rec.prompt.length} chars)</summary>
              <pre className="mt-1 max-h-72 overflow-auto rounded-lg border border-line bg-subtle p-2 font-mono text-xs">{rec.prompt}</pre>
            </details>

            <h3 className="mt-4 font-semibold">2 · What the model answered</h3>
            {rec.error && <p className="text-bad">Endpoint error: {rec.error}</p>}
            <pre className="mt-1 max-h-80 overflow-auto rounded-lg border border-line bg-subtle p-3 font-mono text-xs">{rec.response || '(empty response)'}</pre>

            <h3 className="mt-4 font-semibold">3 · How the grader judged it</h3>
            <p><b>Grader:</b> {graded.reason || '—'}</p>
            <p>
              <b>Checks:</b>{' '}
              {Object.keys(graded.checks || {}).length === 0
                ? 'full check list appears after the export for live runs'
                : Object.entries(graded.checks).map(([k, v]) => (
                    <span key={k} className={cn('mr-3', v ? 'text-ok' : 'font-medium text-bad')}>{k}: {v ? 'ok' : 'FAILED'}</span>
                  ))}
            </p>
            {graded.outcome === 'unexecuted' && (
              <p className="text-xs text-muted">
                Read gray as three steps: (1) the model did produce a repair — see it above;
                (2) every policy check passed; (3) tests were never run because no verified
                sandbox exists — promising, but unproven.
              </p>
            )}
            {graded.outcome === 'fail' && inspector.task.type !== 'repair' && (
              <p className="text-xs text-muted">
                Calibration failure: the model answered "{graded.verdict}" but the task needed{' '}
                {inspector.task.type.toUpperCase()} — it should have stopped and reported the
                mismatch instead of producing an answer. That gap is exactly what this eval measures.
              </p>
            )}
            {auditable && (
              <div className="mt-3 rounded-xl border border-line bg-subtle/60 p-3">
                <div className="text-sm font-medium">Human audit</div>
                {audited ? (
                  <div className="mt-1 text-xs text-ok">
                    ✓ audited {audited.audited_at} — grader verdict {audited.verdict_confirmed ? 'confirmed' : 'rejected'}
                    {audited.note ? ` — "${audited.note}"` : ''}
                  </div>
                ) : auditSent ? (
                  <div className="mt-1 text-xs text-ok">✓ recorded in results/human_audit_log.json</div>
                ) : (
                  <>
                    <div className="mt-1 text-xs text-muted">
                      Your review is the evidence here: does the grader's verdict match what you
                      see in sections 1–3? This records a permanent audit entry.
                    </div>
                    <input
                      className="mt-2 w-full rounded-lg border border-line bg-card px-3 py-2 text-sm"
                      placeholder="optional note…"
                      value={auditNote}
                      onChange={e => setAuditNote(e.target.value)}
                    />
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" onClick={() => {
                        onAudit(inspector.task.id, inspector.trial, inspector.model, true, auditNote)
                          .then(ok => ok && setAuditSent(true))
                      }}>✓ Confirm grader verdict</Button>
                      <Button size="sm" variant="secondary" onClick={() => {
                        onAudit(inspector.task.id, inspector.trial, inspector.model, false, auditNote)
                          .then(ok => ok && setAuditSent(true))
                      }}>✗ Mark as mis-graded</Button>
                    </div>
                  </>
                )}
              </div>
            )}
            <p className="text-xs text-muted">
              What a correct answer looks like: {inspector.task.expected}. Full raw payloads:{' '}
              <code>transcripts/{inspector.task.id}__{slug(inspector.model)}__trial{String(inspector.trial).padStart(2, '0')}.json</code>
            </p>
          </>
        )}
      </Card>
    </div>
  )
}

function slug(model) {
  return String(model || 'unknown').replace(/[^A-Za-z0-9._-]/g, '-') || 'model'
}

/* ESC handling and modal animation are wired in App.jsx / index.css */
