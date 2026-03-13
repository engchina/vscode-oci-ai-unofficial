import { clsx } from "clsx"
import {
  AlertCircle,
  ArrowDownToLine,
  AudioLines,
  Check,
  CheckCircle2,
  CircleSlash,
  FileAudio,
  FileText,
  ListChecks,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { toneFromLifecycleState, useWorkbenchInsight } from "../../context/WorkbenchInsightContext"
import { ResourceServiceClient } from "../../services/grpc-client"
import type {
  CreateSpeechTranscriptionJobRequest,
  ObjectStorageBucketResource,
  ObjectStorageObjectResource,
  SpeechTranscriptionJobResource,
  SpeechTranscriptionLanguageCode,
  SpeechTranscriptionModelType,
  SpeechTranscriptionTaskResource,
} from "../../services/types"
import GuardrailDialog from "../common/GuardrailDialog"
import CompartmentSelector from "../ui/CompartmentSelector"
import InlineNotice from "../ui/InlineNotice"
import Input from "../ui/Input"
import StatusBadge, { LifecycleBadge } from "../ui/StatusBadge"
import Textarea from "../ui/Textarea"
import Toggle from "../ui/Toggle"
import Select from "../ui/Select"
import {
  SummaryMetaCard,
  WorkbenchEmptyState,
  WorkbenchHero,
  WorkbenchKeyValueStrip,
  WorkbenchLoadingState,
  WorkbenchSection,
  WorkbenchSurface,
} from "../workbench/DatabaseWorkbenchChrome"
import FeaturePageLayout, { FeatureSearchInput } from "../workbench/FeaturePageLayout"
import WorkbenchActionInventoryCard from "../workbench/WorkbenchActionInventoryCard"
import {
  WorkbenchActionButton,
  WorkbenchBackButton,
  WorkbenchCompactActionCluster,
  WorkbenchDestructiveButton,
  WorkbenchIconDestructiveButton,
  WorkbenchRevealButton,
  WorkbenchSecondaryActionButton,
  WorkbenchSelectButton,
  WorkbenchSubmitButton,
} from "../workbench/WorkbenchActionButtons"
import { WorkbenchSegmentedControl, WorkbenchMicroOptionButton } from "../workbench/WorkbenchCompactControls"
import type { WorkbenchGuardrailState } from "../workbench/guardrail"
import {
  buildWorkbenchGuardrailDetails,
  buildWorkbenchResourceGuardrailDetails,
  createDeleteResourceGuardrail,
  createWorkbenchGuardrail,
} from "../workbench/guardrail"
import {
  WorkbenchInventoryFilterEmpty,
  WorkbenchInventoryGroupHeading,
  WorkbenchInventoryRegionHeading,
  WorkbenchInventorySummary,
} from "../workbench/WorkbenchInventoryScaffold"
import { backToLabel, openViewLabel, openWorkspaceLabel, showInListLabel } from "../workbench/navigationLabels"
import { WorkbenchRefreshButton } from "../workbench/WorkbenchToolbar"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/Tabs"

const SPEECH_REGION = "us-chicago-1"
const SPEECH_REGION_LABEL = "US Midwest (Chicago)"
const POLL_INTERVAL_MS = 5000
const MAX_SPEECH_OBJECTS_PER_JOB = 100
const MAX_SPEECH_OBJECT_SIZE_BYTES = 2 * 1024 * 1024 * 1024
const MAX_WHISPER_PROMPT_LENGTH = 4000
const MAX_SPEECH_DISPLAY_NAME_SEED_LENGTH = 96
const PREFIX_INPUT_DEBOUNCE_MS = 250
const MAX_RESULT_PREVIEW_BYTES = 262144
const SPEECH_RESULT_RECENCY_BUFFER_MS = 5 * 60 * 1000
const SPEECH_DISPLAY_NAME_PATTERN = /^[A-Za-z0-9_-]+$/
const SPEECH_SUPPORTED_FORMATS = ["AAC", "AC3", "AMR", "AU", "FLAC", "M4A", "MKV", "MP3", "MP4", "OGA", "OGG", "OPUS", "WAV", "WEBM"] as const
const SPEECH_SUPPORTED_FORMATS_TEXT = SPEECH_SUPPORTED_FORMATS.join(", ")
const SPEECH_RESULT_TEXT_FORMATS = ["json", "jsonl", "srt", "txt", "log", "csv", "tsv"] as const
const TRANSITIONAL_JOB_STATES = new Set(["ACCEPTED", "IN_PROGRESS", "CANCELING"])
const TRANSITIONAL_TASK_STATES = new Set(["ACCEPTED", "IN_PROGRESS"])
const CANCELLABLE_JOB_STATES = new Set(["ACCEPTED", "IN_PROGRESS"])
const DELETABLE_JOB_STATES = new Set(["SUCCEEDED", "FAILED", "CANCELED", "CANCELLED", "PARTIALLY_SUCCEEDED"])
const DEFAULT_SPEECH_MODEL: SpeechTranscriptionModelType = "WHISPER_LARGE_V3T"

const MODEL_OPTIONS: Array<{ value: SpeechTranscriptionModelType; label: string; description: string }> = [
  {
    value: DEFAULT_SPEECH_MODEL,
    label: "Whisper Large v3T",
    description: "Default Whisper model for higher-quality transcription jobs.",
  },
  {
    value: "WHISPER_MEDIUM",
    label: "Whisper Medium",
    description: "Smaller Whisper model for lighter transcription workloads.",
  },
]

const LANGUAGE_OPTIONS: Array<{ value: SpeechTranscriptionLanguageCode; label: string }> = [
  { value: "ja", label: "Japanese" },
  { value: "en", label: "English" },
  { value: "zh", label: "Chinese" },
]

type OutputMode = "same" | "different"

type SpeechJobDraft = {
  displayName: string
  description: string
  inputBucketKey: string
  inputPrefix: string
  selectedObjectNames: string[]
  outputMode: OutputMode
  outputBucketKey: string
  outputPrefix: string
  modelType: SpeechTranscriptionModelType
  languageCode: SpeechTranscriptionLanguageCode
  includeSrt: boolean
  enableDiarization: boolean
  enableProfanityFilter: boolean
  whisperPrompt: string
}

type RecentActionState =
  | {
    message: string
    timestamp: number
  }
  | null

type SpeechViewMode = "inventory" | "job" | "workspace"
type SpeechWorkspaceTab = "source" | "profile"
type SpeechJobTab = "overview" | "tasks" | "results" | "configuration"
type SpeechResultTab = "json" | "srt"
type SpeechBucketLoadResult = {
  applied: boolean
  buckets: ObjectStorageBucketResource[]
  draft: SpeechJobDraft
}

type SpeechResultPreviewState = {
  objectName: string
  text: string
  truncated: boolean
} | null

type SpeechTaskResultMatch = {
  objects: ObjectStorageObjectResource[]
  json: ObjectStorageObjectResource | null
  srt: ObjectStorageObjectResource | null
}

function buildInitialDraft(): SpeechJobDraft {
  return {
    displayName: "",
    description: "",
    inputBucketKey: "",
    inputPrefix: "",
    selectedObjectNames: [],
    outputMode: "same",
    outputBucketKey: "",
    outputPrefix: "speech-output/",
    modelType: DEFAULT_SPEECH_MODEL,
    languageCode: "ja",
    includeSrt: true,
    enableDiarization: false,
    enableProfanityFilter: false,
    whisperPrompt: "",
  }
}

export default function SpeechView({ mode = "inventory" }: { mode?: SpeechViewMode }) {
  const { activeProfile, profilesConfig, tenancyOcid, speechCompartmentIds, navigateToView } = useExtensionState()
  const { setResource } = useWorkbenchInsight()
  const isInventoryView = mode === "inventory"
  const isJobView = mode === "job"
  const isWorkspaceView = mode === "workspace"
  const [jobs, setJobs] = useState<SpeechTranscriptionJobResource[]>([])
  const [speechBuckets, setSpeechBuckets] = useState<ObjectStorageBucketResource[]>([])
  const [selectedJobId, setSelectedJobId] = useState("")
  const [jobDetail, setJobDetail] = useState<SpeechTranscriptionJobResource | null>(null)
  const [tasks, setTasks] = useState<SpeechTranscriptionTaskResource[]>([])
  const [tasksJobId, setTasksJobId] = useState("")
  const [resultObjects, setResultObjects] = useState<ObjectStorageObjectResource[]>([])
  const [draft, setDraft] = useState<SpeechJobDraft>(() => buildInitialDraft())
  const [debouncedInputPrefix, setDebouncedInputPrefix] = useState("")
  const [inputPrefixes, setInputPrefixes] = useState<string[]>([])
  const [inputObjects, setInputObjects] = useState<ObjectStorageObjectResource[]>([])
  const [selectedInputObjectDetails, setSelectedInputObjectDetails] = useState<Record<string, ObjectStorageObjectResource>>({})
  const [loadingJobs, setLoadingJobs] = useState(true)
  const [loadingBuckets, setLoadingBuckets] = useState(true)
  const [loadingJobDetail, setLoadingJobDetail] = useState(false)
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [loadingObjects, setLoadingObjects] = useState(false)
  const [loadingResultObjects, setLoadingResultObjects] = useState(false)
  const [loadingResultPreview, setLoadingResultPreview] = useState(false)
  const [creating, setCreating] = useState(false)
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null)
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null)
  const [downloadingResultObjectName, setDownloadingResultObjectName] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [taskQuery, setTaskQuery] = useState("")
  const [objectQuery, setObjectQuery] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [resultObjectsError, setResultObjectsError] = useState<string | null>(null)
  const [resultPreviewError, setResultPreviewError] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState("")
  const [resultPreviewTab, setResultPreviewTab] = useState<SpeechResultTab>("json")
  const [resultPreview, setResultPreview] = useState<SpeechResultPreviewState>(null)
  const [guardrail, setGuardrail] = useState<WorkbenchGuardrailState>(null)
  const [recentAction, setRecentAction] = useState<RecentActionState>(null)
  const [highlightedJobId, setHighlightedJobId] = useState<string | null>(null)
  const [workspaceTab, setWorkspaceTab] = useState<SpeechWorkspaceTab>("source")
  const [jobTab, setJobTab] = useState<SpeechJobTab>("tasks")

  const recentActionTimerRef = useRef<number | null>(null)
  const highlightTimerRef = useRef<number | null>(null)
  const jobItemRefs = useRef(new Map<string, HTMLDivElement>())
  const draftRef = useRef<SpeechJobDraft>(buildInitialDraft())
  const speechBucketsRef = useRef<ObjectStorageBucketResource[]>([])
  const selectedJobIdRef = useRef("")
  const jobsLoadRequestIdRef = useRef(0)
  const bucketLoadRequestIdRef = useRef(0)
  const detailLoadRequestIdRef = useRef(0)
  const taskLoadRequestIdRef = useRef(0)
  const objectLoadRequestIdRef = useRef(0)
  const resultLoadRequestIdRef = useRef(0)
  const resultPreviewLoadRequestIdRef = useRef(0)

  const selectedCompartmentIds = useMemo(
    () => speechCompartmentIds.map((value) => value.trim()).filter((value) => value.length > 0),
    [speechCompartmentIds],
  )

  const compartmentNameById = useMemo(() => {
    const map = new Map<string, string>()
    const rootId = tenancyOcid?.trim()
    if (rootId) {
      map.set(rootId, "Root (Tenancy)")
    }
    const activeProfileConfig = profilesConfig.find((profile) => profile.name === activeProfile)
    for (const compartment of activeProfileConfig?.compartments ?? []) {
      if (compartment.id?.trim()) {
        map.set(compartment.id.trim(), compartment.name?.trim() || compartment.id.trim())
      }
    }
    return map
  }, [activeProfile, profilesConfig, tenancyOcid])

  const bucketsByKey = useMemo(
    () => new Map(speechBuckets.map((bucket) => [getBucketKey(bucket), bucket])),
    [speechBuckets],
  )

  const selectedInputBucket = draft.inputBucketKey ? bucketsByKey.get(draft.inputBucketKey) ?? null : null
  const selectedOutputBucket = draft.outputMode === "same"
    ? selectedInputBucket
    : draft.outputBucketKey
      ? bucketsByKey.get(draft.outputBucketKey) ?? null
      : null

  const selectedJobSummary = useMemo(
    () => jobs.find((job) => job.id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  )

  const selectedJob = useMemo(() => {
    if (!selectedJobSummary && !jobDetail) {
      return null
    }
    if (!jobDetail || jobDetail.id !== selectedJobId) {
      return selectedJobSummary
    }
    return {
      ...(selectedJobSummary ?? {}),
      ...jobDetail,
    } as SpeechTranscriptionJobResource
  }, [jobDetail, selectedJobId, selectedJobSummary])
  const hasCurrentJobDetail = Boolean(jobDetail && jobDetail.id === selectedJobId)

  const visibleTasks = useMemo(
    () => tasksJobId === selectedJobId ? tasks : [],
    [selectedJobId, tasks, tasksJobId],
  )

  const filteredTasks = useMemo(() => {
    const normalizedQuery = taskQuery.trim().toLowerCase()
    if (!normalizedQuery) {
      return visibleTasks
    }
    return visibleTasks.filter((task) =>
      [task.name, task.id, task.lifecycleState, task.lifecycleDetails]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
    )
  }, [taskQuery, visibleTasks])

  const selectedTask = useMemo(
    () => visibleTasks.find((task) => task.id === selectedTaskId) ?? null,
    [selectedTaskId, visibleTasks],
  )

  const visibleResultObjects = useMemo(
    () => getLikelySpeechResultObjects(resultObjects, selectedJob),
    [resultObjects, selectedJob],
  )

  const taskResultMatches = useMemo(
    () => buildSpeechTaskResultMatches(visibleTasks, resultObjects),
    [resultObjects, visibleTasks],
  )

  const selectedTaskResultObjects = useMemo(
    () => selectedTask ? taskResultMatches.get(selectedTask.id)?.objects ?? [] : [],
    [selectedTask, taskResultMatches],
  )

  const displayedResultObjects = useMemo(
    () => selectedTask ? selectedTaskResultObjects : visibleResultObjects,
    [selectedTask, selectedTaskResultObjects, visibleResultObjects],
  )

  const selectedTaskJsonResult = useMemo(
    () => selectedTask ? taskResultMatches.get(selectedTask.id)?.json ?? null : null,
    [selectedTask, taskResultMatches],
  )

  const selectedTaskSrtResult = useMemo(
    () => selectedTask ? taskResultMatches.get(selectedTask.id)?.srt ?? null : null,
    [selectedTask, taskResultMatches],
  )

  const displayedJsonResult = useMemo(
    () => selectedTask ? selectedTaskJsonResult : getPreferredSpeechResultObject(displayedResultObjects, "json"),
    [displayedResultObjects, selectedTask, selectedTaskJsonResult],
  )

  const displayedSrtResult = useMemo(
    () => selectedTask ? selectedTaskSrtResult : getPreferredSpeechResultObject(displayedResultObjects, "srt"),
    [displayedResultObjects, selectedTask, selectedTaskSrtResult],
  )

  const activeResultObject = useMemo(
    () => resultPreviewTab === "json" ? displayedJsonResult : displayedSrtResult,
    [displayedJsonResult, displayedSrtResult, resultPreviewTab],
  )

  const filteredJobs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
      return jobs
    }
    return jobs.filter((job) =>
      [job.name, job.id, job.lifecycleState, job.lifecycleDetails]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
    )
  }, [jobs, query])

  const groupedJobs = useMemo(
    () => groupJobsByCompartment(filteredJobs, compartmentNameById),
    [compartmentNameById, filteredJobs],
  )

  const visibleInputObjects = useMemo(() => {
    const normalizedQuery = objectQuery.trim().toLowerCase()
    if (!normalizedQuery) {
      return inputObjects
    }
    return inputObjects.filter((item) => item.name.toLowerCase().includes(normalizedQuery))
  }, [inputObjects, objectQuery])

  const selectedInputObjects = useMemo(() => {
    if (draft.selectedObjectNames.length === 0) {
      return []
    }
    return draft.selectedObjectNames
      .map((objectName) => selectedInputObjectDetails[objectName])
      .filter((item): item is ObjectStorageObjectResource => Boolean(item))
  }, [draft.selectedObjectNames, selectedInputObjectDetails])

  const hiddenSelectedObjectCount = useMemo(() => {
    if (draft.selectedObjectNames.length === 0) {
      return 0
    }
    const visibleObjectNames = new Set(visibleInputObjects.map((item) => item.name))
    return draft.selectedObjectNames.filter((objectName) => !visibleObjectNames.has(objectName)).length
  }, [draft.selectedObjectNames, visibleInputObjects])

  const hasUnavailableSelectedObjects = useMemo(
    () => draft.selectedObjectNames.length > 0 && selectedInputObjects.length !== draft.selectedObjectNames.length,
    [draft.selectedObjectNames.length, selectedInputObjects.length],
  )

  const selectedOversizedInputObject = useMemo(
    () => selectedInputObjects.find((item) => typeof item.size === "number" && item.size > MAX_SPEECH_OBJECT_SIZE_BYTES) ?? null,
    [selectedInputObjects],
  )
  const manualDisplayName = draft.displayName.trim()
  const sanitizedManualDisplayName = manualDisplayName ? sanitizeSpeechDisplayName(manualDisplayName) : ""
  const suggestedDisplayName = useMemo(
    () => buildSuggestedJobName(draft.selectedObjectNames),
    [draft.selectedObjectNames],
  )
  const effectiveDisplayName = manualDisplayName || suggestedDisplayName
  const displayNameValidationError = manualDisplayName ? getSpeechDisplayNameValidationError(manualDisplayName) : null
  const jobMutationBusy = Boolean(cancellingJobId || deletingJobId)

  const isSyncing = creating
    || jobMutationBusy
    || (isWorkspaceView && (loadingBuckets || loadingObjects))
    || (isInventoryView && (loadingJobs || loadingBuckets))
    || (isJobView && (loadingJobs || loadingJobDetail || loadingTasks || loadingResultObjects || (jobTab === "results" && loadingResultPreview)))

  const createActionDisabled = creating
    || loadingBuckets
    || loadingObjects
    || !selectedInputBucket
    || !selectedOutputBucket
    || draft.selectedObjectNames.length === 0
    || draft.selectedObjectNames.length > MAX_SPEECH_OBJECTS_PER_JOB
    || draft.whisperPrompt.trim().length > MAX_WHISPER_PROMPT_LENGTH
    || Boolean(selectedOversizedInputObject)
    || Boolean(displayNameValidationError)
    || hasUnavailableSelectedObjects
    || !selectedCompartmentIds.includes(selectedInputBucket?.compartmentId ?? "")
    || !selectedCompartmentIds.includes(selectedOutputBucket?.compartmentId ?? "")

  const isPolling = useMemo(
    () =>
      jobs.some((job) => TRANSITIONAL_JOB_STATES.has(normalizeSpeechLifecycleState(job.lifecycleState)))
      || visibleTasks.some((task) => TRANSITIONAL_TASK_STATES.has(normalizeSpeechLifecycleState(task.lifecycleState))),
    [jobs, visibleTasks],
  )

  const revealJob = useCallback((jobId: string) => {
    setQuery("")
    setHighlightedJobId(jobId)
    requestAnimationFrame(() => {
      jobItemRefs.current.get(jobId)?.scrollIntoView({ block: "nearest" })
    })
  }, [])

  const cancelSelectedJobRequests = useCallback(() => {
    detailLoadRequestIdRef.current += 1
    taskLoadRequestIdRef.current += 1
    resultLoadRequestIdRef.current += 1
    resultPreviewLoadRequestIdRef.current += 1
  }, [])

  const cancelInputObjectRequests = useCallback(() => {
    objectLoadRequestIdRef.current += 1
  }, [])

  const selectJob = useCallback((jobId: string) => {
    const normalizedJobId = jobId.trim()
    if (normalizedJobId === selectedJobIdRef.current) {
      setSelectedJobId(normalizedJobId)
      return
    }
    selectedJobIdRef.current = normalizedJobId
    cancelSelectedJobRequests()
    setSelectedJobId(normalizedJobId)
    setJobDetail(null)
    setTasks([])
    setTasksJobId("")
    setDetailError(null)
    setTaskQuery("")
    setSelectedTaskId("")
    setResultObjects([])
    setResultObjectsError(null)
    setResultPreviewTab("json")
    setResultPreview(null)
    setResultPreviewError(null)
  }, [cancelSelectedJobRequests])

  const openJobDetails = useCallback((jobId: string) => {
    selectJob(jobId)
    navigateToView("speechJob")
  }, [navigateToView, selectJob])

  const loadJobs = useCallback(async (preferredJobId?: string) => {
    const requestId = jobsLoadRequestIdRef.current + 1
    jobsLoadRequestIdRef.current = requestId
    setLoadingJobs(true)
    setError(null)

    if (selectedCompartmentIds.length === 0) {
      setJobs([])
      selectedJobIdRef.current = ""
      cancelSelectedJobRequests()
      setSelectedJobId("")
      setJobDetail(null)
      setTasks([])
      setTasksJobId("")
      setDetailError(null)
      setTaskQuery("")
      setSelectedTaskId("")
      setResultObjects([])
      setResultObjectsError(null)
      setResultPreviewTab("json")
      setResultPreview(null)
      setResultPreviewError(null)
      setHighlightedJobId(null)
      setLoadingJobs(false)
      return
    }

    try {
      const response = await ResourceServiceClient.listSpeechTranscriptionJobs()
      if (jobsLoadRequestIdRef.current !== requestId) {
        return
      }

      const nextJobs = response.jobs ?? []
      const currentSelectedJobId = selectedJobIdRef.current
      setJobs(nextJobs)

      const nextSelectedJobId =
        preferredJobId && nextJobs.some((job) => job.id === preferredJobId)
          ? preferredJobId
          : currentSelectedJobId && nextJobs.some((job) => job.id === currentSelectedJobId)
            ? currentSelectedJobId
            : nextJobs[0]?.id ?? ""

      if (nextSelectedJobId !== currentSelectedJobId) {
        selectJob(nextSelectedJobId)
        return
      }
      selectedJobIdRef.current = nextSelectedJobId
      setSelectedJobId(nextSelectedJobId)
    } catch (loadError) {
      if (jobsLoadRequestIdRef.current !== requestId) {
        return
      }
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      if (jobsLoadRequestIdRef.current === requestId) {
        setLoadingJobs(false)
      }
    }
  }, [cancelSelectedJobRequests, selectJob, selectedCompartmentIds])

  const loadBuckets = useCallback(async (): Promise<SpeechBucketLoadResult> => {
    const requestId = bucketLoadRequestIdRef.current + 1
    bucketLoadRequestIdRef.current = requestId
    setLoadingBuckets(true)
    setError(null)

    if (selectedCompartmentIds.length === 0) {
      cancelInputObjectRequests()
      setSpeechBuckets([])
      setInputPrefixes([])
      setInputObjects([])
      setSelectedInputObjectDetails({})
      setObjectQuery("")
      setDebouncedInputPrefix("")
      const initialDraft = buildInitialDraft()
      setDraft(initialDraft)
      setLoadingBuckets(false)
      return { applied: true, buckets: [], draft: initialDraft }
    }

    try {
      const response = await ResourceServiceClient.listSpeechBuckets()
      if (bucketLoadRequestIdRef.current !== requestId) {
        return { applied: false, buckets: speechBucketsRef.current, draft: draftRef.current }
      }

      const nextBuckets = response.buckets ?? []
      const currentDraft = draftRef.current
      const nextDraft = syncDraftBuckets(currentDraft, nextBuckets)
      setSpeechBuckets(nextBuckets)
      if (nextDraft.inputBucketKey !== currentDraft.inputBucketKey) {
        cancelInputObjectRequests()
        setInputPrefixes([])
        setInputObjects([])
        setSelectedInputObjectDetails({})
        setObjectQuery("")
        setDebouncedInputPrefix("")
      }
      setDraft(nextDraft)
      return { applied: true, buckets: nextBuckets, draft: nextDraft }
    } catch (loadError) {
      if (bucketLoadRequestIdRef.current !== requestId) {
        return { applied: false, buckets: speechBucketsRef.current, draft: draftRef.current }
      }
      setError(loadError instanceof Error ? loadError.message : String(loadError))
      return { applied: false, buckets: speechBucketsRef.current, draft: draftRef.current }
    } finally {
      if (bucketLoadRequestIdRef.current === requestId) {
        setLoadingBuckets(false)
      }
    }
  }, [cancelInputObjectRequests, selectedCompartmentIds])

  const loadJobDetail = useCallback(async (jobId: string) => {
    if (!jobId) {
      setJobDetail(null)
      return
    }

    const requestId = detailLoadRequestIdRef.current + 1
    detailLoadRequestIdRef.current = requestId
    setLoadingJobDetail(true)
    setDetailError(null)

    try {
      const response = await ResourceServiceClient.getSpeechTranscriptionJob({ transcriptionJobId: jobId })
      if (detailLoadRequestIdRef.current !== requestId) {
        return
      }
      setJobDetail(response.job)
    } catch (loadError) {
      if (detailLoadRequestIdRef.current !== requestId) {
        return
      }
      setDetailError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      if (detailLoadRequestIdRef.current === requestId) {
        setLoadingJobDetail(false)
      }
    }
  }, [])

  const loadTasks = useCallback(async (jobId: string) => {
    if (!jobId) {
      setTasks([])
      setTasksJobId("")
      return
    }

    const requestId = taskLoadRequestIdRef.current + 1
    taskLoadRequestIdRef.current = requestId
    setLoadingTasks(true)

    try {
      const response = await ResourceServiceClient.listSpeechTranscriptionTasks({ transcriptionJobId: jobId })
      if (taskLoadRequestIdRef.current !== requestId) {
        return
      }
      setTasksJobId(jobId)
      setTasks(response.tasks ?? [])
    } catch (loadError) {
      if (taskLoadRequestIdRef.current !== requestId) {
        return
      }
      setDetailError(loadError instanceof Error ? loadError.message : String(loadError))
      setTasksJobId(jobId)
      setTasks([])
    } finally {
      if (taskLoadRequestIdRef.current === requestId) {
        setLoadingTasks(false)
      }
    }
  }, [])

  const loadResultObjects = useCallback(async (job: SpeechTranscriptionJobResource | null) => {
    const requestId = resultLoadRequestIdRef.current + 1
    resultLoadRequestIdRef.current = requestId

    const namespaceName = job?.outputNamespaceName?.trim() || ""
    const bucketName = job?.outputBucketName?.trim() || ""
    if (!job || !namespaceName || !bucketName) {
      setResultObjects([])
      setResultObjectsError(null)
      setResultPreview(null)
      setResultPreviewError(null)
      setLoadingResultObjects(false)
      return
    }

    setLoadingResultObjects(true)
    setResultObjectsError(null)

    try {
      const response = await ResourceServiceClient.listObjectStorageObjects({
        namespaceName,
        bucketName,
        region: job.region || SPEECH_REGION,
        prefix: normalizePrefix(job.outputPrefix || ""),
        recursive: true,
      })
      if (resultLoadRequestIdRef.current !== requestId) {
        return
      }

      const nextObjects = response.objects ?? []
      setResultObjects(nextObjects)
    } catch (loadError) {
      if (resultLoadRequestIdRef.current !== requestId) {
        return
      }
      setResultObjects([])
      setResultPreview(null)
      setResultPreviewError(null)
      setResultObjectsError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      if (resultLoadRequestIdRef.current === requestId) {
        setLoadingResultObjects(false)
      }
    }
  }, [])

  const loadInputObjects = useCallback(async (bucket: ObjectStorageBucketResource | null, prefix: string) => {
    const requestId = objectLoadRequestIdRef.current + 1
    objectLoadRequestIdRef.current = requestId

    if (!bucket) {
      setInputPrefixes([])
      setInputObjects([])
      setSelectedInputObjectDetails({})
      setLoadingObjects(false)
      return
    }

    setLoadingObjects(true)
    setError(null)

    try {
      const response = await ResourceServiceClient.listSpeechObjects({
        namespaceName: bucket.namespaceName,
        bucketName: bucket.name,
        prefix: normalizePrefix(prefix),
      })
      if (objectLoadRequestIdRef.current !== requestId) {
        return
      }

      const nextPrefixes = response.prefixes ?? []
      const nextObjects = response.objects ?? []
      setInputPrefixes(nextPrefixes)
      setInputObjects(nextObjects)
      const nextObjectsByName = new Map(nextObjects.map((item) => [item.name, item]))
      setSelectedInputObjectDetails((currentDetails) => {
        if (draftRef.current.selectedObjectNames.length === 0) {
          return currentDetails
        }
        let changed = false
        const nextDetails = { ...currentDetails }
        for (const objectName of draftRef.current.selectedObjectNames) {
          const nextObject = nextObjectsByName.get(objectName)
          if (!nextObject) {
            continue
          }
          nextDetails[objectName] = nextObject
          changed = true
        }
        return changed ? nextDetails : currentDetails
      })
    } catch (loadError) {
      if (objectLoadRequestIdRef.current !== requestId) {
        return
      }
      setError(loadError instanceof Error ? loadError.message : String(loadError))
      setInputPrefixes([])
      setInputObjects([])
    } finally {
      if (objectLoadRequestIdRef.current === requestId) {
        setLoadingObjects(false)
      }
    }
  }, [])

  const refreshCurrentView = useCallback(() => {
    if (isWorkspaceView) {
      void (async () => {
        const { applied, buckets, draft } = await loadBuckets()
        if (!applied) {
          return
        }
        const nextInputBucket = draft.inputBucketKey
          ? buckets.find((bucket) => getBucketKey(bucket) === draft.inputBucketKey) ?? null
          : null
        await loadInputObjects(nextInputBucket, draft.inputPrefix)
      })()
      return
    }
    if (isInventoryView) {
      void loadBuckets()
      void loadJobs()
      return
    }
    const activeJobId = selectedJobIdRef.current
    void loadJobs(activeJobId || undefined)
    if (activeJobId) {
      void loadJobDetail(activeJobId)
      void loadTasks(activeJobId)
    }
    void loadResultObjects(selectedJob)
  }, [isInventoryView, isWorkspaceView, loadBuckets, loadInputObjects, loadJobDetail, loadJobs, loadResultObjects, loadTasks, selectedJob])

  const refreshSelectedJob = useCallback((jobId: string, job: SpeechTranscriptionJobResource | null) => {
    if (!jobId) {
      return
    }
    void loadJobs(jobId)
    void loadJobDetail(jobId)
    void loadTasks(jobId)
    void loadResultObjects(job)
  }, [loadJobDetail, loadJobs, loadResultObjects, loadTasks])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    speechBucketsRef.current = speechBuckets
  }, [speechBuckets])

  useEffect(() => {
    setSelectedInputObjectDetails((currentDetails) => {
      const selectedNames = new Set(draft.selectedObjectNames)
      const nextEntries = Object.entries(currentDetails).filter(([objectName]) => selectedNames.has(objectName))
      if (nextEntries.length === Object.keys(currentDetails).length) {
        return currentDetails
      }
      return Object.fromEntries(nextEntries)
    })
  }, [draft.selectedObjectNames])

  useEffect(() => {
    selectedJobIdRef.current = selectedJobId
  }, [selectedJobId])

  useEffect(() => {
    if (!isJobView) {
      return
    }
    setSelectedTaskId((currentSelectedTaskId) => {
      if (currentSelectedTaskId && filteredTasks.some((task) => task.id === currentSelectedTaskId)) {
        return currentSelectedTaskId
      }
      return filteredTasks[0]?.id ?? ""
    })
  }, [filteredTasks, isJobView])

  useEffect(() => {
    if (isWorkspaceView) {
      void loadBuckets()
      return
    }

    if (isInventoryView) {
      void loadBuckets()
      void loadJobs()
      return
    }

    void loadJobs(selectedJobIdRef.current || undefined)
  }, [isInventoryView, isWorkspaceView, loadBuckets, loadJobs])

  useEffect(() => {
    if (!isJobView) {
      return
    }
    if (!selectedJobId) {
      cancelSelectedJobRequests()
      setJobDetail(null)
      setTasks([])
      setTasksJobId("")
      setDetailError(null)
      setTaskQuery("")
      setSelectedTaskId("")
      setResultObjects([])
      setResultObjectsError(null)
      setResultPreviewTab("json")
      setResultPreview(null)
      setResultPreviewError(null)
      return
    }

    setJobDetail((currentJobDetail) => currentJobDetail?.id === selectedJobId ? currentJobDetail : null)
    setTasks([])
    setTasksJobId("")
    setDetailError(null)
    setTaskQuery("")
    setSelectedTaskId("")
    void loadJobDetail(selectedJobId)
    void loadTasks(selectedJobId)
  }, [cancelSelectedJobRequests, isJobView, loadJobDetail, loadTasks, selectedJobId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedInputPrefix(normalizePrefix(draft.inputPrefix))
    }, PREFIX_INPUT_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [draft.inputPrefix])

  useEffect(() => {
    if (!isWorkspaceView) {
      return
    }
    void loadInputObjects(selectedInputBucket, debouncedInputPrefix)
  }, [debouncedInputPrefix, isWorkspaceView, loadInputObjects, selectedInputBucket])

  useEffect(() => {
    if (!isJobView) {
      return
    }
    void loadResultObjects(selectedJob)
  }, [
    isJobView,
    loadResultObjects,
    selectedJob?.id,
    selectedJob?.lifecycleState,
    selectedJob?.outputBucketName,
    selectedJob?.outputNamespaceName,
    selectedJob?.percentComplete,
    selectedJob?.outputPrefix,
    selectedJob?.timeAccepted,
    selectedJob?.timeFinished,
  ])

  useEffect(() => {
    if (!isJobView || jobTab !== "results" || !activeResultObject) {
      setLoadingResultPreview(false)
      setResultPreview(null)
      setResultPreviewError(null)
      return
    }

    if (!canPreviewSpeechResultObject(activeResultObject.name)) {
      setLoadingResultPreview(false)
      setResultPreview(null)
      setResultPreviewError(null)
      return
    }

    const namespaceName = selectedJob?.outputNamespaceName?.trim() || ""
    const bucketName = selectedJob?.outputBucketName?.trim() || ""
    if (!namespaceName || !bucketName) {
      setLoadingResultPreview(false)
      setResultPreview(null)
      setResultPreviewError("Speech output location is unavailable for preview.")
      return
    }

    const requestId = resultPreviewLoadRequestIdRef.current + 1
    resultPreviewLoadRequestIdRef.current = requestId
    setLoadingResultPreview(true)
    setResultPreview(null)
    setResultPreviewError(null)

    void ResourceServiceClient.readObjectStorageObjectText({
      namespaceName,
      bucketName,
      objectName: activeResultObject.name,
      region: selectedJob?.region || SPEECH_REGION,
      maxBytes: MAX_RESULT_PREVIEW_BYTES,
    })
      .then((response) => {
        if (resultPreviewLoadRequestIdRef.current !== requestId) {
          return
        }
        setResultPreview({
          objectName: activeResultObject.name,
          text: response.text ?? "",
          truncated: Boolean(response.truncated),
        })
      })
      .catch((loadError) => {
        if (resultPreviewLoadRequestIdRef.current !== requestId) {
          return
        }
        setResultPreview(null)
        setResultPreviewError(loadError instanceof Error ? loadError.message : String(loadError))
      })
      .finally(() => {
        if (resultPreviewLoadRequestIdRef.current === requestId) {
          setLoadingResultPreview(false)
        }
      })
  }, [
    activeResultObject,
    isJobView,
    jobTab,
    selectedJob?.id,
    selectedJob?.outputBucketName,
    selectedJob?.outputNamespaceName,
    selectedJob?.region,
  ])

  useEffect(() => {
    if (isWorkspaceView || !isPolling) {
      return
    }

    const timer = window.setInterval(() => {
      void loadJobs()
      if (isJobView && selectedJobId) {
        void loadJobDetail(selectedJobId)
        void loadTasks(selectedJobId)
      }
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [isJobView, isPolling, isWorkspaceView, loadJobDetail, loadJobs, loadTasks, selectedJobId])

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

  useEffect(() => {
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current)
      highlightTimerRef.current = null
    }

    if (!highlightedJobId) {
      return
    }

    highlightTimerRef.current = window.setTimeout(() => {
      highlightTimerRef.current = null
      setHighlightedJobId(null)
    }, 2200)

    return () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current)
        highlightTimerRef.current = null
      }
    }
  }, [highlightedJobId])

  useEffect(() => {
    if (selectedJobId) {
      setJobTab("tasks")
    }
  }, [selectedJobId])

  useEffect(() => {
    if (isJobView) {
      setJobTab("tasks")
    }
  }, [isJobView])

  useEffect(() => {
    if (isWorkspaceView) {
      setWorkspaceTab("source")
    }
  }, [isWorkspaceView])

  useEffect(() => {
    if (isWorkspaceView) {
      setResource({
        view: "speechWorkspace",
        title: effectiveDisplayName,
        eyebrow: "Speech Draft",
        resourceId: `${SPEECH_REGION_LABEL} • ${draft.selectedObjectNames.length} files selected`,
        badge: { label: "Draft", tone: "neutral" },
        metrics: [
          { label: "Region", value: SPEECH_REGION_LABEL },
          { label: "Input Bucket", value: selectedInputBucket?.name || "Not set" },
          { label: "Output Bucket", value: selectedOutputBucket?.name || "Not set" },
          { label: "Language", value: getLanguageLabel(draft.languageCode) },
        ],
        notes: [
          `Model: ${getModelLabel(draft.modelType)}`,
          draft.whisperPrompt.trim() ? "Whisper prompt is configured for the next job." : "No whisper prompt configured yet.",
        ],
        actions: [
          {
            label: backToLabel("Speech"),
            run: () => navigateToView("speech"),
            variant: "secondary",
          },
          {
            label: openViewLabel("Object Storage"),
            run: () => navigateToView("objectStorage"),
            variant: "ghost",
          },
        ],
      })
      return () => setResource(null)
    }

    if (!isJobView || !selectedJob) {
      setResource(null)
      return
    }

    const selectedFileCount = getSpeechInputFileCount(selectedJob)
    const activeResultObjectLabel = activeResultObject ? getLeafName(activeResultObject.name) : ""
    setResource({
      view: "speechJob",
      title: selectedJob.name,
      eyebrow: "Speech Job",
      resourceId: selectedJob.id,
      badge: {
        label: selectedJob.lifecycleState,
        tone: toneFromLifecycleState(selectedJob.lifecycleState),
      },
      metrics: [
        { label: "Region", value: SPEECH_REGION_LABEL },
        { label: "Model", value: getModelLabel(selectedJob.modelType) },
        { label: "Language", value: getLanguageLabel(selectedJob.languageCode) },
        { label: "Files", value: formatCount(selectedFileCount) },
      ],
      notes: [
        `Input bucket: ${selectedJob.inputBucketName || "-"}`,
        `Output bucket: ${selectedJob.outputBucketName || "-"}`,
        ...(jobTab === "results" && activeResultObjectLabel ? [`Previewing ${resultPreviewTab.toUpperCase()}: ${activeResultObjectLabel}`] : []),
        selectedJob.whisperPrompt ? "Whisper prompt is configured." : "Whisper prompt is empty.",
      ],
      actions: [
        ...(query
          ? [{
            label: "Clear Filter",
            run: () => setQuery(""),
            variant: "ghost" as const,
          }]
          : []),
        {
          label: showInListLabel("Speech Job"),
          run: () => {
            navigateToView("speech")
            requestAnimationFrame(() => revealJob(selectedJob.id))
          },
          variant: "ghost",
        },
        {
          label: openWorkspaceLabel("Speech"),
          run: () => navigateToView("speechWorkspace"),
          variant: "secondary",
        },
        {
          label: "Refresh Job",
          run: () => refreshSelectedJob(selectedJob.id, selectedJob),
          variant: "secondary",
        },
      ],
    })

    return () => setResource(null)
  }, [
    draft.displayName,
    draft.languageCode,
    draft.modelType,
    draft.selectedObjectNames.length,
    draft.whisperPrompt,
    effectiveDisplayName,
    isJobView,
    isWorkspaceView,
    navigateToView,
    resultPreviewTab,
    jobTab,
    query,
    refreshSelectedJob,
    revealJob,
    activeResultObject,
    selectedInputBucket?.name,
    selectedJob,
    selectedOutputBucket?.name,
    setResource,
  ])

  const updateDraft = useCallback((patch: Partial<SpeechJobDraft>) => {
    setDraft((currentDraft) => ({ ...currentDraft, ...patch }))
  }, [])

  const handleInputBucketChange = useCallback((bucketKey: string) => {
    cancelInputObjectRequests()
    setInputPrefixes([])
    setInputObjects([])
    setSelectedInputObjectDetails({})
    setDebouncedInputPrefix("")
    setDraft((currentDraft) => ({
      ...currentDraft,
      inputBucketKey: bucketKey,
      inputPrefix: "",
      selectedObjectNames: [],
      outputBucketKey:
        !currentDraft.outputBucketKey || currentDraft.outputBucketKey === currentDraft.inputBucketKey
          ? bucketKey
          : currentDraft.outputBucketKey,
    }))
    setObjectQuery("")
  }, [cancelInputObjectRequests])

  const handleOutputModeChange = useCallback((outputMode: OutputMode) => {
    setDraft((currentDraft) => ({
      ...currentDraft,
      outputMode,
      outputBucketKey: outputMode === "different"
        ? currentDraft.outputBucketKey || currentDraft.inputBucketKey
        : currentDraft.outputBucketKey,
    }))
  }, [])

  const toggleInputObject = useCallback((objectName: string) => {
    setDraft((currentDraft) => {
      const isSelected = currentDraft.selectedObjectNames.includes(objectName)
      if (isSelected) {
        setSelectedInputObjectDetails((currentDetails) => {
          const { [objectName]: _removed, ...remaining } = currentDetails
          return remaining
        })
      } else {
        const selectedObject = inputObjects.find((item) => item.name === objectName)
        if (selectedObject) {
          setSelectedInputObjectDetails((currentDetails) => ({
            ...currentDetails,
            [objectName]: selectedObject,
          }))
        }
      }
      return {
        ...currentDraft,
        selectedObjectNames: isSelected
          ? currentDraft.selectedObjectNames.filter((value) => value !== objectName)
          : [...currentDraft.selectedObjectNames, objectName],
      }
    })
  }, [inputObjects])

  const handleCreateJob = useCallback(async () => {
    setError(null)

    if (creating || loadingBuckets || loadingObjects) {
      setError("Wait for the Speech workspace refresh to finish before creating a job.")
      return
    }
    if (!selectedInputBucket) {
      setError("Select an input bucket before creating a Speech job.")
      return
    }
    if (hasUnavailableSelectedObjects) {
      setError("Refresh the input object list and reselect files before creating a Speech job.")
      return
    }
    if (draft.selectedObjectNames.length === 0) {
      setError("Select at least one audio object from the input bucket.")
      return
    }
    if (!selectedCompartmentIds.includes(selectedInputBucket.compartmentId)) {
      setError("The selected input bucket is outside the active Speech compartment scope. Refresh buckets and choose again.")
      return
    }
    if (draft.selectedObjectNames.length > MAX_SPEECH_OBJECTS_PER_JOB) {
      setError(`OCI Speech accepts up to ${MAX_SPEECH_OBJECTS_PER_JOB} input files per job.`)
      return
    }
    if (!selectedOutputBucket) {
      setError("Select an output bucket before creating a Speech job.")
      return
    }
    if (!selectedCompartmentIds.includes(selectedOutputBucket.compartmentId)) {
      setError("The selected output bucket is outside the active Speech compartment scope. Refresh buckets and choose again.")
      return
    }
    if (draft.whisperPrompt.trim().length > MAX_WHISPER_PROMPT_LENGTH) {
      setError(`Whisper prompt must be ${MAX_WHISPER_PROMPT_LENGTH} characters or fewer.`)
      return
    }
    if (displayNameValidationError) {
      setError(displayNameValidationError)
      return
    }
    const oversizedObject = selectedOversizedInputObject
    if (oversizedObject) {
      setError(`${getLeafName(oversizedObject.name)} exceeds the 2 GB per-file Speech limit.`)
      return
    }

    const request: CreateSpeechTranscriptionJobRequest = {
      compartmentId: selectedInputBucket.compartmentId,
      displayName: effectiveDisplayName,
      description: draft.description.trim() || undefined,
      inputNamespaceName: selectedInputBucket.namespaceName,
      inputBucketName: selectedInputBucket.name,
      inputObjectNames: draft.selectedObjectNames,
      outputNamespaceName: selectedOutputBucket.namespaceName,
      outputBucketName: selectedOutputBucket.name,
      outputPrefix: draft.outputPrefix.trim() || undefined,
      modelType: draft.modelType,
      languageCode: draft.languageCode,
      includeSrt: draft.includeSrt,
      enablePunctuation: true,
      enableDiarization: draft.enableDiarization,
      profanityFilterMode: draft.enableProfanityFilter ? "MASK" : undefined,
      whisperPrompt: draft.whisperPrompt.trim() || undefined,
    }

    setCreating(true)
    try {
      const response = await ResourceServiceClient.createSpeechTranscriptionJob(request)
      const createdJob = response.job
      setRecentAction({
        message: `Created ${createdJob.name}`,
        timestamp: Date.now(),
      })
      setHighlightedJobId(createdJob.id)
      setSelectedInputObjectDetails({})
      setDraft((currentDraft) => ({
        ...buildInitialDraft(),
        inputBucketKey: currentDraft.inputBucketKey,
        outputBucketKey: currentDraft.outputMode === "different" ? currentDraft.outputBucketKey : currentDraft.inputBucketKey,
      }))
      await loadJobs(createdJob.id)
      await Promise.all([
        loadJobDetail(createdJob.id),
        loadTasks(createdJob.id),
      ])
      navigateToView("speechJob")
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError))
    } finally {
      setCreating(false)
    }
  }, [creating, displayNameValidationError, draft, effectiveDisplayName, hasUnavailableSelectedObjects, loadJobDetail, loadJobs, loadTasks, loadingBuckets, loadingObjects, navigateToView, selectedCompartmentIds, selectedInputBucket, selectedOutputBucket, selectedOversizedInputObject])

  const requestCancelJob = useCallback((job: SpeechTranscriptionJobResource) => {
    if (!canCancelSpeechJob(job) || cancellingJobId || deletingJobId) {
      return
    }

    setGuardrail(createWorkbenchGuardrail({
      title: `Cancel ${job.name}?`,
      description: "Canceling the job stops all transcription tasks currently running under it.",
      confirmLabel: "Cancel Job",
      tone: "danger",
      details: buildWorkbenchGuardrailDetails(
        buildWorkbenchResourceGuardrailDetails({
          resourceLabel: "Speech Job",
          resourceName: job.name,
          region: SPEECH_REGION_LABEL,
          extras: [
            { label: "Model", value: getModelLabel(job.modelType) },
            { label: "Language", value: getLanguageLabel(job.languageCode) },
          ],
        }),
      ),
      onConfirm: async () => {
        setCancellingJobId(job.id)
        try {
          setError(null)
          await ResourceServiceClient.cancelSpeechTranscriptionJob({ transcriptionJobId: job.id })
          setRecentAction({
            message: `Cancellation requested for ${job.name}`,
            timestamp: Date.now(),
          })
          await Promise.all([
            loadJobs(job.id),
            loadJobDetail(job.id),
            loadTasks(job.id),
          ])
        } catch (cancelError) {
          setError(cancelError instanceof Error ? cancelError.message : String(cancelError))
        } finally {
          setCancellingJobId(null)
          setGuardrail(null)
        }
      },
    }))
  }, [cancellingJobId, deletingJobId, loadJobDetail, loadJobs, loadTasks])

  const requestDeleteJob = useCallback((job: SpeechTranscriptionJobResource) => {
    if (!canDeleteSpeechJob(job) || cancellingJobId || deletingJobId) {
      return
    }

    setGuardrail(createDeleteResourceGuardrail({
      resourceTitle: "Speech Job",
      confirmTarget: "Job",
      subject: "Speech transcription job",
      effect: "removes the retained job record from OCI Speech. Result files already written to Object Storage are not deleted.",
      details: buildWorkbenchResourceGuardrailDetails({
        resourceLabel: "Speech Job",
        resourceName: job.name,
        region: SPEECH_REGION_LABEL,
        extras: [
          { label: "Status", value: job.lifecycleState || "UNKNOWN" },
          { label: "Model", value: getModelLabel(job.modelType) },
          { label: "Language", value: getLanguageLabel(job.languageCode) },
        ],
      }),
      onConfirm: async () => {
        setDeletingJobId(job.id)
        try {
          setError(null)
          await ResourceServiceClient.deleteSpeechTranscriptionJob({ transcriptionJobId: job.id })
          setRecentAction({
            message: `Deleted ${job.name}`,
            timestamp: Date.now(),
          })
          const preferredJobId = selectedJobIdRef.current && selectedJobIdRef.current !== job.id
            ? selectedJobIdRef.current
            : undefined
          await loadJobs(preferredJobId)
        } catch (deleteError) {
          setError(deleteError instanceof Error ? deleteError.message : String(deleteError))
        } finally {
          setDeletingJobId(null)
          setGuardrail(null)
        }
      },
    }))
  }, [cancellingJobId, deletingJobId, loadJobs])

  const handleDownloadResult = useCallback(async (objectName: string) => {
    const namespaceName = selectedJob?.outputNamespaceName?.trim() || ""
    const bucketName = selectedJob?.outputBucketName?.trim() || ""
    if (!selectedJob || !namespaceName || !bucketName || !objectName.trim() || downloadingResultObjectName) {
      return
    }

    setDownloadingResultObjectName(objectName)
    setError(null)
    try {
      const response = await ResourceServiceClient.downloadObjectStorageObject({
        namespaceName,
        bucketName,
        objectName,
        region: selectedJob.region || SPEECH_REGION,
      })
      if (!response.cancelled) {
        setRecentAction({
          message: `Downloaded ${getLeafName(objectName)}`,
          timestamp: Date.now(),
        })
      }
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : String(downloadError))
    } finally {
      setDownloadingResultObjectName(null)
    }
  }, [downloadingResultObjectName, selectedJob])

  return (
    <>
      <FeaturePageLayout
        title={isWorkspaceView ? "Speech Workspace" : isJobView ? "Speech Job" : "Speech"}
        description={isWorkspaceView
          ? "Configure OCI Speech transcription jobs with focused source, output, and model controls."
          : isJobView
            ? "Inspect task progress, inline results, and the effective configuration for the selected Speech job."
            : "Create and monitor OCI Speech transcription jobs in Chicago."}
        icon={<AudioLines size={14} />}
        leading={isWorkspaceView || isJobView
          ? <WorkbenchBackButton type="button" label={backToLabel("Speech")} onClick={() => navigateToView("speech")} />
          : undefined}
        status={(
          <div className="flex items-center gap-1">
            <StatusBadge label="us-chicago-1" tone="neutral" />
            {isSyncing && <StatusBadge label="Syncing" tone="warning" />}
          </div>
        )}
        actions={(
          <WorkbenchCompactActionCluster>
            <WorkbenchRefreshButton onClick={refreshCurrentView} disabled={isSyncing} spinning={isSyncing} />
            {!isWorkspaceView && (
              <WorkbenchActionButton type="button" variant="secondary" onClick={() => navigateToView("speechWorkspace")}>
                {openWorkspaceLabel("Speech")}
              </WorkbenchActionButton>
            )}
          </WorkbenchCompactActionCluster>
        )}
        controls={isInventoryView
          ? (
            <div className="grid gap-2 xl:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
              <CompartmentSelector featureKey="speech" multiple />
              <FeatureSearchInput
                value={query}
                onChange={setQuery}
                placeholder="Search Speech jobs by name, OCID, or state..."
              />
            </div>
          )
          : isWorkspaceView
            ? <CompartmentSelector featureKey="speech" multiple />
            : undefined}
        contentClassName="p-2"
      >
        {isWorkspaceView ? (
          <section className="h-full min-h-0 overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-shell)]">
            <div className="h-full overflow-y-auto p-2">
              <div className="flex min-h-full flex-col gap-2">
                {recentAction && (
                  <InlineNotice tone="success" icon={<CheckCircle2 size={14} />}>
                    {recentAction.message}
                  </InlineNotice>
                )}

                {error && (
                  <InlineNotice tone="danger" icon={<AlertCircle size={14} />} title="Speech Error">
                    {error}
                  </InlineNotice>
                )}

                {selectedCompartmentIds.length === 0 ? (
                  <WorkbenchEmptyState
                    icon={<CircleSlash size={18} />}
                    title="No Speech Compartments Selected"
                    description="Choose one or more compartments above before creating a Speech transcription workflow."
                  />
                ) : (
                  renderCreateWorkspace({
                    draft,
                    suggestedDisplayName,
                    displayNameValidationError,
                    sanitizedManualDisplayName,
                    updateDraft,
                    onOutputModeChange: handleOutputModeChange,
                    loadingBuckets,
                    loadingObjects,
                    speechBuckets,
                    selectedInputBucket,
                    selectedOutputBucket,
                    inputPrefixes,
                    inputObjects: visibleInputObjects,
                    availableInputObjectCount: inputObjects.length,
                    hiddenSelectedObjectCount,
                    hasUnavailableSelectedObjects,
                    objectQuery,
                    onObjectQueryChange: setObjectQuery,
                    onInputBucketChange: handleInputBucketChange,
                    onSelectOutputBucket: (value) => updateDraft({ outputBucketKey: value }),
                    onSelectPrefix: (value) => updateDraft({ inputPrefix: value }),
                    onToggleInputObject: toggleInputObject,
                    onRefreshObjects: () => void loadInputObjects(selectedInputBucket, draft.inputPrefix),
                    onCreateJob: handleCreateJob,
                    creating,
                    createDisabled: createActionDisabled,
                    oversizedSelectedObjectName: selectedOversizedInputObject ? getLeafName(selectedOversizedInputObject.name) : null,
                    workspaceTab,
                    onWorkspaceTabChange: setWorkspaceTab,
                    navigateToView,
                  })
                )}
              </div>
            </div>
          </section>
        ) : isJobView ? (
          <section className="h-full min-h-0 overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-shell)]">
            <div className="h-full overflow-y-auto p-2">
              <div className="flex min-h-full flex-col gap-2">
                {recentAction && (
                  <InlineNotice tone="success" icon={<CheckCircle2 size={14} />}>
                    {recentAction.message}
                  </InlineNotice>
                )}

                {error && (
                  <InlineNotice tone="danger" icon={<AlertCircle size={14} />} title="Speech Error">
                    {error}
                  </InlineNotice>
                )}

                {renderJobDetailWorkspace({
                  selectedJob,
                  hasCurrentJobDetail,
                  selectedJobId,
                  tasks: visibleTasks,
                  filteredTasks,
                  selectedTask,
                  selectedTaskId,
                  selectedTaskJsonResult,
                  selectedTaskSrtResult,
                  displayedResultObjects,
                  displayedJsonResult,
                  displayedSrtResult,
                  taskResultMatches,
                  taskQuery,
                  activeResultObject,
                  resultPreviewTab,
                  resultPreview,
                  loadingJobDetail,
                  loadingTasks,
                  loadingResultObjects,
                  loadingResultPreview,
                  detailError,
                  resultObjectsError,
                  resultPreviewError,
                  downloadingResultObjectName,
                  onTaskQueryChange: setTaskQuery,
                  onSelectTask: setSelectedTaskId,
                  onResultPreviewTabChange: setResultPreviewTab,
                  onDownloadResult: handleDownloadResult,
                  onCancelJob: requestCancelJob,
                  onDeleteJob: requestDeleteJob,
                  cancellingJobId,
                  deletingJobId,
                  jobMutationBusy,
                  jobTab,
                  onJobTabChange: setJobTab,
                  navigateToView,
                })}
              </div>
            </div>
          </section>
        ) : (
          renderSpeechInventoryPage({
            jobs,
            speechBuckets,
            selectedCompartmentIds,
            groupedJobs,
            selectedJobId,
            loadingJobs,
            recentAction,
            error,
            highlightedJobId,
            jobItemRefs,
            deletingJobId,
            jobMutationBusy,
            onSelectJob: selectJob,
            onOpenJob: openJobDetails,
            onDeleteJob: requestDeleteJob,
          })
        )}
      </FeaturePageLayout>

      <GuardrailDialog
        open={Boolean(guardrail)}
        title={guardrail?.title ?? ""}
        description={guardrail?.description ?? ""}
        confirmLabel={guardrail?.confirmLabel ?? "Confirm"}
        details={guardrail?.details}
        tone={guardrail?.tone}
        busy={Boolean(cancellingJobId || deletingJobId)}
        onCancel={() => {
          if (!cancellingJobId && !deletingJobId) {
            setGuardrail(null)
          }
        }}
        onConfirm={() => void guardrail?.onConfirm()}
      />
    </>
  )
}

