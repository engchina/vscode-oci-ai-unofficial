import { clsx } from "clsx"
import { AlertCircle, ChevronDown, Loader2, Shield, Upload, X } from "lucide-react"
import { useEffect, useMemo, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { useScrollFlashTarget } from "../../hooks/useScrollFlashTarget"
import { ResourceServiceClient } from "../../services/grpc-client"
import type { BastionResource, ComputeResource } from "../../services/types"
import Button from "../ui/Button"
import InlineNotice from "../ui/InlineNotice"
import { WorkbenchDismissButton } from "../workbench/WorkbenchActionButtons"
import { WorkbenchRefreshButton } from "../workbench/WorkbenchToolbar"

const DEFAULT_SESSION_TTL_SECONDS = "10800"
const MAX_PORT_NUMBER = 65535

type PortForwardTargetType = "PRIVATE_IP" | "COMPUTE_INSTANCE"
type SshKeyMode = "UPLOAD" | "PASTE"

type SessionValidationField =
  | "publicKey"
  | "sessionTtlInSeconds"
  | "managedTargetResourceId"
  | "osUserName"
  | "targetIp"
  | "targetPort"
  | "portForwardTargetResourceId"

interface CreateBastionSessionDialogProps {
  open: boolean
  bastion: BastionResource | null
  onClose: () => void
  presentation?: "dialog" | "embedded"
  onSuccess: (summary: {
    bastionId: string
    bastionName: string
    sessionName: string
    sessionType: "MANAGED_SSH" | "PORT_FORWARDING"
  }) => void
}

export default function CreateBastionSessionDialog({
  open,
  bastion,
  onClose,
  presentation = "dialog",
  onSuccess,
}: CreateBastionSessionDialogProps) {
  const { activeProfile, profilesConfig, tenancyOcid, computeCompartmentIds, bastionCompartmentIds } = useExtensionState()
  const [sessionType, setSessionType] = useState<"MANAGED_SSH" | "PORT_FORWARDING">("MANAGED_SSH")
  const [displayName, setDisplayName] = useState("")
  const [publicKey, setPublicKey] = useState("")
  const [publicKeyFileName, setPublicKeyFileName] = useState("")
  const [managedTargetResourceId, setManagedTargetResourceId] = useState("")
  const [managedManualTargetResourceId, setManagedManualTargetResourceId] = useState("")
  const [managedTargetCompartmentId, setManagedTargetCompartmentId] = useState("")
  const [portForwardTargetResourceId, setPortForwardTargetResourceId] = useState("")
  const [portForwardManualTargetResourceId, setPortForwardManualTargetResourceId] = useState("")
  const [portForwardTargetCompartmentId, setPortForwardTargetCompartmentId] = useState("")
  const [osUserName, setOsUserName] = useState("opc")
  const [targetIp, setTargetIp] = useState("")
  const [targetPort, setTargetPort] = useState("22")
  const [portForwardTargetType, setPortForwardTargetType] = useState<PortForwardTargetType>("PRIVATE_IP")
  const [sessionTtlInSeconds, setSessionTtlInSeconds] = useState(DEFAULT_SESSION_TTL_SECONDS)
  const [sshKeyMode, setSshKeyMode] = useState<SshKeyMode>("UPLOAD")
  const [submitting, setSubmitting] = useState(false)
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [availableTargets, setAvailableTargets] = useState<ComputeResource[]>([])
  const [targetsLoading, setTargetsLoading] = useState(false)
  const [targetsError, setTargetsError] = useState<string | null>(null)
  const [useManualManagedTarget, setUseManualManagedTarget] = useState(false)
  const [useManualPortForwardTarget, setUseManualPortForwardTarget] = useState(false)
  const [targetsReloadKey, setTargetsReloadKey] = useState(0)
  const [errorAttentionKey, setErrorAttentionKey] = useState(0)
  const {
    targetRef: errorNoticeRef,
    isFlashing: isErrorFlashing,
    requestFocus: requestErrorFocus,
    cancelFocus: cancelErrorFocus,
    consumePendingFocus: consumePendingErrorFocus,
  } = useScrollFlashTarget()

  const selectedManagedTarget = useMemo(
    () => availableTargets.find((instance) => instance.id === managedTargetResourceId) ?? null,
    [availableTargets, managedTargetResourceId],
  )
  const selectedPortForwardTarget = useMemo(
    () => availableTargets.find((instance) => instance.id === portForwardTargetResourceId) ?? null,
    [availableTargets, portForwardTargetResourceId],
  )
  const resolvedManagedTargetId = useManualManagedTarget ? managedManualTargetResourceId.trim() : selectedManagedTarget?.id ?? ""
  const resolvedPortForwardTargetId = useManualPortForwardTarget
    ? portForwardManualTargetResourceId.trim()
    : selectedPortForwardTarget?.id ?? ""
  const usesManagedTargetLookup = sessionType === "MANAGED_SSH" && !useManualManagedTarget
  const usesPortForwardTargetLookup = sessionType === "PORT_FORWARDING" && portForwardTargetType === "COMPUTE_INSTANCE" && !useManualPortForwardTarget
  const targetLookupEnabled = usesManagedTargetLookup || usesPortForwardTargetLookup
  const targetCompartmentOptions = useMemo(
    () => getBastionTargetCompartmentOptions(
      activeProfile,
      profilesConfig,
      computeCompartmentIds,
      bastionCompartmentIds,
      bastion?.compartmentId,
      tenancyOcid,
      availableTargets,
    ),
    [activeProfile, availableTargets, bastion?.compartmentId, bastionCompartmentIds, computeCompartmentIds, profilesConfig, tenancyOcid],
  )
  const filteredManagedTargets = useMemo(
    () => filterTargetsByCompartment(availableTargets, managedTargetCompartmentId),
    [availableTargets, managedTargetCompartmentId],
  )
  const filteredPortForwardTargets = useMemo(
    () => filterTargetsByCompartment(availableTargets, portForwardTargetCompartmentId),
    [availableTargets, portForwardTargetCompartmentId],
  )
  const managedInstanceOptions = useMemo(
    () => filteredManagedTargets.map((instance) => ({ value: instance.id, label: instance.name })),
    [filteredManagedTargets],
  )
  const portForwardInstanceOptions = useMemo(
    () => filteredPortForwardTargets.map((instance) => ({ value: instance.id, label: instance.name })),
    [filteredPortForwardTargets],
  )
  const validationIssue = submitAttempted
    ? getCreateSessionValidationIssue({
      sessionType,
      publicKey,
      sessionTtlInSeconds,
      resolvedManagedTargetId,
      osUserName,
      targetPort,
      portForwardTargetType,
      resolvedPortForwardTargetId,
      targetIp,
    })
    : null
  const activeErrorMessage = validationIssue?.message ?? submitError
  const activeErrorTitle = validationIssue ? "Session details need attention" : "Unable to continue"
  const invalidField = validationIssue?.field ?? null
  const publicKeyInvalid = invalidField === "publicKey"
  const sessionTtlInvalid = invalidField === "sessionTtlInSeconds"
  const managedTargetInvalid = invalidField === "managedTargetResourceId"
  const osUserNameInvalid = invalidField === "osUserName"
  const targetIpInvalid = invalidField === "targetIp"
  const targetPortInvalid = invalidField === "targetPort"
  const portForwardTargetInvalid = invalidField === "portForwardTargetResourceId"
  const showTargetsError = Boolean(targetsError) && targetLookupEnabled

  const clearSubmitError = () => {
    if (submitError) {
      setSubmitError(null)
    }
  }

  const focusErrorNotice = () => {
    requestErrorFocus()
    setErrorAttentionKey((current) => current + 1)
  }

  const dismissError = () => {
    setSubmitAttempted(false)
    setSubmitError(null)
    cancelErrorFocus()
  }

  useEffect(() => {
    if (!open) {
      return
    }
    setSessionType("MANAGED_SSH")
    setDisplayName(buildDefaultSessionName())
    setPublicKey("")
    setPublicKeyFileName("")
    setManagedTargetResourceId("")
    setManagedManualTargetResourceId("")
    setManagedTargetCompartmentId("")
    setPortForwardTargetResourceId("")
    setPortForwardManualTargetResourceId("")
    setPortForwardTargetCompartmentId("")
    setOsUserName("opc")
    setTargetIp("")
    setTargetPort("22")
    setPortForwardTargetType("PRIVATE_IP")
    setSessionTtlInSeconds(DEFAULT_SESSION_TTL_SECONDS)
    setSshKeyMode("UPLOAD")
    setSubmitting(false)
    setSubmitAttempted(false)
    setSubmitError(null)
    setAvailableTargets([])
    setTargetsLoading(false)
    setTargetsError(null)
    setUseManualManagedTarget(false)
    setUseManualPortForwardTarget(false)
    setTargetsReloadKey(0)
    setErrorAttentionKey(0)
    cancelErrorFocus()
  }, [open, bastion?.id, cancelErrorFocus])

  useEffect(() => {
    consumePendingErrorFocus(Boolean(activeErrorMessage) && errorAttentionKey > 0)
  }, [activeErrorMessage, consumePendingErrorFocus, errorAttentionKey])

  useEffect(() => {
    if (!open || !bastion) {
      return
    }
    if (!targetLookupEnabled) {
      setTargetsLoading(false)
      return
    }

    const compartmentIds = getBastionTargetCompartmentIds(
      activeProfile,
      profilesConfig,
      computeCompartmentIds,
      bastionCompartmentIds,
      bastion.compartmentId,
      tenancyOcid,
    )
    if (compartmentIds.length === 0) {
      setAvailableTargets([])
      setTargetsLoading(false)
      setTargetsError("No profile compartments are available for target lookup.")
      return
    }

    let cancelled = false
    setTargetsLoading(true)
    setTargetsError(null)

    void ResourceServiceClient.listBastionTargetInstances({
      compartmentIds,
      region: bastion.region,
      vcnId: bastion.targetVcnId,
      lifecycleStates: ["RUNNING"],
    })
      .then((response) => {
        if (cancelled) {
          return
        }
        setAvailableTargets(response.instances ?? [])
      })
      .catch((err) => {
        if (cancelled) {
          return
        }
        setTargetsError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) {
          setTargetsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeProfile, bastion, bastionCompartmentIds, computeCompartmentIds, open, profilesConfig, targetLookupEnabled, targetsReloadKey, tenancyOcid])

  useEffect(() => {
    if (!open || useManualManagedTarget) {
      return
    }
    const preferredCompartmentId = getPreferredCompartmentId(targetCompartmentOptions, availableTargets, managedTargetCompartmentId)
    if (!preferredCompartmentId) {
      if (managedTargetCompartmentId) {
        setManagedTargetCompartmentId("")
      }
      return
    }
    if (!managedTargetCompartmentId || !targetCompartmentOptions.some((option) => option.value === managedTargetCompartmentId)) {
      setManagedTargetCompartmentId(preferredCompartmentId)
    }
  }, [availableTargets, managedTargetCompartmentId, open, targetCompartmentOptions, useManualManagedTarget])

  useEffect(() => {
    if (!open || useManualPortForwardTarget) {
      return
    }
    const preferredCompartmentId = getPreferredCompartmentId(targetCompartmentOptions, availableTargets, portForwardTargetCompartmentId)
    if (!preferredCompartmentId) {
      if (portForwardTargetCompartmentId) {
        setPortForwardTargetCompartmentId("")
      }
      return
    }
    if (!portForwardTargetCompartmentId || !targetCompartmentOptions.some((option) => option.value === portForwardTargetCompartmentId)) {
      setPortForwardTargetCompartmentId(preferredCompartmentId)
    }
  }, [availableTargets, open, portForwardTargetCompartmentId, targetCompartmentOptions, useManualPortForwardTarget])

  useEffect(() => {
    if (useManualManagedTarget || !managedTargetResourceId) {
      return
    }
    if (!filteredManagedTargets.some((instance) => instance.id === managedTargetResourceId)) {
      setManagedTargetResourceId("")
    }
  }, [filteredManagedTargets, managedTargetResourceId, useManualManagedTarget])

  useEffect(() => {
    if (useManualPortForwardTarget || !portForwardTargetResourceId) {
      return
    }
    if (!filteredPortForwardTargets.some((instance) => instance.id === portForwardTargetResourceId)) {
      setPortForwardTargetResourceId("")
    }
  }, [filteredPortForwardTargets, portForwardTargetResourceId, useManualPortForwardTarget])

  const isDialogPresentation = presentation === "dialog"

  if (!bastion || (isDialogPresentation && !open)) {
    return null
  }

  const handleFileUpload = () => {
    if (submitting) {
      return
    }

    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".pub"
    input.onchange = (event) => {
      const file = (event.target as HTMLInputElement).files?.[0]
      if (!file) {
        return
      }
      const reader = new FileReader()
      reader.onload = (loadEvent) => {
        const content = loadEvent.target?.result as string
        if (content) {
          clearSubmitError()
          setSshKeyMode("UPLOAD")
          setPublicKeyFileName(file.name)
          setPublicKey(content)
        }
      }
      reader.onerror = () => {
        focusErrorNotice()
        setSubmitError("Failed to read the selected public key file.")
      }
      reader.onabort = reader.onerror
      reader.readAsText(file)
    }
    input.click()
  }

  const handleSubmit = async () => {
    if (submitting) {
      return
    }

    setSubmitAttempted(true)
    clearSubmitError()

    const nextValidationIssue = getCreateSessionValidationIssue({
      sessionType,
      publicKey,
      sessionTtlInSeconds,
      resolvedManagedTargetId,
      osUserName,
      targetPort,
      portForwardTargetType,
      resolvedPortForwardTargetId,
      targetIp,
    })

    if (nextValidationIssue) {
      focusErrorNotice()
      return
    }

    const ttlValue = parseWholeNumber(sessionTtlInSeconds)
    const resolvedDisplayName = displayName.trim() || buildDefaultSessionName()
    const targetResourceDetails: Record<string, unknown> = { sessionType }

    if (sessionType === "MANAGED_SSH") {
      targetResourceDetails.targetResourceId = resolvedManagedTargetId
      targetResourceDetails.targetResourceOperatingSystemUserName = osUserName.trim()
    } else {
      const targetPortValue = parseWholeNumber(targetPort)
      if (portForwardTargetType === "COMPUTE_INSTANCE") {
        targetResourceDetails.targetResourceId = resolvedPortForwardTargetId
      } else {
        targetResourceDetails.targetResourcePrivateIpAddress = targetIp.trim()
      }
      targetResourceDetails.targetResourcePort = targetPortValue
    }

    setSubmitting(true)
    setSubmitError(null)
    try {
      await ResourceServiceClient.createBastionSession({
        bastionId: bastion.id,
        region: bastion.region,
        displayName: resolvedDisplayName,
        keyDetails: {
          publicKeyContent: publicKey.trim(),
        },
        targetResourceDetails,
        sessionTtlInSeconds: ttlValue,
      })
      onSuccess({
        bastionId: bastion.id,
        bastionName: bastion.name,
        sessionName: resolvedDisplayName,
        sessionType,
      })
    } catch (err) {
      focusErrorNotice()
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const managedCompartmentNote = targetsLoading
    ? "Loading compartments from running instances..."
    : targetCompartmentOptions.length === 0
      ? "No compute compartments are available for this Bastion scope."
      : ""
  const managedInstanceNote = managedTargetInvalid
    ? "Select a compute instance or switch to manual OCID entry."
    : targetsLoading
      ? "Loading running instances..."
      : managedInstanceOptions.length === 0
        ? "No running compute instances were found in the selected compartment."
        : "Select an instance by name."
  const portForwardInstanceNote = portForwardTargetInvalid
    ? "Select a compute instance or switch to manual OCID entry."
    : targetsLoading
      ? "Loading running instances..."
      : portForwardInstanceOptions.length === 0
        ? "No running compute instances were found in the selected compartment."
        : "Select an instance by name."

  const content = (
    <div
      className={clsx(
        "flex w-full flex-col overflow-hidden rounded-[4px] border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-shell)]",
        isDialogPresentation && "max-h-[90vh] max-w-[980px] shadow-2xl",
      )}
    >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--vscode-panel-border)] px-3 py-2.5">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--vscode-descriptionForeground)]">
              Bastion Session
            </div>
            <div className="mt-1 flex items-center gap-2 text-[var(--vscode-foreground)]">
              <Shield size={14} />
              <h3 className="truncate text-[13px] font-semibold">Create Bastion Session</h3>
            </div>
            <div className="mt-1 truncate text-[11px] text-[var(--vscode-descriptionForeground)]">
              {bastion.name} • {bastion.region || "default"}
            </div>
          </div>
          {isDialogPresentation ? (
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-[2px] p-1 text-[var(--vscode-icon-foreground)] transition-colors hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-[var(--vscode-foreground)] disabled:opacity-50"
            >
              <X size={16} />
            </button>
          ) : null}
        </div>

        <div className={clsx("px-3 py-3", isDialogPresentation && "min-h-0 overflow-y-auto")}>
          <div className="flex flex-col gap-2.5">
            {activeErrorMessage && (
              <div
                ref={errorNoticeRef}
                role="alert"
                className={clsx(
                  "rounded-md transition-all duration-500",
                  isErrorFlashing && "bg-[color-mix(in_srgb,var(--vscode-errorForeground)_10%,transparent)] ring-1 ring-[color-mix(in_srgb,var(--vscode-errorForeground)_40%,transparent)]",
                )}
              >
                <InlineNotice
                  tone="danger"
                  size="md"
                  icon={<AlertCircle size={14} />}
                  title={activeErrorTitle}
                  actions={<WorkbenchDismissButton onClick={dismissError} title="Dismiss" />}
                >
                  {activeErrorMessage}
                </InlineNotice>
              </div>
            )}

            <DialogSurface className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
              <SummaryCell label="Target VCN" value={bastion.targetVcnId || "-"} />
              <SummaryCell label="Target Subnet" value={bastion.targetSubnetId || "-"} />
              <SummaryCell label="DNS Proxy" value={bastion.dnsProxyStatus || "Unknown"} />
              <SummaryCell label="Client CIDRs" value={`${bastion.clientCidrBlockAllowList?.length ?? 0}`} />
            </DialogSurface>

            <DialogSection
              title="Session setup"
              subtitle="Choose the access mode first, then confirm the session name."
            >
              <div className="grid gap-2 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                <DialogSelectField
                  id="sessionType"
                  label="Session type"
                  value={sessionType}
                  disabled={submitting}
                  onChange={(event) => {
                    clearSubmitError()
                    setSessionType(event.target.value as "MANAGED_SSH" | "PORT_FORWARDING")
                  }}
                >
                  <option value="MANAGED_SSH">Managed SSH session</option>
                  <option value="PORT_FORWARDING">SSH port forwarding session</option>
                </DialogSelectField>

                <DialogTextField
                  id="displayName"
                  label="Session name"
                  placeholder="Session-20260312-1814"
                  value={displayName}
                  disabled={submitting}
                  onChange={(event) => {
                    clearSubmitError()
                    setDisplayName(event.target.value)
                  }}
                />
              </div>
            </DialogSection>

            <DialogSection
              title="Target details"
              subtitle={sessionType === "MANAGED_SSH"
                ? "Managed SSH uses the target compute instance and OS user."
                : "Port forwarding can target either a private IP or a compute instance."}
            >
              {sessionType === "MANAGED_SSH" ? (
                <>
                  {showTargetsError && (
                    <InlineNotice tone="warning" size="sm" icon={<AlertCircle size={14} />}>
                      {targetsError}
                    </InlineNotice>
                  )}

                  {useManualManagedTarget ? (
                    <div className="grid gap-2 lg:grid-cols-[minmax(0,180px)_minmax(0,1fr)]">
                      <DialogTextField
                        id="osUserName"
                        label="Username"
                        placeholder="opc"
                        value={osUserName}
                        disabled={submitting}
                        invalid={osUserNameInvalid}
                        note={osUserNameInvalid ? "Enter the OS user that should be used for the Managed SSH session." : "Required"}
                        noteTone={osUserNameInvalid ? "danger" : "muted"}
                        noteAlign="end"
                        onChange={(event) => {
                          clearSubmitError()
                          setOsUserName(event.target.value)
                        }}
                      />

                      <DialogTextField
                        id="managedTargetResourceIdManual"
                        label="Target compute instance OCID"
                        placeholder="ocid1.instance.oc1..."
                        value={managedManualTargetResourceId}
                        disabled={submitting}
                        invalid={managedTargetInvalid}
                        note={managedTargetInvalid ? "Enter the target compute instance OCID to continue." : "Use this only when the instance is not available in the dropdown."}
                        noteTone={managedTargetInvalid ? "danger" : "muted"}
                        onChange={(event) => {
                          clearSubmitError()
                          setManagedManualTargetResourceId(event.target.value)
                        }}
                      />
                    </div>
                  ) : (
                    <div className="grid gap-2 lg:grid-cols-[minmax(0,180px)_minmax(0,1fr)_minmax(0,1fr)]">
                      <DialogTextField
                        id="osUserName"
                        label="Username"
                        placeholder="opc"
                        value={osUserName}
                        disabled={submitting}
                        invalid={osUserNameInvalid}
                        note={osUserNameInvalid ? "Enter the OS user that should be used for the Managed SSH session." : "Required"}
                        noteTone={osUserNameInvalid ? "danger" : "muted"}
                        noteAlign="end"
                        onChange={(event) => {
                          clearSubmitError()
                          setOsUserName(event.target.value)
                        }}
                      />

                      <DialogSelectField
                        id="managedTargetCompartmentId"
                        label="Compute instance compartment"
                        value={managedTargetCompartmentId}
                        disabled={submitting || targetCompartmentOptions.length === 0}
                        note={managedCompartmentNote}
                        onChange={(event) => {
                          clearSubmitError()
                          setManagedTargetCompartmentId(event.target.value)
                          setManagedTargetResourceId("")
                        }}
                      >
                        {targetCompartmentOptions.length === 0 ? (
                          <option value="">No compartment available</option>
                        ) : (
                          targetCompartmentOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))
                        )}
                      </DialogSelectField>

                      <DialogSelectField
                        id="managedTargetResourceId"
                        label="Compute instance"
                        value={managedTargetResourceId}
                        disabled={submitting || managedInstanceOptions.length === 0}
                        invalid={managedTargetInvalid}
                        note={managedInstanceNote}
                        noteTone={managedTargetInvalid ? "danger" : "muted"}
                        onChange={(event) => {
                          clearSubmitError()
                          setManagedTargetResourceId(event.target.value)
                        }}
                      >
                        <option value="">{targetsLoading ? "Loading instances..." : "Select an instance"}</option>
                        {managedInstanceOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </DialogSelectField>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-[var(--vscode-panel-border)] pt-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="h-6 px-2 text-[11px]"
                      disabled={submitting}
                      onClick={() => {
                        clearSubmitError()
                        setUseManualManagedTarget((current) => !current)
                        setManagedTargetResourceId("")
                      }}
                    >
                      {useManualManagedTarget ? "Use compute instance list" : "Enter OCID manually"}
                    </Button>
                    {!useManualManagedTarget && (
                      <WorkbenchRefreshButton
                        onClick={() => setTargetsReloadKey((current) => current + 1)}
                        disabled={submitting || !targetLookupEnabled}
                        spinning={targetsLoading}
                        title="Refresh target instances"
                      />
                    )}
                  </div>

                  {selectedManagedTarget && !useManualManagedTarget && (
                    <SelectedTargetSummary target={selectedManagedTarget} />
                  )}
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-1">
                    <div className="text-[11px] font-medium text-[var(--vscode-descriptionForeground)]">
                      Connect to the target host by using:
                    </div>
                    <div className="grid gap-1.5 md:grid-cols-2">
                      <DialogRadioOption
                        name="portForwardTargetType"
                        checked={portForwardTargetType === "PRIVATE_IP"}
                        disabled={submitting}
                        onChange={() => {
                          clearSubmitError()
                          setPortForwardTargetType("PRIVATE_IP")
                        }}
                      >
                        IP address
                      </DialogRadioOption>
                      <DialogRadioOption
                        name="portForwardTargetType"
                        checked={portForwardTargetType === "COMPUTE_INSTANCE"}
                        disabled={submitting}
                        onChange={() => {
                          clearSubmitError()
                          setPortForwardTargetType("COMPUTE_INSTANCE")
                        }}
                      >
                        Instance name
                      </DialogRadioOption>
                    </div>
                  </div>

                  {portForwardTargetType === "PRIVATE_IP" ? (
                    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_140px]">
                      <DialogTextField
                        id="targetIp"
                        label="IP address"
                        placeholder="10.0.0.25"
                        value={targetIp}
                        disabled={submitting}
                        invalid={targetIpInvalid}
                        note={targetIpInvalid ? "Enter a valid IPv4 address." : "Required"}
                        noteTone={targetIpInvalid ? "danger" : "muted"}
                        noteAlign="end"
                        onChange={(event) => {
                          clearSubmitError()
                          setTargetIp(event.target.value)
                        }}
                      />
                      <DialogTextField
                        id="targetPort"
                        label="Port"
                        placeholder="22"
                        type="number"
                        value={targetPort}
                        disabled={submitting}
                        invalid={targetPortInvalid}
                        note={targetPortInvalid ? `Enter a whole port number between 1 and ${MAX_PORT_NUMBER}.` : ""}
                        noteTone="danger"
                        onChange={(event) => {
                          clearSubmitError()
                          setTargetPort(event.target.value)
                        }}
                      />
                    </div>
                  ) : (
                    <>
                      {showTargetsError && (
                        <InlineNotice tone="warning" size="sm" icon={<AlertCircle size={14} />}>
                          {targetsError}
                        </InlineNotice>
                      )}

                      {useManualPortForwardTarget ? (
                        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_140px]">
                          <DialogTextField
                            id="portForwardTargetResourceIdManual"
                            label="Target compute instance OCID"
                            placeholder="ocid1.instance.oc1..."
                            value={portForwardManualTargetResourceId}
                            disabled={submitting}
                            invalid={portForwardTargetInvalid}
                            note={portForwardTargetInvalid ? "Enter the target compute instance OCID to continue." : "Use this only when the instance is not available in the dropdown."}
                            noteTone={portForwardTargetInvalid ? "danger" : "muted"}
                            onChange={(event) => {
                              clearSubmitError()
                              setPortForwardManualTargetResourceId(event.target.value)
                            }}
                          />

                          <DialogTextField
                            id="targetPort"
                            label="Port"
                            placeholder="22"
                            type="number"
                            value={targetPort}
                            disabled={submitting}
                            invalid={targetPortInvalid}
                            note={targetPortInvalid ? `Enter a whole port number between 1 and ${MAX_PORT_NUMBER}.` : ""}
                            noteTone="danger"
                            onChange={(event) => {
                              clearSubmitError()
                              setTargetPort(event.target.value)
                            }}
                          />
                        </div>
                      ) : (
                        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px]">
                          <DialogSelectField
                            id="portForwardTargetCompartmentId"
                            label="Compute instance compartment"
                            value={portForwardTargetCompartmentId}
                            disabled={submitting || targetCompartmentOptions.length === 0}
                            note={targetCompartmentOptions.length === 0 ? "No compute compartments are available for this Bastion scope." : ""}
                            onChange={(event) => {
                              clearSubmitError()
                              setPortForwardTargetCompartmentId(event.target.value)
                              setPortForwardTargetResourceId("")
                            }}
                          >
                            {targetCompartmentOptions.length === 0 ? (
                              <option value="">No compartment available</option>
                            ) : (
                              targetCompartmentOptions.map((option) => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                              ))
                            )}
                          </DialogSelectField>

                          <DialogSelectField
                            id="portForwardTargetResourceId"
                            label="Compute instance"
                            value={portForwardTargetResourceId}
                            disabled={submitting || portForwardInstanceOptions.length === 0}
                            invalid={portForwardTargetInvalid}
                            note={portForwardInstanceNote}
                            noteTone={portForwardTargetInvalid ? "danger" : "muted"}
                            onChange={(event) => {
                              clearSubmitError()
                              setPortForwardTargetResourceId(event.target.value)
                            }}
                          >
                            <option value="">{targetsLoading ? "Loading instances..." : "Select an instance"}</option>
                            {portForwardInstanceOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </DialogSelectField>

                          <DialogTextField
                            id="targetPort"
                            label="Port"
                            placeholder="22"
                            type="number"
                            value={targetPort}
                            disabled={submitting}
                            invalid={targetPortInvalid}
                            note={targetPortInvalid ? `Enter a whole port number between 1 and ${MAX_PORT_NUMBER}.` : ""}
                            noteTone="danger"
                            onChange={(event) => {
                              clearSubmitError()
                              setTargetPort(event.target.value)
                            }}
                          />
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-[var(--vscode-panel-border)] pt-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          disabled={submitting}
                          onClick={() => {
                            clearSubmitError()
                            setUseManualPortForwardTarget((current) => !current)
                            setPortForwardTargetResourceId("")
                          }}
                        >
                          {useManualPortForwardTarget ? "Use compute instance list" : "Enter OCID manually"}
                        </Button>
                        {!useManualPortForwardTarget && (
                          <WorkbenchRefreshButton
                            onClick={() => setTargetsReloadKey((current) => current + 1)}
                            disabled={submitting || !targetLookupEnabled}
                            spinning={targetsLoading}
                            title="Refresh target instances"
                          />
                        )}
                      </div>

                      {selectedPortForwardTarget && !useManualPortForwardTarget && (
                        <SelectedTargetSummary target={selectedPortForwardTarget} />
                      )}
                    </>
                  )}
                </>
              )}
            </DialogSection>

            <DialogSection
              title="SSH key"
              subtitle="Use an existing public key file or paste the public key directly."
            >
              <div className="grid gap-1.5 md:grid-cols-2">
                <DialogRadioOption
                  name="sshKeyMode"
                  checked={sshKeyMode === "UPLOAD"}
                  disabled={submitting}
                  onChange={() => setSshKeyMode("UPLOAD")}
                >
                  Choose SSH key file
                </DialogRadioOption>
                <DialogRadioOption
                  name="sshKeyMode"
                  checked={sshKeyMode === "PASTE"}
                  disabled={submitting}
                  onChange={() => setSshKeyMode("PASTE")}
                >
                  Paste SSH key
                </DialogRadioOption>
              </div>

              {sshKeyMode === "UPLOAD" ? (
                <DialogSurface
                  className={clsx(
                    "flex flex-col gap-2 border",
                    publicKeyInvalid && "border-[color-mix(in_srgb,var(--vscode-errorForeground)_65%,var(--vscode-panel-border)_35%)]",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium text-[var(--vscode-foreground)]">
                        {publicKeyFileName || "Choose an existing public key file"}
                      </div>
                      <div className="mt-0.5 text-[10px] leading-4 text-[var(--vscode-descriptionForeground)]">
                        Upload a `.pub` file from your workstation.
                      </div>
                    </div>
                    <Button type="button" variant="secondary" size="sm" onClick={handleFileUpload} disabled={submitting}>
                      <Upload size={12} className="mr-1.5" />
                      Choose File
                    </Button>
                  </div>
                  {publicKey.trim() && (
                    <div className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-2.5 py-2 text-[10px] leading-5 text-[var(--vscode-descriptionForeground)]">
                      <div className="font-medium text-[var(--vscode-foreground)]">Loaded public key</div>
                      <div className="mt-1 break-all">{truncateMiddle(publicKey.trim(), 180)}</div>
                    </div>
                  )}
                  {publicKeyInvalid && (
                    <div className="text-[10px] text-[var(--vscode-errorForeground)]">
                      Choose a public key file before creating the session.
                    </div>
                  )}
                </DialogSurface>
              ) : (
                <DialogTextAreaField
                  id="publicKey"
                  label="SSH public key"
                  placeholder="ssh-rsa AAAAB3NzaC1..."
                  value={publicKey}
                  disabled={submitting}
                  invalid={publicKeyInvalid}
                  note={publicKeyInvalid
                    ? "Paste a public key before creating the session."
                    : "Paste the public key directly from your workstation."}
                  noteTone={publicKeyInvalid ? "danger" : "muted"}
                  onChange={(event) => {
                    clearSubmitError()
                    setPublicKeyFileName("")
                    setPublicKey(event.target.value)
                  }}
                />
              )}
            </DialogSection>

            <details className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2 text-[12px] font-semibold text-[var(--vscode-foreground)]">
                <span>Advanced options</span>
                <ChevronDown size={14} className="text-[var(--vscode-icon-foreground)]" />
              </summary>
              <div className="grid gap-2 border-t border-[var(--vscode-panel-border)] p-3 md:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                <DialogTextField
                  id="sessionTtlInSeconds"
                  label="Session TTL (seconds)"
                  placeholder="10800"
                  type="number"
                  value={sessionTtlInSeconds}
                  disabled={submitting}
                  invalid={sessionTtlInvalid}
                  note={sessionTtlInvalid ? "Enter a positive whole number of seconds." : "Default is 10800 seconds (3 hours)."}
                  noteTone={sessionTtlInvalid ? "danger" : "muted"}
                  onChange={(event) => {
                    clearSubmitError()
                    setSessionTtlInSeconds(event.target.value)
                  }}
                />

                <DialogSurface className="text-[11px] leading-5 text-[var(--vscode-descriptionForeground)]">
                  Use shorter lifetimes for ephemeral debugging access. The current default is 10800 seconds, which equals 3 hours.
                </DialogSurface>
              </div>
            </details>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_95%,white_5%)] px-3 py-2.5">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            {isDialogPresentation ? "Cancel" : "Back to Bastions"}
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Creating...</span>
            ) : "Create Session"}
          </Button>
        </div>
      </div>
  )

  if (!isDialogPresentation) {
    return content
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 px-3 py-4 font-sans text-[var(--vscode-foreground)]">
      {content}
    </div>
  )
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--vscode-descriptionForeground)]">{label}</div>
      <div className="mt-1 truncate text-[12px] font-medium text-[var(--vscode-foreground)]" title={value}>
        {value}
      </div>
    </div>
  )
}

