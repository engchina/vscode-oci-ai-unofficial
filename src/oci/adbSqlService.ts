import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import type * as database from "oci-database";
import { OciClientFactory } from "./clientFactory";
import { getOracleDbDiagnostics, getOracleDbRuntimeStatus, loadOracleDb } from "./oracleDbRuntime";
import type {
  ConnectAdbRequest,
  ConnectAdbResponse,
  DownloadAdbWalletRequest,
  DownloadAdbWalletResponse,
  ExplainSqlPlanRequest,
  ExplainSqlPlanResponse,
  ExecuteAdbSqlRequest,
  ExecuteAdbSqlResponse,
  ConnectDbSystemRequest,
  ConnectDbSystemResponse,
  ExecuteDbSystemSqlRequest,
  OracleDbDiagnosticsResponse,
  TestSqlConnectionResponse,
} from "../shared/services";

type DbConnection = {
  execute: (sql: string, binds: unknown[], options: Record<string, unknown>) => Promise<any>;
  close: () => Promise<void>;
};

type ConnectionEntry = {
  connection: DbConnection;
  autonomousDatabaseId: string;
};

export class AdbSqlService {
  private readonly walletRoot: string;
  private readonly connections = new Map<string, ConnectionEntry>();
  private readonly walletPasswords = new Map<string, string>();

  constructor(
    private readonly factory: OciClientFactory,
    storageRoot: string,
  ) {
    this.walletRoot = path.join(storageRoot, "adb-wallets");
  }

  public async downloadWallet(request: DownloadAdbWalletRequest): Promise<DownloadAdbWalletResponse> {
    const autonomousDatabaseId = request.autonomousDatabaseId.trim();
    const walletPassword = request.walletPassword;
    const requestRegion = String(request.region ?? "").trim();
    const inferredRegion = inferRegionFromAutonomousDatabaseId(autonomousDatabaseId);
    const resolvedRegion = requestRegion || inferredRegion;
    if (!autonomousDatabaseId) {
      throw new Error("autonomousDatabaseId is required.");
    }
    if (!walletPassword || walletPassword.length < 8) {
      throw new Error("Wallet password must be at least 8 characters.");
    }

    const client = await this.factory.createDatabaseClientAsync(resolvedRegion || undefined);
    const baseDir = path.join(this.walletRoot, sanitizePathSegment(autonomousDatabaseId));
    const walletDir = normalizeWalletPath(path.join(baseDir, "wallet"));
    const walletZipPath = path.join(baseDir, "wallet.zip");

    await fs.promises.mkdir(baseDir, { recursive: true });
    await fs.promises.rm(walletDir, { recursive: true, force: true });

    const response = await client.generateAutonomousDatabaseWallet({
      autonomousDatabaseId,
      generateAutonomousDatabaseWalletDetails: {
        password: walletPassword,
      },
    });
    await writeToFile(response.value, walletZipPath);

    await extractWalletZip(walletZipPath, walletDir);
    this.walletPasswords.set(walletDir, walletPassword);

    const serviceNames = await this.fetchServiceNames(client, autonomousDatabaseId);
    return { walletPath: walletDir, serviceNames };
  }

  public async connect(request: ConnectAdbRequest): Promise<ConnectAdbResponse> {
    const autonomousDatabaseId = request.autonomousDatabaseId.trim();

    if (!autonomousDatabaseId) {
      throw new Error("autonomousDatabaseId is required.");
    }
    // Keep exactly one active SQL connection to avoid session leaks and DB context mix-ups.
    await this.disconnectAll();

    const { connection, serviceName, walletPath } = await this.openAdbConnection(request);

    const connectionId = randomUUID();
    this.connections.set(connectionId, {
      connection,
      autonomousDatabaseId,
    });
    return {
      connectionId,
      autonomousDatabaseId,
      serviceName,
      walletPath,
    };
  }

  public async disconnect(connectionId: string): Promise<void> {
    const key = String(connectionId ?? "").trim();
    if (!key) {
      return;
    }
    const entry = this.connections.get(key);
    if (!entry) {
      return;
    }
    this.connections.delete(key);
    await entry.connection.close();
  }

