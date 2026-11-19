"""Read-only checks for the database design; not a MySQL parser/integration test.

Run: python scripts/validate_database_design.py
Uses only Python's standard library and never connects to a database.
"""
from __future__ import annotations

import itertools
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs/DATABASE_DESIGN_SPEC.md"
DDL = ROOT / "docs/sql/001_metadata_schema.sql"
CONTRACT = ROOT / "docs/API_CONTRACT_SPEC.md"
EXPECTED = {
    "sys_users", "sys_roles", "sys_user_roles", "sys_user_approvals",
    "sys_pats", "sys_profiles", "sys_role_profiles", "sys_role_database_acls",
    "sys_role_table_acls", "sys_rate_limits", "sys_audit_logs",
    "sys_anonymous_security_logs", "sys_system_settings", "sys_rate_limit_revisions",
}
CHECKS = 0


def check(condition: bool, message: str) -> None:
    global CHECKS
    CHECKS += 1
    if not condition:
        raise AssertionError(message)


def split_top_level(text: str) -> list[str]:
    """Split CREATE TABLE body at commas outside parentheses/quoted tokens."""
    result, start, depth, quote, i = [], 0, 0, None, 0
    while i < len(text):
        c = text[i]
        if quote:
            if c == "\\":
                i += 2
                continue
            if c == quote:
                if i + 1 < len(text) and text[i + 1] == quote:
                    i += 2
                    continue
                quote = None
        elif c in "'\"`":
            quote = c
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            check(depth >= 0, "Unbalanced SQL parentheses")
        elif c == "," and depth == 0:
            result.append(text[start:i].strip())
            start = i + 1
        i += 1
    check(depth == 0 and quote is None, "Unclosed SQL parentheses or quote")
    result.append(text[start:].strip())
    check(all(result), "Empty SQL clause or trailing comma")
    return result


