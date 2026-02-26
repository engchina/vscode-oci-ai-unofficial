import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { ChatServiceClient, StateServiceClient, UiServiceClient } from "../services/grpc-client"
import type {
  AppState,
  ChatImageData,
  ChatMessageData,
  CodeContextPayload,
  SendMessageRequest,
  StreamTokenResponse
} from "../services/types"

export type ViewType = "chat" | "settings" | "history"

export interface ExtensionStateContextType {
  // Hydration
  didHydrateState: boolean

  activeProfile: string
  profile: string
  region: string
  compartmentId: string
  computeCompartmentIds: string[]
  chatCompartmentId: string
  adbCompartmentIds: string[]
  vcnCompartmentIds: string[]
  profilesConfig: { name: string; compartments: { id: string; name: string }[] }[]
  tenancyOcid: string
  genAiRegion: string
  genAiLlmModelId: string
  genAiEmbeddingModelId: string
  chatMessages: ChatMessageData[]
  isStreaming: boolean
  configWarning: string

  // Streaming text accumulator
  streamingText: string

  // View state
  currentView: ViewType
  showSettings: boolean

  // Navigation
  navigateToSettings: () => void
  navigateToChat: () => void
  navigateToHistory: () => void

  // Chat actions
  sendMessage: (request: SendMessageRequest) => void
  stopStreaming: () => void
  clearHistory: () => void
  newChat: () => void

  // Code context injection from editor
  pendingCodeContext: CodeContextPayload | null
  clearPendingCodeContext: () => void
}

const ExtensionStateContext = createContext<ExtensionStateContextType | undefined>(undefined)
const MAX_IMAGES_PER_MESSAGE = 10