  public async connectDbSystem(request: ConnectDbSystemRequest): Promise<ConnectDbSystemResponse> {
    const dbSystemId = request.dbSystemId.trim();

    if (!dbSystemId) throw new Error("dbSystemId is required.");

    await this.disconnectAll();

    const { connection, serviceName } = await this.openDbSystemConnection(request);

    const connectionId = randomUUID();
    this.connections.set(connectionId, {
      connection,
      autonomousDatabaseId: dbSystemId,
    });
    return {
      connectionId,
      dbSystemId,
      serviceName,
    };
  }

  public async executeDbSystemSql(request: ExecuteDbSystemSqlRequest): Promise<ExecuteAdbSqlResponse> {
    // Database execution logic is identical
    return this.executeSql({
      connectionId: request.connectionId,
      sql: request.sql,
    });
  }

  public getOracleDbDiagnostics(): OracleDbDiagnosticsResponse {
    return getOracleDbDiagnostics();
  }

  public async testAdbConnection(request: ConnectAdbRequest): Promise<TestSqlConnectionResponse> {
    const startedAt = Date.now();
    const { connection } = await this.openAdbConnection(request);
    try {
      await this.pingConnection(connection);
    } finally {
      await connection.close().catch(() => undefined);
    }

    return {
      success: true,
      message: "ADB connection test succeeded.",
      latencyMs: Date.now() - startedAt,
    };
  }

  public async testDbSystemConnection(request: ConnectDbSystemRequest): Promise<TestSqlConnectionResponse> {
    const startedAt = Date.now();
    const { connection } = await this.openDbSystemConnection(request);
    try {
      await this.pingConnection(connection);
    } finally {
      await connection.close().catch(() => undefined);
    }

    return {
      success: true,
      message: "DB System connection test succeeded.",
      latencyMs: Date.now() - startedAt,
    };
  }

  public async executeSql(request: ExecuteAdbSqlRequest): Promise<ExecuteAdbSqlResponse> {
    const connectionId = request.connectionId.trim();
    const sql = request.sql.trim();
    if (!connectionId) {
      throw new Error("connectionId is required.");
    }
    if (!sql) {
      throw new Error("SQL is required.");
    }
    const entry = this.connections.get(connectionId);
    if (!entry) {
      throw new Error("Connection not found. Please connect again.");
    }

    const oracledb = loadOracleDb();
    const result = await entry.connection.execute(sql, [], {
      outFormat: oracledb.OUT_FORMAT_OBJECT,
      autoCommit: true,
      maxRows: 1000,
    });

    if (Array.isArray(result.rows)) {
      const columns = Array.isArray(result.metaData)
        ? result.metaData
          .map((m: any) => String(m?.name ?? "").trim())
          .filter((name: string) => name.length > 0)
        : [];
      const rows = normalizeRows(result.rows, columns);
      return {
        isSelect: true,
        columns,
        rows,
        rowsAffected: rows.length,
        message: `Returned ${rows.length} row(s).`,
      };
    }

    const rowsAffected = Number(result.rowsAffected ?? 0);
    return {
      isSelect: false,
      columns: [],
      rows: [],
      rowsAffected,
      message: `Statement executed successfully. Rows affected: ${rowsAffected}.`,
    };
  }