def normalize(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


@dataclass
class RateModel:
    """Sequential specification only; it does not simulate InnoDB locks."""
    counter: int = 0
    revision: int | None = None

    def put(self, expected: int) -> bool:
        if expected != (self.revision or 0) or self.counter == 4294967295:
            return False
        self.counter += 1
        self.revision = self.counter
        return True

    def delete(self, expected: int) -> bool:
        if expected <= 0 or self.revision != expected:
            return False
        self.revision = None
        return True



def validate_api_semantics(matrix: str) -> None:
    """Critical route contracts: sources, CAS ownership and prohibited effects.

    This validates documentation, not handler behavior or database permissions.
    """
    rows = {}
    for route, tables, behavior in re.findall(
        r"^\| `((?:GET|POST|PUT|DELETE|PATCH) [^`]+)` \| ([^|]+) \| ([^|]+) \|$",
        matrix, re.M,
    ):
        check(route not in rows, f'Duplicate API mapping: {route}')
        rows[route] = (tables.strip(), behavior.strip())

    csrf = 'GET /api/v1/auth/csrf'
    tables, behavior = rows[csrf]
    check(tables == '内存CSRF/Session', 'CSRF must use memory only')
    for clause in ('按需建立/复用CSRF seed并返回token', '不注销Session',
                   '不撤销授权上下文', '不写业务库'):
        check(clause in behavior.split('；'), f'CSRF contract missing: {clause}')
    positive = behavior.replace('不注销Session', '').replace('不撤销授权上下文', '').replace('不写业务库', '')
    check(not re.search(r'注销|失效|撤销|写业务库', positive), 'CSRF has forbidden side effects')
    check('注销会话' in rows['POST /api/v1/auth/logout'][1], 'Logout must still invalidate session')

    for method in ('GET', 'PUT', 'DELETE'):
        route = f'{method} /api/v1/rate-limits/users/:id'
        tables, behavior = rows[route]
        expected = {'sys_users', 'sys_rate_limits'}
        if method != 'GET':
            expected |= {'sys_rate_limit_revisions', 'sys_user_approvals'}
        actual = set(re.findall(r'\bsys_[a-z_]+\b', tables))
        check(actual == expected, f'{method} USER rate-limit table set differs')
        check('PAT' not in tables and '删除' not in tables, f'{method} USER data sources include user deletion')
        if method == 'GET':
            for clause in ('只读', '返回已保存覆盖', '无业务行时isCustom=false、revision=version=0、配额=null',
                           '不以历史counter回显revision', '不写管理审计', '不失效快照'):
                check(clause in behavior.split('；'), f'GET USER contract missing: {clause}')
            positive = behavior.replace('不写管理审计', '').replace('不失效快照', '')
            check(not re.search(r'CAS|更新|删除|写管理审计|失效快照', positive), 'GET USER has write semantics')
        else:
            for clause in ('按§7.5锁序', 'USER revision CAS（兼容version别名）',
                           '不以sys_users.version做CAS', '不删除PAT',
                           '管理审计与提交后失效并重载QPM/burst'):
                check(clause in behavior.split('；'), f'{method} USER contract missing: {clause}')
            positive = behavior.replace('不以sys_users.version做CAS', '').replace('不删除PAT', '').replace('不重置用户版本', '')
            check(not re.search(r'用户CAS|sys_users.version|删除PAT|重置用户版本|删除counter', positive),
                  f'{method} USER has forbidden user-level side effects')
            if method == 'PUT':
                check('rule/counter同事务更新' in behavior.split('；'), 'PUT must update rule and counter atomically')
            else:
                for clause in ('仅删除USER规则', '保留counter', '不重置用户版本'):
                    check(clause in behavior.split('；'), f'DELETE USER contract missing: {clause}')


def validate() -> None:
    doc = DOC.read_text(encoding="utf-8-sig")
    ddl = DDL.read_text(encoding="utf-8-sig")
    api = CONTRACT.read_text(encoding="utf-8-sig")
    matches = re.findall(
        r"CREATE TABLE `(\w+)` \((.*?)\n\) ENGINE=InnoDB(.*?);", ddl, re.S
    )
    check(len(matches) == 14, "Expected exactly 14 CREATE TABLE definitions")
    check({name for name, _, _ in matches} == EXPECTED, "Unexpected table names")
    check(not re.search(r"\bDROP\s+(TABLE|DATABASE)\b", ddl, re.I), "Destructive SQL")
    check("FOREIGN_KEY_CHECKS" not in ddl, "Foreign key bypass found")
    check("SET SESSION time_zone = '+00:00';" in ddl, "Missing UTC initialization")
    check(not re.search(r"\bDATETIME\b(?!\(3\))", ddl), "Non-millisecond DATETIME")
    check(not re.search(r"\bCURRENT_TIMESTAMP\b(?!\(3\))", ddl), "Timestamp precision mismatch")
    tables, foreign_keys, constraint_names = {}, [], set()
    column_count = index_count = 0
    for name, body, suffix in matches:
        check("DEFAULT CHARSET=utf8mb4" in suffix, f"Charset missing: {name}")
        clauses = split_top_level(body)
        columns, keys = {}, []
        section_match = re.search(
            rf"^### 5\.\d+ `{name}` .*?\n(.*?)(?=^### |<!-- GENERATED_DICTIONARY_END -->)",
            doc, re.M | re.S,
        )
        check(section_match is not None, f"Missing dictionary section: {name}")
        section = section_match.group(1)
        documented = re.findall(r"^\| `(\w+)` \|", section, re.M)
        for clause in clauses:
            column = re.match(r"`(\w+)`\s+(.*)", clause, re.S)
            if column:
                col, definition = column.groups()
                check(col not in columns, f"Duplicate column {name}.{col}")
                columns[col] = normalize(definition.split(" COMMENT ", 1)[0])
                row = re.search(rf"^\| `{col}` \| (.*?) \|", section, re.M)
                check(row is not None, f"Undocumented column {name}.{col}")
                check(normalize(row.group(1).strip('`')) == columns[col],
                      f"Dictionary definition mismatch: {name}.{col}")
            elif re.match(r"(?:PRIMARY KEY|UNIQUE KEY|KEY )", clause):
                refs = re.findall(r"`(\w+)`", clause[clause.index('('):])
                keys.append((clause, refs))
                check(normalize(clause) in normalize(section),
                      f"Undocumented index: {name}: {clause}")
            elif clause.startswith("CONSTRAINT"):
                constraint = re.match(r"CONSTRAINT `(\w+)`", clause).group(1)
                check(constraint not in constraint_names, f"Duplicate constraint: {constraint}")
                constraint_names.add(constraint)
                fk = re.search(
                    r"FOREIGN KEY \(`(\w+)`\) REFERENCES `(\w+)` \(`(\w+)`\) ON DELETE (CASCADE|RESTRICT)",
                    clause,
                )
                if fk:
                    foreign_keys.append((name, *fk.groups()))
                    check(normalize(clause) in normalize(section), f"Undocumented FK {constraint}")
                else:
                    check("CHECK (" in clause, f"Unrecognized constraint {constraint}")
            else:
                raise AssertionError(f"Unexpected clause in {name}: {clause}")
        check(set(documented) == set(columns), f"Extra/missing dictionary columns: {name}")
        check(len(documented) == len(columns), f"Duplicate dictionary column: {name}")
        for clause, refs in keys:
            check(set(refs) <= set(columns), f"Index references absent column: {name}: {clause}")
        check(any(k.startswith("PRIMARY KEY") for k, _ in keys), f"Missing PK: {name}")
        check(len({re.match(r'(?:UNIQUE )?KEY `(\w+)`', k).group(1)
                   for k, _ in keys if not k.startswith('PRIMARY')})
              == len([k for k, _ in keys if not k.startswith('PRIMARY')]),
              f"Duplicate index names: {name}")
        tables[name] = {"columns": columns, "keys": keys, "body": body, "suffix": suffix}
        column_count += len(columns)
        index_count += len(keys)
    check(len(foreign_keys) == 7, "Expected exactly seven physical foreign keys")
    for child, column, parent, parent_col, _ in foreign_keys:
        check(parent in tables, f"Missing FK parent: {parent}")
        check(column in tables[child]['columns'], f"Missing child column: {child}.{column}")
        check(parent_col in tables[parent]['columns'], f"Missing referenced column: {parent}.{parent_col}")
        check(tables[child]['columns'][column].startswith('BIGINT UNSIGNED') and
              tables[parent]['columns'][parent_col].startswith('BIGINT UNSIGNED'),
              f"FK type mismatch: {child}.{column}")
        check(any(refs == [parent_col] and (key.startswith('PRIMARY') or key.startswith('UNIQUE'))
                  for key, refs in tables[parent]['keys']), f"Nonunique FK parent: {parent}.{parent_col}")
    check(('sys_user_roles','role_id','sys_roles','id','RESTRICT') in foreign_keys,
          'Role deletion must be RESTRICT')
    check(('sys_pats','user_id','sys_users','id','CASCADE') in foreign_keys,
          'PAT deletion must cascade with user')
    audit = tables['sys_audit_logs']
    check('PARTITION BY RANGE (YEAR(created_at) * 100 + MONTH(created_at))' in audit['suffix'],
          'Unexpected audit partition expression')
    for key, refs in audit['keys']:
        if key.startswith(('PRIMARY', 'UNIQUE')):
            check('created_at' in refs, 'Audit unique key missing partition column')
    check(not any(fk[0] == 'sys_audit_logs' or fk[2] == 'sys_audit_logs' for fk in foreign_keys),
          'Partitioned audit must not have FKs')
    for name in ('sys_role_database_acls','sys_role_table_acls'):
        col = 'database_name' if name.endswith('database_acls') else 'table_pattern'
        check('utf8mb4_0900_as_cs' in tables[name]['columns'][col], 'ACL collation mismatch')
    required_checks = {
        'ck_user_status', 'ck_user_password_days', 'ck_user_force_password',
        'ck_user_versions', 'ck_role_limits', 'ck_role_timeout', 'ck_role_qpm',
        'ck_role_inflight', 'ck_role_flags', 'ck_profile_environment',
        'ck_profile_status', 'ck_profile_port', 'ck_profile_pool',
        'ck_profile_queue', 'ck_profile_qpm', 'ck_profile_inflight',
        'ck_profile_case', 'ck_profile_version', 'ck_profile_tls_object',
        'ck_profile_ssh_object', 'ck_db_acl_allowed', 'ck_rate_scope',
        'ck_rate_qpm', 'ck_rate_burst', 'ck_rate_loop', 'ck_audit_status',
        'ck_audit_high_risk', 'ck_setting_flags', 'ck_revision_scope',
    }
    check(required_checks <= constraint_names, 'Missing domain CHECK constraint')
    for name, fragment in (
        ('sys_users', '`password_expires_days` BETWEEN 30 AND 180'),
        ('sys_roles', '`default_limit` <= `max_limit`'),
        ('sys_profiles', '`port` BETWEEN 1 AND 65535'),
        ('sys_profiles', "`environment` IN ('PROD','STG','DEV')"),
        ('sys_rate_limits', '`burst_capacity` BETWEEN 1 AND 500'),
    ):
        check(fragment in tables[name]['body'], f'Domain constraint drift: {name}: {fragment}')
    for name in ('sys_users','sys_pats','sys_profiles'):
        check(not {'password','raw_token','rawToken','ssh_private_key'} & tables[name]['columns'].keys(),
              f'Plaintext credential column in {name}')
    check(tables['sys_audit_logs']['columns']['profile_name'].startswith('VARCHAR(128)'),
          'Audit display name cannot hold Profile display_name')
    check('`version` = `revision`' in tables['sys_rate_limits']['body'], 'Missing USER version invariant')
    check('last_revision' in tables['sys_rate_limit_revisions']['columns'], 'Missing persistent counter')
    check('`uk_pending_user` (`pending_user_id`)' in tables['sys_user_approvals']['body'], 'Missing open-ticket uniqueness')
    routes = re.findall(r'\*\*接口路径\*\*：`([^`]+)`', api)
    matrix = doc.split('<!-- GENERATED_API_MATRIX_START -->')[1].split('<!-- GENERATED_API_MATRIX_END -->')[0]
    documented_routes = re.findall(r'^\| `((?:GET|POST|PUT|DELETE|PATCH) [^`]+)` \|', matrix, re.M)
    check(len(routes) == 47, 'Contract route count changed; review mapping')
    check(set(routes) == set(documented_routes) and len(routes) == len(documented_routes), 'API mapping differs')
    validate_api_semantics(matrix)
    fences = re.findall(r'^```[^\n]*$', doc, re.M)
    check(len(fences) % 2 == 0, 'Unbalanced Markdown fences')
    json_examples = re.findall(r'```json\n(.*?)\n```', doc, re.S)
    for example in json_examples:
        json.loads(example)
        check(True, 'JSON example')
    for path in ('docs/ARCHITECTURE_SPEC.md','docs/BACKEND_ARCHITECTURE_SPEC.md',
                 'docs/FRONTEND_ARCHITECTURE_SPEC.md','docs/API_CONTRACT_SPEC.md'):
        check((ROOT/path).is_file(), f'Missing referenced source {path}')
    for i in range(1,16):
        check(re.search(rf'^## {i}\. ', doc, re.M) is not None, f'Missing chapter {i}')
    check('�' not in doc and '�' not in ddl, 'Encoding replacement character')
    # Sequential specification probes; deliberately not called concurrency tests.
    model = RateModel()
    check(model.put(0) and model.revision == 1, 'Initial revision')
    check(model.put(1) and model.put(2) and model.revision == 3, 'Update counter synchrony')
    check(model.delete(3) and model.counter == 3, 'Delete preserves counter')
    check(model.put(0) and model.revision == 4, 'Recreate increments full history')
    for old in (1,2,3):
        check(not model.put(old) and not model.delete(old), f'Stale revision accepted: {old}')
    check(model.revision == model.counter == 4, 'Rejected writes changed state')
    for order in itertools.permutations(('update','delete')):
        sample = RateModel(8,8)
        results = [sample.put(8) if action == 'update' else sample.delete(8) for action in order]
        check(sum(results) == 1, f'Serialized same-revision operations: {order}')
    overflow = RateModel(4294967295,4294967295)
    check(not overflow.put(4294967295), 'Revision overflow allowed')
    print(f'PASS: {CHECKS} static/model assertions; {len(tables)} tables; '
          f'{column_count} columns; {index_count} indexes; {len(foreign_keys)} foreign keys; '
          f'{len(routes)} mapped endpoints; {len(json_examples)} JSON examples.')
    print('NOT RUN: MySQL parsing/execution, CHECK enforcement, multi-connection concurrency, '
          'migration, restore, or performance tests.')


if __name__ == '__main__':
    try:
        validate()
    except (AssertionError, ValueError, IndexError, KeyError) as exc:
        print(f'FAIL: {exc}', file=sys.stderr)
        sys.exit(1)
