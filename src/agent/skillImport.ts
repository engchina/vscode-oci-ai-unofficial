import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { spawn } from "child_process";
import {
  binaryExistsOnPath,
  downloadUrlToFile,
  extractTarArchiveToDir,
  extractZipArchiveToDir,
  resolveArchiveKind,
} from "./skillInstaller";
import { scanDirectoryWithSummary } from "../security/skillScanner";

export type AgentSkillImportScope = "workspace" | "user";

export interface AgentSkillImportResult {
  ok: boolean;
  source: string;
  scope: AgentSkillImportScope;
  message: string;
  warnings: string[];
  importedSkillId?: string;
  importedSkillName?: string;
  targetRoot?: string;
  targetDirectory?: string;
  resolvedSourcePath?: string;
  replacedExisting?: boolean;
  blockedBySecurity?: boolean;
}

type MaterializedSource = {
  rootDir: string;
  cleanupDir?: string;
};

type ParsedSourceSpec = {
  raw: string;
  location: string;
  subdir?: string;
};

export async function importSkillDirectoryFromSource(params: {
  source: string;
  scope: AgentSkillImportScope;
  workspaceDir?: string;
  replaceExisting?: boolean;
  allowHighRisk?: boolean;
}): Promise<AgentSkillImportResult> {
  const parsed = parseSourceSpec(params.source);
  const targetRoot = resolveImportTargetRoot(params.scope, params.workspaceDir);

  if (!targetRoot) {
    return {
      ok: false,
      source: params.source,
      scope: params.scope,
      message: "A workspace folder is required to import a workspace skill.",
      warnings: [],
    };
  }

  let materialized: MaterializedSource | undefined;
  try {
    materialized = await materializeSource(parsed.location);
    const resolvedSkillDir = await resolveImportedSkillDir(materialized.rootDir, parsed.subdir);
    const scan = await collectSkillScanWarnings(resolvedSkillDir);
    const warnings = scan.warnings;
    const skillDirName = path.basename(resolvedSkillDir);
    if (!skillDirName || skillDirName === "." || skillDirName === "..") {
      throw new Error("The imported source resolved to an invalid skill directory name.");
    }

    if (scan.critical > 0 && !params.allowHighRisk) {
      return {
        ok: false,
        source: params.source,
        scope: params.scope,
        message: `Import blocked: security scan found ${scan.critical} critical issue(s). Confirm to continue anyway.`,
        warnings,
        blockedBySecurity: true,
        importedSkillId: skillDirName.toLowerCase(),
        importedSkillName: skillDirName,
        targetRoot,
        resolvedSourcePath: await fs.realpath(resolvedSkillDir).catch(() => undefined),
      };
    }

    await fs.mkdir(targetRoot, { recursive: true });
    const targetDirectory = path.join(targetRoot, skillDirName);
    const sourceRealPath = await fs.realpath(resolvedSkillDir);
    const destinationRealPath = await resolveRealPathIfExists(targetDirectory);

    if (destinationRealPath && destinationRealPath === sourceRealPath) {
      return {
        ok: true,
        source: params.source,
        scope: params.scope,
        message: `Skill "${skillDirName}" is already installed at the target location.`,
        warnings,
        blockedBySecurity: false,
        importedSkillId: skillDirName.toLowerCase(),
        importedSkillName: skillDirName,
        targetRoot,
        targetDirectory,
        resolvedSourcePath: sourceRealPath,
      };
    }

    let replacedExisting = false;
    if (destinationRealPath) {
      if (!params.replaceExisting) {
        return {
          ok: false,
          source: params.source,
          scope: params.scope,
          message:
            `A skill directory named "${skillDirName}" already exists in the target scope. ` +
            "Enable replace mode or remove it first.",
          warnings,
          blockedBySecurity: false,
          importedSkillId: skillDirName.toLowerCase(),
          importedSkillName: skillDirName,
          targetRoot,
          targetDirectory,
          resolvedSourcePath: sourceRealPath,
        };
      }
      await fs.rm(targetDirectory, { recursive: true, force: true });
      replacedExisting = true;
    }

    await fs.cp(resolvedSkillDir, targetDirectory, {
      recursive: true,
      force: true,
      filter: (sourcePath) => !path.basename(sourcePath).startsWith(".git"),
    });

    return {
      ok: true,
      source: params.source,
      scope: params.scope,
      message: replacedExisting
        ? `Replaced skill "${skillDirName}" from external source.`
        : `Imported skill "${skillDirName}" from external source.`,
      warnings,
      blockedBySecurity: false,
      importedSkillId: skillDirName.toLowerCase(),
      importedSkillName: skillDirName,
      targetRoot,
      targetDirectory,
      resolvedSourcePath: sourceRealPath,
      replacedExisting,
    };
  } catch (error) {
    return {
      ok: false,
      source: params.source,
      scope: params.scope,
      message: error instanceof Error ? error.message : String(error),
      warnings: [],
      blockedBySecurity: false,
      targetRoot,
    };
  } finally {
    if (materialized?.cleanupDir) {
      await fs.rm(materialized.cleanupDir, { recursive: true, force: true });
    }
  }
}

