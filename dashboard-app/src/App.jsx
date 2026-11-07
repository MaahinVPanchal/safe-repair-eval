import React, { useMemo, useState } from 'react'
import data from './data.json'

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
  let improved = [], regressed = [], same = []
  for (const t of tasks) {
    const p = taskStatus(prev, t.id), c = taskStatus(cur, t.id)
    if (p !== 'pass' && c === 'pass') improved.push(t.id)
    else if (p === 'pass' && c !== 'pass') regressed.push(t.id)
    else same.push(t.id)
  }
  return { improved, regressed, same }
}

export default function App() {
  const [scenarioIdx, setScenarioIdx] = useState(0)
  const [selected, setSelected] = useState(null) // {task, cell, trial}

  const scenario = data.scenarios[scenarioIdx]
  const prev = scenarioIdx > 0 ? data.scenarios[scenarioIdx - 1] : null
  const delta = useMemo(
    () => (prev ? deltaVs(prev, scenario, data.tasks) : null),
    [prev, scenario]
  )
  const maxTrials = Math.max(...data.scenarios.map(s => s.trials.length), 1)

  return (
    <div className="app">
      <header>
        <h1>Safe Repair Agent — scenario dashboard</h1>
        <p className="muted">
          A scenario is one experimental configuration (the subject model). Within a
          scenario, trials are independent repeats at temperature 0 on identical tasks.
          Generated {data.generated_utc}.
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
            className={'tab' + (i === scenarioIdx ? ' active' : '')}
            onClick={() => { setScenarioIdx(i); setSelected(null) }}
          >
            Scenario {s.id} · {s.model}
          </button>
        ))}
      </nav>

      {scenario && (
        <main>
          <section className="meta">
            <span>provider: <b>{scenario.provider}</b></span>
            <span>transcripts: <b>{scenario.transcripts}</b></span>
            <span>trials: <b>{scenario.trials.length}</b></span>
            <span>
              endpoint: <b>{scenario.verified ? 'verified' : 'unverified alias'}</b>
            </span>
          </section>

          <section className="cards">
            {scenario.trials.map(t => (
              <div className="card" key={t.trial}>
                <div className="muted">Trial {t.trial} · {t.ran}/{data.tasks.length} run</div>
                <div className="big">{t.pass}/{t.ran} pass</div>
                <div className="muted small">
                  {t.fail} failed · {t.unexec} not executed · {data.tasks.length - t.ran} not run
                </div>
              </div>
            ))}
            {delta && (
              <div className="card delta">
                <div className="muted">vs Scenario {prev.id}</div>
                <div className="big">{delta.improved.length} improved</div>
                <div className="muted small">
                  {delta.regressed.length} regressed · {delta.same.length} same ·
                  {' '}changed one thing: the subject model
                </div>
              </div>
            )}
          </section>

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
              {data.tasks.map((t, i) => {
                const status = taskStatus(scenario, t.id)
                return (
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
                        {scenario.trials.map(tr => {
                          const c = tr.cells[t.id]
                          const st = c ? OUT[c.outcome] : null
                          return (
                            <button
                              key={tr.trial}
                              className={c ? st.cls + ' clickable' : 'cell notrun'}
                              title={c ? `Trial ${tr.trial}: ${st.label} — ${c.reason}` : `Trial ${tr.trial}: not run`}
                              onClick={() => c && setSelected({ task: t, cell: c, trial: tr.trial })}
                            >
                              {c ? st.sym : '—'}
                            </button>
                          )
                        })}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {selected && (
            <section className="detail" aria-live="polite">
              <h2>
                {selected.task.title}{' '}
                <span className="muted">— trial {selected.trial} · {scenario.model}</span>
              </h2>
              <div className="kv">
                <span className={'badge ' + selected.cell.outcome}>
                  {OUT[selected.cell.outcome].label}
                </span>
                <span>model verdict: <b>{selected.cell.verdict}</b></span>
                {selected.cell.latency != null && <span>{selected.cell.latency}s</span>}
              </div>
              <p><b>Grader:</b> {selected.cell.reason}</p>
              {selected.cell.error && <p className="bad">Endpoint error: {selected.cell.error}</p>}
              <p>
                <b>Checks:</b>{' '}
                {Object.keys(selected.cell.checks || {}).length === 0
                  ? 'none (no policy checks for this response type)'
                  : Object.entries(selected.cell.checks).map(([k, v]) => (
                      <span key={k} className={'check ' + (v ? 'ok' : 'bad')}>
                        {k}: {v ? 'ok' : 'FAILED'}
                      </span>
                    ))}
              </p>
              <p className="muted small">
                What a correct answer looks like: {selected.task.expected}.{' '}
                {selected.task.probes}
              </p>
              <p className="muted small">Response excerpt (full text in transcripts/):</p>
              <pre>{selected.cell.excerpt || '(empty response)'}</pre>
            </section>
          )}

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
            transcript in transcripts/.
          </footer>
        </main>
      )}
    </div>
  )
}
