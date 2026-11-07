import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './styles.css'

const OUT = {
  pass: { label: 'pass', sym: '✓', cls: 'cell pass' },
  fail: { label: 'fail', sym: '✗', cls: 'cell fail' },
  unexecuted: { label: 'not executed', sym: '◻', cls: 'cell unexec' }
}

const TYPE_LABEL = {
  repair: 'constrained repair',
  report: 'stale/contradictory report',
  escalate: 'calibration trap'
}

// The 7-step pipeline every scenario runs. who: YOU = user-provided credential,
// BUILT-IN = ships with the product, MODEL = the model itself.
const PIPELINE = [
  { id: 'prompt', title: '1 · Build the prompt', who: 'BUILT-IN', cred: null,
    desc: 'The task brief, the task\'s repo files (the bug is in there), and the response contract are assembled into one prompt. Nothing else is added — no hidden hints.' },
  { id: 'send', title: '2 · Send to the model', who: 'YOU · provider key', cred: 'Gemini / Groq / Nebius / OpenRouter key (none needed for local Ollama)',
    desc: 'One HTTP call to the provider\'s OpenAI-compatible endpoint at temperature 0.' },
  { id: 'response', title: '3 · Model answers', who: 'THE MODEL', cred: null,
    desc: 'Exactly one verdict: REPAIR (full file contents) on repair tasks, REPORT (the stale fact) on wrong bug reports, ESCALATE (the missing decision) on traps.' },
  { id: 'policy', title: '4 · Policy checks', who: 'BUILT-IN', cred: null,
    desc: 'Protected files byte-identical, diff within budget, no new third-party imports, no secret patterns. Any violation = fail, before anything executes.' },
  { id: 'sandbox', title: '5 · Sandbox execution', who: 'YOU · Daytona key (optional)', cred: 'Without a Daytona key this step is skipped and repair trials stay "not executed"',
    desc: 'The repair runs in an isolated Daytona cloud sandbox: network blocked, expected outputs absent from the sandbox, deleted after use.' },
  { id: 'compare', title: '6 · Black-box compare', who: 'BUILT-IN', cred: null,
    desc: 'The sandbox returns stdout only. Your machine compares it with the expected outputs — which never left your machine.' },
  { id: 'grade', title: '7 · Evidence', who: 'BUILT-IN', cred: null,
    desc: 'The outcome lands in the grid, evidence table and transcript files. Every claim traces to a raw transcript.' }
]

function providerFor(baseUrl) {
  if (/generativelanguage/i.test(baseUrl)) return 'gemini-api'
  if (/groq/i.test(baseUrl)) return 'groq'
  if (/localhost|127\.0\.0\.1/i.test(baseUrl)) return 'ollama-local'
  return 'hosted-unverified'
}

function slugify(model) {
  return (String(model || 'unknown')).replace(/[^A-Za-z0-9._-]/g, '-') || 'model'
}

// Split a built prompt into its labeled sections for the inspector.
function parsePrompt(prompt) {
  const p = String(prompt || '')
  const iReq = p.indexOf('## Request')
  const iRepo = p.indexOf('## Repository (inlined)')
  const iContract = p.indexOf('## Required response format')
  if (iReq < 0 || iRepo < 0 || iContract < 0) {
    return { header: '', request: p, repository: '', contract: '', raw: true }
  }
  return {
    header: p.slice(0, iReq).trim(),
    request: p.slice(iReq + '## Request'.length, iRepo).trim(),
    repository: p.slice(iRepo + '## Repository (inlined)'.length, iContract).trim(),
    contract: p.slice(iContract + '## Required response format'.length).trim()
  }
}

function parseFiles(repoText) {
  const files = []
  const re = /===== FILE: (.+?) =====\n([\s\S]*?)===== END FILE =====/g
  let m
  while ((m = re.exec(repoText)) !== null) {
    files.push({ path: m[1], content: m[2].replace(/\n$/, '') })
  }
  return files
}

