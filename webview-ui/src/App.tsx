import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Bot, Database, History, Layers, MessageSquareText, Network, Server, Settings2, SquareTerminal } from "lucide-react"
import AdbView from "./components/adb/AdbView"
import ChatView from "./components/chat/ChatView"
import ComputeView from "./components/compute/ComputeView"
import DbSystemsView from "./components/dbsystems/DbSystemsView"
import HistoryView from "./components/history/HistoryView"
import Navbar from "./components/menu/Navbar"
import ObjectStorageView from "./components/objectstorage/ObjectStorageView"
import SettingsView, { SETTINGS_TABS, type SettingsTab } from "./components/settings/SettingsView"
import SqlWorkbenchView from "./components/sql/SqlWorkbenchView"
import Card from "./components/ui/Card"
import StatusBadge from "./components/ui/StatusBadge"
import VcnView from "./components/vcn/VcnView"
import {
  WorkbenchActionButton,
  WorkbenchCompactActionCluster,
  WorkbenchShortcutTileButton,
} from "./components/workbench/WorkbenchActionButtons"
import HomeView from "./components/workbench/HomeView"
import { WorkbenchLoadingState } from "./components/workbench/DatabaseWorkbenchChrome"
import WorkbenchShell, {
  type WorkbenchPrimaryItem,
  type WorkbenchSecondaryGroup,
  type WorkbenchSecondaryItem,
} from "./components/workbench/WorkbenchShell"
import { Providers } from "./Providers"
import { useExtensionState, type ViewType } from "./context/ExtensionStateContext"
import { useWorkbenchInsight, type WorkbenchInsightBadge, type WorkbenchInsightResource } from "./context/WorkbenchInsightContext"
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

interface InsightMetric {
  label: string
  value: string
}

interface InsightChecklistItem {
  label: string
  done: boolean
  help: string
}

interface InsightModel {
  sectionTitle: string
  summary: string
  metrics: InsightMetric[]
  readiness: InsightChecklistItem[]
  workflowTitle: string
  workflow: string[]
  related: WorkbenchView[]
}

const VIEW_DEFINITIONS: Record<WorkbenchView, ViewDefinition> = {
  home: {
    id: "home",
    label: "Overview",
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
  objectStorage: {
    id: "objectStorage",
    label: "Object Storage",
    description: "Manage buckets and objects without leaving the current workspace.",
    primary: "resources",
    icon: <Layers size={15} />,
  },
  adb: {
    id: "adb",
    label: "Autonomous DB",
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
  { id: "administration", label: "Admin", icon: <Settings2 size={18} /> },
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
      items: [toSecondaryItem("vcn"), toSecondaryItem("compute"), toSecondaryItem("objectStorage")],
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
      title: "Administration",
      items: SETTINGS_TABS.map(toSettingsSecondaryItem),
    },
  ],
}

const HOME_GROUPS: WorkbenchSecondaryGroup[] = [
  {
    title: "Start Here",
    items: [toSecondaryItem("home"), toSecondaryItem("settings"), toSecondaryItem("chat")],
  },
  {
    title: "Explore",
    items: [toSecondaryItem("vcn"), toSecondaryItem("compute"), toSecondaryItem("sqlWorkbench")],
  },
]

const HOME_ACTIONS = [
  "chat",
  "vcn",
  "compute",
  "objectStorage",
  "sqlWorkbench",
  "settings",
] as const satisfies readonly WorkbenchView[]

const GROUP_PLAYBOOKS: Record<PrimarySection, { title: string; actions: WorkbenchView[] }> = {
  home: {
    title: "Suggested routes",
    actions: ["chat", "vcn", "sqlWorkbench"],
  },
  assistant: {
    title: "Assistant flow",
    actions: ["chat", "history", "settings"],
  },
  resources: {
    title: "Resource flow",
    actions: ["vcn", "compute", "objectStorage"],
  },
  databases: {
    title: "Database flow",
    actions: ["adb", "dbSystems", "sqlWorkbench"],
  },
  administration: {
    title: "Administration flow",
    actions: ["settings", "chat"],
  },
}

