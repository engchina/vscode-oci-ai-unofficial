import type {
  AppState,
  ConnectComputeSshRequest,
  ConnectComputeSshResponse,
  CodeContextPayload,
  ConnectAdbRequest,
  ConnectAdbResponse,
  DeleteProfileRequest,
  DownloadAdbWalletRequest,
  DownloadAdbWalletResponse,
  ExplainSqlPlanRequest,
  ExplainSqlPlanResponse,
  ExecuteAdbSqlRequest,
  ExecuteAdbSqlResponse,
  ListAdbResponse,
  ListComputeResponse,
  LoadAdbConnectionResponse,
  ProfileSecretsResponse,
  SaveAdbConnectionRequest,
  SaveSqlFavoriteRequest,
  SaveSettingsRequest,
  SendMessageRequest,
  SettingsState,
  SqlAssistantRequest,
  SqlAssistantResponse,
  StreamTokenResponse,
  TestSqlConnectionResponse,
  ListVcnResponse,
  ListSecurityListRequest,
  ListSecurityListResponse,
  UpdateSecurityListRequest,
  CreateSecurityListRequest,
  DeleteSecurityListRequest,
  ConnectDbSystemRequest,
  ConnectDbSystemResponse,
  ConnectDbSystemSshRequest,
  ConnectDbSystemSshResponse,
  ExecuteDbSystemSqlRequest,
  ListDbSystemsResponse,
  LoadDbSystemConnectionResponse,
  SaveDbSystemConnectionRequest,
  GetDbSystemConnectionStringsRequest,
  GetDbSystemConnectionStringsResponse,
  OracleDbDiagnosticsResponse,
  ListObjectStorageBucketsResponse,
  ListObjectStorageObjectsRequest,
  ListObjectStorageObjectsResponse,
  UploadObjectStorageObjectRequest,
  UploadObjectStorageObjectResponse,
  DownloadObjectStorageObjectRequest,
  DownloadObjectStorageObjectResponse,
  CreateObjectStorageParRequest,
  CreateObjectStorageParResponse,
  DeleteSqlFavoriteRequest,
} from "./types"
import { type Callbacks, ProtoBusClient } from "./grpc-client-base"

export class StateServiceClient extends ProtoBusClient {
  static override serviceName = "StateService"

  static getState(): Promise<AppState> {
    return this.makeUnaryRequest<AppState>("getState", {})
  }

  static getSettings(): Promise<SettingsState> {
    return this.makeUnaryRequest<SettingsState>("getSettings", {})
  }

  static saveSettings(request: SaveSettingsRequest): Promise<void> {
    return this.makeUnaryRequest<void>("saveSettings", request)
  }

  static deleteProfile(profile: string): Promise<void> {
    const request: DeleteProfileRequest = { profile }
    return this.makeUnaryRequest<void>("deleteProfile", request)
  }

  static updateFeatureCompartmentSelection(
    featureKey: "compute" | "adb" | "dbSystem" | "vcn" | "chat" | "objectStorage",
    compartmentIds: string[],
  ): Promise<void> {
    return this.makeUnaryRequest<void>("updateFeatureCompartmentSelection", { featureKey, compartmentIds })
  }

  static getProfileSecrets(profile: string): Promise<ProfileSecretsResponse> {
    return this.makeUnaryRequest<ProfileSecretsResponse>("getProfileSecrets", { profile })
  }

  static switchCompartment(id: string): Promise<void> {
    return this.makeUnaryRequest<void>("switchCompartment", { id })
  }

  static saveCompartment(name: string, id: string): Promise<void> {
    return this.makeUnaryRequest<void>("saveCompartment", { name, id })
  }

  static deleteCompartment(id: string): Promise<void> {
    return this.makeUnaryRequest<void>("deleteCompartment", { id })
  }

  static subscribeToState(callbacks: Callbacks<AppState>): () => void {
    return this.makeStreamingRequest<AppState>("subscribeToState", {}, callbacks)
  }
}

export class ChatServiceClient extends ProtoBusClient {
  static override serviceName = "ChatService"

  static sendMessage(request: SendMessageRequest, callbacks: Callbacks<StreamTokenResponse>): () => void {
    return this.makeStreamingRequest<StreamTokenResponse>("sendMessage", request, callbacks)
  }

  static clearHistory(): Promise<void> {
    return this.makeUnaryRequest<void>("clearHistory", {})
  }
}

export class UiServiceClient extends ProtoBusClient {
  static override serviceName = "UiService"

  static subscribeToSettingsButtonClicked(callbacks: Callbacks<unknown>): () => void {
    return this.makeStreamingRequest<unknown>("subscribeToSettingsButtonClicked", {}, callbacks)
  }

