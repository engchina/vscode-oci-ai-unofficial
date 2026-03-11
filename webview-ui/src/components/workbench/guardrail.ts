export type WorkbenchGuardrailTone = "warning" | "danger"

export interface WorkbenchGuardrailConfig {
  title: string
  description: string
  confirmLabel?: string
  details?: string[]
  tone?: WorkbenchGuardrailTone
  onConfirm: () => Promise<void>
}

export type WorkbenchGuardrailState = WorkbenchGuardrailConfig | null

export function createWorkbenchGuardrail(config: WorkbenchGuardrailConfig): WorkbenchGuardrailConfig {
  return {
    tone: "warning",
    confirmLabel: "Confirm",
    details: [],
    ...config,
  }
}

export interface WorkbenchGuardrailDetail {
  label: string
  value: string
}

interface WorkbenchResourceDetailConfig {
  resourceLabel: string
  resourceName: string
  region?: string
  regionLabel?: string
  extras?: WorkbenchGuardrailDetail[]
}

interface WorkbenchNamedGuardrailConfig {
  title: string
  description: string
  confirmLabel: string
  details?: WorkbenchGuardrailDetail[]
  onConfirm: () => Promise<void>
}

interface WorkbenchTemplatedGuardrailConfig {
  resourceTitle?: string
  confirmTarget?: string
  subject?: string
  effect?: string
  resourceKind?: WorkbenchGuardrailResourceKind
  details?: WorkbenchGuardrailDetail[]
  onConfirm: () => Promise<void>
}

type WorkbenchGuardrailActionKind = "start" | "stop" | "delete" | "create" | "save" | "clear" | "overwrite"
type WorkbenchGuardrailResourceKind =
  | "compute-instance"
  | "autonomous-database"
  | "db-system"
  | "bastion-session"
  | "security-list"
  | "pre-authenticated-link"
  | "oci-profile"
  | "compartment"
  | "sql-connection-profile"
  | "sql-favorite"
  | "sql-history"
  | "chat-history"

interface WorkbenchGuardrailResourceTemplate {
  resourceTitle: string
  confirmTarget?: string
  subject: string
  effects: Partial<Record<WorkbenchGuardrailActionKind, string>>
}

export function buildWorkbenchGuardrailDetails(details: WorkbenchGuardrailDetail[] = []): string[] {
  return details
    .filter((detail) => detail.label.trim().length > 0)
    .map((detail) => `${detail.label}: ${detail.value}`)
}

export function buildWorkbenchResourceGuardrailDetails({
  resourceLabel,
  resourceName,
  region,
  regionLabel = "Region",
  extras = [],
}: WorkbenchResourceDetailConfig): WorkbenchGuardrailDetail[] {
  return [
    { label: resourceLabel, value: resourceName },
    ...(region ? [{ label: regionLabel, value: region }] : []),
    ...extras,
  ]
}

