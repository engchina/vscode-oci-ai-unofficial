import { useMemo, useState } from "react"
import type { OracleDbDiagnosticsResponse } from "../../services/types"
import Button from "../ui/Button"

type ProblemType =
  | "ok"
  | "instant_client_missing"
  | "thick_binary_missing"
  | "encryption_requires_thick"
  | "unknown"

type Guide = {
  problemType: ProblemType
  title: string
  summary: string
  steps: string[]
  commands: string[]
  docsUrl: string
}

const NODE_ORACLEDB_INSTALL_DOC =
  "https://node-oracledb.readthedocs.io/en/latest/user_guide/installation.html"

export default function OracleDiagnosticsPanel({ diagnostics }: { diagnostics: OracleDbDiagnosticsResponse | null }) {
  const [copyMessage, setCopyMessage] = useState("")
  const guide = useMemo(() => (diagnostics ? buildGuide(diagnostics) : null), [diagnostics])

  if (!diagnostics || !guide) {
    return null
  }

  const commandText = guide.commands.join("\n")

  const handleCopy = async () => {
    if (!commandText.trim()) {
      setCopyMessage("No command available")
      return
    }
    try {
      await navigator.clipboard.writeText(commandText)
      setCopyMessage("Commands copied")
      window.setTimeout(() => setCopyMessage(""), 1800)
    } catch {
      setCopyMessage("Copy failed")
      window.setTimeout(() => setCopyMessage(""), 1800)
    }
  }

  return (
    <div className="rounded-md border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_97%,black_3%)] px-2.5 py-2 text-[11px] text-description">
      <div><span className="font-semibold text-foreground">Problem Type:</span> <code>{guide.problemType}</code></div>
      <div><span className="font-semibold text-foreground">Driver Requested:</span> <code>{diagnostics.requestedMode}</code></div>
      <div><span className="font-semibold text-foreground">Driver Effective:</span> <code>{diagnostics.effectiveMode}</code></div>
      <div><span className="font-semibold text-foreground">Thin Mode:</span> <code>{String(diagnostics.thin)}</code></div>
      <div><span className="font-semibold text-foreground">Oracle Client Version:</span> <code>{diagnostics.oracleClientVersionString || "-"}</code></div>
      <div><span className="font-semibold text-foreground">libDir:</span> <code>{diagnostics.configuredLibDir || "(auto)"}</code></div>
      <div><span className="font-semibold text-foreground">Recommended libDir:</span> <code>{diagnostics.recommendedOracleClientLibDir}</code></div>
      <div><span className="font-semibold text-foreground">Runtime:</span> <code>{diagnostics.platform}/{diagnostics.arch}{diagnostics.isWsl ? ` (WSL${diagnostics.wslDistro ? `:${diagnostics.wslDistro}` : ""})` : ""}</code></div>
      <div><span className="font-semibold text-foreground">Node:</span> <code>{diagnostics.nodeVersion}</code></div>
      <div><span className="font-semibold text-foreground">Checked At:</span> <code>{new Date(diagnostics.timestamp).toLocaleString()}</code></div>
      {diagnostics.initError && (
        <div className="mt-1"><span className="font-semibold text-error">Init Error:</span> <code className="text-error break-all">{diagnostics.initError}</code></div>
      )}

      <div className="mt-2 rounded border border-border-panel bg-input-background px-2 py-1.5">
        <div className="font-semibold text-foreground">{guide.title}</div>
        <div className="mt-0.5">{guide.summary}</div>
      </div>

      <div className="mt-2 space-y-1">
        {guide.steps.map((step, idx) => (
          <div key={idx}><span className="font-semibold text-foreground">{idx + 1}.</span> {step}</div>
        ))}
      </div>

      {guide.commands.length > 0 && (
        <pre className="mt-2 whitespace-pre-wrap rounded border border-border-panel bg-input-background px-2 py-1.5 text-[10px] leading-relaxed text-description">{commandText}</pre>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={handleCopy} disabled={guide.commands.length === 0}>
          Copy Commands
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => window.open(guide.docsUrl, "_blank", "noopener,noreferrer")}>
          Open Docs
        </Button>
        {copyMessage && <span className="self-center text-[10px] text-description">{copyMessage}</span>}
      </div>
    </div>
  )
}

function buildGuide(diagnostics: OracleDbDiagnosticsResponse): Guide {
  const problemType = classifyProblem(diagnostics)
  const runtimeHint = `${diagnostics.platform}/${diagnostics.arch}${diagnostics.isWsl ? " (WSL)" : ""}`
  const isLinux = diagnostics.platform === "linux"
  const isWindows = diagnostics.platform === "win32"

  if (problemType === "ok") {
    return {
      problemType,
      title: "Driver is ready",
      summary: "No installation issue detected from the latest diagnostic.",
      steps: [
        "If the target DB requires Native Network Encryption, keep driver mode as thick or auto.",
        "If you still cannot connect, verify connect string/service name and network ACL/security list.",
      ],
      commands: [],
      docsUrl: NODE_ORACLEDB_INSTALL_DOC,
    }
  }

  if (problemType === "instant_client_missing") {
    return {
      problemType,
      title: "Oracle Instant Client is missing",
      summary: `Thick mode cannot load Oracle Client libraries in runtime ${runtimeHint}.`,
      steps: [
        "Install Oracle Instant Client on the same machine where this extension host runs.",
        "Set VS Code settings: ociAi.oracleDbDriverMode=thick (or auto) and ociAi.oracleClientLibDir=<instant_client_dir>.",
        "Click Connection Diagnostic again to verify Thick mode is effective.",
      ],
      commands: getInstantClientCommands(diagnostics, isLinux, isWindows),
      docsUrl: NODE_ORACLEDB_INSTALL_DOC,
    }
  }

  if (problemType === "thick_binary_missing") {
    return {
      problemType,
      title: "node-oracledb Thick binary is not available",
      summary: `The native addon for runtime ${runtimeHint} is missing or incompatible.`,
      steps: [
        "Install/rebuild oracledb in the extension host environment (local/SSH/WSL/container where extension runs).",
        "Ensure Node ABI matches packaged oracledb binary; then reopen VS Code window.",
        "If you cannot fix this environment, switch to thin mode as temporary fallback.",
      ],
      commands: [
        "npm rebuild oracledb --update-binary",
        "# If needed, reinstall and rebuild:",
        "npm i oracledb@^6.10.0",
      ],
      docsUrl: NODE_ORACLEDB_INSTALL_DOC,
    }
  }

  if (problemType === "encryption_requires_thick") {
    return {
      problemType,
      title: "Database requires Thick mode (NNE/Data Integrity)",
      summary: "Target DB enforces Oracle Native Network Encryption or checksum.",
      steps: [
        "Enable Thick mode and ensure Instant Client can be loaded.",
        "Keep ociAi.oracleDbDriverMode as thick/auto and set oracleClientLibDir if auto-discovery fails.",
        "If this machine cannot install Instant Client, use SSH into DB system and connect via sqlplus as fallback.",
      ],
      commands: getInstantClientCommands(diagnostics, isLinux, isWindows),
      docsUrl: NODE_ORACLEDB_INSTALL_DOC,
    }
  }

  return {
    problemType,
    title: "Unknown initialization issue",
    summary: "The driver reported an unexpected initialization error.",
    steps: [
      "Open docs and validate Thick mode prerequisites for this runtime.",
      "If you are on WSL/Remote, install dependencies in that remote host, not only on local Windows/macOS.",
      "Run Connection Diagnostic again after changes.",
    ],
    commands: [],
    docsUrl: NODE_ORACLEDB_INSTALL_DOC,
  }
}

function classifyProblem(diagnostics: OracleDbDiagnosticsResponse): ProblemType {
  const detail = String(diagnostics.initError ?? "").toUpperCase()
  if (!detail) {
    return "ok"
  }
  if (detail.includes("DPI-1047")) {
    return "instant_client_missing"
  }
  if (detail.includes("NJS-045")) {
    return "thick_binary_missing"
  }
  if (detail.includes("NJS-533") || detail.includes("ORA-12660")) {
    return "encryption_requires_thick"
  }
  return "unknown"
}

function getInstantClientCommands(
  diagnostics: OracleDbDiagnosticsResponse,
  isLinux: boolean,
  isWindows: boolean
): string[] {
  const recommendedLibDir = diagnostics.recommendedOracleClientLibDir

  if (isWindows) {
    return [
      "1) Download Oracle Instant Client Basic package (Windows x64) from Oracle official site.",
      `2) Unzip to ${recommendedLibDir}`,
      "3) In VS Code settings.json set:",
      "\"ociAi.oracleDbDriverMode\": \"thick\",",
      `"ociAi.oracleClientLibDir": "${escapeForJsonWindowsPath(recommendedLibDir)}",`,
    ]
  }

  if (isLinux || diagnostics.isWsl) {
    const baseDir = getParentDir(recommendedLibDir)
    return [
      "sudo apt-get update && sudo apt-get install -y libaio1 unzip",
      `mkdir -p "${baseDir}" && cd "${baseDir}"`,
      "# Download instantclient-basiclite-linux.x64-23*.zip from Oracle to this directory, then:",
      "unzip instantclient-basiclite-linux.x64-23*.zip",
      "# In VS Code settings.json set:",
      "\"ociAi.oracleDbDriverMode\": \"thick\",",
      `"ociAi.oracleClientLibDir": "${recommendedLibDir}",`,
    ]
  }

  return [
    "1) Download Oracle Instant Client for your platform from Oracle official site.",
    "2) Unzip and set ociAi.oracleClientLibDir to that folder.",
    "3) Set ociAi.oracleDbDriverMode to thick (or auto).",
  ]
}

function escapeForJsonWindowsPath(value: string): string {
  return value.replace(/\\/g, "\\\\")
}

function getParentDir(value: string): string {
  const normalized = value.trim()
  const slashIndex = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"))
  if (slashIndex <= 0) {
    return normalized || "."
  }
  return normalized.slice(0, slashIndex)
}
