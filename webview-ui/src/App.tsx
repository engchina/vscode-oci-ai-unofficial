import { useEffect, useMemo, useState, type ReactNode } from "react"
import { AudioLines, Bot, Database, History, Layers, MessageSquareText, Network, Server, Settings2, Shield, SquareTerminal } from "lucide-react"
import AdbView from "./components/adb/AdbView"
import ChatView from "./components/chat/ChatView"
import ComputeView from "./components/compute/ComputeView"
import DbSystemsView from "./components/dbsystems/DbSystemsView"
import HistoryView from "./components/history/HistoryView"
import ObjectStorageView from "./components/objectstorage/ObjectStorageView"
import SpeechView from "./components/speech/SpeechView"
import BastionView from "./components/bastion/BastionView"
import CreateBastionSessionView from "./components/bastion/CreateBastionSessionView"
import SettingsView, { SETTINGS_TABS, type SettingsTab } from "./components/settings/SettingsView"
import SqlWorkbenchView from "./components/sql/SqlWorkbenchView"
import Card from "./components/ui/Card"
import StatusBadge from "./components/ui/StatusBadge"
import VcnView from "./components/vcn/VcnView"
import {
  WorkbenchActionButton,
  WorkbenchNavigationCluster,
  WorkbenchNavigationButton,
  WorkbenchShortcutTileButton,
} from "./components/workbench/WorkbenchActionButtons"
import HomeView from "./components/workbench/HomeView"
import { WorkbenchLoadingState } from "./components/workbench/DatabaseWorkbenchChrome"
import { openViewLabel } from "./components/workbench/navigationLabels"
import WorkbenchShell, {
  type WorkbenchPrimaryItem,
  type WorkbenchSecondaryGroup,
  type WorkbenchSecondaryItem,
} from "./components/workbench/WorkbenchShell"
import { Providers } from "./Providers"
import { useExtensionState, type ViewType } from "./context/ExtensionStateContext"
import { StateServiceClient } from "./services/grpc-client"

type PrimarySection = "home" | "assistant" | "resources" | "databases" | "administration"
type WorkbenchView = ViewType

interface ViewDefinition {
  id: WorkbenchView
  label: string
  description: string
  primary: PrimarySection
  icon: ReactNode
}



const VIEW_DEFINITIONS: Record<WorkbenchView, ViewDefinition> = {
  home: {
    id: "home",
    label: "Home",
    description: "Landing page with quick actions, environment context, and recent destinations.",
    primary: "home",
    icon: <Layers size={15} />,
  },
  chat: {
    id: "chat",
    label: "Chat",
    description: "Prompt the assistant with OCI-aware context and coding support.",
    primary: "assistant",
    icon: <MessageSquareText size={15} />,
  },
  history: {
    id: "history",
    label: "History",
    description: "Review prior assistant responses and clear the current thread.",
    primary: "assistant",
    icon: <History size={15} />,
  },
  vcn: {
    id: "vcn",
    label: "VCN",
    description: "Inspect VCNs, regions, and attached security lists.",
    primary: "resources",
    icon: <Network size={15} />,
  },
  compute: {
    id: "compute",
    label: "Compute",
    description: "Browse instances and launch SSH workflows from the workbench.",
    primary: "resources",
    icon: <Server size={15} />,
  },
  bastion: {
    id: "bastion",
    label: "Bastion",
    description: "Manage Bastions, secure sessions, and SSH command handoff.",
    primary: "resources",
    icon: <Shield size={15} />,
  },
  bastionSession: {
    id: "bastionSession",
    label: "Create Bastion Session",
    description: "Create a managed SSH or port-forwarding Bastion session on a dedicated page.",
    primary: "resources",
    icon: <Shield size={15} />,
  },
  objectStorage: {
    id: "objectStorage",
    label: "Object Storage",
    description: "Manage buckets and objects without leaving the current workspace.",
    primary: "resources",
    icon: <Layers size={15} />,
  },
  speech: {
    id: "speech",
    label: "Speech",
    description: "Create and track OCI Speech transcription jobs with Object Storage inputs.",
    primary: "resources",
    icon: <AudioLines size={15} />,
  },
  speechJob: {
    id: "speechJob",
    label: "Speech Job",
    description: "Inspect a single Speech transcription job, its tasks, inline results, and effective configuration.",
    primary: "resources",
    icon: <AudioLines size={15} />,
  },
  speechWorkspace: {
    id: "speechWorkspace",
    label: "Speech Workspace",
    description: "Compose Speech transcription jobs in a dedicated workspace with supported media inputs only.",
    primary: "resources",
    icon: <AudioLines size={15} />,
  },
  adb: {
    id: "adb",
    label: "Autonomous Database",
    description: "Work with Autonomous Database resources and lifecycle actions.",
    primary: "databases",
    icon: <Database size={15} />,
  },
  dbSystems: {
    id: "dbSystems",
    label: "DB Systems",
    description: "Browse Base Database Service systems and related operations.",
    primary: "databases",
    icon: <Database size={15} />,
  },
  sqlWorkbench: {
    id: "sqlWorkbench",
    label: "SQL Workbench",
    description: "Connect, execute SQL, explain plans, and reuse history and favorites.",
    primary: "databases",
    icon: <SquareTerminal size={15} />,
  },
  settings: {
    id: "settings",
    label: "Settings",
    description: "Manage profiles, compartments, terminal preferences, and AI settings.",
    primary: "administration",
    icon: <Settings2 size={15} />,
  },
}

