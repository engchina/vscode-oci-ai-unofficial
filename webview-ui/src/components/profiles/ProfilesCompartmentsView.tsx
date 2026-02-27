import { clsx } from "clsx"
import { ChevronDown, LoaderCircle, Lock, Plus, Save, Trash2, Users } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { StateServiceClient } from "../../services/grpc-client"
import type { SettingsState, SavedCompartment } from "../../services/types"
import Button from "../ui/Button"
import Card from "../ui/Card"

const EMPTY_SETTINGS: SettingsState = {
    activeProfile: "DEFAULT",
    profile: "",
    region: "",
    compartmentId: "",
    computeCompartmentIds: [],
    chatCompartmentId: "",
    adbCompartmentIds: [],
    dbSystemCompartmentIds: [],
    objectStorageCompartmentIds: [],
    genAiRegion: "",
    genAiLlmModelId: "",
    genAiEmbeddingModelId: "",
    tenancyOcid: "",
    userOcid: "",
    fingerprint: "",
    privateKey: "",
    privateKeyPassphrase: "",
    systemPrompt: "",
    shellIntegrationTimeoutSec: 4,
    chatMaxTokens: 16000,
    chatTemperature: 0,
    chatTopP: 1,
    authMode: "config-file",
    savedCompartments: [],
    vcnCompartmentIds: [],
    profilesConfig: [],
}

export default function ProfilesCompartmentsView() {
    const [settings, setSettings] = useState<SettingsState>(EMPTY_SETTINGS)
    const [loaded, setLoaded] = useState(false)
    const [saving, setSaving] = useState(false)
    const fetchIdRef = useRef(0)
    const refreshTimerRef = useRef<number | null>(null)

    const refreshSettings = useCallback(async () => {
        const fetchId = ++fetchIdRef.current
        try {
            const state = await StateServiceClient.getSettings()
            if (fetchId === fetchIdRef.current) {
                setSettings(state)
                setLoaded(true)
            }
        } catch (error) {
            console.error("Failed to load settings:", error)
            if (fetchId === fetchIdRef.current) {
                setLoaded(true)
            }
        }
    }, [])

    const scheduleRefreshSettings = useCallback(() => {
        if (refreshTimerRef.current !== null) {
            window.clearTimeout(refreshTimerRef.current)
        }
        refreshTimerRef.current = window.setTimeout(() => {
            refreshTimerRef.current = null
            void refreshSettings()
        }, 200)
    }, [refreshSettings])

    // Load settings and subscribe to state broadcasts for refresh
    useEffect(() => {
        void refreshSettings()

        // Subscribe to state broadcasts so we refresh when profiles change from other tabs
        const unsubscribe = StateServiceClient.subscribeToState({
            onResponse: () => {
                // Re-fetch full settings when state changes (coalesced)
                scheduleRefreshSettings()
            },
            onError: (error) => console.error("State subscription error:", error),
            onComplete: () => { },
        })

        return () => {
            unsubscribe()
            if (refreshTimerRef.current !== null) {
                window.clearTimeout(refreshTimerRef.current)
                refreshTimerRef.current = null
            }
        }
    }, [refreshSettings, scheduleRefreshSettings])

    const updateField = useCallback(<K extends keyof SettingsState>(field: K, value: SettingsState[K]) => {
        setSettings((prev) => ({ ...prev, [field]: value }))
    }, [])

    const handleSave = useCallback(async () => {
        setSaving(true)
        try {
            await StateServiceClient.saveSettings(settings)
        } catch (error) {
            console.error("Failed to save settings:", error)
        } finally {
            setSaving(false)
        }
    }, [settings])

    if (!loaded) {
        return (
            <div className="flex h-full items-center justify-center px-6">
                <span className="text-sm text-description">Loading...</span>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-md font-semibold">
                    <Users size={14} />
                    Compartments
                </h3>
                {saving && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-description">
                        <LoaderCircle size={12} className="animate-spin" />
                        Saving...
                    </span>
                )}
            </div>
            <p className="-mt-2 text-xs text-description">Manage OCI profiles and their compartment mappings.</p>

            <ProfileConfigEditor settings={settings} updateField={updateField} />

            <Button onClick={handleSave} disabled={saving} className="self-start px-4">
                <Save size={14} className="mr-1.5" />
                {saving ? "Saving..." : "Save Settings"}
            </Button>
        </div>
    )
}

