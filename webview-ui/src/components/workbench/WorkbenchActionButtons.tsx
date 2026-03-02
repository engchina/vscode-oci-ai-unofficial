import { clsx } from "clsx"
import { Edit, Loader2 } from "lucide-react"
import type { ComponentProps, ReactNode } from "react"
import Button from "../ui/Button"
import { createWorkbenchGuardrail, type WorkbenchGuardrailConfig, type WorkbenchGuardrailState } from "./guardrail"

type WorkbenchActionButtonProps = Omit<ComponentProps<typeof Button>, "size">

export function WorkbenchActionButton({
  variant = "secondary",
  className,
  ...props
}: WorkbenchActionButtonProps) {
  return <Button size="sm" variant={variant} className={clsx("gap-1.5", className)} {...props} />
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
  return <WorkbenchActionButton {...props}>{label}</WorkbenchActionButton>
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
      className={clsx("text-error hover:text-error", className)}
      {...props}
    />
  )
}

interface WorkbenchIconActionButtonProps extends Omit<ComponentProps<typeof Button>, "children"> {
  icon: ReactNode
  busy?: boolean
}

export function WorkbenchIconActionButton({
  icon,
  busy = false,
  className,
  size = "sm",
  variant = "secondary",
  ...props
}: WorkbenchIconActionButtonProps) {
  return (
    <Button
      size={size}
      variant={variant}
      className={className}
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
      className={clsx("text-error hover:text-error", className)}
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
