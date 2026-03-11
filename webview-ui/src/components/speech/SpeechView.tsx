import { clsx } from "clsx"
import {
  AlertCircle,
  AudioLines,
  CheckCircle2,
  CircleSlash,
  FileAudio,
  ListChecks,
  Loader2,
  Sparkles,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import SplitWorkspaceLayout from "../workbench/SplitWorkspaceLayout"
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
const TRANSITIONAL_JOB_STATES = new Set(["ACCEPTED", "IN_PROGRESS", "CANCELING"])
const TRANSITIONAL_TASK_STATES = new Set(["ACCEPTED", "IN_PROGRESS"])

const MODEL_OPTIONS: Array<{ value: SpeechTranscriptionModelType; label: string; description: string }> = [
  {
    value: "WHISPER_LARGE_V3_TURBO",
    label: "Whisper Large v3 Turbo",
    description: "Fastest Whisper option for iterative speech workflows.",
  },
  {
    value: "WHISPER_MEDIUM",
    label: "Whisper Medium",
    description: "Slightly slower, but typically more accurate than Turbo.",
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
    jobId: string
    jobName: string
    message: string
    timestamp: number
  }
  | null

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
    modelType: "WHISPER_LARGE_V3_TURBO",
    languageCode: "ja",
    includeSrt: true,
    enableDiarization: false,
    enableProfanityFilter: false,
    whisperPrompt: "",
  }
}