const VIEW_WORKFLOWS: Record<WorkbenchView, { workflowTitle: string; workflow: string[]; related: WorkbenchView[] }> = {
  home: {
    workflowTitle: "Landing flow",
    workflow: [
      "Check profile, region, and GenAI readiness before opening an operational workspace.",
      "Jump into the feature you use most often from quick actions or recent views.",
      "Use Settings when a profile, compartment mapping, or model region is missing.",
    ],
    related: ["chat", "vcn", "sqlWorkbench"],
  },
  chat: {
    workflowTitle: "Assistant flow",
    workflow: [
      "Start a fresh chat for a new task boundary so context stays focused.",
      "Use OCI-aware prompts once profile, region, and GenAI settings are ready.",
      "Open History when you need to revisit or clean up the active thread.",
    ],
    related: ["history", "settings", "home"],
  },
  history: {
    workflowTitle: "Review flow",
    workflow: [
      "Scan prior prompts and model output before restarting the conversation.",
      "Clear the thread when the current topic is done or context has drifted.",
      "Return to Chat to continue with a clean prompt and tighter scope.",
    ],
    related: ["chat", "settings", "home"],
  },
  vcn: {
    workflowTitle: "Network flow",
    workflow: [
      "Select a VCN from the inventory and review region and lifecycle status first.",
      "Inspect attached security lists from the same workspace before changing network-adjacent resources.",
      "Jump to Compute after confirming network placement and reachability assumptions.",
    ],
    related: ["compute", "objectStorage", "settings"],
  },
  compute: {
    workflowTitle: "Compute flow",
    workflow: [
      "Select an instance, confirm lifecycle state, and review compartment scope.",
      "Use the right-side details to decide whether SSH or follow-up resource checks are needed.",
      "Switch to VCN when you need to verify network placement or security-list context.",
    ],
    related: ["vcn", "objectStorage", "settings"],
  },
  objectStorage: {
    workflowTitle: "Storage flow",
    workflow: [
      "Pick a bucket from the inventory before drilling into object operations.",
      "Use the master-detail workspace to keep bucket selection stable while browsing objects.",
      "Open SQL Workbench or Compute if the storage action depends on downstream workloads.",
    ],
    related: ["compute", "sqlWorkbench", "settings"],
  },
  adb: {
    workflowTitle: "ADB flow",
    workflow: [
      "Select a database from the inventory, then confirm lifecycle and region in the workbench header.",
      "Download a wallet, complete the connection profile, and keep diagnostics close by.",
      "Move into SQL Workbench when you want a fuller editor, snippet library, and assistant flow.",
    ],
    related: ["sqlWorkbench", "dbSystems", "settings"],
  },
  dbSystems: {
    workflowTitle: "DB System flow",
    workflow: [
      "Choose a DB System and verify lifecycle, network reachability, and selected connect string.",
      "Keep connection diagnostics and SSH context nearby before executing SQL or remote actions.",
      "Jump to SQL Workbench for a deeper editor-centric workflow once the target is known.",
    ],
    related: ["sqlWorkbench", "adb", "settings"],
  },
  sqlWorkbench: {
    workflowTitle: "SQL toolbench flow",
    workflow: [
      "Pick a target from the left inventory, then complete the connection profile in the same column.",
      "Use the editor for execution, then move between Results, Library, and AI Assistant tabs without leaving the page.",
      "Return to ADB or DB Systems when you need resource-level lifecycle or infrastructure context.",
    ],
    related: ["adb", "dbSystems", "settings"],
  },
  settings: {
    workflowTitle: "Configuration flow",
    workflow: [
      "Set up or switch OCI profiles before using resource and database features.",
      "Map compartments for each feature area so inventory views have scope to load.",
      "Configure GenAI region and model selections before relying on chat or SQL assistance.",
    ],
    related: ["home", "chat", "sqlWorkbench"],
  },
}

