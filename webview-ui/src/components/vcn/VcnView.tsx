import { AlertCircle, Network } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { toneFromLifecycleState, useWorkbenchInsight } from "../../context/WorkbenchInsightContext"
import { ResourceServiceClient } from "../../services/grpc-client"
import type { VcnResource } from "../../services/types"
import CompartmentSelector from "../ui/CompartmentSelector"
import InlineNotice from "../ui/InlineNotice"
import { LifecycleBadge } from "../ui/StatusBadge"
import { WorkbenchEmptyState, WorkbenchHero, WorkbenchLoadingState, WorkbenchSection } from "../workbench/DatabaseWorkbenchChrome"
import { WorkbenchActionButton } from "../workbench/WorkbenchActionButtons"
import FeaturePageLayout, { FeatureSearchInput } from "../workbench/FeaturePageLayout"
import WorkbenchInventoryCard from "../workbench/WorkbenchInventoryCard"
import {
    WorkbenchInventoryFilterEmpty,
    WorkbenchInventoryGroupHeading,
    WorkbenchInventoryRegionHeading,
    WorkbenchInventorySummary,
} from "../workbench/WorkbenchInventoryScaffold"
import { WorkbenchRefreshButton } from "../workbench/WorkbenchToolbar"
import SplitWorkspaceLayout from "../workbench/SplitWorkspaceLayout"
import SecurityListView from "./SecurityListView"

