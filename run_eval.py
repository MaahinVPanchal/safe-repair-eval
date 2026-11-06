"""One-command entrypoint for the Safe Repair Agent eval.

  python run_eval.py --selftest                     # grader self-tests (51 checks)
  python run_eval.py --offline transcripts/         # grade saved transcripts (no execution)
  python run_eval.py --probe --model <id> --trials 3  # probe via EVAL_* env config

Probe mode requires EVAL_BASE_URL + EVAL_API_KEY (+ --model or EVAL_MODEL).
Nothing is submitted, uploaded, or paid for by this script alone.
"""
import argparse
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--selftest", action="store_true", help="run grader self-tests")
    ap.add_argument("--offline", metavar="DIR", help="grade transcript JSON files in DIR")
    ap.add_argument("--probe", action="store_true", help="probe models via EVAL_* env config")
    ap.add_argument("--base-url", default=os.environ.get("EVAL_BASE_URL", ""))
    ap.add_argument("--model", default=os.environ.get("EVAL_MODEL", ""))
    ap.add_argument("--api-key-env", default="EVAL_API_KEY")
    ap.add_argument("--trials", type=int, default=1)
    ap.add_argument("--tasks", default=os.path.join(ROOT, "tasks"))
    ap.add_argument("--out", default=os.path.join(ROOT, "transcripts"))
    ap.add_argument("--results", default=os.path.join(ROOT, "results"))
    args = ap.parse_args(argv)

    if args.selftest:
        proc = subprocess.run([sys.executable, os.path.join(ROOT, "tests", "test_grader.py")])
        return proc.returncode

    if args.offline:
        sys.path.insert(0, ROOT)
        from harness.offline_grade import grade_dir
        grade_dir(args.offline, args.tasks, args.results)
        return 0

    if args.probe:
        api_key = os.environ.get(args.api_key_env, "")
        if not (args.base_url and args.model and api_key):
            print("Probe mode needs EVAL_BASE_URL, EVAL_MODEL and %s (or the equivalent flags)." % args.api_key_env)
            print("Example:")
            print('  EVAL_BASE_URL="https://api.openai.com/v1" EVAL_API_KEY="..." \\')
            print('  python run_eval.py --probe --model "gpt-..." --trials 3')
            return 2
        sys.path.insert(0, ROOT)
        from harness.runner import probe as run_probe
        from harness.prompt_builder import load_tasks
        run_probe(load_tasks(args.tasks), args.base_url, api_key, args.model, args.out, args.trials)
        from harness.offline_grade import grade_dir
        grade_dir(args.out, args.tasks, args.results)
        return 0

    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
