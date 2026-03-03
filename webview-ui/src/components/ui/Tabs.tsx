import { clsx } from "clsx"
import React, { createContext, useContext, useState, useEffect } from "react"

interface TabsContextValue {
    activeTab: string
    setActiveTab: (value: string) => void
}

const TabsContext = createContext<TabsContextValue | undefined>(undefined)

export function Tabs({
    defaultValue,
    value,
    onValueChange,
    children,
    className,
}: {
    defaultValue?: string
    value?: string
    onValueChange?: (value: string) => void
    children: React.ReactNode
    className?: string
}) {
    const [activeTab, setUncontrolledActiveTab] = useState(value ?? defaultValue ?? "")

    useEffect(() => {
        if (value !== undefined) {
            setUncontrolledActiveTab(value)
        }
    }, [value])

    const handleSetActiveTab = (newValue: string) => {
        if (value === undefined) {
            setUncontrolledActiveTab(newValue)
        }
        if (onValueChange) {
            onValueChange(newValue)
        }
    }

    return (
        <TabsContext.Provider value={{ activeTab, setActiveTab: handleSetActiveTab }}>
            <div className={clsx("flex flex-col", className)}>
                {children}
            </div>
        </TabsContext.Provider>
    )
}

export function TabsList({
    children,
    className,
}: {
    children: React.ReactNode
    className?: string
}) {
    return (
        <div
            className={clsx(
                "flex w-full items-end gap-1 border-b border-[var(--vscode-panelTitle-activeBorder,var(--vscode-panel-border))] bg-[color-mix(in_srgb,var(--vscode-editor-background)_94%,white_6%)] px-1 pt-1",
                className
            )}
            role="tablist"
        >
            {children}
        </div>
    )
}

export function TabsTrigger({
    value,
    children,
    className,
}: {
    value: string
    children: React.ReactNode
    className?: string
}) {
    const context = useContext(TabsContext)
    if (!context) throw new Error("TabsTrigger must be used within Tabs")

    const isActive = context.activeTab === value

    return (
        <button
            role="tab"
            aria-selected={isActive}
            onClick={() => context.setActiveTab(value)}
            className={clsx(
                "relative inline-flex min-h-[30px] items-center justify-center whitespace-nowrap rounded-t-md border px-3 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
                isActive
                    ? "border-[var(--vscode-panel-border)] border-b-[var(--vscode-editor-background)] bg-[var(--vscode-editor-background)] text-[var(--vscode-panelTitle-activeForeground)]"
                    : "border-transparent text-[var(--vscode-panelTitle-inactiveForeground)] hover:bg-[var(--vscode-list-hoverBackground)] hover:text-[var(--vscode-panelTitle-activeForeground)]",
                className
            )}
        >
            {children}
        </button>
    )
}

export function TabsContent({
    value,
    children,
    className,
}: {
    value: string
    children: React.ReactNode
    className?: string
}) {
    const context = useContext(TabsContext)
    if (!context) throw new Error("TabsContent must be used within Tabs")

    if (context.activeTab !== value) return null

    return (
        <div
            role="tabpanel"
            className={clsx(
                "mt-1 ring-offset-[var(--vscode-editor-background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vscode-focusBorder)] focus-visible:ring-offset-2",
                className
            )}
        >
            {children}
        </div>
    )
}
