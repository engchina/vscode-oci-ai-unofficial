import { clsx } from "clsx"
import { AlertCircle, CheckCircle2, ChevronLeft, Edit, Loader2, Plus, Search, Shield, Trash2, X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ResourceServiceClient } from "../../services/grpc-client"
import type { SecurityListResource, SecurityRule, VcnResource } from "../../services/types"
import GuardrailDialog from "../common/GuardrailDialog"
import Button from "../ui/Button"
import InlineNotice from "../ui/InlineNotice"
import {
    WorkbenchActionButton,
    WorkbenchDismissButton,
    WorkbenchEditIconButton,
    WorkbenchIconDestructiveButton,
    WorkbenchInlineActionCluster,
    WorkbenchRevealButton,
} from "../workbench/WorkbenchActionButtons"
import { WorkbenchEmptyState, WorkbenchLoadingState } from "../workbench/DatabaseWorkbenchChrome"
import {
    buildWorkbenchResourceGuardrailDetails,
    createDeleteResourceGuardrail,
    type WorkbenchGuardrailState,
} from "../workbench/guardrail"
import { WorkbenchRefreshButton, WorkbenchToolbarGroup } from "../workbench/WorkbenchToolbar"

type RecentActionState = {
    kind: "created" | "updated" | "deleted"
    securityListId?: string
    securityListName: string
    timestamp: number
} | null

