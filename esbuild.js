const esbuild = require("esbuild");

const watch = process.argv.includes("--watch");

const buildOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  format: "cjs",
  platform: "node",
  sourcemap: true,
  external: ["vscode", "oracledb"],
  logLevel: "info",
  target: "node18"
};

if (watch) {
  esbuild.context(buildOptions).then((ctx) => ctx.watch());
} else {
  esbuild.build(buildOptions).catch(() => process.exit(1));
}
