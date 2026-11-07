import React from 'react'
import { Play, Settings as SettingsIcon } from 'lucide-react'
import { cn } from '../lib/utils'
import { Button, Card, Input } from './ui'

const PROVIDER_SUGGESTIONS = {
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  groq: ['llama-3.3-70b-versatile', 'deepseek-r1-distill-llama-70b', 'llama-3.1-8b-instant'],
  nebius: ['meta-llama/Meta-Llama-3.3-70B-Instruct', 'deepseek-ai/DeepSeek-R1'],
  openrouter: ['deepseek/deepseek-r1:free', 'meta-llama/llama-3.3-70b-instruct:free'],
  ollama: [],
  custom: []
}

const MODEL_HINT = (provider, ollamaModels) => ({
  gemini: 'gemini-2.5-flash — copy the exact model id from AI Studio',
  groq: 'llama-3.3-70b-versatile — copy the id from console.groq.com',
  nebius: 'meta-llama/Meta-Llama-3.3-70B-Instruct — copy the id from studio.nebius.ai',
  openrouter: 'deepseek/deepseek-r1:free — copy the id from openrouter.ai/models',
  ollama: ollamaModels[0] || 'qwen2.5-coder:3b-8k',
  custom: 'model id for your custom endpoint'
}[provider] || 'model id')

