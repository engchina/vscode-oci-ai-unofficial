import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";

type DriverMode = "auto" | "thin" | "thick";

export type OracleDbRuntimeStatus = {
  mode: "thin" | "thick";
  requestedMode: DriverMode;
  initError?: string;
  configuredLibDir?: string;
};

export type OracleDbDiagnostics = {
  requestedMode: DriverMode;
  effectiveMode: "thin" | "thick";
  thin: boolean;
  oracleClientVersionString?: string;
  configuredLibDir?: string;
  recommendedOracleClientLibDir: string;
  initError?: string;
  platform: string;
  arch: string;
  nodeVersion: string;
  isWsl: boolean;
  wslDistro?: string;
  timestamp: string;
};

let cachedOracleDb: any | null = null;
let cachedStatus: OracleDbRuntimeStatus | null = null;
let fallbackWarned = false;

export function loadOracleDb(): any {
  if (cachedOracleDb) {
    return cachedOracleDb;
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const oracledb = require("oracledb");
  const cfg = vscode.workspace.getConfiguration("ociAi");
  const requestedMode = normalizeDriverMode(cfg.get<string>("oracleDbDriverMode", "auto"));
  const configuredLibDir = resolveLibDir(cfg.get<string>("oracleClientLibDir", ""));

  if (requestedMode === "thin") {
    cachedOracleDb = oracledb;
    cachedStatus = {
      mode: "thin",
      requestedMode,
      configuredLibDir,
    };
    return cachedOracleDb;
  }

  try {
    if (configuredLibDir) {
      oracledb.initOracleClient({ libDir: configuredLibDir });
    } else {
      oracledb.initOracleClient();
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (requestedMode === "thick") {
      throw new Error(
        "Oracle Thick mode is required but initialization failed. " +
          `Detail: ${detail}. ` +
          "Install Oracle Instant Client and set `ociAi.oracleClientLibDir` to its directory, " +
          "or switch `ociAi.oracleDbDriverMode` to `auto`/`thin`."
      );
    }

    cachedOracleDb = oracledb;
    cachedStatus = {
      mode: "thin",
      requestedMode,
      initError: detail,
      configuredLibDir,
    };
    showFallbackWarningOnce(detail, configuredLibDir);
    return cachedOracleDb;
  }

  cachedOracleDb = oracledb;
  cachedStatus = {
    mode: oracledb.thin ? "thin" : "thick",
    requestedMode,
    configuredLibDir,
  };
  return cachedOracleDb;
}

export function getOracleDbRuntimeStatus(): OracleDbRuntimeStatus | null {
  return cachedStatus;
}

export function getOracleDbDiagnostics(): OracleDbDiagnostics {
  const cfg = vscode.workspace.getConfiguration("ociAi");
  const requestedMode = normalizeDriverMode(cfg.get<string>("oracleDbDriverMode", "auto"));
  const configuredLibDir = resolveLibDir(cfg.get<string>("oracleClientLibDir", ""));
  const recommendedOracleClientLibDir = getRecommendedOracleClientLibDir();
  const wslDistro = normalizeOptional(process.env.WSL_DISTRO_NAME);

  try {
    const oracledb = loadOracleDb();
    const runtime = getOracleDbRuntimeStatus();
    return {
      requestedMode: runtime?.requestedMode ?? requestedMode,
      effectiveMode: runtime?.mode ?? (oracledb.thin ? "thin" : "thick"),
      thin: Boolean(oracledb.thin),
      oracleClientVersionString: normalizeOptional(oracledb.oracleClientVersionString),
      configuredLibDir: runtime?.configuredLibDir ?? configuredLibDir,
      recommendedOracleClientLibDir,
      initError: runtime?.initError,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      isWsl: isWsl(),
      wslDistro,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const oracledb = require("oracledb");
    return {
      requestedMode,
      effectiveMode: oracledb.thin ? "thin" : "thick",
      thin: Boolean(oracledb.thin),
      oracleClientVersionString: normalizeOptional(oracledb.oracleClientVersionString),
      configuredLibDir,
      recommendedOracleClientLibDir,
      initError: detail,
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      isWsl: isWsl(),
      wslDistro,
      timestamp: new Date().toISOString(),
    };
  }
}

function normalizeDriverMode(value: string): DriverMode {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "thin" || normalized === "thick") {
    return normalized;
  }
  return "auto";
}

function resolveLibDir(raw: string): string | undefined {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

function showFallbackWarningOnce(detail: string, configuredLibDir?: string): void {
  if (fallbackWarned) {
    return;
  }
  fallbackWarned = true;
  const libDirHint = configuredLibDir ? ` (libDir=${configuredLibDir})` : "";
  vscode.window.showWarningMessage(
    "Oracle Thick mode initialization failed; falling back to Thin mode. " +
      `Detail: ${detail}${libDirHint}. ` +
      "If DB System uses Native Network Encryption, Thin mode may fail with NJS-533/ORA-12660. " +
      "Install Oracle Instant Client and set `ociAi.oracleDbDriverMode` to `thick` (or keep `auto`)."
  );
}

function normalizeOptional(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isWsl(): boolean {
  return Boolean(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP);
}

function getRecommendedOracleClientLibDir(): string {
  if (process.platform === "win32") {
    return "C:\\oracle\\instantclient_23_x";
  }
  return path.join(os.homedir(), "opt", "oracle", "instantclient_23_x");
}
