const fs = require("fs");
const path = require("path");

const parts = [
  "part1_intro.md",
  "part2_adr.md",
  "part3_monorepo.md",
  "part4_security_state_machines.md",
  "part5_layout_paradigms.md",
  "part6_state_management.md",
  "part7_rbac_matrix.md",
  "part8_api_dto_mapping.md",
  "part9_errors_and_tokens.md",
  "part10_testing_acceptance.md",
  "part11_roadmap.md",
];

const fullDoc = parts
  .map((p) => {
    const filePath = path.join(__dirname, "fe_parts", p);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Part not found: ${filePath}`);
    }
    return fs.readFileSync(filePath, "utf8").trim();
  })
  .join("\n\n---\n\n");

const targetPath = path.join(__dirname, "..", "docs", "FRONTEND_ARCHITECTURE_SPEC.md");
fs.writeFileSync(targetPath, fullDoc, "utf8");

const stats = fs.statSync(targetPath);
console.log("Successfully generated docs/FRONTEND_ARCHITECTURE_SPEC.md");
console.log("File size:", stats.size, "bytes");
