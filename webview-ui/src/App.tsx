import AdbView from "./components/adb/AdbView"
import ChatView from "./components/chat/ChatView"
import ComputeView from "./components/compute/ComputeView"
import Navbar from "./components/menu/Navbar"
import SettingsView from "./components/settings/SettingsView"
import { useExtensionState } from "./context/ExtensionStateContext"
import { Providers } from "./Providers"

type HostView = "chat" | "settings" | "compute" | "adb"

function getHostView(): HostView {
  const hostView = (globalThis as typeof globalThis & { __OCI_AI_HOST_VIEW__?: HostView }).__OCI_AI_HOST_VIEW__
  if (hostView === "settings") return "settings"
  if (hostView === "compute") return "compute"
  if (hostView === "adb") return "adb"
  return "chat"
}

function AppContent() {
  const { didHydrateState, navigateToHistory, newChat } = useExtensionState()
  const hostView = getHostView()

  if (!didHydrateState) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <div className="text-description text-sm">Loading...</div>
      </div>
    )
  }

  if (hostView === "settings") {
    return (
      <div className="flex h-screen w-full flex-col">
        <SettingsView showDone={false} />
      </div>
    )
  }

  if (hostView === "compute") {
    return (
      <div className="flex h-screen w-full flex-col">
        <ComputeView />
      </div>
    )
  }

  if (hostView === "adb") {
    return (
      <div className="flex h-screen w-full flex-col">
        <AdbView />
      </div>
    )
  }

  return (
    <div className="flex h-screen w-full flex-col">
      <Navbar onNewChat={newChat} onHistory={navigateToHistory} />
      <ChatView isHidden={false} />
    </div>
  )
}

export default function App() {
  return (
    <Providers>
      <AppContent />
    </Providers>
  )
}
