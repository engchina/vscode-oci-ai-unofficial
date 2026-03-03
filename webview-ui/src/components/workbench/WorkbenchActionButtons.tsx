import { clsx } from "clsx"
import { ChevronLeft, Edit, Loader2 } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import Button from "../ui/Button"
import { createWorkbenchGuardrail, type WorkbenchGuardrailConfig, type WorkbenchGuardrailState } from "./guardrail"

type WorkbenchActionTone = "action" | "navigation" | "submit" | "secondaryAction" | "danger"

type WorkbenchActionButtonProps = Omit<ComponentProps<typeof Button>, "size"> & {
  tone?: WorkbenchActionTone
}

export function WorkbenchActionButton({
  variant = "secondary",
  tone = "action",
  className,
  ...props
}: WorkbenchActionButtonProps) {
  return (
    <Button
      size="sm"
      variant={variant}
      className={clsx(
        "gap-1.5",
        tone === "navigation" && variant === "secondary" && "border-[var(--vscode-focusBorder)] bg-[color-mix(in_srgb,var(--vscode-button-background)_12%,var(--vscode-editor-background)_88%)] text-[var(--vscode-foreground)] hover:bg-[color-mix(in_srgb,var(--vscode-button-background)_20%,var(--vscode-editor-background)_80%)]",
        tone === "navigation" && variant === "ghost" && "text-[var(--vscode-button-background)] hover:bg-[color-mix(in_srgb,var(--vscode-button-background)_10%,transparent)] hover:text-[var(--vscode-foreground)]",
        tone === "submit" && variant === "secondary" && "border-[color-mix(in_srgb,var(--vscode-button-background)_60%,var(--vscode-focusBorder)_40%)] bg-[color-mix(in_srgb,var(--vscode-button-background)_18%,var(--vscode-editor-background)_82%)] text-[var(--vscode-foreground)] hover:bg-[color-mix(in_srgb,var(--vscode-button-background)_28%,var(--vscode-editor-background)_72%)]",
        tone === "submit" && variant === "ghost" && "text-[var(--vscode-button-background)] hover:bg-[color-mix(in_srgb,var(--vscode-button-background)_12%,transparent)] hover:text-[var(--vscode-foreground)]",
        tone === "secondaryAction" && variant === "secondary" && "border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_97%,white_3%)] text-[var(--vscode-descriptionForeground)] hover:bg-[color-mix(in_srgb,var(--vscode-editor-background)_90%,white_10%)] hover:text-[var(--vscode-foreground)]",
        tone === "secondaryAction" && variant === "ghost" && "text-[var(--vscode-descriptionForeground)] hover:bg-[color-mix(in_srgb,var(--vscode-editor-background)_94%,white_6%)] hover:text-[var(--vscode-foreground)]",
        tone === "danger" && variant === "secondary" && "border-[color-mix(in_srgb,var(--vscode-errorForeground)_45%,var(--vscode-panel-border)_55%)] bg-[color-mix(in_srgb,var(--vscode-errorForeground)_12%,var(--vscode-editor-background)_88%)] text-[var(--vscode-errorForeground)] hover:bg-[color-mix(in_srgb,var(--vscode-errorForeground)_18%,var(--vscode-editor-background)_82%)] hover:text-[var(--vscode-errorForeground)]",
        tone === "danger" && variant === "ghost" && "text-[var(--vscode-errorForeground)] hover:bg-[color-mix(in_srgb,var(--vscode-errorForeground)_10%,transparent)] hover:text-[var(--vscode-errorForeground)]",
        className,
      )}
      {...props}
    />
  )
}

interface WorkbenchNavigationButtonProps extends Omit<WorkbenchActionButtonProps, "variant"> {
  active?: boolean
}

export function WorkbenchNavigationButton({
  active = false,
  className,
  ...props
}: WorkbenchNavigationButtonProps) {
  return (
    <Button
      size="sm"
      variant="ghost"
      className={clsx(
        "h-7 rounded-full border px-3 text-[12px] font-medium",
        active
          ? "border-[var(--vscode-focusBorder)] bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)] hover:bg-[var(--vscode-list-activeSelectionBackground)]"
          : "border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_94%,white_6%)] text-[var(--vscode-descriptionForeground)] hover:bg-[var(--vscode-list-hoverBackground)] hover:text-[var(--vscode-foreground)]",
        className,
      )}
      {...props}
    />
  )
}

