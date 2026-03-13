import { createContext, useContext, useMemo, useState, type ReactNode } from "react"
import type { ViewType } from "./ExtensionStateContext"

export type WorkbenchInsightTone = "neutral" | "success" | "warning" | "danger"

export interface WorkbenchInsightMetric {
  label: string
  value: string
}

export interface WorkbenchInsightBadge {
  label: string
  tone?: WorkbenchInsightTone
}

export interface WorkbenchInsightAction {
  label: string
  run: () => void
  variant?: "primary" | "secondary" | "ghost"
}

export type PendingWorkbenchSelection =
  | {
    view: "vcn"
    targetId: string
  }
  | {
    view: "bastion"
    targetId: string
  }
  | {
    view: "bastionSession"
    targetId: string
  }
  | {
    view: "adb"
    targetId: string
  }
  | {
    view: "dbSystems"
    targetId: string
  }
  | {
    view: "sqlWorkbench"
    targetId: string
    targetType: "adb" | "dbSystem"
  }

export interface WorkbenchInsightResource {
  view: ViewType
  title: string
  eyebrow: string
  resourceId?: string
  badge?: WorkbenchInsightBadge
  metrics: WorkbenchInsightMetric[]
  notes?: string[]
  actions?: WorkbenchInsightAction[]
}

interface WorkbenchInsightContextType {
  resource: WorkbenchInsightResource | null
  setResource: (resource: WorkbenchInsightResource | null) => void
  pendingSelection: PendingWorkbenchSelection | null
  setPendingSelection: (selection: PendingWorkbenchSelection | null) => void
}

const WorkbenchInsightContext = createContext<WorkbenchInsightContextType | undefined>(undefined)

export function WorkbenchInsightProvider({ children }: { children: ReactNode }) {
  const [resource, setResource] = useState<WorkbenchInsightResource | null>(null)
  const [pendingSelection, setPendingSelection] = useState<PendingWorkbenchSelection | null>(null)

  const value = useMemo(
    () => ({
      resource,
      setResource,
      pendingSelection,
      setPendingSelection,
    }),
    [pendingSelection, resource],
  )

  return (
    <WorkbenchInsightContext.Provider value={value}>
      {children}
    </WorkbenchInsightContext.Provider>
  )
}

export function useWorkbenchInsight() {
  const context = useContext(WorkbenchInsightContext)
  if (!context) {
    throw new Error("useWorkbenchInsight must be used within WorkbenchInsightProvider")
  }
  return context
}

function normalizeLifecycleState(state: string | undefined) {
  return (state || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
}

export function toneFromLifecycleState(state: string | undefined): WorkbenchInsightTone {
  const normalized = normalizeLifecycleState(state)
  if (["AVAILABLE", "RUNNING", "ACTIVE", "SUCCEEDED"].includes(normalized)) {
    return "success"
  }
  if ([
    "STOPPED",
    "STOPPING",
    "STARTING",
    "UPDATING",
    "PROVISIONING",
    "MAINTENANCE_IN_PROGRESS",
    "ACCEPTED",
    "IN_PROGRESS",
    "CANCELING",
    "CANCELED",
    "CANCELLED",
    "PARTIALLY_SUCCEEDED",
  ].includes(normalized)) {
    return "warning"
  }
  if (["TERMINATED", "TERMINATING", "FAILED"].includes(normalized)) {
    return "danger"
  }
  return "neutral"
}