function DialogSection({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <section className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)]">
      <div className="border-b border-[var(--vscode-panel-border)] px-3 py-2">
        <div className="text-[12px] font-semibold text-[var(--vscode-foreground)]">{title}</div>
        {subtitle ? (
          <div className="mt-0.5 text-[11px] leading-5 text-[var(--vscode-descriptionForeground)]">
            {subtitle}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 p-3">{children}</div>
    </section>
  )
}

function DialogSurface({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div className={clsx("rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface-subtle)] px-2.5 py-2", className)}>
      {children}
    </div>
  )
}

function SelectedTargetSummary({ target }: { target: ComputeResource }) {
  return (
    <DialogSurface className="text-[11px] text-[var(--vscode-descriptionForeground)]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--vscode-descriptionForeground)]">
        Selected target
      </div>
      <div className="mt-1 text-[12px] font-medium text-[var(--vscode-foreground)]">
        {target.name}
        {target.privateIp ? ` • ${target.privateIp}` : ""}
      </div>
      <div className="mt-1 break-all text-[10px] leading-5">{target.id}</div>
    </DialogSurface>
  )
}

function DialogFieldFrame({
  label,
  invalid = false,
  disabled = false,
  children,
}: {
  label: string
  invalid?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={clsx(
        "flex min-h-[56px] w-full flex-col rounded-[2px] border bg-[var(--vscode-input-background)] px-2.5 py-2 transition-colors",
        invalid
          ? "border-[color-mix(in_srgb,var(--vscode-errorForeground)_65%,var(--vscode-panel-border)_35%)] bg-[color-mix(in_srgb,var(--vscode-errorForeground)_6%,var(--vscode-input-background)_94%)]"
          : "border-[var(--vscode-panel-border)] focus-within:border-[var(--vscode-focusBorder)]",
        disabled && "opacity-60",
      )}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--vscode-descriptionForeground)]">{label}</div>
      {children}
    </div>
  )
}

