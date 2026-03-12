import { clsx } from "clsx"
import { Check, ChevronDown, Loader2, Search, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"

export interface ResourceDropdownOption {
  value: string
  label: string
  description?: string
  meta?: string
  title?: string
}

interface ResourceDropdownProps {
  id?: string
  label: string
  labelClassName?: string
  placeholder: string
  value: string
  options: ResourceDropdownOption[]
  onChange: (value: string) => void
  disabled?: boolean
  loading?: boolean
  invalid?: boolean
  emptyMessage?: string
  searchPlaceholder?: string
}

export default function ResourceDropdown({
  id,
  label,
  labelClassName,
  placeholder,
  value,
  options,
  onChange,
  disabled = false,
  loading = false,
  invalid = false,
  emptyMessage = "No options available.",
  searchPlaceholder = "Filter options...",
}: ResourceDropdownProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const containerRef = useRef<HTMLDivElement>(null)
  const selectedOption = options.find((option) => option.value === value) ?? null
  const normalizedQuery = query.trim().toLowerCase()
  const filteredOptions = normalizedQuery
    ? options.filter((option) =>
        [option.label, option.description, option.meta]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(normalizedQuery)))
    : options

  useEffect(() => {
    if (!open) {
      setQuery("")
      return
    }

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener("mousedown", handlePointerDown)
    return () => document.removeEventListener("mousedown", handlePointerDown)
  }, [open])

  useEffect(() => {
    if (!disabled) {
      return
    }
    setOpen(false)
    setQuery("")
  }, [disabled])

  return (
    <div className="flex w-full flex-col gap-1" ref={containerRef}>
      <label htmlFor={id} className={clsx("text-[11px] font-medium text-[var(--vscode-foreground)]", labelClassName)}>
        {label}
      </label>
      <div className="relative">
        <button
          id={id}
          type="button"
          aria-invalid={invalid}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          className={clsx(
            "flex min-h-[28px] w-full items-center justify-between gap-2 rounded-[2px] border border-[var(--vscode-dropdown-border,var(--vscode-input-border))] bg-[var(--vscode-dropdown-background,var(--vscode-input-background))] px-2 py-1.5 text-left text-[12px] text-[var(--vscode-dropdown-foreground,var(--vscode-input-foreground))] transition-colors",
            "hover:bg-[var(--vscode-list-hoverBackground)] focus:outline focus:outline-1 focus:outline-[var(--vscode-focusBorder)] focus:-outline-offset-1",
            invalid && "border-[var(--vscode-errorForeground)]",
            disabled && "cursor-not-allowed opacity-60",
          )}
          title={selectedOption?.title || selectedOption?.meta || selectedOption?.label || placeholder}
        >
          <span className={clsx("truncate", !selectedOption && "text-[var(--vscode-input-placeholderForeground)]")}>
            {selectedOption?.label || placeholder}
          </span>
          <span className="flex shrink-0 items-center gap-1 text-[var(--vscode-icon-foreground)]">
            {loading ? <Loader2 size={13} className="animate-spin" /> : null}
            <ChevronDown size={14} />
          </span>
        </button>

        {open && !disabled && (
          <div className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-[2px] border border-[var(--vscode-dropdown-border,var(--vscode-input-border))] bg-[var(--vscode-dropdown-background,var(--vscode-input-background))] shadow-lg">
            <div className="border-b border-[var(--vscode-panel-border)] p-1.5">
              <div className="flex items-center gap-1.5 rounded-[2px] border border-[var(--vscode-input-border)] bg-[var(--vscode-input-background)] px-2 py-1 focus-within:outline focus-within:outline-1 focus-within:outline-[var(--vscode-focusBorder)] focus-within:-outline-offset-1">
                <Search size={12} className="shrink-0 text-[var(--vscode-icon-foreground)]" />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={searchPlaceholder}
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[12px] text-[var(--vscode-input-foreground)] outline-none placeholder:text-[var(--vscode-input-placeholderForeground)]"
                />
                {query ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="rounded-[2px] p-0.5 text-[var(--vscode-descriptionForeground)] transition-colors hover:bg-[var(--vscode-toolbar-hoverBackground)] hover:text-[var(--vscode-foreground)]"
                    aria-label="Clear filter"
                  >
                    <X size={12} />
                  </button>
                ) : null}
              </div>
            </div>

            <div className="max-h-56 overflow-y-auto py-0.5">
              {loading ? (
                <div className="flex items-center gap-2 px-2 py-2 text-[11px] text-[var(--vscode-descriptionForeground)]">
                  <Loader2 size={12} className="animate-spin" />
                  Loading instances...
                </div>
              ) : filteredOptions.length === 0 ? (
                <div className="px-2 py-2 text-[11px] text-[var(--vscode-descriptionForeground)]">{emptyMessage}</div>
              ) : (
                filteredOptions.map((option) => {
                  const isSelected = option.value === value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        onChange(option.value)
                        setOpen(false)
                        setQuery("")
                      }}
                      className="flex w-full items-start gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-list-background-hover"
                      title={option.title || option.meta || option.label}
                    >
                      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border border-input-border">
                        {isSelected ? <Check size={10} className="text-button-background" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">{option.label}</span>
                        {option.description ? (
                          <span className="mt-0.5 block truncate text-[10px] text-description">{option.description}</span>
                        ) : null}
                        {option.meta ? (
                          <span className="mt-0.5 block truncate text-[10px] text-description">{option.meta}</span>
                        ) : null}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