const PRIMARY_ITEMS: WorkbenchPrimaryItem[] = [
  { id: "home", label: "Home", icon: <Layers size={18} /> },
  { id: "assistant", label: "Assistant", icon: <Bot size={18} /> },
  { id: "resources", label: "Resources", icon: <Network size={18} /> },
  { id: "databases", label: "Databases", icon: <Database size={18} /> },
  { id: "administration", label: "Settings", icon: <Settings2 size={18} /> },
]

const DEFAULT_VIEW_BY_PRIMARY: Record<PrimarySection, WorkbenchView> = {
  home: "home",
  assistant: "chat",
  resources: "vcn",
  databases: "sqlWorkbench",
  administration: "settings",
}

const PRIMARY_GROUPS: Record<Exclude<PrimarySection, "home">, WorkbenchSecondaryGroup[]> = {
  assistant: [
    {
      title: "Assistant",
      items: [toSecondaryItem("chat"), toSecondaryItem("history")],
    },
  ],
  resources: [
    {
      title: "Resources",
      items: [toSecondaryItem("vcn"), toSecondaryItem("compute"), toSecondaryItem("bastion"), toSecondaryItem("objectStorage"), toSecondaryItem("speech")],
    },
  ],
  databases: [
    {
      title: "Databases",
      items: [toSecondaryItem("adb"), toSecondaryItem("dbSystems"), toSecondaryItem("sqlWorkbench")],
    },
  ],
  administration: [
    {
      title: "Settings",
      items: SETTINGS_TABS.map(toSettingsSecondaryItem),
    },
  ],
}

const HOME_GROUPS: WorkbenchSecondaryGroup[] = [
  {
    title: "Start Here",
    items: [toSecondaryItem("home"), toSecondaryItem("chat"), toSecondaryItem("settings")],
  },
  {
    title: "Explore",
    items: [toSecondaryItem("vcn"), toSecondaryItem("compute"), toSecondaryItem("speech"), toSecondaryItem("adb")],
  },
]

const HOME_ACTIONS = [
  "chat",
  "vcn",
  "compute",
  "bastion",
  "objectStorage",
  "speech",
  "adb",
  "settings",
] as const satisfies readonly WorkbenchView[]





const NAVIGATION_VIEW_BY_CONTEXT: Partial<Record<WorkbenchView, WorkbenchView>> = {
  bastionSession: "bastion",
  speechJob: "speech",
  speechWorkspace: "speech",
}