function DialogTextField({
  label,
  invalid = false,
  note,
  noteTone = "muted",
  noteAlign = "start",
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string
  invalid?: boolean
  note?: string
  noteTone?: "muted" | "danger"
  noteAlign?: "start" | "end"
}) {
  return (
    <div className={clsx("w-full", className)}>
      <DialogFieldFrame label={label} invalid={invalid} disabled={Boolean(props.disabled)}>
        <input
          {...props}
          className="mt-1 w-full border-0 bg-transparent p-0 text-[13px] leading-5 text-[var(--vscode-foreground)] outline-none placeholder:text-[var(--vscode-input-placeholderForeground)]"
        />
      </DialogFieldFrame>
      {note ? (
        <div
          className={clsx(
            "mt-1 px-0.5 text-[10px] leading-4",
            noteTone === "danger" ? "text-[var(--vscode-errorForeground)]" : "text-[var(--vscode-descriptionForeground)]",
            noteAlign === "end" ? "text-right" : "text-left",
          )}
        >
          {note}
        </div>
      ) : null}
    </div>
  )
}

function DialogTextAreaField({
  label,
  invalid = false,
  note,
  noteTone = "muted",
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string
  invalid?: boolean
  note?: string
  noteTone?: "muted" | "danger"
}) {
  return (
    <div className={clsx("w-full", className)}>
      <DialogFieldFrame label={label} invalid={invalid} disabled={Boolean(props.disabled)}>
        <textarea
          {...props}
          className="mt-1.5 min-h-[120px] w-full resize-y border-0 bg-transparent p-0 text-[12px] leading-5 text-[var(--vscode-foreground)] outline-none placeholder:text-[var(--vscode-input-placeholderForeground)]"
        />
      </DialogFieldFrame>
      {note ? (
        <div className={clsx("mt-1 px-0.5 text-[10px] leading-4", noteTone === "danger" ? "text-[var(--vscode-errorForeground)]" : "text-[var(--vscode-descriptionForeground)]")}>
          {note}
        </div>
      ) : null}
    </div>
  )
}

