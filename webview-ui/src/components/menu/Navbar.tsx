import { History, Plus } from "lucide-react"

interface NavbarProps {
  onNewChat: () => void
  onHistory: () => void
}

export default function Navbar({ onNewChat, onHistory }: NavbarProps) {
  return (
    <div className="flex items-center justify-end gap-0.5 px-2 py-1">
      <NavButton icon={<Plus size={16} />} title="New Task" onClick={onNewChat} />
      <NavButton icon={<History size={16} />} title="History" onClick={onHistory} />
    </div>
  )
}

function NavButton({
  icon,
  title,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-7 w-7 items-center justify-center rounded-md text-description transition-colors hover:bg-list-background-hover hover:text-foreground"
    >
      {icon}
    </button>
  )
}
