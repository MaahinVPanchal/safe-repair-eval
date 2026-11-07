"""Local control server: run eval scenarios live from the React dashboard.

Endpoints (bound to 127.0.0.1 only - never expose beyond localhost):
  GET  /api/state   run status + recent events + transcript count
  GET  /api/models  installed Ollama model names (best effort; manual entry always allowed)
  GET  /api/data    re-export graded data JSON, then serve it
  POST /api/run     start one probe run: {base_url, model, trials[, api_key]}

API keys posted here live in memory only and are never written to disk or logs.
Transcripts are saved by harness.runner.probe (resume-safe, never overwritten).
Run from the repo root:  python tools/eval_server.py   (port 8000)
"""
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request
from urllib.parse import urlparse, parse_qs
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from harness import runner as sra_runner  # noqa: E402
from harness.prompt_builder import load_tasks  # noqa: E402
from graders import sandbox_daytona  # noqa: E402 (module: load_env_keys, sandbox_available)

PORT = 8000
TASKS = load_tasks(os.path.join(ROOT, "tasks"))
TRANSCRIPTS_DIR = os.path.join(ROOT, "transcripts")

# Hosted model providers. Keys resolve SERVER-SIDE from .env/environment and
# are never sent to the browser; the client only sees which providers are ready.
PROVIDERS = {
    "gemini": {"base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
               "env": "GEMINI_API_KEY", "key_url": "https://aistudio.google.com/apikey"},
    "groq": {"base_url": "https://api.groq.com/openai/v1",
             "env": "GROQ_API_KEY", "key_url": "https://console.groq.com/keys"},
    "nebius": {"base_url": "https://api.studio.nebius.ai/v1",
               "env": "NEBIUS_API_KEY", "key_url": "https://studio.nebius.ai"},
    "openrouter": {"base_url": "https://openrouter.ai/api/v1",
                   "env": "OPENROUTER_API_KEY", "key_url": "https://openrouter.ai/keys"},
    "ollama": {"base_url": "http://localhost:11434/v1",
               "env": None, "key_url": None},
}


def provider_status():
    keys = sandbox_daytona.load_env_keys()
    out = []
    for name, p in PROVIDERS.items():
        has_key = True if p["env"] is None else bool(keys.get(p["env"]))
        out.append({"name": name, "base_url": p["base_url"],
                    "has_key": has_key, "key_url": p["key_url"]})
    return out


def sandbox_ready():
    # load_env_keys re-reads .env on every call, so a freshly pasted key is
    # picked up without restarting this server
    return sandbox_daytona.sandbox_available()

STATE = {
    "running": False,
    "config": None,
    "started_utc": None,
    "finished_utc": None,
    "error": "",
    "events": [],
}
LOCK = threading.Lock()


def event(kind, **kw):
    with LOCK:
        STATE["events"].append({"utc": time.strftime("%H:%M:%S"), "kind": kind, **kw})
        del STATE["events"][:-80]


def provider_for(base_url):
    if "generativelanguage" in base_url:
        return "gemini"
    if "groq" in base_url:
        return "groq"
    if "nebius" in base_url:
        return "nebius"
    if "openrouter" in base_url:
        return "openrouter"
    if "localhost" in base_url or "127.0.0.1" in base_url:
        return "ollama-local"
    return "hosted-unverified"


def export_data(progress=None):
    """Re-grade all transcripts (optionally streaming progress events), then
    rebuild the dashboard data and static page."""
    from harness.offline_grade import grade_dir
    grade_dir(TRANSCRIPTS_DIR, os.path.join(ROOT, "tasks"),
              os.path.join(ROOT, "results"), progress=progress)
    for script in ("export_dashboard_json.py", "build_dashboard.py"):
        subprocess.run([sys.executable, os.path.join(ROOT, "tools", script)],
                       cwd=ROOT, capture_output=True)


def grade_saved(path):
    """Grade one saved transcript immediately (offline posture, no execution)
    so the UI can color the cell the moment a response lands."""
    from graders import grader
    with open(path, encoding="utf-8") as fh:
        tr = json.load(fh)
    task = next((t for t in TASKS if t["id"] == tr.get("task_id")), None)
    if task is None:
        return None
    res = grader.grade(task, tr.get("response", ""), executor=None)
    parsed = grader.parse_response(tr.get("response", "") or "")
    usage = tr.get("usage") or {}
    return {"outcome": ("pass" if res["pass"]
                        else "unexecuted" if "unexecuted" in res["reason"].lower()
                        else "fail"),
            "reason": res["reason"][:140],
            "verdict": parsed["kind"],
            "response_head": (tr.get("response", "") or "")[:400],
            "latency": tr.get("latency_s"),
            "tokens": usage.get("total_tokens")}


