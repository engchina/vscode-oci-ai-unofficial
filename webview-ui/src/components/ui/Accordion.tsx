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
        <div className={`flex flex-col border-t border-[var(--vscode-panel-border)] overflow-hidden ${isOpen ? 'flex-1' : ''}`}>
            <button
                className="group flex w-full items-center bg-[var(--vscode-sideBarSectionHeader-background)] px-1 py-1 min-h-[22px] text-[11px] font-bold text-[var(--vscode-sideBarTitle-foreground)] leading-tight focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--vscode-focusBorder)] focus-visible:outline-offset-[-1px] cursor-pointer"
                onClick={onToggle}
            >
                <div className="flex items-center text-[var(--vscode-icon-foreground)] opacity-80 group-hover:opacity-100">
                    {isOpen ? <ChevronDown size={14} strokeWidth={2.5} /> : <ChevronRight size={14} strokeWidth={2.5} />}
                </div>
                <span className="uppercase ml-0.5 truncate">{title}</span>
            </button>
            <div
                className={`flex-1 overflow-hidden transition-all duration-200 ease-in-out flex-col ${isOpen ? "opacity-100" : "opacity-0"
                    }`}
                style={{ display: isOpen ? "flex" : "none" }}
            >
                <div className="flex flex-col flex-1 w-full h-full overflow-hidden bg-[var(--vscode-sideBar-background)]">{children}</div>
            </div>
        </div>
    )
}
