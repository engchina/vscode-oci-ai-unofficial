import { clsx } from "clsx"
import { AlertCircle, Loader2, MonitorPlay, MonitorStop, RefreshCw, Server } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { ResourceServiceClient } from "../../services/grpc-client"
import type { ComputeResource } from "../../services/types"
import Button from "../ui/Button"

type ActionState = { id: string; action: "starting" | "stopping" } | null

export default function ComputeView() {
  const [instances, setInstances] = useState<ComputeResource[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionState, setActionState] = useState<ActionState>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await ResourceServiceClient.listCompute()
      setInstances(res.instances ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleStart = useCallback(
    async (id: string) => {
      setActionState({ id, action: "starting" })
      try {
        await ResourceServiceClient.startCompute(id)
        await load()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setActionState(null)
      }
    },
    [load],
  )

  const handleStop = useCallback(
    async (id: string) => {
      setActionState({ id, action: "stopping" })
      try {
        await ResourceServiceClient.stopCompute(id)
        await load()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setActionState(null)
      }
    },
    [load],
  )

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border-panel px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border-panel bg-list-background-hover">
            <Server size={14} />
          </div>
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold">Compute Instances</span>
            <span className="text-xs text-description">Manage OCI compute instances in your compartment.</span>
          </div>
        </div>
        <button
          onClick={load}
          disabled={loading}
          title="Refresh"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-description transition-colors hover:bg-list-background-hover hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw size={14} className={clsx(loading && "animate-spin")} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-4">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-error/30 bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,red_8%)] px-3 py-2.5 text-xs text-error">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && instances.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-description">
            <Loader2 size={24} className="animate-spin" />
            <span className="text-xs">Loading instances...</span>
          </div>
        ) : instances.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col gap-2">
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-description">
              {instances.length} Instance{instances.length !== 1 ? "s" : ""}
            </h4>
            {instances.map((instance) => (
              <InstanceCard
                key={instance.id}
                instance={instance}
                actionState={actionState}
                onStart={handleStart}
                onStop={handleStop}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function InstanceCard({
  instance,
  actionState,
  onStart,
  onStop,
}: {
  instance: ComputeResource
  actionState: ActionState
  onStart: (id: string) => void
  onStop: (id: string) => void
}) {
  const isActing = actionState?.id === instance.id
  const isRunning = instance.lifecycleState === "RUNNING"
  const isStopped = instance.lifecycleState === "STOPPED"

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border-panel bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,black_8%)] p-3 sm:p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{instance.name}</span>
          <span className="truncate text-xs text-description">{instance.id}</span>
        </div>
        <LifecycleBadge state={instance.lifecycleState} />
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={isActing || !isStopped}
          onClick={() => onStart(instance.id)}
          className="flex items-center gap-1.5"
        >
          {isActing && actionState?.action === "starting" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <MonitorPlay size={12} />
          )}
          Start
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={isActing || !isRunning}
          onClick={() => onStop(instance.id)}
          className="flex items-center gap-1.5"
        >
          {isActing && actionState?.action === "stopping" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <MonitorStop size={12} />
          )}
          Stop
        </Button>
      </div>
    </div>
  )
}

function LifecycleBadge({ state }: { state: string }) {
  const colorMap: Record<string, string> = {
    RUNNING: "text-success bg-[color-mix(in_srgb,var(--vscode-editor-background)_80%,green_20%)] border-success/30",
    STOPPED: "text-description bg-[color-mix(in_srgb,var(--vscode-editor-background)_90%,black_10%)] border-border-panel",
    STOPPING: "text-warning bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,yellow_15%)] border-warning/30",
    STARTING: "text-warning bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,yellow_15%)] border-warning/30",
    TERMINATED: "text-error bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,red_15%)] border-error/30",
  }
  const cls = colorMap[state] ?? "text-description border-border-panel"
  return (
    <span className={clsx("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider", cls)}>
      {state}
    </span>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border-panel bg-list-background-hover">
        <Server size={22} className="text-description" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium">No compute instances found</p>
        <p className="mt-1 text-xs text-description">Check your compartment ID in OCI Settings.</p>
      </div>
    </div>
  )
}
