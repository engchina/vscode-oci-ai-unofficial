import { AlertCircle, Loader2, Shield, Upload, X } from "lucide-react"
import { useEffect, useState } from "react"
import type { BastionResource } from "../../services/types"
import { ResourceServiceClient } from "../../services/grpc-client"
import Button from "../ui/Button"
import Input from "../ui/Input"
import Textarea from "../ui/Textarea"
import InlineNotice from "../ui/InlineNotice"
import {
  WorkbenchCompactFieldRow,
  WorkbenchCompactInput,
  WorkbenchInlineRadioOption,
} from "../workbench/WorkbenchCompactControls"

const DEFAULT_SESSION_TTL_SECONDS = "10800"

interface CreateBastionSessionDialogProps {
  open: boolean
  bastion: BastionResource | null
  onClose: () => void
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
  onSuccess,
}: CreateBastionSessionDialogProps) {
  const [sessionType, setSessionType] = useState<"MANAGED_SSH" | "PORT_FORWARDING">("MANAGED_SSH")
  const [displayName, setDisplayName] = useState("")
  const [publicKey, setPublicKey] = useState("")
  const [targetResourceId, setTargetResourceId] = useState("")
  const [osUserName, setOsUserName] = useState("opc")
  const [targetIp, setTargetIp] = useState("")
  const [targetPort, setTargetPort] = useState("22")
  const [sessionTtlInSeconds, setSessionTtlInSeconds] = useState(DEFAULT_SESSION_TTL_SECONDS)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    setSessionType("MANAGED_SSH")
    setDisplayName("")
    setPublicKey("")
    setTargetResourceId("")
    setOsUserName("opc")
    setTargetIp("")
    setTargetPort("22")
    setSessionTtlInSeconds(DEFAULT_SESSION_TTL_SECONDS)
    setSubmitting(false)
    setError(null)
  }, [open, bastion?.id])

  useEffect(() => {
    if (!error) {
      return
    }
    setError(null)
  }, [displayName, error, osUserName, publicKey, sessionTtlInSeconds, sessionType, targetIp, targetPort, targetResourceId])

  if (!open || !bastion) {
    return null
  }

  const handleFileUpload = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".pub"
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        const reader = new FileReader()
        reader.onload = (e) => {
          const content = e.target?.result as string
          if (content) {
            setPublicKey(content)
          }
        }
        reader.readAsText(file)
      }
    }
    input.click()
  }

  const handleSubmit = async () => {
    if (!publicKey.trim()) {
      setError("SSH Public Key is required")
      return
    }

    const ttlValue = Number.parseInt(sessionTtlInSeconds.trim(), 10)
    if (!Number.isFinite(ttlValue) || ttlValue <= 0) {
      setError("Session TTL must be a positive number of seconds")
      return
    }

    let targetResourceDetails: any = { sessionType }

    if (sessionType === "MANAGED_SSH") {
      if (!targetResourceId.trim()) {
        setError("Target Resource OCID is required for Managed SSH")
        return
      }
      if (!osUserName.trim()) {
        setError("OS User Name is required for Managed SSH")
        return
      }
      targetResourceDetails.targetResourceId = targetResourceId.trim()
      targetResourceDetails.targetResourceOperatingSystemUserName = osUserName.trim()
    } else {
      if (!targetResourceId.trim() && !targetIp.trim()) {
        setError("Target Resource OCID or Target IP is required for Port Forwarding")
        return
      }
      const targetPortValue = Number.parseInt(targetPort.trim(), 10)
      if (!targetPort.trim() || !Number.isFinite(targetPortValue) || targetPortValue <= 0) {
        setError("Target Port is required for Port Forwarding")
        return
      }
      if (targetResourceId.trim()) {
        targetResourceDetails.targetResourceId = targetResourceId.trim()
      } else {
        targetResourceDetails.targetResourcePrivateIpAddress = targetIp.trim()
      }
      targetResourceDetails.targetResourcePort = targetPortValue
    }

    setSubmitting(true)
    setError(null)
    try {
      await ResourceServiceClient.createBastionSession({
        bastionId: bastion.id,
        region: bastion.region,
        displayName: displayName.trim() || undefined,
        keyDetails: {
          publicKeyContent: publicKey.trim(),
        },
        targetResourceDetails,
        sessionTtlInSeconds: ttlValue,
      })
      onSuccess({
        bastionId: bastion.id,
        bastionName: bastion.name,
        sessionName: displayName.trim() || (sessionType === "MANAGED_SSH" ? "Managed SSH Session" : "Port Forwarding Session"),
        sessionType,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 px-4 font-sans text-[var(--vscode-foreground)]">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-[4px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--vscode-panel-border)] px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[var(--vscode-foreground)]">
              <Shield size={16} />
              <h3 className="text-[13px] font-semibold">Create Bastion Session</h3>
            </div>
            <div className="mt-1 truncate text-[12px] text-[var(--vscode-descriptionForeground)]">
              {bastion.name} • {bastion.region || "default"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-[2px] p-1 text-[var(--vscode-icon-foreground)] transition-colors hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-[var(--vscode-foreground)] disabled:opacity-50"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4">
          <div className="grid gap-2 rounded-[4px] border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)] p-3 text-[11px] text-[var(--vscode-descriptionForeground)] md:grid-cols-4">
            <SummaryCell label="Target VCN" value={bastion.targetVcnId || "-"} />
            <SummaryCell label="Target Subnet" value={bastion.targetSubnetId || "-"} />
            <SummaryCell label="DNS Proxy" value={bastion.dnsProxyStatus || "Unknown"} />
            <SummaryCell label="Client CIDRs" value={`${bastion.clientCidrBlockAllowList?.length ?? 0}`} />
          </div>

          {error && (
            <InlineNotice tone="danger" size="md" icon={<AlertCircle size={14} />}>
              {error}
            </InlineNotice>
          )}

          <section className="rounded-[4px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)] p-3">
            <div className="text-[12px] font-semibold text-[var(--vscode-foreground)]">Session Setup</div>
            <div className="mt-1 text-[11px] text-[var(--vscode-descriptionForeground)]">
              Choose the access model first, then fill in the target details and public key.
            </div>

            <div className="mt-3 flex flex-col gap-1.5">
              <label className="text-[11px] font-medium text-[var(--vscode-foreground)]">Session Type</label>
              <div className="flex flex-wrap gap-4">
                <WorkbenchInlineRadioOption
                  name="sessionType"
                  checked={sessionType === "MANAGED_SSH"}
                  onChange={() => setSessionType("MANAGED_SSH")}
                >
                  Managed SSH
                </WorkbenchInlineRadioOption>
                <WorkbenchInlineRadioOption
                  name="sessionType"
                  checked={sessionType === "PORT_FORWARDING"}
                  onChange={() => setSessionType("PORT_FORWARDING")}
                >
                  Port Forwarding
                </WorkbenchInlineRadioOption>
              </div>
              <p className="text-[10px] text-[var(--vscode-descriptionForeground)]">
                {sessionType === "MANAGED_SSH"
                  ? "Use this when the target compute instance is Bastion-aware and you want a generated SSH command."
                  : "Use this when you need a tunnel to a private IP or service port inside the target network."}
              </p>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]">
              <Input
                id="displayName"
                label="Session Name (Optional)"
                placeholder={sessionType === "MANAGED_SSH" ? "managed-ssh-session" : "port-forward-session"}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-medium text-[var(--vscode-foreground)]">Session TTL</label>
                <WorkbenchCompactFieldRow label="Seconds" labelClassName="w-14 font-semibold text-[var(--vscode-foreground)]">
                  <WorkbenchCompactInput
                    type="number"
                    min="60"
                    step="60"
                    value={sessionTtlInSeconds}
                    onChange={(e) => setSessionTtlInSeconds(e.target.value)}
                    className="h-[28px]"
                  />
                </WorkbenchCompactFieldRow>
              </div>
            </div>
          </section>

          <section className="rounded-[4px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)] p-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="publicKey" className="text-[11px] font-medium text-[var(--vscode-foreground)]">
                  SSH Public Key
                </label>
                <Button type="button" variant="secondary" size="sm" onClick={handleFileUpload}>
                  <Upload size={12} className="mr-1.5" />
                  Upload .pub
                </Button>
              </div>
              <Textarea
                id="publicKey"
                placeholder="ssh-rsa AAAAB3NzaC1..."
                value={publicKey}
                onChange={(e) => setPublicKey(e.target.value)}
              />
              <p className="text-[10px] text-[var(--vscode-descriptionForeground)]">
                Paste the public key directly or upload an existing `.pub` file from your workstation.
              </p>
            </div>
          </section>

          <section className="rounded-[4px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)] p-3">
            <div className="text-[12px] font-semibold text-[var(--vscode-foreground)]">Target Details</div>
            <div className="mt-1 text-[11px] text-[var(--vscode-descriptionForeground)]">
              {sessionType === "MANAGED_SSH"
                ? "Managed SSH requires the target compute OCID and the OS login user."
                : "Port forwarding can target either a resource OCID or a private IP and port pair."}
            </div>

            {sessionType === "MANAGED_SSH" && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Input
                  id="targetResourceId"
                  label="Target Compute Instance OCID"
                  placeholder="ocid1.instance.oc1..."
                  value={targetResourceId}
                  onChange={(e) => setTargetResourceId(e.target.value)}
                />
                <Input
                  id="osUserName"
                  label="OS User Name"
                  placeholder="opc"
                  value={osUserName}
                  onChange={(e) => setOsUserName(e.target.value)}
                />
              </div>
            )}

            {sessionType === "PORT_FORWARDING" && (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Input
                  id="targetResourceId"
                  label="Target Resource OCID"
                  placeholder="ocid1.instance.oc1..."
                  value={targetResourceId}
                  onChange={(e) => setTargetResourceId(e.target.value)}
                />
                <Input
                  id="targetIp"
                  label="Target Private IP"
                  placeholder="10.0.0.25"
                  value={targetIp}
                  onChange={(e) => setTargetIp(e.target.value)}
                />
                <Input
                  id="targetPort"
                  label="Target Port"
                  placeholder="22"
                  type="number"
                  value={targetPort}
                  onChange={(e) => setTargetPort(e.target.value)}
                />
              </div>
            )}
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-4 py-3">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Creating...</span>
            ) : "Create Session"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="uppercase tracking-[0.16em]">{label}</div>
      <div className="mt-1 truncate text-[12px] text-[var(--vscode-foreground)]" title={value}>
        {value}
      </div>
    </div>
  )
}
