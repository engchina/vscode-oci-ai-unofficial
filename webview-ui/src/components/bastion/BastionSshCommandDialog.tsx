import { Copy, Loader2, SquareTerminal, X } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import type { BastionSessionResource } from "../../services/types"
import { loadSshConfig } from "../../sshConfig"
import Button from "../ui/Button"
import { LifecycleBadge } from "../ui/StatusBadge"
import { WorkbenchCompactInput } from "../workbench/WorkbenchCompactControls"
import {
  DEFAULT_BASTION_PRIVATE_KEY_PATH,
  getDefaultBastionLocalPort,
  prepareBastionSshCommand,
  type PreparedBastionSshCommand,
} from "./bastionSshCommand"

interface BastionSshCommandDialogProps {
  open: boolean
  bastionName: string
  sessionName: string
  session: BastionSessionResource | null
  lifecycleState: string
  sessionTypeLabel: string
  targetLabel: string
  ttlLabel: string
  commandTemplate: string
  onClose: () => void
  onCopy: (command: string) => void | Promise<void>
  onOpenInTerminal: (command: PreparedBastionSshCommand) => void | Promise<void>
  running?: boolean
}

export default function BastionSshCommandDialog({
  open,
  bastionName,
  sessionName,
  session,
  lifecycleState,
  sessionTypeLabel,
  targetLabel,
  ttlLabel,
  commandTemplate,
  onClose,
  onCopy,
  onOpenInTerminal,
  running = false,
}: BastionSshCommandDialogProps) {
  const [privateKeyPath, setPrivateKeyPath] = useState("")
  const [localPort, setLocalPort] = useState("")

  useEffect(() => {
    if (!open) {
      return
    }
    const sshConfig = loadSshConfig()
    setPrivateKeyPath(sshConfig.privateKeyPath || "")
    setLocalPort(getDefaultBastionLocalPort(session, commandTemplate))
  }, [commandTemplate, open, session?.id])

  const preparedCommand = useMemo(
    () => prepareBastionSshCommand(commandTemplate, { privateKeyPath, localPort }),
    [commandTemplate, localPort, privateKeyPath],
  )
  const hasInputErrors = preparedCommand.errors.length > 0
  const defaultLocalPort = getDefaultBastionLocalPort(session, commandTemplate)
  const privateKeyPlaceholder = loadSshConfig().privateKeyPath.trim() || DEFAULT_BASTION_PRIVATE_KEY_PATH

  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 px-4 text-[var(--vscode-foreground)]">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[4px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--vscode-panel-border)] px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <SquareTerminal size={16} />
              <h3 className="text-[13px] font-semibold">SSH Command</h3>
              <LifecycleBadge state={lifecycleState} size="compact" />
            </div>
            <div className="mt-1 text-[12px] text-[var(--vscode-descriptionForeground)]">
              {sessionName} on {bastionName}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[2px] p-1 text-[var(--vscode-icon-foreground)] transition-colors hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-[var(--vscode-foreground)]"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4">
          <div className="grid gap-2 rounded-[4px] border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)] p-3 text-[11px] text-[var(--vscode-descriptionForeground)] md:grid-cols-3">
            <div>
              <div className="uppercase tracking-[0.16em]">Session Type</div>
              <div className="mt-1 text-[12px] text-[var(--vscode-foreground)]">{sessionTypeLabel}</div>
            </div>
            <div>
              <div className="uppercase tracking-[0.16em]">Target</div>
              <div className="mt-1 break-all text-[12px] text-[var(--vscode-foreground)]">{targetLabel}</div>
            </div>
            <div>
              <div className="uppercase tracking-[0.16em]">TTL</div>
              <div className="mt-1 text-[12px] text-[var(--vscode-foreground)]">{ttlLabel}</div>
            </div>
          </div>

          {(preparedCommand.requiresPrivateKey || preparedCommand.requiresLocalPort) && (
            <div className="rounded-[4px] border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)] p-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--vscode-descriptionForeground)]">
                Command Inputs
              </div>
              <div className="text-[11px] text-[var(--vscode-descriptionForeground)]">
                Fill the placeholders before copying or launching the command.
              </div>

              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {preparedCommand.requiresPrivateKey && (
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className="text-[11px] text-[var(--vscode-descriptionForeground)]">Private Key</span>
                    <WorkbenchCompactInput
                      type="text"
                      value={privateKeyPath}
                      onChange={(event) => setPrivateKeyPath(event.target.value)}
                      placeholder={privateKeyPlaceholder}
                      title="Private key path used for -i"
                    />
                    <span className="text-[10px] text-[var(--vscode-descriptionForeground)]">
                      Empty uses {privateKeyPlaceholder}. Settings → Terminal → Compute SSH Defaults still applies when configured.
                    </span>
                  </label>
                )}

                {preparedCommand.requiresLocalPort && (
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className="text-[11px] text-[var(--vscode-descriptionForeground)]">Local Port</span>
                    <WorkbenchCompactInput
                      type="number"
                      min={1}
                      max={65535}
                      value={localPort}
                      onChange={(event) => setLocalPort(event.target.value)}
                      placeholder={defaultLocalPort}
                      title="Local forwarding port"
                    />
                    <span className="text-[10px] text-[var(--vscode-descriptionForeground)]">
                      Defaults to target port {defaultLocalPort}.
                    </span>
                  </label>
                )}
              </div>

              {hasInputErrors && (
                <div className="mt-3 rounded-[2px] border border-[color-mix(in_srgb,var(--vscode-errorForeground)_35%,var(--vscode-panel-border)_65%)] bg-[color-mix(in_srgb,var(--vscode-errorForeground)_10%,var(--vscode-editor-background)_90%)] px-2.5 py-2 text-[11px] text-[var(--vscode-errorForeground)]">
                  {preparedCommand.errors.join(" ")}
                </div>
              )}
            </div>
          )}

          <div className="rounded-[4px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)] p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--vscode-descriptionForeground)]">
              Command Preview
            </div>
            <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-all rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 py-2 text-[12px] leading-6 text-[var(--vscode-foreground)]">
              {preparedCommand.command}
            </pre>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--vscode-panel-border)] px-4 py-3">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button variant="secondary" disabled={hasInputErrors} onClick={() => void onCopy(preparedCommand.command)}>
            <Copy size={13} className="mr-1.5" />
            Copy Command
          </Button>
          <Button disabled={hasInputErrors || running} onClick={() => void onOpenInTerminal(preparedCommand)}>
            {running ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : <SquareTerminal size={13} className="mr-1.5" />}
            Open in VS Code Terminal
          </Button>
        </div>
      </div>
    </div>
  )
}