function AppContent() {
  const { resource: resourceInsight } = useWorkbenchInsight()
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
    genAiRegion,
    genAiLlmModelId,
    isStreaming,
    configWarning,
    sqlWorkbench,
  } = useExtensionState()
  const [navQuery, setNavQuery] = useState("")
  const [recentViews, setRecentViews] = useState<WorkbenchView[]>(["chat", "sqlWorkbench", "settings"])
  const [lastViewByPrimary, setLastViewByPrimary] = useState<Record<PrimarySection, WorkbenchView>>(DEFAULT_VIEW_BY_PRIMARY)
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>("api-config")

  const hasProfiles = Array.isArray(profilesConfig) && profilesConfig.length > 0
  const activeView = currentView
  const activePrimary = VIEW_DEFINITIONS[activeView].primary

  useEffect(() => {
    setLastViewByPrimary((previous) => ({
      ...previous,
      [activePrimary]: activeView,
    }))
  }, [activePrimary, activeView])

  useEffect(() => {
    if (!didHydrateState || activeView === "home") {
      return
    }
    setRecentViews((previous) => [activeView, ...previous.filter((view) => view !== activeView)].slice(0, 6))
  }, [activeView, didHydrateState])

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
      activeViewId={activeView === "settings" ? toSettingsNavId(activeSettingsTab) : activeView}
      onSelectView={handleSelectView}
      headerMeta={
        <>
          <HeaderBadge label="Profile" value={activeProfile || "Not set"} />
          <HeaderBadge label="Region" value={region || "Not set"} />
          <HeaderBadge label="GenAI" value={genAiRegion || "Not set"} />
        </>
      }
      headerActions={
        <>
          <TopActionButton label="Home" onClick={() => navigateToView("home")} />
          <TopActionButton label="Chat" onClick={() => navigateToView("chat")} />
          <TopActionButton label="Profile" onClick={() => void StateServiceClient.switchProfile()} />
          <TopActionButton label="Settings" onClick={() => navigateToView("settings")} />
        </>
      }
      aside={
        <WorkbenchInsightPanel
          activeView={activeView}
          hasProfiles={hasProfiles}
          activeProfile={activeProfile}
          region={region}
          compartmentId={compartmentId}
          chatCompartmentId={chatCompartmentId}
          computeCompartmentCount={computeCompartmentIds.length}
          adbCompartmentCount={adbCompartmentIds.length}
          dbSystemCompartmentCount={dbSystemCompartmentIds.length}
          vcnCompartmentCount={vcnCompartmentIds.length}
          objectStorageCompartmentCount={objectStorageCompartmentIds.length}
          genAiRegion={genAiRegion}
          genAiLlmModelId={genAiLlmModelId}
          isStreaming={isStreaming}
          configWarning={configWarning}
          chatCount={chatMessages.length}
          favoriteSqlCount={sqlWorkbench.favorites.length}
          sqlHistoryCount={sqlWorkbench.history.length}
          profilesCount={profilesConfig.length}
          resourceInsight={resourceInsight}
          recentViews={homeRecentItems}
          onSelectView={navigateToView}
        />
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
        <div className="flex h-full min-h-0 flex-col">
          <Navbar onNewChat={onNewChat} onHistory={onOpenHistory} />
          <ChatView isHidden={false} />
        </div>
      )
    case "history":
      return <HistoryView messages={messages} onBack={onReturnToChat} onClear={onClearHistory} />
    case "vcn":
      return <VcnView />
    case "compute":
      return <ComputeView />
    case "objectStorage":
      return <ObjectStorageView />
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
    <div className="inline-flex items-center gap-2 rounded-full border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_90%,white_10%)] px-3 py-1.5 text-[11px]">
      <span className="uppercase tracking-[0.16em] text-[var(--vscode-descriptionForeground)]">{label}</span>
      <span className="max-w-32 truncate text-[var(--vscode-foreground)]">{value}</span>
    </div>
  )
}

function TopActionButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <WorkbenchActionButton type="button" variant="secondary" onClick={onClick}>
      {label}
    </WorkbenchActionButton>
  )
}