  static subscribeToChatButtonClicked(callbacks: Callbacks<unknown>): () => void {
    return this.makeStreamingRequest<unknown>("subscribeToChatButtonClicked", {}, callbacks)
  }

  static subscribeToCodeContextReady(callbacks: Callbacks<CodeContextPayload>): () => void {
    return this.makeStreamingRequest<CodeContextPayload>("subscribeToCodeContextReady", {}, callbacks)
  }
}

export class SqlWorkbenchServiceClient extends ProtoBusClient {
  static override serviceName = "SqlWorkbenchService"

  static testAdbConnection(request: ConnectAdbRequest): Promise<TestSqlConnectionResponse> {
    return this.makeUnaryRequest<TestSqlConnectionResponse>("testAdbConnection", request, 120000)
  }

  static testDbSystemConnection(request: ConnectDbSystemRequest): Promise<TestSqlConnectionResponse> {
    return this.makeUnaryRequest<TestSqlConnectionResponse>("testDbSystemConnection", request, 120000)
  }

  static explainAdbSqlPlan(request: ExplainSqlPlanRequest): Promise<ExplainSqlPlanResponse> {
    return this.makeUnaryRequest<ExplainSqlPlanResponse>("explainAdbSqlPlan", request, 120000)
  }

  static explainDbSystemSqlPlan(request: ExplainSqlPlanRequest): Promise<ExplainSqlPlanResponse> {
    return this.makeUnaryRequest<ExplainSqlPlanResponse>("explainDbSystemSqlPlan", request, 120000)
  }

  static requestSqlAssistant(request: SqlAssistantRequest): Promise<SqlAssistantResponse> {
    return this.makeUnaryRequest<SqlAssistantResponse>("requestSqlAssistant", request, 120000)
  }

  static saveSqlFavorite(request: SaveSqlFavoriteRequest): Promise<void> {
    return this.makeUnaryRequest<void>("saveSqlFavorite", request)
  }

  static deleteSqlFavorite(request: DeleteSqlFavoriteRequest): Promise<void> {
    return this.makeUnaryRequest<void>("deleteSqlFavorite", request)
  }

  static clearSqlHistory(): Promise<void> {
    return this.makeUnaryRequest<void>("clearSqlHistory", {})
  }
}

export class ResourceServiceClient extends ProtoBusClient {
  static override serviceName = "ResourceService"

  static listCompute(): Promise<ListComputeResponse> {
    return this.makeUnaryRequest<ListComputeResponse>("listCompute", {})
  }

  static startCompute(instanceId: string, region?: string): Promise<void> {
    return this.makeUnaryRequest<void>("startCompute", { instanceId, region })
  }

  static stopCompute(instanceId: string, region?: string): Promise<void> {
    return this.makeUnaryRequest<void>("stopCompute", { instanceId, region })
  }

  static connectComputeSsh(request: ConnectComputeSshRequest): Promise<ConnectComputeSshResponse> {
    return this.makeUnaryRequest<ConnectComputeSshResponse>("connectComputeSsh", request)
  }

  static listAdb(): Promise<ListAdbResponse> {
    return this.makeUnaryRequest<ListAdbResponse>("listAdb", {})
  }

  static startAdb(autonomousDatabaseId: string, region?: string): Promise<void> {
    return this.makeUnaryRequest<void>("startAdb", { autonomousDatabaseId, region })
  }

  static stopAdb(autonomousDatabaseId: string, region?: string): Promise<void> {
    return this.makeUnaryRequest<void>("stopAdb", { autonomousDatabaseId, region })
  }

  static downloadAdbWallet(request: DownloadAdbWalletRequest): Promise<DownloadAdbWalletResponse> {
    return this.makeUnaryRequest<DownloadAdbWalletResponse>("downloadAdbWallet", request)
  }

  static connectAdb(request: ConnectAdbRequest): Promise<ConnectAdbResponse> {
    return this.makeUnaryRequest<ConnectAdbResponse>("connectAdb", request)
  }

  static disconnectAdb(connectionId: string): Promise<void> {
    return this.makeUnaryRequest<void>("disconnectAdb", { connectionId })
  }

  static executeAdbSql(request: ExecuteAdbSqlRequest): Promise<ExecuteAdbSqlResponse> {
    return this.makeUnaryRequest<ExecuteAdbSqlResponse>("executeAdbSql", request, 120000)
  }

  static saveAdbConnection(request: SaveAdbConnectionRequest): Promise<void> {
    return this.makeUnaryRequest<void>("saveAdbConnection", request)
  }

  static loadAdbConnection(autonomousDatabaseId: string): Promise<LoadAdbConnectionResponse> {
    return this.makeUnaryRequest<LoadAdbConnectionResponse>("loadAdbConnection", { autonomousDatabaseId })
  }

