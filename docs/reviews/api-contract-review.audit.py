"""Read-only structural audit; NOT an API/security integration test."""
from pathlib import Path
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / 'docs/API_CONTRACT_SPEC.md'
BACKEND = ROOT / 'docs/BACKEND_ARCHITECTURE_SPEC.md'
FRONTEND = ROOT / 'docs/FRONTEND_ARCHITECTURE_SPEC.md'
PARTS = [
    'part1_intro_and_principles.md',
    'part2_transport_and_protocols.md',
    'part3_error_codes_and_resilience.md',
    'part4_guards_and_lifecycle.md',
    'part5_concurrency_and_security.md',
    'part6_apis_auth_and_approvals.md',
    'part7_apis_users_and_pats.md',
    'part8_apis_profiles_and_roles_acls.md',
    'part9_apis_rate_limits_and_audits.md',
    'part10_apis_settings_and_mock_matrix.md',
]


def section(text, heading):
    lines = text.splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith(heading))
    level = len(lines[start]) - len(lines[start].lstrip('#'))
    for end in range(start + 1, len(lines)):
        match = re.match(r'^(#+) ', lines[end])
        if match and len(match[1]) <= level:
            return '\n'.join(lines[start:end])
    return '\n'.join(lines[start:])


def main():
    contract = CONTRACT.read_text(encoding='utf-8')
    backend = BACKEND.read_text(encoding='utf-8')
    matrix = section(contract, '### 3.3 ')
    registered = set(re.findall(r'^\| `(ERR_[A-Z0-9_]+)`', matrix, re.M))
    referenced = set(re.findall(r'ERR_[A-Z0-9_]+', contract))
    combined = '\n\n---\n\n'.join(
        (ROOT / 'scripts/contract_parts' / name).read_text(encoding='utf-8').strip()
        for name in PARTS
    )
    routes = re.findall(r'^- \*\*接口路径\*\*：`([^`]+)`', contract, re.M)
    observations = {
        'endpoint_count': len(routes),
        'error_matrix_count': len(registered),
        'referenced_but_unregistered_errors': sorted(referenced - registered),
        'contract_matches_generated_parts': combined == contract,
        'password_feature_terms_in_backend': {
            term: backend.count(term) for term in [
                'password_updated_at', 'password_expires_days',
                'password_expires_at', '/auth/password-policy',
            ]
        },
        'tls_config_in_create_profile_section': 'tls_config' in section(contract, '#### 6.5.3 '),
        'tls_config_in_test_db_section': 'tls_config' in section(contract, '#### 6.5.6 '),
        'host_fingerprint_field_in_create_profile_section': bool(re.search(
            r'hostFingerprintSha256|host_fingerprint_sha256', section(contract, '#### 6.5.3 ')
        )),
        'user_list_mentions_version': bool(re.search(r'\bversion\b', section(contract, '#### 6.3.1 '))),
        'user_role_update_mentions_version': bool(re.search(r'\bversion\b', section(contract, '#### 6.3.3 '))),
        'routes': routes,
    }
    result = {
        'review_date': '2026-11-09',
        'verification_kind': 'static_document_structure_only',
        'integration_tests_executed': False,
        'inputs': [
            {
                'path': str(path.relative_to(ROOT)),
                'bytes': path.stat().st_size,
                'lines': len(path.read_text(encoding='utf-8').splitlines()),
                'sha256': hashlib.sha256(path.read_bytes()).hexdigest().upper(),
            }
            for path in [CONTRACT, BACKEND, FRONTEND]
        ],
        'observations': observations,
    }
    output = Path(__file__).with_name('api-contract-review.evidence.json')
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=True, indent=2))


if __name__ == '__main__':
    main()