export function ExtensionStateContextProvider({ children }: { children: ReactNode }) {
  const [didHydrateState, setDidHydrateState] = useState(false)
  const [currentView, setCurrentView] = useState<ViewType>("chat")
  const [streamingText, setStreamingText] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)

  const [state, setState] = useState<AppState>({
    activeProfile: "DEFAULT",
    profile: "",
    region: "",
    compartmentId: "",
    computeCompartmentIds: [],
    chatCompartmentId: "",
    adbCompartmentIds: [],
    vcnCompartmentIds: [],
    profilesConfig: [],
    tenancyOcid: "",
    genAiRegion: "",
    genAiLlmModelId: "",
    genAiEmbeddingModelId: "",
    chatMessages: [],
    isStreaming: false,
    configWarning: "",
  })

  const cancelStreamRef = useRef<(() => void) | null>(null)
  const [pendingCodeContext, setPendingCodeContext] = useState<CodeContextPayload | null>(null)
  const clearPendingCodeContext = useCallback(() => setPendingCodeContext(null), [])

  // Navigation
  const navigateToSettings = useCallback(() => setCurrentView("settings"), [])
  const navigateToChat = useCallback(() => setCurrentView("chat"), [])
  const navigateToHistory = useCallback(() => setCurrentView("history"), [])

  // Subscribe to state updates
  useEffect(() => {
    const unsubscribeState = StateServiceClient.subscribeToState({
      onResponse: (appState: AppState) => {
        setState(appState)
        setDidHydrateState(true)
      },
      onError: (error) => console.error("State subscription error:", error),
      onComplete: () => console.log("State subscription completed"),
    })

    // Subscribe to UI events
    const unsubscribeSettings = UiServiceClient.subscribeToSettingsButtonClicked({
      onResponse: () => setCurrentView("settings"),
      onError: (error) => console.error("Settings button subscription error:", error),
      onComplete: () => { },
    })

    const unsubscribeChat = UiServiceClient.subscribeToChatButtonClicked({
      onResponse: () => setCurrentView("chat"),
      onError: (error) => console.error("Chat button subscription error:", error),
      onComplete: () => { },
    })

    const unsubscribeCodeContext = UiServiceClient.subscribeToCodeContextReady({
      onResponse: (payload: CodeContextPayload) => {
        setPendingCodeContext(payload)
        setCurrentView("chat")
      },
      onError: (error) => console.error("Code context subscription error:", error),
      onComplete: () => { },
    })

    return () => {
      unsubscribeState()
      unsubscribeSettings()
      unsubscribeChat()
      unsubscribeCodeContext()
    }
  }, [])

  // Send message
  const sendMessage = useCallback((request: SendMessageRequest) => {
    const text = request.text?.trim() ?? ""
    const images = normalizeImages(request.images)
    if (!text && images.length === 0) return

    // Add user message optimistically
    setState((prev) => ({
      ...prev,
      chatMessages: [...prev.chatMessages, { role: "user" as const, text, images }],
    }))

    setIsStreaming(true)
    setStreamingText("")

    cancelStreamRef.current = ChatServiceClient.sendMessage(
      { text, images, modelName: request.modelName },
      {
        onResponse: (response: StreamTokenResponse) => {
          if (typeof response?.token !== "string") {
            return
          }
          setStreamingText((prev) => prev + response.token)
        },
        onError: (error) => {
          console.error("Chat stream error:", error)
          setStreamingText((prev) => prev + `\n\nError: ${error.message}`)
          setIsStreaming(false)
          cancelStreamRef.current = null
        },
        onComplete: () => {
          // Move streaming text to chat messages
          setStreamingText((currentStreaming) => {
            if (currentStreaming.trim()) {
              setState((prev) => ({
                ...prev,
                chatMessages: [...prev.chatMessages, { role: "model" as const, text: currentStreaming.trim() }],
              }))
            }
            return ""
          })
          setIsStreaming(false)
          cancelStreamRef.current = null
        },
      },
    )
  }, [])

  const stopStreaming = useCallback(() => {
    cancelStreamRef.current?.()
  }, [])

  const clearHistory = useCallback(() => {
    stopStreaming()
    ChatServiceClient.clearHistory().then(() => {
      setState((prev) => ({ ...prev, chatMessages: [] }))
    })
  }, [stopStreaming])

  const newChat = useCallback(() => {
    stopStreaming()
    ChatServiceClient.clearHistory().then(() => {
      setState((prev) => ({ ...prev, chatMessages: [] }))
      setCurrentView("chat")
    })
  }, [stopStreaming])

  const contextValue: ExtensionStateContextType = {
    didHydrateState,
    ...state,
    isStreaming,
    streamingText,
    currentView,
    showSettings: currentView === "settings",
    navigateToSettings,
    navigateToChat,
    navigateToHistory,
    sendMessage,
    stopStreaming,
    clearHistory,
    newChat,
    pendingCodeContext,
    clearPendingCodeContext,
  }

  return <ExtensionStateContext.Provider value={contextValue}>{children}</ExtensionStateContext.Provider>
}

export function useExtensionState() {
  const context = useContext(ExtensionStateContext)
  if (!context) {
    throw new Error("useExtensionState must be used within ExtensionStateContextProvider")
  }
  return context
}

function normalizeImages(images: ChatImageData[] | undefined): ChatImageData[] {
  if (!Array.isArray(images)) {
    return []
  }
  return images
    .map((img) => {
      const previewDataUrl = typeof img.previewDataUrl === "string" ? img.previewDataUrl.trim() : undefined
      return {
        dataUrl: typeof img.dataUrl === "string" ? img.dataUrl.trim() : "",
        previewDataUrl: isImageDataUrl(previewDataUrl) ? previewDataUrl : undefined,
        mimeType: typeof img.mimeType === "string" ? img.mimeType.trim() : "",
        name: typeof img.name === "string" ? img.name : undefined,
      }
    })
    .filter((img) => isImageDataUrl(img.dataUrl) && img.mimeType.length > 0)
    .slice(0, MAX_IMAGES_PER_MESSAGE)
}

function isImageDataUrl(value: string | undefined): value is string {
  if (typeof value !== "string") {
    return false
  }
  return /^data:image\//i.test(value)
}
