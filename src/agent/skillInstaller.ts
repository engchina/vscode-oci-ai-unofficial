import * as syncFs from "fs";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import * as http from "http";
import * as https from "https";
import AdmZip from "adm-zip";
import { scanDirectoryWithSummary } from "../security/skillScanner";

export type AgentSkillInstallKind = "brew" | "node" | "go" | "uv" | "download";

export interface AgentSkillInstallSpec {
  id?: string;
  kind: AgentSkillInstallKind;
  label?: string;
  bins?: string[];
  os?: string[];
  formula?: string;
  package?: string;
  module?: string;
  url?: string;
  archive?: string;
  extract?: boolean;
  stripComponents?: number;
  targetDir?: string;
}

export interface AgentSkillInstallPreferences {
  preferBrew?: boolean;
  nodeManager?: "npm" | "pnpm" | "yarn" | "bun";
}

export interface AgentSkillInstallResult {
  ok: boolean;
  skillId: string;
  installerId?: string;
  installerKind?: AgentSkillInstallKind;
  message: string;
  stdout: string;
  stderr: string;
  code: number | null;
  warnings: string[];
  targetPath?: string;
  executedCommand?: string[];
  blockedBySecurity?: boolean;
}

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

const BREW_FORMULA_PATTERN = /^[A-Za-z0-9][A-Za-z0-9@+._/-]*$/;
const GO_MODULE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~+\-/]*(?:@[A-Za-z0-9][A-Za-z0-9._~+\-/]*)?$/;
const UV_PACKAGE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-[\]=<>!~+,]*$/;
const NODE_PACKAGE_PATTERN =
  /^(?:@?[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*(?:@[A-Za-z0-9][A-Za-z0-9._~+\-]*)?$/;

export function resolveCompatibleInstallers(
  specs: AgentSkillInstallSpec[] | undefined,
): AgentSkillInstallSpec[] {
  if (!Array.isArray(specs) || specs.length === 0) {
    return [];
  }
  return specs.filter((spec) => {
    if (!Array.isArray(spec.os) || spec.os.length === 0) {
      return true;
    }
    return spec.os.includes(process.platform);
  });
}

export function resolvePreferredInstaller(
  specs: AgentSkillInstallSpec[] | undefined,
  preferences: AgentSkillInstallPreferences = {},
): AgentSkillInstallSpec | undefined {
  const compatible = resolveCompatibleInstallers(specs);
  if (compatible.length === 0) {
    return undefined;
  }

  if (preferences.preferBrew !== false && binaryExistsOnPath("brew")) {
    const brew = compatible.find((spec) => spec.kind === "brew");
    if (brew) {
      return brew;
    }
  }

  const node = compatible.find((spec) => spec.kind === "node");
  if (node) {
    return node;
  }

  return compatible[0];
}

export async function installSkillWithSpec(params: {
  skillId: string;
  spec: AgentSkillInstallSpec;
  preferences?: AgentSkillInstallPreferences;
  skillDirectory?: string;
  allowHighRisk?: boolean;
}): Promise<AgentSkillInstallResult> {
  const { skillId, spec } = params;
  const scan = params.skillDirectory
    ? await collectSkillInstallWarnings(params.skillDirectory)
    : { critical: 0, warnings: [] };
  const warnings = scan.warnings;
  const compatible = resolveCompatibleInstallers([spec]);
  if (compatible.length === 0) {
    return {
      ok: false,
      skillId,
      installerId: spec.id,
      installerKind: spec.kind,
      message: `Installer "${spec.id ?? spec.kind}" does not support ${process.platform}.`,
      stdout: "",
      stderr: "",
      code: null,
      warnings,
      blockedBySecurity: false,
    };
  }

  if (scan.critical > 0 && !params.allowHighRisk) {
    return {
      ok: false,
      skillId,
      installerId: spec.id,
      installerKind: spec.kind,
      message: `Install blocked: security scan found ${scan.critical} critical issue(s). Confirm to continue anyway.`,
      stdout: "",
      stderr: "",
      code: null,
      warnings,
      blockedBySecurity: true,
    };
  }

  if (spec.kind === "download") {
    return installDownloadSpec(skillId, spec);
  }

  const argv = buildInstallCommand(spec, params.preferences);
  if (argv.length === 0) {
    return {
      ok: false,
      skillId,
      installerId: spec.id,
      installerKind: spec.kind,
      message: `Installer "${spec.id ?? spec.kind}" is missing required fields.`,
      stdout: "",
      stderr: "",
      code: null,
      warnings,
      blockedBySecurity: false,
    };
  }

  const result = await runCommand(argv);
  return {
    ok: result.code === 0,
    skillId,
    installerId: spec.id,
    installerKind: spec.kind,
    message: result.code === 0 ? "Installed successfully." : "Install command failed.",
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    code: result.code,
    warnings,
    executedCommand: argv,
    blockedBySecurity: false,
  };
}

function buildInstallCommand(
  spec: AgentSkillInstallSpec,
  preferences: AgentSkillInstallPreferences = {},
): string[] {
  switch (spec.kind) {
    case "brew":
      return isSafeBrewFormula(spec.formula) ? ["brew", "install", spec.formula] : [];
    case "node":
      return isSafeNodePackageSpec(spec.package)
        ? buildNodeInstallCommand(spec.package, preferences.nodeManager)
        : [];
    case "go":
      return isSafeGoModule(spec.module) ? ["go", "install", spec.module] : [];
    case "uv":
      return isSafeUvPackage(spec.package) ? ["uv", "tool", "install", spec.package] : [];
    default:
      return [];
  }
}

function buildNodeInstallCommand(
  packageName: string,
  nodeManager: AgentSkillInstallPreferences["nodeManager"] = "npm",
): string[] {
  switch (nodeManager) {
    case "pnpm":
      return ["pnpm", "add", "-g", "--ignore-scripts", packageName];
    case "yarn":
      return ["yarn", "global", "add", "--ignore-scripts", packageName];
    case "bun":
      return ["bun", "add", "-g", "--ignore-scripts", packageName];
    default:
      return ["npm", "install", "-g", "--ignore-scripts", packageName];
  }
}

async function installDownloadSpec(
  skillId: string,
  spec: AgentSkillInstallSpec,
): Promise<AgentSkillInstallResult> {
  if (!spec.url) {
    return {
      ok: false,
      skillId,
      installerId: spec.id,
      installerKind: spec.kind,
      message: "Download installer is missing a url.",
      stdout: "",
      stderr: "",
      code: null,
      warnings: [],
    };
  }

  let url: URL;
  try {
    url = new URL(spec.url);
  } catch {
    return {
      ok: false,
      skillId,
      installerId: spec.id,
      installerKind: spec.kind,
      message: "Download installer url is invalid.",
      stdout: "",
      stderr: "",
      code: null,
      warnings: [],
    };
  }
  if (!/^https?:$/i.test(url.protocol)) {
    return {
      ok: false,
      skillId,
      installerId: spec.id,
      installerKind: spec.kind,
      message: "Download installer only supports http(s) urls.",
      stdout: "",
      stderr: "",
      code: null,
      warnings: [],
    };
  }
  const targetDir = resolveInstallTargetDir(skillId, spec);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `oci-ai-skill-${skillId}-`));
  const archivePath = path.join(tempDir, path.basename(url.pathname) || `${skillId}.download`);

  try {
    await fs.mkdir(targetDir, { recursive: true });
    await downloadUrlToFile(url, archivePath);

    const archiveKind = resolveArchiveKind(spec.archive, archivePath);
    const shouldExtract = spec.extract ?? Boolean(archiveKind);

    if (shouldExtract) {
      if (archiveKind === "zip") {
        await extractZipArchiveToDir(archivePath, targetDir, spec.stripComponents ?? 0);
      } else if (archiveKind === "tar.gz" || archiveKind === "tar.bz2") {
        await extractTarArchiveToDir(archivePath, targetDir, archiveKind, spec.stripComponents ?? 0);
      } else {
        return {
          ok: false,
          skillId,
          installerId: spec.id,
          installerKind: spec.kind,
          message: "Unsupported archive format for download installer.",
          stdout: "",
          stderr: "",
          code: null,
          warnings: [],
          targetPath: targetDir,
        };
      }
    } else {
      const outputPath = path.join(targetDir, path.basename(archivePath));
      await fs.copyFile(archivePath, outputPath);
    }

    return {
      ok: true,
      skillId,
      installerId: spec.id,
      installerKind: spec.kind,
      message: "Downloaded successfully.",
      stdout: "",
      stderr: "",
      code: 0,
      warnings: [],
      targetPath: targetDir,
    };
  } catch (error) {
    return {
      ok: false,
      skillId,
      installerId: spec.id,
      installerKind: spec.kind,
      message: error instanceof Error ? error.message : String(error),
      stdout: "",
      stderr: "",
      code: null,
      warnings: [],
      targetPath: targetDir,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function collectSkillInstallWarnings(skillDirectory: string): Promise<{
  critical: number
  warnings: string[]
}> {
  try {
    const summary = await scanDirectoryWithSummary(skillDirectory)
    if (summary.critical > 0) {
      return {
        critical: summary.critical,
        warnings: [
          `Security scan found ${summary.critical} critical issue(s) and ${summary.warn} warning(s) in this skill.`,
          ...summary.findings
            .filter((finding) => finding.severity === "critical")
            .slice(0, 5)
            .map((finding) => `${finding.message} (${path.basename(finding.file)}:${finding.line})`),
        ],
      }
    }
    if (summary.warn > 0) {
      return {
        critical: 0,
        warnings: [
          `Security scan found ${summary.warn} warning(s) in this skill.`,
          ...summary.findings
            .filter((finding) => finding.severity === "warn")
            .slice(0, 5)
            .map((finding) => `${finding.message} (${path.basename(finding.file)}:${finding.line})`),
        ],
      }
    }
    return { critical: 0, warnings: [] }
  } catch (error) {
    return {
      critical: 0,
      warnings: [`Security scan failed before install: ${error instanceof Error ? error.message : String(error)}`],
    }
  }
}

export async function downloadUrlToFile(
  url: URL,
  filePath: string,
  redirectCount = 0,
): Promise<void> {
  if (redirectCount > 5) {
    throw new Error("Too many redirects while downloading installer.");
  }

  await new Promise<void>((resolve, reject) => {
    const client = url.protocol === "http:" ? http : https;
    const request = client.get(url, (response) => {
      const location = response.headers.location;
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        location
      ) {
        response.resume();
        void downloadUrlToFile(new URL(location, url), filePath, redirectCount + 1)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Download failed with status ${response.statusCode ?? "unknown"}.`));
        response.resume();
        return;
      }

      const chunks: Buffer[] = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on("end", () => {
        void fs.writeFile(filePath, Buffer.concat(chunks))
          .then(() => resolve())
          .catch(reject);
      });
      response.on("error", reject);
    });

    request.on("error", reject);
  });
}

function resolveInstallTargetDir(skillId: string, spec: AgentSkillInstallSpec): string {
  const safeRoot = path.join(os.homedir(), ".openclaw", "tools", skillId);
  const rawTargetDir = spec.targetDir?.trim();
  if (rawTargetDir) {
    const resolved = path.isAbsolute(rawTargetDir)
      ? path.resolve(rawTargetDir)
      : path.resolve(safeRoot, rawTargetDir);
    const relative = path.relative(safeRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(
        `Refusing to install outside the skill tools directory. targetDir="${rawTargetDir}".`,
      );
    }
    return resolved;
  }
  return safeRoot;
}

export function resolveArchiveKind(
  archiveType: AgentSkillInstallSpec["archive"] | undefined,
  archivePath: string,
): "zip" | "tar.gz" | "tar.bz2" | undefined {
  if (archiveType === "zip" || archiveType === "tar.gz" || archiveType === "tar.bz2") {
    return archiveType;
  }
  const lower = archivePath.toLowerCase();
  if (lower.endsWith(".zip")) {
    return "zip";
  }
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    return "tar.gz";
  }
  if (lower.endsWith(".tar.bz2") || lower.endsWith(".tbz2")) {
    return "tar.bz2";
  }
  return undefined;
}

export async function extractZipArchiveToDir(
  archivePath: string,
  targetDir: string,
  stripComponents: number,
): Promise<void> {
  const zip = new AdmZip(archivePath);
  const entries = zip.getEntries();

  for (const entry of entries) {
    if (entry.isDirectory) {
      continue;
    }
    const stripped = stripEntryPath(entry.entryName, stripComponents);
    if (!stripped) {
      continue;
    }
    const destination = path.resolve(targetDir, stripped);
    ensurePathInsideRoot(targetDir, destination);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, entry.getData());
  }
}

export async function extractTarArchiveToDir(
  archivePath: string,
  targetDir: string,
  archiveKind: "tar.gz" | "tar.bz2",
  stripComponents: number,
): Promise<void> {
  if (!binaryExistsOnPath("tar")) {
    throw new Error("tar is required to extract this installer archive.");
  }
  await assertTarArchiveSafe(archivePath, archiveKind);
  const args = [
    archiveKind === "tar.gz" ? "-xzf" : "-xjf",
    archivePath,
    "-C",
    targetDir,
  ];
  if (stripComponents > 0) {
    args.push(`--strip-components=${stripComponents}`);
  }
  const result = await runCommand(["tar", ...args]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "Failed to extract installer archive.");
  }
}

async function assertTarArchiveSafe(
  archivePath: string,
  archiveKind: "tar.gz" | "tar.bz2",
): Promise<void> {
  const result = await runCommand([
    "tar",
    archiveKind === "tar.gz" ? "-tzf" : "-tjf",
    archivePath,
  ]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || "Failed to inspect archive contents.");
  }

  const entries = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const entry of entries) {
    if (entry.startsWith("/") || /^[A-Za-z]:[\\/]/.test(entry)) {
      throw new Error("Installer archive contains absolute paths.");
    }
    const normalized = path.posix.normalize(entry);
    if (normalized === ".." || normalized.startsWith("../")) {
      throw new Error("Installer archive contains parent-directory traversal.");
    }
  }
}

export function isSafeBrewFormula(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  return Boolean(value.trim()) && !value.startsWith("-") && !value.includes("\\") && !value.includes("..") && BREW_FORMULA_PATTERN.test(value);
}

export function isSafeNodePackageSpec(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  const trimmed = value.trim();
  return (
    Boolean(trimmed) &&
    !trimmed.startsWith("-") &&
    !trimmed.includes("://") &&
    !trimmed.includes("\\") &&
    NODE_PACKAGE_PATTERN.test(trimmed)
  );
}

export function isSafeGoModule(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  const trimmed = value.trim();
  return (
    Boolean(trimmed) &&
    !trimmed.startsWith("-") &&
    !trimmed.includes("://") &&
    !trimmed.includes("\\") &&
    GO_MODULE_PATTERN.test(trimmed)
  );
}

export function isSafeUvPackage(value: string | undefined): value is string {
  if (!value) {
    return false;
  }
  const trimmed = value.trim();
  return (
    Boolean(trimmed) &&
    !trimmed.startsWith("-") &&
    !trimmed.includes("://") &&
    !trimmed.includes("\\") &&
    UV_PACKAGE_PATTERN.test(trimmed)
  );
}

function stripEntryPath(entryName: string, stripComponents: number): string | undefined {
  const segments = entryName.split("/").filter(Boolean);
  const stripped = segments.slice(Math.max(0, stripComponents));
  if (stripped.length === 0) {
    return undefined;
  }
  return stripped.join(path.sep);
}

function ensurePathInsideRoot(rootDir: string, candidatePath: string): void {
  const relative = path.relative(path.resolve(rootDir), candidatePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Installer archive tried to write outside the target directory.");
  }
}

function runCommand(argv: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: process.env,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolve({
        code: null,
        stdout,
        stderr: error.message,
      });
    });
    child.on("close", (code) => {
      resolve({
        code,
        stdout,
        stderr,
      });
    });
  });
}

export function binaryExistsOnPath(binaryName: string): boolean {
  const pathValue = process.env.PATH ?? "";
  const segments = pathValue.split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .map((item) => item.toLowerCase())
      : [""];

  for (const segment of segments) {
    for (const extension of extensions) {
      const candidate = path.join(
        segment,
        process.platform === "win32" ? `${binaryName}${extension}` : binaryName,
      );
      try {
        const stat = syncFs.statSync(candidate);
        if (stat.isFile()) {
          return true;
        }
      } catch {
        // Ignore missing candidate paths.
      }
    }
  }

  return false;
}