async function collectSkillScanWarnings(skillDir: string): Promise<{
  critical: number
  warnings: string[]
}> {
  try {
    const summary = await scanDirectoryWithSummary(skillDir)
    if (summary.critical > 0) {
      return {
        critical: summary.critical,
        warnings: [
          `Security scan found ${summary.critical} critical issue(s) and ${summary.warn} warning(s) in the skill source.`,
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
          `Security scan found ${summary.warn} warning(s) in the skill source.`,
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
      warnings: [`Security scan failed before import: ${error instanceof Error ? error.message : String(error)}`],
    }
  }
}

function parseSourceSpec(rawSource: string): ParsedSourceSpec {
  const raw = rawSource.trim();
  if (!raw) {
    throw new Error("A skill source is required.");
  }

  const separator = raw.lastIndexOf("::");
  if (separator <= 0) {
    return { raw, location: raw };
  }

  const location = raw.slice(0, separator).trim();
  const subdir = raw.slice(separator + 2).trim();
  if (!location) {
    throw new Error("The external source is missing its base location.");
  }
  return {
    raw,
    location,
    subdir: subdir || undefined,
  };
}

function resolveImportTargetRoot(
  scope: AgentSkillImportScope,
  workspaceDir?: string,
): string | undefined {
  if (scope === "workspace") {
    return workspaceDir ? path.join(workspaceDir, "skills") : undefined;
  }
  return path.join(os.homedir(), ".openclaw", "skills");
}

async function materializeSource(location: string): Promise<MaterializedSource> {
  const expandedLocation = expandHome(location);
  try {
    const stat = await fs.stat(expandedLocation);
    if (stat.isDirectory()) {
      return { rootDir: path.resolve(expandedLocation) };
    }
    if (stat.isFile()) {
      return materializeArchiveFile(path.resolve(expandedLocation));
    }
  } catch {
    // Fall through to remote/git handling.
  }

  if (looksLikeGitSource(location)) {
    return cloneGitSource(location);
  }

  let url: URL;
  try {
    url = new URL(location);
  } catch {
    throw new Error(
      "Unsupported skill source. Use a local folder, local archive, archive URL, or git repository URL.",
    );
  }

  if (!/^https?:$/i.test(url.protocol)) {
    throw new Error("Only http(s) URLs are supported for remote skill imports.");
  }

  if (looksLikeArchivePath(url.pathname)) {
    return materializeArchiveUrl(url);
  }

  if (looksLikeGitSource(location)) {
    return cloneGitSource(location);
  }

  throw new Error(
    "Remote sources must be a git repository URL or an archive URL (.zip, .tar.gz, .tgz, .tar.bz2).",
  );
}

async function materializeArchiveFile(filePath: string): Promise<MaterializedSource> {
  const archiveKind = resolveArchiveKind(undefined, filePath);
  if (!archiveKind) {
    throw new Error("Unsupported local source file. Use a directory or supported archive.");
  }

  const extractRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oci-ai-skill-import-"));
  if (archiveKind === "zip") {
    await extractZipArchiveToDir(filePath, extractRoot, 0);
  } else {
    await extractTarArchiveToDir(filePath, extractRoot, archiveKind, 0);
  }
  return {
    rootDir: extractRoot,
    cleanupDir: extractRoot,
  };
}

async function materializeArchiveUrl(url: URL): Promise<MaterializedSource> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "oci-ai-skill-import-"));
  const archivePath = path.join(tempDir, path.basename(url.pathname) || "skill-download");
  await downloadUrlToFile(url, archivePath);
  const archiveKind = resolveArchiveKind(undefined, archivePath);
  if (!archiveKind) {
    throw new Error("Downloaded source is not a supported archive.");
  }
  const extractRoot = path.join(tempDir, "extract");
  await fs.mkdir(extractRoot, { recursive: true });
  if (archiveKind === "zip") {
    await extractZipArchiveToDir(archivePath, extractRoot, 0);
  } else {
    await extractTarArchiveToDir(archivePath, extractRoot, archiveKind, 0);
  }
  return {
    rootDir: extractRoot,
    cleanupDir: tempDir,
  };
}

