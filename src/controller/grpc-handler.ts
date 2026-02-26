import { Controller, type PostMessageToWebview } from "./index";
import type { GrpcRequest, ExtensionMessage } from "../shared/messages";
import type { StreamTokenResponse } from "../shared/services";

type StreamingResponseHandler<T> = (response: T, isLast?: boolean) => Promise<void>;

/** Handle a gRPC request from the webview */
export async function handleGrpcRequest(
  controller: Controller,
  postMessageToWebview: PostMessageToWebview,
  request: GrpcRequest
): Promise<void> {
  if (request.is_streaming) {
    await handleStreamingRequest(controller, postMessageToWebview, request);
  } else {
    await handleUnaryRequest(controller, postMessageToWebview, request);
  }
}

/** Handle a gRPC cancellation from the webview */
export async function handleGrpcRequestCancel(
  controller: Controller,
  postMessageToWebview: PostMessageToWebview,
  requestId: string
): Promise<void> {
  const cancelled = controller.cancelRequest(requestId);
  if (cancelled) {
    await postMessageToWebview({
      type: "grpc_response",
      grpc_response: {
        request_id: requestId,
        is_streaming: false,
      },
    });
  }
}

async function handleUnaryRequest(
  controller: Controller,
  postMessageToWebview: PostMessageToWebview,
  request: GrpcRequest
): Promise<void> {
  try {
    const handler = getUnaryHandler(request.service, request.method);
    const response = await handler(controller, request.message);
    await postMessageToWebview({
      type: "grpc_response",
      grpc_response: {
        message: response,
        request_id: request.request_id,
      },
    });
  } catch (error) {
    await postMessageToWebview({
      type: "grpc_response",
      grpc_response: {
        error:
          error instanceof Error
            ? error.message
            : error && typeof error === "object" && "message" in error
              ? String((error as any).message)
              : typeof error === "object"
                ? JSON.stringify(error)
                : String(error),
        request_id: request.request_id,
        is_streaming: false,
      },
    });
  }
}

async function handleStreamingRequest(
  controller: Controller,
  postMessageToWebview: PostMessageToWebview,
  request: GrpcRequest
): Promise<void> {
  const responseStream: StreamingResponseHandler<any> = async (response: any, isLast = false) => {
    await postMessageToWebview({
      type: "grpc_response",
      grpc_response: {
        message: response,
        request_id: request.request_id,
        is_streaming: !isLast,
      },
    });
  };

  try {
    const handler = getStreamingHandler(request.service, request.method);
    await handler(controller, request.message, responseStream, request.request_id);
  } catch (error) {
    await postMessageToWebview({
      type: "grpc_response",
      grpc_response: {
        error:
          error instanceof Error
            ? error.message
            : error && typeof error === "object" && "message" in error
              ? String((error as any).message)
              : typeof error === "object"
                ? JSON.stringify(error)
                : String(error),
        request_id: request.request_id,
        is_streaming: false,
      },
    });
  }
}

// --- Service handler registry ---

type UnaryHandler = (controller: Controller, message: any) => Promise<any>;
type StreamHandler = (
  controller: Controller,
  message: any,
  responseStream: StreamingResponseHandler<any>,
  requestId: string
) => Promise<void>;

