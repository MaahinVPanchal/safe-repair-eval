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

function TermLine({ ev, onOpen }) {
  const [open, setOpen] = useState(false)
  const t = ev.utc || ''
  if (ev.kind === 'run-start') {
    return <div className="tline dim">── run start · {ev.model} · {ev.trials} trial(s) ──</div>
  }
  if (ev.kind === 'start') {
    return (
      <div
        className="tline send clickable"
        title="click to inspect the full prompt and grading"
        onClick={() => onOpen && onOpen(ev.task, ev.trial, null)}
      >
        <span className="t">{t}</span>▶ SEND {ev.task} · trial {ev.trial} · prompt {ev.prompt_chars || '?'} chars
        {open && <pre className="tpayload">{ev.prompt_head || '(prompt head unavailable)'}</pre>}
      </div>
    )
  }
  if (ev.kind === 'done') {
    const graded = ev.outcome === 'pass' || ev.outcome === 'fail' || ev.outcome === 'unexecuted'
    return (
      <div
        className="tline recv clickable"
        title="click to inspect the full prompt, response, and grading"
        onClick={() => onOpen && onOpen(ev.task, ev.trial, { outcome: ev.outcome, reason: ev.reason })}
      >
        <span className="t">{t}</span>◀ {ev.task} · trial {ev.trial} · {ev.latency != null ? ev.latency + 's' : '—'}{ev.tokens ? ' · ' + ev.tokens + ' tok' : ''}
        {' · model verdict: ' + (ev.verdict || '?')}
        {graded && <span className={ev.outcome === 'pass' ? ' ok' : ev.outcome === 'fail' ? ' bad' : ' dim'}> · GRADED {ev.outcome.toUpperCase()}</span>}
        {ev.reason ? <span className="dim"> — {ev.reason}</span> : null}
        {open && <pre className="tpayload">{ev.response_head || '(no response text)'}</pre>}
      </div>
    )
  }
  if (ev.kind === 'skips') {
    return <div className="tline dim"><span className="t">{t}</span>– {ev.count} already-saved trials skipped (resume-safe, nothing overwritten)</div>
  }
  if (ev.kind === 'skip') {
    return <div className="tline dim"><span className="t">{t}</span>– skip {ev.task} · trial {ev.trial} (already saved)</div>
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
    baseUrl: 'http://localhost:11434/v1',
    model: '',
    trials: 3,
    apiKey: ''
  })
  const [ollamaModels, setOllamaModels] = useState([])
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

  // ollama model list for the dropdown
  useEffect(() => {
    fetch('/api/models').then(r => r.json()).then(d => setOllamaModels(d.models || [])).catch(() => {})
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
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_url: form.baseUrl,
          model: form.model,
          trials: Number(form.trials),
          api_key: form.apiKey
        })
      })
      const body = await res.json()
      if (!res.ok) alert('Run rejected: ' + (body.error || res.status))
      else setView('results')
    } finally {
      setStarting(false)
    }
  }

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
                Base URL
                <input
                  value={form.baseUrl}
                  onChange={e => setForm({ ...form, baseUrl: e.target.value })}
                  placeholder="http://localhost:11434/v1"
                />
              </label>
              <label>
                Model
                <input
                  value={form.model}
                  list="models"
                  onChange={e => setForm({ ...form, model: e.target.value })}
                  placeholder={ollamaModels[0] || 'qwen2.5-coder:3b-8k'}
                />
                <datalist id="models">
                  {ollamaModels.map(m => <option key={m} value={m} />)}
                </datalist>
              </label>
              <label>
                Trials per task (1–10)
                <input
                  type="number" min="1" max="10"
                  value={form.trials}
                  onChange={e => setForm({ ...form, trials: e.target.value })}
                />
              </label>
              <label>
                API key (optional)
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={e => setForm({ ...form, apiKey: e.target.value })}
                  placeholder="ollama needs none; gsk_… / AIza… for hosted"
                />
              </label>
              <div className="muted small">
                provider label: <b>{providerFor(form.baseUrl)}</b>
                {' · '}endpoint will be marked verified (you asserted the provider)
              </div>
              <button
                className="runbtn"
                disabled={starting || running || !form.baseUrl || !form.model}
                type="submit"
              >
                {running ? 'A run is in progress…' : `Run ${form.trials || 1} trial(s) × 10 tasks`}
              </button>
            </form>

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
