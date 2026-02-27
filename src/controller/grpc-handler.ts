import * as vscode from "vscode";
import { Controller, type PostMessageToWebview } from "./index";
import type { GrpcRequest, ExtensionMessage } from "../shared/messages";
import type { StreamTokenResponse } from "../shared/services";

/** Display a status bar message with timeout (half of default notification duration) */
const STATUS_MESSAGE_TIMEOUT_MS = 2500;
function showStatusMessage(message: string): void {
  vscode.window.setStatusBarMessage(`$(info) ${message}`, STATUS_MESSAGE_TIMEOUT_MS);
}

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
    deleteProfile: async (c, msg) => {
      await c.deleteProfile(String(msg.profile ?? ""));
      return {};
    },
    updateFeatureCompartmentSelection: async (c, msg) => {
      await c.updateFeatureCompartmentSelection(
        String(msg.featureKey ?? "") as "compute" | "adb" | "dbSystem" | "vcn" | "chat" | "objectStorage",
        Array.isArray(msg.compartmentIds) ? msg.compartmentIds.map((id: unknown) => String(id ?? "")) : []
      );
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
      showStatusMessage("Compute instance start requested.");
      return {};
    },
    stopCompute: async (c, msg) => {
      await c.stopComputeInstance(msg.instanceId, typeof msg.region === "string" ? msg.region : undefined);
      showStatusMessage("Compute instance stop requested.");
      return {};
    },
    connectComputeSsh: async (c, msg) => c.connectComputeSsh(msg),
    listAdb: async (c) => ({ databases: await c.listAutonomousDatabases() }),
    startAdb: async (c, msg) => {
      await c.startAutonomousDatabase(msg.autonomousDatabaseId, typeof msg.region === "string" ? msg.region : undefined);
      showStatusMessage("Autonomous Database start requested.");
      return {};
    },
    stopAdb: async (c, msg) => {
      await c.stopAutonomousDatabase(msg.autonomousDatabaseId, typeof msg.region === "string" ? msg.region : undefined);
      showStatusMessage("Autonomous Database stop requested.");
      return {};
    },
    downloadAdbWallet: async (c, msg) => {
      const result = await c.downloadAdbWallet(msg);
      showStatusMessage("ADB wallet downloaded.");
      return result;
    },
    connectAdb: async (c, msg) => {
      const result = await c.connectAdb(msg);
      showStatusMessage("ADB connected.");
      return result;
    },
    disconnectAdb: async (c, msg) => {
      await c.disconnectAdb(msg.connectionId);
      showStatusMessage("ADB disconnected.");
      return {};
    },
    executeAdbSql: async (c, msg) => c.executeAdbSql(msg),
    saveAdbConnection: async (c, msg) => {
      await c.saveAdbConnection(msg);
      showStatusMessage("ADB connection saved.");
      return {};
    },
    loadAdbConnection: async (c, msg) => {
      const result = await c.loadAdbConnection(String(msg.autonomousDatabaseId ?? ""));
      return result ?? {};
    },
    deleteAdbConnection: async (c, msg) => {
      await c.deleteAdbConnection(String(msg.autonomousDatabaseId ?? ""));
      showStatusMessage("ADB connection deleted.");
      return {};
    },
    listDbSystems: async (c) => ({ dbSystems: await c.listDbSystems() }),
    startDbSystem: async (c, msg) => {
      await c.startDbSystem(msg.dbSystemId, typeof msg.region === "string" ? msg.region : undefined);
      showStatusMessage("DB System start requested.");
      return {};
    },
    stopDbSystem: async (c, msg) => {
      await c.stopDbSystem(msg.dbSystemId, typeof msg.region === "string" ? msg.region : undefined);
      showStatusMessage("DB System stop requested.");
      return {};
    },
    connectDbSystem: async (c, msg) => {
      const result = await c.connectDbSystem(msg);
      showStatusMessage("DB System connected.");
      return result;
    },
    connectDbSystemSsh: async (c, msg) => c.connectDbSystemSsh(msg),
    disconnectDbSystem: async (c, msg) => {
      await c.disconnectDbSystem(msg.connectionId);
      showStatusMessage("DB System disconnected.");
      return {};
    },
    executeDbSystemSql: async (c, msg) => c.executeDbSystemSql(msg),
    getOracleDbDiagnostics: async (c) => c.getOracleDbDiagnostics(),
    saveDbSystemConnection: async (c, msg) => {
      await c.saveDbSystemConnection(msg);
      showStatusMessage("DB System connection saved.");
      return {};
    },
    getDbSystemConnectionStrings: async (c, msg) => c.getDbSystemConnectionStrings(msg),
    loadDbSystemConnection: async (c, msg) => {
      const result = await c.loadDbSystemConnection(String(msg.dbSystemId ?? ""));
      return result ?? {};
    },
    deleteDbSystemConnection: async (c, msg) => {
      await c.deleteDbSystemConnection(String(msg.dbSystemId ?? ""));
      showStatusMessage("DB System connection deleted.");
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
      showStatusMessage("Security List created.");
      return {};
    },
    updateSecurityList: async (c, msg) => {
      await c.updateSecurityList(
        msg.securityListId,
        msg.ingressSecurityRules || [],
        msg.egressSecurityRules || [],
        msg.region
      );
      showStatusMessage("Security List updated.");
      return {};
    },
    deleteSecurityList: async (c, msg) => {
      await c.deleteSecurityList(msg.securityListId, msg.region);
      showStatusMessage("Security List deleted.");
      return {};
    },
    listObjectStorageBuckets: async (c) => ({ buckets: await c.listObjectStorageBuckets() }),
    listObjectStorageObjects: async (c, msg) => c.listObjectStorageObjects(msg),
    uploadObjectStorageObject: async (c, msg) => {
      const result = await c.uploadObjectStorageObject(msg);
      if (!result.cancelled) {
        showStatusMessage("Object uploaded.");
      }
      return result;
    },
    downloadObjectStorageObject: async (c, msg) => {
      const result = await c.downloadObjectStorageObject(msg);
      if (!result.cancelled) {
        showStatusMessage("Object downloaded.");
      }
      return result;
    },
    createObjectStoragePar: async (c, msg) => {
      const result = await c.createObjectStoragePar(msg);
      showStatusMessage("Pre-authenticated request created.");
      return result;
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
