"""Mutation controls for the documentation validator; no DB/filesystem writes.

Run: python -B scripts/test_validate_database_design.py
"""
import json
import sys
import unittest

sys.dont_write_bytecode = True
import validate_database_design as validator

DOC = validator.DOC.read_text(encoding='utf-8-sig')
MATRIX = DOC.split('<!-- GENERATED_API_MATRIX_START -->')[1].split('<!-- GENERATED_API_MATRIX_END -->')[0]


def mutate(route, old, new):
    lines = MATRIX.splitlines()
    index = next(i for i, line in enumerate(lines) if line.startswith(f'| `{route}` |'))
    assert old in lines[index], (route, old)
    lines[index] = lines[index].replace(old, new)
    return '\n'.join(lines)


class ApiSemanticValidationTests(unittest.TestCase):
    def test_current_matrix(self):
        validator.validate_api_semantics(MATRIX)

    def test_rejects_all_original_bad_rows(self):
        baseline = json.loads((validator.ROOT / 'docs/reviews/database-design-review.evidence.json').read_text(encoding='utf-8'))
        rows = [baseline['findings'][2]['observed'], *baseline['findings'][3]['observed']]
        for row in rows:
            with self.subTest(route=row['route']):
                current = next(line for line in MATRIX.splitlines() if line.startswith(f"| `{row['route']}` |"))
                bad = f"| `{row['route']}` | {row['tables']} | {row['behavior']} |"
                with self.assertRaises(AssertionError):
                    validator.validate_api_semantics(MATRIX.replace(current, bad))

    def test_semantic_mutations(self):
        user = '/api/v1/rate-limits/users/:id'
        cases = [
            ('GET /api/v1/auth/csrf', '不注销Session', '注销Session'),
            ('GET /api/v1/auth/csrf', '不写业务库', '不写业务库；注销会话'),
            (f'GET {user}', 'sys_users、sys_rate_limits(USER)', 'sys_users'),
            (f'GET {user}', 'revision=version=0', 'revision=version=last_revision'),
            (f'GET {user}', '不写管理审计', '写管理审计'),
            (f'PUT {user}', 'sys_rate_limit_revisions、', ''),
            (f'PUT {user}', 'USER revision CAS', '用户CAS'),
            (f'PUT {user}', 'rule/counter同事务更新', '仅更新rule'),
            (f'PUT {user}', '不以sys_users.version做CAS', '以sys_users.version做CAS'),
            (f'DELETE {user}', '保留counter', '删除counter'),
            (f'DELETE {user}', '不删除PAT', '不删除PAT；删除PAT'),
            (f'DELETE {user}', '不重置用户版本', '重置用户版本'),
            (f'DELETE {user}', 'sys_user_approvals', 'sys_pats'),
        ]
        for route, old, new in cases:
            with self.subTest(route=route, mutation=new):
                with self.assertRaises(AssertionError):
                    validator.validate_api_semantics(mutate(route, old, new))


if __name__ == '__main__':
    unittest.main(verbosity=2)