function WorkbenchInsightPanel({
  activeView,
  hasProfiles,
  activeProfile,
  region,
  compartmentId,
  chatCompartmentId,
  computeCompartmentCount,
  adbCompartmentCount,
  dbSystemCompartmentCount,
  vcnCompartmentCount,
  objectStorageCompartmentCount,
  genAiRegion,
  genAiLlmModelId,
  isStreaming,
  configWarning,
  chatCount,
  favoriteSqlCount,
  sqlHistoryCount,
  profilesCount,
  resourceInsight,
  recentViews,
  onSelectView,
}: {
  activeView: WorkbenchView
  hasProfiles: boolean
  activeProfile: string
  region: string
  compartmentId: string
  chatCompartmentId: string
  computeCompartmentCount: number
  adbCompartmentCount: number
  dbSystemCompartmentCount: number
  vcnCompartmentCount: number
  objectStorageCompartmentCount: number
  genAiRegion: string
  genAiLlmModelId: string
  isStreaming: boolean
  configWarning: string
  chatCount: number
  favoriteSqlCount: number
  sqlHistoryCount: number
  profilesCount: number
  resourceInsight: WorkbenchInsightResource | null
  recentViews: Array<{ id: string; label: string; description: string }>
  onSelectView: (view: WorkbenchView) => void
}) {
  const primaryModel = genAiLlmModelId.split(",").map((item) => item.trim()).filter(Boolean)[0] || "Not set"
  const activePrimary = VIEW_DEFINITIONS[activeView].primary
  const playbook = GROUP_PLAYBOOKS[activePrimary]
  const insight = buildInsightModel({
    activeView,
    hasProfiles,
    activeProfile,
    region,
    compartmentId,
    chatCompartmentId,
    genAiRegion,
    primaryModel,
    isStreaming,
    chatCount,
    favoriteSqlCount,
    sqlHistoryCount,
    profilesCount,
    scopeCounts: {
      compute: computeCompartmentCount,
      adb: adbCompartmentCount,
      dbSystems: dbSystemCompartmentCount,
      vcn: vcnCompartmentCount,
      objectStorage: objectStorageCompartmentCount,
    },
  })
  const activeResource = resourceInsight?.view === activeView ? resourceInsight : null

  return (
    <div className="flex flex-col gap-4">
      {activeResource && (
        <Card title="Selection">
          <div className="rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--vscode-descriptionForeground)]">
                  {activeResource.eyebrow}
                </div>
                <div className="mt-2 truncate text-[15px] font-semibold text-[var(--vscode-foreground)]">
                  {activeResource.title}
                </div>
                {activeResource.resourceId && (
                  <div className="mt-1 truncate text-[11px] text-[var(--vscode-descriptionForeground)]">
                    {activeResource.resourceId}
                  </div>
                )}
              </div>
              {activeResource.badge && <InsightBadge badge={activeResource.badge} />}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {activeResource.metrics.map((metric) => (
                <InsightStat key={`resource-${metric.label}`} label={metric.label} value={metric.value} />
              ))}
            </div>
            {activeResource.notes && activeResource.notes.length > 0 && (
              <div className="mt-3 flex flex-col gap-2">
                {activeResource.notes.map((note, index) => (
                  <div
                    key={`${activeResource.view}-note-${index}`}
                    className="rounded-lg border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_96%,white_4%)] px-3 py-2 text-[11px] leading-5 text-[var(--vscode-descriptionForeground)]"
                  >
                    {note}
                  </div>
                ))}
              </div>
            )}
            {activeResource.actions && activeResource.actions.length > 0 && (
              <WorkbenchCompactActionCluster className="mt-3">
                {activeResource.actions.map((action) => (
                  <WorkbenchActionButton
                    key={`${activeResource.view}-${action.label}`}
                    type="button"
                    variant={action.variant ?? "secondary"}
                    onClick={action.run}
                  >
                    {action.label}
                  </WorkbenchActionButton>
                ))}
              </WorkbenchCompactActionCluster>
            )}
          </div>
        </Card>
      )}

      <Card title="Focus">
        <div className="rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 py-3">
          <div className="text-[11px] uppercase tracking-[0.16em] text-[var(--vscode-descriptionForeground)]">Current workspace</div>
          <div className="mt-2 text-[15px] font-semibold text-[var(--vscode-foreground)]">{VIEW_DEFINITIONS[activeView].label}</div>
          <p className="mt-2 text-[12px] leading-5 text-[var(--vscode-descriptionForeground)]">
            {insight.summary}
          </p>
        </div>
      </Card>

      <Card title={insight.sectionTitle}>
        {insight.metrics.map((metric) => (
          <InsightStat key={metric.label} label={metric.label} value={metric.value} />
        ))}
      </Card>

      <Card title="Readiness">
        <div className="flex flex-col gap-2">
          {insight.readiness.map((item) => (
            <ReadinessRow key={item.label} item={item} />
          ))}
        </div>
      </Card>

      <Card title={insight.workflowTitle}>
        <div className="flex flex-col gap-2">
          {insight.workflow.map((step, index) => (
            <div
              key={`${activeView}-workflow-${index}`}
              className="rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 py-3 text-[12px] leading-5 text-[var(--vscode-descriptionForeground)]"
            >
              <span className="mr-2 text-[var(--vscode-foreground)]">{index + 1}.</span>
              {step}
            </div>
          ))}
        </div>
      </Card>

      <Card title={playbook.title}>
        <div className="flex flex-col gap-2">
          {insight.related.map((viewId) => (
            <WorkbenchShortcutTileButton
              key={viewId}
              onClick={() => onSelectView(viewId)}
              title={VIEW_DEFINITIONS[viewId].label}
              description={VIEW_DEFINITIONS[viewId].description}
            />
          ))}
        </div>
      </Card>

      {!hasProfiles && (
        <Card title="Attention">
          <div className="rounded-lg border border-[color-mix(in_srgb,var(--vscode-errorForeground)_30%,transparent)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_88%,red_12%)] px-3 py-3 text-[12px] leading-5 text-[var(--vscode-errorForeground)]">
            OCI access is not configured yet. Open Settings to create a profile and map compartments.
          </div>
        </Card>
      )}

      {configWarning && (
        <Card title="Advisory">
          <div className="rounded-lg border border-[color-mix(in_srgb,var(--vscode-warningForeground)_24%,transparent)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_90%,yellow_10%)] px-3 py-3 text-[12px] leading-5 text-[var(--vscode-warningForeground)]">
            {configWarning}
          </div>
        </Card>
      )}

      <Card title="Recent">
        <div className="flex flex-col gap-2">
          {recentViews.slice(0, 4).map((view) => (
            <WorkbenchShortcutTileButton
              key={view.id}
              onClick={() => onSelectView(view.id as WorkbenchView)}
              title={view.label}
              description={view.description}
            />
          ))}
        </div>
      </Card>
    </div>
  )
}

function InsightStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 py-2.5">
      <span className="text-[11px] uppercase tracking-[0.16em] text-[var(--vscode-descriptionForeground)]">{label}</span>
      <span className="min-w-0 truncate text-[12px] font-medium text-[var(--vscode-foreground)]">{value}</span>
    </div>
  )
}

function ReadinessRow({ item }: { item: InsightChecklistItem }) {
  return (
    <div className="rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium text-[var(--vscode-foreground)]">{item.label}</span>
        <StatusBadge label={item.done ? "Ready" : "Needs setup"} tone={item.done ? "success" : "warning"} />
      </div>
      <div className="mt-2 text-[11px] leading-5 text-[var(--vscode-descriptionForeground)]">{item.help}</div>
    </div>
  )
}

function InsightBadge({ badge }: { badge: WorkbenchInsightBadge }) {
  return <StatusBadge label={badge.label} tone={badge.tone ?? "neutral"} />
}

function buildInsightModel({
  activeView,
  hasProfiles,
  activeProfile,
  region,
  compartmentId,
  chatCompartmentId,
  genAiRegion,
  primaryModel,
  isStreaming,
  chatCount,
  favoriteSqlCount,
  sqlHistoryCount,
  profilesCount,
  scopeCounts,
}: {
  activeView: WorkbenchView
  hasProfiles: boolean
  activeProfile: string
  region: string
  compartmentId: string
  chatCompartmentId: string
  genAiRegion: string
  primaryModel: string
  isStreaming: boolean
  chatCount: number
  favoriteSqlCount: number
  sqlHistoryCount: number
  profilesCount: number
  scopeCounts: Record<"compute" | "adb" | "dbSystems" | "vcn" | "objectStorage", number>
}): InsightModel {
  const workflow = VIEW_WORKFLOWS[activeView]
  const hasGlobalCompartment = Boolean(compartmentId)
  const hasChatScope = Boolean(chatCompartmentId || compartmentId)
  const genAiReady = Boolean(genAiRegion && primaryModel !== "Not set")

  switch (activeView) {
    case "home":
      return {
        sectionTitle: "Workspace health",
        summary: "Use Overview as the control point for configuration health, recent destinations, and the next workspace to open.",
        metrics: [
          { label: "Profiles", value: String(profilesCount) },
          { label: "Active profile", value: activeProfile || "Not set" },
          { label: "Region", value: region || "Not set" },
          { label: "GenAI", value: genAiRegion || "Not set" },
        ],
        readiness: [
          { label: "OCI profile configured", done: hasProfiles, help: "Create and select a profile before opening resource or database workspaces." },
          { label: "Core region selected", done: Boolean(region), help: "Most inventory and database actions depend on a selected OCI region." },
          { label: "GenAI ready", done: genAiReady, help: "Chat and SQL assistant features work best once GenAI region and model are configured." },
        ],
        workflowTitle: workflow.workflowTitle,
        workflow: workflow.workflow,
        related: workflow.related,
      }
    case "chat":
    case "history":
      return {
        sectionTitle: "Assistant context",
        summary: activeView === "chat"
          ? "Chat is optimized for OCI-aware prompts once profile, region, and model settings are ready."
          : "History is the review surface for the active assistant thread and cleanup actions.",
        metrics: [
          { label: "Messages", value: String(chatCount) },
          { label: "Streaming", value: isStreaming ? "Live" : "Idle" },
          { label: "GenAI region", value: genAiRegion || "Not set" },
          { label: "Primary model", value: primaryModel },
        ],
        readiness: [
          { label: "Profile ready", done: hasProfiles, help: "Use Settings if the assistant should operate with OCI context but no profile is configured." },
          { label: "Chat scope mapped", done: hasChatScope, help: "Map a chat compartment or set a default compartment to ground assistant requests." },
          { label: "GenAI configured", done: genAiReady, help: "Choose a GenAI region and model before depending on assistant output." },
        ],
        workflowTitle: workflow.workflowTitle,
        workflow: workflow.workflow,
        related: workflow.related,
      }
    case "vcn":
      return buildScopedResourceInsight({
        sectionTitle: "Network context",
        summary: "VCN works best when a profile and compartment scope are set, so the inventory can stay focused and relevant.",
        scopeCount: scopeCounts.vcn,
        scopeLabel: "VCN scopes",
        hasProfiles,
        activeProfile,
        region,
        workflowTitle: workflow.workflowTitle,
        workflow: workflow.workflow,
        related: workflow.related,
      })
    case "compute":
      return buildScopedResourceInsight({
        sectionTitle: "Compute context",
        summary: "Compute is now a stable master-detail workspace, so the main dependency is clean compartment scope and profile context.",
        scopeCount: scopeCounts.compute,
        scopeLabel: "Compute scopes",
        hasProfiles,
        activeProfile,
        region,
        workflowTitle: workflow.workflowTitle,
        workflow: workflow.workflow,
        related: workflow.related,
      })
    case "objectStorage":
      return buildScopedResourceInsight({
        sectionTitle: "Storage context",
        summary: "Object Storage uses bucket-first navigation, so scope and region readiness matter more than global noise.",
        scopeCount: scopeCounts.objectStorage,
        scopeLabel: "Bucket scopes",
        hasProfiles,
        activeProfile,
        region,
        workflowTitle: workflow.workflowTitle,
        workflow: workflow.workflow,
        related: workflow.related,
      })
    case "adb":
      return buildDatabaseInsight({
        sectionTitle: "ADB readiness",
        summary: "Autonomous Database combines lifecycle operations, wallet-based connection setup, and quick SQL execution in one workspace.",
        scopeCount: scopeCounts.adb,
        scopeLabel: "ADB scopes",
        hasProfiles,
        activeProfile,
        region,
        favoriteSqlCount,
        sqlHistoryCount,
        workflowTitle: workflow.workflowTitle,
        workflow: workflow.workflow,
        related: workflow.related,
      })
    case "dbSystems":
      return buildDatabaseInsight({
        sectionTitle: "DB System readiness",
        summary: "DB Systems mixes infrastructure context, connect strings, SSH-adjacent work, and SQL execution, so profile and scope are critical.",
        scopeCount: scopeCounts.dbSystems,
        scopeLabel: "DB scopes",
        hasProfiles,
        activeProfile,
        region,
        favoriteSqlCount,
        sqlHistoryCount,
        workflowTitle: workflow.workflowTitle,
        workflow: workflow.workflow,
        related: workflow.related,
      })
    case "sqlWorkbench":
      return {
        sectionTitle: "SQL toolbench",
        summary: "SQL Workbench is the editor-centric database surface, with stable target inventory, snippet reuse, and assistant-assisted iteration.",
        metrics: [
          { label: "SQL favorites", value: String(favoriteSqlCount) },
          { label: "SQL history", value: String(sqlHistoryCount) },
          { label: "ADB scopes", value: String(scopeCounts.adb) },
          { label: "DB scopes", value: String(scopeCounts.dbSystems) },
        ],
        readiness: [
          { label: "Database profile ready", done: hasProfiles, help: "Configure an OCI profile before expecting ADB or DB System targets to load." },
          { label: "Database scope mapped", done: scopeCounts.adb + scopeCounts.dbSystems > 0, help: "Map at least one ADB or DB System compartment in Settings." },
          { label: "Region selected", done: Boolean(region), help: "Database inventory and connection metadata depend on a selected region." },
        ],
        workflowTitle: workflow.workflowTitle,
        workflow: workflow.workflow,
        related: workflow.related,
      }
    case "settings":
      return {
        sectionTitle: "Configuration status",
        summary: "Settings is now the configuration center for profiles, feature scopes, terminal behavior, and AI readiness.",
        metrics: [
          { label: "Profiles", value: String(profilesCount) },
          { label: "Default scope", value: hasGlobalCompartment ? "Mapped" : "Not set" },
          { label: "GenAI region", value: genAiRegion || "Not set" },
          { label: "Primary model", value: primaryModel },
        ],
        readiness: [
          { label: "Profile inventory", done: hasProfiles, help: "Create at least one OCI profile so feature workspaces can load data." },
          { label: "Feature scopes", done: Object.values(scopeCounts).some((count) => count > 0), help: "Assign compartments per feature so resources and databases have visible scope." },
          { label: "Assistant setup", done: genAiReady, help: "Configure GenAI region and model before relying on chat or SQL assistant actions." },
        ],
        workflowTitle: workflow.workflowTitle,
        workflow: workflow.workflow,
        related: workflow.related,
      }
    default:
      return {
        sectionTitle: "Context",
        summary: "Workspace context is available in the main panel and related views.",
        metrics: [],
        readiness: [],
        workflowTitle: workflow.workflowTitle,
        workflow: workflow.workflow,
        related: workflow.related,
      }
  }
}

