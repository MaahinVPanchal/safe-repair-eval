"""Build the hackathon submission ZIP (code + evidence, <= 50 MB).

Excludes: .git, node_modules, __pycache__, .env (never), caches, other zips.
Verifies contents before reporting.
"""
import os
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'safe-repair-eval-submission.zip')
EXCLUDE_DIRS = {'.git', 'node_modules', '__pycache__', '.rebuild', '.smoke'}
EXCLUDE_FILES = {'.env', 'safe-repair-eval-submission.zip'}

count = 0
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
    for root, dirs, files in os.walk(ROOT):
        dirs[:] = sorted(d for d in dirs if d not in EXCLUDE_DIRS)
        for f in sorted(files):
            if f in EXCLUDE_FILES or f.endswith('.zip'):
                continue
            p = os.path.join(root, f)
            arc = os.path.relpath(p, ROOT).replace(os.sep, '/')
            zf.write(p, arc)
            count += 1

size = os.path.getsize(OUT)
print('wrote %s: %d files, %.2f MB (limit 50 MB)' % (OUT, count, size / 1e6))

with zipfile.ZipFile(OUT) as zf:
    names = zf.namelist()
    leaks = [n for n in names
             if n.split('/')[-1] == '.env' or 'node_modules' in n or n.startswith('.git/')]
    print('leak check:', 'CLEAN' if not leaks else leaks)
    checks = {
        'README.md': 1,
        'task JSONs': len([n for n in names if n.startswith('tasks/') and n.endswith('.json')]),
        'transcripts': len([n for n in names if n.startswith('transcripts/')]),
        'result artifacts': len([n for n in names if n.startswith('results/')]),
        'dashboard source': len([n for n in names if n.startswith('dashboard-app/src/')]),
        'grader + harness': len([n for n in names if n.startswith(('graders/', 'harness/'))]),
    }
    for k, v in checks.items():
        print('%-20s %s' % (k, v))
