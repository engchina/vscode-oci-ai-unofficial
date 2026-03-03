import { clsx } from "clsx"
import {
  AlertCircle,
  ArrowDownToLine,
  CheckCircle2,
  ChevronLeft,
  Copy,
  Folder,
  HardDriveDownload,
  KeyRound,
  Loader2,
  PackageOpen,
  Trash2,
  Upload,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { useWorkbenchInsight } from "../../context/WorkbenchInsightContext"
import { ResourceServiceClient } from "../../services/grpc-client"
import type {
  CreateObjectStorageParResponse,
  ObjectStorageBucketResource,
  ObjectStorageObjectResource,
} from "../../services/types"
import GuardrailDialog from "../common/GuardrailDialog"
import CompartmentSelector from "../ui/CompartmentSelector"
import InlineNotice from "../ui/InlineNotice"
import StatusBadge from "../ui/StatusBadge"
import { WorkbenchEmptyState, WorkbenchLoadingState, WorkbenchSection } from "../workbench/DatabaseWorkbenchChrome"
import {
  WorkbenchActionButton,
  WorkbenchCompactActionCluster,
  WorkbenchDismissButton,
  WorkbenchIconActionButton,
  WorkbenchRevealButton,
  WorkbenchSelectButton,
} from "../workbench/WorkbenchActionButtons"
import FeaturePageLayout, { FeatureSearchInput } from "../workbench/FeaturePageLayout"
import { WorkbenchMicroOptionButton } from "../workbench/WorkbenchCompactControls"
import {
  createDeleteResourceGuardrail,
  createCreateLinkResourceGuardrail,
  buildWorkbenchResourceGuardrailDetails,
  createWorkbenchGuardrail,
  type WorkbenchGuardrailState,
} from "../workbench/guardrail"
import WorkbenchInventoryCard from "../workbench/WorkbenchInventoryCard"
import {
  WorkbenchInventoryGroupHeading,
  WorkbenchInventoryRegionHeading,
  WorkbenchInventorySummary,
} from "../workbench/WorkbenchInventoryScaffold"
import { WorkbenchRefreshButton } from "../workbench/WorkbenchToolbar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs"

type BucketStatOverride = {
  approximateCount: number
  approximateSize: number
}

type RecentActionState =
  | {
    kind: "upload" | "download" | "delete"
    objectName: string
    timestamp: number
  }
  | null

export default function ObjectStorageView() {
  const { activeProfile, profilesConfig, tenancyOcid, objectStorageCompartmentIds, navigateToView } = useExtensionState()
  const { setResource } = useWorkbenchInsight()
  const [buckets, setBuckets] = useState<ObjectStorageBucketResource[]>([])
  const [selectedBucket, setSelectedBucket] = useState<ObjectStorageBucketResource | null>(null)
  const [prefix, setPrefix] = useState("")
  const [folderPrefixes, setFolderPrefixes] = useState<string[]>([])
  const [objects, setObjects] = useState<ObjectStorageObjectResource[]>([])
  const [loadingBuckets, setLoadingBuckets] = useState(true)
  const [loadingObjects, setLoadingObjects] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [downloadingObjectName, setDownloadingObjectName] = useState<string | null>(null)
  const [deletingObjectName, setDeletingObjectName] = useState<string | null>(null)
  const [recentlyUploadedObjectName, setRecentlyUploadedObjectName] = useState<string | null>(null)
  const [recentAction, setRecentAction] = useState<RecentActionState>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [guardrail, setGuardrail] = useState<WorkbenchGuardrailState>(null)
  const [latestPar, setLatestPar] = useState<CreateObjectStorageParResponse | null>(null)
  const [bucketStatOverrides, setBucketStatOverrides] = useState<Record<string, BucketStatOverride>>({})
  const bucketStatOverridesRef = useRef<Record<string, BucketStatOverride>>({})
  const uploadHighlightTimerRef = useRef<number | null>(null)
  const uploadScrollFrameRef = useRef<number | null>(null)
  const recentActionTimerRef = useRef<number | null>(null)
  const objectItemRefs = useRef(new Map<string, HTMLDivElement>())

  useEffect(() => {
    bucketStatOverridesRef.current = bucketStatOverrides
  }, [bucketStatOverrides])

  useEffect(() => {
    if (uploadHighlightTimerRef.current !== null) {
      window.clearTimeout(uploadHighlightTimerRef.current)
      uploadHighlightTimerRef.current = null
    }

    if (!recentlyUploadedObjectName) {
      return
    }

    uploadHighlightTimerRef.current = window.setTimeout(() => {
      uploadHighlightTimerRef.current = null
      setRecentlyUploadedObjectName(null)
    }, 2200)

    return () => {
      if (uploadHighlightTimerRef.current !== null) {
        window.clearTimeout(uploadHighlightTimerRef.current)
        uploadHighlightTimerRef.current = null
      }
    }
  }, [recentlyUploadedObjectName])

  const [showObjectBrowserWorkspace, setShowObjectBrowserWorkspace] = useState(false)
  const [showBucketWorkspace, setShowBucketWorkspace] = useState(false)

  useEffect(() => {
    if (!selectedBucket) {
      setShowBucketWorkspace(false)
    }
  }, [selectedBucket])

  useEffect(() => {
    if (recentActionTimerRef.current !== null) {
      window.clearTimeout(recentActionTimerRef.current)
      recentActionTimerRef.current = null
    }

    if (!recentAction) {
      return
    }

    recentActionTimerRef.current = window.setTimeout(() => {
      recentActionTimerRef.current = null
      setRecentAction(null)
    }, 3200)

    return () => {
      if (recentActionTimerRef.current !== null) {
        window.clearTimeout(recentActionTimerRef.current)
        recentActionTimerRef.current = null
      }
    }
  }, [recentAction])

  const revealObject = useCallback((objectName: string) => {
    setQuery("")
    setRecentlyUploadedObjectName(objectName)
  }, [])

  useEffect(() => {
    if (!selectedBucket) {
      setResource(null)
      return
    }

    setResource({
      view: "objectStorage",
      title: selectedBucket.name,
      eyebrow: "Selected Bucket",
      resourceId: `${selectedBucket.namespaceName} • ${selectedBucket.region}`,
      badge: selectedBucket.publicAccessType
        ? { label: selectedBucket.publicAccessType, tone: "warning" }
        : { label: "Private", tone: "neutral" },
      metrics: [
        { label: "Namespace", value: selectedBucket.namespaceName },
        { label: "Region", value: selectedBucket.region || "default" },
        { label: "Objects", value: formatCount(selectedBucket.approximateCount) },
        { label: "Approx. Size", value: formatBytes(selectedBucket.approximateSize) },
      ],
      notes: [
        `Prefix: ${prefix || "/"}`,
        latestPar ? `Latest PAR expires ${formatDateTime(latestPar.timeExpires)}` : "No active PAR summary in the current session.",
      ],
      actions: [
        ...(query
          ? [{
            label: "Clear Filter",
            run: () => setQuery(""),
            variant: "ghost" as const,
          }]
          : []),
        ...(prefix
          ? [{
            label: "Reset Prefix",
            run: () => setPrefix(""),
            variant: "secondary" as const,
          }]
          : []),
        ...(recentlyUploadedObjectName
          ? [{
            label: "Show Latest Upload",
            run: () => {
              setShowObjectBrowserWorkspace(true)
              revealObject(recentlyUploadedObjectName)
            },
            variant: "secondary" as const,
          }]
          : []),
        {
          label: "Open SQL Workbench",
          run: () => navigateToView("sqlWorkbench"),
          variant: "secondary",
        },
      ],
    })

    return () => setResource(null)
  }, [latestPar, navigateToView, prefix, query, recentlyUploadedObjectName, revealObject, selectedBucket, setResource])

  const activeProfileConfig = useMemo(
    () => profilesConfig.find((profile) => profile.name === activeProfile),
    [activeProfile, profilesConfig],
  )

  const compartmentNameById = useMemo(() => {
    const map = new Map<string, string>()
    const rootId = tenancyOcid?.trim()
    if (rootId) {
      map.set(rootId, "Root (Tenancy)")
    }
    for (const compartment of activeProfileConfig?.compartments ?? []) {
      if (compartment.id?.trim()) {
        map.set(compartment.id.trim(), compartment.name?.trim() || compartment.id.trim())
      }
    }
    return map
  }, [activeProfileConfig, tenancyOcid])

  const selectedCompartmentIds = useMemo(
    () => objectStorageCompartmentIds.map((id) => id.trim()).filter((id) => id.length > 0),
    [objectStorageCompartmentIds],
  )

  const loadBuckets = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!silent) {
      setLoadingBuckets(true)
    }
    setError(null)
    if (selectedCompartmentIds.length === 0) {
      setBuckets([])
      setSelectedBucket(null)
      setBucketStatOverrides({})
      if (!silent) {
        setLoadingBuckets(false)
      }
      return
    }
    try {
      const response = await ResourceServiceClient.listObjectStorageBuckets()
      const freshItems = (response.buckets ?? []).filter((bucket) =>
        selectedCompartmentIds.includes((bucket.compartmentId || "").trim()),
      )
      const items = freshItems.map((bucket) => applyBucketStatOverride(bucket, bucketStatOverridesRef.current))
      setBuckets(items)
      setSelectedBucket((current) => {
        if (!current) {
          return items[0] ?? null
        }
        return items.find((bucket) =>
          bucket.name === current.name &&
          bucket.namespaceName === current.namespaceName &&
          bucket.region === current.region,
        ) ?? items[0] ?? null
      })
      setBucketStatOverrides((current) => pruneBucketStatOverrides(current, freshItems))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (!silent) {
        setLoadingBuckets(false)
      }
    }
  }, [selectedCompartmentIds])

  const loadObjects = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!selectedBucket) {
      setFolderPrefixes([])
      setObjects([])
      return
    }
    if (!silent) {
      setLoadingObjects(true)
    }
    setError(null)
    try {
      const response = await ResourceServiceClient.listObjectStorageObjects({
        namespaceName: selectedBucket.namespaceName,
        bucketName: selectedBucket.name,
        region: selectedBucket.region,
        prefix,
      })
      setFolderPrefixes(response.prefixes ?? [])
      setObjects(response.objects ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (!silent) {
        setLoadingObjects(false)
      }
    }
  }, [prefix, selectedBucket])

  useEffect(() => {
    void loadBuckets()
  }, [loadBuckets])

  useEffect(() => {
    setPrefix("")
    setLatestPar(null)
    setRecentlyUploadedObjectName(null)
    setRecentAction(null)
    setShowObjectBrowserWorkspace(false)
    objectItemRefs.current.clear()
  }, [selectedBucket?.name, selectedBucket?.namespaceName, selectedBucket?.region])

  useEffect(() => {
    void loadObjects()
  }, [loadObjects])

  const filteredFolders = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return folderPrefixes
    return folderPrefixes.filter((item) => item.toLowerCase().includes(normalizedQuery))
  }, [folderPrefixes, query])

  const filteredObjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return objects
    return objects.filter((item) => item.name.toLowerCase().includes(normalizedQuery))
  }, [objects, query])

  useEffect(() => {
    if (uploadScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(uploadScrollFrameRef.current)
      uploadScrollFrameRef.current = null
    }

    if (!recentlyUploadedObjectName || !filteredObjects.some((item) => item.name === recentlyUploadedObjectName)) {
      return
    }

    uploadScrollFrameRef.current = window.requestAnimationFrame(() => {
      uploadScrollFrameRef.current = null
      objectItemRefs.current.get(recentlyUploadedObjectName)?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      })
    })

    return () => {
      if (uploadScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(uploadScrollFrameRef.current)
        uploadScrollFrameRef.current = null
      }
    }
  }, [filteredObjects, recentlyUploadedObjectName])

  const groupedBuckets = useMemo(() => groupBucketsByCompartmentAndRegion(buckets), [buckets])
  const breadcrumbSegments = useMemo(() => buildBreadcrumbs(prefix), [prefix])
  const actionBusy = busy || uploading || downloadingObjectName !== null || deletingObjectName !== null
  const uploadedObjectHiddenByFilter = Boolean(
    recentlyUploadedObjectName &&
    query.trim() &&
    !filteredObjects.some((item) => item.name === recentlyUploadedObjectName),
  )

  const applyBucketStats = useCallback((
    bucketKey: Pick<ObjectStorageBucketResource, "name" | "namespaceName" | "region">,
    approximateCount: number,
    approximateSize: number,
  ) => {
    const nextStats = {
      approximateCount: Math.max(0, approximateCount),
      approximateSize: Math.max(0, approximateSize),
    }
    setBucketStatOverrides((current) => ({
      ...current,
      [bucketIdentityKey(bucketKey)]: nextStats,
    }))
    setBuckets((current) => current.map((bucket) => (
      isSameBucket(bucket, bucketKey)
        ? {
          ...bucket,
          ...nextStats,
        }
        : bucket
    )))
    setSelectedBucket((current) => (
      current && isSameBucket(current, bucketKey)
        ? {
          ...current,
          ...nextStats,
        }
        : current
    ))
  }, [])

  const openGuardrail = useCallback((state: NonNullable<WorkbenchGuardrailState>) => {
    setGuardrail(createWorkbenchGuardrail(state))
  }, [])

  const runGuardedAction = useCallback(async () => {
    if (!guardrail) {
      return
    }
    setBusy(true)
    try {
      await guardrail.onConfirm()
      setGuardrail(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setGuardrail(null)
    } finally {
      setBusy(false)
    }
  }, [guardrail])

  const handleUpload = useCallback(async () => {
    if (!selectedBucket) return
    setUploading(true)
    setError(null)
    try {
      const response = await ResourceServiceClient.uploadObjectStorageObject({
        namespaceName: selectedBucket.namespaceName,
        bucketName: selectedBucket.name,
        region: selectedBucket.region,
        prefix,
      })
      if (response.cancelled) {
        return
      }

      const existingObject = objects.find((item) => item.name === response.objectName)
      const nowIso = new Date().toISOString()

      applyBucketStats(
        selectedBucket,
        (selectedBucket.approximateCount ?? 0) + (existingObject ? 0 : 1),
        (selectedBucket.approximateSize ?? 0) + (response.objectSize ?? 0) - (existingObject?.size ?? 0),
      )

      setObjects((current) => upsertObject(current, {
        name: response.objectName,
        size: response.objectSize,
        storageTier: existingObject?.storageTier || "Standard",
        timeCreated: existingObject?.timeCreated ?? nowIso,
        timeModified: nowIso,
      }))
      setRecentlyUploadedObjectName(response.objectName)
      setRecentAction({
        kind: "upload",
        objectName: response.objectName,
        timestamp: Date.now(),
      })
      setLatestPar(null)

      void loadBuckets({ silent: true })
      void loadObjects({ silent: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setUploading(false)
    }
  }, [applyBucketStats, loadBuckets, loadObjects, objects, prefix, selectedBucket])

  const handleDownload = useCallback(async (objectName: string) => {
    if (!selectedBucket) return
    setDownloadingObjectName(objectName)
    setError(null)
    try {
      await ResourceServiceClient.downloadObjectStorageObject({
        namespaceName: selectedBucket.namespaceName,
        bucketName: selectedBucket.name,
        objectName,
        region: selectedBucket.region,
      })
      setRecentAction({
        kind: "download",
        objectName,
        timestamp: Date.now(),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDownloadingObjectName(null)
    }
  }, [selectedBucket])

  const handleCreatePar = useCallback((objectName: string) => {
    if (!selectedBucket) return
    openGuardrail(createCreateLinkResourceGuardrail({
      resourceKind: "pre-authenticated-link",
      details: buildWorkbenchResourceGuardrailDetails({
        resourceLabel: "Bucket",
        resourceName: selectedBucket.name,
        region: selectedBucket.region,
        extras: [
          { label: "Object", value: objectName },
          { label: "Access", value: "ObjectRead" },
          { label: "Expires", value: "24 hours" },
        ],
      }),
      onConfirm: async () => {
        const response = await ResourceServiceClient.createObjectStoragePar({
          namespaceName: selectedBucket.namespaceName,
          bucketName: selectedBucket.name,
          objectName,
          region: selectedBucket.region,
          expiresInHours: 24,
        })
        setLatestPar(response)
        try {
          await navigator.clipboard.writeText(response.fullUrl)
        } catch {
          // Clipboard access is best-effort in webview.
        }
      },
    }))
  }, [openGuardrail, selectedBucket])

  const handleDelete = useCallback((object: ObjectStorageObjectResource) => {
    if (!selectedBucket) return
    openGuardrail(createDeleteResourceGuardrail({
      resourceTitle: "Object Storage Object",
      confirmTarget: "Object",
      subject: "object",
      effect: "permanently removes it from the selected bucket.",
      details: buildWorkbenchResourceGuardrailDetails({
        resourceLabel: "Bucket",
        resourceName: selectedBucket.name,
        region: selectedBucket.region,
        extras: [
          { label: "Object", value: object.name },
          { label: "Size", value: formatBytes(object.size) },
        ],
      }),
      onConfirm: async () => {
        setDeletingObjectName(object.name)
        try {
          await ResourceServiceClient.deleteObjectStorageObject({
            namespaceName: selectedBucket.namespaceName,
            bucketName: selectedBucket.name,
            objectName: object.name,
            region: selectedBucket.region,
          })

          setObjects((current) => current.filter((item) => item.name !== object.name))
          objectItemRefs.current.delete(object.name)
          applyBucketStats(
            selectedBucket,
            (selectedBucket.approximateCount ?? 0) - 1,
            (selectedBucket.approximateSize ?? 0) - (object.size ?? 0),
          )
          setRecentAction({
            kind: "delete",
            objectName: object.name,
            timestamp: Date.now(),
          })
          if (recentlyUploadedObjectName === object.name) {
            setRecentlyUploadedObjectName(null)
          }
          if (latestPar?.objectName === object.name) {
            setLatestPar(null)
          }
          setGuardrail(null)

          void loadBuckets({ silent: true })
          void loadObjects({ silent: true })
        } finally {
          setDeletingObjectName(null)
        }
      },
    }))
  }, [applyBucketStats, latestPar?.objectName, loadBuckets, loadObjects, openGuardrail, recentlyUploadedObjectName, selectedBucket])

  const copyLatestPar = useCallback(async () => {
    if (!latestPar?.fullUrl) return
    try {
      await navigator.clipboard.writeText(latestPar.fullUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [latestPar])



  return (
    <FeaturePageLayout
      title="Object Storage"
      description={selectedBucket && showBucketWorkspace
        ? `${selectedBucket.name} • Manage buckets and objects without leaving the current workspace.`
        : "Manage buckets and objects without leaving the current workspace."}
      icon={<PackageOpen size={16} />}
      actions={(
        <WorkbenchRefreshButton
          onClick={() => void loadBuckets()}
          disabled={loadingBuckets || loadingObjects}
          spinning={loadingBuckets || loadingObjects}
          title="Refresh"
        />
      )}
      controls={(
        <div className="flex flex-col gap-1.5">
          <CompartmentSelector featureKey="objectStorage" multiple />
          {showBucketWorkspace && selectedBucket && (
            <>
              <FeatureSearchInput
                value={query}
                onChange={setQuery}
                placeholder="Filter folders and objects..."
              />
              <WorkbenchCompactActionCluster>
                <WorkbenchActionButton
                  onClick={() => void handleUpload()}
                  disabled={actionBusy}
                  title={uploading ? "Uploading file to Object Storage" : "Choose a local file to upload"}
                >
                  {uploading ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : <Upload size={12} className="mr-1.5" />}
                  {uploading ? "Uploading..." : "Upload"}
                </WorkbenchActionButton>
                <div className="min-w-0 flex-1 rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)] px-1.5 py-0.5">
                  <div className="flex flex-wrap items-center gap-1 text-[11px] text-description">
                    <WorkbenchMicroOptionButton onClick={() => setPrefix("")} title="Reset to bucket root">/</WorkbenchMicroOptionButton>
                    {breadcrumbSegments.map((segment) => (
                      <WorkbenchMicroOptionButton
                        key={segment.prefix}
                        onClick={() => setPrefix(segment.prefix)}
                        title={`Open ${segment.label}`}
                      >
                        {segment.label}
                      </WorkbenchMicroOptionButton>
                    ))}
                  </div>
                </div>
              </WorkbenchCompactActionCluster>
            </>
          )}
        </div>
      )}
    >
      <div className="flex h-full min-h-0 flex-col px-2 py-2">
        {error && <InlineError message={error} />}
        {loadingBuckets ? (
          <WorkbenchLoadingState label="Loading buckets..." />
        ) : buckets.length === 0 ? (
          <EmptyState
            title={selectedCompartmentIds.length > 0 ? "No Buckets Found" : "No Compartment Selected"}
            description={selectedCompartmentIds.length > 0 ? "No buckets were found in the selected compartments." : "Select one or more compartments first."}
          />
        ) : (
          <div className="min-h-0 flex-1">
            {showBucketWorkspace && selectedBucket ? (
              <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-shell)]">
                <div className="flex items-center justify-between gap-2 border-b border-[var(--vscode-panel-border)] px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowObjectBrowserWorkspace(false)
                        setShowBucketWorkspace(false)
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-[2px] hover:bg-[var(--vscode-toolbar-hoverBackground)]"
                      title="Back to Buckets"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold uppercase tracking-wide text-[var(--vscode-sideBarTitle-foreground)]">
                        {showObjectBrowserWorkspace ? "Object Browser" : "Bucket Workspace"}
                      </div>
                      <div className="truncate text-[10px] text-description">{selectedBucket.name}</div>
                    </div>
                  </div>
                  {selectedBucket.publicAccessType ? (
                    <StatusBadge
                      label={selectedBucket.publicAccessType}
                      tone="neutral"
                      size="compact"
                    />
                  ) : null}
                </div>

                <div className="min-h-0 flex-1 overflow-hidden p-2">
                  {showObjectBrowserWorkspace ? (
                    <div className="flex h-full min-h-0 flex-col">
                      <WorkbenchSection
                        title="Object Browser"
                        subtitle="Browse prefixes, inspect object metadata, and create download or PAR actions without leaving the selected bucket."
                        actions={(
                          <WorkbenchActionButton onClick={() => setShowObjectBrowserWorkspace(false)} variant="secondary">
                            Back to Overview
                          </WorkbenchActionButton>
                        )}
                        className="flex-1 flex flex-col min-h-0"
                      >
                        <div className="min-h-0 flex-1 overflow-auto rounded-[2px] border border-[var(--vscode-panel-border)] mt-1.5">
                          {loadingObjects ? (
                            <WorkbenchLoadingState label="Loading objects..." />
                          ) : filteredFolders.length === 0 && filteredObjects.length === 0 ? (
                            <EmptyState title="No Objects Found" description="This prefix is empty or does not match your filter." />
                          ) : (
                            <div className="flex flex-col gap-1 p-1.5">
                              {filteredFolders.map((folderPrefix) => (
                                <button
                                  key={folderPrefix}
                                  onClick={() => setPrefix(folderPrefix)}
                                  className="flex items-center gap-2 rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-2.5 py-1.5 text-left hover:bg-[var(--vscode-list-hoverBackground)]"
                                >
                                  <Folder size={14} className="shrink-0 text-[var(--vscode-icon-foreground)]" />
                                  <div className="min-w-0 flex-1">
                                    <div className="truncate text-[12px] font-medium text-[var(--vscode-foreground)]">
                                      {displayFolderName(folderPrefix, prefix)}
                                    </div>
                                    <div className="truncate text-[10px] text-description">{folderPrefix}</div>
                                  </div>
                                  <ArrowDownToLine size={12} className="shrink-0 rotate-[-90deg] text-description" />
                                </button>
                              ))}

                              {filteredObjects.map((object) => (
                                <div
                                  key={object.name}
                                  ref={(node) => {
                                    if (node) {
                                      objectItemRefs.current.set(object.name, node)
                                    } else {
                                      objectItemRefs.current.delete(object.name)
                                    }
                                  }}
                                  className={clsx(
                                    "rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-2.5 py-1.5 transition-colors duration-700",
                                    object.name === recentlyUploadedObjectName &&
                                    "border-[color-mix(in_srgb,var(--vscode-button-background)_45%,var(--vscode-panel-border))] bg-[color-mix(in_srgb,var(--vscode-editor-background)_82%,var(--vscode-button-background)_18%)]",
                                  )}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <div className="truncate text-[12px] font-medium text-[var(--vscode-foreground)]">{pathTail(object.name)}</div>
                                      <div className="truncate text-[10px] text-description">{object.name}</div>
                                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-description">
                                        <span>{formatBytes(object.size)}</span>
                                        <span>{object.storageTier || "Standard"}</span>
                                        <span>{formatDateTime(object.timeModified || object.timeCreated)}</span>
                                      </div>
                                    </div>
                                    <WorkbenchCompactActionCluster className="shrink-0">
                                      <WorkbenchIconActionButton
                                        icon={<HardDriveDownload size={12} />}
                                        onClick={() => void handleDownload(object.name)}
                                        disabled={actionBusy}
                                        title={downloadingObjectName === object.name ? "Saving object locally" : "Save this object to a local path"}
                                        busy={downloadingObjectName === object.name}
                                      />
                                      <WorkbenchIconActionButton
                                        icon={<KeyRound size={12} />}
                                        onClick={() => handleCreatePar(object.name)}
                                        disabled={actionBusy}
                                        title="Create a 24-hour pre-authenticated download link"
                                      />
                                      <WorkbenchIconActionButton
                                        icon={<Trash2 size={12} />}
                                        onClick={() => handleDelete(object)}
                                        disabled={actionBusy}
                                        title={deletingObjectName === object.name ? "Deleting object" : "Delete this object from the bucket"}
                                        busy={deletingObjectName === object.name}
                                      />
                                    </WorkbenchCompactActionCluster>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </WorkbenchSection>
                    </div>
                  ) : (
                    <div className="flex flex-col h-full min-h-0 gap-2">
                      <div className="flex-1 min-h-0 flex flex-col">
                        <Tabs defaultValue="overview" className="flex-1 min-h-0">
                          <TabsList>
                            <TabsTrigger value="overview">Overview</TabsTrigger>
                            <TabsTrigger value="object-browser">Object Browser</TabsTrigger>
                          </TabsList>
                          <TabsContent value="overview" className="flex-1 overflow-auto pt-1.5 flex flex-col gap-2">
                            {latestPar && (
                              <InlineNotice
                                tone="warning"
                                title="Latest PAR"
                                actions={(
                                  <WorkbenchActionButton variant="secondary" onClick={() => void copyLatestPar()}>
                                    <Copy size={12} />
                                  </WorkbenchActionButton>
                                )}
                              >
                                <div className="break-all">{latestPar.fullUrl}</div>
                                <div className="mt-1 text-[10px]">Expires {formatDateTime(latestPar.timeExpires)}</div>
                              </InlineNotice>
                            )}

                            {uploadedObjectHiddenByFilter && recentlyUploadedObjectName && (
                              <InlineNotice
                                tone="info"
                                actions={(
                                  <WorkbenchActionButton variant="secondary" onClick={() => setQuery("")}>
                                    Clear Filter
                                  </WorkbenchActionButton>
                                )}
                              >
                                <div className="min-w-0">
                                  Uploaded <span className="text-[var(--vscode-foreground)]">{pathTail(recentlyUploadedObjectName)}</span>, but it is hidden by the current filter.
                                </div>
                              </InlineNotice>
                            )}

                            {recentAction && (
                              <InlineNotice
                                tone="info"
                                icon={<CheckCircle2 size={14} className="text-[var(--vscode-testing-iconPassed)]" />}
                                actions={(
                                  <>
                                    {recentAction.kind === "upload" && (
                                      <WorkbenchRevealButton
                                        onClick={() => {
                                          setShowObjectBrowserWorkspace(true)
                                          revealObject(recentAction.objectName)
                                        }}
                                        title="Show and highlight this object in the list"
                                        label="Show Object"
                                      />
                                    )}
                                    <WorkbenchDismissButton onClick={() => setRecentAction(null)} title="Dismiss" />
                                  </>
                                )}
                              >
                                <div className="min-w-0">
                                  {recentAction.kind === "upload"
                                    ? "Uploaded"
                                    : recentAction.kind === "download"
                                      ? "Saved locally"
                                      : "Deleted"}{" "}
                                  <span className="text-[var(--vscode-foreground)]">{pathTail(recentAction.objectName)}</span>{" "}
                                  {formatRecentActionAge(recentAction.timestamp)}
                                </div>
                              </InlineNotice>
                            )}

                            <WorkbenchSection title="Size & Capacity">
                              <div className="grid grid-cols-2 gap-2.5 rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] p-2.5 shadow-sm">
                                <div className="flex flex-col gap-1">
                                  <span className="text-[11px] text-description uppercase tracking-wider font-semibold">Total Objects</span>
                                  <span className="text-[20px] font-medium text-[var(--vscode-foreground)]">{formatCount(selectedBucket.approximateCount)}</span>
                                </div>
                                <div className="flex flex-col gap-1">
                                  <span className="text-[11px] text-description uppercase tracking-wider font-semibold">Approximate Size</span>
                                  <span className="text-[20px] font-medium text-[var(--vscode-foreground)]">{formatBytes(selectedBucket.approximateSize)}</span>
                                </div>
                              </div>
                            </WorkbenchSection>
                          </TabsContent>
                          <TabsContent value="object-browser" className="min-h-0 flex-1 flex flex-col pt-1.5">
                            <WorkbenchSection
                              title="Object Browser"
                              subtitle="Browse prefixes, inspect object metadata, and create download or PAR actions without leaving the selected bucket."
                              actions={(
                                <WorkbenchActionButton onClick={() => setShowObjectBrowserWorkspace(true)}>
                                  Open Object Browser
                                </WorkbenchActionButton>
                              )}
                              className="flex-1 flex flex-col min-h-0"
                            >
                              <div className="min-h-0 flex-1 overflow-auto rounded-[2px] border border-[var(--vscode-panel-border)] flex items-center justify-center p-4 text-center mt-1.5 bg-[var(--vscode-editor-background)]">
                                <div className="flex flex-col items-center gap-2">
                                  <PackageOpen size={32} className="text-[var(--vscode-icon-foreground)] opacity-50" />
                                  <div className="text-[13px] text-[var(--vscode-foreground)]">Explore objects in a dedicated workspace view</div>
                                  <WorkbenchActionButton onClick={() => setShowObjectBrowserWorkspace(true)}>
                                    Open Object Browser
                                  </WorkbenchActionButton>
                                </div>
                              </div>
                            </WorkbenchSection>
                          </TabsContent>
                        </Tabs>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            ) : (
              <section className="h-full min-h-0 overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-shell)]">
                <div className="h-full overflow-y-auto p-2">
                  <div className="flex flex-col gap-2">
                    <WorkbenchInventorySummary
                      label="Bucket inventory"
                      count={`${buckets.length} bucket${buckets.length === 1 ? "" : "s"}`}
                      description="Select a bucket to browse folders, objects, and pre-authenticated links."
                    />
                    <BucketList
                      groupedBuckets={groupedBuckets}
                      compartmentNameById={compartmentNameById}
                      selectedBucket={selectedBucket}
                      onSelect={(bucket) => {
                        setSelectedBucket(bucket)
                        setShowBucketWorkspace(true)
                      }}
                    />
                  </div>
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      <GuardrailDialog
        open={guardrail !== null}
        title={guardrail?.title ?? ""}
        description={guardrail?.description ?? ""}
        confirmLabel={guardrail?.confirmLabel ?? "Confirm"}
        details={guardrail?.details ?? []}
        tone={guardrail?.tone}
        busy={busy}
        onCancel={() => {
          if (!busy) {
            setGuardrail(null)
          }
        }}
        onConfirm={runGuardedAction}
      />
    </FeaturePageLayout>
  )
}

function InlineError({ message }: { message: string }) {
  return (
    <InlineNotice tone="danger" icon={<AlertCircle size={13} />} className="mb-2">
      {message}
    </InlineNotice>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <WorkbenchEmptyState
      title={title}
      description={description}
      icon={<PackageOpen size={22} />}
    />
  )
}

function BucketList({
  groupedBuckets,
  compartmentNameById,
  selectedBucket,
  onSelect,
}: {
  groupedBuckets: { compartmentId: string; regions: { region: string; buckets: ObjectStorageBucketResource[] }[] }[]
  compartmentNameById: Map<string, string>
  selectedBucket: ObjectStorageBucketResource | null
  onSelect: (bucket: ObjectStorageBucketResource) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {groupedBuckets.map((group) => (
        <div key={group.compartmentId}>
          <WorkbenchInventoryGroupHeading>
            {compartmentNameById.get(group.compartmentId) ?? group.compartmentId}
          </WorkbenchInventoryGroupHeading>
          <div className="flex flex-col gap-2">
            {group.regions.map((regionGroup) => (
              <div key={`${group.compartmentId}-${regionGroup.region}`} className="flex flex-col gap-2">
                <WorkbenchInventoryRegionHeading>
                  {regionGroup.region}
                </WorkbenchInventoryRegionHeading>
                {regionGroup.buckets.map((bucket) => (
                  <WorkbenchInventoryCard
                    key={`${bucket.region}-${bucket.namespaceName}-${bucket.name}`}
                    title={bucket.name}
                    subtitle={bucket.namespaceName}
                    details={[
                      bucket.storageTier || "Standard",
                      formatCount(bucket.approximateCount),
                      formatBytes(bucket.approximateSize),
                      ...(bucket.publicAccessType ? [bucket.publicAccessType] : []),
                    ]}
                    selected={Boolean(selectedBucket && isSameBucket(bucket, selectedBucket))}
                    onClick={() => onSelect(bucket)}
                    navigationAffordance
                    footer={(
                      <WorkbenchCompactActionCluster>
                        <WorkbenchSelectButton
                          selected={Boolean(selectedBucket && isSameBucket(bucket, selectedBucket))}
                          onClick={() => onSelect(bucket)}
                        />
                        <WorkbenchActionButton onClick={() => onSelect(bucket)}>
                          Open Bucket Workspace
                        </WorkbenchActionButton>
                      </WorkbenchCompactActionCluster>
                    )}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function groupBucketsByCompartmentAndRegion(buckets: ObjectStorageBucketResource[]) {
  const compartmentMap = new Map<string, Map<string, ObjectStorageBucketResource[]>>()
  for (const bucket of buckets) {
    const compartmentId = bucket.compartmentId || "unknown-compartment"
    const region = bucket.region || "default"
    if (!compartmentMap.has(compartmentId)) {
      compartmentMap.set(compartmentId, new Map<string, ObjectStorageBucketResource[]>())
    }
    const regionMap = compartmentMap.get(compartmentId)!
    if (!regionMap.has(region)) {
      regionMap.set(region, [])
    }
    regionMap.get(region)!.push(bucket)
  }
  return [...compartmentMap.entries()].map(([compartmentId, regions]) => ({
    compartmentId,
    regions: [...regions.entries()].map(([region, groupedBuckets]) => ({ region, buckets: groupedBuckets })),
  }))
}

function buildBreadcrumbs(prefix: string): { label: string; prefix: string }[] {
  const normalized = prefix.split("/").filter(Boolean)
  const breadcrumbs: { label: string; prefix: string }[] = []
  let current = ""
  for (const part of normalized) {
    current += `${part}/`
    breadcrumbs.push({ label: part, prefix: current })
  }
  return breadcrumbs
}

function displayFolderName(folderPrefix: string, currentPrefix: string): string {
  const relative = currentPrefix && folderPrefix.startsWith(currentPrefix)
    ? folderPrefix.slice(currentPrefix.length)
    : folderPrefix
  return relative.replace(/\/$/, "") || folderPrefix
}

function pathTail(value: string): string {
  const parts = String(value ?? "").split("/").filter(Boolean)
  return parts[parts.length - 1] || value
}

function isSameBucket(
  left: Pick<ObjectStorageBucketResource, "name" | "namespaceName" | "region">,
  right: Pick<ObjectStorageBucketResource, "name" | "namespaceName" | "region">,
): boolean {
  return left.name === right.name && left.namespaceName === right.namespaceName && left.region === right.region
}

function bucketIdentityKey(bucket: Pick<ObjectStorageBucketResource, "name" | "namespaceName" | "region">): string {
  return `${bucket.region}::${bucket.namespaceName}::${bucket.name}`
}

function applyBucketStatOverride(
  bucket: ObjectStorageBucketResource,
  overrides: Record<string, BucketStatOverride>,
): ObjectStorageBucketResource {
  const override = overrides[bucketIdentityKey(bucket)]
  if (!override) {
    return bucket
  }
  return {
    ...bucket,
    approximateCount: override.approximateCount,
    approximateSize: override.approximateSize,
  }
}

function pruneBucketStatOverrides(
  overrides: Record<string, BucketStatOverride>,
  freshBuckets: ObjectStorageBucketResource[],
): Record<string, BucketStatOverride> {
  const freshBucketMap = new Map(freshBuckets.map((bucket) => [bucketIdentityKey(bucket), bucket]))
  let changed = false
  const nextOverrides = { ...overrides }

  for (const [key, override] of Object.entries(overrides)) {
    const freshBucket = freshBucketMap.get(key)
    if (
      !freshBucket ||
      (freshBucket.approximateCount === override.approximateCount &&
        freshBucket.approximateSize === override.approximateSize)
    ) {
      delete nextOverrides[key]
      changed = true
    }
  }

  return changed ? nextOverrides : overrides
}

function formatBytes(value?: number): string {
  if (!Number.isFinite(value)) return "Unknown"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let next = value ?? 0
  let unitIndex = 0
  while (next >= 1024 && unitIndex < units.length - 1) {
    next /= 1024
    unitIndex += 1
  }
  return `${next >= 10 || unitIndex === 0 ? next.toFixed(0) : next.toFixed(1)} ${units[unitIndex]}`
}

function formatCount(value?: number): string {
  if (!Number.isFinite(value)) return "Unknown"
  return `${value} object${value === 1 ? "" : "s"}`
}

function formatDateTime(value?: string): string {
  if (!value) return "Unknown time"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatRecentActionAge(timestamp: number): string {
  const ageMs = Math.max(0, Date.now() - timestamp)
  if (ageMs < 5000) {
    return "just now"
  }
  return `${Math.round(ageMs / 1000)}s ago`
}

function upsertObject(
  objects: ObjectStorageObjectResource[],
  nextObject: ObjectStorageObjectResource,
): ObjectStorageObjectResource[] {
  const withoutCurrent = objects.filter((item) => item.name !== nextObject.name)
  return [...withoutCurrent, nextObject].sort((left, right) => left.name.localeCompare(right.name))
}
