import type { BastionSessionResource } from "../../services/types"

const PRIVATE_KEY_TOKEN = "<privateKey>"
const LOCAL_PORT_TOKEN = "<localPort>"
const SAFE_SHELL_ARG_PATTERN = /^[A-Za-z0-9_@%+=:,./~-]+$/
export const DEFAULT_BASTION_PRIVATE_KEY_PATH = "~/.ssh/id_rsa"

export type PreparedBastionSshCommand = {
  executable: string
  args: string[]
  command: string
  requiresPrivateKey: boolean
  requiresLocalPort: boolean
  errors: string[]
}

export function getDefaultBastionLocalPort(session: BastionSessionResource | null | undefined, commandTemplate: string): string {
  const targetPort = session?.targetResourceDetails?.targetResourcePort
  if (typeof targetPort === "number" && Number.isFinite(targetPort) && targetPort > 0 && targetPort <= 65535) {
    return String(Math.trunc(targetPort))
  }

  const match = commandTemplate.match(/<localPort>:[^:\s]+:(\d{1,5})(?:\s|$)/)
  if (match?.[1]) {
    return match[1]
  }

  return "8080"
}

export function prepareBastionSshCommand(
  commandTemplate: string,
  values: {
    privateKeyPath?: string
    localPort?: string
  },
): PreparedBastionSshCommand {
  const template = commandTemplate.trim()
  const requiresPrivateKey = template.includes(PRIVATE_KEY_TOKEN)
  const requiresLocalPort = template.includes(LOCAL_PORT_TOKEN)
  const privateKeyPath = String(values.privateKeyPath ?? "").trim()
  const localPort = String(values.localPort ?? "").trim()
  const effectivePrivateKeyPath = privateKeyPath || DEFAULT_BASTION_PRIVATE_KEY_PATH
  const errors: string[] = []

  if (!template) {
    errors.push("No SSH command is available for this session yet.")
  }
  if (requiresLocalPort && !isValidPort(localPort)) {
    errors.push("Local port must be between 1 and 65535.")
  }

  const templateParts = template.split(/\s+/).filter(Boolean)
  const executable = templateParts[0] ?? "ssh"
  const resolvedParts = templateParts.map((part) => replaceCommandPlaceholders(part, {
    privateKeyPath: requiresPrivateKey ? effectivePrivateKeyPath : privateKeyPath,
    localPort: requiresLocalPort ? localPort || LOCAL_PORT_TOKEN : localPort,
  }))
  const args = resolvedParts.slice(1)

  return {
    executable,
    args,
    command: formatShellCommand(resolvedParts),
    requiresPrivateKey,
    requiresLocalPort,
    errors,
  }
}

function replaceCommandPlaceholders(
  value: string,
  replacements: {
    privateKeyPath?: string
    localPort?: string
  },
): string {
  let next = value
  if (replacements.privateKeyPath !== undefined) {
    next = next.split(PRIVATE_KEY_TOKEN).join(replacements.privateKeyPath)
  }
  if (replacements.localPort !== undefined) {
    next = next.split(LOCAL_PORT_TOKEN).join(replacements.localPort)
  }
  return next
}

function formatShellCommand(parts: string[]): string {
  return parts.map(formatShellArg).join(" ")
}

function formatShellArg(value: string): string {
  if (value.length === 0) {
    return "''"
  }
  if (SAFE_SHELL_ARG_PATTERN.test(value)) {
    return value
  }
  return `'${value.replace(/'/g, `'\"'\"'`)}'`
}

function isValidPort(value: string): boolean {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535
}
