export type HostPreference = "public" | "private"

export type SshConfig = {
  username: string
  port: number
  privateKeyPath: string
  hostPreference: HostPreference
  disableHostKeyChecking: boolean
}

export const SSH_CONFIG_STORAGE_KEY = "ociAi.compute.sshConfig"
export const DEFAULT_SSH_USERNAME = "opc"

export function defaultSshConfig(): SshConfig {
  return {
    username: DEFAULT_SSH_USERNAME,
    port: 22,
    privateKeyPath: "",
    hostPreference: "public",
    disableHostKeyChecking: false,
  }
}

export function loadSshConfig(): SshConfig {
  const fallback = defaultSshConfig()
  try {
    const raw = window.localStorage.getItem(SSH_CONFIG_STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as Partial<SshConfig>
    return {
      username: typeof parsed.username === "string" ? parsed.username : fallback.username,
      port: typeof parsed.port === "number" ? clampPort(parsed.port) : fallback.port,
      privateKeyPath: typeof parsed.privateKeyPath === "string" ? parsed.privateKeyPath : fallback.privateKeyPath,
      hostPreference: parsed.hostPreference === "private" ? "private" : "public",
      disableHostKeyChecking: Boolean(parsed.disableHostKeyChecking),
    }
  } catch {
    return fallback
  }
}

export function saveSshConfig(config: SshConfig): void {
  try {
    window.localStorage.setItem(SSH_CONFIG_STORAGE_KEY, JSON.stringify(config))
  } catch {
    // Ignore local persistence failures in restricted webview environments.
  }
}

export function clampPort(value: string | number): number {
  const port = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(port)) return 22
  return Math.max(1, Math.min(65535, Math.trunc(port)))
}