  static deleteAdbConnection(autonomousDatabaseId: string): Promise<void> {
    return this.makeUnaryRequest<void>("deleteAdbConnection", { autonomousDatabaseId })
  }

  static listDbSystems(): Promise<ListDbSystemsResponse> {
    return this.makeUnaryRequest<ListDbSystemsResponse>("listDbSystems", {})
  }

  static startDbSystem(dbSystemId: string, region?: string): Promise<void> {
    return this.makeUnaryRequest<void>("startDbSystem", { dbSystemId, region })
  }

  static stopDbSystem(dbSystemId: string, region?: string): Promise<void> {
    return this.makeUnaryRequest<void>("stopDbSystem", { dbSystemId, region })
  }

  static connectDbSystem(request: ConnectDbSystemRequest): Promise<ConnectDbSystemResponse> {
    return this.makeUnaryRequest<ConnectDbSystemResponse>("connectDbSystem", request)
  }

  static connectDbSystemSsh(request: ConnectDbSystemSshRequest): Promise<ConnectDbSystemSshResponse> {
    return this.makeUnaryRequest<ConnectDbSystemSshResponse>("connectDbSystemSsh", request)
  }

  static disconnectDbSystem(connectionId: string): Promise<void> {
    return this.makeUnaryRequest<void>("disconnectDbSystem", { connectionId })
  }

  static executeDbSystemSql(request: ExecuteDbSystemSqlRequest): Promise<ExecuteAdbSqlResponse> {
    return this.makeUnaryRequest<ExecuteAdbSqlResponse>("executeDbSystemSql", request, 120000)
  }

  static saveDbSystemConnection(request: SaveDbSystemConnectionRequest): Promise<void> {
    return this.makeUnaryRequest<void>("saveDbSystemConnection", request)
  }

  static loadDbSystemConnection(dbSystemId: string): Promise<LoadDbSystemConnectionResponse> {
    return this.makeUnaryRequest<LoadDbSystemConnectionResponse>("loadDbSystemConnection", { dbSystemId })
  }

  static deleteDbSystemConnection(dbSystemId: string): Promise<void> {
    return this.makeUnaryRequest<void>("deleteDbSystemConnection", { dbSystemId })
  }

  static getDbSystemConnectionStrings(request: GetDbSystemConnectionStringsRequest): Promise<GetDbSystemConnectionStringsResponse> {
    return this.makeUnaryRequest<GetDbSystemConnectionStringsResponse>("getDbSystemConnectionStrings", request)
  }

  static getOracleDbDiagnostics(): Promise<OracleDbDiagnosticsResponse> {
    return this.makeUnaryRequest<OracleDbDiagnosticsResponse>("getOracleDbDiagnostics", {})
  }

  static listVcns(): Promise<ListVcnResponse> {
    return this.makeUnaryRequest<ListVcnResponse>("listVcns", {})
  }

  static listSecurityLists(request: ListSecurityListRequest): Promise<ListSecurityListResponse> {
    return this.makeUnaryRequest<ListSecurityListResponse>("listSecurityLists", request)
  }

  static createSecurityList(request: CreateSecurityListRequest): Promise<void> {
    return this.makeUnaryRequest<void>("createSecurityList", request)
  }

  static updateSecurityList(request: UpdateSecurityListRequest): Promise<void> {
    return this.makeUnaryRequest<void>("updateSecurityList", request)
  }

  static deleteSecurityList(request: DeleteSecurityListRequest): Promise<void> {
    return this.makeUnaryRequest<void>("deleteSecurityList", request)
  }

  static listObjectStorageBuckets(): Promise<ListObjectStorageBucketsResponse> {
    return this.makeUnaryRequest<ListObjectStorageBucketsResponse>("listObjectStorageBuckets", {})
  }

  static listObjectStorageObjects(request: ListObjectStorageObjectsRequest): Promise<ListObjectStorageObjectsResponse> {
    return this.makeUnaryRequest<ListObjectStorageObjectsResponse>("listObjectStorageObjects", request)
  }

  static uploadObjectStorageObject(request: UploadObjectStorageObjectRequest): Promise<UploadObjectStorageObjectResponse> {
    return this.makeUnaryRequest<UploadObjectStorageObjectResponse>("uploadObjectStorageObject", request, 120000)
  }

  static downloadObjectStorageObject(request: DownloadObjectStorageObjectRequest): Promise<DownloadObjectStorageObjectResponse> {
    return this.makeUnaryRequest<DownloadObjectStorageObjectResponse>("downloadObjectStorageObject", request, 120000)
  }

  static createObjectStoragePar(request: CreateObjectStorageParRequest): Promise<CreateObjectStorageParResponse> {
    return this.makeUnaryRequest<CreateObjectStorageParResponse>("createObjectStoragePar", request)
  }
}
