import { v4 as uuidv4 } from "uuid"

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

const vscodeApi = acquireVsCodeApi()
const DEFAULT_UNARY_TIMEOUT_MS = 30000

export interface Callbacks<TResponse> {
  onResponse: (response: TResponse) => void
  onError: (error: Error) => void
  onComplete: () => void
}

export abstract class ProtoBusClient {
  static serviceName: string

  static async makeUnaryRequest<TResponse>(
    this: { serviceName: string },
    methodName: string,
    request: unknown,
    timeoutMs = DEFAULT_UNARY_TIMEOUT_MS,
  ): Promise<TResponse> {
    return new Promise((resolve, reject) => {
      const requestId = uuidv4()
      let settled = false

      const finalize = (cb: () => void) => {
        if (settled) return
        settled = true
        window.removeEventListener("message", handleResponse)
        clearTimeout(timer)
        cb()
      }

      const handleResponse = (event: MessageEvent) => {
        const message = event.data
        if (message.type === "grpc_response" && message.grpc_response?.request_id === requestId) {
          if (message.grpc_response.error) {
            finalize(() => reject(new Error(message.grpc_response.error)))
          } else if (message.grpc_response.message !== undefined) {
            finalize(() => resolve(message.grpc_response.message as TResponse))
          } else {
            finalize(() => reject(new Error("Empty response")))
          }
        }
      }

      const timer = window.setTimeout(() => {
        finalize(() => reject(new Error(`Request timeout after ${timeoutMs}ms`)))
      }, timeoutMs)

      window.addEventListener("message", handleResponse)
      vscodeApi.postMessage({
        type: "grpc_request",
        grpc_request: {
          service: this.serviceName,
          method: methodName,
          message: request,
          request_id: requestId,
          is_streaming: false,
        },
      })
    })
  }

  static makeStreamingRequest<TResponse>(
    this: { serviceName: string },
    methodName: string,
    request: unknown,
    callbacks: Callbacks<TResponse>,
  ): () => void {
    const requestId = uuidv4()

    const handleResponse = (event: MessageEvent) => {
      const message = event.data
      if (message.type === "grpc_response" && message.grpc_response?.request_id === requestId) {
        if (message.grpc_response.error) {
          callbacks.onError(new Error(message.grpc_response.error))
          window.removeEventListener("message", handleResponse)
          return
        }
        if (message.grpc_response.message !== undefined) {
          callbacks.onResponse(message.grpc_response.message as TResponse)
        }
        if (message.grpc_response.is_streaming === false) {
          callbacks.onComplete()
          window.removeEventListener("message", handleResponse)
        }
      }
    }

    window.addEventListener("message", handleResponse)
    vscodeApi.postMessage({
      type: "grpc_request",
      grpc_request: {
        service: this.serviceName,
        method: methodName,
        message: request,
        request_id: requestId,
        is_streaming: true,
      },
    })

    // Return cancel function
    return () => {
      vscodeApi.postMessage({
        type: "grpc_request_cancel",
        grpc_request_cancel: { request_id: requestId },
      })
    }
  }
}
