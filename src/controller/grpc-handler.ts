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
        String(msg.featureKey ?? "") as "compute" | "adb" | "dbSystem" | "vcn" | "chat" | "objectStorage" | "bastion" | "speech",
        Array.isArray(msg.compartmentIds) ? msg.compartmentIds.map((id: unknown) => String(id ?? "")) : []
      );
      return {};
    },
    getProfileSecrets: async (c, msg) => c.getProfileSecrets(String(msg.profile ?? "DEFAULT")),
    switchProfile: async (c) => {
      await c.switchProfile();
      return {};
    },
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
  SqlWorkbenchService: {
    testAdbConnection: async (c, msg) => c.testAdbConnection(msg),
    testDbSystemConnection: async (c, msg) => c.testDbSystemConnection(msg),
    explainAdbSqlPlan: async (c, msg) => c.explainAdbSqlPlan(msg),
    explainDbSystemSqlPlan: async (c, msg) => c.explainDbSystemSqlPlan(msg),
    requestSqlAssistant: async (c, msg) => c.requestSqlAssistant(msg),
    saveSqlFavorite: async (c, msg) => {
      await c.saveSqlFavorite(msg);
      showStatusMessage("SQL favorite saved.");
      return {};
    },
    deleteSqlFavorite: async (c, msg) => {
      await c.deleteSqlFavorite(msg);
      showStatusMessage("SQL favorite deleted.");
      return {};
    },
    clearSqlHistory: async (c) => {
      await c.clearSqlHistory();
      showStatusMessage("SQL history cleared.");
      return {};
    },
  },
  ResourceService: {
    listCompute: async (c) => ({ instances: await c.listComputeInstances() }),
    listBastionTargetInstances: async (c, msg) => c.listBastionTargetInstances(msg),
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
    listSpeechBuckets: async (c) => ({ buckets: await c.listSpeechBuckets() }),
    listSpeechObjects: async (c, msg) => c.listSpeechObjects(msg),
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
    readObjectStorageObjectText: async (c, msg) => c.readObjectStorageObjectText(msg),
    deleteObjectStorageObject: async (c, msg) => {
      await c.deleteObjectStorageObject(msg);
      showStatusMessage("Object deleted.");
      return {};
    },
    createObjectStoragePar: async (c, msg) => {
      const result = await c.createObjectStoragePar(msg);
      showStatusMessage("Pre-authenticated request created.");
      return result;
    },
    listSpeechTranscriptionJobs: async (c) => c.listSpeechTranscriptionJobs(),
    getSpeechTranscriptionJob: async (c, msg) => c.getSpeechTranscriptionJob(String(msg.transcriptionJobId ?? "")),
    createSpeechTranscriptionJob: async (c, msg) => {
      const result = await c.createSpeechTranscriptionJob(msg);
      showStatusMessage("Speech transcription job created.");
      return result;
    },
    cancelSpeechTranscriptionJob: async (c, msg) => {
      await c.cancelSpeechTranscriptionJob(String(msg.transcriptionJobId ?? ""));
      showStatusMessage("Speech transcription job cancellation requested.");
      return {};
    },
    deleteSpeechTranscriptionJob: async (c, msg) => {
      await c.deleteSpeechTranscriptionJob(String(msg.transcriptionJobId ?? ""));
      showStatusMessage("Speech transcription job deleted.");
      return {};
    },
    listSpeechTranscriptionTasks: async (c, msg) => c.listSpeechTranscriptionTasks(String(msg.transcriptionJobId ?? "")),
    listBastions: async (c) => c.listBastions(),
    listBastionSessions: async (c, msg) => c.listBastionSessions(msg),
    createBastionSession: async (c, msg) => {
      await c.createBastionSession(msg);
      showStatusMessage("Bastion session creation requested.");
      return {};
    },
    deleteBastionSession: async (c, msg) => {
      await c.deleteBastionSession(msg);
      showStatusMessage("Bastion session deleted.");
      return {};
    },
    runBastionSshCommand: async (c, msg) => c.runBastionSshCommand(msg),
  },
  McpService: {
    listServers: async (c) => ({ servers: c.getMcpServers() }),
    addServer: async (c, msg) => {
      await c.addMcpServer(msg);
      showStatusMessage("MCP server added.");
      return {};
    },
    updateServer: async (c, msg) => {
      await c.updateMcpServer({
        currentName: String(msg.currentName ?? ""),
        name: String(msg.name ?? ""),
        config: msg.config,
      });
      showStatusMessage("MCP server updated.");
      return {};
    },
    removeServer: async (c, msg) => {
      await c.removeMcpServer(String(msg.name ?? ""));
      showStatusMessage("MCP server removed.");
      return {};
    },
    toggleServer: async (c, msg) => {
      await c.toggleMcpServer(String(msg.name ?? ""), Boolean(msg.enabled));
      return {};
    },
    restartServer: async (c, msg) => {
      await c.restartMcpServer(String(msg.name ?? ""));
      showStatusMessage("MCP server restarted.");
      return {};
    },
    toggleToolAutoApprove: async (c, msg) => {
      await c.toggleMcpToolAutoApprove(msg);
      return {};
    },
    previewPrompt: async (c, msg) => c.previewMcpPrompt({
      serverName: String(msg.serverName ?? ""),
      promptName: String(msg.promptName ?? ""),
      args: msg.args as Record<string, string> | undefined,
    }),
    previewResource: async (c, msg) => c.previewMcpResource({
      serverName: String(msg.serverName ?? ""),
      uri: String(msg.uri ?? ""),
    }),
    runSmokeTest: async (c) => c.runMcpSmokeTest(),
  },
  AgentService: {
    getSettings: async (c) => c.getAgentSettings(),
    saveSettings: async (c, msg) => {
      await c.saveAgentSettings(msg);
      showStatusMessage("Agent settings saved.");
      return {};
    },
    approveToolCall: async (c, msg) => {
      c.resolveToolApproval({ callId: String(msg.callId ?? ""), approved: true, alwaysAllow: Boolean(msg.alwaysAllow) });
      return {};
    },
    denyToolCall: async (c, msg) => {
      c.resolveToolApproval({ callId: String(msg.callId ?? ""), approved: false });
      return {};
    },
  },
  SkillService: {
    listSkills: async (c) => c.getAgentSkills(),
    getSkillsOverview: async (c) => c.getAgentSkillsOverview(),
    getSkillsDiagnosticReport: async (c) => c.getAgentSkillsDiagnosticReport(),
    getSkillInfoReport: async (c, msg) => {
      const report = c.getAgentSkillInfoReport(String(msg.skillRef ?? ""))
      if (!report) {
        throw new Error(`Skill "${String(msg.skillRef ?? "")}" was not found.`)
      }
      return report
    },
    getSkillsCheckReport: async (c) => c.getAgentSkillsCheckReport(),
    openSkillFindingLocation: async (c, msg) =>
      c.openAgentSkillFindingLocation(String(msg.file ?? ""), Number(msg.line ?? 1)),
    addSkillSuppression: async (c, msg) => {
      await c.addAgentSkillSuppression({
        scope: String(msg.scope ?? "") as "rule" | "file" | "rule-file",
        ruleId: typeof msg.ruleId === "string" ? msg.ruleId : undefined,
        file: typeof msg.file === "string" ? msg.file : undefined,
        note: typeof msg.note === "string" ? msg.note : undefined,
      })
      return {}
    },
    removeSkillSuppression: async (c, msg) => {
      await c.removeAgentSkillSuppression({
        scope: String(msg.scope ?? "") as "rule" | "file" | "rule-file",
        ruleId: typeof msg.ruleId === "string" ? msg.ruleId : undefined,
        file: typeof msg.file === "string" ? msg.file : undefined,
      })
      return {}
    },
    setSkillSuppressions: async (c, msg) => {
      await c.setAgentSkillSuppressions(
        Array.isArray(msg.suppressions) ? (msg.suppressions as import("../shared/mcp-types").AgentSkillSuppression[]) : [],
      )
      return {}
    },
    refreshSkills: async (c) => {
      await c.refreshAgentSkills();
      showStatusMessage("Agent skills refreshed.");
      return {};
    },
    toggleSkill: async (c, msg) => {
      await c.toggleAgentSkill(String(msg.skillId ?? ""), Boolean(msg.enabled));
      return {};
    },
    installSkill: async (c, msg) => {
      const result = await c.installAgentSkill(
        String(msg.skillId ?? ""),
        typeof msg.installerId === "string" ? msg.installerId : undefined,
        Boolean(msg.allowHighRisk),
      );
      showStatusMessage(result.ok ? "Agent skill installed." : "Agent skill install failed.");
      return result;
    },
    importSkillFromSource: async (c, msg) => {
      const result = await c.importAgentSkillFromSource(
        String(msg.source ?? ""),
        String(msg.scope ?? "workspace") === "user" ? "user" : "workspace",
        Boolean(msg.replaceExisting),
        Boolean(msg.allowHighRisk),
      );
      showStatusMessage(result.ok ? "External skill imported." : "External skill import failed.");
      return result;
    },
    pickImportSource: async (c) => c.pickAgentSkillImportSource(),
  },
  SubagentService: {
    sendMessage: async (c, msg) => {
      await c.sendSubagentMessage({
        runId: String(msg.runId ?? ""),
        message: String(msg.message ?? ""),
      });
      showStatusMessage("Subagent message queued.");
      return {};
    },
    steer: async (c, msg) => {
      await c.steerSubagent({
        runId: String(msg.runId ?? ""),
        message: String(msg.message ?? ""),
      });
      showStatusMessage("Subagent steering queued.");
      return {};
    },
    kill: async (c, msg) => {
      await c.killSubagent({
        runId: String(msg.runId ?? ""),
      });
      showStatusMessage("Subagent cancelled.");
      return {};
    },
    getTranscript: async (c, msg) => c.getSubagentTranscript({
      runId: String(msg.runId ?? ""),
    }),
  },
  OcaProxyService: {
    getOcaProxyStatus: async (c) => c.getOcaProxyStatus(),
    startOcaAuth: async (c) => {
      await c.startOcaAuth();
      return {};
    },
    logoutOca: async (c) => {
      await c.logoutOca();
      return {};
    },
    fetchOcaModels: async (c) => c.fetchOcaModels(),
    saveOcaProxyConfig: async (c, msg) => {
      await c.saveOcaProxyConfig(msg);
      vscode.window.showInformationMessage("Settings saved.");
      return {};
    },
    generateOcaApiKey: async (c) => c.generateOcaApiKey(),
    startOcaProxy: async (c) => {
      await c.startOcaProxy();
      showStatusMessage("OCA Proxy started.");
      return {};
    },
    stopOcaProxy: async (c) => {
      await c.stopOcaProxy();
      showStatusMessage("OCA Proxy stopped.");
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
  McpService: {
    subscribeToServers: async (c, _msg, stream, requestId) => {
      c.subscribeToMcpServers(requestId, stream);
    },
  },
  SkillService: {
    subscribeToSkills: async (c, _msg, stream, requestId) => {
      c.subscribeToAgentSkills(requestId, stream);
    },
    subscribeToSkillsOverview: async (c, _msg, stream, requestId) => {
      c.subscribeToAgentSkillsOverview(requestId, stream);
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