export default function SpeechView() {
  const { activeProfile, profilesConfig, tenancyOcid, speechCompartmentIds, navigateToView } = useExtensionState()
  const { setResource } = useWorkbenchInsight()
  const [jobs, setJobs] = useState<SpeechTranscriptionJobResource[]>([])
  const [speechBuckets, setSpeechBuckets] = useState<ObjectStorageBucketResource[]>([])
  const [selectedJobId, setSelectedJobId] = useState("")
  const [jobDetail, setJobDetail] = useState<SpeechTranscriptionJobResource | null>(null)
  const [tasks, setTasks] = useState<SpeechTranscriptionTaskResource[]>([])
  const [tasksJobId, setTasksJobId] = useState("")
  const [draft, setDraft] = useState<SpeechJobDraft>(() => buildInitialDraft())
  const [inputPrefixes, setInputPrefixes] = useState<string[]>([])
  const [inputObjects, setInputObjects] = useState<ObjectStorageObjectResource[]>([])
  const [loadingJobs, setLoadingJobs] = useState(true)
  const [loadingBuckets, setLoadingBuckets] = useState(true)
  const [loadingJobDetail, setLoadingJobDetail] = useState(false)
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [loadingObjects, setLoadingObjects] = useState(false)
  const [creating, setCreating] = useState(false)
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null)
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false)
  const [query, setQuery] = useState("")
  const [objectQuery, setObjectQuery] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [guardrail, setGuardrail] = useState<WorkbenchGuardrailState>(null)
  const [recentAction, setRecentAction] = useState<RecentActionState>(null)
  const [highlightedJobId, setHighlightedJobId] = useState<string | null>(null)

  const recentActionTimerRef = useRef<number | null>(null)
  const highlightTimerRef = useRef<number | null>(null)
  const jobItemRefs = useRef(new Map<string, HTMLDivElement>())
  const selectedJobIdRef = useRef("")
  const jobsLoadRequestIdRef = useRef(0)
  const bucketLoadRequestIdRef = useRef(0)
  const detailLoadRequestIdRef = useRef(0)
  const taskLoadRequestIdRef = useRef(0)
  const objectLoadRequestIdRef = useRef(0)

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
    if (draft.selectedObjectNames.length === 0 || inputObjects.length === 0) {
      return []
    }
    const inputObjectsByName = new Map(inputObjects.map((item) => [item.name, item]))
    return draft.selectedObjectNames
      .map((objectName) => inputObjectsByName.get(objectName))
      .filter((item): item is ObjectStorageObjectResource => Boolean(item))
  }, [draft.selectedObjectNames, inputObjects])

  const isPolling = useMemo(
    () =>
      jobs.some((job) => TRANSITIONAL_JOB_STATES.has(job.lifecycleState.toUpperCase()))
      || visibleTasks.some((task) => TRANSITIONAL_TASK_STATES.has(task.lifecycleState.toUpperCase())),
    [jobs, visibleTasks],
  )

  const revealJob = useCallback((jobId: string) => {
    setQuery("")
    setSelectedJobId(jobId)
    setHighlightedJobId(jobId)
    requestAnimationFrame(() => {
      jobItemRefs.current.get(jobId)?.scrollIntoView({ block: "nearest" })
    })
  }, [])

  const loadJobs = useCallback(async (preferredJobId?: string) => {
    const requestId = jobsLoadRequestIdRef.current + 1
    jobsLoadRequestIdRef.current = requestId
    setLoadingJobs(true)
    setError(null)

    if (selectedCompartmentIds.length === 0) {
      setJobs([])
      setSelectedJobId("")
      setJobDetail(null)
      setTasks([])
      setTasksJobId("")
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

      setSelectedJobId(nextSelectedJobId)
      if (nextSelectedJobId !== currentSelectedJobId && !nextSelectedJobId) {
        setJobDetail(null)
        setTasks([])
        setTasksJobId("")
      }
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
  }, [selectedCompartmentIds])

  const loadBuckets = useCallback(async () => {
    const requestId = bucketLoadRequestIdRef.current + 1
    bucketLoadRequestIdRef.current = requestId
    setLoadingBuckets(true)

    if (selectedCompartmentIds.length === 0) {
      setSpeechBuckets([])
      setDraft(buildInitialDraft())
      setLoadingBuckets(false)
      return
    }

    try {
      const response = await ResourceServiceClient.listSpeechBuckets()
      if (bucketLoadRequestIdRef.current !== requestId) {
        return
      }

      const nextBuckets = response.buckets ?? []
      setSpeechBuckets(nextBuckets)
      setDraft((currentDraft) => syncDraftBuckets(currentDraft, nextBuckets))
    } catch (loadError) {
      if (bucketLoadRequestIdRef.current !== requestId) {
        return
      }
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      if (bucketLoadRequestIdRef.current === requestId) {
        setLoadingBuckets(false)
      }
    }
  }, [selectedCompartmentIds])

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

  const loadInputObjects = useCallback(async (bucket: ObjectStorageBucketResource | null, prefix: string) => {
    const requestId = objectLoadRequestIdRef.current + 1
    objectLoadRequestIdRef.current = requestId

    if (!bucket) {
      setInputPrefixes([])
      setInputObjects([])
      setLoadingObjects(false)
      return
    }

    setLoadingObjects(true)

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
      const visibleObjectNames = new Set(nextObjects.map((item) => item.name))
      setInputPrefixes(nextPrefixes)
      setInputObjects(nextObjects)
      setDraft((currentDraft) => ({
        ...currentDraft,
        selectedObjectNames: currentDraft.selectedObjectNames.filter((objectName) => visibleObjectNames.has(objectName)),
      }))
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

  useEffect(() => {
    selectedJobIdRef.current = selectedJobId
  }, [selectedJobId])

  useEffect(() => {
    void loadJobs()
    void loadBuckets()
  }, [loadBuckets, loadJobs])

  useEffect(() => {
    if (!selectedJobId) {
      setJobDetail(null)
      setTasks([])
      setTasksJobId("")
      setDetailError(null)
      return
    }

    setJobDetail((currentJobDetail) => currentJobDetail?.id === selectedJobId ? currentJobDetail : null)
    setTasks([])
    setTasksJobId("")
    setDetailError(null)
    void loadJobDetail(selectedJobId)
    void loadTasks(selectedJobId)
  }, [loadJobDetail, loadTasks, selectedJobId])

  useEffect(() => {
    void loadInputObjects(selectedInputBucket, draft.inputPrefix)
  }, [draft.inputPrefix, loadInputObjects, selectedInputBucket])

  useEffect(() => {
    if (!isPolling) {
      return
    }

    const timer = window.setInterval(() => {
      void loadJobs()
      if (selectedJobId) {
        void loadJobDetail(selectedJobId)
        void loadTasks(selectedJobId)
      }
    }, POLL_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [isPolling, loadJobDetail, loadJobs, loadTasks, selectedJobId])

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
    if (showCreateWorkspace) {
      setResource({
        view: "speech",
        title: draft.displayName.trim() || "New Speech Job",
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
            label: selectedJob ? backToLabel("Job Details") : backToLabel("Jobs"),
            run: () => setShowCreateWorkspace(false),
            variant: "secondary",
          },
          {
            label: "Refresh Buckets",
            run: () => {
              void loadBuckets()
            },
            variant: "ghost",
          },
        ],
      })
      return () => setResource(null)
    }

    if (!selectedJob) {
      setResource(null)
      return
    }

    const selectedFileCount = getSpeechInputFileCount(selectedJob)
    setResource({
      view: "speech",
      title: selectedJob.name,
      eyebrow: "Selected Speech Job",
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
          run: () => revealJob(selectedJob.id),
          variant: "ghost",
        },
        {
          label: openWorkspaceLabel("Composer"),
          run: () => setShowCreateWorkspace(true),
          variant: "secondary",
        },
        {
          label: "Refresh Job",
          run: () => {
            void loadJobDetail(selectedJob.id)
            void loadTasks(selectedJob.id)
          },
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
    loadBuckets,
    loadJobDetail,
    loadTasks,
    query,
    revealJob,
    selectedInputBucket?.name,
    selectedJob,
    selectedOutputBucket?.name,
    setResource,
    showCreateWorkspace,
  ])

  const updateDraft = useCallback((patch: Partial<SpeechJobDraft>) => {
    setDraft((currentDraft) => ({ ...currentDraft, ...patch }))
  }, [])

  const handleInputBucketChange = useCallback((bucketKey: string) => {
    setDraft((currentDraft) => ({
      ...currentDraft,
      inputBucketKey: bucketKey,
      inputPrefix: "",
      selectedObjectNames: [],
      outputBucketKey:
        currentDraft.outputMode === "same"
          ? currentDraft.outputBucketKey
          : currentDraft.outputBucketKey === currentDraft.inputBucketKey
            ? bucketKey
            : currentDraft.outputBucketKey,
    }))
    setObjectQuery("")
  }, [])

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
      return {
        ...currentDraft,
        selectedObjectNames: isSelected
          ? currentDraft.selectedObjectNames.filter((value) => value !== objectName)
          : [...currentDraft.selectedObjectNames, objectName],
      }
    })
  }, [])

  const handleCreateJob = useCallback(async () => {
    setError(null)

    if (!selectedInputBucket) {
      setError("Select an input bucket before creating a Speech job.")
      return
    }
    if (draft.selectedObjectNames.length === 0) {
      setError("Select at least one audio object from the input bucket.")
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
    if (draft.whisperPrompt.trim().length > MAX_WHISPER_PROMPT_LENGTH) {
      setError(`Whisper prompt must be ${MAX_WHISPER_PROMPT_LENGTH} characters or fewer.`)
      return
    }
    const oversizedObject = selectedInputObjects.find((item) => typeof item.size === "number" && item.size > MAX_SPEECH_OBJECT_SIZE_BYTES)
    if (oversizedObject) {
      setError(`${getLeafName(oversizedObject.name)} exceeds the 2 GB per-file Speech limit.`)
      return
    }

    const request: CreateSpeechTranscriptionJobRequest = {
      compartmentId: selectedInputBucket.compartmentId,
      displayName: draft.displayName.trim() || buildSuggestedJobName(draft.selectedObjectNames),
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
        jobId: createdJob.id,
        jobName: createdJob.name,
        message: `Created ${createdJob.name}`,
        timestamp: Date.now(),
      })
      setHighlightedJobId(createdJob.id)
      setShowCreateWorkspace(false)
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
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError))
    } finally {
      setCreating(false)
    }
  }, [draft, loadJobDetail, loadJobs, loadTasks, selectedInputBucket, selectedInputObjects, selectedOutputBucket])

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
            jobId: job.id,
            jobName: job.name,
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

  return (
    <>
      <FeaturePageLayout
        title="Speech"
        description="Create Whisper-based transcription jobs against OCI Speech in Chicago."
        icon={<AudioLines size={14} />}
        status={(
          <div className="flex items-center gap-1">
            <StatusBadge label="us-chicago-1" tone="neutral" />
            {(creating || loadingJobs || loadingBuckets) && <StatusBadge label="Syncing" tone="warning" />}
          </div>
        )}
        actions={(
          <WorkbenchCompactActionCluster>
            <WorkbenchRefreshButton onClick={() => {
              void loadJobs()
              void loadBuckets()
              if (selectedJobId) {
                void loadJobDetail(selectedJobId)
                void loadTasks(selectedJobId)
              }
            }} />
            <WorkbenchActionButton type="button" variant="secondary" onClick={() => setShowCreateWorkspace(true)}>
              {openWorkspaceLabel("Speech")}
            </WorkbenchActionButton>
          </WorkbenchCompactActionCluster>
        )}
        controls={(
          <div className="grid gap-2 xl:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
            <CompartmentSelector featureKey="speech" multiple />
            <FeatureSearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search Speech jobs by name, OCID, or state..."
            />
          </div>
        )}
        contentClassName="p-2"
      >
        <SplitWorkspaceLayout
          sidebar={(
            <div className="flex h-full min-h-0 flex-col gap-2">
              <InlineNotice tone="info" icon={<AudioLines size={14} />} title="Speech Region">
                Speech transcription is intentionally pinned to <code>{SPEECH_REGION}</code>. Input and output buckets are also filtered to that region.
              </InlineNotice>

              <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-1">
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
              ) : filteredJobs.length === 0 ? (
                <WorkbenchInventoryFilterEmpty
                  message={jobs.length === 0
                    ? "No Speech jobs found yet. Open the composer to create your first transcription job."
                    : "No Speech jobs match the current filter."}
                />
              ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
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
                                <WorkbenchSelectButton
                                  type="button"
                                  selected={job.id === selectedJobId}
                                  onClick={() => setSelectedJobId(job.id)}
                                />
                                <WorkbenchRevealButton type="button" label={showInListLabel("Speech Job")} onClick={() => revealJob(job.id)} />
                              </WorkbenchCompactActionCluster>
                            )}
                            onSelect={() => setSelectedJobId(job.id)}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          )}
          main={showCreateWorkspace
            ? renderCreateWorkspace({
              draft,
              updateDraft,
              onOutputModeChange: handleOutputModeChange,
              loadingBuckets,
              loadingObjects,
              speechBuckets,
              selectedInputBucket,
              selectedOutputBucket,
              inputPrefixes,
              inputObjects: visibleInputObjects,
              objectQuery,
              onObjectQueryChange: setObjectQuery,
              onInputBucketChange: handleInputBucketChange,
              onSelectOutputBucket: (value) => updateDraft({ outputBucketKey: value }),
              onSelectPrefix: (value) => updateDraft({ inputPrefix: value }),
              onToggleInputObject: toggleInputObject,
              onBack: () => setShowCreateWorkspace(false),
              onRefreshBuckets: () => void loadBuckets(),
              onRefreshObjects: () => void loadInputObjects(selectedInputBucket, draft.inputPrefix),
	              onCreateJob: handleCreateJob,
              creating,
              selectedJobId,
              navigateToView,
            })
            : renderJobDetailWorkspace({
              selectedJob,
              selectedJobId,
              tasks: visibleTasks,
              loadingJobDetail,
              loadingTasks,
              detailError,
              onOpenComposer: () => setShowCreateWorkspace(true),
              onRefreshJob: () => {
                if (!selectedJobId) {
                  return
                }
                void loadJobDetail(selectedJobId)
                void loadTasks(selectedJobId)
              },
              onRevealJob: () => {
                if (selectedJobId) {
                  revealJob(selectedJobId)
                }
              },
              onCancelJob: requestCancelJob,
              cancellingJobId,
              navigateToView,
            })}
        />
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