  public async explainSqlPlan(request: ExplainSqlPlanRequest): Promise<ExplainSqlPlanResponse> {
    const connectionId = request.connectionId.trim();
    const sql = stripTrailingSemicolon(request.sql);
    if (!connectionId) {
      throw new Error("connectionId is required.");
    }
    if (!sql) {
      throw new Error("SQL is required.");
    }
    const entry = this.connections.get(connectionId);
    if (!entry) {
      throw new Error("Connection not found. Please connect again.");
    }

    const oracledb = loadOracleDb();
    await entry.connection.execute(`EXPLAIN PLAN FOR ${sql}`, [], {
      autoCommit: true,
    });
    const planResult = await entry.connection.execute(
      "SELECT PLAN_TABLE_OUTPUT FROM TABLE(DBMS_XPLAN.DISPLAY())",
      [],
      {
        outFormat: oracledb.OUT_FORMAT_OBJECT,
        maxRows: 500,
      },
    );

    const rows = normalizeRows(Array.isArray(planResult.rows) ? planResult.rows : [], ["PLAN_TABLE_OUTPUT"]);
    const planLines = rows
      .map((row) => row.PLAN_TABLE_OUTPUT)
      .filter((value): value is string => typeof value === "string");

    return {
      planLines,
      message: planLines.length > 0 ? "Explain plan generated successfully." : "No explain plan rows returned.",
    };
  }

  private async fetchServiceNames(
    client: database.DatabaseClient,
    autonomousDatabaseId: string,
  ): Promise<string[]> {
    const response = await client.getAutonomousDatabase({ autonomousDatabaseId });
    const connectionStrings = response.autonomousDatabase.connectionStrings;
    const values = new Set<string>();

    for (const profile of connectionStrings?.profiles ?? []) {
      const displayName = String(profile.displayName ?? "").trim();
      if (displayName) {
        values.add(displayName);
      }
    }

    const allConnectionStrings = connectionStrings?.allConnectionStrings ?? {};
    for (const value of Object.values(allConnectionStrings)) {
      const alias = extractServiceAlias(String(value ?? ""));
      if (alias) {
        values.add(alias);
      }
    }

    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }

  private async openAdbConnection(request: ConnectAdbRequest): Promise<{
    connection: DbConnection;
    serviceName: string;
    walletPath: string;
  }> {
    const autonomousDatabaseId = request.autonomousDatabaseId.trim();
    const walletPathRaw = request.walletPath.trim();
    const username = request.username.trim();
    const serviceName = request.serviceName.trim();

    if (!autonomousDatabaseId) {
      throw new Error("autonomousDatabaseId is required.");
    }
    if (!walletPathRaw) {
      throw new Error("walletPath is required.");
    }
    if (!username) {
      throw new Error("username is required.");
    }
    if (!request.password) {
      throw new Error("password is required.");
    }
    if (!serviceName) {
      throw new Error("serviceName is required.");
    }

    const walletPath = normalizeWalletPath(walletPathRaw);
    const stats = await fs.promises.stat(walletPath).catch(() => undefined);
    if (!stats?.isDirectory()) {
      throw new Error(`Wallet path not found or not a directory: ${walletPath}`);
    }

    const oracledb = loadOracleDb();
    const walletPassword = request.walletPassword?.trim() || this.walletPasswords.get(walletPath);
    if (!walletPassword) {
      throw new Error("walletPassword is required for this wallet path.");
    }

    try {
      const connection = (await oracledb.getConnection({
        user: username,
        password: request.password,
        connectString: serviceName,
        configDir: walletPath,
        walletLocation: walletPath,
        walletPassword,
      })) as DbConnection;
      return {
        connection,
        serviceName,
        walletPath,
      };
    } catch (error) {
      throw enrichConnectError(error, autonomousDatabaseId, serviceName);
    }
  }

  private async openDbSystemConnection(request: ConnectDbSystemRequest): Promise<{
    connection: DbConnection;
    serviceName: string;
  }> {
    const dbSystemId = request.dbSystemId.trim();
    const username = request.username.trim();
    const serviceName = request.serviceName.trim();

    if (!dbSystemId) throw new Error("dbSystemId is required.");
    if (!username) throw new Error("username is required.");
    if (!request.password) throw new Error("password is required.");
    if (!serviceName) throw new Error("serviceName (connection string) is required.");

    const oracledb = loadOracleDb();
    try {
      const connection = (await oracledb.getConnection({
        user: username,
        password: request.password,
        connectString: serviceName,
      })) as DbConnection;
      return {
        connection,
        serviceName,
      };
    } catch (error) {
      throw enrichConnectError(error, dbSystemId, serviceName);
    }
  }

