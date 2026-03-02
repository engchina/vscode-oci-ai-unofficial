import { KeyRound, Layers, Settings2, UserPlus } from "lucide-react"
import Button from "./Button"

interface WelcomeGuideProps {
  onOpenSettings: () => void
}

const STEPS = [
  {
    icon: <Settings2 size={14} />,
    title: "Open Settings",
    description: "Expand the Settings section below.",
  },
  {
    icon: <UserPlus size={14} />,
    title: "Create a Profile",
    description: "Add a profile name (e.g. DEFAULT).",
  },
  {
    icon: <KeyRound size={14} />,
    title: "Enter API Key",
    description: "Fill in Tenancy OCID, User OCID, Fingerprint, and Private Key.",
  },
  {
    icon: <Layers size={14} />,
    title: "Add Compartments",
    description: "Map compartments to your profile in the Compartments tab.",
  },
] as const

export default function WelcomeGuide({ onOpenSettings }: WelcomeGuideProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-4 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--vscode-badge-background)]">
        <Settings2 size={20} className="text-[var(--vscode-badge-foreground)]" />
      </div>

      <div>
        <h2 className="text-sm font-semibold text-[var(--vscode-foreground)]">Welcome to OCI Tools</h2>
        <p className="mt-1 text-[11px] text-[var(--vscode-descriptionForeground)]">
          Set up your OCI profile to get started.
        </p>
      </div>

      <div className="flex w-full max-w-[260px] flex-col gap-2 text-left">
        {STEPS.map((step, i) => (
          <div
            key={step.title}
            className="flex items-start gap-2 rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-2.5 py-2"
          >
            <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--vscode-badge-background)] text-[9px] font-bold text-[var(--vscode-badge-foreground)]">
              {i + 1}
            </div>
            <div className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--vscode-foreground)]">
                {step.icon}
                {step.title}
              </span>
              <span className="text-[10px] text-[var(--vscode-descriptionForeground)]">{step.description}</span>
            </div>
          </div>
        ))}
      </div>

      <Button variant="primary" size="md" onClick={onOpenSettings} className="mt-1">
        <Settings2 size={12} className="mr-1.5" />
        Open Settings
      </Button>
    </div>
  )
}
