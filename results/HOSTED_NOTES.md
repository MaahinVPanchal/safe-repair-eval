# Hosted run notes (auto-updated during probing)

- 2026-11-08: Groq — `llama-3.3-70b-versatile` and `openai/gpt-oss-120b` return
  HTTP 403 on this account (model gated/deprecated; `/v1/models` lists them but
  execution is denied). 60 probe transcripts archived in
  `transcripts/archive-errored/` — these are config errors, not model evidence.
- 2026-11-08: Groq — `qwen/qwen3.8-27b` executes (HTTP 200).
- 2026-11-08: Gemini — `gemini-3-flash-preview` executes (HTTP 200).
  `gemini-2.5-flash`/`pro` also listed.
- 2026-11-08: Nebius — `deepseek-ai/DeepSeek-V4-Pro` executes (HTTP 200).
- 2026-11-08: OpenRouter — `nvidia/nemotron-3-ultra-550b:free` returns HTTP 400
  on a minimal request; skipped for now.
- 2026-11-08: Cloudflare blocks python-urllib's default User-Agent (error 1010) —
  fixed by sending a proper User-Agent header in harness/runner.py.
- 2026-11-08: Free-tier 429 rate limits + transient DNS failures observed during
  bursts — harness/runner.py now retries with exponential backoff (honors
  Retry-After) and paces calls 1.5s apart. Errored probes archived in
  transcripts/archive-errored-429/ and re-fetched on the next resume-safe run.
