import * as fs from "fs/promises";
import * as path from "path";

export type SkillScanSeverity = "info" | "warn" | "critical";

export interface SkillScanFinding {
  ruleId: string;
  severity: SkillScanSeverity;
  file: string;
  line: number;
  message: string;
  evidence: string;
  recommendation: string;
}

export interface SkillScanSummary {
  scannedFiles: number;
  critical: number;
  warn: number;
  info: number;
  findings: SkillScanFinding[];
}

export interface SkillScanOptions {
  includeFiles?: string[];
  maxFiles?: number;
  maxFileBytes?: number;
}

export interface SkillScanRuleInfo {
  ruleId: string;
  severity: SkillScanSeverity;
  message: string;
  recommendation: string;
}

const SCANNABLE_EXTENSIONS = new Set([
  ".js",
  ".ts",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".jsx",
  ".tsx",
])

const DEFAULT_MAX_SCAN_FILES = 500
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024
const FILE_SCAN_CACHE_MAX = 5000
const DIR_ENTRY_CACHE_MAX = 5000

type FileScanCacheEntry = {
  size: number
  mtimeMs: number
  maxFileBytes: number
  scanned: boolean
  findings: SkillScanFinding[]
}

type CachedDirEntry = {
  name: string
  kind: "file" | "dir"
}

type DirEntryCacheEntry = {
  mtimeMs: number
  entries: CachedDirEntry[]
}

const FILE_SCAN_CACHE = new Map<string, FileScanCacheEntry>()
const DIR_ENTRY_CACHE = new Map<string, DirEntryCacheEntry>()

type LineRule = {
  ruleId: string
  severity: SkillScanSeverity
  message: string
  recommendation: string
  pattern: RegExp
  requiresContext?: RegExp
}

type SourceRule = {
  ruleId: string
  severity: SkillScanSeverity
  message: string
  recommendation: string
  pattern: RegExp
  requiresContext?: RegExp
}

