const fs = require("fs");
const path = require("path");

const parts = [
  "part1_intro.md",
  "part2_adr.md",
  "part3_monorepo.md",
  "part4_database_and_dal.md",
  "part5_control_plane_security.md",
  "part6_data_plane_pipeline.md",
  "part7_ast_and_mcp_tools.md",
  "part8_core_engine_pool.md",
  "part9_security_ssrf_crypto.md",
  "part10_audit_and_stats.md",
  "part11_api_matrix_and_testing.md",
];

const fullDoc = parts
  .map((p) => {
    const filePath = path.join(__dirname, "be_parts", p);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Part not found: ${filePath}`);
    }
    return fs.readFileSync(filePath, "utf8").trim();
  })
  .join("\n\n---\n\n");

const targetPath = path.join(__dirname, "..", "docs", "BACKEND_ARCHITECTURE_SPEC.md");
fs.writeFileSync(targetPath, fullDoc, "utf8");

const stats = fs.statSync(targetPath);
console.log("Successfully generated docs/BACKEND_ARCHITECTURE_SPEC.md");
console.log("File size:", stats.size, "bytes");