function renderCreateWorkspace({
  draft,
  updateDraft,
  onOutputModeChange,
  loadingBuckets,
  loadingObjects,
  speechBuckets,
  selectedInputBucket,
  selectedOutputBucket,
  inputPrefixes,
  inputObjects,
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
  selectedJobId,
  navigateToView,
}: {
  draft: SpeechJobDraft
  updateDraft: (patch: Partial<SpeechJobDraft>) => void
  onOutputModeChange: (value: OutputMode) => void
  loadingBuckets: boolean
  loadingObjects: boolean
  speechBuckets: ObjectStorageBucketResource[]
  selectedInputBucket: ObjectStorageBucketResource | null
  selectedOutputBucket: ObjectStorageBucketResource | null
  inputPrefixes: string[]
  inputObjects: ObjectStorageObjectResource[]
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
  selectedJobId: string
  navigateToView: (view: "objectStorage" | "speech") => void
}) {
  return (
    <div className="flex min-h-full flex-col gap-2">
      <WorkbenchHero
        eyebrow="Speech Composer"
        title={draft.displayName.trim() || "Create Transcription Job"}
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
              Refresh Buckets
            </WorkbenchActionButton>
            <WorkbenchActionButton type="button" variant="ghost" onClick={() => navigateToView("objectStorage")}>
              {openViewLabel("Object Storage")}
            </WorkbenchActionButton>
          </>
        )}
      >
        The transcription job is always created in <code>{SPEECH_REGION}</code>. The job compartment follows the selected input bucket's compartment.
      </InlineNotice>

      <WorkbenchSection
        title="Job Identity"
        subtitle="Keep the job name descriptive enough to find it quickly in the inventory."
        actions={<WorkbenchBackButton type="button" label={selectedJobId ? backToLabel("Job Details") : backToLabel("Jobs")} onClick={onBack} />}
      >
        <Input
          label="Display Name"
          value={draft.displayName}
          onChange={(event) => updateDraft({ displayName: event.target.value })}
          placeholder="speech-customer-call-20260311"
        />
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
            <WorkbenchRefreshButton onClick={onRefreshObjects} />
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
              onChange={(event) => updateDraft({ inputPrefix: normalizePrefix(event.target.value) })}
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

            {!selectedInputBucket ? (
              <WorkbenchEmptyState
                icon={<FileAudio size={18} />}
                title="No Input Bucket Selected"
                description="Pick a Speech input bucket to browse audio objects in Chicago."
              />
            ) : loadingObjects ? (
              <WorkbenchLoadingState label="Loading bucket objects..." />
            ) : inputObjects.length === 0 ? (
              <WorkbenchEmptyState
                icon={<FileAudio size={18} />}
                title="No Objects Under This Prefix"
                description="Adjust the prefix, pick another bucket, or upload audio files to Object Storage first."
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
          {draft.whisperPrompt.trim().length} / {MAX_WHISPER_PROMPT_LENGTH} characters
        </div>
      </WorkbenchSection>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <WorkbenchDismissButton type="button" label={selectedJobId ? backToLabel("Job Details") : backToLabel("Jobs")} onClick={onBack} />
        <WorkbenchSubmitButton type="button" variant="secondary" disabled={creating} onClick={onCreateJob}>
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
  loadingJobDetail,
  loadingTasks,
  detailError,
  onOpenComposer,
  onRefreshJob,
  onRevealJob,
  onCancelJob,
  cancellingJobId,
  navigateToView,
}: {
  selectedJob: SpeechTranscriptionJobResource | null
  selectedJobId: string
  tasks: SpeechTranscriptionTaskResource[]
  loadingJobDetail: boolean
  loadingTasks: boolean
  detailError: string | null
  onOpenComposer: () => void
  onRefreshJob: () => void
  onRevealJob: () => void
  onCancelJob: (job: SpeechTranscriptionJobResource) => void
  cancellingJobId: string | null
  navigateToView: (view: "objectStorage" | "speech") => void
}) {
  if (!selectedJobId) {
    return (
      <WorkbenchEmptyState
        icon={<AudioLines size={18} />}
        title="No Speech Job Selected"
        description="Pick a Speech job from the inventory or open the composer to create a new transcription workflow."
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
          <WorkbenchSecondaryActionButton type="button" variant="secondary" onClick={() => navigateToView("objectStorage")}>
            {openViewLabel("Object Storage")}
          </WorkbenchSecondaryActionButton>
        </WorkbenchCompactActionCluster>

        <WorkbenchCompactActionCluster>
          <WorkbenchRefreshButton onClick={onRefreshJob} />
          <WorkbenchSecondaryActionButton type="button" variant="secondary" onClick={onOpenComposer}>
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

      <WorkbenchSection title="Input and Output" subtitle="Speech jobs read from Object Storage and write results back to Object Storage in the same fixed region.">
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

      <WorkbenchSection title="Task Activity" subtitle="Each selected audio object becomes a transcription task under the job.">
        {loadingTasks ? (
          <WorkbenchLoadingState label="Loading transcription tasks..." />
        ) : tasks.length === 0 ? (
          <WorkbenchEmptyState
            icon={<ListChecks size={18} />}
            title="No Tasks Returned"
            description="The Speech service has not reported task details for this job yet."
          />
        ) : (
          <div className="space-y-1.5">
            {tasks.map((task) => (
              <WorkbenchActionInventoryCard
                key={task.id}
                title={task.name}
                subtitle={task.id}
                trailing={<LifecycleBadge state={task.lifecycleState} size="compact" />}
                meta={(
                  <div className="flex flex-wrap gap-2 text-[10px] text-description">
                    <span>{formatPercent(task.percentComplete)}</span>
                    <span>{formatBytes(task.fileSizeInBytes)}</span>
                    <span>{formatDuration(task.fileDurationInSeconds)}</span>
                    <span>{formatDateTime(task.timeStarted)}</span>
                  </div>
                )}
              />
            ))}
          </div>
        )}
      </WorkbenchSection>
    </div>
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
  return {
    ...draft,
    inputBucketKey: bucketKeys.has(draft.inputBucketKey) ? draft.inputBucketKey : firstBucketKey,
    outputBucketKey: bucketKeys.has(draft.outputBucketKey) ? draft.outputBucketKey : firstBucketKey,
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

function buildSuggestedJobName(objectNames: string[]) {
  const seed = getLeafName(objectNames[0] || "speech-job").replace(/\.[^.]+$/, "")
  const timestamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")
  return `speech-${seed || "job"}-${timestamp}`
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
  if (modelType === "WHISPER_LARGE_V3_TURBO") {
    return "Whisper Large v3 Turbo"
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