function ProfileConfigEditor({
    settings,
    updateField,
}: {
    settings: SettingsState
    updateField: <K extends keyof SettingsState>(field: K, value: SettingsState[K]) => void
}) {
    const [newCompId, setNewCompId] = useState("")
    const [newCompName, setNewCompName] = useState("")
    const [editingProfile, setEditingProfile] = useState<string | null>(null)
    const [selectedProfile, setSelectedProfile] = useState<string | null>(null)
    const [selectedProfileTenancyOcid, setSelectedProfileTenancyOcid] = useState<string>("")

    const profiles = settings.profilesConfig || []

    // Auto-select first profile if none selected or if current selection no longer exists
    const effectiveSelectedProfile = (selectedProfile && profiles.some(p => p.name === selectedProfile))
        ? selectedProfile
        : (profiles.length > 0 ? profiles[0].name : null)

    // Load tenancy OCID for the selected profile
    useEffect(() => {
        if (!effectiveSelectedProfile) {
            setSelectedProfileTenancyOcid("")
            return
        }
        // Load the selected profile's secrets to get its tenancy OCID
        StateServiceClient.getProfileSecrets(effectiveSelectedProfile)
            .then((secrets) => {
                setSelectedProfileTenancyOcid(secrets.tenancyOcid?.trim() || "")
            })
            .catch((err) => {
                console.error("Failed to load profile secrets:", err)
                setSelectedProfileTenancyOcid("")
            })
    }, [effectiveSelectedProfile])

    const addCompartment = (profileName: string) => {
        if (!newCompId.trim() || !newCompName.trim()) return
        const updated = profiles.map(p => {
            if (p.name === profileName) {
                if (p.compartments.some(c => c.id === newCompId.trim())) return p
                return { ...p, compartments: [...p.compartments, { id: newCompId.trim(), name: newCompName.trim() }] }
            }
            return p
        })
        updateField("profilesConfig", updated)
        setNewCompId("")
        setNewCompName("")
    }

    const removeCompartment = (profileName: string, compId: string) => {
        const updated = profiles.map(p => {
            if (p.name === profileName) {
                return { ...p, compartments: p.compartments.filter(c => c.id !== compId) }
            }
            return p
        })
        updateField("profilesConfig", updated)
    }

    return (
        <div className="flex flex-col gap-4">
            {/* Profile Selector (for compartment maintenance, NOT global active profile) */}
            <Card title="Profile">
                <div className="flex flex-col gap-1.5">
                    <label className="inline-flex items-center gap-1 text-xs text-description font-medium">
                        <ChevronDown size={12} className="shrink-0" />
                        Select Profile to Manage Compartments
                    </label>
                    <select
                        value={effectiveSelectedProfile || ""}
                        onChange={e => setSelectedProfile(e.target.value)}
                        className="w-full rounded-md border border-input-border bg-input-background px-2 py-1.5 text-xs outline-none focus:border-border"
                    >
                        {profiles.length > 0 ? (
                            profiles.map(p => (
                                <option key={p.name} value={p.name}>{p.name}</option>
                            ))
                        ) : (
                            <option value="" disabled>No profiles available</option>
                        )}
                    </select>
                    <p className="text-[10px] text-description">Choose which profile's compartments to manage below. This does not affect the global active profile.</p>
                </div>
            </Card>

            {/* Compartments for Selected Profile */}
            {effectiveSelectedProfile && (() => {
                const p = profiles.find(pr => pr.name === effectiveSelectedProfile)
                if (!p) return null
                return (
                    <div className="flex flex-col gap-2 rounded-md border border-border-panel p-2 bg-[color-mix(in_srgb,var(--vscode-editor-background)_96%,black_4%)]">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold">{p.name}</span>
                        </div>
                        <p className="text-[10px] text-description">Profile deletion is available in Profiles.</p>

                        {/* Compartments inside Profile */}
                        <div className="flex flex-col pl-2 gap-1 border-l-2 border-border-panel">
                            {/* Immutable Root Compartment (Tenancy OCID) */}
                            {selectedProfileTenancyOcid && (
                                <div className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-[color-mix(in_srgb,var(--vscode-editor-background)_85%,black_15%)]">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <Lock size={10} className="shrink-0 text-description" />
                                        <div className="flex flex-col min-w-0">
                                            <span className="text-xs truncate font-medium">Root (Tenancy)</span>
                                            <span className="text-[10px] text-description truncate" title={selectedProfileTenancyOcid}>{selectedProfileTenancyOcid}</span>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* User-defined Compartments */}
                            {p.compartments.map(c => (
                                <div key={c.id} className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-[color-mix(in_srgb,var(--vscode-editor-background)_90%,black_10%)]">
                                    <div className="flex flex-col min-w-0">
                                        <span className="text-xs truncate">{c.name}</span>
                                        <span className="text-[10px] text-description truncate" title={c.id}>{c.id}</span>
                                    </div>
                                    <button
                                        onClick={() => removeCompartment(p.name, c.id)}
                                        className="shrink-0 text-description hover:text-error"
                                    >
                                        <Trash2 size={10} />
                                    </button>
                                </div>
                            ))}

                            {editingProfile === p.name ? (
                                <div className="flex flex-col gap-1.5 mt-1 border-t border-border-panel pt-2">
                                    <input
                                        placeholder="Compartment Name (e.g. Prod)"
                                        value={newCompName}
                                        onChange={e => setNewCompName(e.target.value)}
                                        className="rounded-md border border-input-border bg-input-background px-2 py-1.5 text-xs outline-none"
                                    />
                                    <input
                                        placeholder="Compartment OCID"
                                        value={newCompId}
                                        onChange={e => setNewCompId(e.target.value)}
                                        className="rounded-md border border-input-border bg-input-background px-2 py-1.5 text-xs outline-none"
                                    />
                                    <div className="flex gap-2 justify-end">
                                        <Button size="sm" variant="secondary" onClick={() => setEditingProfile(null)}>Cancel</Button>
                                        <Button size="sm" disabled={!newCompId.trim() || !newCompName.trim()} onClick={() => { addCompartment(p.name); setEditingProfile(null); }}>Add</Button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={() => { setEditingProfile(p.name); setNewCompId(""); setNewCompName(""); }}
                                    className="flex items-center gap-1.5 mt-1 px-2 py-1 text-xs text-description hover:text-foreground transition-colors w-fit"
                                >
                                    <Plus size={12} /> Add Compartment
                                </button>
                            )}
                        </div>
                    </div>
                )
            })()}

            {!effectiveSelectedProfile && profiles.length === 0 && (
                <div className="text-xs text-description px-2 py-2">No profiles available. Add a profile in the Profiles tab.</div>
            )}
        </div>
    )
}
