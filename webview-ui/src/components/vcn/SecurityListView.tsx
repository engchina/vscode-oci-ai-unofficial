import { clsx } from "clsx"
import { AlertCircle, ChevronLeft, Loader2, Plus, RefreshCw, Shield, Trash2, Edit } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { ResourceServiceClient } from "../../services/grpc-client"
import type { SecurityListResource, SecurityRule, VcnResource } from "../../services/types"
import Button from "../ui/Button"

export default function SecurityListView({
    vcn,
    onBack,
}: {
    vcn: VcnResource
    onBack: () => void
}) {
    const [securityLists, setSecurityLists] = useState<SecurityListResource[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [editingList, setEditingList] = useState<SecurityListResource | null>(null)
    const [isCreating, setIsCreating] = useState(false)
    const [deletingId, setDeletingId] = useState<string | null>(null)

    const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await ResourceServiceClient.listSecurityLists({ vcnId: vcn.id, region: vcn.region })
            setSecurityLists(res.securityLists ?? [])
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setLoading(false)
        }
    }, [vcn.id, vcn.region])

    useEffect(() => {
        load()
    }, [load])

    const handleDelete = async (id: string) => {
        if (!confirm("Are you sure you want to delete this Security List?")) return
        setDeletingId(id)
        try {
            await ResourceServiceClient.deleteSecurityList({ securityListId: id, region: vcn.region })
            await load()
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
        } finally {
            setDeletingId(null)
        }
    }

    if (editingList || isCreating) {
        return (
            <SecurityListForm
                vcnId={vcn.id}
                compartmentId={vcn.compartmentId}
                region={vcn.region}
                initialData={editingList}
                onSave={async () => {
                    setEditingList(null)
                    setIsCreating(false)
                    await load()
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
            <div className="flex items-center justify-between gap-3 border-b border-[var(--vscode-panel-border)] px-3 py-2 bg-[var(--vscode-editor-background)]">
                <div className="flex min-w-0 items-center gap-2">
                    <button
                        onClick={onBack}
                        className="flex h-6 w-6 items-center justify-center rounded-[2px] hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-[var(--vscode-toolbar-hoverOutline)]"
                        title="Back to VCNs"
                    >
                        <ChevronLeft size={14} />
                    </button>
                    <div className="flex min-w-0 flex-col">
                        <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--vscode-sideBarTitle-foreground)] truncate">Security Lists: {vcn.name}</span>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    <Button variant="secondary" size="sm" onClick={() => setIsCreating(true)} className="flex items-center gap-1.5 h-6">
                        <Plus size={14} /> Create
                    </Button>
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

            <div className="flex-1 overflow-y-auto px-3 py-3">
                {error && (
                    <div className="mb-4 flex items-start gap-2 rounded-[2px] border border-error/30 bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,red_8%)] px-3 py-2.5 text-[11px] text-error">
                        <AlertCircle size={13} className="mt-0.5 shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {loading ? (
                    <div className="flex py-8 justify-center">
                        <Loader2 size={24} className="animate-spin text-description" />
                    </div>
                ) : securityLists.length === 0 ? (
                    <div className="text-center py-8 text-description text-[12px]">
                        No security lists found for this VCN.
                    </div>
                ) : (
                    <div className="flex flex-col gap-3">
                        {securityLists.map(sl => (
                            <div key={sl.id} className="rounded-[2px] border border-[var(--vscode-panel-border)] p-3 bg-[var(--vscode-editor-background)] hover:bg-[var(--vscode-list-hoverBackground)] transition-colors">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex min-w-0 flex-col">
                                        <div className="font-semibold text-[13px] flex items-center gap-2 text-[var(--vscode-foreground)] w-full">
                                            <Shield size={14} className="text-[var(--vscode-icon-foreground)] shrink-0" />
                                            <span className="truncate">{sl.name}</span>
                                        </div>
                                        <div className="text-[11px] text-description mt-0.5 truncate" title={sl.id}>{sl.id}</div>
                                    </div>
                                    <div className="flex gap-1 shrink-0">
                                        <Button variant="secondary" size="sm" onClick={() => setEditingList(sl)}>
                                            <Edit size={12} />
                                        </Button>
                                        <Button variant="secondary" size="sm" onClick={() => handleDelete(sl.id)} disabled={deletingId === sl.id}>
                                            {deletingId === sl.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} className="text-error" />}
                                        </Button>
                                    </div>
                                </div>

                                <div className="mt-3 grid grid-cols-2 gap-4 border-t border-[var(--vscode-panel-border)] pt-2">
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
    onSave: () => void
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
            } else {
                await ResourceServiceClient.createSecurityList({
                    vcnId,
                    compartmentId,
                    name,
                    region,
                    ingressSecurityRules: sanitizeRules(ingressRules),
                    egressSecurityRules: sanitizeRules(egressRules)
                })
            }
            onSave()
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
            <div className="flex items-center gap-3 border-b border-border-panel px-4 py-3">
                <button
                    onClick={onCancel}
                    className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-list-background-hover hover:text-foreground"
                >
                    <ChevronLeft size={16} />
                </button>
                <span className="text-sm font-semibold">{initialData ? "Edit Security List" : "Create Security List"}</span>
                <div className="ml-auto">
                    <Button size="sm" onClick={handleSave} disabled={saving}>
                        {saving ? <Loader2 size={14} className="animate-spin" /> : "Save"}
                    </Button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
                {error && (
                    <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,red_8%)] px-3 py-2.5 text-xs text-error">
                        <AlertCircle size={13} className="mt-0.5 shrink-0" />
                        <span>{error}</span>
                    </div>
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
                    onAddRule={() => addRule("ingress")}
                />

                <SecurityRuleTable
                    type="egress"
                    rules={egressRules}
                    onUpdateRule={(idx, field, val) => updateRule("egress", idx, field as any, val)}
                    onRemoveRule={(idx) => removeRule("egress", idx)}
                    onAddRule={() => addRule("egress")}
                />

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

function SecurityRuleTable({
    type,
    rules,
    onUpdateRule,
    onRemoveRule,
    onAddRule
}: {
    type: "ingress" | "egress"
    rules: SecurityRule[]
    onUpdateRule: (index: number, field: string, value: any) => void
    onRemoveRule: (index: number) => void
    onAddRule: () => void
}) {
    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold">{type === "ingress" ? "Ingress Rules" : "Egress Rules"}</h4>
                <Button variant="secondary" size="sm" onClick={onAddRule}>Add {type === "ingress" ? "Ingress" : "Egress"} Rule</Button>
            </div>
            <div className="overflow-x-auto border border-border-panel rounded-lg">
                <table className="w-full text-left text-xs whitespace-nowrap">
                    <thead className="bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,black_8%)] border-b border-border-panel">
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
                    <tbody className="divide-y divide-border-panel bg-input-background">
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
                                        className="bg-transparent border border-input-border rounded px-2 py-1 focus:border-button-primary-background outline-none"
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
                                <td className="px-3 py-2 text-[11px] text-description font-medium">
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
                                    <button
                                        className="p-1 rounded text-description hover:bg-list-background-hover hover:text-error transition-colors"
                                        onClick={() => onRemoveRule(idx)}
                                        title="Delete Rule"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