  private async pingConnection(connection: DbConnection): Promise<void> {
    await connection.execute("SELECT 1 AS CONNECTION_OK FROM DUAL", [], {
      autoCommit: false,
      maxRows: 1,
    });
  }

  private async disconnectAll(): Promise<void> {
    const entries = Array.from(this.connections.entries());
    this.connections.clear();
    await Promise.allSettled(entries.map(([, entry]) => entry.connection.close()));
  }

  public async dispose(): Promise<void> {
    await this.disconnectAll();
  }
}

async function writeToFile(source: unknown, destinationPath: string): Promise<void> {
  if (typeof source === "string" || Buffer.isBuffer(source)) {
    await fs.promises.writeFile(destinationPath, source);
    return;
  }
  const nodeReadable =
    source instanceof Readable ? source : Readable.fromWeb(source as any);
  const writeStream = fs.createWriteStream(destinationPath);
  await pipeline(nodeReadable, writeStream);
}

async function extractWalletZip(walletZipPath: string, targetDir: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const AdmZip = require("adm-zip");
  await fs.promises.mkdir(targetDir, { recursive: true });
  const zip = new AdmZip(walletZipPath);
  zip.extractAllTo(targetDir, true);
}

function normalizeRows(rows: any[], columns: string[]): Array<Record<string, string | number | boolean | null>> {
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      const normalized: Record<string, string | number | boolean | null> = {};
      columns.forEach((name, idx) => {
        normalized[name] = normalizeCellValue(row?.[idx]);
      });
      return normalized;
    }

    const normalized: Record<string, string | number | boolean | null> = {};
    const keys = columns.length > 0 ? columns : Object.keys(row);
    for (const key of keys) {
      normalized[key] = normalizeCellValue((row as Record<string, unknown>)[key]);
    }
    return normalized;
  });
}

function normalizeCellValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Buffer.isBuffer(value)) {
    return `<Buffer ${value.byteLength} bytes>`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function normalizeWalletPath(value: string): string {
  return path.resolve(value);
}

function extractServiceAlias(connectString: string): string {
  const trimmed = connectString.trim();
  if (!trimmed) {
    return "";
  }
  const slashIdx = trimmed.lastIndexOf("/");
  if (slashIdx < 0 || slashIdx >= trimmed.length - 1) {
    return "";
  }
  return trimmed.slice(slashIdx + 1).trim();
}

function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;+\s*$/g, "");
}

function inferRegionFromAutonomousDatabaseId(autonomousDatabaseId: string): string {
  // OCID pattern for ADB commonly contains ".oc1.<region>." (e.g. ".oc1.ap-osaka-1.")
  const match = autonomousDatabaseId.match(/\.oc1\.([a-z0-9-]+)\./i);
  return match?.[1]?.trim() ?? "";
}

function enrichConnectError(error: unknown, autonomousDatabaseId: string, serviceName: string): Error {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail.includes("ORA-01017")) {
    return new Error(
      `ORA-01017 for database ${autonomousDatabaseId} (service: ${serviceName}). ` +
      "Please verify Username/Password and that Wallet Path + Service Name belong to the same selected database."
    );
  }
  if (detail.includes("NJS-533") || detail.includes("ORA-12660")) {
    const runtime = getOracleDbRuntimeStatus();
    const mode = runtime?.mode ?? "thin";
    const initHint = runtime?.initError ? ` Thick init detail: ${runtime.initError}.` : "";
    return new Error(
      `${detail}\n` +
      `Connection to ${autonomousDatabaseId} (service: ${serviceName}) requires Oracle Net encryption support via node-oracledb Thick mode. ` +
      `Current driver mode: ${mode}.${initHint} ` +
      "Fix: install Oracle Instant Client and set `ociAi.oracleDbDriverMode` to `thick` (or `auto`) " +
      "with optional `ociAi.oracleClientLibDir`. " +
      "Fallback (no Instant Client): SSH to DB System and connect with sqlplus."
    );
  }
  return error instanceof Error ? error : new Error(detail);
}
