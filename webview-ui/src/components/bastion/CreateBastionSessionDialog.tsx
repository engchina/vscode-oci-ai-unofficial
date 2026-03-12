import { clsx } from "clsx"
import { AlertCircle, Loader2, Shield, Upload, X } from "lucide-react"
import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { useScrollFlashTarget } from "../../hooks/useScrollFlashTarget"
import { ResourceServiceClient } from "../../services/grpc-client"
import type { BastionResource, ComputeResource } from "../../services/types"
import Button from "../ui/Button"
import InlineNotice from "../ui/InlineNotice"
import Input from "../ui/Input"
import Textarea from "../ui/Textarea"
import Select from "../ui/Select"
import ResourceDropdown from "../ui/ResourceDropdown"
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

  const handleFileDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (submitting) {
      return
    }
    const file = event.dataTransfer.files?.[0]
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
      setSubmitError("Failed to read the dropped public key file.")
    }
    reader.onabort = reader.onerror
    reader.readAsText(file)
  }

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
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

  const portForwardCompartmentNote = targetsLoading
    ? "Loading compartments from running instances..."
    : targetCompartmentOptions.length === 0
      ? "No compute compartments are available for this Bastion scope."
      : ""

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
                <Select
                  id="sessionType"
                  label="Session type"
                  value={sessionType}
                  disabled={submitting}
                  onChange={(event) => {
                    clearSubmitError()
                    setSessionType(event.target.value as "MANAGED_SSH" | "PORT_FORWARDING")
                  }}
                  options={[
                    { value: "MANAGED_SSH", label: "Managed SSH session" },
                    { value: "PORT_FORWARDING", label: "SSH port forwarding session" },
                  ]}
                />

                <Input
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
                      <div className="flex flex-col gap-1">
                        <Input
                          id="osUserName"
                          label="Username"
                          placeholder="opc"
                          value={osUserName}
                          disabled={submitting}
                          onChange={(event) => {
                            clearSubmitError()
                            setOsUserName(event.target.value)
                          }}
                        />
                        <div className={clsx("text-[10px]", osUserNameInvalid ? "text-[var(--vscode-errorForeground)]" : "text-[var(--vscode-descriptionForeground)]")}>
                          {osUserNameInvalid ? "Enter the OS user that should be used for the Managed SSH session." : "Required"}
                        </div>
                      </div>

                      <div className="flex flex-col gap-1">
                        <Input
                          id="managedTargetResourceIdManual"
                          label="Target compute instance OCID"
                          placeholder="ocid1.instance.oc1..."
                          value={managedManualTargetResourceId}
                          disabled={submitting}
                          onChange={(event) => {
                            clearSubmitError()
                            setManagedManualTargetResourceId(event.target.value)
                          }}
                        />
                        <div className={clsx("text-[10px]", managedTargetInvalid ? "text-[var(--vscode-errorForeground)]" : "text-[var(--vscode-descriptionForeground)]")}>
                          {managedTargetInvalid ? "Enter the target compute instance OCID to continue." : "Use this only when the instance is not available in the dropdown."}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-2 lg:grid-cols-[minmax(0,180px)_minmax(0,1fr)_minmax(0,1fr)]">
                      <div className="flex flex-col gap-1">
                        <Input
                          id="osUserName"
                          label="Username"
                          placeholder="opc"
                          value={osUserName}
                          disabled={submitting}
                          onChange={(event) => {
                            clearSubmitError()
                            setOsUserName(event.target.value)
                          }}
                        />
                        <div className={clsx("text-[10px]", osUserNameInvalid ? "text-[var(--vscode-errorForeground)]" : "text-[var(--vscode-descriptionForeground)]")}>
                          {osUserNameInvalid ? "Enter the OS user that should be used for the Managed SSH session." : "Required"}
                        </div>
                      </div>

                      <div className="flex flex-col gap-1">
                        <ResourceDropdown
                          id="managedTargetCompartmentId"
                          label="Compute instance compartment"
                          value={managedTargetCompartmentId}
                          disabled={submitting || targetCompartmentOptions.length === 0}
                          placeholder="Select compartment"
                          options={targetCompartmentOptions.map((opt) => ({ value: opt.value, label: opt.label }))}
                          onChange={(value) => {
                            clearSubmitError()
                            setManagedTargetCompartmentId(value)
                            setManagedTargetResourceId("")
                          }}
                        />
                        {managedCompartmentNote && (
                          <div className="text-[10px] text-[var(--vscode-descriptionForeground)]">{managedCompartmentNote}</div>
                        )}
                      </div>

                      <div className="flex flex-col gap-1">
                        <ResourceDropdown
                          id="managedTargetResourceId"
                          label="Compute instance"
                          value={managedTargetResourceId}
                          disabled={submitting || managedInstanceOptions.length === 0}
                          invalid={managedTargetInvalid}
                          loading={targetsLoading}
                          placeholder={targetsLoading ? "Loading instances..." : "Select an instance"}
                          options={managedInstanceOptions.map((opt) => ({ value: opt.value, label: opt.label }))}
                          onChange={(value) => {
                            clearSubmitError()
                            setManagedTargetResourceId(value)
                          }}
                        />
                        <div className={clsx("text-[10px]", managedTargetInvalid ? "text-[var(--vscode-errorForeground)]" : "text-[var(--vscode-descriptionForeground)]")}>
                          {managedInstanceNote}
                        </div>
                      </div>
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
                      <label className="flex items-center gap-2 text-[12px] text-foreground">
                        <input
                          type="radio"
                          name="portForwardTargetType"
                          checked={portForwardTargetType === "PRIVATE_IP"}
                          disabled={submitting}
                          className="accent-[var(--vscode-focusBorder)]"
                          onChange={() => {
                            clearSubmitError()
                            setPortForwardTargetType("PRIVATE_IP")
                          }}
                        />
                        IP address
                      </label>
                      <label className="flex items-center gap-2 text-[12px] text-foreground">
                        <input
                          type="radio"
                          name="portForwardTargetType"
                          checked={portForwardTargetType === "COMPUTE_INSTANCE"}
                          disabled={submitting}
                          className="accent-[var(--vscode-focusBorder)]"
                          onChange={() => {
                            clearSubmitError()
                            setPortForwardTargetType("COMPUTE_INSTANCE")
                          }}
                        />
                        Instance name
                      </label>
                    </div>
                  </div>

                  {portForwardTargetType === "PRIVATE_IP" ? (
                    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_140px]">
                      <div className="flex flex-col gap-1">
                        <Input
                          id="targetIp"
                          label="IP address"
                          placeholder="10.0.0.25"
                          value={targetIp}
                          disabled={submitting}
                          onChange={(event) => {
                            clearSubmitError()
                            setTargetIp(event.target.value)
                          }}
                        />
                        <div className={clsx("text-[10px]", targetIpInvalid ? "text-[var(--vscode-errorForeground)]" : "text-[var(--vscode-descriptionForeground)]")}>
                          {targetIpInvalid ? "Enter a valid IPv4 address." : "Required"}
                        </div>
                      </div>
                      <div className="flex flex-col gap-1">
                        <Input
                          id="targetPort"
                          label="Port"
                          placeholder="22"
                          type="number"
                          value={targetPort}
                          disabled={submitting}
                          onChange={(event) => {
                            clearSubmitError()
                            setTargetPort(event.target.value)
                          }}
                        />
                        {targetPortInvalid && (
                          <div className="text-[10px] text-[var(--vscode-errorForeground)]">
                            Enter a whole port number between 1 and {MAX_PORT_NUMBER}.
                          </div>
                        )}
                      </div>
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
                          <div className="flex flex-col gap-1">
                            <Input
                              id="portForwardTargetResourceIdManual"
                              label="Target compute instance OCID"
                              placeholder="ocid1.instance.oc1..."
                              value={portForwardManualTargetResourceId}
                              disabled={submitting}
                              onChange={(event) => {
                                clearSubmitError()
                                setPortForwardManualTargetResourceId(event.target.value)
                              }}
                            />
                            <div className={clsx("text-[10px]", portForwardTargetInvalid ? "text-[var(--vscode-errorForeground)]" : "text-[var(--vscode-descriptionForeground)]")}>
                              {portForwardTargetInvalid ? "Enter the target compute instance OCID to continue." : "Use this only when the instance is not available in the dropdown."}
                            </div>
                          </div>

                          <div className="flex flex-col gap-1">
                            <Input
                              id="targetPort"
                              label="Port"
                              placeholder="22"
                              type="number"
                              value={targetPort}
                              disabled={submitting}
                              onChange={(event) => {
                                clearSubmitError()
                                setTargetPort(event.target.value)
                              }}
                            />
                            {targetPortInvalid && (
                              <div className="text-[10px] text-[var(--vscode-errorForeground)]">
                                Enter a whole port number between 1 and {MAX_PORT_NUMBER}.
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px]">
                          <div className="flex flex-col gap-1">
                            <ResourceDropdown
                              id="portForwardTargetCompartmentId"
                              label="Compute instance compartment"
                              value={portForwardTargetCompartmentId}
                              disabled={submitting || targetCompartmentOptions.length === 0}
                              placeholder="Select compartment"
                              options={targetCompartmentOptions.map((opt) => ({ value: opt.value, label: opt.label }))}
                              onChange={(value) => {
                                clearSubmitError()
                                setPortForwardTargetCompartmentId(value)
                                setPortForwardTargetResourceId("")
                              }}
                            />
                            {portForwardCompartmentNote && (
                              <div className="text-[10px] text-[var(--vscode-descriptionForeground)]">{portForwardCompartmentNote}</div>
                            )}
                          </div>

                          <div className="flex flex-col gap-1">
                            <ResourceDropdown
                              id="portForwardTargetResourceId"
                              label="Compute instance"
                              value={portForwardTargetResourceId}
                              disabled={submitting || portForwardInstanceOptions.length === 0}
                              invalid={portForwardTargetInvalid}
                              loading={targetsLoading}
                              placeholder={targetsLoading ? "Loading instances..." : "Select an instance"}
                              options={portForwardInstanceOptions.map((opt) => ({ value: opt.value, label: opt.label }))}
                              onChange={(value) => {
                                clearSubmitError()
                                setPortForwardTargetResourceId(value)
                              }}
                            />
                            <div className={clsx("text-[10px]", portForwardTargetInvalid ? "text-[var(--vscode-errorForeground)]" : "text-[var(--vscode-descriptionForeground)]")}>
                              {portForwardInstanceNote}
                            </div>
                          </div>

                          <div className="flex flex-col gap-1">
                            <Input
                              id="targetPort"
                              label="Port"
                              placeholder="22"
                              type="number"
                              value={targetPort}
                              disabled={submitting}
                              onChange={(event) => {
                                clearSubmitError()
                                setTargetPort(event.target.value)
                              }}
                            />
                            {targetPortInvalid && (
                              <div className="text-[10px] text-[var(--vscode-errorForeground)]">
                                Enter a whole port number between 1 and {MAX_PORT_NUMBER}.
                              </div>
                            )}
                          </div>
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
              title="SSH key setup"
              subtitle="Provide the SSH public key that you will use to authenticate with the bastion. The matching private key will be required to connect."
            >
              <div className="flex flex-col gap-2">
                <div className="text-[11px] font-medium text-[var(--vscode-descriptionForeground)]">
                  Select SSH key options:
                </div>
                <div className="flex flex-col gap-1.5 pl-1">
                  <label className="flex items-center gap-2 text-[12px] text-foreground">
                    <input
                      type="radio"
                      name="sshKeyMode"
                      checked={sshKeyMode === "UPLOAD"}
                      disabled={submitting}
                      className="accent-[var(--vscode-focusBorder)]"
                      onChange={() => {
                        clearSubmitError()
                        setSshKeyMode("UPLOAD")
                      }}
                    />
                    Choose SSH key file
                  </label>
                  <label className="flex items-center gap-2 text-[12px] text-foreground">
                    <input
                      type="radio"
                      name="sshKeyMode"
                      checked={sshKeyMode === "PASTE"}
                      disabled={submitting}
                      className="accent-[var(--vscode-focusBorder)]"
                      onChange={() => {
                        clearSubmitError()
                        setSshKeyMode("PASTE")
                      }}
                    />
                    Paste SSH key
                  </label>
                </div>

                <div className="mt-2 flex flex-col gap-1">
                  {sshKeyMode === "UPLOAD" ? (
                    <div className="flex flex-col gap-1">
                      <div className="text-[12px] font-medium text-[var(--vscode-foreground)]">SSH key</div>
                      <div
                        onDrop={handleFileDrop}
                        onDragOver={handleDragOver}
                        className={clsx(
                          "relative flex min-h-[100px] cursor-pointer flex-col items-center justify-center gap-2 rounded-[4px] border border-dashed border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface-subtle)] p-4 text-center transition-colors hover:border-[var(--vscode-focusBorder)] hover:bg-[var(--vscode-list-hoverBackground)]",
                          publicKeyInvalid && "border-[var(--vscode-errorForeground)] bg-[color-mix(in_srgb,var(--vscode-errorForeground)_10%,var(--workbench-panel-surface-subtle))]"
                        )}
                        onClick={handleFileUpload}
                      >
                        <Upload size={24} className="text-[var(--vscode-descriptionForeground)]" />
                        <div className="flex flex-col items-center gap-1">
                          <span className="text-[13px] font-semibold text-[var(--vscode-foreground)]">
                            {publicKeyFileName ? publicKeyFileName : "Drop a file or select one"}
                          </span>
                          <span className="text-[11px] text-[var(--vscode-descriptionForeground)]">
                            SSH public key (.pub) files only.
                          </span>
                        </div>
                      </div>
                      <div className={clsx("text-[10px]", publicKeyInvalid ? "text-[var(--vscode-errorForeground)]" : "text-[var(--vscode-descriptionForeground)]")}>
                        {publicKeyInvalid ? "Add an SSH public key before creating the session." : "Required"}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <Textarea
                        id="publicKey"
                        label="SSH public key (Manual entry)"
                        placeholder="ssh-rsa AAAAB3NzaC1yc2E..."
                        value={publicKey}
                        className="font-mono text-[11px]"
                        disabled={submitting}
                        onChange={(event) => {
                          clearSubmitError()
                          setPublicKey(event.target.value)
                        }}
                      />
                      <div className={clsx("text-[10px]", publicKeyInvalid ? "text-[var(--vscode-errorForeground)]" : "text-[var(--vscode-descriptionForeground)]")}>
                        {publicKeyInvalid ? "Add an SSH public key before creating the session." : "Required"}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="grid gap-2 lg:grid-cols-[minmax(0,250px)_minmax(0,1fr)]">
                <div className="flex flex-col gap-1">
                  <Input
                    id="sessionTtlInSeconds"
                    label="Session time-to-live"
                    placeholder="10800"
                    type="number"
                    value={sessionTtlInSeconds}
                    disabled={submitting}
                    onChange={(event) => {
                      clearSubmitError()
                      setSessionTtlInSeconds(event.target.value)
                    }}
                  />
                  <div className={clsx("text-[10px]", sessionTtlInvalid ? "text-[var(--vscode-errorForeground)]" : "text-[var(--vscode-descriptionForeground)]")}>
                    {sessionTtlInvalid ? `Enter a duration between 1 and 10800 seconds.` : `Seconds. Must be between 1 and 10800.`}
                  </div>
                </div>
                <DialogSurface className="text-[11px] leading-5 text-[var(--vscode-descriptionForeground)]">
                  Use shorter lifetimes for ephemeral debugging access. The current default is 10800 seconds, which equals 3 hours.
                </DialogSurface>
              </div>
            </DialogSection>
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
  return octets.every((octet) => /^(0|[1-9]\d*)$/.test(octet) && Number(octet) >= 0 && Number(octet) <= 255)
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

  if (!isWholeNumberInRange(sessionTtlInSeconds, { min: 1, max: 10800 })) {
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
