import { clsx } from "clsx"
import { AlertCircle, Loader2, RefreshCw, Search, Network, Shield, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { ResourceServiceClient } from "../../services/grpc-client"
import type { VcnResource } from "../../services/types"
import Button from "../ui/Button"
import CompartmentSelector from "../ui/CompartmentSelector"
import SecurityListView from "./SecurityListView"

export default function VcnView() {
    const { activeProfile, profilesConfig, tenancyOcid, vcnCompartmentIds } = useExtensionState()
    const [vcns, setVcns] = useState<VcnResource[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [query, setQuery] = useState("")
    const [selectedVcn, setSelectedVcn] = useState<VcnResource | null>(null)
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

    if (selectedVcn) {
        return (
            <SecurityListView
                vcn={selectedVcn}
                onBack={() => setSelectedVcn(null)}
            />
        )
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-[var(--vscode-panel-border)] px-3 py-2 bg-[var(--vscode-editor-background)]">
                <div className="flex min-w-0 items-center gap-2">
                    <Network size={14} className="text-[var(--vscode-icon-foreground)]" />
                    <div className="flex min-w-0 flex-col">
                        <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--vscode-sideBarTitle-foreground)]">Virtual Cloud Networks</span>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <Button
                        variant="icon"
                        size="icon"
                        onClick={load}
                        disabled={loading}
                        title="Refresh"
                    >
                        <RefreshCw size={14} className={clsx(loading && "animate-spin")} />
                    </Button>
                </div>
            </div>

            {/* Controls */}
            <div className="border-b border-[var(--vscode-panel-border)] px-3 pt-3 pb-2 flex flex-col gap-2 bg-[var(--vscode-editor-background)]">
                <CompartmentSelector featureKey="vcn" multiple />
                {vcns.length > 0 && (
                    <div className="flex items-center gap-2 rounded-[2px] border border-input-border bg-input-background px-2 py-1 focus-within:outline focus-within:outline-1 focus-within:outline-[var(--vscode-focusBorder)] focus-within:-outline-offset-1">
                        <Search size={12} className="shrink-0 text-[var(--vscode-icon-foreground)]" />
                        <input
                            type="text"
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Filter VCNs..."
                            className="flex-1 bg-transparent text-[13px] text-input-foreground outline-none placeholder:text-input-placeholder"
                        />
                        {query && (
                            <button
                                type="button"
                                onClick={() => setQuery("")}
                                className="flex h-5 w-5 items-center justify-center rounded-[2px] text-description hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-[var(--vscode-foreground)]"
                                title="Clear filter"
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto px-3 py-3">
                {error && (
                    <div className="mb-4 flex items-start gap-2 rounded-lg border border-error/30 bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,red_8%)] px-3 py-2.5 text-xs text-error">
                        <AlertCircle size={13} className="mt-0.5 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {loading && vcns.length === 0 ? (
                    <div className="flex items-center justify-center gap-2 p-4 text-[12px] text-description">
                        <Loader2 size={14} className="animate-spin" />
                        <span>Loading VCNs...</span>
                    </div>
                ) : vcns.length === 0 ? (
                    <EmptyState hasSelectedCompartments={selectedCompartmentIds.length > 0} />
                ) : (
                    <div className="flex flex-col gap-3">
                        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-description">
                            {filtered.length === vcns.length
                                ? `${vcns.length} VCN${vcns.length !== 1 ? "s" : ""}`
                                : `${filtered.length} of ${vcns.length} VCNs`}
                        </h4>
                        {filtered.length === 0 ? (
                            <p className="py-8 text-center text-[12px] text-description">No VCNs match your filter.</p>
                        ) : (
                            grouped.map((compartmentGroup) => (
                                <div key={compartmentGroup.compartmentId} className="mb-4">
                                    <h5 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--vscode-sideBarTitle-foreground)]">
                                        {compartmentNameById.get(compartmentGroup.compartmentId) ?? compartmentGroup.compartmentId}
                                    </h5>
                                    <div className="flex flex-col gap-3">
                                        {compartmentGroup.regions.map((regionGroup) => (
                                            <div key={`${compartmentGroup.compartmentId}-${regionGroup.region}`} className="flex flex-col gap-2">
                                                <h6 className="text-[10px] font-semibold uppercase tracking-wider text-description border-b border-[var(--vscode-panel-border)] pb-1">
                                                    {regionGroup.region}
                                                </h6>
                                                {regionGroup.vcns.map((vcn) => (
                                                    <VcnCard
                                                        key={`${vcn.id}-${vcn.region ?? "default"}`}
                                                        vcn={vcn}
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
            </div>
        </div>
    )
}

function VcnCard({
    vcn,
    onSelect,
}: {
    vcn: VcnResource
    onSelect: () => void
}) {
    return (
        <div className="flex flex-col gap-3 rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] hover:bg-[var(--vscode-list-hoverBackground)] transition-colors p-2.5">
            <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-medium text-[var(--vscode-foreground)]">{vcn.name}</span>
                    <span className="truncate text-[11px] text-description">{vcn.id}</span>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        {vcn.cidrBlocks.map((cidr, i) => (
                            <span key={i} className="text-[11px] text-description">CIDR: {cidr}</span>
                        ))}
                    </div>
                </div>
                <LifecycleBadge state={vcn.lifecycleState} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <Button
                    size="sm"
                    variant="secondary"
                    onClick={onSelect}
                    className="flex items-center gap-1.5"
                    title="Open security lists for this VCN"
                >
                    <Shield size={12} />
                    Manage Security Lists
                </Button>
            </div>
        </div>
    )
}

function LifecycleBadge({ state }: { state: string }) {
    const colorMap: Record<string, string> = {
        AVAILABLE: "text-success bg-[color-mix(in_srgb,var(--vscode-editor-background)_80%,green_20%)] border-success/30",
        TERMINATED: "text-error bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,red_15%)] border-error/30",
    }
    const cls = colorMap[state] ?? "text-description border-border-panel"
    return (
        <span className={clsx("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider", cls)}>
            {state}
        </span>
    )
}

function EmptyState({ hasSelectedCompartments }: { hasSelectedCompartments: boolean }) {
    return (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border-panel bg-list-background-hover">
                <Network size={22} className="text-description" />
            </div>
            <div className="text-center">
                <p className="text-sm font-medium">
                    {hasSelectedCompartments ? "No Virtual Cloud Networks found" : "No compartment selected"}
                </p>
                <p className="mt-1 text-xs text-description">
                    {hasSelectedCompartments
                        ? "No VCNs found in the selected compartments."
                        : "Please select one or more compartments."}
                </p>
            </div>
        </div>
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