def run_scenario(cfg):
    try:
        with LOCK:
            STATE.update({
                "running": True,
                "config": {k: cfg[k] for k in ("base_url", "model", "trials", "provider_label")},
                "started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "finished_utc": None,
                "error": "",
            })
        event("run-start", model=cfg["model"], trials=cfg["trials"],
              tasks=[t["id"] for t in TASKS])

        def progress(ev):
            if ev.get("kind") == "start" and ev.get("task"):
                task = next((t for t in TASKS if t["id"] == ev["task"]), None)
                if task:
                    ev["prompt_chars"] = len(sra_runner.build_prompt(task))
                    ev["prompt_head"] = task["brief"][:220]
            if ev.get("kind") == "done" and ev.get("task"):
                try:
                    path = os.path.join(
                        TRANSCRIPTS_DIR, "%s__%s__trial%02d.json"
                        % (ev["task"], sra_runner._slug(cfg["model"]), ev["trial"]))
                    graded = grade_saved(path)
                    if graded:
                        ev.update(graded)
                except Exception as exc:
                    ev["grading_error"] = str(exc)
                # the UI only knows three outcomes; anything else (e.g. a failed
                # endpoint call saved with an error) renders as an honest fail
                if ev.get("outcome") not in ("pass", "fail", "unexecuted"):
                    ev["outcome"] = "fail"
                    ev["reason"] = (ev.get("grading_error")
                                    or ("endpoint error: " + str(ev.get("error") or "unknown")
                                        if ev.get("error") else "response could not be graded"))
            event(**ev)

        saved = sra_runner.probe(
            TASKS, cfg["base_url"], cfg["api_key"], cfg["model"],
            TRANSCRIPTS_DIR, int(cfg["trials"]),
            provider_label=cfg["provider_label"], endpoint_verified=True,
            progress=progress,
        )
        event("run-complete", transcripts_total=len(os.listdir(TRANSCRIPTS_DIR)))
        event("export-start", total=None)
        export_data(progress=progress)
        event("export-done")
    except Exception as exc:
        STATE["error"] = "%s: %s" % (type(exc).__name__, exc)
        event("run-error", error=STATE["error"])
    finally:
        STATE["running"] = False
        STATE["finished_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def ollama_models():
    try:
        with urllib.request.urlopen("http://localhost:11434/api/tags", timeout=3) as r:
            return [m.get("name") for m in json.load(r).get("models", []) if m.get("name")]
    except Exception:
        return []


def transcripts_count():
    try:
        return len([f for f in os.listdir(TRANSCRIPTS_DIR) if f.endswith(".json")])
    except OSError:
        return 0


class Handler(BaseHTTPRequestHandler):
    def _json(self, obj, code=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/state":
            with LOCK:
                snap = dict(STATE)
                snap["events"] = list(STATE["events"][-60:])
            snap["transcripts"] = transcripts_count()
            self._json(snap)
        elif self.path == "/api/models":
            self._json({"models": ollama_models()})
        elif self.path == "/api/providers":
            self._json({"providers": provider_status(),
                        "sandbox_available": sandbox_ready()})
        elif self.path.startswith("/api/transcript"):
            q = parse_qs(urlparse(self.path).query)
            task_id = (q.get("task") or [""])[0]
            model = (q.get("model") or [""])[0]
            try:
                trial = int((q.get("trial") or ["0"])[0])
            except ValueError:
                trial = 0
            if task_id not in {t["id"] for t in TASKS} or not model or not (1 <= trial <= 10):
                self._json({"error": "bad params"}, 400)
                return
            path = os.path.join(TRANSCRIPTS_DIR, "%s__%s__trial%02d.json"
                                % (task_id, sra_runner._slug(model), trial))
            if not os.path.exists(path):
                self._json({"error": "transcript not found"}, 404)
                return
            with open(path, encoding="utf-8") as fh:
                self._json(json.load(fh))
        elif self.path == "/api/data":
            export_data()
            with open(os.path.join(ROOT, "dashboard-app", "public", "data.json"),
                      encoding="utf-8") as fh:
                self._json(json.load(fh))
        else:
            self._json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path != "/api/run":
            self._json({"error": "not found"}, 404)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        except ValueError:
            self._json({"error": "invalid JSON body"}, 400)
            return
        provider = str(body.get("provider") or "").strip()
        base_url = str(body.get("base_url") or "").strip()
        model = str(body.get("model") or "").strip()
        trials = int(body.get("trials") or 1)
        api_key = str(body.get("api_key") or "").strip()
        if provider in PROVIDERS:
            p = PROVIDERS[provider]
            base_url = p["base_url"]
            provider_label = provider
            # key resolution: pasted in the UI (in memory, this run only) > .env > error
            if not api_key and p["env"]:
                api_key = sandbox_daytona.load_env_keys().get(p["env"], "")
            if not api_key:
                if p["env"]:
                    self._json({"error": "no API key: paste one in the panel, or set %s in .env (see %s)"
                                % (p["env"], p["key_url"])}, 400)
                    return
                api_key = "ollama"  # local ollama ignores the key
        else:
            if not base_url:
                self._json({"error": "provider or base_url required"}, 400)
                return
            api_key = api_key or "ollama"
            provider_label = provider_for(base_url)
        if not model or not (1 <= trials <= 10):
            self._json({"error": "model and trials 1-10 required"}, 400)
            return
        with LOCK:
            if STATE["running"]:
                self._json({"error": "a run is already in progress"}, 409)
                return
        cfg = {"base_url": base_url, "model": model, "trials": trials,
               "api_key": api_key, "provider_label": provider_label}
        threading.Thread(target=run_scenario, args=(cfg,), daemon=True).start()
        self._json({"started": True, "config": {k: cfg[k] for k in
                                                ("base_url", "model", "trials", "provider_label")}})

    def log_message(self, fmt, *args):
        pass  # keep the console quiet; never log request bodies (may contain keys)


if __name__ == "__main__":
    os.makedirs(TRANSCRIPTS_DIR, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("Safe Repair Agent control server on http://127.0.0.1:%d" % PORT)
    print("React app: cd dashboard-app && npm run dev  ->  http://localhost:5173")
    server.serve_forever()