function DialogSelectField({
  label,
  invalid = false,
  note,
  noteTone = "muted",
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string
  invalid?: boolean
  note?: string
  noteTone?: "muted" | "danger"
  children: ReactNode
}) {
  return (
    <div className={clsx("w-full", className)}>
      <DialogFieldFrame label={label} invalid={invalid} disabled={Boolean(props.disabled)}>
        <div className="relative mt-1">
          <select
            {...props}
            className="w-full appearance-none border-0 bg-transparent p-0 pr-6 text-[13px] leading-5 text-[var(--vscode-foreground)] outline-none"
          >
            {children}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 text-[var(--vscode-icon-foreground)]" />
        </div>
      </DialogFieldFrame>
      {note ? (
        <div className={clsx("mt-1 px-0.5 text-[10px] leading-4", noteTone === "danger" ? "text-[var(--vscode-errorForeground)]" : "text-[var(--vscode-descriptionForeground)]")}>
          {note}
        </div>
      ) : null}
    </div>
  )
}

function DialogRadioOption({
  name,
  checked,
  onChange,
  disabled = false,
  helperText,
  children,
}: {
  name: string
  checked: boolean
  onChange: () => void
  disabled?: boolean
  helperText?: string
  children: ReactNode
}) {
  return (
    <label
      className={clsx(
        "flex min-w-0 items-start gap-2 rounded-[2px] border px-2.5 py-2 transition-colors",
        checked
          ? "border-[var(--vscode-focusBorder)] bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]"
          : "border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] text-[var(--vscode-foreground)]",
        disabled
          ? checked
            ? "cursor-not-allowed opacity-70"
            : "cursor-not-allowed border-dashed text-[var(--vscode-disabledForeground)]"
          : "cursor-pointer hover:bg-[var(--vscode-list-hoverBackground)]",
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--vscode-focusBorder)]"
      />
      <span className="min-w-0">
        <span className="block text-[12px] font-medium leading-5">{children}</span>
        {helperText ? (
          <span
            className={clsx(
              "mt-0.5 block text-[10px] leading-4 opacity-80",
              checked && !disabled ? "text-[inherit]" : "text-[var(--vscode-descriptionForeground)]",
              disabled && "text-[var(--vscode-disabledForeground)]",
            )}
          >
            {helperText}
          </span>
        ) : null}
      </span>
    </label>
  )
}

