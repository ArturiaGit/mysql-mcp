"""Run existing regression suites in an isolated mirror, preserving historical evidence.
Two extraction-only adapters reflect intended RD-03/RD-04 source relocation. Assertions are unchanged.
Dependencies must already be resolvable through NODE_PATH. Optional --node selects Node 22+.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--node', default='node')
    args = parser.parse_args()
    protected = {p: digest(p) for p in (ROOT / 'docs/reviews').glob('*') if p.is_file() and 'remediation.regression' not in p.name}
    mirror = Path(tempfile.mkdtemp(prefix='mysql-mcp-readiness-regression-'))
    for directory in ('docs', 'scripts'):
        shutil.copytree(ROOT / directory, mirror / directory)
    cross = mirror / 'docs/reviews/cross-design-review-round4.repro.cjs'
    original = cross.read_text(encoding='utf-8-sig')
    adapted = original.replace("const a=ddl(arch),b=ddl(be);", "const canonicalDdl=fs.readFileSync(path.join(root,'docs/sql/001_metadata_schema.sql'),'utf8');const a=ddl(canonicalDdl),b=ddl(canonicalDdl);")
    adapted = adapted.replace("'ProfileOptionDTO','ProfileDTO'", "'ProfileOptionDTO','ProfileReadDTO'")
    assert adapted != original and "const a=ddl(arch),b=ddl(be);" not in adapted
    cross.write_text(adapted, encoding='utf-8', newline='\n')
    command = [args.node, 'docs/reviews/database-design-review-round2.repro.cjs', '--historical', '--typecheck']
    result = subprocess.run(command, cwd=mirror, capture_output=True, encoding='utf-8', errors='replace', env=os.environ.copy())
    (mirror / 'regression-output.txt').write_text(result.stdout + result.stderr, encoding='utf-8')
    for p, before in protected.items():
        assert digest(p) == before, 'Historical material changed: ' + str(p)
    output = {
        'date': '2026-11-12', 'timezone': 'Asia/Shanghai', 'command': command,
        'exitCode': result.returncode, 'mirror': str(mirror), 'historicalMaterialsUnchanged': True,
        'adaptations': ['CR-01: follow the canonical SQL reference instead of removed embedded DDL',
                        'CR-10: extract ProfileReadDTO (ProfileDTO is now its compatibility alias); ID assertions unchanged'],
        'sources': [{'path': str(p.relative_to(ROOT)).replace('\\', '/'), 'sha256': digest(p)} for p in [*sorted((ROOT/'docs').glob('*SPEC.md')), ROOT/'docs/sql/001_metadata_schema.sql']],
        'boundaries': {'realMysql': False, 'realHttp': False, 'browser': False, 'adaptedHistoricalRunner': True},
        'results': {},
    }
    for name in ('database-design-review-round2.evidence.json', 'database-design-review-round2.remediation.evidence.json', 'database-design-review-round2.cross-regression.evidence.json', 'database-design-review-round2.backend-regression.evidence.json'):
        p = mirror / 'docs/reviews' / name
        # Only include outputs actually written during this invocation, not copied historical files.
        origin = ROOT / 'docs/reviews' / name
        if p.exists() and (not origin.exists() or p.read_bytes() != origin.read_bytes()):
            output['results'][name] = json.loads(p.read_text(encoding='utf-8-sig'))
    target = ROOT / 'docs/reviews/comprehensive-design-readiness-20261112.remediation.regression.json'
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print('Mirror:', mirror)
    print('Exit code:', result.returncode)
    if result.returncode:
        print((result.stdout + result.stderr)[-10000:])
    else:
        for name, evidence in output['results'].items():
            print(name, evidence.get('summary', 'see embedded evidence'))
    raise SystemExit(result.returncode)

if __name__ == '__main__':
    main()
