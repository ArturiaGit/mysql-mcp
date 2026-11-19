const fs = require('fs');
const path = require('path');

const parts = [
  'part1_intro.md',
  'part2_adr.md',
  'part3_topology.md',
  'part4_subsystems.md',
  'part5_database.md',
  'part6_interfaces.md',
  'part7_project_structure.md',
  'part8_operations.md',
];

const fullDoc = parts
  .map((p) => {
    const filePath = path.join(__dirname, 'arch_parts', p);
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    return fs.readFileSync(filePath, 'utf8').trim();
  })
  .join('\n\n---\n\n');

const targetPath = path.join(__dirname, '..', 'docs', 'ARCHITECTURE_SPEC.md');
fs.writeFileSync(targetPath, fullDoc, 'utf8');

console.log('Successfully generated docs/ARCHITECTURE_SPEC.md');
const stats = fs.statSync(targetPath);
console.log('File size:', stats.size, 'bytes');