interface WorkbenchBackButtonProps extends Omit<WorkbenchNavigationButtonProps, "children"> {
  label: string
}

export function WorkbenchBackButton({
  label,
  title,
  "aria-label": ariaLabel,
  ...props
}: WorkbenchBackButtonProps) {
  return (
    <WorkbenchNavigationButton title={title ?? label} aria-label={ariaLabel ?? label} {...props}>
      <ChevronLeft size={12} />
      {label}
    </WorkbenchNavigationButton>
  )
}

export function WorkbenchNavigationCluster({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_90%,white_10%)] p-1",
        className,
      )}
    >
      {children}
    </div>
  )
}

interface WorkbenchLifecycleActionButtonProps extends Omit<WorkbenchActionButtonProps, "children"> {
  label: string
  busy?: boolean
  idleIcon: ReactNode
}

export function WorkbenchLifecycleActionButton({
  label,
  busy = false,
  idleIcon,
  ...props
}: WorkbenchLifecycleActionButtonProps) {
  return (
    <WorkbenchActionButton {...props}>
      {busy ? <Loader2 size={12} className="animate-spin" /> : idleIcon}
      {label}
    </WorkbenchActionButton>
  )
}

interface WorkbenchGuardrailActionButtonProps extends Omit<WorkbenchLifecycleActionButtonProps, "onClick"> {
  guardrail: WorkbenchGuardrailConfig
  onRequestGuardrail: (value: WorkbenchGuardrailState) => void
}

export function WorkbenchGuardrailActionButton({
  guardrail,
  onRequestGuardrail,
  ...props
}: WorkbenchGuardrailActionButtonProps) {
  return (
    <WorkbenchLifecycleActionButton
      {...props}
      onClick={() => onRequestGuardrail(createWorkbenchGuardrail(guardrail))}
    />
  )
}

interface WorkbenchSelectButtonProps extends Omit<WorkbenchActionButtonProps, "children" | "variant"> {
  selected: boolean
  selectedLabel?: string
  idleLabel?: string
}

export function WorkbenchSelectButton({
  selected,
  selectedLabel = "Selected",
  idleLabel = "Select",
  ...props
}: WorkbenchSelectButtonProps) {
  return (
    <WorkbenchActionButton variant={selected ? "primary" : "secondary"} {...props}>
      {selected ? selectedLabel : idleLabel}
    </WorkbenchActionButton>
  )
}

interface WorkbenchRevealButtonProps extends Omit<WorkbenchActionButtonProps, "children"> {
  label: string
}

export function WorkbenchRevealButton({ label, ...props }: WorkbenchRevealButtonProps) {
  return <WorkbenchActionButton tone="navigation" {...props}>{label}</WorkbenchActionButton>
}

interface WorkbenchSubmitButtonProps extends Omit<WorkbenchActionButtonProps, "tone"> {}

export function WorkbenchSubmitButton(props: WorkbenchSubmitButtonProps) {
  return <WorkbenchActionButton tone="submit" {...props} />
}

interface WorkbenchSecondaryActionButtonProps extends Omit<WorkbenchActionButtonProps, "tone"> {}

export function WorkbenchSecondaryActionButton(props: WorkbenchSecondaryActionButtonProps) {
  return <WorkbenchActionButton tone="secondaryAction" {...props} />
}

interface WorkbenchDismissButtonProps extends Omit<WorkbenchActionButtonProps, "children" | "variant"> {
  label?: string
}

export function WorkbenchDismissButton({
  label = "Dismiss",
  ...props
}: WorkbenchDismissButtonProps) {
  return (
    <WorkbenchActionButton variant="ghost" {...props}>
      {label}
    </WorkbenchActionButton>
  )
}

export function WorkbenchDestructiveButton({
  className,
  ...props
}: WorkbenchActionButtonProps) {
  return (
    <WorkbenchActionButton
      tone="danger"
      className={clsx("text-error hover:text-error", className)}
      {...props}
    />
  )
}

interface WorkbenchIconActionButtonProps extends Omit<ComponentProps<typeof Button>, "children"> {
  icon: ReactNode
  busy?: boolean
  tone?: WorkbenchActionTone
}

