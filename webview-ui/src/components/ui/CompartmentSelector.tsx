import { clsx } from "clsx"
import { Check, ChevronDown, Lock, MonitorStop } from "lucide-react"
import { useState, useRef, useEffect, useMemo, useCallback, type MouseEvent as ReactMouseEvent } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { StateServiceClient } from "../../services/grpc-client"
import type { SettingsState } from "../../services/types"

interface CompartmentSelectorProps {
    featureKey: "compute" | "adb" | "chat" | "vcn"
    multiple?: boolean
}

export default function CompartmentSelector({ featureKey, multiple = false }: CompartmentSelectorProps) {
    const {
        activeProfile,
        computeCompartmentIds,
        chatCompartmentId,
        adbCompartmentIds,
        vcnCompartmentIds,
        profilesConfig,
        tenancyOcid,
    } = useExtensionState()

    const [isOpen, setIsOpen] = useState(false)
    const [optimisticSelection, setOptimisticSelection] = useState<string[] | null>(null)
    const [isSaving, setIsSaving] = useState(false)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const settingsCacheRef = useRef<SettingsState | null>(null)

    // Determine current active profile config
    const activeProfileConfig = useMemo(
        () => profilesConfig.find(p => p.name === activeProfile),
        [profilesConfig, activeProfile],
    )
    const profileCompartments = activeProfileConfig?.compartments || []

    // Build available compartments: root (tenancy) first, then profile compartments
    const rootCompartment = useMemo(() => tenancyOcid?.trim()
        ? { id: tenancyOcid.trim(), name: "Root (Tenancy)", isRoot: true }
        : null, [tenancyOcid])

    const availableCompartments = useMemo(
        () => [
            ...(rootCompartment ? [rootCompartment] : []),
            ...profileCompartments.map(c => ({ ...c, isRoot: false })),
        ],
        [rootCompartment, profileCompartments],
    )

    // Determine currently selected items for this feature
    const persistedSelection = useMemo(() => {
        let selection: string[] = []
        if (featureKey === "compute") selection = computeCompartmentIds
        else if (featureKey === "adb") selection = adbCompartmentIds
        else if (featureKey === "vcn") selection = vcnCompartmentIds
        else if (featureKey === "chat") {
            // Default chat to root compartment if nothing selected
            if (chatCompartmentId) {
                selection = [chatCompartmentId]
            } else if (rootCompartment) {
                selection = [rootCompartment.id]
            }
        }

        const availableIds = new Set(availableCompartments.map(c => c.id))
        return selection.filter(id => availableIds.has(id))
    }, [
        featureKey,
        computeCompartmentIds,
        adbCompartmentIds,
        vcnCompartmentIds,
        chatCompartmentId,
        rootCompartment,
        availableCompartments,
    ])

    const currentSelection = optimisticSelection ?? persistedSelection

    // Only clear optimistic selection when persisted state actually catches up
    useEffect(() => {
        if (optimisticSelection !== null) {
            // Check if persisted selection matches optimistic selection perfectly
            const matches = optimisticSelection.length === persistedSelection.length &&
                optimisticSelection.every(id => persistedSelection.includes(id))
            if (matches) {
                setOptimisticSelection(null)
            }
        }
    }, [persistedSelection, optimisticSelection])

    // Preload settings into cache when dropdown is opened to avoid delay on first click
    useEffect(() => {
        if (isOpen && !settingsCacheRef.current) {
            StateServiceClient.getSettings().then(state => {
                settingsCacheRef.current = state
            }).catch(console.error)
        }
    }, [isOpen])

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }
        document.addEventListener("mousedown", handleClickOutside)
        return () => document.removeEventListener("mousedown", handleClickOutside)
    }, [])

    const handleToggle = useCallback(async (id: string, e: ReactMouseEvent<HTMLButtonElement>) => {
        e.stopPropagation()
        let newSelection: string[]
        if (multiple) {
            if (currentSelection.includes(id)) {
                newSelection = currentSelection.filter(s => s !== id)
            } else {
                newSelection = [...currentSelection, id]
            }
        } else {
            newSelection = [id]
            setIsOpen(false)
        }

        // Optimistic update so checkbox feels instant.
        setOptimisticSelection(newSelection)
        setIsSaving(true)

        // Save (reuse cached settings to avoid full round-trip on every click)
        const state = settingsCacheRef.current ?? await StateServiceClient.getSettings()

        if (featureKey === "compute") {
            state.computeCompartmentIds = newSelection
        } else if (featureKey === "adb") {
            state.adbCompartmentIds = newSelection
        } else if (featureKey === "vcn") {
            state.vcnCompartmentIds = newSelection
        } else if (featureKey === "chat") {
            state.chatCompartmentId = newSelection[0] || ""
        }

        settingsCacheRef.current = state

        try {
            await StateServiceClient.saveSettings({ ...state, suppressNotification: true })
        } finally {
            setIsSaving(false)
        }
    }, [currentSelection, featureKey, multiple])

    const selectionText = currentSelection.length === 0
        ? "No Compartment Selected"
        : currentSelection.length === 1
            ? availableCompartments.find(c => c.id === currentSelection[0])?.name || currentSelection[0]
            : `${currentSelection.length} Selected`

    if (availableCompartments.length === 0) {
        return (
            <div className="flex items-center gap-2 mb-4 px-3 py-2 text-xs border border-border-panel bg-input-background text-description rounded-md">
                <MonitorStop size={14} />
                <span>Profile "{activeProfile}" has no compartments mapped in Settings.</span>
            </div>
        )
    }

    return (
        <div className="relative mb-4 z-10" ref={dropdownRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs border border-border-panel bg-input-background text-foreground rounded-md hover:bg-list-background-hover transition-colors"
            >
                <span className="truncate">{selectionText}</span>
                <ChevronDown size={14} className="text-description shrink-0" />
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 max-h-48 overflow-y-auto border border-border-panel bg-[var(--vscode-dropdown-background,var(--vscode-editor-background))] rounded-md shadow-lg py-1">
                    {availableCompartments.map(comp => {
                        const isSelected = currentSelection.includes(comp.id)
                        return (
                            <button
                                key={comp.id}
                                onClick={(e) => handleToggle(comp.id, e)}
                                disabled={isSaving}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-list-background-hover transition-colors"
                            >
                                <div className={clsx(
                                    "w-3.5 h-3.5 flex shrink-0 items-center justify-center border rounded-sm",
                                    multiple
                                        ? isSelected ? "bg-button-primary-background border-button-primary-background" : "border-input-border"
                                        : isSelected ? "border-button-primary-background text-button-primary-background rounded-full" : "border-input-border rounded-full"
                                )}>
                                    {isSelected && <Check size={10} className={multiple ? "text-button-primary-foreground" : ""} />}
                                </div>
                                <div className="flex items-center gap-1 min-w-0">
                                    {comp.isRoot && <Lock size={10} className="shrink-0 text-description" />}
                                    <div className="flex flex-col min-w-0">
                                        <span className="truncate text-foreground font-medium">{comp.name}</span>
                                        <span className="truncate text-description text-[10px]">{comp.id}</span>
                                    </div>
                                </div>
                            </button>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

