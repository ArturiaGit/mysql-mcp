"""Round-2 bounded document re-review: original API-R1-01..12 only.
No API, MySQL, SSH, TLS, or browser integration tests are executed.
Does not overwrite the round-1 report, audit script, or evidence.
"""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[2]
PREVIOUS = ROOT / 'docs/reviews/api-contract-review.audit.py'
ns = {'__file__': str(PREVIOUS), '__name__': '_previous_audit_helpers'}
exec(compile(PREVIOUS.read_text(encoding='utf-8-sig'), str(PREVIOUS), 'exec'), ns)
section = ns['section']
PARTS = ns['PARTS']


def sql_table(text, name):
    match = re.search(r'CREATE TABLE `' + re.escape(name) + r'` \([\s\S]+?\) ENGINE=', text)
    if not match:
        raise ValueError('Missing reviewed table: ' + name)
    return match.group(0)


def main():
    paths = [
        ROOT / 'docs/API_CONTRACT_SPEC.md',
        ROOT / 'docs/BACKEND_ARCHITECTURE_SPEC.md',
        ROOT / 'docs/FRONTEND_ARCHITECTURE_SPEC.md',
        ROOT / 'docs/reviews/API_CONTRACT_REVIEW.md',
    ]
    contract, backend, frontend, previous_report = [
        p.read_text(encoding='utf-8-sig') for p in paths
    ]
    matrix = section(contract, '### 3.3 ')
    registered = set(re.findall(r'^\| `(ERR_[A-Z0-9_]+)`', matrix, re.M))
    referenced = set(re.findall(r'ERR_[A-Z0-9_]+', contract))
    users = sql_table(backend, 'sys_users')
    approvals = sql_table(backend, 'sys_user_approvals')
    lifecycle = section(contract, '### 4.4 ')
    role_update = section(contract, '#### 6.6.3 ')
    tls = re.search(r'export interface TlsConfig \{[\s\S]+?\n  \}', contract).group(0)
    guard = section(backend, '### 5.5 ')
    cas = re.search(r'UPDATE sys_user_approvals[\s\S]+?;', section(contract, '#### 6.2.2 ')).group(0)
    combined = '\n\n---\n\n'.join(
        (ROOT / 'scripts/contract_parts' / p).read_text(encoding='utf-8').strip()
        for p in PARTS
    )
    status = {
        'API-R1-01': 'closed_at_document_level',
        'API-R1-02': 'partially_resolved',
        'API-R1-03': 'partially_resolved',
        'API-R1-04': 'partially_resolved',
        'API-R1-05': 'partially_resolved',
        'API-R1-06': 'closed_at_document_level',
        'API-R1-07': 'closed_at_document_level',
        'API-R1-08': 'closed_at_document_level',
        'API-R1-09': 'closed_at_document_level',
        'API-R1-10': 'closed_at_document_level',
        'API-R1-11': 'closed_at_document_level',
        'API-R1-12': 'partially_resolved',
    }
    # Assertions below guard the evidence capture, not business correctness.
    assert all(key in previous_report for key in status)
    assert len(status) == 12
    result = {
        'review_date': '2026-11-09',
        'scope': 'original API-R1-01 through API-R1-12 only; no new issue categories',
        'verification_kind': 'static_document_review_only',
        'integration_tests_executed': False,
        'inputs': [
            {
                'path': str(p.relative_to(ROOT)),
                'bytes': p.stat().st_size,
                'lines': len(p.read_text(encoding='utf-8-sig').splitlines()),
                'sha256': hashlib.sha256(p.read_bytes()).hexdigest().upper(),
            } for p in paths
        ],
        'structural_observations': {
            'endpoint_count': len(re.findall(r'^- \*\*接口路径\*\*：`([^`]+)`', contract, re.M)),
            'error_matrix_count': len(registered),
            'referenced_but_unregistered_errors': sorted(referenced - registered),
            'contract_matches_generated_parts': contract == combined,
            'tls_config_definition': tls,
            'password_backfill_declares_not_null_default': bool(re.search(
                r'ADD COLUMN `password_updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP', lifecycle)),
            'password_backfill_filters_null': 'WHERE `password_updated_at` IS NULL' in lifecycle,
            'backend_user_ddl_has_password_columns': all(
                '`' + k + '`' in users for k in ['password_updated_at', 'password_expires_days']),
            'backend_user_ddl_has_edit_version': bool(re.search(r'^\s*`version`\s+', users, re.M)),
            'contract_migration_adds_edit_version': bool(re.search(r'ADD COLUMN\s+`?version`?\s+', lifecycle)),
            'backend_guard_mentions_password_expiry': any(k in guard for k in [
                'is_password_expired', 'password_expires_at', 'password_expires_days']),
            'approval_update_statement': cas,
            'backend_approval_table': approvals,
            'role_update_has_indeterminate_immutable_handling': '\u62d2\u7edd\u6216\u5ffd\u7565' in role_update,
            'role_update_statement': role_update.splitlines()[4:8],
        },
        'recorded_review_decisions_not_runtime_test_results': status,
        'summary': {
            'original_items': 12,
            'closed_at_document_level': list(status.values()).count('closed_at_document_level'),
            'partially_resolved': list(status.values()).count('partially_resolved'),
            'remaining_p1': ['API-R1-02', 'API-R1-03', 'API-R1-04'],
            'remaining_p2': ['API-R1-05', 'API-R1-12'],
        },
    }
    output = Path(__file__).with_name('api-contract-review-round2.evidence.json')
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
