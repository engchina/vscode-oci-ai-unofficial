import ChatView from "./components/chat/ChatView"
import Navbar from "./components/menu/Navbar"
import SettingsView from "./components/settings/SettingsView"
import { useExtensionState } from "./context/ExtensionStateContext"
import { Providers } from "./Providers"

function AppContent() {
  const { didHydrateState, currentView, navigateToSettings, navigateToChat, navigateToHistory, newChat } =
    useExtensionState()

  if (!didHydrateState) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <div className="text-description text-sm">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-full flex-col">
      {currentView === "settings" ? (
        <SettingsView onDone={navigateToChat} />
      ) : (
        <>
          <Navbar onNewChat={newChat} onHistory={navigateToHistory} onSettings={navigateToSettings} />
          <ChatView isHidden={false} />
        </>
      )}
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