function AppContent() {
  const {
    didHydrateState,
    currentView,
    navigateToView,
    newChat,
    clearHistory,
    chatMessages,
    profilesConfig,
    activeProfile,
    region,
    compartmentId,
    chatCompartmentId,
    computeCompartmentIds,
    adbCompartmentIds,
    dbSystemCompartmentIds,
    vcnCompartmentIds,
    objectStorageCompartmentIds,
    bastionCompartmentIds,
    genAiRegion,
    genAiLlmModelId,
    isStreaming,
    configWarning,
    sqlWorkbench,
  } = useExtensionState()
  const [navQuery, setNavQuery] = useState("")
  const [recentViews, setRecentViews] = useState<WorkbenchView[]>(["chat", "adb", "settings"])
  const [lastViewByPrimary, setLastViewByPrimary] = useState<Record<PrimarySection, WorkbenchView>>(DEFAULT_VIEW_BY_PRIMARY)
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("api-config")

  const hasProfiles = Array.isArray(profilesConfig) && profilesConfig.length > 0
  const activeView = currentView
  const activeNavigationView = getNavigationView(activeView)
  const activePrimary = VIEW_DEFINITIONS[activeNavigationView].primary

  useEffect(() => {
    setLastViewByPrimary((previous) => ({
      ...previous,
      [activePrimary]: activeNavigationView,
    }))
  }, [activeNavigationView, activePrimary])

  useEffect(() => {
    if (!didHydrateState || activeNavigationView === "home") {
      return
    }
    setRecentViews((previous) => [activeNavigationView, ...previous.filter((view) => view !== activeNavigationView)].slice(0, 6))
  }, [activeNavigationView, didHydrateState])

  const secondaryGroups = useMemo(
    () => getSecondaryGroups(activePrimary, navQuery),
    [activePrimary, navQuery],
  )

  const homeQuickActions = useMemo(
    () => HOME_ACTIONS.map((viewId) => ({
      id: viewId,
      label: VIEW_DEFINITIONS[viewId].label,
      description: VIEW_DEFINITIONS[viewId].description,
      icon: VIEW_DEFINITIONS[viewId].icon,
    })),
    [],
  )

  const homeRecentItems = useMemo(
    () =>
      recentViews
        .filter((view) => view !== "home")
        .map((view) => ({
          id: view,
          label: VIEW_DEFINITIONS[view].label,
          description: VIEW_DEFINITIONS[view].description,
        })),
    [recentViews],
  )

  if (!didHydrateState) {
    return (
      <div className="flex h-full w-full min-h-0 flex-col bg-[var(--vscode-sideBar-background)] p-4">
        <WorkbenchLoadingState label="Loading workspace..." className="h-full" />
      </div>
    )
  }

  const handleSelectPrimary = (primaryId: string) => {
    const primary = primaryId as PrimarySection
    navigateToView(lastViewByPrimary[primary] ?? DEFAULT_VIEW_BY_PRIMARY[primary])
  }

  const handleSelectView = (viewId: string) => {
    if (viewId.startsWith("settings:")) {
      const settingsTab = viewId.slice("settings:".length) as SettingsTab
      setActiveSettingsTab(settingsTab)
      navigateToView("settings")
      return
    }
    navigateToView(viewId as WorkbenchView)
  }

  return (
    <WorkbenchShell
      appTitle="OCI Workbench"
      appSubtitle={VIEW_DEFINITIONS[activeView].label}
      searchValue={navQuery}
      onSearchChange={setNavQuery}
      primaryItems={PRIMARY_ITEMS}
      activePrimaryId={activePrimary}
      onSelectPrimary={handleSelectPrimary}
      secondaryGroups={secondaryGroups}
      activeViewId={activeView === "settings" ? toSettingsNavId(activeSettingsTab) : activeNavigationView}
      onSelectView={handleSelectView}
      headerMeta={
        <>
          <HeaderBadge label="Profile" value={activeProfile || "Not set"} />
          <HeaderBadge label="Region" value={region || "Not set"} />
          <HeaderBadge label="GenAI" value={genAiRegion || "Not set"} />
        </>
      }
      headerActions={
        <div className="flex items-center gap-2">
          <WorkbenchNavigationCluster>
            <TopActionButton label={openViewLabel("Home")} active={activeView === "home"} onClick={() => navigateToView("home")} />
            <TopActionButton label={openViewLabel("Chat")} active={activeView === "chat"} onClick={() => navigateToView("chat")} />
            <TopActionButton label={openViewLabel("Settings")} active={activeView === "settings"} onClick={() => navigateToView("settings")} />
          </WorkbenchNavigationCluster>
          <WorkbenchActionButton type="button" variant="secondary" onClick={() => void StateServiceClient.switchProfile()}>
            Switch Profile
          </WorkbenchActionButton>
        </div>
      }

      statusBar={
        <div className="flex w-full items-center justify-between gap-4 text-[11px] text-[var(--vscode-descriptionForeground)]">
          <div className="flex items-center gap-4">
            <span>View: {VIEW_DEFINITIONS[activeView].label}</span>
            <span>Messages: {chatMessages.length}</span>
            <span>SQL favorites: {sqlWorkbench.favorites.length}</span>
          </div>
          <div className="flex items-center gap-4">
            <span>Profiles: {profilesConfig.length}</span>
            <span>{hasProfiles ? "OCI ready" : "Setup required"}</span>
          </div>
        </div>
      }
    >
      {renderActiveView({
        activeView,
        hasProfiles,
        homeQuickActions,
        homeRecentItems,
        activeProfile,
        region,
        genAiRegion,
        profilesCount: profilesConfig.length,
        chatCount: chatMessages.length,
        onSelectView: navigateToView,
        onNewChat: newChat,
        onClearHistory: clearHistory,
        onOpenHistory: () => navigateToView("history"),
        onReturnToChat: () => navigateToView("chat"),
        messages: chatMessages,
        activeSettingsTab,
      })}
    </WorkbenchShell>
  )
}

