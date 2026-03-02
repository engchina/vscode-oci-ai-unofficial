import { AlertCircle, Network } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { MutableRefObject } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { toneFromLifecycleState, useWorkbenchInsight } from "../../context/WorkbenchInsightContext"
import { ResourceServiceClient } from "../../services/grpc-client"
import type { VcnResource } from "../../services/types"
import CompartmentSelector from "../ui/CompartmentSelector"
import InlineNotice from "../ui/InlineNotice"
import { LifecycleBadge } from "../ui/StatusBadge"
import { WorkbenchEmptyState, WorkbenchLoadingState } from "../workbench/DatabaseWorkbenchChrome"
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
            description="Inspect VCNs, regions, and attached security lists by compartment, then jump into security list management."
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
                <div className="flex flex-col gap-1.5">
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
            <div className="flex h-full min-h-0 flex-col px-2 py-2">
                {error && (
                    <InlineNotice tone="danger" size="md" icon={<AlertCircle size={13} />} className="mb-2">
                        {error}
                    </InlineNotice>
                )}

                {loading && vcns.length === 0 ? (
                    <WorkbenchLoadingState
                        label="Loading VCNs..."
                        className="min-h-[140px] py-4"
                    />
                ) : vcns.length === 0 ? (
                    <div className="flex flex-1">
                        <EmptyState hasSelectedCompartments={selectedCompartmentIds.length > 0} />
                    </div>
                ) : (
                    <div className="min-h-0 flex-1">
                        {showSecurityListWorkspace && selectedVcn ? (
                            <section className="h-full min-h-0 overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-sideBar-background)_76%,white_24%)]">
                                <SecurityListView
                                    vcn={selectedVcn}
                                    onBack={() => setShowSecurityListWorkspace(false)}
                                />
                            </section>
                        ) : (
                            <section className="h-full min-h-0 overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-sideBar-background)_76%,white_24%)]">
                                <div className="h-full overflow-y-auto p-2">
                                    <VcnInventoryPanel
                                        vcns={vcns}
                                        filtered={filtered}
                                        grouped={grouped}
                                        selectedVcn={selectedVcn}
                                        highlightedVcnId={highlightedVcnId}
                                        compartmentNameById={compartmentNameById}
                                        vcnItemRefs={vcnItemRefs}
                                        onSelectVcn={setSelectedVcn}
                                        onOpenSecurityLists={(vcn) => {
                                            setSelectedVcn(vcn)
                                            setShowSecurityListWorkspace(true)
                                        }}
                                    />
                                </div>
                            </section>
                        )}
                    </div>
                )}
            </div>
        </FeaturePageLayout>
    )
}

function VcnInventoryPanel({
    vcns,
    filtered,
    grouped,
    selectedVcn,
    highlightedVcnId,
    compartmentNameById,
    vcnItemRefs,
    onSelectVcn,
    onOpenSecurityLists,
}: {
    vcns: VcnResource[]
    filtered: VcnResource[]
    grouped: { compartmentId: string; regions: { region: string; vcns: VcnResource[] }[] }[]
    selectedVcn: VcnResource | null
    highlightedVcnId: string | null
    compartmentNameById: Map<string, string>
    vcnItemRefs: MutableRefObject<Map<string, HTMLButtonElement>>
    onSelectVcn: (vcn: VcnResource) => void
    onOpenSecurityLists: (vcn: VcnResource) => void
}) {
    return (
        <div className="flex flex-col gap-2">
            <WorkbenchInventorySummary
                label="VCN inventory"
                count={filtered.length === vcns.length
                    ? `${vcns.length} VCN${vcns.length !== 1 ? "s" : ""}`
                    : `${filtered.length} of ${vcns.length} VCNs`}
                description="Open security lists directly from each VCN card."
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
                                            onSelect={() => onSelectVcn(vcn)}
                                            onOpenSecurityLists={() => onOpenSecurityLists(vcn)}
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                ))
            )}
        </div>
    )
}

function VcnListItem({
    vcn,
    selected,
    highlighted,
    onRegisterRef,
    onSelect,
    onOpenSecurityLists,
}: {
    vcn: VcnResource
    selected: boolean
    highlighted: boolean
    onRegisterRef: (node: HTMLButtonElement | null) => void
    onSelect: () => void
    onOpenSecurityLists: () => void
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
            footer={(
                <WorkbenchActionButton
                    type="button"
                    onClick={onOpenSecurityLists}
                >
                    Manage Security Lists
                </WorkbenchActionButton>
            )}
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