function buildScopedResourceInsight({
  sectionTitle,
  summary,
  scopeCount,
  scopeLabel,
  hasProfiles,
  activeProfile,
  region,
  workflowTitle,
  workflow,
  related,
}: {
  sectionTitle: string
  summary: string
  scopeCount: number
  scopeLabel: string
  hasProfiles: boolean
  activeProfile: string
  region: string
  workflowTitle: string
  workflow: string[]
  related: WorkbenchView[]
}): InsightModel {
  return {
    sectionTitle,
    summary,
    metrics: [
      { label: scopeLabel, value: String(scopeCount) },
      { label: "Active profile", value: activeProfile || "Not set" },
      { label: "Region", value: region || "Not set" },
      { label: "Mode", value: "Master-detail" },
    ],
    readiness: [
      { label: "OCI profile ready", done: hasProfiles, help: "Resource inventory requires a configured OCI profile." },
      { label: "Feature scope mapped", done: scopeCount > 0, help: "Map at least one compartment for this feature in Settings." },
      { label: "Region selected", done: Boolean(region), help: "Region context helps narrow inventory and related operations." },
    ],
    workflowTitle,
    workflow,
    related,
  }
}

function buildDatabaseInsight({
  sectionTitle,
  summary,
  scopeCount,
  scopeLabel,
  hasProfiles,
  activeProfile,
  region,
  favoriteSqlCount,
  sqlHistoryCount,
  workflowTitle,
  workflow,
  related,
}: {
  sectionTitle: string
  summary: string
  scopeCount: number
  scopeLabel: string
  hasProfiles: boolean
  activeProfile: string
  region: string
  favoriteSqlCount: number
  sqlHistoryCount: number
  workflowTitle: string
  workflow: string[]
  related: WorkbenchView[]
}): InsightModel {
  return {
    sectionTitle,
    summary,
    metrics: [
      { label: scopeLabel, value: String(scopeCount) },
      { label: "Active profile", value: activeProfile || "Not set" },
      { label: "Region", value: region || "Not set" },
      { label: "SQL snippets", value: `${favoriteSqlCount}/${sqlHistoryCount}` },
    ],
    readiness: [
      { label: "OCI profile ready", done: hasProfiles, help: "Database inventory and connection actions require a configured OCI profile." },
      { label: "Database scope mapped", done: scopeCount > 0, help: "Map database compartments in Settings before expecting targets to load." },
      { label: "Region selected", done: Boolean(region), help: "Region context is needed for inventory and connection metadata." },
    ],
    workflowTitle,
    workflow,
    related,
  }
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

export default function App() {
  return (
    <Providers>
      <AppContent />
    </Providers>
  )
}
