import { clsx } from "clsx"
import {
  AlertCircle,
  ArrowDownToLine,
  AudioLines,
  Check,
  CheckCircle2,
  CircleSlash,
  Eye,
  FileAudio,
  FileText,
  ListChecks,
  Loader2,
  Sparkles,
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
  WorkbenchDismissButton,
  WorkbenchRevealButton,
  WorkbenchSecondaryActionButton,
  WorkbenchSelectButton,
  WorkbenchSubmitButton,
} from "../workbench/WorkbenchActionButtons"
import { WorkbenchSegmentedControl, WorkbenchMicroOptionButton } from "../workbench/WorkbenchCompactControls"
import type { WorkbenchGuardrailState } from "../workbench/guardrail"
import { buildWorkbenchGuardrailDetails, buildWorkbenchResourceGuardrailDetails, createWorkbenchGuardrail } from "../workbench/guardrail"
import {
  WorkbenchInventoryFilterEmpty,
  WorkbenchInventoryGroupHeading,
  WorkbenchInventoryRegionHeading,
  WorkbenchInventorySummary,
} from "../workbench/WorkbenchInventoryScaffold"
import { backToLabel, openViewLabel, openWorkspaceLabel, showInListLabel } from "../workbench/navigationLabels"
import { WorkbenchRefreshButton } from "../workbench/WorkbenchToolbar"

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
  const [downloadingResultObjectName, setDownloadingResultObjectName] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [taskQuery, setTaskQuery] = useState("")
  const [objectQuery, setObjectQuery] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [resultObjectsError, setResultObjectsError] = useState<string | null>(null)
  const [resultPreviewError, setResultPreviewError] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState("")
  const [selectedResultObjectName, setSelectedResultObjectName] = useState("")
  const [resultPreview, setResultPreview] = useState<SpeechResultPreviewState>(null)
  const [guardrail, setGuardrail] = useState<WorkbenchGuardrailState>(null)
  const [recentAction, setRecentAction] = useState<RecentActionState>(null)
  const [highlightedJobId, setHighlightedJobId] = useState<string | null>(null)
  const [showResultViewerWorkspace, setShowResultViewerWorkspace] = useState(false)

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

  const selectedTaskResultObjects = useMemo(
    () => getSpeechResultObjectsForTask(resultObjects, selectedTask),
    [resultObjects, selectedTask],
  )

  const selectedTaskJsonResult = useMemo(
    () => getPreferredSpeechTaskResultObject(selectedTask, resultObjects, "json"),
    [resultObjects, selectedTask],
  )

  const selectedTaskSrtResult = useMemo(
    () => getPreferredSpeechTaskResultObject(selectedTask, resultObjects, "srt"),
    [resultObjects, selectedTask],
  )

  const selectedResultObject = useMemo(
    () => visibleResultObjects.find((item) => item.name === selectedResultObjectName) ?? null,
    [selectedResultObjectName, visibleResultObjects],
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

  const isSyncing = creating
    || (isWorkspaceView && (loadingBuckets || loadingObjects))
    || (isInventoryView && (loadingJobs || loadingBuckets))
    || (isJobView && (loadingJobs || loadingJobDetail || loadingTasks || loadingResultObjects || (showResultViewerWorkspace && loadingResultPreview)))

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
      jobs.some((job) => TRANSITIONAL_JOB_STATES.has(job.lifecycleState.toUpperCase()))
      || visibleTasks.some((task) => TRANSITIONAL_TASK_STATES.has(task.lifecycleState.toUpperCase())),
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
    setSelectedResultObjectName("")
    setResultPreview(null)
    setResultPreviewError(null)
    setShowResultViewerWorkspace(false)
  }, [cancelSelectedJobRequests])

  const openJobDetails = useCallback((jobId: string) => {
    selectJob(jobId)
    navigateToView("speechJob")
  }, [navigateToView, selectJob])

  const openResultViewerWorkspace = useCallback((objectName?: string) => {
    const normalizedObjectName = objectName?.trim() || ""
    if (normalizedObjectName) {
      setSelectedResultObjectName(normalizedObjectName)
    }
    setShowResultViewerWorkspace(true)
  }, [])

  const closeResultViewerWorkspace = useCallback(() => {
    setShowResultViewerWorkspace(false)
  }, [])

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
      setSelectedResultObjectName("")
      setResultPreview(null)
      setResultPreviewError(null)
      setHighlightedJobId(null)
      setShowResultViewerWorkspace(false)
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
      setSelectedResultObjectName("")
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
      setSelectedResultObjectName((currentSelectedName) => {
        if (currentSelectedName && nextObjects.some((item) => item.name === currentSelectedName)) {
          return currentSelectedName
        }
        return getDefaultResultObjectName(nextObjects, job)
      })
    } catch (loadError) {
      if (resultLoadRequestIdRef.current !== requestId) {
        return
      }
      setResultObjects([])
      setSelectedResultObjectName("")
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
      setShowResultViewerWorkspace(false)
    }
  }, [isJobView])

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
    setSelectedResultObjectName((currentSelectedName) => {
      const candidateObjects = selectedTask ? selectedTaskResultObjects : visibleResultObjects
      if (currentSelectedName && candidateObjects.some((item) => item.name === currentSelectedName)) {
        return currentSelectedName
      }
      return selectedTaskJsonResult?.name
        ?? selectedTaskSrtResult?.name
        ?? candidateObjects[0]?.name
        ?? ""
    })
  }, [selectedTask, selectedTaskJsonResult, selectedTaskResultObjects, selectedTaskSrtResult, visibleResultObjects])

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
      setSelectedResultObjectName("")
      setResultPreview(null)
      setResultPreviewError(null)
      setShowResultViewerWorkspace(false)
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
    if (!isJobView || !showResultViewerWorkspace || !selectedJob || !selectedResultObject) {
      setLoadingResultPreview(false)
      setResultPreview(null)
      setResultPreviewError(null)
      return
    }

    if (!canPreviewSpeechResultObject(selectedResultObject.name)) {
      setLoadingResultPreview(false)
      setResultPreview(null)
      setResultPreviewError(null)
      return
    }

    const namespaceName = selectedJob.outputNamespaceName?.trim() || ""
    const bucketName = selectedJob.outputBucketName?.trim() || ""
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
      objectName: selectedResultObject.name,
      region: selectedJob.region || SPEECH_REGION,
      maxBytes: MAX_RESULT_PREVIEW_BYTES,
    })
      .then((response) => {
        if (resultPreviewLoadRequestIdRef.current !== requestId) {
          return
        }
        setResultPreview({
          objectName: selectedResultObject.name,
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
    isJobView,
    showResultViewerWorkspace,
    selectedJob,
    selectedResultObject,
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
            label: "Refresh Workspace",
            run: () => {
              refreshCurrentView()
            },
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
    const selectedResultObjectLabel = selectedResultObject ? getLeafName(selectedResultObject.name) : ""
    const canOpenResultViewer = selectedResultObject ? canPreviewSpeechResultObject(selectedResultObject.name) : false
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
        ...(showResultViewerWorkspace && selectedResultObjectLabel ? [`Viewing result: ${selectedResultObjectLabel}`] : []),
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
        ...(canOpenResultViewer
          ? [{
            label: showResultViewerWorkspace ? backToLabel("Speech Job") : openViewLabel("Result Viewer"),
            run: () => {
              if (showResultViewerWorkspace) {
                closeResultViewerWorkspace()
                return
              }
              openResultViewerWorkspace(selectedResultObject?.name)
            },
            variant: "secondary" as const,
          }]
          : []),
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
    openResultViewerWorkspace,
    closeResultViewerWorkspace,
    query,
    refreshCurrentView,
    refreshSelectedJob,
    revealJob,
    selectedResultObject,
    selectedInputBucket?.name,
    selectedJob,
    selectedOutputBucket?.name,
    setResource,
    showResultViewerWorkspace,
  ])

  const updateDraft = useCallback((patch: Partial<SpeechJobDraft>) => {
    setDraft((currentDraft) => ({ ...currentDraft, ...patch }))
  }, [])

  const handleInputBucketChange = useCallback((bucketKey: string) => {
    cancelInputObjectRequests()
    setInputPrefixes([])
    setInputObjects([])
    setSelectedInputObjectDetails({})
    setDraft((currentDraft) => ({
      ...currentDraft,
      inputBucketKey: bucketKey,
      inputPrefix: "",
      selectedObjectNames: [],
      outputBucketKey:
        currentDraft.outputMode === "same"
          ? bucketKey
          : currentDraft.outputBucketKey === currentDraft.inputBucketKey
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
        : currentDraft.inputBucketKey,
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
  }, [loadJobDetail, loadJobs, loadTasks])

  const handleDownloadResult = useCallback(async (objectName: string) => {
    const namespaceName = selectedJob?.outputNamespaceName?.trim() || ""
    const bucketName = selectedJob?.outputBucketName?.trim() || ""
    if (!selectedJob || !namespaceName || !bucketName || !objectName.trim()) {
      return
    }

    setDownloadingResultObjectName(objectName)
    setResultPreviewError(null)
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
      setResultPreviewError(downloadError instanceof Error ? downloadError.message : String(downloadError))
    } finally {
      setDownloadingResultObjectName(null)
    }
  }, [selectedJob])

  return (
    <>
      <FeaturePageLayout
        title={isWorkspaceView ? "Speech Workspace" : isJobView ? "Speech Job" : "Speech"}
        description={isWorkspaceView
          ? "Compose OCI Speech transcription jobs in a dedicated workspace using supported media inputs."
          : isJobView
            ? showResultViewerWorkspace
              ? "Inspect a single OCI Speech job and review output files in a dedicated result viewer workspace."
              : "Inspect a single OCI Speech job, monitor task status, and open result files in a dedicated viewer workspace."
            : "Create Whisper-based transcription jobs against OCI Speech in Chicago."}
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
        controls={(
          <div className={isInventoryView ? "grid gap-2 xl:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]" : "grid gap-2"}>
            <CompartmentSelector featureKey="speech" multiple />
            {isInventoryView && (
              <FeatureSearchInput
                value={query}
                onChange={setQuery}
                placeholder="Search Speech jobs by name, OCID, or state..."
              />
            )}
          </div>
        )}
        contentClassName="p-2"
      >
        {isWorkspaceView ? (
          <section className="h-full min-h-0 overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)]">
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
                    onBack: () => navigateToView("speech"),
                    onRefreshBuckets: refreshCurrentView,
                    onRefreshObjects: () => void loadInputObjects(selectedInputBucket, draft.inputPrefix),
                    onCreateJob: handleCreateJob,
                    creating,
                    createDisabled: createActionDisabled,
                    oversizedSelectedObjectName: selectedOversizedInputObject ? getLeafName(selectedOversizedInputObject.name) : null,
                    navigateToView,
                  })
                )}
              </div>
            </div>
          </section>
        ) : isJobView ? (
          <section className="h-full min-h-0 overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)]">
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
                  selectedJobId,
                  tasks: visibleTasks,
                  filteredTasks,
                  selectedTask,
                  selectedTaskId,
                  selectedTaskJsonResult,
                  selectedTaskSrtResult,
                  selectedTaskResultObjects,
                  taskQuery,
                  resultObjects: visibleResultObjects,
                  selectedResultObject,
                  resultPreview,
                  loadingJobDetail,
                  loadingTasks,
                  loadingResultObjects,
                  loadingResultPreview,
                  detailError,
                  resultObjectsError,
                  resultPreviewError,
                  downloadingResultObjectName,
                  showResultViewerWorkspace,
                  onOpenWorkspace: () => navigateToView("speechWorkspace"),
                  onRefreshJob: () => refreshSelectedJob(selectedJobId, selectedJob),
                  onRevealJob: () => {
                    if (selectedJobId) {
                      navigateToView("speech")
                      requestAnimationFrame(() => revealJob(selectedJobId))
                    }
                  },
                  onTaskQueryChange: setTaskQuery,
                  onSelectTask: setSelectedTaskId,
                  onSelectResultObject: setSelectedResultObjectName,
                  onOpenResultViewer: openResultViewerWorkspace,
                  onCloseResultViewer: closeResultViewerWorkspace,
                  onDownloadResult: handleDownloadResult,
                  onCancelJob: requestCancelJob,
                  cancellingJobId,
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
            onOpenJob: openJobDetails,
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
        busy={Boolean(cancellingJobId)}
        onCancel={() => {
          if (!cancellingJobId) {
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
  onOpenJob,
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
  onOpenJob: (jobId: string) => void
}) {
  return (
    <section className="h-full min-h-0 overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-surface)]">
      <div className="h-full overflow-y-auto p-2">
        <div className="flex min-h-full flex-col gap-2">
          <InlineNotice tone="info" icon={<AudioLines size={14} />} title="Speech Region">
            Speech transcription is intentionally pinned to <code>{SPEECH_REGION}</code>. Open a job to inspect its details and latest result files on a dedicated page.
          </InlineNotice>

          <div className="grid gap-2 md:grid-cols-3">
            <WorkbenchInventorySummary
              label="Jobs"
              count={String(jobs.length)}
              description="Speech transcription jobs in the selected compartments."
            />
            <WorkbenchInventorySummary
              label="Buckets"
              count={String(speechBuckets.length)}
              description="Object Storage buckets available in Chicago for Speech inputs and outputs."
            />
            <WorkbenchInventorySummary
              label="Compartments"
              count={String(selectedCompartmentIds.length)}
              description="Compartment scope currently driving the Speech inventory."
            />
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
                ? "No Speech jobs found yet. Open the dedicated workspace to create your first transcription job."
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
                            <span>{formatPercent(job.percentComplete)}</span>
                            <span>{formatTaskProgress(job.successfulTasks, job.totalTasks)}</span>
                            {job.timeAccepted && <span>{formatDateTime(job.timeAccepted)}</span>}
                          </div>
                        )}
                        actions={(
                          <WorkbenchCompactActionCluster>
                            <WorkbenchRevealButton type="button" label={openViewLabel("Speech Job")} onClick={() => onOpenJob(job.id)} />
                          </WorkbenchCompactActionCluster>
                        )}
                        onSelect={() => onOpenJob(job.id)}
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
  onBack,
  onRefreshBuckets,
  onRefreshObjects,
  onCreateJob,
  creating,
  createDisabled,
  oversizedSelectedObjectName,
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
  onBack: () => void
  onRefreshBuckets: () => void
  onRefreshObjects: () => void
  onCreateJob: () => void
  creating: boolean
  createDisabled: boolean
  oversizedSelectedObjectName: string | null
  navigateToView: (view: "objectStorage" | "speech" | "speechWorkspace") => void
}) {
  return (
    <div className="flex min-h-full flex-col gap-2">
      <WorkbenchHero
        eyebrow="Speech Workspace"
        title={draft.displayName.trim() || suggestedDisplayName}
        resourceId={`${SPEECH_REGION_LABEL} • ${draft.selectedObjectNames.length} input files`}
        badge={<StatusBadge label="Draft" tone="neutral" />}
        metaItems={[
          { label: "Input Bucket", value: selectedInputBucket?.name || "Not set" },
          { label: "Output Bucket", value: selectedOutputBucket?.name || "Not set" },
          { label: "Model", value: getModelLabel(draft.modelType) },
          { label: "Language", value: getLanguageLabel(draft.languageCode) },
        ]}
      />

      <InlineNotice
        tone="info"
        icon={<Sparkles size={14} />}
        title="Speech Job Scope"
        actions={(
          <>
            <WorkbenchActionButton type="button" variant="ghost" onClick={onRefreshBuckets}>
              Refresh Workspace
            </WorkbenchActionButton>
            <WorkbenchActionButton type="button" variant="ghost" onClick={() => navigateToView("objectStorage")}>
              {openViewLabel("Object Storage")}
            </WorkbenchActionButton>
          </>
        )}
      >
        The transcription job is always created in <code>{SPEECH_REGION}</code>. The job compartment follows the selected input bucket's compartment.
      </InlineNotice>

      <InlineNotice tone="info" icon={<FileAudio size={14} />} title="Supported Media Types">
        Only OCI Speech-supported objects are listed here. The current workspace shows files ending in {SPEECH_SUPPORTED_FORMATS_TEXT}.
      </InlineNotice>

      <WorkbenchSection
        title="Job Identity"
        subtitle="Keep the job name descriptive enough to find it quickly in the inventory."
        actions={<WorkbenchBackButton type="button" label={backToLabel("Speech")} onClick={onBack} />}
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
              Use only letters, numbers, dashes, or underscores. Leave blank to auto-generate <code>{suggestedDisplayName}</code>.
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
        subtitle={`Choose a Chicago bucket, navigate to a prefix if needed, then select up to ${MAX_SPEECH_OBJECTS_PER_JOB} audio objects to transcribe.`}
        actions={(
          <WorkbenchCompactActionCluster>
            <WorkbenchRefreshButton onClick={onRefreshObjects} disabled={!selectedInputBucket || loadingObjects} spinning={loadingObjects} />
          </WorkbenchCompactActionCluster>
        )}
      >
        <div className="grid gap-2 lg:grid-cols-[minmax(0,0.48fr)_minmax(0,0.52fr)]">
          <WorkbenchSurface className="space-y-2">
            <SpeechSelectField
              label="Input Bucket"
              value={draft.inputBucketKey}
              onChange={onInputBucketChange}
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
                Some previously selected objects are no longer available in the current object list. Refresh the objects and reselect the files before creating a job.
              </InlineNotice>
            )}

            {draft.selectedObjectNames.length > MAX_SPEECH_OBJECTS_PER_JOB && (
              <InlineNotice tone="warning" title="Too Many Input Files">
                OCI Speech accepts up to {MAX_SPEECH_OBJECTS_PER_JOB} files per job. Deselect some files before creating the job.
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
                description="Adjust the prefix, pick another bucket, or upload OCI Speech-supported media files to Object Storage first."
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

      <WorkbenchSection
        title="Output"
        subtitle="JSON output is always produced. Enable SRT below if you also want subtitle output."
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
          <SpeechSelectField
            label={draft.outputMode === "same" ? "Effective Output Bucket" : "Output Bucket"}
            value={draft.outputMode === "same" ? draft.inputBucketKey : draft.outputBucketKey}
            onChange={onSelectOutputBucket}
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
        subtitle="This version intentionally exposes only the requested language and model combinations."
      >
        <div className="grid gap-2 lg:grid-cols-2">
          <SpeechSelectField
            label="Model"
            value={draft.modelType}
            onChange={(value) => updateDraft({ modelType: value as SpeechTranscriptionModelType })}
            options={MODEL_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
              description: option.description,
            }))}
          />

          <SpeechSelectField
            label="Language"
            value={draft.languageCode}
            onChange={(value) => updateDraft({ languageCode: value as SpeechTranscriptionLanguageCode })}
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
            description="Pinned on. Oracle keeps punctuation enabled for the supported Whisper models in this workspace."
            disabled
          />
          <Toggle
            checked={draft.enableDiarization}
            onChange={(checked) => updateDraft({ enableDiarization: checked })}
            label="Enable Diarization"
            description="Ask OCI Speech to add speaker tags when multiple voices are present."
          />
          <Toggle
            checked={draft.enableProfanityFilter}
            onChange={(checked) => updateDraft({ enableProfanityFilter: checked })}
            label="Mask Profanity"
            description="Apply the official profanity filter using the MASK mode."
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
          <span className={clsx(draft.whisperPrompt.trim().length > MAX_WHISPER_PROMPT_LENGTH && "text-[var(--vscode-errorForeground)]")}>
            {draft.whisperPrompt.trim().length} / {MAX_WHISPER_PROMPT_LENGTH} characters
          </span>
        </div>
      </WorkbenchSection>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <WorkbenchDismissButton type="button" label={backToLabel("Speech")} onClick={onBack} />
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
    </div>
  )
}