async function cloneGitSource(source: string): Promise<MaterializedSource> {
  if (!binaryExistsOnPath("git")) {
    throw new Error("git is required to import a skill from a git repository.");
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "oci-ai-skill-import-git-"));
  const targetDir = path.join(tempDir, "repo");
  const result = await runCommand(["git", "clone", "--depth", "1", source, targetDir]);
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `git clone failed for ${source}.`);
  }
  return {
    rootDir: targetDir,
    cleanupDir: tempDir,
  };
}

async function resolveImportedSkillDir(rootDir: string, subdir?: string): Promise<string> {
  if (subdir) {
    const resolved = path.resolve(rootDir, subdir);
    const relative = path.relative(rootDir, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("The requested skill subdirectory resolves outside the imported source.");
    }
    const stat = await fs.stat(resolved).catch(() => undefined);
    if (!stat?.isDirectory()) {
      throw new Error(`Skill subdirectory "${subdir}" was not found in the imported source.`);
    }
    if (!(await containsSkillFile(resolved))) {
      throw new Error(`"${subdir}" does not contain a top-level SKILL.md file.`);
    }
    return resolved;
  }

  if (await containsSkillFile(rootDir)) {
    return rootDir;
  }

  const directCandidates = await collectSkillDirCandidates(rootDir);
  if (directCandidates.length === 1) {
    return directCandidates[0];
  }
  if (directCandidates.length > 1) {
    throw new Error(
      "Multiple skill directories were found in the source. Use the `source::subdir` format to choose one.",
    );
  }

  for (const container of ["skills", path.join(".openclaw", "skills"), path.join(".oci-ai", "skills")]) {
    const candidateRoot = path.join(rootDir, container);
    const stat = await fs.stat(candidateRoot).catch(() => undefined);
    if (!stat?.isDirectory()) {
      continue;
    }
    const nestedCandidates = await collectSkillDirCandidates(candidateRoot);
    if (nestedCandidates.length === 1) {
      return nestedCandidates[0];
    }
    if (nestedCandidates.length > 1) {
      throw new Error(
        `Multiple skill directories were found under "${container}". Use the \`source::subdir\` format to choose one.`,
      );
    }
  }

  throw new Error(
    "No skill directory was found. The source must contain a folder with a top-level SKILL.md file.",
  );
}

async function collectSkillDirCandidates(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const candidates: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const candidate = path.join(rootDir, entry.name);
    if (await containsSkillFile(candidate)) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

async function containsSkillFile(directory: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(directory, "SKILL.md"));
    return stat.isFile();
  } catch {
    return false;
  }
}

function expandHome(value: string): string {
  if (value === "~") {
    return os.homedir();
  }
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function looksLikeArchivePath(value: string): boolean {
  const lower = value.toLowerCase();
  return (
    lower.endsWith(".zip") ||
    lower.endsWith(".tar.gz") ||
    lower.endsWith(".tgz") ||
    lower.endsWith(".tar.bz2") ||
    lower.endsWith(".tbz2")
  );
}

function looksLikeGitSource(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.endsWith(".git") ||
    trimmed.startsWith("git@") ||
    trimmed.startsWith("ssh://") ||
    /github\.com\/[^/]+\/[^/]+\/?$/.test(trimmed) ||
    /github\.com\/[^/]+\/[^/]+\.git$/i.test(trimmed)
  );
}

async function resolveRealPathIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.realpath(filePath);
  } catch {
    return undefined;
  }
}

async function runCommand(argv: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
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
      resolve({ code: null, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}