const unaryHandlers: Record<string, Record<string, UnaryHandler>> = {
  StateService: {
    getState: async (c) => c.getState(),
    getSettings: async (c) => c.getSettings(),
    saveSettings: async (c, msg) => {
      await c.saveSettings(msg);
      return {};
    },
    getProfileSecrets: async (c, msg) => c.getProfileSecrets(String(msg.profile ?? "DEFAULT")),
    switchCompartment: async (c, msg) => {
      await c.switchCompartment(msg.id);
      return {};
    },
    saveCompartment: async (c, msg) => {
      await c.saveCompartment(msg.name, msg.id);
      return {};
    },
    deleteCompartment: async (c, msg) => {
      await c.deleteCompartment(msg.id);
      return {};
    },
  },
  ChatService: {
    clearHistory: async (c) => {
      c.clearChatHistory();
      return {};
    },
  },
  ResourceService: {
    listCompute: async (c) => ({ instances: await c.listComputeInstances() }),
    startCompute: async (c, msg) => {
      await c.startComputeInstance(msg.instanceId, typeof msg.region === "string" ? msg.region : undefined);
      return {};
    },
    stopCompute: async (c, msg) => {
      await c.stopComputeInstance(msg.instanceId, typeof msg.region === "string" ? msg.region : undefined);
      return {};
    },
    connectComputeSsh: async (c, msg) => c.connectComputeSsh(msg),
    listAdb: async (c) => ({ databases: await c.listAutonomousDatabases() }),
    startAdb: async (c, msg) => {
      await c.startAutonomousDatabase(msg.autonomousDatabaseId, typeof msg.region === "string" ? msg.region : undefined);
      return {};
    },
    stopAdb: async (c, msg) => {
      await c.stopAutonomousDatabase(msg.autonomousDatabaseId, typeof msg.region === "string" ? msg.region : undefined);
      return {};
    },
    downloadAdbWallet: async (c, msg) => c.downloadAdbWallet(msg),
    connectAdb: async (c, msg) => c.connectAdb(msg),
    disconnectAdb: async (c, msg) => {
      await c.disconnectAdb(msg.connectionId);
      return {};
    },
    executeAdbSql: async (c, msg) => c.executeAdbSql(msg),
    saveAdbConnection: async (c, msg) => {
      await c.saveAdbConnection(msg);
      return {};
    },
    loadAdbConnection: async (c, msg) => {
      const result = await c.loadAdbConnection(String(msg.autonomousDatabaseId ?? ""));
      return result ?? {};
    },
    deleteAdbConnection: async (c, msg) => {
      await c.deleteAdbConnection(String(msg.autonomousDatabaseId ?? ""));
      return {};
    },
    listDbSystems: async (c) => ({ dbSystems: await c.listDbSystems() }),
    startDbSystem: async (c, msg) => {
      await c.startDbSystem(msg.dbSystemId, typeof msg.region === "string" ? msg.region : undefined);
      return {};
    },
    stopDbSystem: async (c, msg) => {
      await c.stopDbSystem(msg.dbSystemId, typeof msg.region === "string" ? msg.region : undefined);
      return {};
    },
    connectDbSystem: async (c, msg) => c.connectDbSystem(msg),
    connectDbSystemSsh: async (c, msg) => c.connectDbSystemSsh(msg),
    disconnectDbSystem: async (c, msg) => {
      await c.disconnectDbSystem(msg.connectionId);
      return {};
    },
    executeDbSystemSql: async (c, msg) => c.executeDbSystemSql(msg),
    saveDbSystemConnection: async (c, msg) => {
      await c.saveDbSystemConnection(msg);
      return {};
    },
    loadDbSystemConnection: async (c, msg) => {
      const result = await c.loadDbSystemConnection(String(msg.dbSystemId ?? ""));
      return result ?? {};
    },
    deleteDbSystemConnection: async (c, msg) => {
      await c.deleteDbSystemConnection(String(msg.dbSystemId ?? ""));
      return {};
    },
    listVcns: async (c) => ({ vcns: await c.listVcns() }),
    listSecurityLists: async (c, msg) => ({ securityLists: await c.listSecurityLists(msg.vcnId, msg.region) }),
    createSecurityList: async (c, msg) => {
      await c.createSecurityList(
        msg.compartmentId,
        msg.vcnId,
        msg.name,
        msg.ingressSecurityRules || [],
        msg.egressSecurityRules || [],
        msg.region
      );
      return {};
    },
    updateSecurityList: async (c, msg) => {
      await c.updateSecurityList(
        msg.securityListId,
        msg.ingressSecurityRules || [],
        msg.egressSecurityRules || [],
        msg.region
      );
      return {};
    },
    deleteSecurityList: async (c, msg) => {
      await c.deleteSecurityList(msg.securityListId, msg.region);
      return {};
    },
  },
};

const streamingHandlers: Record<string, Record<string, StreamHandler>> = {
  StateService: {
    subscribeToState: async (c, _msg, stream, requestId) => {
      c.subscribeToState(requestId, stream);
      // Keep the stream open - don't send final message
    },
  },
  ChatService: {
    sendMessage: async (c, msg, stream, requestId) => {
      await c.sendChatMessage(
        msg,
        stream as StreamingResponseHandler<StreamTokenResponse>,
        requestId
      );
    },
  },
  UiService: {
    subscribeToSettingsButtonClicked: async (c, _msg, stream, requestId) => {
      c.subscribeToSettingsButton(requestId, stream);
    },
    subscribeToChatButtonClicked: async (c, _msg, stream, requestId) => {
      c.subscribeToChatButton(requestId, stream);
    },
    subscribeToCodeContextReady: async (c, _msg, stream, requestId) => {
      c.subscribeToCodeContext(requestId, stream);
    },
  },
};

function getUnaryHandler(service: string, method: string): UnaryHandler {
  const serviceHandlers = unaryHandlers[service];
  if (!serviceHandlers) {
    throw new Error(`Unknown service: ${service}`);
  }
  const handler = serviceHandlers[method];
  if (!handler) {
    throw new Error(`Unknown unary method: ${service}.${method}`);
  }
  return handler;
}

function getStreamingHandler(service: string, method: string): StreamHandler {
  const serviceHandlers = streamingHandlers[service];
  if (!serviceHandlers) {
    throw new Error(`Unknown service: ${service}`);
  }
  const handler = serviceHandlers[method];
  if (!handler) {
    throw new Error(`Unknown streaming method: ${service}.${method}`);
  }
  return handler;
}