function renderJobDetailWorkspace({
  selectedJob,
  selectedJobId,
  tasks,
  filteredTasks,
  selectedTask,
  selectedTaskId,
  selectedTaskJsonResult,
  selectedTaskSrtResult,
  selectedTaskResultObjects,
  taskQuery,
  resultObjects,
  selectedResultObject,
  resultPreview,
  loadingJobDetail,
  loadingTasks,
  loadingResultObjects,
  loadingResultPreview,
  detailError,
  resultObjectsError,
  resultPreviewError,
  downloadingResultObjectName,
  showResultViewerWorkspace,
  onOpenWorkspace,
  onRefreshJob,
  onRevealJob,
  onTaskQueryChange,
  onSelectTask,
  onSelectResultObject,
  onOpenResultViewer,
  onCloseResultViewer,
  onDownloadResult,
  onCancelJob,
  cancellingJobId,
  navigateToView,
}: {
  selectedJob: SpeechTranscriptionJobResource | null
  selectedJobId: string
  tasks: SpeechTranscriptionTaskResource[]
  filteredTasks: SpeechTranscriptionTaskResource[]
  selectedTask: SpeechTranscriptionTaskResource | null
  selectedTaskId: string
  selectedTaskJsonResult: ObjectStorageObjectResource | null
  selectedTaskSrtResult: ObjectStorageObjectResource | null
  selectedTaskResultObjects: ObjectStorageObjectResource[]
  taskQuery: string
  resultObjects: ObjectStorageObjectResource[]
  selectedResultObject: ObjectStorageObjectResource | null
  resultPreview: SpeechResultPreviewState
  loadingJobDetail: boolean
  loadingTasks: boolean
  loadingResultObjects: boolean
  loadingResultPreview: boolean
  detailError: string | null
  resultObjectsError: string | null
  resultPreviewError: string | null
  downloadingResultObjectName: string | null
  showResultViewerWorkspace: boolean
  onOpenWorkspace: () => void
  onRefreshJob: () => void
  onRevealJob: () => void
  onTaskQueryChange: (value: string) => void
  onSelectTask: (taskId: string) => void
  onSelectResultObject: (objectName: string) => void
  onOpenResultViewer: (objectName?: string) => void
  onCloseResultViewer: () => void
  onDownloadResult: (objectName: string) => void
  onCancelJob: (job: SpeechTranscriptionJobResource) => void
  cancellingJobId: string | null
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

  if (!selectedJob && loadingJobDetail) {
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
  const canCancel = ["ACCEPTED", "IN_PROGRESS"].includes(selectedJob.lifecycleState.toUpperCase())
  const displayedResultObjects = selectedTask ? selectedTaskResultObjects : resultObjects

  return (
    <div className="flex min-h-full flex-col gap-2">
      <WorkbenchHero
        eyebrow="Speech Job"
        title={selectedJob.name}
        resourceId={selectedJob.id}
        badge={<LifecycleBadge state={selectedJob.lifecycleState} />}
        metaItems={[
          { label: "Region", value: SPEECH_REGION_LABEL },
          { label: "Progress", value: formatPercent(selectedJob.percentComplete) },
          { label: "Files", value: formatCount(selectedFileCount) },
          { label: "Tasks", value: formatTaskProgress(selectedJob.successfulTasks, selectedJob.totalTasks) },
        ]}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <WorkbenchCompactActionCluster>
          <WorkbenchRevealButton type="button" label={showInListLabel("Speech Job")} onClick={onRevealJob} />
        </WorkbenchCompactActionCluster>

        <WorkbenchCompactActionCluster>
          <WorkbenchRefreshButton onClick={onRefreshJob} />
          <WorkbenchSecondaryActionButton type="button" variant="secondary" onClick={onOpenWorkspace}>
            {openWorkspaceLabel("Speech")}
          </WorkbenchSecondaryActionButton>
          {canCancel && (
            <WorkbenchActionButton
              type="button"
              variant="secondary"
              onClick={() => onCancelJob(selectedJob)}
              disabled={cancellingJobId === selectedJob.id}
            >
              {cancellingJobId === selectedJob.id ? <Loader2 size={12} className="animate-spin" /> : <CircleSlash size={12} />}
              Cancel Job
            </WorkbenchActionButton>
          )}
        </WorkbenchCompactActionCluster>
      </div>

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

      {showResultViewerWorkspace ? (
        renderSpeechResultViewerWorkspace({
          selectedJob,
          selectedTask,
          displayedResultObjects,
          selectedResultObject,
          resultPreview,
          loadingResultObjects,
          loadingResultPreview,
          resultObjectsError,
          resultPreviewError,
          downloadingResultObjectName,
          onSelectResultObject,
          onCloseResultViewer,
          onDownloadResult,
        })
      ) : (
        <>
          <WorkbenchSection
            title="Tasks"
            subtitle="Modeled after the OCI Speech task list: search by file name, select a task, and download its JSON or SRT output directly."
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <WorkbenchCompactActionCluster>
                <WorkbenchSecondaryActionButton
                  type="button"
                  variant="secondary"
                  disabled={!selectedTaskJsonResult}
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
                  disabled={!selectedTaskSrtResult}
                  onClick={() => {
                    if (selectedTaskSrtResult) {
                      onDownloadResult(selectedTaskSrtResult.name)
                    }
                  }}
                >
                  <ArrowDownToLine size={12} />
                  Download SRT
                </WorkbenchSecondaryActionButton>
              </WorkbenchCompactActionCluster>

              <div className="w-full sm:max-w-[280px]">
                <Input
                  value={taskQuery}
                  onChange={(event) => onTaskQueryChange(event.target.value)}
                  placeholder="Search tasks by name..."
                  aria-label="Search tasks by name"
                />
              </div>
            </div>

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
                <div className="max-h-[320px] overflow-auto">
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
                        const matchedJson = getPreferredSpeechTaskResultObject(task, resultObjects, "json")
                        const matchedSrt = getPreferredSpeechTaskResultObject(task, resultObjects, "srt")
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

            {selectedTask && !selectedTaskJsonResult && !selectedTaskSrtResult && (
              <InlineNotice tone="info" icon={<FileText size={14} />} title="No Direct JSON/SRT Match">
                The selected task does not have a confidently matched JSON or SRT file yet. Refresh the job after more output files appear, or review the full result list below.
              </InlineNotice>
            )}
          </WorkbenchSection>

          {renderSpeechResultOverviewSection({
            selectedJob,
            selectedTask,
            displayedResultObjects,
            selectedResultObject,
            loadingResultObjects,
            resultObjectsError,
            downloadingResultObjectName,
            onSelectResultObject,
            onOpenResultViewer,
            onDownloadResult,
          })}
        </>
      )}

      {!showResultViewerWorkspace && (
        <>
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
                      {objectName}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="text-[11px] text-description">Input file details were not returned for this job yet.</div>
              )}
            </WorkbenchSurface>
          </WorkbenchSection>

          <WorkbenchSection title="Transcription Profile" subtitle="These values reflect the effective Speech configuration returned by the service.">
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
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

          <WorkbenchSection title="Selected Task" subtitle="Focused metadata for the task currently selected in the task table.">
            {!selectedTask ? (
              <WorkbenchEmptyState
                icon={<ListChecks size={18} />}
                title="No Task Selected"
                description="Select a task above to inspect its timing and output availability."
              />
            ) : (
              <>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                  <SummaryMetaCard label="Status" value={selectedTask.lifecycleState || "Unknown"} />
                  <SummaryMetaCard label="Progress" value={formatPercent(selectedTask.percentComplete)} />
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
          </WorkbenchSection>
        </>
      )}
    </div>
  )
}

function renderSpeechResultOverviewSection({
  selectedJob,
  selectedTask,
  displayedResultObjects,
  selectedResultObject,
  loadingResultObjects,
  resultObjectsError,
  downloadingResultObjectName,
  onSelectResultObject,
  onOpenResultViewer,
  onDownloadResult,
}: {
  selectedJob: SpeechTranscriptionJobResource
  selectedTask: SpeechTranscriptionTaskResource | null
  displayedResultObjects: ObjectStorageObjectResource[]
  selectedResultObject: ObjectStorageObjectResource | null
  loadingResultObjects: boolean
  resultObjectsError: string | null
  downloadingResultObjectName: string | null
  onSelectResultObject: (objectName: string) => void
  onOpenResultViewer: (objectName?: string) => void
  onDownloadResult: (objectName: string) => void
}) {
  const canOpenSelectedResultViewer = selectedResultObject ? canPreviewSpeechResultObject(selectedResultObject.name) : false

  return (
    <WorkbenchSection
      title="Latest Results"
      subtitle={selectedTask
        ? "Result files matched to the selected task. Open the dedicated result viewer when you need an inline text preview."
        : "Review the newest output artifacts here, then open the dedicated result viewer for previewable files."}
      actions={canOpenSelectedResultViewer
        ? (
          <WorkbenchRevealButton
            type="button"
            label={openViewLabel("Result Viewer")}
            onClick={() => onOpenResultViewer(selectedResultObject?.name)}
          />
        )
        : undefined}
    >
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
            ? "The selected task does not currently map to any previewable result files under the job output prefix."
            : selectedJob.lifecycleState.toUpperCase() === "SUCCEEDED"
              ? "No output objects were found under the configured Speech output prefix. Refresh the job or confirm the output prefix."
              : "OCI Speech has not written output files under the configured prefix yet. Refresh the job after processing advances."}
        />
      ) : (
        <WorkbenchSurface className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[12px] font-medium text-foreground">Output Files</div>
              <div className="text-[11px] text-description">
                {displayedResultObjects.length} item{displayedResultObjects.length === 1 ? "" : "s"}
                {selectedTask ? ` matched to ${getLeafName(selectedTask.name)}` : ` under ${selectedJob.outputPrefix || "/"}`}
              </div>
            </div>
            <StatusBadge label={selectedJob.lifecycleState} tone={toneFromLifecycleState(selectedJob.lifecycleState)} size="compact" />
          </div>

          <div className="space-y-1.5">
            {displayedResultObjects.map((item) => {
              const selected = item.name === selectedResultObject?.name
              const previewable = canPreviewSpeechResultObject(item.name)
              return (
                <WorkbenchActionInventoryCard
                  key={item.name}
                  title={getLeafName(item.name)}
                  subtitle={item.name}
                  selected={selected}
                  trailing={<StatusBadge label={previewable ? "Preview" : "Download"} tone="neutral" size="compact" />}
                  meta={(
                    <div className="flex flex-wrap gap-2 text-[10px] text-description">
                      <span>{formatBytes(item.size)}</span>
                      <span>{formatDateTime(item.timeModified || item.timeCreated)}</span>
                    </div>
                  )}
                  actions={(
                    <WorkbenchCompactActionCluster>
                      {previewable && (
                        <WorkbenchRevealButton
                          type="button"
                          label={openViewLabel("Result Viewer")}
                          onClick={() => onOpenResultViewer(item.name)}
                        />
                      )}
                      <WorkbenchSecondaryActionButton
                        type="button"
                        variant="secondary"
                        disabled={Boolean(downloadingResultObjectName) && downloadingResultObjectName !== item.name}
                        onClick={() => onDownloadResult(item.name)}
                      >
                        {downloadingResultObjectName === item.name ? <Loader2 size={12} className="animate-spin" /> : <ArrowDownToLine size={12} />}
                        Download
                      </WorkbenchSecondaryActionButton>
                    </WorkbenchCompactActionCluster>
                  )}
                  onSelect={() => onSelectResultObject(item.name)}
                />
              )
            })}
          </div>
        </WorkbenchSurface>
      )}
    </WorkbenchSection>
  )
}