function renderSpeechInventoryPage({
  jobs,
  speechBuckets,
  selectedCompartmentIds,
  groupedJobs,
  selectedJobId,
  loadingJobs,
  recentAction,
  error,
  highlightedJobId,
  jobItemRefs,
  deletingJobId,
  jobMutationBusy,
  onSelectJob,
  onOpenJob,
  onDeleteJob,
}: {
  jobs: SpeechTranscriptionJobResource[]
  speechBuckets: ObjectStorageBucketResource[]
  selectedCompartmentIds: string[]
  groupedJobs: Array<{ compartmentId: string; compartmentName: string; jobs: SpeechTranscriptionJobResource[] }>
  selectedJobId: string
  loadingJobs: boolean
  recentAction: RecentActionState
  error: string | null
  highlightedJobId: string | null
  jobItemRefs: MutableRefObject<Map<string, HTMLDivElement>>
  deletingJobId: string | null
  jobMutationBusy: boolean
  onSelectJob: (jobId: string) => void
  onOpenJob: (jobId: string) => void
  onDeleteJob: (job: SpeechTranscriptionJobResource) => void
}) {
  const filteredJobCount = groupedJobs.reduce((total, group) => total + group.jobs.length, 0)

  return (
    <section className="h-full min-h-0 overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-shell)]">
      <div className="h-full overflow-y-auto p-2">
        <div className="flex min-h-full flex-col gap-2">
          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(140px,0.32fr)_minmax(140px,0.32fr)]">
            <WorkbenchInventorySummary
              label="Speech inventory"
              count={filteredJobCount === jobs.length ? `${jobs.length} jobs` : `${filteredJobCount} of ${jobs.length} jobs`}
              description="Select a job, then open the Speech job view to inspect task progress and output files."
            />
            <SummaryMetaCard label="Buckets" value={String(speechBuckets.length)} />
            <SummaryMetaCard label="Compartments" value={String(selectedCompartmentIds.length)} />
          </div>

          {recentAction && (
            <InlineNotice tone="success" icon={<CheckCircle2 size={14} />}>
              {recentAction.message}
            </InlineNotice>
          )}

          {error && (
            <InlineNotice tone="danger" icon={<AlertCircle size={14} />} title="Speech Error">
              {error}
            </InlineNotice>
          )}

          {loadingJobs ? (
            <WorkbenchLoadingState label="Loading Speech jobs..." />
          ) : selectedCompartmentIds.length === 0 ? (
            <WorkbenchEmptyState
              icon={<CircleSlash size={18} />}
              title="No Speech Compartments Selected"
              description="Choose one or more compartments above to browse Speech jobs and buckets in Chicago."
            />
          ) : groupedJobs.length === 0 ? (
            <WorkbenchInventoryFilterEmpty
              message={jobs.length === 0
                ? "No Speech jobs found yet. Open the workspace to create the first transcription job."
                : "No Speech jobs match the current filter."}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              {groupedJobs.map((group) => (
                <section key={group.compartmentId} className="space-y-1">
                  <WorkbenchInventoryGroupHeading>{group.compartmentName}</WorkbenchInventoryGroupHeading>
                  <WorkbenchInventoryRegionHeading>{SPEECH_REGION_LABEL}</WorkbenchInventoryRegionHeading>
                  <div className="space-y-1.5 pt-1">
                    {group.jobs.map((job) => (
                      <WorkbenchActionInventoryCard
                        key={job.id}
                        cardRef={(node) => {
                          if (node) {
                            jobItemRefs.current.set(job.id, node)
                            return
                          }
                          jobItemRefs.current.delete(job.id)
                        }}
                        title={job.name}
                        subtitle={job.id}
                        selected={job.id === selectedJobId}
                        highlighted={job.id === highlightedJobId}
                        trailing={<LifecycleBadge state={job.lifecycleState} size="compact" />}
                        meta={(
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-description">
                            <span>{formatPercent(job.percentComplete, job.lifecycleState)}</span>
                            <span>{formatTaskProgress(job.successfulTasks, job.totalTasks)}</span>
                            {job.timeAccepted && <span>{formatDateTime(job.timeAccepted)}</span>}
                          </div>
                        )}
                        actions={(
                          <WorkbenchCompactActionCluster>
                            <WorkbenchSelectButton type="button" selected={job.id === selectedJobId} onClick={() => onSelectJob(job.id)} />
                            <WorkbenchRevealButton type="button" label={openViewLabel("Speech Job")} onClick={() => onOpenJob(job.id)} />
                            {canDeleteSpeechJob(job) && (
                              <WorkbenchIconDestructiveButton
                                icon={<Trash2 size={12} />}
                                onClick={() => onDeleteJob(job)}
                                disabled={jobMutationBusy}
                                title={deletingJobId === job.id ? "Deleting Speech job" : "Delete this completed Speech job"}
                                busy={deletingJobId === job.id}
                              />
                            )}
                          </WorkbenchCompactActionCluster>
                        )}
                        onSelect={() => onSelectJob(job.id)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function renderCreateWorkspace({
  draft,
  suggestedDisplayName,
  displayNameValidationError,
  sanitizedManualDisplayName,
  updateDraft,
  onOutputModeChange,
  loadingBuckets,
  loadingObjects,
  speechBuckets,
  selectedInputBucket,
  selectedOutputBucket,
  inputPrefixes,
  inputObjects,
  availableInputObjectCount,
  hiddenSelectedObjectCount,
  hasUnavailableSelectedObjects,
  objectQuery,
  onObjectQueryChange,
  onInputBucketChange,
  onSelectOutputBucket,
  onSelectPrefix,
  onToggleInputObject,
  onRefreshObjects,
  onCreateJob,
  creating,
  createDisabled,
  oversizedSelectedObjectName,
  workspaceTab,
  onWorkspaceTabChange,
  navigateToView,
}: {
  draft: SpeechJobDraft
  suggestedDisplayName: string
  displayNameValidationError: string | null
  sanitizedManualDisplayName: string
  updateDraft: (patch: Partial<SpeechJobDraft>) => void
  onOutputModeChange: (value: OutputMode) => void
  loadingBuckets: boolean
  loadingObjects: boolean
  speechBuckets: ObjectStorageBucketResource[]
  selectedInputBucket: ObjectStorageBucketResource | null
  selectedOutputBucket: ObjectStorageBucketResource | null
  inputPrefixes: string[]
  inputObjects: ObjectStorageObjectResource[]
  availableInputObjectCount: number
  hiddenSelectedObjectCount: number
  hasUnavailableSelectedObjects: boolean
  objectQuery: string
  onObjectQueryChange: (value: string) => void
  onInputBucketChange: (value: string) => void
  onSelectOutputBucket: (value: string) => void
  onSelectPrefix: (value: string) => void
  onToggleInputObject: (objectName: string) => void
  onRefreshObjects: () => void
  onCreateJob: () => void
  creating: boolean
  createDisabled: boolean
  oversizedSelectedObjectName: string | null
  workspaceTab: SpeechWorkspaceTab
  onWorkspaceTabChange: (value: SpeechWorkspaceTab) => void
  navigateToView: (view: "objectStorage" | "speech" | "speechWorkspace") => void
}) {
  const selectedObjectPreview = draft.selectedObjectNames.slice(0, 6)
  const hiddenSelectedPreviewCount = Math.max(0, draft.selectedObjectNames.length - selectedObjectPreview.length)
  const promptLength = draft.whisperPrompt.trim().length
  const hasPromptError = promptLength > MAX_WHISPER_PROMPT_LENGTH

  return (
    <div className="flex min-h-full flex-col gap-2">
      <Tabs
        value={workspaceTab}
        onValueChange={(value) => onWorkspaceTabChange(value as SpeechWorkspaceTab)}
        className="min-h-0 flex-1"
      >
        <TabsList>
          <TabsTrigger value="source">Source Setup</TabsTrigger>
          <TabsTrigger value="profile">Output &amp; Profile</TabsTrigger>
        </TabsList>

        <TabsContent value="source" className="flex min-h-0 flex-1 flex-col gap-2 pt-1.5">
          <WorkbenchSection
            title="Job Identity"
            subtitle="Keep the name recognizable in the Speech inventory. Leave it blank to auto-generate one."
          >
            <Input
              label="Display Name"
              value={draft.displayName}
              onChange={(event) => updateDraft({ displayName: event.target.value })}
              placeholder="speech-customer-call-20260311"
              aria-invalid={Boolean(displayNameValidationError)}
              className={clsx(displayNameValidationError && "border-[var(--vscode-errorForeground)]")}
            />
            <div className={clsx("text-[11px]", displayNameValidationError ? "text-[var(--vscode-errorForeground)]" : "text-description")}>
              {displayNameValidationError || (
                <>
                  Use only letters, numbers, dashes, or underscores. Auto-generated jobs use <code>{suggestedDisplayName}</code>.
                </>
              )}
              {displayNameValidationError && (
                <>
                  {" "}Try <code>{sanitizedManualDisplayName || suggestedDisplayName}</code>.
                </>
              )}
            </div>
            <Textarea
              label="Description"
              value={draft.description}
              onChange={(event) => updateDraft({ description: event.target.value })}
              placeholder="Optional context about the meeting, call, or batch."
              className="min-h-[88px]"
            />
          </WorkbenchSection>

          <WorkbenchSection
            title="Input Files"
            subtitle={`Choose a Chicago bucket, narrow by prefix when needed, and select up to ${MAX_SPEECH_OBJECTS_PER_JOB} supported audio files.`}
            actions={(
              <WorkbenchCompactActionCluster>
                <WorkbenchSecondaryActionButton type="button" variant="secondary" onClick={() => navigateToView("objectStorage")}>
                  {openViewLabel("Object Storage")}
                </WorkbenchSecondaryActionButton>
                <WorkbenchRefreshButton onClick={onRefreshObjects} disabled={!selectedInputBucket || loadingObjects} spinning={loadingObjects} />
              </WorkbenchCompactActionCluster>
            )}
          >
            <div className="grid gap-2 xl:grid-cols-[minmax(240px,0.72fr)_minmax(0,1.28fr)]">
              <WorkbenchSurface className="space-y-2">
                <Select
                  label="Input Bucket"
                  value={draft.inputBucketKey}
                  onChange={(event) => onInputBucketChange(event.target.value)}
                  disabled={loadingBuckets}
                  options={speechBuckets.map((bucket) => ({
                    value: getBucketKey(bucket),
                    label: bucket.name,
                    description: `${bucket.namespaceName} • ${bucket.compartmentId}`,
                  }))}
                  placeholder={loadingBuckets ? "Loading buckets..." : "Select a bucket"}
                />

                <Input
                  label="Prefix"
                  value={draft.inputPrefix}
                  onChange={(event) => updateDraft({ inputPrefix: event.target.value })}
                  placeholder="Optional folder prefix, e.g. calls/2026/03/"
                />

                <FeatureSearchInput
                  value={objectQuery}
                  onChange={onObjectQueryChange}
                  placeholder="Filter objects in the current prefix..."
                />

                <div className="flex flex-wrap gap-1">
                  <WorkbenchMicroOptionButton onClick={() => onSelectPrefix("")} title="Jump to bucket root">
                    Root
                  </WorkbenchMicroOptionButton>
                  {draft.inputPrefix && (
                    <WorkbenchMicroOptionButton
                      onClick={() => onSelectPrefix(getParentPrefix(draft.inputPrefix))}
                      title="Go to the parent prefix"
                    >
                      Up
                    </WorkbenchMicroOptionButton>
                  )}
                  {inputPrefixes.map((prefix) => (
                    <WorkbenchMicroOptionButton key={prefix} onClick={() => onSelectPrefix(prefix)} title={prefix}>
                      {trimTrailingSlash(getLeafName(prefix))}
                    </WorkbenchMicroOptionButton>
                  ))}
                </div>

                <div className="text-[11px] leading-5 text-description">
                  Supported media: {SPEECH_SUPPORTED_FORMATS_TEXT}
                </div>
              </WorkbenchSurface>

              <WorkbenchSurface className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[12px] font-medium text-foreground">Audio Objects</div>
                    <div className="text-[11px] text-description">
                      {draft.selectedObjectNames.length} selected from {selectedInputBucket?.name || "no bucket"}
                    </div>
                  </div>
                  {loadingObjects && (
                    <div className="inline-flex items-center gap-1 text-[11px] text-description">
                      <Loader2 size={12} className="animate-spin" />
                      Loading...
                    </div>
                  )}
                </div>

                {hiddenSelectedObjectCount > 0 && (
                  <InlineNotice
                    tone="info"
                    actions={(
                      <WorkbenchSecondaryActionButton type="button" variant="secondary" onClick={() => onObjectQueryChange("")}>
                        Clear Filter
                      </WorkbenchSecondaryActionButton>
                    )}
                  >
                    {hiddenSelectedObjectCount} selected object{hiddenSelectedObjectCount === 1 ? "" : "s"} hidden by the current prefix or filter.
                  </InlineNotice>
                )}

                {hasUnavailableSelectedObjects && (
                  <InlineNotice tone="warning" title="Selection Needs Refresh">
                    Some previously selected objects are no longer available. Refresh the bucket objects and reselect the files before creating the job.
                  </InlineNotice>
                )}

                {draft.selectedObjectNames.length > MAX_SPEECH_OBJECTS_PER_JOB && (
                  <InlineNotice tone="warning" title="Too Many Input Files">
                    OCI Speech accepts up to {MAX_SPEECH_OBJECTS_PER_JOB} files per job.
                  </InlineNotice>
                )}

                {oversizedSelectedObjectName && (
                  <InlineNotice tone="warning" title="Selected File Too Large">
                    {oversizedSelectedObjectName} exceeds the 2 GB per-file Speech limit.
                  </InlineNotice>
                )}

                {!selectedInputBucket ? (
                  <WorkbenchEmptyState
                    icon={<FileAudio size={18} />}
                    title="No Input Bucket Selected"
                    description="Pick a Speech input bucket to browse audio objects in Chicago."
                  />
                ) : loadingObjects ? (
                  <WorkbenchLoadingState label="Loading bucket objects..." />
                ) : availableInputObjectCount === 0 ? (
                  <WorkbenchEmptyState
                    icon={<FileAudio size={18} />}
                    title="No Supported Objects Under This Prefix"
                    description="Adjust the prefix, pick another bucket, or upload supported media files to Object Storage first."
                  />
                ) : inputObjects.length === 0 ? (
                  <WorkbenchEmptyState
                    icon={<FileAudio size={18} />}
                    title="No Objects Match This Filter"
                    description="Clear the object filter or change the prefix to see other supported media files."
                  />
                ) : (
                  <div className="space-y-1.5">
                    {inputObjects.map((item) => {
                      const selected = draft.selectedObjectNames.includes(item.name)
                      return (
                        <WorkbenchActionInventoryCard
                          key={item.name}
                          title={getLeafName(item.name)}
                          subtitle={item.name}
                          selected={selected}
                          trailing={<StatusBadge label={selected ? "Selected" : "Ready"} tone={selected ? "success" : "neutral"} size="compact" />}
                          meta={(
                            <div className="flex flex-wrap gap-2 text-[10px] text-description">
                              <span>{formatBytes(item.size)}</span>
                              <span>{formatDateTime(item.timeModified || item.timeCreated)}</span>
                            </div>
                          )}
                          actions={(
                            <WorkbenchSelectButton type="button" selected={selected} onClick={() => onToggleInputObject(item.name)} />
                          )}
                          onSelect={() => onToggleInputObject(item.name)}
                        />
                      )
                    })}
                  </div>
                )}
              </WorkbenchSurface>
            </div>
          </WorkbenchSection>
        </TabsContent>

        <TabsContent value="profile" className="flex min-h-0 flex-1 flex-col gap-2 pt-1.5">
          <WorkbenchSection
            title="Output"
            subtitle="JSON output is always produced. Enable SRT if subtitle output is also required."
          >
            <WorkbenchSegmentedControl<OutputMode>
              value={draft.outputMode}
              onChange={onOutputModeChange}
              items={[
                { value: "same", label: "Use Input Bucket" },
                { value: "different", label: "Choose Another Bucket" },
              ]}
            />

            <div className="grid gap-2 lg:grid-cols-2">
              <Select
                label={draft.outputMode === "same" ? "Effective Output Bucket" : "Output Bucket"}
                value={draft.outputMode === "same" ? draft.inputBucketKey : draft.outputBucketKey}
                onChange={(event) => onSelectOutputBucket(event.target.value)}
                disabled={draft.outputMode === "same" || loadingBuckets}
                options={speechBuckets.map((bucket) => ({
                  value: getBucketKey(bucket),
                  label: bucket.name,
                  description: `${bucket.namespaceName} • ${bucket.compartmentId}`,
                }))}
                placeholder={loadingBuckets ? "Loading buckets..." : "Select a bucket"}
              />

              <Input
                label="Output Prefix"
                value={draft.outputPrefix}
                onChange={(event) => updateDraft({ outputPrefix: event.target.value })}
                placeholder="speech-output/"
              />
            </div>
          </WorkbenchSection>

          <WorkbenchSection
            title="Transcription Profile"
            subtitle="Keep the profile focused on the language, model, and output options that affect the resulting transcript."
          >
            <div className="grid gap-2 lg:grid-cols-2">
              <Select
                label="Transcription Model"
                value={draft.modelType}
                onChange={(event) =>
                  updateDraft({
                    modelType: event.target.value as SpeechTranscriptionModelType,
                  })}
                options={MODEL_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                  description: option.description,
                }))}
              />

              <Select
                label="Language"
                value={draft.languageCode}
                onChange={(event) => updateDraft({ languageCode: event.target.value as SpeechTranscriptionLanguageCode })}
                options={LANGUAGE_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
              />
            </div>

            <div className="grid gap-2 lg:grid-cols-2">
              <Toggle
                checked={draft.includeSrt}
                onChange={(checked) => updateDraft({ includeSrt: checked })}
                label="Generate SRT"
                description="Add subtitle output alongside the default JSON transcription."
              />
              <Toggle
                checked
                onChange={() => undefined}
                label="Enable Punctuation"
                description="Pinned on for the supported Whisper models in this workspace."
                disabled
              />
              <Toggle
                checked={draft.enableDiarization}
                onChange={(checked) => updateDraft({ enableDiarization: checked })}
                label="Enable Diarization"
                description="Add speaker tags when multiple voices are present."
              />
              <Toggle
                checked={draft.enableProfanityFilter}
                onChange={(checked) => updateDraft({ enableProfanityFilter: checked })}
                label="Mask Profanity"
                description="Apply the official profanity filter using MASK mode."
              />
            </div>

            <Textarea
              label="Whisper Prompt"
              value={draft.whisperPrompt}
              onChange={(event) => updateDraft({ whisperPrompt: event.target.value })}
              placeholder="Optional context to bias recognition for names, products, or domain-specific terms."
              className="min-h-[100px]"
            />
            <div className="text-[11px] text-description">
              <span className={clsx(hasPromptError && "text-[var(--vscode-errorForeground)]")}>
                {promptLength} / {MAX_WHISPER_PROMPT_LENGTH} characters
              </span>
            </div>
          </WorkbenchSection>
        </TabsContent>
      </Tabs>

      <WorkbenchSection
        title="Create Speech Job"
        subtitle={`Jobs are created in ${SPEECH_REGION_LABEL}. The job compartment follows the selected input bucket.`}
        className="shrink-0"
      >
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <SummaryMetaCard label="Files" value={formatCount(draft.selectedObjectNames.length)} />
          <SummaryMetaCard label="Input" value={selectedInputBucket?.name || "Not set"} />
          <SummaryMetaCard label="Output" value={selectedOutputBucket?.name || "Not set"} />
          <SummaryMetaCard label="Profile" value={`${getModelLabel(draft.modelType)} • ${getLanguageLabel(draft.languageCode)}`} />
        </div>

        {selectedObjectPreview.length > 0 && (
          <WorkbenchSurface className="space-y-1.5">
            <div className="text-[12px] font-medium text-foreground">Selected Files</div>
            <div className="flex flex-wrap gap-1.5">
              {selectedObjectPreview.map((objectName) => (
                <span key={objectName} className="rounded-full border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)] px-2 py-0.5 text-[10px] text-description">
                  {getLeafName(objectName)}
                </span>
              ))}
              {hiddenSelectedPreviewCount > 0 && (
                <span className="rounded-full border border-dashed border-[var(--vscode-panel-border)] px-2 py-0.5 text-[10px] text-description">
                  +{hiddenSelectedPreviewCount} more
                </span>
              )}
            </div>
          </WorkbenchSurface>
        )}

        {hasPromptError && (
          <InlineNotice tone="warning" title="Prompt Too Long">
            Whisper prompt must be {MAX_WHISPER_PROMPT_LENGTH} characters or fewer.
          </InlineNotice>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] leading-5 text-description">
            Review the current draft, then create the job when the source files and profile are ready.
          </div>
          <WorkbenchSubmitButton
            type="button"
            variant="secondary"
            disabled={createDisabled}
            onClick={onCreateJob}
          >
            {creating ? <Loader2 size={12} className="animate-spin" /> : <ListChecks size={12} />}
            Create Speech Job
          </WorkbenchSubmitButton>
        </div>
      </WorkbenchSection>
    </div>
  )
}

function renderSpeechJobLifecycleActions({
  job,
  onCancelJob,
  onDeleteJob,
  cancellingJobId,
  deletingJobId,
  jobMutationBusy,
}: {
  job: SpeechTranscriptionJobResource
  onCancelJob: (job: SpeechTranscriptionJobResource) => void
  onDeleteJob: (job: SpeechTranscriptionJobResource) => void
  cancellingJobId: string | null
  deletingJobId: string | null
  jobMutationBusy: boolean
}) {
  const canCancel = canCancelSpeechJob(job)
  const canDelete = canDeleteSpeechJob(job)
  const actionBusy = jobMutationBusy

  if (!canCancel && !canDelete) {
    return null
  }

  return (
    <>
      {canCancel && (
        <WorkbenchActionButton
          type="button"
          variant="secondary"
          onClick={() => onCancelJob(job)}
          disabled={actionBusy}
        >
          {cancellingJobId === job.id ? <Loader2 size={12} className="animate-spin" /> : <CircleSlash size={12} />}
          Cancel Job
        </WorkbenchActionButton>
      )}
      {canDelete && (
        <WorkbenchDestructiveButton
          type="button"
          onClick={() => onDeleteJob(job)}
          disabled={actionBusy}
        >
          {deletingJobId === job.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
          Delete Job
        </WorkbenchDestructiveButton>
      )}
    </>
  )
}

function renderJobDetailWorkspace({
  selectedJob,
  hasCurrentJobDetail,
  selectedJobId,
  tasks,
  filteredTasks,
  selectedTask,
  selectedTaskId,
  selectedTaskJsonResult,
  selectedTaskSrtResult,
  displayedResultObjects,
  displayedJsonResult,
  displayedSrtResult,
  taskResultMatches,
  taskQuery,
  activeResultObject,
  resultPreviewTab,
  resultPreview,
  loadingJobDetail,
  loadingTasks,
  loadingResultObjects,
  loadingResultPreview,
  detailError,
  resultObjectsError,
  resultPreviewError,
  downloadingResultObjectName,
  onTaskQueryChange,
  onSelectTask,
  onResultPreviewTabChange,
  onDownloadResult,
  onCancelJob,
  onDeleteJob,
  cancellingJobId,
  deletingJobId,
  jobMutationBusy,
  jobTab,
  onJobTabChange,
  navigateToView,
}: {
  selectedJob: SpeechTranscriptionJobResource | null
  hasCurrentJobDetail: boolean
  selectedJobId: string
  tasks: SpeechTranscriptionTaskResource[]
  filteredTasks: SpeechTranscriptionTaskResource[]
  selectedTask: SpeechTranscriptionTaskResource | null
  selectedTaskId: string
  selectedTaskJsonResult: ObjectStorageObjectResource | null
  selectedTaskSrtResult: ObjectStorageObjectResource | null
  displayedResultObjects: ObjectStorageObjectResource[]
  displayedJsonResult: ObjectStorageObjectResource | null
  displayedSrtResult: ObjectStorageObjectResource | null
  taskResultMatches: Map<string, SpeechTaskResultMatch>
  taskQuery: string
  activeResultObject: ObjectStorageObjectResource | null
  resultPreviewTab: SpeechResultTab
  resultPreview: SpeechResultPreviewState
  loadingJobDetail: boolean
  loadingTasks: boolean
  loadingResultObjects: boolean
  loadingResultPreview: boolean
  detailError: string | null
  resultObjectsError: string | null
  resultPreviewError: string | null
  downloadingResultObjectName: string | null
  onTaskQueryChange: (value: string) => void
  onSelectTask: (taskId: string) => void
  onResultPreviewTabChange: (value: SpeechResultTab) => void
  onDownloadResult: (objectName: string) => void
  onCancelJob: (job: SpeechTranscriptionJobResource) => void
  onDeleteJob: (job: SpeechTranscriptionJobResource) => void
  cancellingJobId: string | null
  deletingJobId: string | null
  jobMutationBusy: boolean
  jobTab: SpeechJobTab
  onJobTabChange: (value: SpeechJobTab) => void
  navigateToView: (view: "objectStorage" | "speech" | "speechWorkspace") => void
}) {
  if (!selectedJobId) {
    return (
      <WorkbenchEmptyState
        icon={<AudioLines size={18} />}
        title="No Speech Job Selected"
        description="Pick a Speech job from the inventory or open the dedicated Speech workspace to create a new transcription workflow."
      />
    )
  }

  if ((!selectedJob || !hasCurrentJobDetail) && loadingJobDetail) {
    return <WorkbenchLoadingState label="Loading Speech job details..." />
  }

  if (!selectedJob) {
    return (
      <WorkbenchEmptyState
        icon={<AlertCircle size={18} />}
        title="Speech Job Not Available"
        description="The selected job could not be loaded. Refresh the inventory and try again."
      />
    )
  }

  const selectedFileCount = getSpeechInputFileCount(selectedJob)

  return (
    <div className="flex min-h-full flex-col gap-2">
      {detailError && (
        <InlineNotice tone="danger" icon={<AlertCircle size={14} />} title="Speech Detail Error">
          {detailError}
        </InlineNotice>
      )}

      {selectedJob.lifecycleDetails && (
        <InlineNotice tone={toneFromLifecycleState(selectedJob.lifecycleState) === "danger" ? "danger" : "info"} icon={<AlertCircle size={14} />} title="Lifecycle Details">
          {selectedJob.lifecycleDetails}
        </InlineNotice>
      )}

      <Tabs
        value={jobTab}
        onValueChange={(value) => onJobTabChange(value as SpeechJobTab)}
        className="min-h-0 flex-1"
      >
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="configuration">Configuration</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex min-h-0 flex-1 flex-col gap-2 pt-1.5">
          <WorkbenchSection
            title="Overview"
            subtitle="Review the selected Speech job status and top-level context before drilling into tasks, results, or configuration."
            actions={(
              <WorkbenchCompactActionCluster>
                {renderSpeechJobLifecycleActions({
                  job: selectedJob,
                  onCancelJob,
                  onDeleteJob,
                  cancellingJobId,
                  deletingJobId,
                  jobMutationBusy,
                })}
              </WorkbenchCompactActionCluster>
            )}
          >
            <WorkbenchHero
              eyebrow="Speech Job"
              title={selectedJob.name}
              resourceId={selectedJob.id}
              badge={<LifecycleBadge state={selectedJob.lifecycleState} />}
              metaItems={[
                { label: "Region", value: SPEECH_REGION_LABEL },
                { label: "Progress", value: formatPercent(selectedJob.percentComplete, selectedJob.lifecycleState) },
                { label: "Files", value: formatCount(selectedFileCount) },
                { label: "Tasks", value: formatTaskProgress(selectedJob.successfulTasks, selectedJob.totalTasks) },
              ]}
            />

              <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_minmax(280px,0.75fr)]">
                <WorkbenchKeyValueStrip
                  items={[
                    { label: "Accepted", value: formatDateTime(selectedJob.timeAccepted) },
                    { label: "Started", value: formatDateTime(selectedJob.timeStarted) },
                    { label: "Finished", value: formatDateTime(selectedJob.timeFinished) },
                    { label: "Input Bucket", value: selectedJob.inputBucketName || "-" },
                    { label: "Output Bucket", value: selectedJob.outputBucketName || "-" },
                    { label: "Output Prefix", value: selectedJob.outputPrefix || "/" },
                  ]}
                />

                <WorkbenchSurface className="space-y-1.5">
                  <div className="text-[12px] font-medium text-foreground">Description</div>
                  <div className="text-[11px] leading-5 text-description">
                    {selectedJob.description?.trim() || "No description was provided for this job."}
                  </div>
                </WorkbenchSurface>
              </div>
          </WorkbenchSection>
        </TabsContent>

        <TabsContent value="tasks" className="flex min-h-0 flex-1 flex-col gap-2 pt-1.5">
          <WorkbenchSection
            title="Tasks"
            subtitle="Search by file name, select a task, and download matched JSON or SRT output directly."
          >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <WorkbenchCompactActionCluster>
                  <WorkbenchSecondaryActionButton
                    type="button"
                    variant="secondary"
                    disabled={!selectedTaskJsonResult || Boolean(downloadingResultObjectName)}
                    onClick={() => {
                      if (selectedTaskJsonResult) {
                        onDownloadResult(selectedTaskJsonResult.name)
                      }
                    }}
                  >
                    <ArrowDownToLine size={12} />
                    Download JSON
                  </WorkbenchSecondaryActionButton>
                  <WorkbenchSecondaryActionButton
                    type="button"
                    variant="secondary"
                    disabled={!selectedTaskSrtResult || Boolean(downloadingResultObjectName)}
                    onClick={() => {
                      if (selectedTaskSrtResult) {
                        onDownloadResult(selectedTaskSrtResult.name)
                      }
                    }}
                  >
                    <ArrowDownToLine size={12} />
                    Download SRT
                  </WorkbenchSecondaryActionButton>
                  {renderSpeechJobLifecycleActions({
                    job: selectedJob,
                    onCancelJob,
                    onDeleteJob,
                    cancellingJobId,
                    deletingJobId,
                    jobMutationBusy,
                  })}
                </WorkbenchCompactActionCluster>

                <div className="w-full sm:max-w-[280px]">
                  <FeatureSearchInput
                    value={taskQuery}
                    onChange={onTaskQueryChange}
                    placeholder="Search tasks by name..."
                  />
                </div>
              </div>

              <div className="grid gap-2 xl:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
                <div>
                  {loadingTasks ? (
                    <WorkbenchLoadingState label="Loading transcription tasks..." />
                  ) : tasks.length === 0 ? (
                    <WorkbenchEmptyState
                      icon={<ListChecks size={18} />}
                      title="No Tasks Returned"
                      description="The Speech service has not reported task details for this job yet."
                    />
                  ) : filteredTasks.length === 0 ? (
                    <WorkbenchEmptyState
                      icon={<ListChecks size={18} />}
                      title="No Tasks Match This Filter"
                      description="Clear the task search or use a broader file name to find task activity."
                    />
                  ) : (
                    <div className="overflow-hidden rounded-[2px] border border-[var(--vscode-panel-border)]">
                      <div className="max-h-[360px] overflow-auto">
                        <table className="min-w-full border-collapse text-[11px]">
                          <thead className="sticky top-0 bg-[var(--vscode-list-hoverBackground)]">
                            <tr>
                              <th className="w-10 border-b border-[var(--vscode-panel-border)] px-2 py-1.5 text-left font-semibold"> </th>
                              <th className="border-b border-[var(--vscode-panel-border)] px-2 py-1.5 text-left font-semibold">Name</th>
                              <th className="border-b border-[var(--vscode-panel-border)] px-2 py-1.5 text-left font-semibold">Status</th>
                              <th className="border-b border-[var(--vscode-panel-border)] px-2 py-1.5 text-left font-semibold">File Duration</th>
                              <th className="border-b border-[var(--vscode-panel-border)] px-2 py-1.5 text-left font-semibold">File Size</th>
                              <th className="border-b border-[var(--vscode-panel-border)] px-2 py-1.5 text-left font-semibold">Task Start Date</th>
                              <th className="border-b border-[var(--vscode-panel-border)] px-2 py-1.5 text-left font-semibold">Processing Time</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredTasks.map((task, index) => {
                              const selected = task.id === selectedTaskId
                              const taskMatch = taskResultMatches.get(task.id)
                              const matchedJson = taskMatch?.json ?? null
                              const matchedSrt = taskMatch?.srt ?? null
                              return (
                                <tr
                                  key={task.id}
                                  onClick={() => onSelectTask(task.id)}
                                  className={clsx(
                                    "cursor-pointer border-b border-[var(--vscode-panel-border)]/50 align-top",
                                    selected
                                      ? "bg-[var(--vscode-list-activeSelectionBackground)] text-[var(--vscode-list-activeSelectionForeground)]"
                                      : index % 2 === 0
                                        ? "bg-[color-mix(in_srgb,var(--vscode-editor-background)_98%,white_2%)] hover:bg-[var(--vscode-list-hoverBackground)]"
                                        : "hover:bg-[var(--vscode-list-hoverBackground)]",
                                  )}
                                >
                                  <td className="px-2 py-2">
                                    <span
                                      className={clsx(
                                        "flex h-4 w-4 items-center justify-center rounded-[2px] border border-[var(--vscode-panel-border)]",
                                        selected
                                          ? "border-[var(--vscode-button-background)] bg-[var(--vscode-button-background)] text-[var(--vscode-button-foreground)]"
                                          : "bg-[var(--vscode-editor-background)] text-transparent",
                                      )}
                                    >
                                      <Check size={11} />
                                    </span>
                                  </td>
                                  <td className="px-2 py-2">
                                    <div className="font-medium">{getLeafName(task.name)}</div>
                                    <div className={clsx("text-[10px]", selected ? "text-[var(--vscode-list-activeSelectionForeground)]/80" : "text-description")}>
                                      {matchedJson ? "JSON" : "-"} / {matchedSrt ? "SRT" : "-"}
                                    </div>
                                  </td>
                                  <td className="px-2 py-2">
                                    <LifecycleBadge state={task.lifecycleState} size="compact" />
                                  </td>
                                  <td className="px-2 py-2">{formatDuration(task.fileDurationInSeconds)}</td>
                                  <td className="px-2 py-2">{formatBytes(task.fileSizeInBytes)}</td>
                                  <td className="px-2 py-2">{formatDateTime(task.timeStarted)}</td>
                                  <td className="px-2 py-2">{formatDuration(task.processingDurationInSeconds)}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="flex items-center justify-between gap-2 border-t border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface-subtle)] px-2 py-1.5 text-[11px] text-description">
                        <span>{selectedTask ? "1 selected" : "0 selected"}</span>
                        <span>Showing {filteredTasks.length} of {tasks.length}</span>
                      </div>
                    </div>
                  )}
                </div>

                <WorkbenchSurface className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[12px] font-medium text-foreground">Selected Task</div>
                    {selectedTask && <LifecycleBadge state={selectedTask.lifecycleState} size="compact" />}
                  </div>

                  {!selectedTask ? (
                    <WorkbenchEmptyState
                      icon={<ListChecks size={18} />}
                      title="No Task Selected"
                      description="Select a task to inspect its timing and output availability."
                    />
                  ) : (
                    <>
                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-1">
                        <SummaryMetaCard label="Progress" value={formatPercent(selectedTask.percentComplete, selectedTask.lifecycleState)} />
                        <SummaryMetaCard label="File Duration" value={formatDuration(selectedTask.fileDurationInSeconds)} />
                        <SummaryMetaCard label="File Size" value={formatBytes(selectedTask.fileSizeInBytes)} />
                        <SummaryMetaCard label="Processing Time" value={formatDuration(selectedTask.processingDurationInSeconds)} />
                      </div>

                      <WorkbenchKeyValueStrip
                        items={[
                          { label: "Task Name", value: selectedTask.name || "-" },
                          { label: "Task OCID", value: selectedTask.id || "-", breakAll: true },
                          { label: "Started", value: formatDateTime(selectedTask.timeStarted) },
                          { label: "Finished", value: formatDateTime(selectedTask.timeFinished) },
                        ]}
                      />

                      {selectedTask.lifecycleDetails && (
                        <InlineNotice tone={toneFromLifecycleState(selectedTask.lifecycleState) === "danger" ? "danger" : "info"} icon={<AlertCircle size={14} />} title="Task Lifecycle Details">
                          {selectedTask.lifecycleDetails}
                        </InlineNotice>
                      )}
                    </>
                  )}
                </WorkbenchSurface>
              </div>

              {selectedTask && !selectedTaskJsonResult && !selectedTaskSrtResult && (
                <InlineNotice tone="info" icon={<FileText size={14} />} title="No Direct JSON/SRT Match">
                  The selected task does not have a confidently matched JSON or SRT file yet. Refresh the job after more output files appear, or review the latest outputs in Results.
                </InlineNotice>
              )}
          </WorkbenchSection>
        </TabsContent>

          <TabsContent value="results" className="flex min-h-0 flex-1 flex-col gap-2 pt-1.5">
            {renderSpeechResultsSection({
              selectedJob,
              selectedTask,
              displayedResultObjects,
              displayedJsonResult,
              displayedSrtResult,
              activeResultObject,
              resultPreviewTab,
              resultPreview,
              loadingResultObjects,
              loadingResultPreview,
              resultObjectsError,
              resultPreviewError,
              downloadingResultObjectName,
              onResultPreviewTabChange,
              onDownloadResult,
            })}
          </TabsContent>

        <TabsContent value="configuration" className="flex min-h-0 flex-1 flex-col gap-2 pt-1.5">
          <WorkbenchSection
            title="Input and Output"
            subtitle="Speech jobs read from Object Storage and write results back to Object Storage in the same fixed region."
            actions={(
              <WorkbenchSecondaryActionButton type="button" variant="secondary" onClick={() => navigateToView("objectStorage")}>
                {openViewLabel("Object Storage")}
              </WorkbenchSecondaryActionButton>
            )}
          >
              <WorkbenchKeyValueStrip
                items={[
                  { label: "Input Bucket", value: selectedJob.inputBucketName || "-" },
                  { label: "Input Namespace", value: selectedJob.inputNamespaceName || "-" },
                  { label: "Output Bucket", value: selectedJob.outputBucketName || "-" },
                  { label: "Output Namespace", value: selectedJob.outputNamespaceName || "-" },
                  { label: "Output Prefix", value: selectedJob.outputPrefix || "/" },
                ]}
              />

              <WorkbenchSurface className="space-y-1.5">
                <div className="text-[12px] font-medium text-foreground">Selected Input Files</div>
                {selectedJob.inputObjectNames && selectedJob.inputObjectNames.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedJob.inputObjectNames.map((objectName) => (
                      <span key={objectName} className="rounded-full border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface-subtle)] px-2 py-0.5 text-[10px] text-description">
                        {getLeafName(objectName)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-description">Input file details were not returned for this job yet.</div>
                )}
              </WorkbenchSurface>
          </WorkbenchSection>

          <WorkbenchSection title="Transcription Profile" subtitle="These values reflect the effective Speech configuration returned by the service.">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                <SummaryMetaCard label="Model" value={getModelLabel(selectedJob.modelType)} />
                <SummaryMetaCard label="Language" value={getLanguageLabel(selectedJob.languageCode)} />
                <SummaryMetaCard label="SRT" value={selectedJob.additionalTranscriptionFormats?.includes("SRT") ? "Enabled" : "Disabled"} />
                <SummaryMetaCard label="Punctuation" value={selectedJob.isPunctuationEnabled === false ? "Disabled" : "Enabled"} />
                <SummaryMetaCard label="Diarization" value={selectedJob.isDiarizationEnabled ? "Enabled" : "Disabled"} />
                <SummaryMetaCard label="Profanity Filter" value={selectedJob.profanityFilterMode || "Disabled"} />
              </div>

              <WorkbenchSurface className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Sparkles size={13} className="text-description" />
                  <div className="text-[12px] font-medium text-foreground">Whisper Prompt</div>
                </div>
                <div className="text-[11px] leading-5 text-description">
                  {selectedJob.whisperPrompt || "No whisper prompt was provided for this job."}
                </div>
              </WorkbenchSurface>
          </WorkbenchSection>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function renderSpeechResultsSection({
  selectedJob,
  selectedTask,
  displayedResultObjects,
  displayedJsonResult,
  displayedSrtResult,
  activeResultObject,
  resultPreviewTab,
  resultPreview,
  loadingResultObjects,
  loadingResultPreview,
  resultObjectsError,
  resultPreviewError,
  downloadingResultObjectName,
  onResultPreviewTabChange,
  onDownloadResult,
}: {
  selectedJob: SpeechTranscriptionJobResource
  selectedTask: SpeechTranscriptionTaskResource | null
  displayedResultObjects: ObjectStorageObjectResource[]
  displayedJsonResult: ObjectStorageObjectResource | null
  displayedSrtResult: ObjectStorageObjectResource | null
  activeResultObject: ObjectStorageObjectResource | null
  resultPreviewTab: SpeechResultTab
  resultPreview: SpeechResultPreviewState
  loadingResultObjects: boolean
  loadingResultPreview: boolean
  resultObjectsError: string | null
  resultPreviewError: string | null
  downloadingResultObjectName: string | null
  onResultPreviewTabChange: (value: SpeechResultTab) => void
  onDownloadResult: (objectName: string) => void
}) {
  const scopeLabel = selectedTask ? getLeafName(selectedTask.name) : "Latest job output"
  const availableFormats = [displayedJsonResult ? "JSON" : null, displayedSrtResult ? "SRT" : null].filter(Boolean).join(" / ") || "None"
  const previewDescription = selectedTask
    ? "Inline preview for the JSON and SRT artifacts matched to the selected task."
    : "Inline preview for the latest JSON and SRT artifacts written by this job."

  return (
    <WorkbenchSection title="Results" subtitle={previewDescription}>
      {resultObjectsError && (
        <InlineNotice tone="danger" icon={<AlertCircle size={14} />} title="Speech Result Error">
          {resultObjectsError}
        </InlineNotice>
      )}

      {!selectedJob.outputBucketName || !selectedJob.outputNamespaceName ? (
        <WorkbenchEmptyState
          icon={<FileText size={18} />}
          title="No Output Location Returned"
          description="This Speech job does not expose a readable output bucket or namespace yet."
        />
      ) : loadingResultObjects ? (
        <WorkbenchLoadingState label="Loading Speech result files..." />
      ) : displayedResultObjects.length === 0 ? (
        <WorkbenchEmptyState
          icon={<FileText size={18} />}
          title={selectedTask ? "No Result Files Matched This Task" : "No Result Files Found Yet"}
          description={selectedTask
            ? "The selected task does not currently map to result files under the job output prefix."
            : hasFinishedSpeechJob(selectedJob)
              ? "No output objects were found under the configured Speech output prefix. Refresh the job or confirm the output prefix."
              : "OCI Speech has not written output files under the configured prefix yet. Refresh the job after processing advances."}
        />
      ) : !displayedJsonResult && !displayedSrtResult ? (
        <WorkbenchEmptyState
          icon={<FileText size={18} />}
          title="No JSON or SRT Preview Available"
          description={selectedTask
            ? "The selected task has output files, but no matched JSON or SRT artifact is available for inline preview yet."
            : "This job returned output files, but no JSON or SRT artifact is available for inline preview yet."}
        />
      ) : (
        <>
          <WorkbenchSurface className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium text-foreground">{scopeLabel}</div>
              <div className="text-[11px] text-description">
                {displayedResultObjects.length} matched file{displayedResultObjects.length === 1 ? "" : "s"} • {availableFormats} ready
              </div>
            </div>
            <WorkbenchCompactActionCluster>
              <WorkbenchSecondaryActionButton
                type="button"
                variant="secondary"
                disabled={!displayedJsonResult || Boolean(downloadingResultObjectName)}
                onClick={() => {
                  if (displayedJsonResult) {
                    onDownloadResult(displayedJsonResult.name)
                  }
                }}
              >
                <ArrowDownToLine size={12} />
                Download JSON
              </WorkbenchSecondaryActionButton>
              <WorkbenchSecondaryActionButton
                type="button"
                variant="secondary"
                disabled={!displayedSrtResult || Boolean(downloadingResultObjectName)}
                onClick={() => {
                  if (displayedSrtResult) {
                    onDownloadResult(displayedSrtResult.name)
                  }
                }}
              >
                <ArrowDownToLine size={12} />
                Download SRT
              </WorkbenchSecondaryActionButton>
            </WorkbenchCompactActionCluster>
          </WorkbenchSurface>

          <Tabs value={resultPreviewTab} onValueChange={(value) => onResultPreviewTabChange(value as SpeechResultTab)} className="min-h-0 flex-1">
            <TabsList>
              <TabsTrigger value="json">JSON Preview</TabsTrigger>
              <TabsTrigger value="srt">SRT Preview</TabsTrigger>
            </TabsList>

            <TabsContent value="json" className="flex min-h-0 flex-1 flex-col gap-2 pt-1.5">
              {renderSpeechResultPreviewPane({
                formatLabel: "JSON",
                object: displayedJsonResult,
                activeResultObject,
                resultPreview,
                loadingResultPreview,
                resultPreviewError,
              })}
            </TabsContent>

            <TabsContent value="srt" className="flex min-h-0 flex-1 flex-col gap-2 pt-1.5">
              {renderSpeechResultPreviewPane({
                formatLabel: "SRT",
                object: displayedSrtResult,
                activeResultObject,
                resultPreview,
                loadingResultPreview,
                resultPreviewError,
              })}
            </TabsContent>
          </Tabs>
        </>
      )}
    </WorkbenchSection>
  )
}

function renderSpeechResultPreviewPane({
  formatLabel,
  object,
  activeResultObject,
  resultPreview,
  loadingResultPreview,
  resultPreviewError,
}: {
  formatLabel: "JSON" | "SRT"
  object: ObjectStorageObjectResource | null
  activeResultObject: ObjectStorageObjectResource | null
  resultPreview: SpeechResultPreviewState
  loadingResultPreview: boolean
  resultPreviewError: string | null
}) {
  if (!object) {
    return (
      <WorkbenchEmptyState
        icon={<FileText size={18} />}
        title={`No ${formatLabel} File`}
        description={`A ${formatLabel} result is not available for the current scope yet.`}
      />
    )
  }

  const isActivePreview = activeResultObject?.name === object.name

  return (
    <WorkbenchSurface className="min-h-[360px] min-w-0 space-y-2">
      <div className="flex flex-wrap gap-2 text-[11px] text-description">
        <span>{formatBytes(object.size)}</span>
        <span>{formatDateTime(object.timeModified || object.timeCreated)}</span>
        <StatusBadge label={formatLabel} tone="neutral" size="compact" />
      </div>

      {resultPreviewError && isActivePreview && (
        <InlineNotice tone="danger" icon={<AlertCircle size={14} />} title="Preview Error">
          {resultPreviewError}
        </InlineNotice>
      )}

      {resultPreview?.truncated && resultPreview.objectName === object.name && (
        <InlineNotice tone="info" icon={<FileText size={14} />} title="Preview Truncated">
          Showing the first {formatBytes(MAX_RESULT_PREVIEW_BYTES)} of this result file. Download the artifact for the full content.
        </InlineNotice>
      )}

      {loadingResultPreview && isActivePreview ? (
        <WorkbenchLoadingState label={`Loading ${formatLabel} preview...`} className="min-h-[260px]" />
      ) : !resultPreviewError || !isActivePreview ? (
        <div className="min-h-[260px] overflow-auto rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] p-2">
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[var(--vscode-foreground)]">
            {resultPreview?.objectName === object.name && resultPreview.text
              ? resultPreview.text
              : "This result file is empty."}
          </pre>
        </div>
      ) : null}
    </WorkbenchSurface>
  )
}

function canPreviewSpeechResultObject(objectName: string) {
  const extension = getFileExtension(objectName)
  return SPEECH_RESULT_TEXT_FORMATS.includes(extension as typeof SPEECH_RESULT_TEXT_FORMATS[number])
}

function getSpeechResultObjectsForTask(
  objects: ObjectStorageObjectResource[],
  task: SpeechTranscriptionTaskResource | null,
) {
  if (!task) {
    return objects
  }

  const outputObjectNames = task.outputObjectNames?.map((value) => String(value ?? "").trim()).filter((value) => value.length > 0) ?? []
  if (outputObjectNames.length === 0) {
    return []
  }

  const objectDetailsByName = new Map(objects.map((item) => [item.name, item]))
  return outputObjectNames
    .map((objectName) => objectDetailsByName.get(objectName) ?? null)
    .filter((item): item is ObjectStorageObjectResource => Boolean(item))
}

function getPreferredSpeechResultObject(
  objects: ObjectStorageObjectResource[],
  extension?: string,
) {
  const normalizedExtension = extension?.toLowerCase()
  const filteredObjects = normalizedExtension
    ? objects.filter((item) => getFileExtension(item.name) === normalizedExtension)
    : objects

  return filteredObjects[0] ?? null
}

function buildSpeechTaskResultMatches(
  tasks: SpeechTranscriptionTaskResource[],
  objects: ObjectStorageObjectResource[],
) {
  const matches = new Map<string, SpeechTaskResultMatch>()

  for (const task of tasks) {
    const matchedObjects = getSpeechResultObjectsForTask(objects, task)
    const json = matchedObjects.find((item) => getFileExtension(item.name) === "json") ?? null
    const srt = matchedObjects.find((item) => getFileExtension(item.name) === "srt") ?? null
    matches.set(task.id, {
      objects: matchedObjects,
      json,
      srt,
    })
  }

  return matches
}

function getLikelySpeechResultObjects(
  objects: ObjectStorageObjectResource[],
  job: SpeechTranscriptionJobResource | null,
) {
  if (objects.length === 0) {
    return []
  }

  const sortedObjects = [...objects].sort((left, right) => {
    const timeCompare = getObjectTimestamp(right) - getObjectTimestamp(left)
    if (timeCompare !== 0) {
      return timeCompare
    }
    return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
  })

  const resultObjects = sortedObjects.filter((item) => canPreviewSpeechResultObject(item.name))
  const recentResultObjects = filterSpeechResultObjectsByTime(resultObjects, job)
  if (recentResultObjects.length > 0) {
    return recentResultObjects
  }
  if (resultObjects.length > 0) {
    return resultObjects
  }

  const recentObjects = filterSpeechResultObjectsByTime(sortedObjects, job)
  return recentObjects.length > 0 ? recentObjects : sortedObjects
}

function filterSpeechResultObjectsByTime(
  objects: ObjectStorageObjectResource[],
  job: SpeechTranscriptionJobResource | null,
) {
  const acceptedAt = job?.timeAccepted ? new Date(job.timeAccepted).getTime() : Number.NaN
  if (!Number.isFinite(acceptedAt)) {
    return []
  }
  return objects.filter((item) => getObjectTimestamp(item) >= acceptedAt - SPEECH_RESULT_RECENCY_BUFFER_MS)
}

function getObjectTimestamp(object: ObjectStorageObjectResource) {
  const modifiedAt = Date.parse(object.timeModified || object.timeCreated || "")
  return Number.isFinite(modifiedAt) ? modifiedAt : 0
}

function groupJobsByCompartment(
  jobs: SpeechTranscriptionJobResource[],
  compartmentNameById: Map<string, string>,
) {
  const groups = new Map<string, { compartmentId: string; compartmentName: string; jobs: SpeechTranscriptionJobResource[] }>()

  for (const job of jobs) {
    const compartmentId = job.compartmentId || "unknown"
    const existing = groups.get(compartmentId)
    if (existing) {
      existing.jobs.push(job)
      continue
    }
    groups.set(compartmentId, {
      compartmentId,
      compartmentName: compartmentNameById.get(compartmentId) || compartmentId,
      jobs: [job],
    })
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      jobs: group.jobs.sort((left, right) => (right.timeAccepted || "").localeCompare(left.timeAccepted || "")),
    }))
    .sort((left, right) => left.compartmentName.localeCompare(right.compartmentName, undefined, { numeric: true, sensitivity: "base" }))
}

function syncDraftBuckets(draft: SpeechJobDraft, buckets: ObjectStorageBucketResource[]): SpeechJobDraft {
  const firstBucketKey = buckets[0] ? getBucketKey(buckets[0]) : ""
  const bucketKeys = new Set(buckets.map((bucket) => getBucketKey(bucket)))
  const nextInputBucketKey = bucketKeys.has(draft.inputBucketKey) ? draft.inputBucketKey : firstBucketKey
  const inputBucketChanged = nextInputBucketKey !== draft.inputBucketKey
  const nextOutputBucketKey = bucketKeys.has(draft.outputBucketKey)
    ? draft.outputBucketKey
    : nextInputBucketKey
  return {
    ...draft,
    inputBucketKey: nextInputBucketKey,
    inputPrefix: inputBucketChanged ? "" : draft.inputPrefix,
    selectedObjectNames: inputBucketChanged ? [] : draft.selectedObjectNames,
    outputBucketKey: nextOutputBucketKey,
  }
}

function getBucketKey(bucket: ObjectStorageBucketResource) {
  return `${bucket.region}::${bucket.compartmentId}::${bucket.namespaceName}::${bucket.name}`
}

function normalizePrefix(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ""
  }
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`
}

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

function getParentPrefix(prefix: string) {
  const normalized = trimTrailingSlash(prefix)
  const segments = normalized.split("/").filter(Boolean)
  if (segments.length <= 1) {
    return ""
  }
  return `${segments.slice(0, -1).join("/")}/`
}

function getLeafName(value: string) {
  const normalized = trimTrailingSlash(value)
  const parts = normalized.split("/").filter(Boolean)
  return parts[parts.length - 1] || value
}

function getFileExtension(value: string) {
  const leafName = getLeafName(value)
  const lastDotIndex = leafName.lastIndexOf(".")
  if (lastDotIndex <= 0 || lastDotIndex === leafName.length - 1) {
    return ""
  }
  return leafName.slice(lastDotIndex + 1).toLowerCase()
}

function buildSuggestedJobName(objectNames: string[]) {
  const seed = sanitizeSpeechDisplayName(
    getLeafName(objectNames[0] || "").replace(/\.[^.]+$/, ""),
    MAX_SPEECH_DISPLAY_NAME_SEED_LENGTH,
  )
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "").replace(/[-:T]/g, "")
  return `speech-${seed || "job"}-${timestamp}`
}

function getSpeechDisplayNameValidationError(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  if (!SPEECH_DISPLAY_NAME_PATTERN.test(trimmed)) {
    return "Display name must contain only letters, numbers, dashes, or underscores."
  }
  return null
}

function sanitizeSpeechDisplayName(value: string, maxLength?: number) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/_{2,}/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "")
  if (typeof maxLength !== "number" || maxLength <= 0) {
    return normalized
  }
  return normalized.slice(0, maxLength).replace(/^[-_]+|[-_]+$/g, "")
}

function getSpeechInputFileCount(job: SpeechTranscriptionJobResource) {
  const inputCount = Array.isArray(job.inputObjectNames) ? job.inputObjectNames.length : 0
  if (inputCount > 0) {
    return inputCount
  }
  return job.totalTasks ?? 0
}

function normalizeSpeechLifecycleState(lifecycleState: string | undefined) {
  return String(lifecycleState ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_")
}

function canCancelSpeechJob(job: SpeechTranscriptionJobResource | null) {
  const lifecycleState = normalizeSpeechLifecycleState(job?.lifecycleState)
  return CANCELLABLE_JOB_STATES.has(lifecycleState)
}

function canDeleteSpeechJob(job: SpeechTranscriptionJobResource | null) {
  const lifecycleState = normalizeSpeechLifecycleState(job?.lifecycleState)
  return DELETABLE_JOB_STATES.has(lifecycleState)
}

function hasFinishedSpeechJob(job: SpeechTranscriptionJobResource | null) {
  const lifecycleState = normalizeSpeechLifecycleState(job?.lifecycleState)
  return lifecycleState === "SUCCEEDED" || lifecycleState === "FAILED" || DELETABLE_JOB_STATES.has(lifecycleState)
}

function getModelLabel(modelType: string | undefined) {
  if (modelType === "WHISPER_MEDIUM") {
    return "Whisper Medium"
  }
  if (modelType === "WHISPER_LARGE_V3T" || modelType === "WHISPER_LARGE_V3_TURBO") {
    return "Whisper Large v3T"
  }
  return modelType || "Unknown"
}

function getLanguageLabel(languageCode: string | undefined) {
  if (languageCode === "ja") {
    return "Japanese"
  }
  if (languageCode === "en") {
    return "English"
  }
  if (languageCode === "zh") {
    return "Chinese"
  }
  return languageCode || "Unknown"
}

function formatCount(value: number | undefined) {
  return typeof value === "number" ? value.toLocaleString() : "-"
}

function formatPercent(value: number | undefined, lifecycleState?: string) {
  const normalizedState = normalizeSpeechLifecycleState(lifecycleState)
  if (typeof value === "number" && Number.isFinite(value)) {
    const bounded = Math.max(0, Math.min(100, value))
    if (bounded === 0 && normalizedState === "SUCCEEDED") {
      return "100%"
    }
    return `${bounded}%`
  }
  if (normalizedState === "SUCCEEDED") {
    return "100%"
  }
  return "Pending"
}

function formatTaskProgress(successfulTasks: number | undefined, totalTasks: number | undefined) {
  if (typeof totalTasks !== "number" || totalTasks <= 0) {
    return "No tasks"
  }
  return `${successfulTasks ?? 0} / ${totalTasks} done`
}

function formatDateTime(value: string | undefined) {
  if (!value) {
    return "-"
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function formatDuration(seconds: number | undefined) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) {
    return "-"
  }
  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  }
  if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`
  }
  return `${(seconds / 3600).toFixed(1)}h`
}

function formatBytes(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "-"
  }
  if (value < 1024) {
    return `${value} B`
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