const LINE_RULES: LineRule[] = [
  {
    ruleId: "dangerous-exec",
    severity: "critical",
    message: "Shell command execution detected (child_process)",
    recommendation: "Review every shell invocation and remove or sandbox commands that are not essential.",
    pattern: /\b(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/,
    requiresContext: /child_process/,
  },
  {
    ruleId: "dynamic-code-execution",
    severity: "critical",
    message: "Dynamic code execution detected",
    recommendation: "Replace eval-style logic with explicit parsing or safe dispatch tables.",
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
  },
  {
    ruleId: "crypto-mining",
    severity: "critical",
    message: "Possible crypto-mining reference detected",
    recommendation: "Remove mining-related code and verify the skill source is trustworthy before running it.",
    pattern: /stratum\+tcp|stratum\+ssl|coinhive|cryptonight|xmrig/i,
  },
  {
    ruleId: "suspicious-network",
    severity: "warn",
    message: "WebSocket connection to non-standard port",
    recommendation: "Verify the destination, purpose, and data being transmitted before trusting this skill.",
    pattern: /new\s+WebSocket\s*\(\s*["']wss?:\/\/[^"']*:(\d+)/,
  },
]

const SOURCE_RULES: SourceRule[] = [
  {
    ruleId: "potential-exfiltration",
    severity: "warn",
    message: "File read combined with network send — possible data exfiltration",
    recommendation: "Inspect the code path to confirm local file contents are not being sent to external services unexpectedly.",
    pattern: /readFileSync|readFile/,
    requiresContext: /\bfetch\b|\bpost\b|http\.request/i,
  },
  {
    ruleId: "obfuscated-code",
    severity: "warn",
    message: "Hex-encoded string sequence detected (possible obfuscation)",
    recommendation: "Decode or rewrite obfuscated strings before trusting the behavior of this skill.",
    pattern: /(\\x[0-9a-fA-F]{2}){6,}/,
  },
  {
    ruleId: "obfuscated-code",
    severity: "warn",
    message: "Large base64 payload with decode call detected (possible obfuscation)",
    recommendation: "Inspect decoded payloads and prefer readable source before enabling this skill.",
    pattern: /(?:atob|Buffer\.from)\s*\(\s*["'][A-Za-z0-9+/=]{200,}["']/,
  },
  {
    ruleId: "env-harvesting",
    severity: "critical",
    message: "Environment variable access combined with network send — possible credential harvesting",
    recommendation: "Assume secrets may be leaving the machine until the code is reviewed and reduced.",
    pattern: /process\.env/,
    requiresContext: /\bfetch\b|\bpost\b|http\.request/i,
  },
]

const STANDARD_PORTS = new Set([80, 443, 8080, 8443, 3000])

export function getSkillScanRuleCatalog(): SkillScanRuleInfo[] {
  const rules = [...LINE_RULES, ...SOURCE_RULES]
  const seen = new Set<string>()
  const catalog: SkillScanRuleInfo[] = []
  for (const rule of rules) {
    const key = `${rule.ruleId}::${rule.message}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    catalog.push({
      ruleId: rule.ruleId,
      severity: rule.severity,
      message: rule.message,
      recommendation: rule.recommendation,
    })
  }
  return catalog.sort((left, right) => left.ruleId.localeCompare(right.ruleId) || left.message.localeCompare(right.message))
}

function normalizeScanOptions(opts?: SkillScanOptions): Required<SkillScanOptions> {
  return {
    includeFiles: opts?.includeFiles ?? [],
    maxFiles: Math.max(1, opts?.maxFiles ?? DEFAULT_MAX_SCAN_FILES),
    maxFileBytes: Math.max(1, opts?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES),
  }
}

function getCachedFileScanResult(params: {
  filePath: string
  size: number
  mtimeMs: number
  maxFileBytes: number
}): FileScanCacheEntry | undefined {
  const cached = FILE_SCAN_CACHE.get(params.filePath)
  if (!cached) {
    return undefined
  }
  if (
    cached.size !== params.size ||
    cached.mtimeMs !== params.mtimeMs ||
    cached.maxFileBytes !== params.maxFileBytes
  ) {
    FILE_SCAN_CACHE.delete(params.filePath)
    return undefined
  }
  return cached
}

function setCachedFileScanResult(filePath: string, entry: FileScanCacheEntry): void {
  if (FILE_SCAN_CACHE.size >= FILE_SCAN_CACHE_MAX) {
    const oldest = FILE_SCAN_CACHE.keys().next()
    if (!oldest.done) {
      FILE_SCAN_CACHE.delete(oldest.value)
    }
  }
  FILE_SCAN_CACHE.set(filePath, entry)
}

function setCachedDirEntries(dirPath: string, entry: DirEntryCacheEntry): void {
  if (DIR_ENTRY_CACHE.size >= DIR_ENTRY_CACHE_MAX) {
    const oldest = DIR_ENTRY_CACHE.keys().next()
    if (!oldest.done) {
      DIR_ENTRY_CACHE.delete(oldest.value)
    }
  }
  DIR_ENTRY_CACHE.set(dirPath, entry)
}

function isScannable(filePath: string): boolean {
  return SCANNABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase())
}

function truncateEvidence(evidence: string, maxLen = 120): string {
  return evidence.length <= maxLen ? evidence : `${evidence.slice(0, maxLen)}...`
}

function scanSource(source: string, filePath: string): SkillScanFinding[] {
  const findings: SkillScanFinding[] = []
  const lines = source.split("\n")
  const matchedLineRules = new Set<string>()

  for (const rule of LINE_RULES) {
    if (matchedLineRules.has(rule.ruleId)) {
      continue
    }
    if (rule.requiresContext && !rule.requiresContext.test(source)) {
      continue
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      const match = rule.pattern.exec(line)
      if (!match) {
        continue
      }
      if (rule.ruleId === "suspicious-network") {
        const port = parseInt(match[1] ?? "", 10)
        if (STANDARD_PORTS.has(port)) {
          continue
        }
      }
      findings.push({
        ruleId: rule.ruleId,
        severity: rule.severity,
        file: filePath,
        line: index + 1,
        message: rule.message,
        evidence: truncateEvidence(line.trim()),
        recommendation: rule.recommendation,
      })
      matchedLineRules.add(rule.ruleId)
      break
    }
  }

  const matchedSourceRules = new Set<string>()
  for (const rule of SOURCE_RULES) {
    const ruleKey = `${rule.ruleId}::${rule.message}`
    if (matchedSourceRules.has(ruleKey)) {
      continue
    }
    if (!rule.pattern.test(source)) {
      continue
    }
    if (rule.requiresContext && !rule.requiresContext.test(source)) {
      continue
    }

    let matchLine = 1
    let matchEvidence = source.slice(0, 120)
    for (let index = 0; index < lines.length; index += 1) {
      if (rule.pattern.test(lines[index])) {
        matchLine = index + 1
        matchEvidence = lines[index].trim()
        break
      }
    }

    findings.push({
      ruleId: rule.ruleId,
      severity: rule.severity,
      file: filePath,
      line: matchLine,
      message: rule.message,
      evidence: truncateEvidence(matchEvidence),
      recommendation: rule.recommendation,
    })
    matchedSourceRules.add(ruleKey)
  }

  return findings
}

async function walkDirWithLimit(dirPath: string, maxFiles: number): Promise<string[]> {
  const files: string[] = []
  const stack = [dirPath]

  while (stack.length > 0 && files.length < maxFiles) {
    const currentDir = stack.pop()
    if (!currentDir) {
      break
    }

    const entries = await readDirEntriesWithCache(currentDir)
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        break
      }
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue
      }
      const fullPath = path.join(currentDir, entry.name)
      if (entry.kind === "dir") {
        stack.push(fullPath)
      } else if (entry.kind === "file" && isScannable(fullPath)) {
        files.push(fullPath)
      }
    }
  }

  return files
}

async function resolveForcedFiles(rootDir: string, includeFiles: string[]): Promise<string[]> {
  const results: string[] = []
  for (const includeFile of includeFiles) {
    const candidate = path.resolve(rootDir, includeFile)
    const relative = path.relative(rootDir, candidate)
    if (relative.startsWith("..") || path.isAbsolute(relative) || !isScannable(candidate)) {
      continue
    }
    try {
      const stat = await fs.stat(candidate)
      if (stat.isFile()) {
        results.push(candidate)
      }
    } catch {
      // Ignore missing forced paths.
    }
  }
  return results
}

async function readDirEntriesWithCache(dirPath: string): Promise<CachedDirEntry[]> {
  let stat
  try {
    stat = await fs.stat(dirPath)
  } catch {
    return []
  }
  if (!stat.isDirectory()) {
    return []
  }

  const cached = DIR_ENTRY_CACHE.get(dirPath)
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.entries
  }

  const dirents = await fs.readdir(dirPath, { withFileTypes: true }).catch(() => [])
  const entries: CachedDirEntry[] = []
  for (const entry of dirents) {
    if (entry.isDirectory()) {
      entries.push({ name: entry.name, kind: "dir" })
    } else if (entry.isFile()) {
      entries.push({ name: entry.name, kind: "file" })
    }
  }

  setCachedDirEntries(dirPath, {
    mtimeMs: stat.mtimeMs,
    entries,
  })
  return entries
}

async function collectScannableFiles(dirPath: string, opts: Required<SkillScanOptions>): Promise<string[]> {
  const forcedFiles = await resolveForcedFiles(dirPath, opts.includeFiles)
  if (forcedFiles.length >= opts.maxFiles) {
    return forcedFiles.slice(0, opts.maxFiles)
  }

  const walkedFiles = await walkDirWithLimit(dirPath, opts.maxFiles)
  const seen = new Set(forcedFiles.map((file) => path.resolve(file)))
  const output = [...forcedFiles]
  for (const file of walkedFiles) {
    if (output.length >= opts.maxFiles) {
      break
    }
    const resolved = path.resolve(file)
    if (seen.has(resolved)) {
      continue
    }
    output.push(file)
    seen.add(resolved)
  }
  return output
}

export async function scanDirectoryWithSummary(
  dirPath: string,
  opts?: SkillScanOptions,
): Promise<SkillScanSummary> {
  const options = normalizeScanOptions(opts)
  const files = await collectScannableFiles(dirPath, options)
  const findings: SkillScanFinding[] = []
  let scannedFiles = 0
  let critical = 0
  let warn = 0
  let info = 0

  for (const file of files) {
    let stat
    try {
      stat = await fs.stat(file)
    } catch {
      continue
    }
    if (!stat.isFile() || stat.size > options.maxFileBytes) {
      if (stat.isFile()) {
        setCachedFileScanResult(file, {
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          maxFileBytes: options.maxFileBytes,
          scanned: false,
          findings: [],
        })
      }
      continue
    }
    const cached = getCachedFileScanResult({
      filePath: file,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      maxFileBytes: options.maxFileBytes,
    })
    if (cached) {
      if (!cached.scanned) {
        continue
      }
      scannedFiles += 1
      for (const finding of cached.findings) {
        findings.push(finding)
        if (finding.severity === "critical") {
          critical += 1
        } else if (finding.severity === "warn") {
          warn += 1
        } else {
          info += 1
        }
      }
      continue
    }
    let source = ""
    try {
      source = await fs.readFile(file, "utf-8")
    } catch {
      continue
    }
    scannedFiles += 1
    const fileFindings = scanSource(source, file)
    setCachedFileScanResult(file, {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      maxFileBytes: options.maxFileBytes,
      scanned: true,
      findings: fileFindings,
    })
    for (const finding of fileFindings) {
      findings.push(finding)
      if (finding.severity === "critical") {
        critical += 1
      } else if (finding.severity === "warn") {
        warn += 1
      } else {
        info += 1
      }
    }
  }

  return {
    scannedFiles,
    critical,
    warn,
    info,
    findings,
  }
}