function parseWholeNumber(value: string) {
  return Number(value.trim())
}

function isWholeNumberInRange(value: string, { min = 1, max }: { min?: number; max?: number } = {}) {
  const normalized = value.trim()
  if (!/^\d+$/.test(normalized)) {
    return false
  }
  const parsed = parseWholeNumber(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    return false
  }
  if (typeof max === "number" && parsed > max) {
    return false
  }
  return true
}

function isValidIpv4Address(value: string) {
  const octets = value.split(".")
  if (octets.length !== 4) {
    return false
  }
  return octets.every((octet) => /^\d+$/.test(octet) && Number(octet) >= 0 && Number(octet) <= 255)
}

function filterTargetsByCompartment(targets: ComputeResource[], compartmentId: string) {
  const normalizedCompartmentId = normalizeResourceId(compartmentId)
  if (!normalizedCompartmentId) {
    return targets
  }
  return targets.filter((target) => normalizeResourceId(target.compartmentId) === normalizedCompartmentId)
}

function getPreferredCompartmentId(
  options: Array<{ value: string; label: string }>,
  targets: ComputeResource[],
  currentValue: string,
) {
  const normalizedCurrentValue = normalizeResourceId(currentValue)
  if (normalizedCurrentValue && options.some((option) => option.value === normalizedCurrentValue)) {
    return normalizedCurrentValue
  }

  const optionWithTargets = options.find((option) =>
    targets.some((target) => normalizeResourceId(target.compartmentId) === option.value))
  return optionWithTargets?.value ?? options[0]?.value ?? ""
}

