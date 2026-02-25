import React from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

export interface AccordionItemProps {
    title: string
    children: React.ReactNode
    isOpen: boolean
    onToggle: () => void
}

export function AccordionItem({ title, children, isOpen, onToggle }: AccordionItemProps) {
    return (
        <div className={`flex flex-col border-b border-[var(--vscode-panel-border)] overflow-hidden ${isOpen ? 'flex-1' : ''}`}>
            <button
                className="flex w-full items-center justify-between bg-[var(--vscode-sideBarSectionHeader-background)] px-2 py-1.5 text-xs font-bold text-[var(--vscode-sideBarTitle-foreground)] hover:bg-[var(--vscode-list-hoverBackground)] focus:outline-none"
                onClick={onToggle}
            >
                <div className="flex items-center gap-1">
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <span className="uppercase tracking-wider">{title}</span>
                </div>
            </button>
            <div
                className={`flex-1 overflow-hidden transition-all duration-200 ease-in-out ${isOpen ? "opacity-100" : "opacity-0"
                    }`}
                style={{ display: isOpen ? "flex" : "none" }}
            >
                <div className="flex-1 w-full overflow-y-auto bg-[var(--vscode-sideBar-background)]">{children}</div>
            </div>
        </div>
    )
}