export default function VcnView() {
    const { activeProfile, profilesConfig, tenancyOcid, vcnCompartmentIds, navigateToView } = useExtensionState()
    const { pendingSelection, setPendingSelection, setResource } = useWorkbenchInsight()
    const [vcns, setVcns] = useState<VcnResource[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [query, setQuery] = useState("")
    const [selectedVcn, setSelectedVcn] = useState<VcnResource | null>(null)
    const [requestedVcnId, setRequestedVcnId] = useState<string | null>(null)
    const [showSecurityListWorkspace, setShowSecurityListWorkspace] = useState(false)
    const [highlightedVcnId, setHighlightedVcnId] = useState<string | null>(null)
    const vcnItemRefs = useRef(new Map<string, HTMLButtonElement>())
    const highlightTimerRef = useRef<number | null>(null)
    const activeProfileConfig = useMemo(
        () => profilesConfig.find((p) => p.name === activeProfile),
        [activeProfile, profilesConfig],
    )

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        if (!q) return vcns
        return vcns.filter(i => i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q))
    }, [vcns, query])

    const grouped = useMemo(() => groupVcnByCompartmentAndRegion(filtered), [filtered])

    const compartmentNameById = useMemo(() => {
        const map = new Map<string, string>()
        const rootId = tenancyOcid?.trim()
        if (rootId) {
            map.set(rootId, "Root (Tenancy)")
        }
        for (const c of activeProfileConfig?.compartments ?? []) {
            if (c.id?.trim()) {
                map.set(c.id.trim(), c.name?.trim() || c.id.trim())
            }
        }
        return map
    }, [activeProfileConfig, tenancyOcid])
    const availableCompartmentIds = useMemo(() => new Set(compartmentNameById.keys()), [compartmentNameById])
    const selectedCompartmentIds = useMemo(() => {
        if (availableCompartmentIds.size === 0) {
            return []
        }
        const selected = vcnCompartmentIds
            .map((id) => id.trim())
            .filter((id) => id.length > 0 && availableCompartmentIds.has(id))
        return [...new Set(selected)]
    }, [availableCompartmentIds, vcnCompartmentIds])

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        if (selectedCompartmentIds.length === 0) {
            setVcns([])
            setSelectedVcn(null)
            setLoading(false)
            return
        }
        try {
            const res = await ResourceServiceClient.listVcns()
            const selectedIds = new Set(selectedCompartmentIds)
            const items = (res.vcns ?? []).filter((vcn) => selectedIds.has((vcn.compartmentId || "").trim()))
            setVcns(items)
            setSelectedVcn((current) => {
                if (current && items.some((item) => item.id === current.id)) {
                    return items.find((item) => item.id === current.id) ?? current
                }
                return items[0] ?? null
            })
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }, [selectedCompartmentIds])

    useEffect(() => {
        load()
    }, [load])

    useEffect(() => {
        if (pendingSelection?.view !== "vcn") {
            return
        }
        setRequestedVcnId(pendingSelection.targetId)
        setPendingSelection(null)
    }, [pendingSelection, setPendingSelection])

    useEffect(() => {
        if (!selectedVcn) {
            setShowSecurityListWorkspace(false)
        }
    }, [selectedVcn])

    useEffect(() => {
        if (!requestedVcnId) {
            return
        }
        const matchingVcn = vcns.find((item) => item.id === requestedVcnId)
        if (matchingVcn) {
            setQuery("")
            setSelectedVcn(matchingVcn)
            setShowSecurityListWorkspace(false)
            setHighlightedVcnId(matchingVcn.id)
            setRequestedVcnId(null)
            return
        }
        if (!loading) {
            setRequestedVcnId(null)
        }
    }, [loading, requestedVcnId, vcns])

    useEffect(() => {
        if (highlightTimerRef.current !== null) {
            window.clearTimeout(highlightTimerRef.current)
            highlightTimerRef.current = null
        }
        if (!highlightedVcnId) {
            return
        }
        highlightTimerRef.current = window.setTimeout(() => {
            highlightTimerRef.current = null
            setHighlightedVcnId(null)
        }, 2200)
        return () => {
            if (highlightTimerRef.current !== null) {
                window.clearTimeout(highlightTimerRef.current)
                highlightTimerRef.current = null
            }
        }
    }, [highlightedVcnId])

    useEffect(() => {
        if (!highlightedVcnId || !filtered.some((item) => item.id === highlightedVcnId)) {
            return
        }
        const frameId = window.requestAnimationFrame(() => {
            vcnItemRefs.current.get(highlightedVcnId)?.scrollIntoView({
                block: "nearest",
                behavior: "smooth",
            })
        })
        return () => window.cancelAnimationFrame(frameId)
    }, [filtered, highlightedVcnId])

    const revealSelectedVcn = useCallback(() => {
        if (!selectedVcn) {
            return
        }
        if (query) {
            setQuery("")
        }
        setHighlightedVcnId(selectedVcn.id)
    }, [query, selectedVcn])

    useEffect(() => {
        if (!selectedVcn) {
            setResource(null)
            return
        }

        const compartmentLabel = compartmentNameById.get(selectedVcn.compartmentId) ?? selectedVcn.compartmentId
        setResource({
            view: "vcn",
            title: selectedVcn.name,
            eyebrow: "Selected VCN",
            resourceId: selectedVcn.id,
            badge: {
                label: selectedVcn.lifecycleState,
                tone: toneFromLifecycleState(selectedVcn.lifecycleState),
            },
            metrics: [
                { label: "Region", value: selectedVcn.region || "default" },
                { label: "CIDRs", value: String(selectedVcn.cidrBlocks.length) },
                { label: "Compartment", value: compartmentLabel },
            ],
            notes: selectedVcn.cidrBlocks.length > 0
                ? [`CIDR blocks: ${selectedVcn.cidrBlocks.join(", ")}`]
                : ["No CIDR blocks reported for the selected VCN."],
            actions: [
                ...(query
                    ? [{
                        label: "Clear Filter",
                        run: () => setQuery(""),
                        variant: "ghost" as const,
                    }]
                    : []),
                {
                    label: "Open Compute",
                    run: () => navigateToView("compute"),
                    variant: "secondary",
                },
                {
                    label: "Open Security Lists",
                    run: () => setShowSecurityListWorkspace(true),
                    variant: "secondary",
                },
                {
                    label: "Show in List",
                    run: revealSelectedVcn,
                    variant: "ghost",
                },
            ],
        })

        return () => setResource(null)
    }, [compartmentNameById, navigateToView, query, revealSelectedVcn, selectedVcn, setResource])

    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            const msg = event.data
            if (
                msg?.type === "grpc_response" &&
                msg?.grpc_response?.request_id === "__refresh__" &&
                msg?.grpc_response?.message?.refresh
            ) {
                void load()
            }
        }

        window.addEventListener("message", onMessage)
        return () => window.removeEventListener("message", onMessage)
    }, [load])

    return (
        <FeaturePageLayout
            title="Virtual Cloud Networks"
            description="Inspect network boundaries by compartment and jump into security list management."
            icon={<Network size={16} />}
            actions={(
                <WorkbenchRefreshButton
                    onClick={load}
                    disabled={loading}
                    spinning={loading}
                    title="Refresh"
                />
            )}
            controls={(
                <div className="flex flex-col gap-2">
                    <CompartmentSelector featureKey="vcn" multiple />
                    {vcns.length > 0 && (
                        <FeatureSearchInput
                            value={query}
                            onChange={setQuery}
                            placeholder="Filter VCNs..."
                        />
                    )}
                </div>
            )}
        >
            <div className="flex h-full min-h-0 flex-col px-3 py-3">
                {error && (
                    <InlineNotice tone="danger" size="md" icon={<AlertCircle size={13} />} className="mb-4">
                        {error}
                    </InlineNotice>
                )}

                {loading && vcns.length === 0 ? (
                    <WorkbenchLoadingState
                        label="Loading VCNs..."
                        className="min-h-[140px] py-6"
                    />
                ) : vcns.length === 0 ? (
                    <div className="flex flex-1">
                        <EmptyState hasSelectedCompartments={selectedCompartmentIds.length > 0} />
                    </div>
                ) : (
                    <div className="min-h-0 flex-1">
                        <SplitWorkspaceLayout
                            sidebar={(
                                <div className="flex flex-col gap-2.5">
                                    <WorkbenchInventorySummary
                                        label="VCN inventory"
                                        count={filtered.length === vcns.length
                                            ? `${vcns.length} VCN${vcns.length !== 1 ? "s" : ""}`
                                            : `${filtered.length} of ${vcns.length} VCNs`}
                                        description="Select a VCN to review CIDRs and manage attached security lists."
                                    />

                                    {filtered.length === 0 ? (
                                        <WorkbenchInventoryFilterEmpty message="No VCNs match your filter." />
                                    ) : (
                                        grouped.map((compartmentGroup) => (
                                            <div key={compartmentGroup.compartmentId} className="mb-1">
                                                <WorkbenchInventoryGroupHeading>
                                                    {compartmentNameById.get(compartmentGroup.compartmentId) ?? compartmentGroup.compartmentId}
                                                </WorkbenchInventoryGroupHeading>
                                                <div className="flex flex-col gap-2">
                                                    {compartmentGroup.regions.map((regionGroup) => (
                                                        <div key={`${compartmentGroup.compartmentId}-${regionGroup.region}`} className="flex flex-col gap-2">
                                                            <WorkbenchInventoryRegionHeading>
                                                                {regionGroup.region}
                                                            </WorkbenchInventoryRegionHeading>
                                                            {regionGroup.vcns.map((vcn) => (
                                                                <VcnListItem
                                                                    key={`${vcn.id}-${vcn.region ?? "default"}`}
                                                                    vcn={vcn}
                                                                    selected={selectedVcn?.id === vcn.id}
                                                                    highlighted={highlightedVcnId === vcn.id}
                                                                    onRegisterRef={(node) => {
                                                                        if (node) {
                                                                            vcnItemRefs.current.set(vcn.id, node)
                                                                        } else {
                                                                            vcnItemRefs.current.delete(vcn.id)
                                                                        }
                                                                    }}
                                                                    onSelect={() => setSelectedVcn(vcn)}
                                                                />
                                                            ))}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                            main={selectedVcn ? (
                                showSecurityListWorkspace ? (
                                    <div className="flex h-full min-h-0 flex-col">
                                        <SecurityListView
                                            vcn={selectedVcn}
                                            onBack={() => setShowSecurityListWorkspace(false)}
                                        />
                                    </div>
                                ) : (
                                    <div className="flex h-full min-h-0 flex-col gap-2.5">
                                        <WorkbenchHero
                                            eyebrow="Virtual Cloud Network"
                                            title={selectedVcn.name}
                                            resourceId={selectedVcn.id}
                                            badge={<LifecycleBadge state={selectedVcn.lifecycleState} />}
                                            metaItems={[
                                                { label: "Region", value: selectedVcn.region || "default" },
                                                { label: "CIDR Blocks", value: `${selectedVcn.cidrBlocks.length}` },
                                                { label: "Compartment", value: compartmentNameById.get(selectedVcn.compartmentId) ?? selectedVcn.compartmentId },
                                            ]}
                                        />
                                        <WorkbenchSection
                                            title="Security Lists"
                                            subtitle="Review attached security lists here, or open the dedicated workspace to modify them."
                                            actions={(
                                                <WorkbenchActionButton onClick={() => setShowSecurityListWorkspace(true)}>
                                                    Open Workspace
                                                </WorkbenchActionButton>
                                            )}
                                        >
                                            <div className="flex flex-wrap gap-2">
                                                {selectedVcn.cidrBlocks.map((cidr) => (
                                                    <span key={cidr} className="rounded-full border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-2.5 py-1 text-[11px] text-description">
                                                        {cidr}
                                                    </span>
                                                ))}
                                            </div>
                                            <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-[var(--vscode-panel-border)]">
                                                <SecurityListView
                                                    vcn={selectedVcn}
                                                    embedded
                                                />
                                            </div>
                                        </WorkbenchSection>
                                    </div>
                                )
                            ) : (
                                <EmptyState hasSelectedCompartments={selectedCompartmentIds.length > 0} />
                            )}
                        />
                    </div>
                )}
            </div>
        </FeaturePageLayout>
    )
}

function VcnListItem({
    vcn,
    selected,
    highlighted,
    onRegisterRef,
    onSelect,
}: {
    vcn: VcnResource
    selected: boolean
    highlighted: boolean
    onRegisterRef: (node: HTMLButtonElement | null) => void
    onSelect: () => void
}) {
    return (
        <WorkbenchInventoryCard
            buttonRef={onRegisterRef}
            title={vcn.name}
            subtitle={vcn.id}
            chips={vcn.cidrBlocks}
            selected={selected}
            highlighted={highlighted}
            onClick={onSelect}
            rightSlot={<LifecycleBadge state={vcn.lifecycleState} />}
        />
    )
}

function EmptyState({ hasSelectedCompartments }: { hasSelectedCompartments: boolean }) {
    return (
        <WorkbenchEmptyState
            title={hasSelectedCompartments ? "No Virtual Cloud Networks found" : "No compartment selected"}
            description={hasSelectedCompartments
                ? "No VCNs found in the selected compartments."
                : "Please select one or more compartments."}
            icon={<Network size={22} />}
        />
    )
}

function groupVcnByCompartmentAndRegion(vcns: VcnResource[]): { compartmentId: string; regions: { region: string; vcns: VcnResource[] }[] }[] {
    const compartmentMap = new Map<string, Map<string, VcnResource[]>>()
    for (const vcn of vcns) {
        const compartmentId = vcn.compartmentId || "unknown-compartment"
        const region = vcn.region || "default"
        if (!compartmentMap.has(compartmentId)) {
            compartmentMap.set(compartmentId, new Map<string, VcnResource[]>())
        }
        const regionMap = compartmentMap.get(compartmentId)!
        if (!regionMap.has(region)) {
            regionMap.set(region, [])
        }
        regionMap.get(region)!.push(vcn)
    }
    return [...compartmentMap.entries()].map(([compartmentId, regions]) => ({
        compartmentId,
        regions: [...regions.entries()].map(([region, groupedVcns]) => ({ region, vcns: groupedVcns })),
    }))
}