function getCreateSessionValidationIssue({
  sessionType,
  publicKey,
  sessionTtlInSeconds,
  resolvedManagedTargetId,
  osUserName,
  targetPort,
  portForwardTargetType,
  resolvedPortForwardTargetId,
  targetIp,
}: {
  sessionType: "MANAGED_SSH" | "PORT_FORWARDING"
  publicKey: string
  sessionTtlInSeconds: string
  resolvedManagedTargetId: string
  osUserName: string
  targetPort: string
  portForwardTargetType: PortForwardTargetType
  resolvedPortForwardTargetId: string
  targetIp: string
}): { field: SessionValidationField; message: string } | null {
  if (!publicKey.trim()) {
    return {
      field: "publicKey",
      message: "Add an SSH public key before creating the session.",
    }
  }

  if (!isWholeNumberInRange(sessionTtlInSeconds, { min: 1 })) {
    return {
      field: "sessionTtlInSeconds",
      message: "Session TTL must be a positive whole number of seconds.",
    }
  }

  if (sessionType === "MANAGED_SSH") {
    if (!resolvedManagedTargetId) {
      return {
        field: "managedTargetResourceId",
        message: "Select a target compute instance or enter its OCID for Managed SSH.",
      }
    }
    if (!osUserName.trim()) {
      return {
        field: "osUserName",
        message: "OS user name is required for Managed SSH.",
      }
    }
    return null
  }

  if (!isWholeNumberInRange(targetPort, { min: 1, max: MAX_PORT_NUMBER })) {
    return {
      field: "targetPort",
      message: `Enter a whole target port between 1 and ${MAX_PORT_NUMBER} for Port Forwarding.`,
    }
  }

  if (portForwardTargetType === "COMPUTE_INSTANCE") {
    if (!resolvedPortForwardTargetId) {
      return {
        field: "portForwardTargetResourceId",
        message: "Select a target compute instance or enter its OCID for Port Forwarding.",
      }
    }
    return null
  }

  if (!targetIp.trim()) {
    return {
      field: "targetIp",
      message: "Target private IP is required for Port Forwarding.",
    }
  }
  if (!isValidIpv4Address(targetIp.trim())) {
    return {
      field: "targetIp",
      message: "Target private IP must be a valid IPv4 address.",
    }
  }

  return null
}

