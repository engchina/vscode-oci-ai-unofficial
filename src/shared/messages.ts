/** Messages from webview to extension */
export type WebviewMessage =
  | { type: "grpc_request"; grpc_request: GrpcRequest }
  | { type: "grpc_request_cancel"; grpc_request_cancel: { request_id: string } };

export interface GrpcRequest {
  service: string;
  method: string;
  message: any;
  request_id: string;
  is_streaming: boolean;
}

/** Messages from extension to webview */
export interface ExtensionMessage {
  type: "grpc_response";
  grpc_response: {
    message?: any;
    request_id: string;
    error?: string;
    is_streaming?: boolean;
    sequence_number?: number;
  };
}