export function RunPanel({ form, setForm, providers, ollamaModels, sandboxOk,
                           running, starting, runState, nextScenarioId, startRun }) {
  const suggestions = PROVIDER_SUGGESTIONS[form.provider] || ollamaModels
  const chosen = providers.find(p => p.name === form.provider)
  const keyMissing = chosen && chosen.key_url && !chosen.has_key
  const lastEvents = runState ? (runState.events || []).slice(-10) : []

  return (
    <main>
      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Play size={16} />Run Scenario {nextScenarioId} live
        </h2>
        <p className="mt-1 text-sm text-muted">
          Same 10 tasks, same trusted grader, fresh transcripts (never overwritten). One
          changed thing = this scenario's subject model/endpoint. Keys pasted here stay in
          memory for this run only; keys saved in ⚙ Settings are reused every time.
        </p>

        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={startRun}>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Provider (key resolved from ⚙ Settings / .env — never sent to the browser)
            <select
              className="rounded-lg border border-line bg-card px-3 py-2 text-sm text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
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
          <label className="flex flex-col gap-1 text-xs text-muted">
            Model
            <Input
              value={form.model}
              list={'models-' + form.provider}
              onChange={e => setForm({ ...form, model: e.target.value })}
              placeholder={MODEL_HINT(form.provider, ollamaModels)}
            />
            <datalist id={'models-' + form.provider}>
              {suggestions.map(m => <option key={m} value={m} />)}
            </datalist>
            <span>ids drift — verify on the provider's model list page</span>
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            Trials per task (1–10)
            <Input
              type="number" min="1" max="10"
              value={form.trials}
              onChange={e => setForm({ ...form, trials: e.target.value })}
            />
          </label>
          {form.provider !== 'ollama' && form.provider !== 'custom' && (
            <label className="flex flex-col gap-1 text-xs text-muted">
              API key (optional — in memory for this run only)
              <Input
                type="password"
                value={form.apiKey}
                onChange={e => setForm({ ...form, apiKey: e.target.value })}
                placeholder={chosen && chosen.has_key
                  ? 'using the key from ⚙ Settings — paste here to override'
                  : 'paste your ' + form.provider + ' key, or save it in ⚙ Settings'}
              />
            </label>
          )}
          {form.provider === 'custom' && (
            <>
              <label className="flex flex-col gap-1 text-xs text-muted">
                Base URL
                <Input
                  value={form.baseUrl}
                  onChange={e => setForm({ ...form, baseUrl: e.target.value })}
                  placeholder="https://…/v1"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">
                API key (in memory only)
                <Input
                  type="password"
                  value={form.apiKey}
                  onChange={e => setForm({ ...form, apiKey: e.target.value })}
                />
              </label>
            </>
          )}
          {keyMissing && !form.apiKey && (
            <div className="text-xs text-bad sm:col-span-2">
              No key for <b>{form.provider}</b> yet: paste it above for this run, or save it
              in ⚙ Settings (get one at{' '}
              <a className="text-accent underline" href={chosen.key_url} target="_blank" rel="noreferrer">{chosen.key_url}</a>)
            </div>
          )}
          <div className="rounded-lg border border-dashed border-line bg-subtle/50 p-3 text-xs text-muted sm:col-span-2">
            This scenario: <b className="text-fg">10 tasks × {form.trials || 1} trials = {10 * (form.trials || 1)} model calls</b> → then
            grading: policy checks → repair tasks execute in the Daytona sandbox
            ({sandboxOk === null ? 'checking…' : sandboxOk
              ? <span className="text-ok">key ✓ — will run</span>
              : <span>no key — repairs stay "not executed"</span>}) → evidence updates everywhere.
          </div>
          <div className="sm:col-span-2">
            <Button
              className="w-full sm:w-auto"
              disabled={starting || running || !form.model || (form.provider === 'custom' && !form.baseUrl)}
              type="submit"
            >
              {running
                ? <><Loader2 size={14} className="animate-spin" />A run is in progress…</>
                : <><Play size={14} />Run {form.trials || 1} trial(s) × 10 tasks</>}
            </Button>
          </div>
        </form>

        {runState && (
          <div className="mt-4 border-t border-line pt-3">
            <div className="text-xs text-muted">
              {runState.running
                ? <>RUNNING {runState.config && runState.config.model} — started {runState.started_utc} · transcripts so far: {runState.transcripts}</>
                : runState.finished_utc
                  ? <>last run finished {runState.finished_utc} · total transcripts: {runState.transcripts}{runState.error ? ' · error: ' + runState.error : ''}</>
                  : 'no run yet'}
            </div>
            <div className="mt-1 flex flex-col gap-0.5 font-mono text-xs">
              {lastEvents.map((ev, i) => (
                <div key={i}>
                  <span className="text-faint">{ev.utc}</span>{' '}
                  {ev.kind === 'start' && <span>▶ {ev.task} · trial {ev.trial}</span>}
                  {ev.kind === 'done' && <span className={ev.outcome === 'error' ? 'text-bad' : 'text-ok'}>■ {ev.task} · trial {ev.trial} · {ev.outcome}</span>}
                  {ev.kind === 'skips' && <span className="text-faint">– {ev.count} already-saved trials skipped</span>}
                  {ev.kind === 'skip' && <span className="text-faint">– skip {ev.task} · trial {ev.trial}</span>}
                  {ev.kind === 'run-complete' && <span className="text-ok">run complete ({ev.transcripts_total} transcripts)</span>}
                  {ev.kind === 'export-done' && <span className="text-ok">dashboard data re-exported</span>}
                  {ev.kind === 'run-error' && <span className="text-bad">run error: {ev.error}</span>}
                  {ev.kind === 'run-start' && <span>run start · {ev.model} · {ev.trials} trials</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>
    </main>
  )
}

export function SettingsView({ creds, onSave }) {
  const CRED_DEFS = [
    { key: 'GROQ_API_KEY', label: 'Groq', role: 'model provider', hint: 'get a key: https://console.groq.com/keys' },
    { key: 'GEMINI_API_KEY', label: 'Gemini', role: 'model provider', hint: 'get a key: https://aistudio.google.com/apikey' },
    { key: 'NEBIUS_API_KEY', label: 'Nebius', role: 'model provider', hint: 'get a key: https://studio.nebius.ai' },
    { key: 'OPENROUTER_API_KEY', label: 'OpenRouter', role: 'model provider', hint: 'get a key: https://openrouter.ai/keys' },
    { key: 'DAYTONA_API_KEY', label: 'Daytona', role: 'execution sandbox — pipeline step 5', hint: 'get a key: https://app.daytona.io/api' }
  ]
  const [draft, setDraft] = useState({})
  const [flash, setFlash] = useState({})

  function save(key) {
    const value = draft[key]
    if (!value) return
    onSave(key, value).then(ok => {
      if (ok) {
        setFlash(f => ({ ...f, [key]: true }))
        setDraft(d => ({ ...d, [key]: '' }))
      }
    })
  }

  return (
    <main>
      <Card className="p-5">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <SettingsIcon size={16} />Credentials — bring your own keys
        </h2>
        <p className="mt-1 text-sm text-muted">
          Keys are stored in the gitignored <code>.env</code> on your machine and resolved
          server-side — they are never rendered back here, only their last 4 characters.
          Everything else (the 10 tasks, the trusted grader, the expected outputs) is built
          in and needs no credentials.
        </p>
        <div className="mt-3">
          {CRED_DEFS.map(c => (
            <div key={c.key} className="flex flex-wrap items-center gap-3 border-b border-line py-3 last:border-0">
              <div className="min-w-56 flex-1">
                <div className="font-medium">{c.label}</div>
                <div className="text-xs text-muted">
                  {c.role} · status:{' '}
                  {creds[c.key]
                    ? (creds[c.key].present
                        ? <span className="text-ok">✓ set ({creds[c.key].masked})</span>
                        : 'not set')
                    : '…'}{' '}
                  · {c.hint}
                </div>
              </div>
              <Input
                type="password"
                className="w-72"
                placeholder="paste key…"
                value={draft[c.key] || ''}
                onChange={e => setDraft({ ...draft, [c.key]: e.target.value })}
              />
              <Button variant="secondary" size="sm" disabled={!draft[c.key]} onClick={() => save(c.key)}>Save</Button>
              {flash[c.key] && <span className="text-xs text-ok">saved ✓</span>}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">
          Saved keys appear as ✓ in the provider dropdown of the Run tab and turn on sandbox
          execution automatically (Daytona). No restart needed.
        </p>
      </Card>
    </main>
  )
}
