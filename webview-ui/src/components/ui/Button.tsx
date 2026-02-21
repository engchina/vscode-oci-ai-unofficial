import { clsx } from "clsx"
import type { ButtonHTMLAttributes, ReactNode } from "react"

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost"
  size?: "sm" | "md"
  children: ReactNode
}

export default function Button({ variant = "primary", size = "md", className, children, ...props }: ButtonProps) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center rounded-md font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "bg-button-background text-button-foreground hover:bg-button-background-hover",
        variant === "secondary" &&
          "bg-button-secondary-background text-button-secondary-foreground hover:bg-button-secondary-background-hover",
        variant === "ghost" && "bg-transparent text-foreground hover:bg-list-background-hover",
        size === "sm" && "px-2 py-1 text-xs",
        size === "md" && "px-3 py-1.5 text-sm",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