function renderSpeechResultViewerWorkspace({
  selectedJob,
  selectedTask,
  displayedResultObjects,
  selectedResultObject,
  resultPreview,
  loadingResultObjects,
  loadingResultPreview,
  resultObjectsError,
  resultPreviewError,
  downloadingResultObjectName,
  onSelectResultObject,
  onCloseResultViewer,
  onDownloadResult,
}: {
  selectedJob: SpeechTranscriptionJobResource
  selectedTask: SpeechTranscriptionTaskResource | null
  displayedResultObjects: ObjectStorageObjectResource[]
  selectedResultObject: ObjectStorageObjectResource | null
  resultPreview: SpeechResultPreviewState
  loadingResultObjects: boolean
  loadingResultPreview: boolean
  resultObjectsError: string | null
  resultPreviewError: string | null
  downloadingResultObjectName: string | null
  onSelectResultObject: (objectName: string) => void
  onCloseResultViewer: () => void
  onDownloadResult: (objectName: string) => void
}) {
  const previewAvailable = selectedResultObject ? canPreviewSpeechResultObject(selectedResultObject.name) : false

  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--vscode-panel-border)] bg-[var(--workbench-panel-shell)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--vscode-panel-border)] px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <WorkbenchBackButton type="button" label={backToLabel("Speech Job")} onClick={onCloseResultViewer} />
          <div className="min-w-0">
            <div className="truncate text-[12px] font-semibold uppercase tracking-wide text-[var(--vscode-sideBarTitle-foreground)]">
              Result Viewer
            </div>
            <div className="truncate text-[10px] text-description">{selectedJob.name}</div>
          </div>
        </div>
        {selectedResultObject && (
          <WorkbenchCompactActionCluster>
            <WorkbenchSecondaryActionButton
              type="button"
              variant="secondary"
              disabled={Boolean(downloadingResultObjectName) && downloadingResultObjectName !== selectedResultObject.name}
              onClick={() => onDownloadResult(selectedResultObject.name)}
            >
              {downloadingResultObjectName === selectedResultObject.name ? <Loader2 size={12} className="animate-spin" /> : <ArrowDownToLine size={12} />}
              Download Current
            </WorkbenchSecondaryActionButton>
          </WorkbenchCompactActionCluster>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        <WorkbenchSection
          title="Speech Results"
          subtitle={selectedTask
            ? "Review result files matched to the selected task on a dedicated page and switch between previewable artifacts without returning to the job overview."
            : "Review Speech output files on a dedicated page and switch between previewable artifacts without leaving the selected job."}
          className="min-h-full"
        >
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
                ? "The selected task does not currently map to any previewable result files under the job output prefix."
                : selectedJob.lifecycleState.toUpperCase() === "SUCCEEDED"
                  ? "No output objects were found under the configured Speech output prefix. Refresh the job or confirm the output prefix."
                  : "OCI Speech has not written output files under the configured prefix yet. Refresh the job after processing advances."}
            />
          ) : (
            <div className="grid gap-2 xl:grid-cols-[minmax(260px,0.78fr)_minmax(0,1.22fr)]">
              <WorkbenchSurface className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[12px] font-medium text-foreground">Output Files</div>
                    <div className="text-[11px] text-description">
                      {displayedResultObjects.length} item{displayedResultObjects.length === 1 ? "" : "s"}
                      {selectedTask ? ` matched to ${getLeafName(selectedTask.name)}` : ` under ${selectedJob.outputPrefix || "/"}`}
                    </div>
                  </div>
                  <StatusBadge label={selectedJob.lifecycleState} tone={toneFromLifecycleState(selectedJob.lifecycleState)} size="compact" />
                </div>

                <div className="space-y-1.5">
                  {displayedResultObjects.map((item) => {
                    const selected = item.name === selectedResultObject?.name
                    const previewable = canPreviewSpeechResultObject(item.name)
                    return (
                      <WorkbenchActionInventoryCard
                        key={item.name}
                        title={getLeafName(item.name)}
                        subtitle={item.name}
                        selected={selected}
                        trailing={<StatusBadge label={previewable ? "Preview" : "Download"} tone="neutral" size="compact" />}
                        meta={(
                          <div className="flex flex-wrap gap-2 text-[10px] text-description">
                            <span>{formatBytes(item.size)}</span>
                            <span>{formatDateTime(item.timeModified || item.timeCreated)}</span>
                          </div>
                        )}
                        actions={(
                          <WorkbenchCompactActionCluster>
                            <WorkbenchSelectButton
                              type="button"
                              selected={selected}
                              selectedLabel={previewable ? "Viewing" : "Selected"}
                              idleLabel={previewable ? "View" : "Select"}
                              onClick={() => onSelectResultObject(item.name)}
                            />
                            <WorkbenchSecondaryActionButton
                              type="button"
                              variant="secondary"
                              disabled={Boolean(downloadingResultObjectName) && downloadingResultObjectName !== item.name}
                              onClick={() => onDownloadResult(item.name)}
                            >
                              {downloadingResultObjectName === item.name ? <Loader2 size={12} className="animate-spin" /> : <ArrowDownToLine size={12} />}
                              Download
                            </WorkbenchSecondaryActionButton>
                          </WorkbenchCompactActionCluster>
                        )}
                        onSelect={() => onSelectResultObject(item.name)}
                      />
                    )
                  })}
                </div>
              </WorkbenchSurface>

              <WorkbenchSurface className="min-h-[320px] space-y-2">
                {!selectedResultObject ? (
                  <WorkbenchEmptyState
                    icon={<Eye size={18} />}
                    title="No Result File Selected"
                    description="Choose an output file on the left to preview text results or download the artifact."
                  />
                ) : !previewAvailable ? (
                  <WorkbenchEmptyState
                    icon={<ArrowDownToLine size={18} />}
                    title="Preview Not Available"
                    description="This output artifact is not previewed in the Result Viewer yet. Download it directly from this page if you need the file."
                  />
                ) : loadingResultPreview ? (
                  <WorkbenchLoadingState label="Loading result preview..." className="min-h-[280px]" />
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-[12px] font-medium text-foreground">{getLeafName(selectedResultObject.name)}</div>
                        <div className="truncate text-[11px] text-description">{selectedResultObject.name}</div>
                      </div>
                      <StatusBadge label="Preview" tone="neutral" size="compact" />
                    </div>

                    {resultPreviewError && (
                      <InlineNotice tone="danger" icon={<AlertCircle size={14} />} title="Preview Error">
                        {resultPreviewError}
                      </InlineNotice>
                    )}

                    {resultPreview?.truncated && resultPreview.objectName === selectedResultObject.name && (
                      <InlineNotice tone="info" icon={<FileText size={14} />} title="Preview Truncated">
                        Showing the first {formatBytes(MAX_RESULT_PREVIEW_BYTES)} of this result file. Download the artifact for the full content.
                      </InlineNotice>
                    )}

                    {!resultPreviewError && (
                      <div className="min-h-[240px] overflow-auto rounded-[2px] border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] p-2">
                        <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[var(--vscode-foreground)]">
                          {resultPreview?.objectName === selectedResultObject.name && resultPreview.text
                            ? resultPreview.text
                            : "This result file is empty."}
                        </pre>
                      </div>
                    )}
                  </>
                )}
              </WorkbenchSurface>
            </div>
          )}
        </WorkbenchSection>
      </div>
    </section>
  )
}

