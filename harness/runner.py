"""Single-shot probe runner against any OpenAI-compatible chat endpoint.

Free-first rules: nothing here calls a paid API by itself, embeds a key, or
uploads anywhere. You configure the endpoint via environment variables and
you own the cost. Every raw transcript is saved BEFORE any grading, so a
crashed probe never loses evidence.

Configure via environment:
  export EVAL_BASE_URL="https://api.openai.com/v1"  # or any compatible gateway
  export EVAL_API_KEY="..."                          # never commit this
  export EVAL_MODEL="..."                            # exact deployment id

Provenance honesty: the transcript records exactly what you configured.
A gateway alias is NOT provenance - "endpoint_verified" stays false and
"provider_label" stays "unverified-alias" unless you assert the true
provider in the transcript metadata yourself.
"""
import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from harness.prompt_builder import build_prompt, load_tasks  # noqa: E402

TRANSCRIPT_SCHEMA = "sra-transcript-v1"


def _slug(model):
    """Filesystem-safe slug for a model id, used in transcript filenames."""
    out = "".join(ch if (ch.isalnum() or ch in "._-") else "-" for ch in model)
    return out or "model"


def chat_completion(base_url, api_key, model, prompt, timeout_s=120):
    """One chat completion. Returns (text, usage, latency_seconds)."""
    url = base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer %s" % api_key,
        },
        method="POST",
    )
    started = time.time()
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        body = json.loads(resp.read().decode("utf-8"))
    latency = time.time() - started
    text = body["choices"][0]["message"]["content"]
    return text, body.get("usage", {}), latency


def probe(tasks, base_url, api_key, model, out_dir, trials=1,
          provider_label="unverified-alias", endpoint_verified=False):
    """Runs trials per task, saving each raw transcript immediately."""
    os.makedirs(out_dir, exist_ok=True)
    saved = []
    for task in tasks:
        prompt = build_prompt(task)
        for i in range(1, trials + 1):
            out_path = os.path.join(out_dir, "%s__%s__trial%02d.json"
                                    % (task["id"], _slug(model), i))
            if os.path.exists(out_path):
                saved.append(out_path)
                print("skip existing %s" % os.path.relpath(out_path))
                continue
            record = {
                "schema": TRANSCRIPT_SCHEMA,
                "task_id": task["id"],
                "task_type": task["type"],
                "trial": i,
                "model": model,
                "base_url": base_url,
                "provider_label": provider_label,
                "endpoint_verified": endpoint_verified,
                "date_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "temperature": 0,
                "prompt": prompt,
                "prompt_sha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
                "response": "",
                "usage": {},
                "latency_s": None,
                "error": "",
            }
            try:
                text, usage, latency = chat_completion(base_url, api_key, model, prompt)
                record.update({
                    "response": text,
                    "usage": usage,
                    "latency_s": round(latency, 3),
                })
            except Exception as exc:  # save the failure too - probes are evidence
                record["error"] = "%s: %s" % (type(exc).__name__, exc)
            with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
                json.dump(record, fh, indent=2)
                fh.write("\n")
            saved.append(out_path)
            print("saved %s (%s)" % (os.path.relpath(out_path), record["error"] or "ok"))
    return saved


def main(argv=None):
    ap = argparse.ArgumentParser(description="Probe frontier models with the Safe Repair Agent tasks.")
    ap.add_argument("--tasks", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tasks"))
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "transcripts"))
    ap.add_argument("--trials", type=int, default=1, help="trials per task (final evidence wants 3-5)")
    ap.add_argument("--base-url", default=os.environ.get("EVAL_BASE_URL", ""))
    ap.add_argument("--model", default=os.environ.get("EVAL_MODEL", ""))
    ap.add_argument("--api-key-env", default="EVAL_API_KEY", help="env var holding the API key")
    ap.add_argument("--provider-label", default="unverified-alias",
                    help="true provider identity for transcripts, e.g. ollama-local, groq, gemini-api. "
                         "Labeling asserts you know the real provider (endpoint_verified=True); "
                         "leave unset for gateways you have not verified.")
    args = ap.parse_args(argv)

    api_key = os.environ.get(args.api_key_env, "")
    if not (args.base_url and args.model and api_key):
        print("Missing endpoint config. Set EVAL_BASE_URL, EVAL_MODEL and %s" % args.api_key_env)
        print("(or pass --base-url / --model). Example:")
        print('  EVAL_BASE_URL="https://api.openai.com/v1" EVAL_MODEL="..." EVAL_API_KEY="..." \\')
        print("  python harness/runner.py --trials 3")
        return 2
    tasks = load_tasks(args.tasks)
    labeled = args.provider_label != "unverified-alias"
    probe(tasks, args.base_url, api_key, args.model, args.out, args.trials,
          provider_label=args.provider_label, endpoint_verified=labeled)
    return 0


if __name__ == "__main__":
    sys.exit(main())
