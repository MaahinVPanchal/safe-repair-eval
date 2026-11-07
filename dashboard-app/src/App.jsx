import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from './lib/utils'
import { Dot } from './components/ui'
import { deltaVs, taskStatus } from './components/views'
import { HowItWorks, InspectorModal, TaskGrid, TerminalView } from './components/views'
import { RunPanel, SettingsView } from './components/panels'

function providerFor(baseUrl) {
  if (/generativelanguage/i.test(baseUrl)) return 'gemini'
  if (/groq/i.test(baseUrl)) return 'groq'
  if (/nebius/i.test(baseUrl)) return 'nebius'
  if (/openrouter/i.test(baseUrl)) return 'openrouter'
  if (/localhost|127\.0\.0\.1/i.test(baseUrl)) return 'ollama-local'
  return 'hosted-unverified'
}

export default function App() {
  /* ── state ── */
  const [data, setData] = useState(null)
  const [scenarioIdx, setScenarioIdx] = useState(0)
  const [view, setView] = useState('results')
  const [inspector, setInspector] = useState(null)
  const [runState, setRunState] = useState(null)
  const [form, setForm] = useState({
    provider: 'groq', model: '', trials: 3,
    baseUrl: 'http://localhost:11434/v1', apiKey: ''
  })
  const [ollamaModels, setOllamaModels] = useState([])
  const [providers, setProviders] = useState([])
  const [sandboxOk, setSandboxOk] = useState(null)
  const [creds, setCreds] = useState({})
  const [credDraft, setCredDraft] = useState({})
  const [savedFlash, setSavedFlash] = useState({})
  const [starting, setStarting] = useState(false)
  const wasRunning = useRef(false)

  /* ── data + polling ── */
  const loadData = useCallback(async () => {
    const res = await fetch('/data.json?t=' + Date.now())
    if (res.ok) setData(await res.json())
  }, [])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const res = await fetch('/api/state')
        if (!res.ok) return
        const st = await res.json()
        if (alive) setRunState(st)
        if (wasRunning.current && !st.running) await loadData()
        wasRunning.current = st.running
      } catch { /* server offline */ }
    }
    tick()
    const id = setInterval(tick, 1500)
    return () => { alive = false; clearInterval(id) }
  }, [loadData])

  useEffect(() => {
    fetch('/api/models').then(r => r.json()).then(d => setOllamaModels(d.models || [])).catch(() => {})
    fetch('/api/providers').then(r => r.json()).then(d => {
      setProviders(d.providers || [])
      setSandboxOk(!!d.sandbox_available)
    }).catch(() => {})
  }, [])

  /* ── live overlay: cells color as responses land ── */
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

  /* ── terminal lines with skip collapsing ── */
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

  /* ── ESC closes the inspector modal ── */
  useEffect(() => {
    if (!inspector) return
    const onKey = (e) => { if (e.key === 'Escape') setInspector(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inspector])

  if (!data) return <div className="grid h-screen place-items-center text-muted">Loading graded evidence…</div>

  /* ── derived ── */
  const scenario = data.scenarios[scenarioIdx]
  const prev = scenarioIdx > 0 ? data.scenarios[scenarioIdx - 1] : null
  const delta = prev && scenario ? deltaVs(prev, scenario, data.tasks) : null
  const running = runState ? runState.running : false
  const lastEvent = (runState?.events || []).slice(-1)[0] || null
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
      return { state: 'live-done', cell: { outcome: lv.outcome, reason: lv.reason || '', verdict: '—', checks: {}, excerpt: '' } }
    }
    if (lv && lv.start) return { state: 'live-start', cell: null }
    return { state: 'miss', cell: null }
  }

  /* ── handlers ── */
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
        ? { ...ins, loading: false, record } : ins)
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
        body: JSON.stringify({ provider: 'ollama', model: scenario.model, trials: scenario.trials.length + 1 })
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
        payload.api_key = form.apiKey
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

  async function saveCred(key, value) {
    if (!value) return false
    const res = await fetch('/api/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: { [key]: value } })
    })
    const d = await res.json()
    if (d.credentials) {
      setCreds(d.credentials)
      setSavedFlash(f => ({ ...f, [key]: true }))
      setTimeout(() => setSavedFlash(f => ({ ...f, [key]: false })), 2500)
      fetch('/api/providers').then(r => r.json()).then(x => {
        setProviders(x.providers || [])
        setSandboxOk(!!x.sandbox_available)
      }).catch(() => {})
      return true
    }
    return false
  }

  function fetchCreds() {
    fetch('/api/credentials').then(r => r.json()).then(d => setCreds(d.credentials || {})).catch(() => {})
  }

  /* ── tabs ── */
  const tabs = [
    ...data.scenarios.map((s, i) => ({ id: 's' + i, label: `Scenario ${s.id} · ${s.model}` })),
    { id: 'how', label: 'How it works' },
    { id: 'terminal', label: 'Terminal' },
    { id: 'run', label: `+ Run Scenario ${nextScenarioId}` },
    { id: 'settings', label: '⚙ Settings' }
  ]
  const activeTab = view === 'results' ? 's' + scenarioIdx : view

  return (
    <div className="mx-auto max-w-6xl px-4 pb-14 pt-5">
      <header className="sticky top-0 z-30 -mx-4 mb-4 border-b border-line bg-bg/85 px-4 pb-3 pt-1 backdrop-blur-md">
        <h1 className="text-lg font-semibold tracking-tight">Safe Repair Agent — scenario dashboard</h1>
        <p className="text-sm text-muted">
          A scenario is one experimental configuration (the subject model), run live against
          real endpoints. Within a scenario, trials are independent repeats at temperature 0
          on identical tasks. Generated {data.generated_utc}.
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span><Dot tone="pass" /> pass — graded correct</span>
          <span><Dot tone="fail" /> fail — wrong verdict or constraint violation</span>
          <span><Dot tone="unexec" /> not executed — policy-clean repair, no sandbox (not a failure, not a pass)</span>
          <span><Dot tone="notrun" /> not run</span>
        </div>
        <nav className="mt-3 flex flex-wrap gap-2" aria-label="Views">
          {tabs.map(tb => (
            <button
              key={tb.id}
              className={cn(
                'rounded-full border px-3.5 py-1.5 text-[13px] transition-all hover:-translate-y-px',
                activeTab === tb.id
                  ? 'border-fg bg-fg font-medium text-bg'
                  : 'border-line bg-card text-muted hover:text-fg'
              )}
              onClick={() => {
                if (tb.id.startsWith('s')) {
                  setScenarioIdx(Number(tb.id.slice(1)))
                  setView('results')
                } else {
                  setView(tb.id)
                  if (tb.id === 'settings') fetchCreds()
                }
              }}
            >
              {tb.label}
            </button>
          ))}
        </nav>
      </header>

      {view === 'how' && (
        <HowItWorks
          providers={providers}
          sandboxOk={sandboxOk}
          ollamaModels={ollamaModels}
          lastEvent={lastEvent}
          running={running}
        />
      )}

      {view === 'terminal' && (
        <TerminalView runState={runState} termLines={termLines} onInspect={openInspector} />
      )}

      {view === 'run' && (
        <RunPanel
          form={form} setForm={setForm}
          providers={providers} ollamaModels={ollamaModels}
          sandboxOk={sandboxOk} running={running} starting={starting}
          runState={runState} nextScenarioId={nextScenarioId}
          startRun={startRun}
        />
      )}

      {view === 'results' && scenario && (
        <main className="space-y-4">
          <section className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
            <span>provider: <b>{scenario.provider}</b></span>
            <span>transcripts: <b>{scenario.transcripts}</b></span>
            <span>trials: <b>{scenario.trials.length}</b></span>
            <span>endpoint: <b>{scenario.verified ? 'verified' : 'unverified alias'}</b></span>
            {running
              ? <span className="animate-pulse font-medium text-bad">● LIVE — cells fill as answers land</span>
              : <Button variant="secondary" size="sm" onClick={quickRun} disabled={starting}
                  title="Runs this scenario's model with one more trial than shown (10 fresh calls)">
                  ▶ Run +1 trial live ({scenario.model})
                </Button>}
          </section>

          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {scenario.trials.map(t => (
              <div key={t.trial} className="rounded-2xl border border-line bg-card p-4">
                <div className="text-xs text-muted">Trial {t.trial} · {t.ran}/{data.tasks.length} run</div>
                <div className="my-1 text-2xl font-semibold tabular-nums">{t.ran ? `${t.pass}/${t.ran} pass` : '—'}</div>
                <div className="text-xs text-muted">
                  {t.fail} failed · {t.unexec} not executed · {data.tasks.length - t.ran} not run
                </div>
              </div>
            ))}
            {delta && (
              <div className="rounded-2xl border border-dashed border-line bg-card p-4">
                <div className="text-xs text-muted">vs Scenario {prev.id}</div>
                <div className="my-1 text-2xl font-semibold tabular-nums">{delta.improved} improved</div>
                <div className="text-xs text-muted">{delta.regressed} regressed · {delta.same} same · changed one thing: the subject model</div>
              </div>
            )}
          </section>

          {data.scenarios.length < 3 && (
            <p className="text-sm text-muted">
              Scenario {data.scenarios.length + 1} (a different configuration — e.g. a hosted
              frontier model) is not run yet. Launch it live from the
              {' '}<button className="text-accent underline" onClick={() => setView('run')}>+ Run Scenario</button> tab.
            </p>
          )}

          <TaskGrid data={data} scenario={scenario} maxTrials={maxTrials} cellFor={cellFor} onInspect={openInspector} />

          <section className="pt-2">
            <h2 className="text-base font-semibold">Changes between scenarios</h2>
            {data.changes.map(c => (
              <p key={c.from} className="mt-1 text-sm">
                <b>Scenario {c.from} → {c.to}:</b> {c.text}
              </p>
            ))}
          </section>

          <footer className="mt-5 border-t border-line pt-3 text-xs text-muted">
            Posture: model code is never executed on this machine without an isolated sandbox —
            repair trials that pass all policy checks run in the Daytona cloud sandbox when a
            key is configured, and stay "not executed" otherwise. REPORT/ESCALATE rows are
            keyword-rubric results pending human audit. Every claim traces to a raw transcript
            in transcripts/.
          </footer>
        </main>
      )}

      <InspectorModal inspector={inspector} onClose={() => setInspector(null)} />
    </div>
  )
}
