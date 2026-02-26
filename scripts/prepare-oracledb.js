const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(projectRoot, "node_modules", "oracledb");
const targetDir = path.join(projectRoot, "dist", "node_modules", "oracledb");

if (!fs.existsSync(sourceDir)) {
  console.error(
    `[prepare-oracledb] Missing source: ${sourceDir}. Run npm install first.`
  );
  process.exit(1);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(path.dirname(targetDir), { recursive: true });
fs.cpSync(sourceDir, targetDir, { recursive: true });

console.log(`[prepare-oracledb] Copied ${sourceDir} -> ${targetDir}`);