function resolveWorkbenchGuardrailResourceTemplate(resourceKind?: WorkbenchGuardrailResourceKind): WorkbenchGuardrailResourceTemplate | null {
  switch (resourceKind) {
    case "compute-instance":
      return {
        resourceTitle: "Compute Instance",
        confirmTarget: "Instance",
        subject: "instance",
        effects: {
          start: "can resume workloads and start billing again.",
          stop: "interrupts any workloads currently running on it.",
          delete: "can remove access to the running workload.",
          create: "creates a new instance-level action.",
          save: "stores the current instance-level configuration for reuse.",
        },
      }
    case "autonomous-database":
      return {
        resourceTitle: "Autonomous Database",
        confirmTarget: "Database",
        subject: "database",
        effects: {
          start: "resumes access and billing.",
          stop: "interrupts client access until it is started again.",
          delete: "removes access for existing connections.",
          create: "creates a new database-level action.",
          save: "stores the current database-level configuration for reuse.",
        },
      }
    case "db-system":
      return {
        resourceTitle: "DB System",
        confirmTarget: "DB System",
        subject: "DB System",
        effects: {
          start: "resumes database node workloads and billing.",
          stop: "interrupts database node availability.",
          delete: "can remove database node availability.",
          create: "creates a new DB System-level action.",
          save: "stores the current DB System-level configuration for reuse.",
        },
      }
    case "bastion-session":
      return {
        resourceTitle: "Bastion Session",
        confirmTarget: "Session",
        subject: "Bastion session",
        effects: {
          delete: "removes the temporary access path provided by this session.",
          create: "creates a new Bastion-backed access path into the selected target.",
        },
      }
    case "security-list":
      return {
        resourceTitle: "Security List",
        subject: "security list",
        effects: {
          start: "applies a new security list state.",
          stop: "stops an active security list state.",
          delete: "can immediately affect ingress and egress traffic for attached subnets.",
          create: "creates a new security boundary definition.",
          save: "stores the current security boundary definition for reuse.",
        },
      }
    case "pre-authenticated-link":
      return {
        resourceTitle: "Pre-Authenticated Link",
        confirmTarget: "Link",
        subject: "pre-authenticated link",
        effects: {
          start: "starts a new link workflow.",
          stop: "stops link access for the selected object.",
          delete: "removes access provided by the current link.",
          create: "allows anyone with the URL to read the selected object until it expires.",
          save: "stores the current link access settings for reuse.",
        },
      }
    case "oci-profile":
      return {
        resourceTitle: "Profile",
        subject: "profile",
        effects: {
          start: "activates profile-specific settings.",
          stop: "stops using the current profile configuration.",
          delete: "removes saved credentials and profile-scoped settings.",
          create: "creates a new reusable OCI profile.",
          save: "stores the current credentials and region settings for reuse.",
        },
      }
    case "compartment":
      return {
        resourceTitle: "Compartment Mapping",
        confirmTarget: "Compartment",
        subject: "compartment mapping",
        effects: {
          start: "applies compartment-scoped settings to the current workflow.",
          stop: "removes the current compartment mapping from the active workflow.",
          delete: "removes the saved compartment reference from this profile.",
          create: "adds a new compartment reference to this profile.",
          save: "stores the current compartment reference for this profile.",
        },
      }
    case "sql-connection-profile":
      return {
        resourceTitle: "SQL Connection Profile",
        confirmTarget: "Profile",
        subject: "SQL connection profile",
        effects: {
          start: "activates the saved SQL connection profile for the selected target.",
          stop: "disconnects the workflow from the current SQL connection profile.",
          delete: "removes the saved credentials and connection defaults for this target.",
          create: "saves the current connection settings for reuse.",
          save: "overwrites the saved credentials and connection defaults for this target.",
          overwrite: "replaces the saved credentials and connection defaults for this target.",
        },
      }
    case "sql-favorite":
      return {
        resourceTitle: "SQL Favorite",
        confirmTarget: "Favorite",
        subject: "saved SQL favorite",
        effects: {
          start: "applies the saved SQL favorite to the current editor.",
          stop: "removes the favorite from the active SQL workflow.",
          delete: "removes the saved SQL statement from your favorites library.",
          create: "adds the current SQL statement to your favorites library.",
          save: "stores the current SQL statement in your favorites library.",
          overwrite: "replaces the saved SQL statement and notes for this favorite label.",
        },
      }
    case "sql-history":
      return {
        resourceTitle: "SQL History",
        subject: "SQL history entry",
        effects: {
          start: "re-applies the selected SQL history entry to the editor.",
          stop: "removes the current SQL history entry from the active workflow.",
          delete: "removes saved SQL history from the current workspace.",
          create: "captures the current SQL statement in workspace history.",
          save: "stores the current SQL history state for later recall.",
          clear: "removes all saved SQL history entries from the current workspace.",
        },
      }
    case "chat-history":
      return {
        resourceTitle: "Chat History",
        subject: "chat history",
        effects: {
          clear: "removes all saved messages from the current conversation thread.",
        },
      }
    default:
      return null
  }
}

function resolveWorkbenchGuardrailCopy(
  action: WorkbenchGuardrailActionKind,
  config: WorkbenchTemplatedGuardrailConfig,
) {
  const template = resolveWorkbenchGuardrailResourceTemplate(config.resourceKind)
  const resourceTitle = config.resourceTitle ?? template?.resourceTitle ?? "Resource"
  const confirmTarget = config.confirmTarget ?? template?.confirmTarget ?? resourceTitle
  const subject = config.subject ?? template?.subject ?? "resource"
  const effect = config.effect ?? template?.effects[action] ?? "changes the selected resource."

  return {
    resourceTitle,
    confirmTarget,
    subject,
    effect,
  }
}

export function createStartGuardrail(config: WorkbenchNamedGuardrailConfig): WorkbenchGuardrailConfig {
  return createWorkbenchGuardrail({
    tone: "warning",
    ...config,
    details: buildWorkbenchGuardrailDetails(config.details),
  })
}

export function createStopGuardrail(config: WorkbenchNamedGuardrailConfig): WorkbenchGuardrailConfig {
  return createWorkbenchGuardrail({
    tone: "danger",
    ...config,
    details: buildWorkbenchGuardrailDetails(config.details),
  })
}

export function createDeleteGuardrail(config: WorkbenchNamedGuardrailConfig): WorkbenchGuardrailConfig {
  return createWorkbenchGuardrail({
    tone: "danger",
    ...config,
    details: buildWorkbenchGuardrailDetails(config.details),
  })
}

