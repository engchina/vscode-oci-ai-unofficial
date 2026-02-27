import { clsx } from "clsx"
import {
  AlertCircle,
  ArrowDownToLine,
  ChevronLeft,
  Copy,
  Folder,
  HardDriveDownload,
  KeyRound,
  Loader2,
  PackageOpen,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { ResourceServiceClient } from "../../services/grpc-client"
import type {
  CreateObjectStorageParResponse,
  ObjectStorageBucketResource,
  ObjectStorageObjectResource,
} from "../../services/types"
import GuardrailDialog from "../common/GuardrailDialog"
import Button from "../ui/Button"
import CompartmentSelector from "../ui/CompartmentSelector"

type GuardrailState =
  | {
    tone: "warning" | "danger"
    title: string
    description: string
    confirmLabel: string
    details: string[]
    requireText?: string
    onConfirm: () => Promise<void>
  }
  | null

type BucketStatOverride = {
  approximateCount: number
  approximateSize: number
}

export default function ObjectStorageView() {
  const { activeProfile, profilesConfig, tenancyOcid, objectStorageCompartmentIds } = useExtensionState()
  const [buckets, setBuckets] = useState<ObjectStorageBucketResource[]>([])
  const [selectedBucket, setSelectedBucket] = useState<ObjectStorageBucketResource | null>(null)
  const [prefix, setPrefix] = useState("")
  const [folderPrefixes, setFolderPrefixes] = useState<string[]>([])
  const [objects, setObjects] = useState<ObjectStorageObjectResource[]>([])
  const [loadingBuckets, setLoadingBuckets] = useState(true)
  const [loadingObjects, setLoadingObjects] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [guardrail, setGuardrail] = useState<GuardrailState>(null)
  const [latestPar, setLatestPar] = useState<CreateObjectStorageParResponse | null>(null)
  const [bucketStatOverrides, setBucketStatOverrides] = useState<Record<string, BucketStatOverride>>({})
  const bucketStatOverridesRef = useRef<Record<string, BucketStatOverride>>({})

  useEffect(() => {
    bucketStatOverridesRef.current = bucketStatOverrides
  }, [bucketStatOverrides])

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

  const loadBuckets = useCallback(async () => {
    setLoadingBuckets(true)
    setError(null)
    if (selectedCompartmentIds.length === 0) {
      setBuckets([])
      setSelectedBucket(null)
      setBucketStatOverrides({})
      setLoadingBuckets(false)
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
          return null
        }
        return items.find((bucket) =>
          bucket.name === current.name &&
          bucket.namespaceName === current.namespaceName &&
          bucket.region === current.region,
        ) ?? null
      })
      setBucketStatOverrides((current) => pruneBucketStatOverrides(current, freshItems))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingBuckets(false)
    }
  }, [selectedCompartmentIds])

  const loadObjects = useCallback(async () => {
    if (!selectedBucket) {
      setFolderPrefixes([])
      setObjects([])
      return
    }
    setLoadingObjects(true)
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
      setLoadingObjects(false)
    }
  }, [prefix, selectedBucket])

  useEffect(() => {
    void loadBuckets()
  }, [loadBuckets])

  useEffect(() => {
    setPrefix("")
    setLatestPar(null)
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

  const groupedBuckets = useMemo(() => groupBucketsByCompartmentAndRegion(buckets), [buckets])
  const breadcrumbSegments = useMemo(() => buildBreadcrumbs(prefix), [prefix])

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

  const openGuardrail = useCallback((state: GuardrailState) => {
    setGuardrail(state)
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

  const handleUpload = useCallback(() => {
    if (!selectedBucket) return
    openGuardrail({
      tone: "warning",
      title: "Upload Object",
      description: "This will upload a local file into the selected bucket and prefix.",
      confirmLabel: "Upload",
      details: [
        `Bucket: ${selectedBucket.name}`,
        `Prefix: ${prefix || "/"}`,
        `Region: ${selectedBucket.region}`,
      ],
      onConfirm: async () => {
        const response = await ResourceServiceClient.uploadObjectStorageObject({
          namespaceName: selectedBucket.namespaceName,
          bucketName: selectedBucket.name,
          region: selectedBucket.region,
          prefix,
        })
        if (!response.cancelled) {
          const existingObject = objects.find((item) => item.name === response.objectName)
          applyBucketStats(
            selectedBucket,
            (selectedBucket.approximateCount ?? 0) + (existingObject ? 0 : 1),
            (selectedBucket.approximateSize ?? 0) + (response.objectSize ?? 0) - (existingObject?.size ?? 0),
          )
          await Promise.all([loadBuckets(), loadObjects()])
        }
        setLatestPar(null)
      },
    })
  }, [applyBucketStats, loadBuckets, loadObjects, objects, openGuardrail, prefix, selectedBucket])

  const handleDownload = useCallback((objectName: string) => {
    if (!selectedBucket) return
    openGuardrail({
      tone: "warning",
      title: "Download Object",
      description: "This will download the selected object to a local path you choose.",
      confirmLabel: "Download",
      details: [
        `Bucket: ${selectedBucket.name}`,
        `Object: ${objectName}`,
        `Region: ${selectedBucket.region}`,
      ],
      onConfirm: async () => {
        await ResourceServiceClient.downloadObjectStorageObject({
          namespaceName: selectedBucket.namespaceName,
          bucketName: selectedBucket.name,
          objectName,
          region: selectedBucket.region,
        })
      },
    })
  }, [openGuardrail, selectedBucket])

  const handleCreatePar = useCallback((objectName: string) => {
    if (!selectedBucket) return
    openGuardrail({
      tone: "danger",
      title: "Create Pre-Authenticated Link",
      description: "Anyone with this link will be able to read the selected object until the link expires.",
      confirmLabel: "Create Link",
      details: [
        `Bucket: ${selectedBucket.name}`,
        `Object: ${objectName}`,
        "Access: ObjectRead",
        "Expires: 24 hours",
      ],
      requireText: pathTail(objectName),
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
    })
  }, [openGuardrail, selectedBucket])

  const copyLatestPar = useCallback(async () => {
    if (!latestPar?.fullUrl) return
    try {
      await navigator.clipboard.writeText(latestPar.fullUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [latestPar])

  if (!selectedBucket) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <Header title="Object Storage" onRefresh={loadBuckets} loading={loadingBuckets} />
        <div className="border-b border-[var(--vscode-panel-border)] px-3 pt-3 pb-2 bg-[var(--vscode-editor-background)]">
          <CompartmentSelector featureKey="objectStorage" multiple />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3">
          {error && <InlineError message={error} />}
          {loadingBuckets ? (
            <LoadingState label="Loading buckets..." />
          ) : buckets.length === 0 ? (
            <EmptyState
              title={selectedCompartmentIds.length > 0 ? "No buckets found" : "No compartment selected"}
              description={selectedCompartmentIds.length > 0 ? "No buckets were found in the selected compartments." : "Select one or more compartments first."}
            />
          ) : (
            <BucketList
              groupedBuckets={groupedBuckets}
              compartmentNameById={compartmentNameById}
              onSelect={setSelectedBucket}
            />
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header
        title="Object Storage"
        subtitle={selectedBucket.name}
        onRefresh={loadBuckets}
        loading={loadingBuckets || loadingObjects}
        leading={(
          <button
            onClick={() => setSelectedBucket(null)}
            className="flex h-6 w-6 items-center justify-center rounded-[2px] hover:bg-[var(--vscode-toolbar-hoverBackground)]"
            title="Back to buckets"
          >
            <ChevronLeft size={14} />
          </button>
        )}
      />

      <div className="border-b border-[var(--vscode-panel-border)] px-3 pt-3 pb-2 flex flex-col gap-2 bg-[var(--vscode-editor-background)]">
        <CompartmentSelector featureKey="objectStorage" multiple />
        <div className="flex items-center gap-2 rounded-[2px] border border-input-border bg-input-background px-2 py-1">
          <Search size={12} className="shrink-0 text-[var(--vscode-icon-foreground)]" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter folders and objects..."
            className="flex-1 bg-transparent text-[13px] text-input-foreground outline-none placeholder:text-input-placeholder"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={handleUpload} disabled={busy}>
            <Upload size={12} className="mr-1.5" />
            Upload
          </Button>
          <div className="min-w-0 flex-1 rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)] px-2 py-1">
            <div className="flex flex-wrap items-center gap-1 text-[11px] text-description">
              <button className={breadcrumbButtonClass} onClick={() => setPrefix("")}>/</button>
              {breadcrumbSegments.map((segment) => (
                <button
                  key={segment.prefix}
                  className={breadcrumbButtonClass}
                  onClick={() => setPrefix(segment.prefix)}
                >
                  {segment.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {error && <InlineError message={error} />}

        <div className="mb-3 grid grid-cols-2 gap-2 text-[11px] text-description">
          <MetaCard label="Namespace" value={selectedBucket.namespaceName} />
          <MetaCard label="Region" value={selectedBucket.region} />
          <MetaCard label="Objects" value={formatCount(selectedBucket.approximateCount)} />
          <MetaCard label="Approx. Size" value={formatBytes(selectedBucket.approximateSize)} />
        </div>

        {latestPar && (
          <div className="mb-3 rounded-[2px] border border-warning/30 bg-[color-mix(in_srgb,var(--vscode-editor-background)_88%,orange_12%)] px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-[var(--vscode-foreground)]">Latest PAR</div>
                <div className="mt-1 break-all text-[11px] text-description">{latestPar.fullUrl}</div>
                <div className="mt-1 text-[10px] text-description">Expires {formatDateTime(latestPar.timeExpires)}</div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => void copyLatestPar()}>
                <Copy size={12} />
              </Button>
            </div>
          </div>
        )}

        {loadingObjects ? (
          <LoadingState label="Loading objects..." />
        ) : filteredFolders.length === 0 && filteredObjects.length === 0 ? (
          <EmptyState title="No objects found" description="This prefix is empty or does not match your filter." />
        ) : (
          <div className="flex flex-col gap-2">
            {filteredFolders.map((folderPrefix) => (
              <button
                key={folderPrefix}
                onClick={() => setPrefix(folderPrefix)}
                className="flex items-center gap-2 rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 py-2 text-left hover:bg-[var(--vscode-list-hoverBackground)]"
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
                className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-medium text-[var(--vscode-foreground)]">{pathTail(object.name)}</div>
                    <div className="truncate text-[10px] text-description">{object.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-description">
                      <span>{formatBytes(object.size)}</span>
                      <span>{object.storageTier || "Standard"}</span>
                      <span>{formatDateTime(object.timeModified || object.timeCreated)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button variant="secondary" size="sm" onClick={() => handleDownload(object.name)} disabled={busy}>
                      <HardDriveDownload size={12} />
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => handleCreatePar(object.name)} disabled={busy}>
                      <KeyRound size={12} />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
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
        requireText={guardrail?.requireText}
        busy={busy}
        onCancel={() => {
          if (!busy) {
            setGuardrail(null)
          }
        }}
        onConfirm={runGuardedAction}
      />
    </div>
  )
}

function Header({
  title,
  subtitle,
  onRefresh,
  loading,
  leading,
}: {
  title: string
  subtitle?: string
  onRefresh: () => void
  loading: boolean
  leading?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--vscode-panel-border)] px-3 py-2 bg-[var(--vscode-editor-background)]">
      <div className="flex min-w-0 items-center gap-2">
        {leading}
        <PackageOpen size={14} className="text-[var(--vscode-icon-foreground)]" />
        <div className="min-w-0">
          <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--vscode-sideBarTitle-foreground)]">{title}</div>
          {subtitle && <div className="truncate text-[10px] text-description">{subtitle}</div>}
        </div>
      </div>
      <Button variant="icon" size="icon" onClick={onRefresh} disabled={loading} title="Refresh">
        <RefreshCw size={14} className={clsx(loading && "animate-spin")} />
      </Button>
    </div>
  )
}

function InlineError({ message }: { message: string }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-[2px] border border-error/30 bg-[color-mix(in_srgb,var(--vscode-editor-background)_92%,red_8%)] px-3 py-2.5 text-[11px] text-error">
      <AlertCircle size={13} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-[12px] text-description">
      <Loader2 size={14} className="animate-spin" />
      <span>{label}</span>
    </div>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border-panel bg-list-background-hover">
        <PackageOpen size={22} className="text-description" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-xs text-description">{description}</p>
      </div>
    </div>
  )
}

function BucketList({
  groupedBuckets,
  compartmentNameById,
  onSelect,
}: {
  groupedBuckets: { compartmentId: string; regions: { region: string; buckets: ObjectStorageBucketResource[] }[] }[]
  compartmentNameById: Map<string, string>
  onSelect: (bucket: ObjectStorageBucketResource) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {groupedBuckets.map((group) => (
        <div key={group.compartmentId}>
          <h5 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-[var(--vscode-sideBarTitle-foreground)]">
            {compartmentNameById.get(group.compartmentId) ?? group.compartmentId}
          </h5>
          <div className="flex flex-col gap-3">
            {group.regions.map((regionGroup) => (
              <div key={`${group.compartmentId}-${regionGroup.region}`} className="flex flex-col gap-2">
                <h6 className="text-[10px] font-semibold uppercase tracking-wider text-description border-b border-[var(--vscode-panel-border)] pb-1">
                  {regionGroup.region}
                </h6>
                {regionGroup.buckets.map((bucket) => (
                  <button
                    key={`${bucket.region}-${bucket.namespaceName}-${bucket.name}`}
                    onClick={() => onSelect(bucket)}
                    className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-3 py-2 text-left hover:bg-[var(--vscode-list-hoverBackground)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-medium text-[var(--vscode-foreground)]">{bucket.name}</div>
                        <div className="truncate text-[10px] text-description">{bucket.namespaceName}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-description">
                          <span>{bucket.storageTier || "Standard"}</span>
                          <span>{formatCount(bucket.approximateCount)}</span>
                          <span>{formatBytes(bucket.approximateSize)}</span>
                          {bucket.publicAccessType && <span>{bucket.publicAccessType}</span>}
                        </div>
                      </div>
                      <ArrowDownToLine size={12} className="shrink-0 rotate-[-90deg] text-description" />
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function MetaCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] px-2 py-2">
      <div className="text-[10px] uppercase tracking-wide text-description">{label}</div>
      <div className="truncate text-[12px] text-[var(--vscode-foreground)]">{value}</div>
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

const breadcrumbButtonClass =
  "rounded-[2px] px-1 py-0.5 text-[11px] text-description hover:bg-[var(--vscode-list-hoverBackground)] hover:text-[var(--vscode-foreground)]"