function renderActiveView({
  activeView,
  hasProfiles,
  homeQuickActions,
  homeRecentItems,
  activeProfile,
  region,
  genAiRegion,
  profilesCount,
  chatCount,
  onSelectView,
  onNewChat,
  onClearHistory,
  onOpenHistory,
  onReturnToChat,
  messages,
  activeSettingsTab,
}: {
  activeView: WorkbenchView
  hasProfiles: boolean
  homeQuickActions: Array<{ id: string; label: string; description: string; icon: ReactNode }>
  homeRecentItems: Array<{ id: string; label: string; description: string }>
  activeProfile: string
  region: string
  genAiRegion: string
  profilesCount: number
  chatCount: number
  onSelectView: (view: WorkbenchView) => void
  onNewChat: () => void
  onClearHistory: () => void
  onOpenHistory: () => void
  onReturnToChat: () => void
  messages: Array<{ role: "user" | "model"; text: string }>
  activeSettingsTab: SettingsTab
}) {
  switch (activeView) {
    case "home":
      return (
        <HomeView
          hasProfiles={hasProfiles}
          activeProfile={activeProfile}
          region={region}
          genAiRegion={genAiRegion}
          profilesCount={profilesCount}
          chatCount={chatCount}
          quickActions={homeQuickActions}
          recentItems={homeRecentItems}
          onOpenAction={(view) => onSelectView(view as WorkbenchView)}
          onOpenSettings={() => onSelectView("settings")}
        />
      )
    case "chat":
      return (
        <ChatView isHidden={false} onNewChat={onNewChat} onHistory={onOpenHistory} />
      )
    case "history":
      return <HistoryView messages={messages} onBack={onReturnToChat} onClear={onClearHistory} />
    case "vcn":
      return <VcnView />
    case "compute":
      return <ComputeView />
    case "objectStorage":
      return <ObjectStorageView />
    case "speech":
      return <SpeechView mode="inventory" />
    case "speechJob":
      return <SpeechView mode="job" />
    case "speechWorkspace":
      return <SpeechView mode="workspace" />
    case "bastion":
      return <BastionView />
    case "bastionSession":
      return <CreateBastionSessionView />
    case "adb":
      return <AdbView />
    case "dbSystems":
      return <DbSystemsView />
    case "sqlWorkbench":
      return <SqlWorkbenchView />
    case "settings":
      return <SettingsView activeTab={activeSettingsTab} showDone={false} />
    default:
      return null
  }
}

function HeaderBadge({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_90%,white_10%)] px-2.5 py-1 text-[10px]">
      <span className="uppercase tracking-[0.16em] text-[var(--vscode-descriptionForeground)]">{label}</span>
      <span className="max-w-32 truncate text-[var(--vscode-foreground)]">{value}</span>
    </div>
  )
}

function TopActionButton({ label, onClick, active = false }: { label: string; onClick: () => void; active?: boolean }) {
  return (
    <WorkbenchNavigationButton type="button" active={active} onClick={onClick}>
      {label}
    </WorkbenchNavigationButton>
  )
}



function getSecondaryGroups(activePrimary: PrimarySection, navQuery: string): WorkbenchSecondaryGroup[] {
  const normalizedQuery = navQuery.trim().toLowerCase()
  const baseGroups = activePrimary === "home" ? HOME_GROUPS : PRIMARY_GROUPS[activePrimary as Exclude<PrimarySection, "home">]

  if (!normalizedQuery) {
    return baseGroups
  }

  const allGroups = [HOME_GROUPS, ...Object.values(PRIMARY_GROUPS)].flat()
  return allGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const searchable = `${item.label} ${item.description}`.toLowerCase()
        return searchable.includes(normalizedQuery)
      }),
    }))
    .filter((group) => group.items.length > 0)
}

function toSecondaryItem(view: WorkbenchView): WorkbenchSecondaryItem {
  const definition = VIEW_DEFINITIONS[view]
  return {
    id: definition.id,
    label: definition.label,
    description: definition.description,
    icon: definition.icon,
  }
}

function toSettingsSecondaryItem(tab: (typeof SETTINGS_TABS)[number]): WorkbenchSecondaryItem {
  return {
    id: toSettingsNavId(tab.id),
    label: tab.label,
    description: tab.description,
    icon: tab.icon,
  }
}

function toSettingsNavId(tab: SettingsTab): string {
  return `settings:${tab}`
}

function getNavigationView(view: WorkbenchView): WorkbenchView {
  return NAVIGATION_VIEW_BY_CONTEXT[view] ?? view
}

export default function App() {
  return (
    <Providers>
      <AppContent />
    </Providers>
  )
}
