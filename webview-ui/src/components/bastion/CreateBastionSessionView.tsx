import { AlertCircle, CircleSlash, Shield } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { toneFromLifecycleState, useWorkbenchInsight } from "../../context/WorkbenchInsightContext"
import { ResourceServiceClient } from "../../services/grpc-client"
import type { BastionResource } from "../../services/types"
import CompartmentSelector from "../ui/CompartmentSelector"
import InlineNotice from "../ui/InlineNotice"
import StatusBadge, { LifecycleBadge } from "../ui/StatusBadge"
import { WorkbenchEmptyState, WorkbenchLoadingState } from "../workbench/DatabaseWorkbenchChrome"
import FeaturePageLayout from "../workbench/FeaturePageLayout"
import {
  WorkbenchBackButton,
  WorkbenchCompactActionCluster,
  WorkbenchDismissButton,
  WorkbenchRevealButton,
} from "../workbench/WorkbenchActionButtons"
import { backToLabel, showInListLabel } from "../workbench/navigationLabels"
import { WorkbenchRefreshButton } from "../workbench/WorkbenchToolbar"
import CreateBastionSessionDialog from "./CreateBastionSessionDialog"

export default function CreateBastionSessionView() {
  const { bastionCompartmentIds, navigateToView } = useExtensionState()
  const { pendingSelection, setPendingSelection, setResource } = useWorkbenchInsight()
  const [bastions, setBastions] = useState<BastionResource[]>([])
  const [selectedBastionId, setSelectedBastionId] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const selectedCompartmentIds = useMemo(
    () => bastionCompartmentIds.map((value) => value.trim()).filter((value) => value.length > 0),
    [bastionCompartmentIds],
  )

  const selectedBastion = useMemo(
    () => bastions.find((bastion) => bastion.id === selectedBastionId) ?? null,
    [bastions, selectedBastionId],
  )

  const returnToBastions = useCallback((targetId?: string) => {
    if (targetId?.trim()) {
      setPendingSelection({
        view: "bastion",
        targetId: targetId.trim(),
      })
    }
    navigateToView("bastion")
  }, [navigateToView, setPendingSelection])

  const loadBastions = useCallback(async () => {
    setLoading(true)
    setError(null)
    if (selectedCompartmentIds.length === 0) {
      setBastions([])
      setLoading(false)
      return
    }
    try {
      const response = await ResourceServiceClient.listBastions()
      setBastions(response.bastions ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [selectedCompartmentIds])

  useEffect(() => {
    void loadBastions()
  }, [loadBastions])

  useEffect(() => {
    if (pendingSelection?.view !== "bastionSession") {
      return
    }
    setSelectedBastionId(pendingSelection.targetId)
    setPendingSelection(null)
  }, [pendingSelection, setPendingSelection])

  useEffect(() => {
    if (!selectedBastionId) {
      return
    }
    if (bastions.some((bastion) => bastion.id === selectedBastionId)) {
      return
    }
    if (!loading) {
      setSelectedBastionId("")
    }
  }, [bastions, loading, selectedBastionId])

  useEffect(() => {
    if (selectedBastion) {
      setResource({
        view: "bastionSession",
        title: selectedBastion.name,
        eyebrow: "Create Bastion Session",
        resourceId: selectedBastion.id,
        badge: {
          label: selectedBastion.lifecycleState,
          tone: toneFromLifecycleState(selectedBastion.lifecycleState),
        },
        metrics: [
          { label: "Region", value: selectedBastion.region || "default" },
          { label: "Target VCN", value: selectedBastion.targetVcnId || "-" },
          { label: "Target Subnet", value: selectedBastion.targetSubnetId || "-" },
          { label: "DNS Proxy", value: selectedBastion.dnsProxyStatus || "Unknown" },
        ],
        notes: [
          `Client allowlist: ${selectedBastion.clientCidrBlockAllowList?.length ?? 0} CIDR entries`,
          "Return to Bastions to switch the target Bastion or inspect created sessions.",
        ],
        actions: [
          {
            label: showInListLabel("Bastion"),
            run: () => returnToBastions(selectedBastion.id),
            variant: "secondary",
          },
          {
            label: backToLabel("Bastions"),
            run: () => returnToBastions(selectedBastion.id),
            variant: "ghost",
          },
        ],
      })
      return () => setResource(null)
    }

    setResource({
      view: "bastionSession",
      title: "Create Bastion Session",
      eyebrow: "Bastion Workflow",
      metrics: [
        { label: "Compartments", value: String(selectedCompartmentIds.length) },
        { label: "Loaded Bastions", value: String(bastions.length) },
      ],
      notes: [
        selectedCompartmentIds.length === 0
          ? "Select one or more Bastion compartments before creating a session."
          : "Open this page from the Bastion inventory to preselect the target Bastion.",
      ],
      actions: [
        {
          label: backToLabel("Bastions"),
          run: () => returnToBastions(),
          variant: "ghost",
        },
      ],
    })

    return () => setResource(null)
  }, [bastions.length, returnToBastions, selectedBastion, selectedCompartmentIds.length, setResource])

  return (
    <FeaturePageLayout
      title="Create Bastion Session"
      description="Create managed SSH or port-forwarding access from a dedicated Bastion workflow page."
      icon={<Shield size={16} />}
      leading={<WorkbenchBackButton type="button" label={backToLabel("Bastions")} onClick={() => returnToBastions(selectedBastion?.id)} />}
      status={selectedBastion
        ? <LifecycleBadge state={selectedBastion.lifecycleState} size="compact" />
        : <StatusBadge label="Awaiting Bastion" tone="neutral" size="compact" />}
      actions={(
        <WorkbenchCompactActionCluster>
          {selectedBastion && (
            <WorkbenchRevealButton
              type="button"
              label={showInListLabel("Bastion")}
              onClick={() => returnToBastions(selectedBastion.id)}
            />
          )}
          <WorkbenchRefreshButton onClick={loadBastions} disabled={loading} spinning={loading} />
        </WorkbenchCompactActionCluster>
      )}
      controls={<CompartmentSelector featureKey="bastion" multiple />}
      contentClassName="p-2"
    >
      <section className="h-full min-h-0 overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)]">
        <div className="h-full overflow-y-auto p-2">
          <div className="flex min-h-full flex-col gap-2">
            {error && (
              <InlineNotice
                tone="danger"
                size="md"
                icon={<AlertCircle size={14} />}
                actions={<WorkbenchDismissButton onClick={() => setError(null)} title="Dismiss" />}
              >
                {error}
              </InlineNotice>
            )}

            {loading ? (
              <WorkbenchLoadingState label="Loading Bastions..." className="min-h-[180px]" />
            ) : selectedCompartmentIds.length === 0 ? (
              <WorkbenchEmptyState
                icon={<CircleSlash size={18} />}
                title="No Bastion Compartments Selected"
                description="Choose one or more compartments above before opening the Bastion session workspace."
              />
            ) : !selectedBastion ? (
              <WorkbenchEmptyState
                icon={<Shield size={18} />}
                title="No Bastion Selected"
                description="Open this page from the Bastion inventory so the target Bastion is preselected for session creation."
              />
            ) : (
              <>
                <InlineNotice tone="info" size="md" icon={<Shield size={14} />}>
                  Creating a session here will return you to the Bastion inventory so you can monitor lifecycle changes and SSH command readiness.
                </InlineNotice>

                <CreateBastionSessionDialog
                  open
                  presentation="embedded"
                  bastion={selectedBastion}
                  onClose={() => returnToBastions(selectedBastion.id)}
                  onSuccess={(summary) => {
                    returnToBastions(summary.bastionId)
                  }}
                />
              </>
            )}
          </div>
        </div>
      </section>
    </FeaturePageLayout>
  )
}
