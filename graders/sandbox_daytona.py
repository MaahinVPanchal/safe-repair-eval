"""Cloud sandbox executor (Daytona) - the real run_with_sandbox implementation.

Executes untrusted model repairs ONLY inside an isolated Daytona cloud sandbox:
fresh disposable environment, network_block_all=True (the spec requires no
network), no credentials or expected outputs in the sandbox, deleted after use.
All grading (input -> expected-output comparison) stays on this machine; the
sandbox returns stdout only.

Activation: DAYTONA_API_KEY in .env or environment. Without it, this module
returns the honest unexecuted posture and the grader refuses to execute.

Security notes (stated, not implied):
  - the sandbox receives the synthetic task files and the model's repair - the
    same content already sent to model endpoints; only synthetic code, ever
  - the model's code runs remotely: the host is never exposed to it
  - stdin case files are uploaded per run; expected outputs stay local
"""
import json
import os

_ENV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")


def load_env_keys():
    """Minimal .env loader: KEY=VALUE lines, comments/blanks ignored.
    Real environment variables take precedence over .env values."""
    keys = {}
    if os.path.exists(_ENV_PATH):
        for line in open(_ENV_PATH, encoding="utf-8"):
            s = line.strip()
            if s and not s.startswith("#") and "=" in s:
                k, v = s.split("=", 1)
                if v.strip():
                    keys.setdefault(k.strip(), v.strip())
    for k in ("DAYTONA_API_KEY", "E2B_API_KEY"):
        if os.environ.get(k):
            keys[k] = os.environ[k]
    return keys


def sandbox_available():
    return bool(load_env_keys().get("DAYTONA_API_KEY"))


def run_with_sandbox(task, parsed):
    """Executor interface for grader.grade(): (task, parsed) -> (ok, detail).

    One sandbox per call; one process per case. Returns (False, detail) with a
    'sandbox error:' prefix when the sandbox infrastructure itself fails (callers
    can distinguish infra failures from model failures by that prefix).
    """
    api_key = load_env_keys().get("DAYTONA_API_KEY")
    if not api_key:
        return False, "no sandbox adapter: DAYTONA_API_KEY absent (unexecuted posture)"

    try:
        from daytona import Daytona, DaytonaConfig, CreateSandboxParams
    except ImportError:
        return False, "sandbox error: daytona SDK not installed (pip install daytona)"

    daytona = None
    sandbox = None
    try:
        daytona = Daytona(DaytonaConfig(api_key=api_key))
        sandbox = daytona.create(CreateSandboxParams(
            language="python",
            network_block_all=True,  # spec: untrusted code gets no network
        ))

        home = sandbox.get_user_home_dir() or "/home/daytona"
        base = home.rstrip("/") + "/eval"

        tree = dict(task["files"])
        tree.update(task.get("visible_tests", {}))
        tree.update(parsed["files"])  # model repairs overwrite base files

        for rel, content in sorted(tree.items()):
            rel_norm = rel.replace("\\", "/")
            d = os.path.dirname(rel_norm)
            if d:
                r = sandbox.process.exec("mkdir -p '%s/%s'" % (base, d), timeout=15)
                if getattr(r, "exit_code", 1) != 0:
                    return False, "sandbox error: mkdir failed for %s" % rel_norm
            sandbox.fs.upload_file(content.encode("utf-8"), "%s/%s" % (base, rel_norm))

        cases = list(task.get("visible_cases", [])) + list(task.get("hidden_cases", []))
        for i, case in enumerate(cases):
            sandbox.fs.upload_file(case["input"].encode("utf-8"),
                                   "%s/cases/case%02d.json" % (base, i))

        entry = task["entrypoint"].replace("\\", "/")
        for i, case in enumerate(cases):
            resp = sandbox.process.exec(
                "cd '%s' && python '%s' < cases/case%02d.json" % (base, entry, i),
                timeout=25,
            )
            exit_code = getattr(resp, "exit_code", None)
            out = (getattr(resp, "stdout", "") or "").strip()
            if exit_code != 0:
                err = ((getattr(resp, "stderr", "") or "") or out).strip().splitlines()
                tail = err[-1] if err else "unknown"
                return False, "case %d exited nonzero: %s" % (i, tail[:160])
            if len(out) > 4096:
                return False, "case %d output exceeds size limit" % i
            try:
                got = json.loads(out)
            except ValueError:
                return False, "case %d output not serialized JSON" % i
            if got != case["expected"]:
                return False, "case %d mismatch: got %r expected %r" % (i, got, case["expected"])

        return True, "repair passes visible + hidden black-box cases inside Daytona sandbox (network blocked, deleted after)"

    except Exception as exc:
        return False, "sandbox error: %s: %s" % (type(exc).__name__, exc)
    finally:
        if sandbox is not None:
            try:
                sandbox.delete()
            except Exception:
                pass  # auto-stop reclaims it even if delete fails