export default function SecurityListView({
    vcn,
    onBack,
    embedded = false,
}: {
    vcn: VcnResource
    onBack?: () => void
    embedded?: boolean
}) {
    const [securityLists, setSecurityLists] = useState<SecurityListResource[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [query, setQuery] = useState("")

    const [editingList, setEditingList] = useState<SecurityListResource | null>(null)
    const [isCreating, setIsCreating] = useState(false)
    const [deletingId, setDeletingId] = useState<string | null>(null)
    const [guardrail, setGuardrail] = useState<WorkbenchGuardrailState>(null)
    const [recentAction, setRecentAction] = useState<RecentActionState>(null)
    const [highlightedSecurityListId, setHighlightedSecurityListId] = useState<string | null>(null)
    const actionTimerRef = useRef<number | null>(null)
    const highlightTimerRef = useRef<number | null>(null)
    const securityListItemRefs = useRef(new Map<string, HTMLDivElement>())

    const filteredSecurityLists = useMemo(() => {
        const normalizedQuery = query.trim().toLowerCase()
        if (!normalizedQuery) {
            return securityLists
        }
        return securityLists.filter((securityList) => {
            const haystack = [
                securityList.name,
                securityList.id,
                ...securityList.ingressSecurityRules.map(buildSecurityRuleSearchText),
                ...securityList.egressSecurityRules.map(buildSecurityRuleSearchText),
            ]
                .join(" ")
                .toLowerCase()
            return haystack.includes(normalizedQuery)
        })
    }, [query, securityLists])

    const highlightedListHiddenByFilter = Boolean(
        highlightedSecurityListId &&
        query.trim() &&
        !filteredSecurityLists.some((securityList) => securityList.id === highlightedSecurityListId),
    )

    const load = useCallback(async (): Promise<SecurityListResource[]> => {
        setLoading(true)
        setError(null)
        try {
            const res = await ResourceServiceClient.listSecurityLists({ vcnId: vcn.id, region: vcn.region })
            const items = res.securityLists ?? []
            setSecurityLists(items)
            return items
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
            return []
        } finally {
            setLoading(false)
        }
    }, [vcn.id, vcn.region])

    useEffect(() => {
        load()
    }, [load])

    useEffect(() => {
        if (actionTimerRef.current !== null) {
            window.clearTimeout(actionTimerRef.current)
            actionTimerRef.current = null
        }
        if (!recentAction) {
            return
        }
        actionTimerRef.current = window.setTimeout(() => {
            actionTimerRef.current = null
            setRecentAction(null)
        }, 3200)
        return () => {
            if (actionTimerRef.current !== null) {
                window.clearTimeout(actionTimerRef.current)
                actionTimerRef.current = null
            }
        }
    }, [recentAction])

    useEffect(() => {
        if (highlightTimerRef.current !== null) {
            window.clearTimeout(highlightTimerRef.current)
            highlightTimerRef.current = null
        }
        if (!highlightedSecurityListId) {
            return
        }
        highlightTimerRef.current = window.setTimeout(() => {
            highlightTimerRef.current = null
            setHighlightedSecurityListId(null)
        }, 2200)
        return () => {
            if (highlightTimerRef.current !== null) {
                window.clearTimeout(highlightTimerRef.current)
                highlightTimerRef.current = null
            }
        }
    }, [highlightedSecurityListId])

    useEffect(() => {
        if (!highlightedSecurityListId) {
            return
        }
        const frameId = window.requestAnimationFrame(() => {
            securityListItemRefs.current.get(highlightedSecurityListId)?.scrollIntoView({
                block: "nearest",
                behavior: "smooth",
            })
        })
        return () => window.cancelAnimationFrame(frameId)
    }, [filteredSecurityLists, highlightedSecurityListId])

    const revealSecurityList = useCallback((securityListId: string) => {
        setQuery("")
        setHighlightedSecurityListId(null)
        window.requestAnimationFrame(() => {
            setHighlightedSecurityListId(securityListId)
        })
    }, [])

    const handleDelete = async (id: string) => {
        const securityList = securityLists.find((item) => item.id === id)
        if (!securityList) return
        setGuardrail(createDeleteResourceGuardrail({
            resourceKind: "security-list",
            details: buildWorkbenchResourceGuardrailDetails({
                resourceLabel: "VCN",
                resourceName: vcn.name,
                region: vcn.region,
                extras: [
                { label: "Security List", value: securityList.name },
                ],
            }),
            onConfirm: async () => {
                setDeletingId(id)
                try {
                    await ResourceServiceClient.deleteSecurityList({ securityListId: id, region: vcn.region })
                    await load()
                    setRecentAction({
                        kind: "deleted",
                        securityListName: securityList.name,
                        timestamp: Date.now(),
                    })
                    setHighlightedSecurityListId(null)
                    setGuardrail(null)
                } finally {
                    setDeletingId(null)
                }
            },
        }))
    }

    if (editingList || isCreating) {
        return (
            <SecurityListForm
                vcnId={vcn.id}
                compartmentId={vcn.compartmentId}
                region={vcn.region}
                initialData={editingList}
                onSave={async (result) => {
                    setEditingList(null)
                    setIsCreating(false)
                    const items = await load()
                    const matchingSecurityList = result.securityListId
                        ? items.find((item) => item.id === result.securityListId)
                        : items.find((item) => item.name === result.securityListName)
                    const nextSecurityListId = result.securityListId || matchingSecurityList?.id
                    if (nextSecurityListId) {
                        setHighlightedSecurityListId(nextSecurityListId)
                    }
                    setRecentAction({
                        kind: result.kind,
                        securityListId: nextSecurityListId,
                        securityListName: result.securityListName,
                        timestamp: Date.now(),
                    })
                }}
                onCancel={() => {
                    setEditingList(null)
                    setIsCreating(false)
                }}
            />
        )
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between gap-2.5 border-b border-[var(--vscode-panel-border)] px-3 py-2 bg-[var(--vscode-editor-background)]">
                <div className="flex min-w-0 items-center gap-2">
                    {onBack && !embedded && (
                        <button
                            onClick={onBack}
                            className="flex h-6 w-6 items-center justify-center rounded-[2px] hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-[var(--vscode-toolbar-hoverOutline)]"
                            title="Back to VCNs"
                        >
                            <ChevronLeft size={14} />
                        </button>
                    )}
                    <div className="flex min-w-0 flex-col">
                        <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--vscode-sideBarTitle-foreground)] truncate">
                            {embedded ? "Security Lists" : `Security Lists: ${vcn.name}`}
                        </span>
                        {embedded && <span className="truncate text-[10px] text-description">{vcn.name}</span>}
                    </div>
                </div>
                <WorkbenchToolbarGroup className="items-center gap-1">
                    <Button variant="secondary" size="sm" onClick={() => setIsCreating(true)} className="flex items-center gap-1.5 h-6">
                        <Plus size={14} /> Create
                    </Button>
                    <WorkbenchRefreshButton
                        onClick={load}
                        disabled={loading}
                        spinning={loading}
                        title="Refresh"
                    />
                </WorkbenchToolbarGroup>
            </div>

            {securityLists.length > 0 && (
                <div className="border-b border-[var(--vscode-panel-border)] px-3 py-2.5 bg-[var(--vscode-editor-background)]">
                    <div className="flex items-center gap-2 rounded-[2px] border border-input-border bg-input-background px-2 py-1">
                        <Search size={12} className="shrink-0 text-[var(--vscode-icon-foreground)]" />
                        <input
                            type="text"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Filter security lists and rules..."
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
                </div>
            )}

            <div className="flex-1 overflow-y-auto px-2.5 py-2.5">
                {error && (
                    <InlineNotice tone="danger" icon={<AlertCircle size={13} />} className="mb-3">
                        {error}
                    </InlineNotice>
                )}

                {recentAction && (
                    <InlineNotice
                        tone="info"
                        icon={<CheckCircle2 size={14} className="text-[var(--vscode-testing-iconPassed)]" />}
                        className="mb-3"
                        actions={(
                            <>
                                {recentAction.securityListId && recentAction.kind !== "deleted" && (
                                    <WorkbenchRevealButton
                                        onClick={() => revealSecurityList(recentAction.securityListId ?? "")}
                                        title="Show this security list in the list"
                                        label="Show Security List"
                                    />
                                )}
                                <WorkbenchDismissButton onClick={() => setRecentAction(null)} title="Dismiss" />
                            </>
                        )}
                    >
                        <div className="min-w-0">
                                {formatSecurityListActionMessage(recentAction.kind)}
                                {" "}
                                <span className="text-[var(--vscode-foreground)]">{recentAction.securityListName}</span>
                                {" "}
                                {formatRecentActionAge(recentAction.timestamp)}
                        </div>
                    </InlineNotice>
                )}

                {highlightedListHiddenByFilter && recentAction?.securityListName && (
                    <InlineNotice
                        tone="info"
                        className="mb-3"
                        actions={(
                            <Button variant="secondary" size="sm" onClick={() => setQuery("")}>
                                Clear Filter
                            </Button>
                        )}
                    >
                        <div className="min-w-0">
                            <span className="text-[var(--vscode-foreground)]">{recentAction.securityListName}</span> is hidden by the current filter.
                        </div>
                    </InlineNotice>
                )}

                {loading ? (
                    <WorkbenchLoadingState label="Loading security lists..." />
                ) : securityLists.length === 0 ? (
                    <WorkbenchEmptyState
                        title="No security lists found"
                        description="No security lists are attached to this VCN yet."
                    />
                ) : filteredSecurityLists.length === 0 ? (
                    <WorkbenchEmptyState
                        title="No matches"
                        description="No security lists match the current filter."
                    />
                ) : (
                    <div className="flex flex-col gap-2.5">
                        {filteredSecurityLists.map(sl => (
                            <div
                                key={sl.id}
                                ref={(node) => {
                                    if (node) {
                                        securityListItemRefs.current.set(sl.id, node)
                                    } else {
                                        securityListItemRefs.current.delete(sl.id)
                                    }
                                }}
                                className={clsx(
                                    "rounded-[2px] border p-2.5 transition-colors",
                                    sl.id === highlightedSecurityListId
                                        ? "border-[color-mix(in_srgb,var(--vscode-button-background)_45%,var(--vscode-panel-border))] bg-[color-mix(in_srgb,var(--vscode-editor-background)_82%,var(--vscode-button-background)_18%)]"
                                        : "border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] hover:bg-[var(--vscode-list-hoverBackground)]",
                                )}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex min-w-0 flex-col">
                                        <div className="font-semibold text-[13px] flex items-center gap-2 text-[var(--vscode-foreground)] w-full">
                                            <Shield size={14} className="text-[var(--vscode-icon-foreground)] shrink-0" />
                                            <span className="truncate">{sl.name}</span>
                                        </div>
                                        <div className="text-[11px] text-description mt-0.5 truncate" title={sl.id}>{sl.id}</div>
                                    </div>
                                    <WorkbenchInlineActionCluster className="gap-1 shrink-0">
                                        <WorkbenchEditIconButton onClick={() => setEditingList(sl)} title="Edit security list" />
                                        <WorkbenchIconDestructiveButton
                                            icon={<Trash2 size={12} />}
                                            onClick={() => handleDelete(sl.id)}
                                            disabled={deletingId === sl.id}
                                            title="Delete security list"
                                            busy={deletingId === sl.id}
                                        />
                                    </WorkbenchInlineActionCluster>
                                </div>

                                <div className="mt-2.5 grid grid-cols-2 gap-3 border-t border-[var(--vscode-panel-border)] pt-2">
                                    <div>
                                        <h5 className="text-[11px] font-semibold text-[var(--vscode-foreground)] mb-1">Ingress Rules ({sl.ingressSecurityRules?.length || 0})</h5>
                                    </div>
                                    <div>
                                        <h5 className="text-[11px] font-semibold text-[var(--vscode-foreground)] mb-1">Egress Rules ({sl.egressSecurityRules?.length || 0})</h5>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <GuardrailDialog
                open={guardrail !== null}
                title={guardrail?.title ?? ""}
                description={guardrail?.description ?? ""}
                confirmLabel={guardrail?.confirmLabel ?? "Confirm"}
                details={guardrail?.details ?? []}
                tone={guardrail?.tone}
                busy={deletingId !== null}
                onCancel={() => {
                    if (!deletingId) {
                        setGuardrail(null)
                    }
                }}
                onConfirm={async () => {
                    if (!guardrail) return
                    try {
                        await guardrail.onConfirm()
                    } catch (err) {
                        setError(err instanceof Error ? err.message : String(err))
                        setGuardrail(null)
                    }
                }}
            />
        </div>
    )
}

function SecurityListForm({
    vcnId,
    compartmentId,
    region,
    initialData,
    onSave,
    onCancel
}: {
    vcnId: string
    compartmentId: string
    region: string
    initialData: SecurityListResource | null
    onSave: (result: { kind: "created" | "updated"; securityListId?: string; securityListName: string }) => void
    onCancel: () => void
}) {
    const [name, setName] = useState(initialData?.name || "")
    const [ingressRules, setIngressRules] = useState<SecurityRule[]>(initialData?.ingressSecurityRules || [])
    const [egressRules, setEgressRules] = useState<SecurityRule[]>(initialData?.egressSecurityRules || [])
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const handleSave = async () => {
        if (!name && !initialData) {
            setError("Name is required")
            return
        }
        setSaving(true)
        setError(null)

        const sanitizeRules = (rules: SecurityRule[]) => rules.map(r => {
            const copy = { ...r };
            if (!copy.description || copy.description.trim() === "") {
                delete copy.description;
            }
            return copy;
        });

        try {
            if (initialData) {
                await ResourceServiceClient.updateSecurityList({
                    securityListId: initialData.id,
                    region,
                    ingressSecurityRules: sanitizeRules(ingressRules),
                    egressSecurityRules: sanitizeRules(egressRules)
                })
                onSave({
                    kind: "updated",
                    securityListId: initialData.id,
                    securityListName: initialData.name,
                })
            } else {
                await ResourceServiceClient.createSecurityList({
                    vcnId,
                    compartmentId,
                    name,
                    region,
                    ingressSecurityRules: sanitizeRules(ingressRules),
                    egressSecurityRules: sanitizeRules(egressRules)
                })
                onSave({
                    kind: "created",
                    securityListName: name,
                })
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
            setSaving(false)
        }
    }

    const addRule = (type: "ingress" | "egress") => {
        const newRule: SecurityRule = {
            isStateless: false,
            protocol: "all",
            description: "",
            source: type === "ingress" ? "0.0.0.0/0" : undefined,
            destination: type === "egress" ? "0.0.0.0/0" : undefined,
        }
        if (type === "ingress") setIngressRules([...ingressRules, newRule])
        else setEgressRules([...egressRules, newRule])
    }

    const removeRule = (type: "ingress" | "egress", index: number) => {
        if (type === "ingress") setIngressRules(ingressRules.filter((_, i) => i !== index))
        else setEgressRules(egressRules.filter((_, i) => i !== index))
    }

    const updateRule = (type: "ingress" | "egress", index: number, field: keyof SecurityRule, value: any) => {
        const rules = type === "ingress" ? [...ingressRules] : [...egressRules]
        rules[index] = { ...rules[index], [field]: value }
        if (type === "ingress") setIngressRules(rules)
        else setEgressRules(rules)
    }

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2.5 border-b border-border-panel px-3 py-2.5">
                <button
                    onClick={onCancel}
                    className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-list-background-hover hover:text-foreground"
                >
                    <ChevronLeft size={16} />
                </button>
                <span className="text-sm font-semibold">{initialData ? "Edit Security List" : "Create Security List"}</span>
                <div className="ml-auto">
                    <WorkbenchInlineActionCluster>
                        <WorkbenchActionButton onClick={handleSave} disabled={saving}>
                            {saving ? <Loader2 size={14} className="animate-spin" /> : "Save"}
                        </WorkbenchActionButton>
                    </WorkbenchInlineActionCluster>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
                {error && (
                    <InlineNotice tone="danger" size="md" icon={<AlertCircle size={13} />}>
                        {error}
                    </InlineNotice>
                )}

                {!initialData && (
                    <label className="flex flex-col gap-1.5">
                        <span className="text-xs font-semibold">Name</span>
                        <input
                            className="bg-input-background border border-input-border rounded-md px-2.5 py-1.5 text-xs w-full"
                            value={name}
                            onChange={e => setName(e.target.value)}
                            placeholder="My Security List"
                        />
                    </label>
                )}

                <SecurityRuleTable
                    type="ingress"
                    rules={ingressRules}
                    onUpdateRule={(idx, field, val) => updateRule("ingress", idx, field as any, val)}
                    onRemoveRule={(idx) => removeRule("ingress", idx)}
                />

                <div className="flex justify-end">
                    <WorkbenchInlineActionCluster>
                        <WorkbenchActionButton variant="secondary" onClick={() => addRule("ingress")}>
                            Add Ingress Rule
                        </WorkbenchActionButton>
                    </WorkbenchInlineActionCluster>
                </div>

                <SecurityRuleTable
                    type="egress"
                    rules={egressRules}
                    onUpdateRule={(idx, field, val) => updateRule("egress", idx, field as any, val)}
                    onRemoveRule={(idx) => removeRule("egress", idx)}
                />

                <div className="flex justify-end">
                    <WorkbenchInlineActionCluster>
                        <WorkbenchActionButton variant="secondary" onClick={() => addRule("egress")}>
                            Add Egress Rule
                        </WorkbenchActionButton>
                    </WorkbenchInlineActionCluster>
                </div>

            </div>
        </div>
    )
}

function formatPortRange(range?: { min: number, max: number }) {
    if (!range) return "All";
    if (range.min === range.max) return range.min.toString();
    return `${range.min}-${range.max}`;
}

function parsePortRange(val: string): { min: number, max: number } | undefined {
    if (!val || val.toLowerCase() === "all" || val.trim() === "") return undefined;
    const parts = val.split("-");
    if (parts.length === 2) {
        return { min: parseInt(parts[0].trim(), 10) || 1, max: parseInt(parts[1].trim(), 10) || 65535 };
    }
    const p = parseInt(val.trim(), 10);
    if (!isNaN(p)) return { min: p, max: p };
    return undefined;
}

function handlePortChange(rule: SecurityRule, idx: number, type: "source" | "destination", val: string, onUpdate: (idx: number, field: string, value: any) => void) {
    const range = parsePortRange(val);
    if (rule.protocol === "6") {
        const tcpOptions = { ...(rule.tcpOptions || {}) };
        if (type === "source") tcpOptions.sourcePortRange = range as any;
        else tcpOptions.destinationPortRange = range as any;
        // Keep it clean if undefined
        if (!tcpOptions.sourcePortRange) delete tcpOptions.sourcePortRange;
        if (!tcpOptions.destinationPortRange) delete tcpOptions.destinationPortRange;
        onUpdate(idx, "tcpOptions", Object.keys(tcpOptions).length ? tcpOptions : undefined);
    } else if (rule.protocol === "17") {
        const udpOptions = { ...(rule.udpOptions || {}) };
        if (type === "source") udpOptions.sourcePortRange = range as any;
        else udpOptions.destinationPortRange = range as any;
        if (!udpOptions.sourcePortRange) delete udpOptions.sourcePortRange;
        if (!udpOptions.destinationPortRange) delete udpOptions.destinationPortRange;
        onUpdate(idx, "udpOptions", Object.keys(udpOptions).length ? udpOptions : undefined);
    }
}

function formatIcmp(options?: { type: number, code?: number }) {
    if (!options) return "All";
    if (options.code === undefined || options.code === null) return `${options.type}`;
    return `${options.type}, ${options.code}`;
}

function handleIcmpChange(idx: number, val: string, onUpdate: (idx: number, field: string, value: any) => void) {
    if (!val || val.trim() === "" || val.toLowerCase() === "all" || val.toLowerCase() === "none") {
        onUpdate(idx, "icmpOptions", undefined);
        return;
    }
    const parts = val.split(",");
    const type = parseInt(parts[0].trim(), 10);
    const code = parts.length > 1 ? parseInt(parts[1].trim(), 10) : undefined;
    if (!isNaN(type)) {
        onUpdate(idx, "icmpOptions", { type, code: isNaN(code as any) ? undefined : code });
    }
}

function getAllowsText(rule: SecurityRule) {
    if (rule.protocol === "all") return "All traffic for all ports";
    if (rule.protocol === "6") {
        const p = formatPortRange(rule.tcpOptions?.destinationPortRange);
        return `TCP traffic for ports: ${p}`;
    }
    if (rule.protocol === "17") {
        const p = formatPortRange(rule.udpOptions?.destinationPortRange);
        return `UDP traffic for ports: ${p}`;
    }
    if (rule.protocol === "1") {
        return `ICMP traffic for: ${formatIcmp(rule.icmpOptions)}`;
    }
    return `Protocol ${rule.protocol}`;
}

function formatRecentActionAge(timestamp: number): string {
    const ageMs = Math.max(0, Date.now() - timestamp)
    if (ageMs < 5000) {
        return "just now"
    }
    return `${Math.round(ageMs / 1000)}s ago`
}

function formatSecurityListActionMessage(kind: "created" | "updated" | "deleted"): string {
    if (kind === "created") return "Created security list"
    if (kind === "updated") return "Updated security list"
    return "Deleted security list"
}

function buildSecurityRuleSearchText(rule: SecurityRule): string {
    return [
        rule.description,
        rule.protocol,
        rule.source,
        rule.destination,
        formatPortRange(rule.tcpOptions?.sourcePortRange),
        formatPortRange(rule.tcpOptions?.destinationPortRange),
        formatPortRange(rule.udpOptions?.sourcePortRange),
        formatPortRange(rule.udpOptions?.destinationPortRange),
        formatIcmp(rule.icmpOptions),
        getAllowsText(rule),
        rule.isStateless ? "stateless" : "stateful",
    ]
        .filter(Boolean)
        .join(" ")
}

function SecurityRuleTable({
    type,
    rules,
    onUpdateRule,
    onRemoveRule,
}: {
    type: "ingress" | "egress"
    rules: SecurityRule[]
    onUpdateRule: (index: number, field: string, value: any) => void
    onRemoveRule: (index: number) => void
}) {
    return (
        <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">{type === "ingress" ? "Ingress Rules" : "Egress Rules"}</h4>
            </div>
            <div className="overflow-x-auto border border-border-panel rounded-lg">
                <table className="w-full text-left text-xs whitespace-nowrap">
                    <thead className="bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,black_8%)] border-b border-border-panel text-foreground">
                        <tr>
                            <th className="px-3 py-2 font-semibold">Stateless</th>
                            <th className="px-3 py-2 font-semibold">{type === "ingress" ? "Source" : "Destination"}</th>
                            <th className="px-3 py-2 font-semibold">IP Protocol</th>
                            <th className="px-3 py-2 font-semibold">Source Port Range</th>
                            <th className="px-3 py-2 font-semibold">Destination Port Range</th>
                            <th className="px-3 py-2 font-semibold">Type and Code</th>
                            <th className="px-3 py-2 font-semibold">Allows</th>
                            <th className="px-3 py-2 font-semibold min-w-48">Description</th>
                            <th className="px-3 py-2 font-semibold text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-border-panel bg-input-background text-foreground">
                        {rules.length === 0 ? (
                            <tr>
                                <td colSpan={9} className="px-3 py-6 text-center text-description">No {type} rules</td>
                            </tr>
                        ) : rules.map((rule, idx) => (
                            <tr key={idx} className="hover:bg-list-background-hover">
                                <td className="px-3 py-2">
                                    <input
                                        type="checkbox"
                                        checked={rule.isStateless}
                                        onChange={e => onUpdateRule(idx, "isStateless", e.target.checked)}
                                        className="rounded border-input-border text-button-primary-background"
                                    />
                                </td>
                                <td className="px-3 py-2">
                                    <input
                                        className="bg-transparent border border-input-border rounded px-2 py-1 w-28 focus:border-button-primary-background outline-none"
                                        value={type === "ingress" ? (rule.source || "") : (rule.destination || "")}
                                        onChange={e => onUpdateRule(idx, type, e.target.value)}
                                        placeholder="0.0.0.0/0"
                                    />
                                </td>
                                <td className="px-3 py-2">
                                    <select
                                        className="bg-input-background text-input-foreground border border-input-border rounded px-2 py-1 focus:border-button-primary-background outline-none"
                                        value={rule.protocol}
                                        onChange={e => onUpdateRule(idx, "protocol", e.target.value)}
                                    >
                                        <option value="all">All Protocols</option>
                                        <option value="6">TCP</option>
                                        <option value="17">UDP</option>
                                        <option value="1">ICMP</option>
                                    </select>
                                </td>
                                <td className="px-3 py-2">
                                    <input
                                        className="bg-transparent border border-input-border rounded px-2 py-1 w-20 focus:border-button-primary-background outline-none disabled:opacity-50"
                                        disabled={rule.protocol !== "6" && rule.protocol !== "17"}
                                        value={
                                            rule.protocol === "6" ? formatPortRange(rule.tcpOptions?.sourcePortRange) :
                                                rule.protocol === "17" ? formatPortRange(rule.udpOptions?.sourcePortRange) : ""
                                        }
                                        onChange={e => handlePortChange(rule, idx, "source", e.target.value, onUpdateRule)}
                                        placeholder="All"
                                    />
                                </td>
                                <td className="px-3 py-2">
                                    <input
                                        className="bg-transparent border border-input-border rounded px-2 py-1 w-20 focus:border-button-primary-background outline-none disabled:opacity-50"
                                        disabled={rule.protocol !== "6" && rule.protocol !== "17"}
                                        value={
                                            rule.protocol === "6" ? formatPortRange(rule.tcpOptions?.destinationPortRange) :
                                                rule.protocol === "17" ? formatPortRange(rule.udpOptions?.destinationPortRange) : ""
                                        }
                                        onChange={e => handlePortChange(rule, idx, "destination", e.target.value, onUpdateRule)}
                                        placeholder="All"
                                    />
                                </td>
                                <td className="px-3 py-2">
                                    <input
                                        className="bg-transparent border border-input-border rounded px-2 py-1 w-20 focus:border-button-primary-background outline-none disabled:opacity-50"
                                        disabled={rule.protocol !== "1"}
                                        value={rule.protocol === "1" ? formatIcmp(rule.icmpOptions) : ""}
                                        onChange={e => handleIcmpChange(idx, e.target.value, onUpdateRule)}
                                        placeholder="Type, Code"
                                    />
                                </td>
                                <td className="px-3 py-2 text-[11px] text-foreground font-medium">
                                    {getAllowsText(rule)}
                                </td>
                                <td className="px-3 py-2">
                                    <input
                                        className="bg-transparent border border-input-border rounded px-2 py-1 w-full min-w-32 focus:border-button-primary-background outline-none px-1"
                                        value={rule.description || ""}
                                        onChange={e => onUpdateRule(idx, "description", e.target.value)}
                                        placeholder="Optional description"
                                    />
                                </td>
                                <td className="px-3 py-2 text-right">
                                    <WorkbenchIconDestructiveButton
                                        icon={<Trash2 size={12} className="shrink-0" />}
                                        onClick={() => onRemoveRule(idx)}
                                        title="Delete Rule"
                                        className="h-7 w-7 px-0"
                                    />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