export function createCreateLinkGuardrail(config: WorkbenchNamedGuardrailConfig): WorkbenchGuardrailConfig {
  return createWorkbenchGuardrail({
    tone: "danger",
    ...config,
    details: buildWorkbenchGuardrailDetails(config.details),
  })
}

export function createSaveGuardrail(config: WorkbenchNamedGuardrailConfig): WorkbenchGuardrailConfig {
  return createWorkbenchGuardrail({
    tone: "warning",
    ...config,
    details: buildWorkbenchGuardrailDetails(config.details),
  })
}

export function createClearGuardrail(config: WorkbenchNamedGuardrailConfig): WorkbenchGuardrailConfig {
  return createWorkbenchGuardrail({
    tone: "danger",
    ...config,
    details: buildWorkbenchGuardrailDetails(config.details),
  })
}

export function createOverwriteGuardrail(config: WorkbenchNamedGuardrailConfig): WorkbenchGuardrailConfig {
  return createWorkbenchGuardrail({
    tone: "warning",
    ...config,
    details: buildWorkbenchGuardrailDetails(config.details),
  })
}

export function createStartResourceGuardrail(config: WorkbenchTemplatedGuardrailConfig): WorkbenchGuardrailConfig {
  const copy = resolveWorkbenchGuardrailCopy("start", config)
  return createStartGuardrail({
    title: `Start ${copy.resourceTitle}`,
    description: `Starting this ${copy.subject} ${copy.effect}`,
    confirmLabel: `Start ${copy.confirmTarget}`,
    details: config.details,
    onConfirm: config.onConfirm,
  })
}

export function createStopResourceGuardrail(config: WorkbenchTemplatedGuardrailConfig): WorkbenchGuardrailConfig {
  const copy = resolveWorkbenchGuardrailCopy("stop", config)
  return createStopGuardrail({
    title: `Stop ${copy.resourceTitle}`,
    description: `Stopping this ${copy.subject} ${copy.effect}`,
    confirmLabel: `Stop ${copy.confirmTarget}`,
    details: config.details,
    onConfirm: config.onConfirm,
  })
}

export function createDeleteResourceGuardrail(config: WorkbenchTemplatedGuardrailConfig): WorkbenchGuardrailConfig {
  const copy = resolveWorkbenchGuardrailCopy("delete", config)
  return createDeleteGuardrail({
    title: `Delete ${copy.resourceTitle}`,
    description: `Deleting this ${copy.subject} ${copy.effect}`,
    confirmLabel: `Delete ${copy.confirmTarget}`,
    details: config.details,
    onConfirm: config.onConfirm,
  })
}

export function createCreateLinkResourceGuardrail(config: WorkbenchTemplatedGuardrailConfig): WorkbenchGuardrailConfig {
  const copy = resolveWorkbenchGuardrailCopy("create", config)
  return createCreateLinkGuardrail({
    title: `Create ${copy.resourceTitle}`,
    description: `Creating this ${copy.subject} ${copy.effect}`,
    confirmLabel: `Create ${copy.confirmTarget}`,
    details: config.details,
    onConfirm: config.onConfirm,
  })
}

export function createSaveResourceGuardrail(config: WorkbenchTemplatedGuardrailConfig): WorkbenchGuardrailConfig {
  const copy = resolveWorkbenchGuardrailCopy("save", config)
  return createSaveGuardrail({
    title: `Save ${copy.resourceTitle}`,
    description: `Saving this ${copy.subject} ${copy.effect}`,
    confirmLabel: `Save ${copy.confirmTarget}`,
    details: config.details,
    onConfirm: config.onConfirm,
  })
}

export function createClearResourceGuardrail(config: WorkbenchTemplatedGuardrailConfig): WorkbenchGuardrailConfig {
  const copy = resolveWorkbenchGuardrailCopy("clear", config)
  return createClearGuardrail({
    title: `Clear ${copy.resourceTitle}`,
    description: `Clearing this ${copy.subject} ${copy.effect}`,
    confirmLabel: `Clear ${copy.confirmTarget}`,
    details: config.details,
    onConfirm: config.onConfirm,
  })
}

export function createOverwriteResourceGuardrail(config: WorkbenchTemplatedGuardrailConfig): WorkbenchGuardrailConfig {
  const copy = resolveWorkbenchGuardrailCopy("overwrite", config)
  return createOverwriteGuardrail({
    title: `Overwrite ${copy.resourceTitle}`,
    description: `Overwriting this ${copy.subject} ${copy.effect}`,
    confirmLabel: `Overwrite ${copy.confirmTarget}`,
    details: config.details,
    onConfirm: config.onConfirm,
  })
}