function getBastionTargetCompartmentOptions(
  activeProfile: string,
  profilesConfig: Array<{ name: string; compartments: Array<{ id: string; name: string }> }>,
  computeCompartmentIds: string[],
  bastionCompartmentIds: string[],
  bastionCompartmentId: string | undefined,
  tenancyOcid: string | undefined,
  availableTargets: ComputeResource[],
) {
  const activeProfileConfig = profilesConfig.find((profile) => profile.name === activeProfile)
  const ids = getBastionTargetCompartmentIds(
    activeProfile,
    profilesConfig,
    computeCompartmentIds,
    bastionCompartmentIds,
    bastionCompartmentId,
    tenancyOcid,
  )

  const labelsById = new Map<string, string>()
  const normalizedTenancyId = normalizeResourceId(tenancyOcid)
  if (normalizedTenancyId) {
    labelsById.set(normalizedTenancyId, "Root (Tenancy)")
  }
  for (const compartment of activeProfileConfig?.compartments ?? []) {
    const normalizedId = normalizeResourceId(compartment.id)
    if (!normalizedId) {
      continue
    }
    labelsById.set(normalizedId, compartment.name || normalizedId)
  }

  const seen = new Set<string>()
  const options: Array<{ value: string; label: string }> = []
  const addOption = (value?: string) => {
    const normalizedValue = normalizeResourceId(value)
    if (!normalizedValue || seen.has(normalizedValue)) {
      return
    }
    seen.add(normalizedValue)
    options.push({
      value: normalizedValue,
      label: labelsById.get(normalizedValue)
        ?? (normalizedValue === normalizeResourceId(bastionCompartmentId) ? "Bastion compartment" : truncateMiddle(normalizedValue, 36)),
    })
  }

  for (const id of ids) {
    addOption(id)
  }
  for (const target of availableTargets) {
    addOption(target.compartmentId)
  }

  return options
}

