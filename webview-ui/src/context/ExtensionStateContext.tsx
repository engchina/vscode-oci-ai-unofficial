import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react"
import { ChatServiceClient, StateServiceClient, UiServiceClient } from "../services/grpc-client"
import type { AppState, ChatMessageData, StreamTokenResponse } from "../services/types"

export type ViewType = "chat" | "settings" | "history"

export interface ExtensionStateContextType {
  // Hydration
  didHydrateState: boolean

  // App state
  profile: string
  region: string
  compartmentId: string
  genAiRegion: string
  genAiLlmModelId: string
  genAiEmbeddingModelId: string
  chatMessages: ChatMessageData[]
  isStreaming: boolean

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
  sendMessage: (text: string) => void
  clearHistory: () => void
  newChat: () => void
}

const ExtensionStateContext = createContext<ExtensionStateContextType | undefined>(undefined)

export function ExtensionStateContextProvider({ children }: { children: ReactNode }) {
  const [didHydrateState, setDidHydrateState] = useState(false)
  const [currentView, setCurrentView] = useState<ViewType>("chat")
  const [streamingText, setStreamingText] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)

  const [state, setState] = useState<AppState>({
    profile: "",
    region: "",
    compartmentId: "",
    genAiRegion: "",
    genAiLlmModelId: "",
    genAiEmbeddingModelId: "",
    chatMessages: [],
    isStreaming: false,
  })

  const cancelStreamRef = useRef<(() => void) | null>(null)

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
      onComplete: () => {},
    })

    const unsubscribeChat = UiServiceClient.subscribeToChatButtonClicked({
      onResponse: () => setCurrentView("chat"),
      onError: (error) => console.error("Chat button subscription error:", error),
      onComplete: () => {},
    })

    return () => {
      unsubscribeState()
      unsubscribeSettings()
      unsubscribeChat()
    }
  }, [])

  // Send message
  const sendMessage = useCallback((text: string) => {
    if (!text.trim()) return

    // Add user message optimistically
    setState((prev) => ({
      ...prev,
      chatMessages: [...prev.chatMessages, { role: "user" as const, text: text.trim() }],
    }))

    setIsStreaming(true)
    setStreamingText("")

    cancelStreamRef.current = ChatServiceClient.sendMessage(
      { text: text.trim() },
      {
        onResponse: (response: StreamTokenResponse) => {
          setStreamingText((prev) => prev + response.token)
        },
        onError: (error) => {
          console.error("Chat stream error:", error)
          setStreamingText((prev) => prev + `\n\nError: ${error.message}`)
          setIsStreaming(false)
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

  const clearHistory = useCallback(() => {
    ChatServiceClient.clearHistory().then(() => {
      setState((prev) => ({ ...prev, chatMessages: [] }))
    })
  }, [])

  const newChat = useCallback(() => {
    ChatServiceClient.clearHistory().then(() => {
      setState((prev) => ({ ...prev, chatMessages: [] }))
      setCurrentView("chat")
    })
  }, [])

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
    clearHistory,
    newChat,
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