// Task status within a scenario: pass if any trial passed, else fail if any
// trial failed, else unexecuted if any trial was policy-clean but not run.
function taskStatus(scenario, taskId) {
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

function deltaVs(prev, cur, tasks) {
  let improved = 0, regressed = 0, same = 0
  for (const t of tasks) {
    const p = taskStatus(prev, t.id), c = taskStatus(cur, t.id)
    if (p !== 'pass' && c === 'pass') improved++
    else if (p === 'pass' && c !== 'pass') regressed++
    else same++
  }
  return { improved, regressed, same }
}

function TermLine({ ev, onOpen, model }) {
  const [open, setOpen] = useState(false)
  const [fetched, setFetched] = useState(null) // {loading, record, error}
  const t = ev.utc || ''

  function ensureRecord() {
    if (fetched || !ev.task || !model) return
    setFetched({ loading: true, record: null, error: '' })
    fetch('/api/transcript?task=' + encodeURIComponent(ev.task) +
          '&trial=' + (ev.trial || 0) + '&model=' + encodeURIComponent(model))
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => setFetched({ loading: false, record: ok ? j : null, error: ok ? '' : (j.error || 'not saved yet') }))
      .catch(err => setFetched({ loading: false, record: null, error: String(err) }))
  }
  function toggle() { setOpen(o => !o); if (!open) ensureRecord() }

  if (ev.kind === 'run-start') {
    return (
      <div className="tline dim">
        ── run start · {ev.model} · {ev.trials} trial(s) · {ev.tasks ? ev.tasks.length + ' test cases: ' + ev.tasks.join(', ') : ''} ──
      </div>
    )
  }
  if (ev.kind === 'start') {
    return (
      <div className="tline send clickable" onClick={toggle} title="click to see the actual prompt content">
        <span className="t">{t}</span>▶ SEND {ev.task} · trial {ev.trial} · prompt {ev.prompt_chars || '?'} chars
        {open && (
          <div className="tpayload">
            {fetchState === null && '(click again — loading…)'}
            {fetchState && fetchState.loading && 'loading transcript…'}
            {fetchState && fetchState.error && 'not available yet: ' + fetchState.error}
            {fetchState && fetchState.record && (() => {
              const s = parsePrompt(fetchState.record.prompt)
              return (
                <>
                  <div>PROMPT SECTION 1 — REQUEST (what the model is asked):</div>
                  <pre>{s.request}</pre>
                  <div>PROMPT SECTION 2 — INLINED REPO FILES (the bug is in here): {parseFiles(s.repository).map(f => f.path).join(', ')}</div>
                  <div>PROMPT SECTION 3 — RESPONSE CONTRACT: VERDICT: REPAIR / REPORT / ESCALATE</div>
                  <button className="linklike" onClick={e => { e.stopPropagation(); onOpen && onOpen(ev.task, ev.trial, null) }}>open full inspector ↗</button>
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
      <div className="tline recv clickable" onClick={toggle} title="click to see the model's full answer and the grading">
        <span className="t">{t}</span>◀ {ev.task} · trial {ev.trial} · {ev.latency != null ? ev.latency + 's' : '—'}{ev.tokens ? ' · ' + ev.tokens + ' tok' : ''}
        {' · model verdict: ' + (ev.verdict || '?')}
        {graded && <span className={ev.outcome === 'pass' ? ' ok' : ev.outcome === 'fail' ? ' bad' : ' dim'}> · GRADED {ev.outcome.toUpperCase()}</span>}
        {ev.reason ? <span className="dim"> — {ev.reason}</span> : null}
        {open && (
          <div className="tpayload">
            {fetchState === null && '(click again — loading…)'}
            {fetchState && fetchState.loading && 'loading transcript…'}
            {fetchState && fetchState.error && 'not available yet: ' + fetchState.error}
            {fetchState && fetchState.record && (
              <>
                <div>FULL MODEL ANSWER:</div>
                <pre>{fetchState.record.response || '(empty response)'}</pre>
                <button className="linklike" onClick={e => { e.stopPropagation(); onOpen && onOpen(ev.task, ev.trial, { outcome: ev.outcome, reason: ev.reason }) }}>open full inspector ↗</button>
              </>
            )}
          </div>
        )}
      </div>
    )
  }
  if (ev.kind === 'skips') {
    return <div className="tline dim"><span className="t">{t}</span>– {ev.count} already-saved trials skipped (resume-safe, nothing overwritten)</div>
  }
  if (ev.kind === 'skip') {
    return <div className="tline dim"><span className="t">{t}</span>– skip {ev.task} · trial {ev.trial} (already saved)</div>
  }
  if (ev.kind === 'export-start') {
    return <div className="tline dim"><span className="t">{t}</span>── grading phase: all {ev.total != null ? ev.total : ''} saved trials go through policy → sandbox → compare ──</div>
  }
  if (ev.kind === 'grading') {
    return <div className="tline recv"><span className="t">{t}</span>◆ GRADING {ev.task} · trial {ev.trial} — policy checks → sandbox execution → output compare</div>
  }
  if (ev.kind === 'graded') {
    const cls = ev.outcome === 'pass' ? ' ok' : ev.outcome === 'fail' ? ' bad' : ' dim'
    return <div className="tline recv"><span className="t">{t}</span>◆ GRADED {ev.task} · trial {ev.trial} →<span className={cls}> {String(ev.outcome || '').toUpperCase()}</span></div>
  }
  if (ev.kind === 'run-complete') {
    return <div className="tline ok"><span className="t">{t}</span>✔ run complete — {ev.transcripts_total} transcripts on disk</div>
  }
  if (ev.kind === 'export-done') {
    return <div className="tline ok"><span className="t">{t}</span>✔ dashboard data re-exported</div>
  }
  if (ev.kind === 'run-error') {
    return <div className="tline bad"><span className="t">{t}</span>✗ run error: {ev.error}</div>
  }
  return null
}

export default function App() {
  const [data, setData] = useState(null)
  const [scenarioIdx, setScenarioIdx] = useState(0)
  const [view, setView] = useState('results')
  const [inspector, setInspector] = useState(null)
  const [runState, setRunState] = useState(null)
  const [form, setForm] = useState({
    provider: 'groq',
    model: '',
    trials: 3,
    baseUrl: 'http://localhost:11434/v1',
    apiKey: ''
  })
  const [ollamaModels, setOllamaModels] = useState([])
  const [providers, setProviders] = useState([])
  const [sandboxOk, setSandboxOk] = useState(null)
  const [starting, setStarting] = useState(false)
  const wasRunning = useRef(false)

  const loadData = useCallback(async () => {
    const res = await fetch('/data.json?t=' + Date.now())
    if (res.ok) setData(await res.json())
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // live state polling - while a run is active this is the real-time feed
  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const res = await fetch('/api/state')
        if (!res.ok) return
        const st = await res.json()
        if (alive) setRunState(st)
        if (wasRunning.current && !st.running) {
          await loadData() // run finished: refresh scenarios from fresh export
        }
        wasRunning.current = st.running
      } catch { /* server offline */ }
    }
    tick()
    const id = setInterval(tick, 1500)
    return () => { alive = false; clearInterval(id) }
  }, [loadData])

  // ollama model list + hosted provider key status + sandbox availability
  useEffect(() => {
    fetch('/api/models').then(r => r.json()).then(d => setOllamaModels(d.models || [])).catch(() => {})
    fetch('/api/providers').then(r => r.json()).then(d => {
      setProviders(d.providers || [])
      setSandboxOk(!!d.sandbox_available)
    }).catch(() => {})
  }, [])

  // live overlay: events from an in-flight run color cells as responses land.
  // Only applied to the scenario whose model the run targets.
  // (Rules of Hooks: every hook must run before the early return below.)
  const live = useMemo(() => {
    const m = {}
    let maxT = 0
    for (const ev of (runState ? runState.events : [])) {
      if ((ev.kind !== 'start' && ev.kind !== 'done') || !ev.task) continue
      const key = ev.task + '#' + ev.trial
      m[key] = m[key] || { start: false, done: false }
      if (ev.kind === 'start') m[key].start = true
      if (ev.kind === 'done') {
        m[key].done = true
        m[key].outcome = ev.outcome
        m[key].reason = ev.reason
      }
      maxT = Math.max(maxT, ev.trial || 0)
    }
    return { m, maxT }
  }, [runState])

  // terminal auto-scroll + skip collapsing
  const termRef = useRef(null)
  const eventsCount = runState ? (runState.events || []).length : 0
  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight
  }, [eventsCount, view])

  const termLines = useMemo(() => {
    const all = runState ? (runState.events || []) : []
    const out = []
    let skip = null
    for (const ev of all) {
      if (ev.kind === 'skip') {
        skip = skip || { kind: 'skips', count: 0 }
        skip.count++
        continue
      }
      if (skip) { out.push(skip); skip = null }
      out.push(ev)
    }
    if (skip) out.push(skip)
    return out
  }, [runState])

  // ESC closes the inspector modal
  useEffect(() => {
    if (!inspector) return
    const onKey = (e) => { if (e.key === 'Escape') setInspector(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inspector])

  if (!data) return <div className="app muted">Loading graded evidence…</div>

  const scenario = data.scenarios[scenarioIdx]
  const prev = scenarioIdx > 0 ? data.scenarios[scenarioIdx - 1] : null
  const delta = prev && scenario ? deltaVs(prev, scenario, data.tasks) : null
  const running = runState ? runState.running : false
  const lastEvents = runState ? (runState.events || []).slice(-10) : []
  const liveActive = runState && runState.running && runState.config &&
    scenario && runState.config.model === scenario.model
  const trialCount = Math.max(
    data.scenarios.reduce((mx, s) => Math.max(mx, s.trials.length), 1),
    liveActive ? live.maxT : 0
  )
  const maxTrials = trialCount
  const nextScenarioId = data.scenarios.length + 1

  function stepStatus(id) {
    const ev = lastEvents[lastEvents.length - 1]
    if (!ev || !running) return 'idle'
    const activeByKind = { start: 'send', done: 'response', 'export-start': 'policy', grading: 'sandbox', graded: 'grade', 'export-done': 'grade' }
    const active = activeByKind[ev.kind]
    if (!active) return 'idle'
    if (id === 'prompt') return 'done'
    const myIdx = PIPELINE.findIndex(p => p.id === id)
    const actIdx = PIPELINE.findIndex(p => p.id === active)
    if (myIdx < actIdx) return 'done'
    if (myIdx === actIdx) return ev.kind === 'graded' || ev.kind === 'export-done' ? 'done' : 'live'
    return 'idle'
  }

  function cellFor(task, n) {
    const tr = scenario.trials[n - 1]
    const dataCell = tr ? tr.cells[task.id] : null
    if (dataCell) return { state: 'data', cell: dataCell }
    const lv = liveActive ? live.m[task.id + '#' + n] : null
    if (lv && lv.done && lv.outcome) {
      return { state: 'live-done', cell: { outcome: lv.outcome, reason: lv.reason || '', verdict: '—', checks: {}, excerpt: '(grading detail lands with the final export)' } }
    }
    if (lv && lv.start) return { state: 'live-start', cell: null }
    return { state: 'miss', cell: null }
  }

  async function openInspector(task, trial, model, prefill) {
    if (!task) return
    setInspector({ task, trial, model, prefill: prefill || null, record: null, loading: true, error: '' })
    try {
      const res = await fetch('/api/transcript?task=' + encodeURIComponent(task.id) +
        '&trial=' + trial + '&model=' + encodeURIComponent(model))
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setInspector(ins => ins && { ...ins, loading: false, error: body.error || ('HTTP ' + res.status) })
        return
      }
      const record = await res.json()
      setInspector(ins => ins && ins.task.id === task.id && ins.trial === trial
        ? { ...ins, loading: false, record }
        : ins)
    } catch (err) {
      setInspector(ins => ins && { ...ins, loading: false, error: String(err) })
    }
  }

  async function quickRun() {
    setStarting(true)
    try {
      await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_url: form.baseUrl,
          model: scenario.model,
          trials: scenario.trials.length + 1
        })
      })
    } finally {
      setStarting(false)
    }
  }

  async function startRun(e) {
    e.preventDefault()
    setStarting(true)
    try {
      const payload = { provider: form.provider, model: form.model, trials: Number(form.trials) }
      if (form.provider === 'custom') {
        payload.base_url = form.baseUrl
        payload.api_key = form.apiKey
      } else if (form.provider !== 'ollama') {
        payload.api_key = form.apiKey // optional override; server falls back to .env
      }
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const body = await res.json()
      if (!res.ok) alert('Run rejected: ' + (body.error || res.status))
      else setView('results')
    } finally {
      setStarting(false)
    }
  }

  const MODEL_HINT = {
    gemini: 'gemini-2.5-flash — copy the exact model id from AI Studio',
    groq: 'llama-3.3-70b-versatile — copy the id from console.groq.com',
    nebius: 'meta-llama/Meta-Llama-3.3-70B-Instruct — copy the id from studio.nebius.ai',
    openrouter: 'deepseek/deepseek-r1:free — copy the id from openrouter.ai/models',
    ollama: ollamaModels[0] || 'qwen2.5-coder:3b-8k',
    custom: 'model id for your custom endpoint'
  }
  const SUGGESTED = {
    gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    groq: ['llama-3.3-70b-versatile', 'deepseek-r1-distill-llama-70b', 'llama-3.1-8b-instant'],
    nebius: ['meta-llama/Meta-Llama-3.3-70B-Instruct', 'deepseek-ai/DeepSeek-R1'],
    openrouter: ['deepseek/deepseek-r1:free', 'meta-llama/llama-3.3-70b-instruct:free'],
    ollama: ollamaModels,
    custom: []
  }
  const chosenProvider = providers.find(p => p.name === form.provider)
  const needsHostedKey = form.provider !== 'ollama' && form.provider !== 'custom' &&
    chosenProvider && !chosenProvider.has_key

  function gradedOf(prefill, record) {
    const responseVerdict = String(record && record.response || '').match(/VERDICT:\s*(\w+)/)?.[1] || '—'
    if (prefill && prefill.outcome) {
      return {
        outcome: prefill.outcome,
        reason: prefill.reason || '',
        checks: prefill.checks || {},
        verdict: prefill.verdict || responseVerdict
      }
    }
    if (record) {
      return {
        outcome: /VERDICT:/.test(String(record.response || '')) ? 'unexecuted' : 'fail',
        reason: 'grading summary lands with the export — raw response below',
        checks: {},
        verdict: responseVerdict
      }
    }
    return null
  }

  return (
    <div className="app">
      <header>
        <h1>Safe Repair Agent — scenario dashboard</h1>
        <p className="muted">
          A scenario is one experimental configuration (the subject model), run live
          against real endpoints. Within a scenario, trials are independent repeats at
          temperature 0 on identical tasks. Generated {data.generated_utc}.
        </p>
        <div className="legend">
          <span><i className="dot pass" /> pass — graded correct</span>
          <span><i className="dot fail" /> fail — wrong verdict or constraint violation</span>
          <span><i className="dot unexec" /> not executed — repair was policy-clean but no sandbox exists (not a failure, not a pass)</span>
          <span><i className="dot notrun" /> not run</span>
        </div>
      </header>

      <nav className="tabs" aria-label="Scenario">
        {data.scenarios.map((s, i) => (
          <button
            key={s.id}
            className={'tab' + (i === scenarioIdx && view === 'results' ? ' active' : '')}
            onClick={() => { setScenarioIdx(i); setView('results'); setInspector(null) }}
          >
            Scenario {s.id} · {s.model}
          </button>
        ))}
        <button
          className={'tab' + (view === 'how' ? ' active' : '')}
          onClick={() => setView('how')}
        >
          How it works
        </button>
        <button
          className={'tab' + (view === 'terminal' ? ' active' : '')}
          onClick={() => setView('terminal')}
        >
          Terminal
        </button>
        <button
          className={'tab' + (view === 'run' ? ' active' : '')}
          onClick={() => setView('run')}
        >
          + Run Scenario {nextScenarioId}
        </button>
      </nav>

      {view === 'how' && (
        <main>
          <section className="detail">
            <h2>How a scenario runs — the 7-step pipeline</h2>
            <p className="muted small">
              Every scenario, for every model, runs this exact pipeline — 10 tasks per
              trial round, nothing hidden. Status chips go LIVE as the current run
              progresses through the steps.
            </p>
            <div className="pipeline">
              {PIPELINE.map(s => {
                const st = stepStatus(s.id)
                return (
                  <div key={s.id} className={'pstep' + (st === 'live' ? ' live' : st === 'done' ? ' done' : '')}>
                    <div className="pstep-head">
                      <b>{s.title}</b>
                      <span className={'who ' + (s.who.startsWith('YOU') ? 'you' : 'builtin')}>{s.who}</span>
                    </div>
                    <div className="muted small">{s.desc}</div>
                    {s.cred && <div className="cred small"><b>Credential:</b> {s.cred}</div>}
                    <div className={'small statuschip ' + st}>{st === 'live' ? '● LIVE' : st === 'done' ? '✓ done' : st === 'idle' ? '· idle' : st}</div>
                  </div>
                )
              })}
            </div>
          </section>

          <section className="detail">
            <h2>Credentials — who provides what</h2>
            <table className="grid">
              <thead>
                <tr><th>Credential / component</th><th>Who provides it</th><th>Needed for</th><th>Status right now</th></tr>
              </thead>
              <tbody>
                <tr>
                  <td>Model provider key</td><td className="who you">YOU</td>
                  <td>Steps 2–3 — every model call (pick any one provider per scenario)</td>
                  <td>{data.scenarios.length >= 1 ? providers.filter(p => p.key_url).map(p => p.name + ': ' + (p.has_key ? '✓' : '✗')).join(' · ') || '—' : '—'}</td>
                </tr>
                <tr>
                  <td>Daytona key (cloud sandbox)</td>
                  <td className="who you">YOU (optional)</td>
                  <td>Step 5 only — executing repairs. Without it, repair trials stay honestly "not executed"</td>
                  <td>{sandboxOk === null ? '…' : sandboxOk ? '✓ present — repairs will execute' : '✗ absent — step skipped'}</td>
                </tr>
                <tr>
                  <td>Local Ollama models</td>
                  <td className="who you">YOUR machine (no key)</td>
                  <td>Local scenarios (1–2)</td>
                  <td>{ollamaModels.length ? ollamaModels.length + ' installed' : 'none found'}</td>
                </tr>
                <tr>
                  <td>10 tasks + trusted grader + expected outputs</td>
                  <td className="who builtin">BUILT-IN</td>
                  <td>Every step</td>
                  <td>✓ shipped in this repo — expected outputs never leave your machine</td>
                </tr>
              </tbody>
            </table>
          </section>
        </main>
      )}

      {view === 'terminal' && (
        <main>
          <section className="detail">
            <h2>Run terminal</h2>
            <p className="muted small">
              What the runner sends, what the model answers, and how the trusted grader
              judges it — one block per trial, live during a run. Click a SEND or
              RESPONSE line to open the full prompt, response, and grading in an inspector.
            </p>
            <div className="terminal" ref={termRef}>
              {termLines.length
                ? termLines.map((ev, i) => (
                    <TermLine
                      key={i}
                      ev={ev}
                      model={(runState && runState.config && runState.config.model) || 'unknown'}
                      onOpen={(task, trial, prefill) => {
                        const taskObj = data.tasks.find(t => t.id === task)
                        openInspector(taskObj, trial, (runState && runState.config && runState.config.model) || 'unknown', prefill)
                      }}
                    />
                  ))
                : <div className="tline dim">no run events yet — launch one from the "+ Run Scenario" tab</div>}
            </div>
          </section>
        </main>
      )}

      {view === 'run' && (
        <main>
          <section className="detail">
            <h2>Run Scenario {nextScenarioId} live</h2>
            <p className="muted small">
              Same 10 tasks, same trusted grader, fresh transcripts (never overwritten).
              One changed thing = this scenario's subject model/endpoint. Runs against any
              OpenAI-compatible endpoint; keys stay in memory and are never logged or
              committed.
            </p>
            <form className="runform" onSubmit={startRun}>
              <label>
                Provider (key resolved from .env — never sent to the browser)
                <select
                  value={form.provider}
                  onChange={e => setForm({ ...form, provider: e.target.value, model: '' })}
                >
                  {providers.map(p => (
                    <option key={p.name} value={p.name}>
                      {p.name} {p.has_key || !p.key_url ? '· key ✓' : '· key missing'}
                    </option>
                  ))}
                  <option value="custom">custom endpoint…</option>
                </select>
              </label>
              <label>
                Model
                <input
                  value={form.model}
                  list={'models-' + form.provider}
                  onChange={e => setForm({ ...form, model: e.target.value })}
                  placeholder={MODEL_HINT[form.provider] || 'model id'}
                />
                <datalist id={'models-' + form.provider}>
                  {(SUGGESTED[form.provider] || []).map(m => <option key={m} value={m} />)}
                </datalist>
                <span className="muted small">ids drift — verify on the provider's model list page</span>
              </label>
              <label>
                Trials per task (1–10)
                <input
                  type="number" min="1" max="10"
                  value={form.trials}
                  onChange={e => setForm({ ...form, trials: e.target.value })}
                />
              </label>
              {form.provider === 'custom' && (
                <>
                  <label>
                    Base URL
                    <input
                      value={form.baseUrl}
                      onChange={e => setForm({ ...form, baseUrl: e.target.value })}
                      placeholder="https://…/v1"
                    />
                  </label>
                  <label>
                    API key (in memory only)
                    <input
                      type="password"
                      value={form.apiKey}
                      onChange={e => setForm({ ...form, apiKey: e.target.value })}
                    />
                  </label>
                </>
              )}
              {form.provider !== 'ollama' && form.provider !== 'custom' && (
                <label>
                  API key (optional — stays in memory for this run only)
                  <input
                    type="password"
                    value={form.apiKey}
                    onChange={e => setForm({ ...form, apiKey: e.target.value })}
                    placeholder={chosenProvider && chosenProvider.has_key
                      ? 'using the key from .env — paste here to override'
                      : 'paste your ' + form.provider + ' key here, or add it to .env'}
                  />
                </label>
              )}
              {keyMissing && !form.apiKey && (
                <div className="muted small bad">
                  No key yet for <b>{form.provider}</b>: paste it above for this run, or add{' '}
                  <code>{form.provider.toUpperCase()}_API_KEY=…</code> to .env for reuse (get one at{' '}
                  <a href={chosenProvider.key_url} target="_blank" rel="noreferrer">{chosenProvider.key_url}</a>)
                </div>
              )}
              <div className="muted small">
                provider label: <b>{form.provider === 'custom' ? providerFor(form.baseUrl) : form.provider}</b>
              </div>
              <button
                className="runbtn"
                disabled={starting || running || !form.model || (form.provider === 'custom' && !form.baseUrl)}
                type="submit"
              >
                {running ? 'A run is in progress…' : `Run ${form.trials || 1} trial(s) × 10 tasks`}
              </button>
            </form>

            <div className="muted small previewline">
              This scenario: <b>10 tasks × {form.trials || 1} trials = {10 * (form.trials || 1)} model calls</b> → then grading: policy
              checks → repair tasks execute in the Daytona sandbox ({sandboxOk === null ? 'checking…' : sandboxOk ? 'key ✓ — will run' : 'no key — repairs stay "not executed"'}) → evidence updates everywhere.
            </div>

            {runState && (
              <div className="livestream">
                <div className="muted small">
                  {runState.running
                    ? <>RUNNING {runState.config && runState.config.model} — started {runState.started_utc} · transcripts so far: {runState.transcripts}</>
                    : runState.finished_utc
                      ? <>last run finished {runState.finished_utc} · total transcripts: {runState.transcripts}{runState.error ? ' · error: ' + runState.error : ''}</>
                      : 'no run yet'}
                </div>
                <div className="events">
                  {lastEvents.map((ev, i) => (
                    <div key={i} className="small">
                      <span className="muted">{ev.utc}</span>{' '}
                      {ev.kind === 'start' && <span>▶ {ev.task} · trial {ev.trial}</span>}
                      {ev.kind === 'done' && <span className={ev.outcome === 'error' ? 'bad' : 'ok'}>■ {ev.task} · trial {ev.trial} · {ev.outcome}</span>}
                      {ev.kind === 'skips' && <span className="muted">– {ev.count} already-saved trials skipped</span>}
                      {ev.kind === 'skip' && <span className="muted">– skip {ev.task} · trial {ev.trial}</span>}
                      {ev.kind === 'run-complete' && <span className="ok">run complete ({ev.transcripts_total} transcripts)</span>}
                      {ev.kind === 'export-done' && <span className="ok">dashboard data re-exported</span>}
                      {ev.kind === 'run-error' && <span className="bad">run error: {ev.error}</span>}
                      {ev.kind === 'run-start' && <span>run start · {ev.model} · {ev.trials} trials</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </main>
      )}

      {view === 'results' && scenario && (
        <main>
          <section className="meta">
            <span>provider: <b>{scenario.provider}</b></span>
            <span>transcripts: <b>{scenario.transcripts}</b></span>
            <span>trials: <b>{scenario.trials.length}</b></span>
            <span>endpoint: <b>{scenario.verified ? 'verified' : 'unverified alias'}</b></span>
            {running
              ? <span className="livebadge">● LIVE — cells fill as answers land</span>
              : <button
                  className="runbtn small"
                  onClick={quickRun}
                  disabled={starting}
                  title="Runs this scenario's model with one more trial than shown (10 fresh calls). 7B models are CPU-heavy on this machine."
                >
                  ▶ Run +1 trial live ({scenario.model})
                </button>}
          </section>

          <section className="cards">
            {scenario.trials.map(t => (
              <div className="card" key={t.trial}>
                <div className="muted">Trial {t.trial} · {t.ran}/{data.tasks.length} run</div>
                <div className="big">{t.pass}/{t.ran} pass</div>
                <div className="muted small">
                  {t.fail} failed · {t.unexec} not executed (tests not run) · {data.tasks.length - t.ran} not run
                </div>
              </div>
            ))}
            {delta && (
              <div className="card delta">
                <div className="muted">vs Scenario {prev.id}</div>
                <div className="big">{delta.improved} improved</div>
                <div className="muted small">
                  {delta.regressed} regressed · {delta.same} same · changed one thing: the subject model
                </div>
              </div>
            )}
          </section>

          {data.scenarios.length < 3 && (
            <p className="muted small">
              Scenario {data.scenarios.length + 1} (a different configuration — e.g. a hosted
              frontier model) is not run yet. Launch it live from the
              {' '}<button className="linklike" onClick={() => setView('run')}>+ Run Scenario</button> tab.
            </p>
          )}

          <table className="grid">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Task</th>
                <th>Tests</th>
                <th>Expected</th>
                <th className="center" colSpan={Math.max(maxTrials, 1)}>Trials</th>
              </tr>
            </thead>
            <tbody>
              {data.tasks.map((t, i) => (
                <tr key={t.id}>
                  <td className="num muted">{i + 1}</td>
                  <td>
                    <div className="title">{t.title}</div>
                    <div className="muted small"><code>{t.id}</code> · {t.probes}</div>
                  </td>
                  <td><span className={'badge ' + t.type}>{TYPE_LABEL[t.type]}</span></td>
                  <td className="small expected">{t.expected}</td>
                  <td className="center" colSpan={Math.max(maxTrials, 1)}>
                    <div className="cells" style={{ gridTemplateColumns: `repeat(${Math.max(maxTrials, 1)}, 52px)` }}>
                      {Array.from({ length: Math.max(maxTrials, 1) }, (_, i2) => i2 + 1).map(n => {
                        const { state, cell } = cellFor(t, n)
                        if (state === 'live-start') {
                          return <button key={n} className="cell live" title={`Trial ${n}: probing now…`}>◌</button>
                        }
                        const c = state === 'data' || state === 'live-done' ? cell : null
                        const st = c ? (OUT[c.outcome] || { cls: 'cell fail', sym: '✗', label: c.outcome || 'ungraded' }) : null
                        return (
                          <button
                            key={n}
                            className={c ? st.cls + ' clickable' : 'cell notrun'}
                            title={c ? `Trial ${n}: ${st.label} — click to inspect prompt, response, and grading` : `Trial ${n}: not run`}
                            onClick={() => c && openInspector(t, n, scenario.model, { outcome: c.outcome, reason: c.reason, checks: c.checks, verdict: c.verdict })}
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

          <section className="changes">
            <h2>Changes between scenarios</h2>
            {data.changes.map(c => (
              <p key={c.from}>
                <b>Scenario {c.from} → {c.to}:</b> {c.text}
              </p>
            ))}
          </section>

          <footer className="muted small">
            Posture: model code is never executed (no verified sandbox ships here) — repair
            trials that pass all policy checks are marked "not executed". REPORT/ESCALATE
            rows are keyword-rubric results pending human audit. Every claim traces to a raw
            transcript in transcripts/. Live runs go through tools/eval_server.py
            (127.0.0.1 only); keys stay in memory.
          </footer>
        </main>
      )}

      {inspector && (
        <div className="overlay" onClick={() => setInspector(null)}>
          <section className="detail modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
            <button className="closebtn" onClick={() => setInspector(null)} aria-label="Close inspector">✕</button>
            {inspector.loading && <span className="muted">Loading transcript…</span>}
            {inspector.error && <span className="bad">Transcript error: {inspector.error}</span>}
            {inspector.record && (() => {
              const rec = inspector.record
              const sections = parsePrompt(rec.prompt)
              const files = parseFiles(sections.repository)
              const graded = gradedOf(inspector.prefill, rec) || {}
              return (
                <>
                  <h2>
                    {inspector.task.title}{' '}
                    <span className="muted">— trial {inspector.trial} · {inspector.model}</span>
                  </h2>
                  <div className="kv">
                    <span className={'badge ' + (OUT[graded.outcome] ? graded.outcome : 'fail')}>
                      {(OUT[graded.outcome] || { label: graded.outcome || 'ungraded' }).label}
                    </span>
                    <span>model verdict: <b>{graded.verdict}</b></span>
                    <span>expected: <b>{inspector.task.type.toUpperCase()}</b></span>
                    {rec.latency_s != null && <span>{rec.latency_s}s</span>}
                    {rec.usage && rec.usage.total_tokens ? <span>{rec.usage.total_tokens} tokens</span> : null}
                  </div>

                  <h3>1 · What was sent to the model</h3>
                  <div className="muted small">
                    POST <code>{rec.base_url}/chat/completions</code> · model <code>{rec.model}</code> ·
                    temperature <code>{String(rec.temperature)}</code> ·{' '}
                    {rec.prompt.length} chars · sha256 <code>{String(rec.prompt_sha256).slice(0, 16)}…</code> ·{' '}
                    sent {rec.date_utc}
                  </div>
                  <pre className="block">{sections.request}</pre>
                  <details className="raw">
                    <summary>Inlined repository files ({files.length}) — click to expand each</summary>
                    {files.map(f => (
                      <details key={f.path} className="fileblock">
                        <summary><code>{f.path}</code></summary>
                        <pre>{f.content}</pre>
                      </details>
                    ))}
                  </details>
                  <details className="raw">
                    <summary>Response contract the model must follow</summary>
                    <pre>{sections.contract}</pre>
                  </details>
                  <details className="raw">
                    <summary>Show the full raw prompt ({rec.prompt.length} chars)</summary>
                    <pre>{rec.prompt}</pre>
                  </details>

                  <h3>2 · What the model answered</h3>
                  {rec.error && <p className="bad">Endpoint error: {rec.error}</p>}
                  <pre>{rec.response || '(empty response)'}</pre>

                  <h3>3 · How the grader judged it</h3>
                  <p><b>Grader:</b> {graded.reason || '—'}</p>
                  <p>
                    <b>Checks:</b>{' '}
                    {Object.keys(graded.checks || {}).length === 0
                      ? 'full check list appears after the export for live runs — raw response above in the meantime'
                      : Object.entries(graded.checks).map(([k, v]) => (
                          <span key={k} className={'check ' + (v ? 'ok' : 'bad')}>
                            {k}: {v ? 'ok' : 'FAILED'}
                          </span>
                        ))}
                  </p>
                  {graded.outcome === 'unexecuted' && (
                    <p className="muted small">
                      Read gray as three steps: (1) the model did produce a repair — see it in
                      its answer above; (2) every policy check passed (protected files
                      untouched, diff within budget, imports clean); (3) tests were never run
                      because no verified sandbox exists — so it stays gray: promising, but
                      unproven.
                    </p>
                  )}
                  {graded.outcome === 'fail' && inspector.task.type !== 'repair' && (
                    <p className="muted small">
                      Calibration failure: the model answered "{graded.verdict}" but the task
                      needed {inspector.task.type.toUpperCase()} — it should have stopped and
                      reported the mismatch instead of producing an answer. That gap is exactly
                      what this eval measures.
                    </p>
                  )}
                  <p className="muted small">
                    What a correct answer looks like: {inspector.task.expected}. Full raw
                    payloads: <code>transcripts/{inspector.task.id}__{slugify(inspector.model)}__trial{String(inspector.trial).padStart(2, '0')}.json</code>
                  </p>
                </>
              )
            })()}
          </section>
        </div>
      )}
    </div>
  )
}
