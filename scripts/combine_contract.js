const fs = require('fs');
const path = require('path');

const parts = [
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
];

const fullDoc = parts
  .map((p) => {
    const filePath = path.join(__dirname, 'contract_parts', p);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Part not found: ${filePath}`);
    }
    return fs.readFileSync(filePath, 'utf8').trim();
  })
  .join('\n\n---\n\n');

const targetPath = path.join(__dirname, '..', 'docs', 'API_CONTRACT_SPEC.md');
fs.writeFileSync(targetPath, fullDoc, 'utf8');

console.log('Successfully generated docs/API_CONTRACT_SPEC.md');
const stats = fs.statSync(targetPath);
console.log('File size:', stats.size, 'bytes');