function SpeechSelectField({
  label,
  value,
  onChange,
  options,
  placeholder = "Select an option",
  disabled = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string; description?: string }>
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] text-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className={clsx(
          "h-[28px] rounded-[2px] border border-input-border bg-input-background px-2 text-[12px] text-input-foreground outline-none focus:border-[var(--vscode-focusBorder)]",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        {!value && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
            {option.description ? ` - ${option.description}` : ""}
          </option>
        ))}
      </select>
    </label>
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
  return outputObjectNames.map((objectName) => objectDetailsByName.get(objectName) ?? { name: objectName })
}

function getPreferredSpeechTaskResultObject(
  task: SpeechTranscriptionTaskResource | null,
  objects: ObjectStorageObjectResource[],
  extension?: string,
) {
  if (!task) {
    return null
  }

  const matchedObjects = getSpeechResultObjectsForTask(objects, task)
  const normalizedExtension = extension?.toLowerCase()
  const filteredObjects = normalizedExtension
    ? matchedObjects.filter((item) => getFileExtension(item.name) === normalizedExtension)
    : matchedObjects

  return filteredObjects[0] ?? null
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

function getDefaultResultObjectName(
  objects: ObjectStorageObjectResource[],
  job: SpeechTranscriptionJobResource | null,
) {
  const candidates = getLikelySpeechResultObjects(objects, job)
  return candidates[0]?.name ?? ""
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
  const nextOutputBucketKey = draft.outputMode === "same"
    ? nextInputBucketKey
    : bucketKeys.has(draft.outputBucketKey)
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

function formatPercent(value: number | undefined) {
  return typeof value === "number" ? `${Math.max(0, Math.min(100, value))}%` : "Pending"
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
