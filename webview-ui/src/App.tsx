import { useState } from "react"
import AdbView from "./components/adb/AdbView"
import DbSystemsView from "./components/dbsystems/DbSystemsView"
import ChatView from "./components/chat/ChatView"
import ComputeView from "./components/compute/ComputeView"
import SqlWorkbenchView from "./components/sql/SqlWorkbenchView"
import VcnView from "./components/vcn/VcnView"
import HistoryView from "./components/history/HistoryView"
import Navbar from "./components/menu/Navbar"
import ObjectStorageView from "./components/objectstorage/ObjectStorageView"
import SettingsView from "./components/settings/SettingsView"
import { useExtensionState } from "./context/ExtensionStateContext"
import { Providers } from "./Providers"
import { AccordionItem } from "./components/ui/Accordion"

function AppContent() {
  const {
    didHydrateState,
    currentView,
    navigateToHistory,
    navigateToChat,
    newChat,
    clearHistory,
    chatMessages
  } = useExtensionState()

  // Keep the default expanded section aligned with the default chat landing view.
  const [openSection, setOpenSection] = useState<string>("chat")

  if (!didHydrateState) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-[var(--vscode-sideBar-background)]">
        <div className="text-[var(--vscode-descriptionForeground)] text-sm">Loading...</div>
      </div>
    )
  }

  const toggleSection = (section: string) => {
    setOpenSection(prev => prev === section ? "" : section)
  }

  return (
    <div className="flex h-full w-full flex-col bg-[var(--vscode-sideBar-background)] overflow-hidden">
      <AccordionItem
        title="Settings"
        isOpen={openSection === "settings"}
        onToggle={() => toggleSection("settings")}
      >
        <div className="flex flex-col h-full w-full px-0">
          <SettingsView showDone={false} />
        </div>
      </AccordionItem>

      <AccordionItem
        title="Generative AI Chat"
        isOpen={openSection === "chat"}
        onToggle={() => toggleSection("chat")}
      >
        <div className="flex flex-col h-full">
          <Navbar onNewChat={newChat} onHistory={navigateToHistory} />
          {currentView === "history" ? (
            <HistoryView
              messages={chatMessages}
              onBack={navigateToChat}
              onClear={clearHistory}
            />
          ) : (
            <ChatView isHidden={false} />
          )}
        </div>
      </AccordionItem>

      <AccordionItem
        title="Virtual Cloud Networks"
        isOpen={openSection === "vcn"}
        onToggle={() => toggleSection("vcn")}
      >
        <div className="flex flex-col h-full">
          <VcnView />
        </div>
      </AccordionItem>

      <AccordionItem
        title="Compute Instances"
        isOpen={openSection === "compute"}
        onToggle={() => toggleSection("compute")}
      >
        <div className="flex flex-col h-full">
          <ComputeView />
        </div>
      </AccordionItem>

      <AccordionItem
        title="Object Storage"
        isOpen={openSection === "objectStorage"}
        onToggle={() => toggleSection("objectStorage")}
      >
        <div className="flex flex-col h-full">
          <ObjectStorageView />
        </div>
      </AccordionItem>

      <AccordionItem
        title="Autonomous AI Database"
        isOpen={openSection === "adb"}
        onToggle={() => toggleSection("adb")}
      >
        <div className="flex flex-col h-full">
          <AdbView />
        </div>
      </AccordionItem>

      <AccordionItem
        title="Oracle Base Database Service"
        isOpen={openSection === "dbsystem"}
        onToggle={() => toggleSection("dbsystem")}
      >
        <div className="flex flex-col h-full">
          <DbSystemsView />
        </div>
      </AccordionItem>

      <AccordionItem
        title="SQL Workbench"
        isOpen={openSection === "sqlWorkbench"}
        onToggle={() => toggleSection("sqlWorkbench")}
      >
        <div className="flex flex-col h-full">
          <SqlWorkbenchView />
        </div>
      </AccordionItem>
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