function getBastionTargetCompartmentIds(
  activeProfile: string,
  profilesConfig: Array<{ name: string; compartments: Array<{ id: string; name: string }> }>,
  computeCompartmentIds: string[],
  bastionCompartmentIds: string[],
  bastionCompartmentId?: string,
  tenancyOcid?: string,
) {
  const activeProfileConfig = profilesConfig.find((profile) => profile.name === activeProfile)
  const seen = new Set<string>()
  const ids: string[] = []
  const addId = (value?: string) => {
    const normalized = normalizeResourceId(value)
    if (!normalized || seen.has(normalized)) {
      return
    }
    seen.add(normalized)
    ids.push(normalized)
  }

  for (const compartmentId of computeCompartmentIds) {
    addId(compartmentId)
  }
  for (const compartmentId of bastionCompartmentIds) {
    addId(compartmentId)
  }
  addId(bastionCompartmentId)

  if (ids.length === 0) {
    for (const compartment of activeProfileConfig?.compartments ?? []) {
      addId(compartment.id)
    }
  }

  if (ids.length === 0) {
    addId(tenancyOcid)
  }

  return ids
}

function buildDefaultSessionName(date = new Date()) {
  const year = String(date.getFullYear())
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  return `Session-${year}${month}${day}-${hours}${minutes}`
}

function normalizeResourceId(value: string | undefined) {
  return String(value ?? "").trim()
}

function truncateMiddle(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }
  const keep = Math.max(8, Math.floor((maxLength - 3) / 2))
  return `${value.slice(0, keep)}...${value.slice(-keep)}`
}
