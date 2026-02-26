import { clsx } from "clsx"
import type { ButtonHTMLAttributes, ReactNode } from "react"

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "icon"
  size?: "sm" | "md" | "icon"
  children: ReactNode
}

export default function Button({ variant = "primary", size = "md", className, children, ...props }: ButtonProps) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center rounded-[2px] border border-transparent font-medium transition-colors outline-none",
        "focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--vscode-focusBorder)] focus-visible:outline-offset-[-1px]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-button-background text-button-foreground hover:bg-button-background-hover",
        variant === "secondary" &&
        "border-input-border bg-button-secondary-background text-button-secondary-foreground hover:bg-button-secondary-background-hover",
        variant === "ghost" && "text-foreground hover:bg-list-background-hover",
        variant === "icon" && "text-[var(--vscode-icon-foreground)] hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-[var(--vscode-icon-foreground)]",
        size === "sm" && "h-6 px-2.5 text-[12px]",
        size === "md" && "h-[26px] px-3.5 text-[13px]",
        size === "icon" && "h-6 w-6 p-1 rounded-md border-none",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