export function WorkbenchIconActionButton({
  icon,
  busy = false,
  tone = "action",
  className,
  size = "sm",
  variant = "secondary",
  ...props
}: WorkbenchIconActionButtonProps) {
  return (
    <Button
      size={size}
      variant={variant}
      className={clsx(
        tone === "navigation" && variant === "secondary" && "border-[var(--vscode-focusBorder)] bg-[color-mix(in_srgb,var(--vscode-button-background)_12%,var(--vscode-editor-background)_88%)] text-[var(--vscode-foreground)] hover:bg-[color-mix(in_srgb,var(--vscode-button-background)_20%,var(--vscode-editor-background)_80%)]",
        tone === "submit" && variant === "secondary" && "border-[color-mix(in_srgb,var(--vscode-button-background)_60%,var(--vscode-focusBorder)_40%)] bg-[color-mix(in_srgb,var(--vscode-button-background)_18%,var(--vscode-editor-background)_82%)] text-[var(--vscode-foreground)] hover:bg-[color-mix(in_srgb,var(--vscode-button-background)_28%,var(--vscode-editor-background)_72%)]",
        tone === "secondaryAction" && variant === "secondary" && "border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_97%,white_3%)] text-[var(--vscode-descriptionForeground)] hover:bg-[color-mix(in_srgb,var(--vscode-editor-background)_90%,white_10%)] hover:text-[var(--vscode-foreground)]",
        tone === "danger" && variant === "secondary" && "border-[color-mix(in_srgb,var(--vscode-errorForeground)_45%,var(--vscode-panel-border)_55%)] bg-[color-mix(in_srgb,var(--vscode-errorForeground)_12%,var(--vscode-editor-background)_88%)] text-[var(--vscode-errorForeground)] hover:bg-[color-mix(in_srgb,var(--vscode-errorForeground)_18%,var(--vscode-editor-background)_82%)] hover:text-[var(--vscode-errorForeground)]",
        className,
      )}
      {...props}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : icon}
    </Button>
  )
}

export function WorkbenchEditIconButton(
  props: Omit<WorkbenchIconActionButtonProps, "icon">,
) {
  return <WorkbenchIconActionButton icon={<Edit size={12} />} {...props} />
}

export function WorkbenchIconDestructiveButton({
  className,
  ...props
}: WorkbenchIconActionButtonProps) {
  return (
    <WorkbenchIconActionButton
      className={clsx(
        "border border-[color-mix(in_srgb,var(--vscode-errorForeground)_35%,var(--vscode-panel-border)_65%)] bg-[color-mix(in_srgb,var(--vscode-errorForeground)_10%,var(--vscode-editor-background)_90%)] text-error hover:bg-[color-mix(in_srgb,var(--vscode-errorForeground)_16%,var(--vscode-editor-background)_84%)] hover:text-error",
        className,
      )}
      {...props}
    />
  )
}

export function WorkbenchInlineActionCluster({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return <div className={clsx("flex flex-wrap items-center gap-1.5", className)}>{children}</div>
}

export function WorkbenchCompactActionCluster({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return <WorkbenchInlineActionCluster className={clsx("gap-1", className)}>{children}</WorkbenchInlineActionCluster>
}

interface WorkbenchActionToggleButtonProps extends Omit<ComponentProps<typeof Button>, "variant" | "size"> {
  active: boolean
}

export function WorkbenchActionToggleButton({
  active,
  className,
  ...props
}: WorkbenchActionToggleButtonProps) {
  return (
    <Button
      size="sm"
      variant={active ? "secondary" : "ghost"}
      className={clsx(
        "h-7 border px-3 text-[12px]",
        active
          ? "border-[var(--vscode-focusBorder)] bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)] hover:bg-[var(--vscode-list-activeSelectionBackground)]"
          : "border-input-border bg-input-background text-input-foreground hover:bg-[var(--vscode-toolbar-hoverBackground)]",
        className,
      )}
      {...props}
    />
  )
}

export function WorkbenchShortcutTileButton({
  title,
  description,
  onClick,
  className,
}: {
  title: string
  description: string
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "rounded-md border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)] px-2.5 py-2 text-left transition-colors hover:bg-[var(--vscode-list-hoverBackground)]",
        className,
      )}
    >
      <div className="text-[12px] font-semibold text-[var(--vscode-foreground)]">{title}</div>
      <div className="mt-0.5 text-[11px] leading-5 text-[var(--vscode-descriptionForeground)]">{description}</div>
    </button>
  )
}
