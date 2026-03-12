import * as vscode from "vscode";
import * as common from "oci-common";
import * as aispeech from "oci-aispeech";
import { Readable } from "stream";
import { OciClientFactory } from "./clientFactory";
import {
  AdbResource,
  ComputeResource,
  VcnResource,
  SecurityListResource,
  SecurityRule,
  DbSystemResource,
  ObjectStorageBucketResource,
  ObjectStorageObjectResource,
  BastionResource,
  BastionSessionResource,
  SpeechTranscriptionJobResource,
  SpeechTranscriptionTaskResource,
} from "../types";

export const OCI_SPEECH_REGION = "us-chicago-1";
const OCI_SPEECH_MAX_INPUT_OBJECTS = 100;
const OCI_SPEECH_MAX_WHISPER_PROMPT_LENGTH = 4000;
const OCI_SPEECH_AUTO_DISPLAY_NAME_SEED_LENGTH = 96;
const OCI_SPEECH_SUPPORTED_OBJECT_EXTENSIONS = new Set([
  "aac",
  "ac3",
  "amr",
  "au",
  "flac",
  "m4a",
  "mkv",
  "mp3",
  "mp4",
  "oga",
  "ogg",
  "opus",
  "wav",
  "webm",
]);

export class OciService {
  constructor(private readonly factory: OciClientFactory) { }

  public async listComputeInstances(): Promise<ComputeResource[]> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const compartmentIds = normalizeCompartmentIds(cfg.get<string[]>("computeCompartmentIds") || []);
    if (compartmentIds.length === 0) {
      return [];
    }
    return this.collectComputeInstances(compartmentIds, this.getActiveProfileRegions());
  }

  public async listComputeInstancesForBastionTargets(options: {
    compartmentIds: string[];
    region?: string;
    vcnId?: string;
    lifecycleStates?: string[];
  }): Promise<ComputeResource[]> {
    const compartmentIds = normalizeCompartmentIds(options.compartmentIds);
    if (compartmentIds.length === 0) {
      return [];
    }
    const requestedRegion = String(options.region ?? "").trim();
    const regions = requestedRegion ? [requestedRegion] : this.getActiveProfileRegions();
    const targetVcnId = String(options.vcnId ?? "").trim();
    const allowedLifecycleStates = new Set(
      (options.lifecycleStates || [])
        .map((value) => String(value ?? "").trim().toUpperCase())
        .filter((value) => value.length > 0)
    );
    const instances = await this.collectComputeInstances(compartmentIds, regions, { lifecycleStates: allowedLifecycleStates });
    const filtered = instances.filter((instance) => {
      if (targetVcnId && instance.vcnId !== targetVcnId) {
        return false;
      }
      return true;
    });
    const deduped = new Map<string, ComputeResource>();
    for (const instance of filtered) {
      if (!instance.id) {
        continue;
      }
      deduped.set(instance.id, instance);
    }
    return [...deduped.values()].sort(compareNamedOciResources);
  }

  public async startComputeInstance(instanceId: string, region?: string): Promise<void> {
    const client = await this.factory.createComputeClientAsync(region);
    await client.instanceAction({
      instanceId,
      action: "START"
    });
  }

  public async stopComputeInstance(instanceId: string, region?: string): Promise<void> {
    const client = await this.factory.createComputeClientAsync(region);
    await client.instanceAction({
      instanceId,
      action: "SOFTSTOP"
    });
  }

  public async listAutonomousDatabases(): Promise<AdbResource[]> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const compartmentIds = normalizeCompartmentIds(cfg.get<string[]>("adbCompartmentIds") || []);
    if (compartmentIds.length === 0) {
      return [];
    }
    const regions = this.getActiveProfileRegions();

    const databases: AdbResource[] = [];

    for (const region of regions) {
      const client = await this.factory.createDatabaseClientAsync(region);
      for (const compartmentId of compartmentIds) {
        let page: string | undefined;
        do {
          const result = await client.listAutonomousDatabases({ compartmentId, page });
          databases.push(
            ...(result.items || []).map((adb) => ({
              id: adb.id || "",
              name: adb.dbName || adb.displayName || adb.id || "Unnamed ADB",
              lifecycleState: (adb.lifecycleState as string) || "UNKNOWN",
              compartmentId,
              region,
            }))
          );
          page = result.opcNextPage;
        } while (page);
      }
    }

    return databases;
  }

  public async startAutonomousDatabase(autonomousDatabaseId: string, region?: string): Promise<void> {
    const client = await this.factory.createDatabaseClientAsync(region);
    await client.startAutonomousDatabase({ autonomousDatabaseId });
  }

  public async stopAutonomousDatabase(autonomousDatabaseId: string, region?: string): Promise<void> {
    const client = await this.factory.createDatabaseClientAsync(region);
    await client.stopAutonomousDatabase({ autonomousDatabaseId });
  }

  public async listDbSystems(): Promise<DbSystemResource[]> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const compartmentIds = normalizeCompartmentIds(cfg.get<string[]>("dbSystemCompartmentIds") || []);
    if (compartmentIds.length === 0) {
      return [];
    }
    const regions = this.getActiveProfileRegions();

    const dbSystems: DbSystemResource[] = [];

    for (const region of regions) {
      const dbClient = await this.factory.createDatabaseClientAsync(region);
      const vcnClient = await this.factory.createVirtualNetworkClientAsync(region);

      for (const compartmentId of compartmentIds) {
        let page: string | undefined;
        do {
          const result = await dbClient.listDbSystems({ compartmentId, page });
          const regionSystems = (result.items || []).map((sys) => ({
            id: sys.id || "",
            name: sys.displayName || sys.id || "Unnamed DB System",
            lifecycleState: (sys.lifecycleState as string) || "UNKNOWN",
            compartmentId,
            region,
          }));

          dbSystems.push(...regionSystems);

          await Promise.all(
            regionSystems.map((sys) =>
              this.populateDbSystemNetworkAddresses(sys, compartmentId, dbClient, vcnClient)
            )
          );

          page = result.opcNextPage;
        } while (page);
      }
    }

    return dbSystems;
  }

  public async startDbSystem(dbSystemId: string, region?: string): Promise<void> {
    const client = await this.factory.createDatabaseClientAsync(region);
    const dbSystem = await client.getDbSystem({ dbSystemId });
    const nodes = await client.listDbNodes({
      compartmentId: dbSystem.dbSystem.compartmentId || "",
      dbSystemId
    });
    for (const node of nodes.items || []) {
      if (node.id) {
        await client.dbNodeAction({ dbNodeId: node.id, action: "START" });
      }
    }
  }

  public async stopDbSystem(dbSystemId: string, region?: string): Promise<void> {
    const client = await this.factory.createDatabaseClientAsync(region);
    const dbSystem = await client.getDbSystem({ dbSystemId });
    const nodes = await client.listDbNodes({
      compartmentId: dbSystem.dbSystem.compartmentId || "",
      dbSystemId
    });
    for (const node of nodes.items || []) {
      if (node.id) {
        await client.dbNodeAction({ dbNodeId: node.id, action: "STOP" });
      }
    }
  }

  public async getDbSystemConnectionStrings(
    dbSystemId: string,
    compartmentId: string,
    region?: string,
    publicIp?: string
  ): Promise<{ name: string; value: string }[]> {
    const client = await this.factory.createDatabaseClientAsync(region);
    const normalizedPublicIp = String(publicIp ?? "").trim();

    let page: string | undefined;
    const dbHomes: string[] = [];
    do {
      const response = await client.listDbHomes({
        compartmentId,
        dbSystemId,
        page,
      });
      for (const home of response.items || []) {
        if (home.id) {
          dbHomes.push(home.id);
        }
      }
      page = response.opcNextPage;
    } while (page);

    const connectionMap = new Map<string, string>();
    const seenValues = new Set<string>();

    for (const dbHomeId of dbHomes) {
      let dbPage: string | undefined;
      do {
        const response = await client.listDatabases({
          compartmentId,
          dbHomeId,
          page: dbPage,
        });
        for (const db of response.items || []) {
          const dbLabel = sanitizeConnectionLabel(db.dbName || db.id || "database");
          const strings = db.connectionStrings;
          if (strings) {
            if (strings.cdbDefault) {
              addConnectionValue(connectionMap, seenValues, `${dbLabel}.cdbDefault`, strings.cdbDefault, normalizedPublicIp);
            }
            if (strings.cdbIpDefault) {
              addConnectionValue(connectionMap, seenValues, `${dbLabel}.cdbIpDefault`, strings.cdbIpDefault, normalizedPublicIp);
            }
            for (const [key, val] of Object.entries(strings.allConnectionStrings || {})) {
              if (val) {
                addConnectionValue(
                  connectionMap,
                  seenValues,
                  `${dbLabel}.all.${sanitizeConnectionLabel(key)}`,
                  val,
                  normalizedPublicIp
                );
              }
            }
          }

          if (db.id) {
            let pdbPage: string | undefined;
            do {
              try {
                const pdbs = await client.listPluggableDatabases({
                  compartmentId,
                  databaseId: db.id,
                  page: pdbPage,
                });
                for (const pdb of pdbs.items || []) {
                  const pdbLabel = sanitizeConnectionLabel(pdb.pdbName || pdb.id || dbLabel);
                  const pdbStrings = pdb.connectionStrings;
                  if (!pdbStrings) continue;

                  if (pdbStrings.pdbDefault) {
                    addConnectionValue(connectionMap, seenValues, `${pdbLabel}.pdbDefault`, pdbStrings.pdbDefault, normalizedPublicIp);
                  }
                  if (pdbStrings.pdbIpDefault) {
                    addConnectionValue(connectionMap, seenValues, `${pdbLabel}.pdbIpDefault`, pdbStrings.pdbIpDefault, normalizedPublicIp);
                  }
                  for (const [key, val] of Object.entries(pdbStrings.allConnectionStrings || {})) {
                    if (val) {
                      addConnectionValue(
                        connectionMap,
                        seenValues,
                        `${pdbLabel}.all.${sanitizeConnectionLabel(key)}`,
                        val,
                        normalizedPublicIp
                      );
                    }
                  }
                }
                pdbPage = pdbs.opcNextPage;
              } catch {
                pdbPage = undefined;
              }
            } while (pdbPage);
          }
        }
        dbPage = response.opcNextPage;
      } while (dbPage);
    }

    return Array.from(connectionMap.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  public async listVcns(): Promise<VcnResource[]> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const compartmentIds = normalizeCompartmentIds(cfg.get<string[]>("vcnCompartmentIds") || []);
    if (compartmentIds.length === 0) {
      return [];
    }
    const regions = this.getActiveProfileRegions();

    const vcns: VcnResource[] = [];

    for (const region of regions) {
      const client = await this.factory.createVirtualNetworkClientAsync(region);
      for (const compartmentId of compartmentIds) {
        let page: string | undefined;
        do {
          const result = await client.listVcns({ compartmentId, page });
          vcns.push(
            ...(result.items || []).map((vcn) => ({
              id: vcn.id || "",
              name: vcn.displayName || vcn.id || "Unnamed VCN",
              lifecycleState: (vcn.lifecycleState as string) || "UNKNOWN",
              // Use the resource's actual compartment whenever available.
              // Some list calls can still return resources outside the request compartment scope.
              compartmentId: vcn.compartmentId || compartmentId,
              region,
              cidrBlocks: vcn.cidrBlocks || [],
            }))
          );
          page = result.opcNextPage;
        } while (page);
      }
    }

    return vcns;
  }

  public async listSecurityLists(vcnId: string, region?: string): Promise<SecurityListResource[]> {
    const client = await this.factory.createVirtualNetworkClientAsync(region);
    const vcn = await client.getVcn({ vcnId });
    const compartmentId = vcn.vcn.compartmentId;

    const securityLists: SecurityListResource[] = [];
    let page: string | undefined;
    do {
      const result = await client.listSecurityLists({ compartmentId, vcnId, page });
      securityLists.push(
        ...(result.items || []).map((sl) => ({
          id: sl.id || "",
          name: sl.displayName || sl.id || "Unnamed Security List",
          lifecycleState: (sl.lifecycleState as string) || "UNKNOWN",
          compartmentId: sl.compartmentId || "",
          vcnId: sl.vcnId || "",
          region: region || "",
          ingressSecurityRules: sl.ingressSecurityRules as any,
          egressSecurityRules: sl.egressSecurityRules as any,
        }))
      );
      page = result.opcNextPage;
    } while (page);

    return securityLists;
  }

  public async updateSecurityList(
    securityListId: string,
    ingressSecurityRules: SecurityRule[],
    egressSecurityRules: SecurityRule[],
    region?: string
  ): Promise<void> {
    const client = await this.factory.createVirtualNetworkClientAsync(region);
    await client.updateSecurityList({
      securityListId,
      updateSecurityListDetails: {
        ingressSecurityRules: ingressSecurityRules as any,
        egressSecurityRules: egressSecurityRules as any,
      }
    });
  }

  public async createSecurityList(
    compartmentId: string,
    vcnId: string,
    name: string,
    ingressSecurityRules: SecurityRule[],
    egressSecurityRules: SecurityRule[],
    region?: string
  ): Promise<void> {
    const client = await this.factory.createVirtualNetworkClientAsync(region);
    await client.createSecurityList({
      createSecurityListDetails: {
        compartmentId,
        vcnId,
        displayName: name,
        ingressSecurityRules: ingressSecurityRules as any,
        egressSecurityRules: egressSecurityRules as any,
      }
    });
  }

  public async deleteSecurityList(securityListId: string, region?: string): Promise<void> {
    const client = await this.factory.createVirtualNetworkClientAsync(region);
    await client.deleteSecurityList({ securityListId });
  }

  public async listObjectStorageBuckets(): Promise<ObjectStorageBucketResource[]> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const compartmentIds = normalizeCompartmentIds(cfg.get<string[]>("objectStorageCompartmentIds") || []);
    if (compartmentIds.length === 0) {
      return [];
    }
    return this.listObjectStorageBucketsForCompartments(compartmentIds, this.getActiveProfileRegions(), {
      exactStats: true,
    });
  }

  public async listSpeechBuckets(): Promise<ObjectStorageBucketResource[]> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const compartmentIds = normalizeCompartmentIds(cfg.get<string[]>("speechCompartmentIds") || []);
    if (compartmentIds.length === 0) {
      return [];
    }
    return this.listObjectStorageBucketsForCompartments(compartmentIds, [OCI_SPEECH_REGION], {
      exactStats: false,
      includeBucketDetails: false,
    });
  }

  public async listObjectStorageObjects(
    namespaceName: string,
    bucketName: string,
    prefix = "",
    region?: string,
    recursive = false,
  ): Promise<{ prefixes: string[]; objects: ObjectStorageObjectResource[] }> {
    const response = await this.sendObjectStorageRequest({
      method: "GET",
      region,
      path: "/n/{namespaceName}/b/{bucketName}/o",
      pathParams: {
        "{namespaceName}": namespaceName,
        "{bucketName}": bucketName,
      },
      queryParams: {
        delimiter: recursive ? undefined : "/",
        fields: "name,size,etag,md5,timeCreated,timeModified,storageTier,archivalState",
        prefix: prefix || undefined,
        limit: 1000,
      },
    });
    const payload = await response.json() as {
      prefixes?: unknown[];
      objects?: Array<Record<string, unknown>>;
    };

    return {
      prefixes: Array.isArray(payload.prefixes)
        ? payload.prefixes.map((value) => String(value ?? "").trim()).filter((value) => value.length > 0)
        : [],
      objects: Array.isArray(payload.objects)
        ? payload.objects
          .map((item) => ({
            name: String(item.name ?? "").trim(),
            size: readOptionalNumber(item.size),
            etag: readOptionalString(item.etag),
            md5: readOptionalString(item.md5),
            storageTier: readOptionalString(item.storageTier),
            archivalState: readOptionalString(item.archivalState),
            timeCreated: readOptionalString(item.timeCreated),
            timeModified: readOptionalString(item.timeModified),
          }))
          .filter((item) => item.name.length > 0)
        : [],
    };
  }

  public async listSpeechObjects(
    namespaceName: string,
    bucketName: string,
    prefix = "",
  ): Promise<{ prefixes: string[]; objects: ObjectStorageObjectResource[] }> {
    const response = await this.listObjectStorageObjects(namespaceName, bucketName, prefix, OCI_SPEECH_REGION);
    return {
      prefixes: response.prefixes,
      objects: response.objects.filter((item) => isSpeechSupportedObjectName(item.name)),
    };
  }

  public async uploadObjectStorageObject(
    namespaceName: string,
    bucketName: string,
    objectName: string,
    content: Uint8Array,
    region?: string
  ): Promise<void> {
    await this.sendObjectStorageRequest({
      method: "PUT",
      region,
      path: "/n/{namespaceName}/b/{bucketName}/o/{objectName}",
      pathParams: {
        "{namespaceName}": namespaceName,
        "{bucketName}": bucketName,
        "{objectName}": objectName,
      },
      headerParams: {
        "content-type": "application/octet-stream",
        "content-length": String(content.byteLength),
      },
      bodyContent: Readable.from(Buffer.from(content)),
    });
  }

  public async downloadObjectStorageObject(
    namespaceName: string,
    bucketName: string,
    objectName: string,
    region?: string
  ): Promise<Uint8Array> {
    const response = await this.sendObjectStorageRequest({
      method: "GET",
      region,
      path: "/n/{namespaceName}/b/{bucketName}/o/{objectName}",
      pathParams: {
        "{namespaceName}": namespaceName,
        "{bucketName}": bucketName,
        "{objectName}": objectName,
      },
      headerParams: {
        accept: "application/octet-stream",
      },
    });
    return new Uint8Array(await response.arrayBuffer());
  }

  public async readObjectStorageObjectText(
    namespaceName: string,
    bucketName: string,
    objectName: string,
    region?: string,
    maxBytes = 262144,
  ): Promise<{ text: string; truncated: boolean }> {
    const normalizedMaxBytes = Number.isFinite(maxBytes) && maxBytes > 0
      ? Math.min(Math.floor(maxBytes), 1024 * 1024)
      : 262144;
    const objectSize = await this.getObjectStorageObjectContentLength(
      namespaceName,
      bucketName,
      objectName,
      region,
    );
    if (objectSize === 0) {
      return { text: "", truncated: false };
    }

    const requestedRangeEnd = objectSize === null
      ? normalizedMaxBytes - 1
      : Math.min(objectSize, normalizedMaxBytes) - 1;
    const response = await this.fetchObjectStorageTextPreview(
      namespaceName,
      bucketName,
      objectName,
      region,
      requestedRangeEnd,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    const previewBytes = bytes.byteLength > normalizedMaxBytes
      ? bytes.subarray(0, normalizedMaxBytes)
      : bytes;
    const text = new TextDecoder("utf-8", { fatal: false }).decode(previewBytes);
    const contentRange = response.headers.get("content-range");
    const contentLength = parseObjectStorageContentLength(response.headers.get("content-length"));
    const totalBytes = objectSize
      ?? parseObjectStorageContentRangeTotal(contentRange)
      ?? (response.status === 206 ? null : contentLength);
    const truncated = totalBytes !== null
      ? totalBytes > previewBytes.byteLength
      : Boolean(contentRange) || response.status === 206 || bytes.byteLength > previewBytes.byteLength;
    return { text, truncated };
  }

  public async deleteObjectStorageObject(
    namespaceName: string,
    bucketName: string,
    objectName: string,
    region?: string
  ): Promise<void> {
    await this.sendObjectStorageRequest({
      method: "DELETE",
      region,
      path: "/n/{namespaceName}/b/{bucketName}/o/{objectName}",
      pathParams: {
        "{namespaceName}": namespaceName,
        "{bucketName}": bucketName,
        "{objectName}": objectName,
      },
    });
  }

  public async createObjectStoragePreauthenticatedRequest(
    namespaceName: string,
    bucketName: string,
    objectName: string,
    expiresInHours = 24,
    region?: string
  ): Promise<{ accessType: string; accessUri: string; fullUrl: string; objectName: string; timeExpires: string }> {
    const resolvedRegion = await this.resolveRegionId(region);
    const timeExpires = new Date(Date.now() + Math.max(1, expiresInHours) * 60 * 60 * 1000).toISOString();
    const response = await this.sendObjectStorageRequest({
      method: "POST",
      region: resolvedRegion,
      path: "/n/{namespaceName}/b/{bucketName}/p/",
      pathParams: {
        "{namespaceName}": namespaceName,
        "{bucketName}": bucketName,
      },
      headerParams: {
        "content-type": "application/json",
      },
      bodyContent: JSON.stringify({
        name: `oci-ai-${sanitizeParName(objectName)}-${Date.now()}`,
        objectName,
        accessType: "ObjectRead",
        timeExpires,
      }),
    });
    const payload = await response.json() as Record<string, unknown>;
    const accessUri = readOptionalString(payload.accessUri) || "";

    return {
      accessType: readOptionalString(payload.accessType) || "ObjectRead",
      accessUri,
      fullUrl: accessUri ? `https://objectstorage.${resolvedRegion}.oraclecloud.com${accessUri}` : "",
      objectName,
      timeExpires: readOptionalString(payload.timeExpires) || timeExpires,
    };
  }

  public async listSpeechTranscriptionJobs(): Promise<SpeechTranscriptionJobResource[]> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const compartmentIds = normalizeCompartmentIds(cfg.get<string[]>("speechCompartmentIds") || []);
    if (compartmentIds.length === 0) {
      return [];
    }

    const client = await this.factory.createSpeechClientAsync(OCI_SPEECH_REGION);
    const jobs: SpeechTranscriptionJobResource[] = [];

    for (const compartmentId of compartmentIds) {
      let page: string | undefined;
      do {
        const response = await client.listTranscriptionJobs({
          compartmentId,
          limit: 1000,
          page,
          sortOrder: aispeech.models.SortOrder.Desc,
          sortBy: aispeech.requests.ListTranscriptionJobsRequest.SortBy.TimeCreated,
        });
        jobs.push(
          ...((response.transcriptionJobCollection?.items || []).map((job) =>
            mapSpeechTranscriptionJobSummary(job, OCI_SPEECH_REGION),
          )),
        );
        page = response.opcNextPage || undefined;
      } while (page);
    }

    return jobs.sort((left, right) =>
      compareOptionalDate(right.timeAccepted, left.timeAccepted)
      || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }),
    );
  }

  public async getSpeechTranscriptionJob(transcriptionJobId: string): Promise<SpeechTranscriptionJobResource> {
    const client = await this.factory.createSpeechClientAsync(OCI_SPEECH_REGION);
    const response = await client.getTranscriptionJob({ transcriptionJobId });
    return mapSpeechTranscriptionJob(response.transcriptionJob, OCI_SPEECH_REGION);
  }

  public async createSpeechTranscriptionJob(params: {
    compartmentId: string;
    displayName?: string;
    description?: string;
    inputNamespaceName: string;
    inputBucketName: string;
    inputObjectNames: string[];
    outputNamespaceName: string;
    outputBucketName: string;
    outputPrefix?: string;
    modelType: string;
    languageCode: "ja" | "en" | "zh";
    includeSrt?: boolean;
    enablePunctuation?: boolean;
    enableDiarization?: boolean;
    profanityFilterMode?: "MASK";
    whisperPrompt?: string;
  }): Promise<SpeechTranscriptionJobResource> {
    const client = await this.factory.createSpeechClientAsync(OCI_SPEECH_REGION);
    const inputObjectNames = [...new Set(params.inputObjectNames.map((value) => value.trim()).filter((value) => value.length > 0))];
    const displayName = normalizeSpeechDisplayName(params.displayName, inputObjectNames);
    if (inputObjectNames.length === 0) {
      throw new Error("Select at least one input object from Object Storage.");
    }
    const unsupportedObjectName = inputObjectNames.find((value) => !isSpeechSupportedObjectName(value));
    if (unsupportedObjectName) {
      throw new Error(`OCI Speech supports only the documented media formats. Unsupported input: ${unsupportedObjectName}`);
    }
    if (inputObjectNames.length > OCI_SPEECH_MAX_INPUT_OBJECTS) {
      throw new Error(`OCI Speech accepts up to ${OCI_SPEECH_MAX_INPUT_OBJECTS} input files per job.`);
    }
    const filters: aispeech.models.TranscriptionFilter[] = [];
    if (params.profanityFilterMode === "MASK") {
      const profanityFilter: aispeech.models.ProfanityTranscriptionFilter = {
        type: aispeech.models.ProfanityTranscriptionFilter.type,
        mode: aispeech.models.ProfanityTranscriptionFilter.Mode.Mask,
      };
      filters.push(profanityFilter);
    }

    const additionalSettings: Record<string, string> = {};
    const whisperPrompt = String(params.whisperPrompt ?? "").trim();
    if (whisperPrompt) {
      if (whisperPrompt.length > OCI_SPEECH_MAX_WHISPER_PROMPT_LENGTH) {
        throw new Error(`Whisper prompt must be ${OCI_SPEECH_MAX_WHISPER_PROMPT_LENGTH} characters or fewer.`);
      }
      additionalSettings.whisperPrompt = whisperPrompt;
    }

    const response = await client.createTranscriptionJob({
      createTranscriptionJobDetails: {
        compartmentId: params.compartmentId,
        displayName,
        description: readOptionalString(params.description),
        inputLocation: {
          // Send media objects inline. File input expects a batch-list object, not raw audio file names.
          locationType: aispeech.models.ObjectListInlineInputLocation.locationType,
          objectLocations: [
            {
              namespaceName: params.inputNamespaceName,
              bucketName: params.inputBucketName,
              objectNames: inputObjectNames,
            },
          ],
        },
        outputLocation: {
          namespaceName: params.outputNamespaceName,
          bucketName: params.outputBucketName,
          prefix: String(params.outputPrefix ?? "").trim(),
        },
        additionalTranscriptionFormats: params.includeSrt
          ? [aispeech.models.CreateTranscriptionJobDetails.AdditionalTranscriptionFormats.Srt]
          : undefined,
        normalization: {
          isPunctuationEnabled: true,
          filters,
        },
        modelDetails: {
          domain: aispeech.models.TranscriptionModelDetails.Domain.Generic,
          languageCode: params.languageCode as aispeech.models.TranscriptionModelDetails.LanguageCode,
          modelType: params.modelType,
          transcriptionSettings: {
            diarization: params.enableDiarization
              ? {
                isDiarizationEnabled: true,
              }
              : undefined,
            additionalSettings: Object.keys(additionalSettings).length > 0 ? additionalSettings : undefined,
          },
        },
      },
    });

    return mapSpeechTranscriptionJob(response.transcriptionJob, OCI_SPEECH_REGION);
  }

  public async cancelSpeechTranscriptionJob(transcriptionJobId: string): Promise<void> {
    const client = await this.factory.createSpeechClientAsync(OCI_SPEECH_REGION);
    await client.cancelTranscriptionJob({ transcriptionJobId });
  }

  public async listSpeechTranscriptionTasks(transcriptionJobId: string): Promise<SpeechTranscriptionTaskResource[]> {
    const client = await this.factory.createSpeechClientAsync(OCI_SPEECH_REGION);
    const tasks: SpeechTranscriptionTaskResource[] = [];
    let page: string | undefined;

    do {
      const response = await client.listTranscriptionTasks({
        transcriptionJobId,
        limit: 1000,
        page,
        sortOrder: aispeech.models.SortOrder.Desc,
        sortBy: aispeech.requests.ListTranscriptionTasksRequest.SortBy.TimeCreated,
      });
      const taskSummaries = response.transcriptionTaskCollection?.items || [];
      for (let index = 0; index < taskSummaries.length; index += 8) {
        const batch = taskSummaries.slice(index, index + 8);
        const detailedBatch = await Promise.all(batch.map(async (taskSummary) => {
          const transcriptionTaskId = String(taskSummary?.id ?? "").trim();
          if (!transcriptionTaskId) {
            return mapSpeechTranscriptionTask(taskSummary, transcriptionJobId);
          }
          const taskResponse = await client.getTranscriptionTask({
            transcriptionJobId,
            transcriptionTaskId,
          });
          return mapSpeechTranscriptionTask(taskResponse.transcriptionTask ?? taskSummary, transcriptionJobId);
        }));
        tasks.push(...detailedBatch);
      }
      page = response.opcNextPage || undefined;
    } while (page);

    return tasks.sort((left, right) =>
      compareOptionalDate(right.timeStarted, left.timeStarted)
      || left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }),
    );
  }

  private async listObjectStorageBucketsForCompartments(
    compartmentIds: string[],
    regions: string[],
    options?: {
      exactStats?: boolean;
      includeBucketDetails?: boolean;
    },
  ): Promise<ObjectStorageBucketResource[]> {
    const exactStats = options?.exactStats !== false;
    const includeBucketDetails = options?.includeBucketDetails !== false;
    const buckets: ObjectStorageBucketResource[] = [];
    for (const region of regions) {
      const resolvedRegion = await this.resolveRegionId(region);
      const namespaceName = await this.getObjectStorageNamespace(resolvedRegion);
      for (const compartmentId of compartmentIds) {
        let page: string | undefined;
        do {
          const response = await this.sendObjectStorageRequest({
            method: "GET",
            region: resolvedRegion,
            path: "/n/{namespaceName}/b/",
            pathParams: { "{namespaceName}": namespaceName },
            queryParams: {
              compartmentId,
              limit: 1000,
              page,
            },
          });
          const items = await response.json() as Array<Record<string, unknown>>;
          const detailedBuckets = await Promise.all(
            items.map(async (bucket): Promise<ObjectStorageBucketResource | null> => {
              const name = String(bucket.name ?? "").trim();
              if (!name) {
                return null;
              }
              const approximateCountFromList = readOptionalNumber(bucket.approximateCount);
              const approximateSizeFromList = readOptionalNumber(bucket.approximateSize);
              const needsApproximateFields = !exactStats && (
                approximateCountFromList === undefined
                || approximateSizeFromList === undefined
              );
              const details = includeBucketDetails || needsApproximateFields
                ? await this.getObjectStorageBucketDetails(namespaceName, name, resolvedRegion)
                : undefined;
              const stats = exactStats
                ? await this.getObjectStorageBucketExactStats(namespaceName, name, resolvedRegion)
                : {
                  approximateCount: approximateCountFromList ?? readOptionalNumber(details?.approximateCount) ?? 0,
                  approximateSize: approximateSizeFromList ?? readOptionalNumber(details?.approximateSize) ?? 0,
                };
              return {
                name,
                compartmentId,
                namespaceName,
                region: resolvedRegion,
                storageTier: readOptionalString(details?.storageTier ?? bucket.storageTier),
                publicAccessType: readOptionalString(details?.publicAccessType ?? bucket.publicAccessType),
                approximateCount: stats.approximateCount,
                approximateSize: stats.approximateSize,
                createdAt: readOptionalString(details?.timeCreated ?? bucket.timeCreated),
              } satisfies ObjectStorageBucketResource;
            }),
          );
          buckets.push(...detailedBuckets.filter((bucket): bucket is ObjectStorageBucketResource => bucket !== null));
          page = response.headers.get("opc-next-page") || undefined;
        } while (page);
      }
    }

    return buckets.sort((a, b) =>
      a.compartmentId.localeCompare(b.compartmentId)
      || a.region.localeCompare(b.region)
      || a.name.localeCompare(b.name),
    );
  }

  private async populateInstanceNetworkAddresses(
    instance: ComputeResource,
    compartmentId: string | undefined,
    computeClient: Awaited<ReturnType<OciClientFactory["createComputeClientAsync"]>>,
    virtualNetworkClient: Awaited<ReturnType<OciClientFactory["createVirtualNetworkClientAsync"]>>
  ): Promise<void> {
    if (!instance.id || !compartmentId) {
      return;
    }

    try {
      const candidates = await this.listAllVnicAttachments(computeClient, compartmentId, instance.id);
      if (candidates.length === 0) {
        return;
      }

      let vnic: Awaited<ReturnType<typeof virtualNetworkClient.getVnic>>["vnic"] | undefined;
      for (const attachment of candidates) {
        if (!attachment.vnicId) {
          continue;
        }
        const current = (await virtualNetworkClient.getVnic({ vnicId: attachment.vnicId })).vnic;
        if (!vnic) {
          vnic = current;
        }
        if (current.isPrimary) {
          vnic = current;
          break;
        }
      }
      if (!vnic) {
        return;
      }

      instance.publicIp = vnic.publicIp || "";
      instance.privateIp = vnic.privateIp || "";
      instance.subnetId = vnic.subnetId || "";
      if (vnic.subnetId) {
        try {
          const subnet = (await virtualNetworkClient.getSubnet({ subnetId: vnic.subnetId })).subnet;
          instance.vcnId = subnet.vcnId || "";
        } catch {
          // Keep compute inventory usable even if subnet lookup fails.
        }
      }
    } catch {
      // Best-effort enrichment: if address lookup fails, keep listing instances without IPs.
    }
  }

  private async populateDbSystemNetworkAddresses(
    dbSystem: DbSystemResource,
    compartmentId: string,
    dbClient: Awaited<ReturnType<OciClientFactory["createDatabaseClientAsync"]>>,
    vcnClient: Awaited<ReturnType<OciClientFactory["createVirtualNetworkClientAsync"]>>
  ): Promise<void> {
    if (!dbSystem.id) return;

    try {
      const nodesResult = await dbClient.listDbNodes({
        compartmentId,
        dbSystemId: dbSystem.id,
      });
      const nodes = nodesResult.items || [];

      for (const node of nodes) {
        if (node.vnicId) {
          try {
            const vnic = (await vcnClient.getVnic({ vnicId: node.vnicId })).vnic;
            if (!dbSystem.privateIp && vnic?.privateIp) dbSystem.privateIp = vnic.privateIp;
            if (!dbSystem.publicIp && vnic?.publicIp) dbSystem.publicIp = vnic.publicIp;
            if (!dbSystem.subnetId && vnic?.subnetId) dbSystem.subnetId = vnic.subnetId;
            if (!dbSystem.vcnId && vnic?.subnetId) {
              try {
                const subnet = (await vcnClient.getSubnet({ subnetId: vnic.subnetId })).subnet;
                if (subnet?.vcnId) {
                  dbSystem.vcnId = subnet.vcnId;
                }
              } catch {
                // Keep DB System inventory usable even if subnet lookup fails.
              }
            }
          } catch { }
        }
      }

      dbSystem.nodeLifecycleState = deriveNodeLifecycleState(nodes);
    } catch { }
  }

  private async listAllVnicAttachments(
    computeClient: Awaited<ReturnType<OciClientFactory["createComputeClientAsync"]>>,
    compartmentId: string,
    instanceId: string
  ) {
    const all = [];
    let page: string | undefined;
    do {
      const response = await computeClient.listVnicAttachments({
        compartmentId,
        instanceId,
        page,
      });
      all.push(...(response.items || []));
      page = response.opcNextPage;
    } while (page);
    return all;
  }

  private async getObjectStorageNamespace(region?: string): Promise<string> {
    const response = await this.sendObjectStorageRequest({
      method: "GET",
      region,
      path: "/n/",
    });
    const raw = (await response.text()).trim();
    if (!raw) {
      throw new Error("Object Storage namespace response was empty.");
    }
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "string" && parsed.trim()) {
        return parsed.trim();
      }
    } catch {
      // Fall back to raw text below.
    }
    return raw.replace(/^"+|"+$/g, "").trim();
  }

  private async getObjectStorageBucketDetails(
    namespaceName: string,
    bucketName: string,
    region?: string
  ): Promise<Record<string, unknown>> {
    const response = await this.sendObjectStorageRequest({
      method: "GET",
      region,
      path: "/n/{namespaceName}/b/{bucketName}",
      pathParams: {
        "{namespaceName}": namespaceName,
        "{bucketName}": bucketName,
      },
      queryParams: {
        fields: "approximateCount,approximateSize",
      },
    });
    return await response.json() as Record<string, unknown>;
  }

  private async getObjectStorageBucketExactStats(
    namespaceName: string,
    bucketName: string,
    region?: string
  ): Promise<{ approximateCount: number; approximateSize: number }> {
    let approximateCount = 0;
    let approximateSize = 0;
    let page: string | undefined;

    do {
      const response = await this.sendObjectStorageRequest({
        method: "GET",
        region,
        path: "/n/{namespaceName}/b/{bucketName}/o",
        pathParams: {
          "{namespaceName}": namespaceName,
          "{bucketName}": bucketName,
        },
        queryParams: {
          fields: "size",
          limit: 1000,
          page,
        },
      });
      const payload = await response.json() as {
        objects?: Array<Record<string, unknown>>;
      };

      for (const item of Array.isArray(payload.objects) ? payload.objects : []) {
        approximateCount += 1;
        approximateSize += readOptionalNumber(item.size) ?? 0;
      }
      page = response.headers.get("opc-next-page") || undefined;
    } while (page);

    return {
      approximateCount,
      approximateSize,
    };
  }

  private async sendObjectStorageRequest(params: {
    method: common.Method;
    region?: string;
    path: string;
    pathParams?: common.Params;
    queryParams?: common.Params;
    headerParams?: common.Params;
    bodyContent?: string | Readable;
  }): Promise<Response> {
    const resolvedRegion = await this.resolveRegionId(params.region);
    if (!resolvedRegion) {
      throw new Error("OCI region is required for Object Storage requests.");
    }

    const authenticationDetailsProvider = await this.factory.createAuthenticationProviderAsync();
    const signer = new common.DefaultRequestSigner(authenticationDetailsProvider);
    const httpClient = new common.FetchHttpClient(signer);
    const request = await common.composeRequest({
      baseEndpoint: `https://objectstorage.${resolvedRegion}.oraclecloud.com`,
      path: params.path,
      method: params.method,
      defaultHeaders: params.headerParams?.accept ? {} : { accept: "application/json" },
      pathParams: params.pathParams,
      queryParams: encodeObjectStorageQueryParams(params.queryParams),
      headerParams: params.headerParams,
      bodyContent: params.bodyContent,
    });
    const response = await httpClient.send(request, params.method === "GET" || params.method === "HEAD");
    if (!response.ok) {
      throw new Error(await formatObjectStorageError(response));
    }
    return response;
  }

  private async getObjectStorageObjectContentLength(
    namespaceName: string,
    bucketName: string,
    objectName: string,
    region?: string,
  ): Promise<number | null> {
    const response = await this.sendObjectStorageRequest({
      method: "HEAD",
      region,
      path: "/n/{namespaceName}/b/{bucketName}/o/{objectName}",
      pathParams: {
        "{namespaceName}": namespaceName,
        "{bucketName}": bucketName,
        "{objectName}": objectName,
      },
    });
    return parseObjectStorageContentLength(response.headers.get("content-length"));
  }

  private async fetchObjectStorageTextPreview(
    namespaceName: string,
    bucketName: string,
    objectName: string,
    region: string | undefined,
    requestedRangeEnd: number,
  ): Promise<Response> {
    try {
      return await this.sendObjectStorageRequest({
        method: "GET",
        region,
        path: "/n/{namespaceName}/b/{bucketName}/o/{objectName}",
        pathParams: {
          "{namespaceName}": namespaceName,
          "{bucketName}": bucketName,
          "{objectName}": objectName,
        },
        headerParams: requestedRangeEnd >= 0
          ? {
            accept: "application/octet-stream",
            range: `bytes=0-${requestedRangeEnd}`,
          }
          : {
            accept: "application/octet-stream",
          },
      });
    } catch (error) {
      if (!isInvalidObjectStorageRangeError(error)) {
        throw error;
      }
      return this.sendObjectStorageRequest({
        method: "GET",
        region,
        path: "/n/{namespaceName}/b/{bucketName}/o/{objectName}",
        pathParams: {
          "{namespaceName}": namespaceName,
          "{bucketName}": bucketName,
          "{objectName}": objectName,
        },
        headerParams: {
          accept: "application/octet-stream",
        },
      });
    }
  }

  private async resolveRegionId(regionOverride?: string): Promise<string> {
    const client = await this.factory.createComputeClientAsync(regionOverride);
    return String(client.regionId || regionOverride || "").trim();
  }

  public async listBastions(): Promise<BastionResource[]> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const compartmentIds = [...new Set(normalizeCompartmentIds(cfg.get<string[]>("bastionCompartmentIds") || []))];
    if (compartmentIds.length === 0) {
      return [];
    }
    const regions = [...new Set(this.getActiveProfileRegions())];

    const bastions: BastionResource[] = [];

    for (const region of regions) {
      const client = await this.factory.createBastionClientAsync(region);
      for (const compartmentId of compartmentIds) {
        let page: string | undefined;
        do {
          const result = await client.listBastions({ compartmentId, page });
          bastions.push(
            ...(result.items || [])
              .filter((bastionItem) => {
                const lifecycleState = ((bastionItem as any)?.lifecycleState as string | undefined) || "";
                return lifecycleState.toUpperCase() !== "DELETED";
              })
              .map((bastionItem) => {
                const bastion = bastionItem as any;
                return {
                  id: bastion.id || "",
                  name: bastion.name || bastion.id || "Unnamed Bastion",
                  lifecycleState: (bastion.lifecycleState as string) || "UNKNOWN",
                  compartmentId: bastion.compartmentId || compartmentId,
                  region,
                  targetVcnId: bastion.targetVcnId,
                  targetSubnetId: bastion.targetSubnetId,
                  clientCidrBlockAllowList: bastion.clientCidrBlockAllowList,
                  dnsProxyStatus: bastion.dnsProxyStatus
                };
              })
          );
          page = result.opcNextPage;
        } while (page);
      }
    }

    return bastions.sort(compareNamedOciResources);
  }

  public async listBastionSessions(bastionId: string, region?: string): Promise<BastionSessionResource[]> {
    const client = await this.factory.createBastionClientAsync(region);
    const sessionSummaries: any[] = [];
    let page: string | undefined;
    do {
      const result = await client.listSessions({ bastionId, page });
      sessionSummaries.push(
        ...(result.items || []).filter((sessionItem) => {
          const lifecycleState = ((sessionItem as any)?.lifecycleState as string | undefined) || "";
          return lifecycleState.toUpperCase() !== "DELETED";
        })
      );
      page = result.opcNextPage;
    } while (page);
    const sessions = await Promise.allSettled(
      sessionSummaries.map(async (sessionSummary) => {
        const sessionId = String((sessionSummary as any)?.id || "").trim();
        if (!sessionId) {
          return mapBastionSessionResource(sessionSummary, bastionId);
        }
        const response = await client.getSession({ sessionId });
        return mapBastionSessionResource(response.session || sessionSummary, bastionId);
      })
    );
    return sessions
      .map((result, index) =>
        result.status === "fulfilled"
          ? result.value
          : mapBastionSessionResource(sessionSummaries[index], bastionId)
      )
      .sort(compareNamedOciResources);
  }

  public async createBastionSession(
    bastionId: string,
    targetResourceDetails: any,
    keyDetails: any,
    sessionTtlInSeconds?: number,
    displayName?: string,
    region?: string
  ): Promise<void> {
    const client = await this.factory.createBastionClientAsync(region);
    await client.createSession({
      createSessionDetails: {
        bastionId,
        targetResourceDetails,
        keyDetails,
        sessionTtlInSeconds,
        displayName
      }
    });
  }

  public async deleteBastionSession(sessionId: string, region?: string): Promise<void> {
    const client = await this.factory.createBastionClientAsync(region);
    await client.deleteSession({ sessionId });
  }

  private async collectComputeInstances(
    compartmentIds: string[],
    regions: string[],
    options?: { lifecycleStates?: Set<string> }
  ): Promise<ComputeResource[]> {
    const instances: ComputeResource[] = [];
    const lifecycleStates = options?.lifecycleStates ?? new Set<string>();
    const requestedLifecycleState = lifecycleStates.size === 1 ? [...lifecycleStates][0] : undefined;

    for (const region of regions) {
      const computeClient = await this.factory.createComputeClientAsync(region);
      const virtualNetworkClient = await this.factory.createVirtualNetworkClientAsync(region);
      for (const compartmentId of compartmentIds) {
        let page: string | undefined;
        do {
          const result = await computeClient.listInstances({ compartmentId, page, lifecycleState: requestedLifecycleState });
          const regionInstances = (result.items || [])
            .map((instance) => ({
              id: instance.id || "",
              name: instance.displayName || instance.id || "Unnamed Instance",
              lifecycleState: (instance.lifecycleState as string) || "UNKNOWN",
              compartmentId,
              region,
            }))
            .filter((instance) => {
              if (lifecycleStates.size === 0) {
                return true;
              }
              return lifecycleStates.has(String(instance.lifecycleState ?? "").trim().toUpperCase());
            });
          instances.push(...regionInstances);
          await Promise.all(
            regionInstances.map((instance) =>
              this.populateInstanceNetworkAddresses(instance, compartmentId, computeClient, virtualNetworkClient)
            )
          );
          page = result.opcNextPage;
        } while (page);
      }
    }

    return instances;
  }

  private getActiveProfileRegions(): string[] {
    return splitRegions(this.factory.getRegion() ?? "");
  }
}

const NODE_TRANSITIONAL_STATES = new Set([
  "STARTING", "STOPPING", "PROVISIONING", "TERMINATING",
  "UPDATING", "MIGRATING",
]);

function deriveNodeLifecycleState(nodes: { lifecycleState?: string }[]): string | undefined {
  if (nodes.length === 0) return undefined;

  let hasStopped = false;
  for (const node of nodes) {
    const state = (node.lifecycleState as string) || "";
    if (NODE_TRANSITIONAL_STATES.has(state)) {
      return state;
    }
    if (state === "STOPPED") {
      hasStopped = true;
    }
  }
  if (hasStopped) return "STOPPED";
  return undefined;
}

function compareNamedOciResources<T extends { name?: string; id?: string }>(left: T, right: T): number {
  const nameCompare = (left.name || "").localeCompare(right.name || "", undefined, {
    numeric: true,
    sensitivity: "base",
  });
  if (nameCompare !== 0) {
    return nameCompare;
  }
  return (left.id || "").localeCompare(right.id || "", undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function mapSpeechTranscriptionJobSummary(
  job: aispeech.models.TranscriptionJobSummary | aispeech.models.TranscriptionJob,
  region: string,
): SpeechTranscriptionJobResource {
  return {
    id: job.id || "",
    name: readOptionalString(job.displayName) || job.id || "Untitled Job",
    compartmentId: job.compartmentId || "",
    region,
    lifecycleState: (job.lifecycleState as string) || "UNKNOWN",
    lifecycleDetails: readOptionalString(job.lifecycleDetails),
    percentComplete: readOptionalNumber(job.percentComplete),
    totalTasks: readOptionalNumber(job.totalTasks),
    outstandingTasks: readOptionalNumber(job.outstandingTasks),
    successfulTasks: readOptionalNumber(job.successfulTasks),
    timeAccepted: toIsoString(job.timeAccepted),
    timeStarted: toIsoString(job.timeStarted),
    timeFinished: toIsoString(job.timeFinished),
  };
}

function mapSpeechTranscriptionJob(
  job: aispeech.models.TranscriptionJob,
  region: string,
): SpeechTranscriptionJobResource {
  const summary = mapSpeechTranscriptionJobSummary(job, region);
  const inputLocations = getSpeechInputLocations(job.inputLocation);
  const primaryInputLocation = inputLocations[0];
  const additionalSettings = job.modelDetails?.transcriptionSettings?.additionalSettings || {};
  const profanityFilter = Array.isArray(job.normalization?.filters)
    ? job.normalization?.filters.find((filter) => String((filter as { type?: string })?.type || "").toUpperCase() === "PROFANITY")
    : undefined;

  return {
    ...summary,
    description: readOptionalString(job.description),
    inputNamespaceName: readOptionalString(primaryInputLocation?.namespaceName),
    inputBucketName: readOptionalString(primaryInputLocation?.bucketName),
    inputObjectNames: flattenSpeechInputObjectNames(inputLocations),
    outputNamespaceName: readOptionalString(job.outputLocation?.namespaceName),
    outputBucketName: readOptionalString(job.outputLocation?.bucketName),
    outputPrefix: readOptionalString(job.outputLocation?.prefix),
    modelType: readOptionalString(job.modelDetails?.modelType),
    languageCode: readOptionalString(job.modelDetails?.languageCode),
    domain: readOptionalString(job.modelDetails?.domain),
    additionalTranscriptionFormats: Array.isArray(job.additionalTranscriptionFormats)
      ? job.additionalTranscriptionFormats.map((format) => String(format ?? "").trim()).filter((format) => format.length > 0)
      : [],
    isPunctuationEnabled: job.normalization?.isPunctuationEnabled !== false,
    isDiarizationEnabled: Boolean(job.modelDetails?.transcriptionSettings?.diarization?.isDiarizationEnabled),
    numberOfSpeakers: readOptionalNumber(job.modelDetails?.transcriptionSettings?.diarization?.numberOfSpeakers),
    profanityFilterMode: readOptionalString((profanityFilter as { mode?: unknown } | undefined)?.mode),
    whisperPrompt: readOptionalString(additionalSettings.whisperPrompt),
  };
}

function mapSpeechTranscriptionTask(
  task: aispeech.models.TranscriptionTaskSummary | aispeech.models.TranscriptionTask,
  jobId: string,
): SpeechTranscriptionTaskResource {
  const inputLocation = "inputLocation" in task ? task.inputLocation : undefined;
  const outputLocation = "outputLocation" in task ? task.outputLocation : undefined;
  return {
    id: task.id || "",
    name: readOptionalString(task.displayName) || task.id || "Task",
    jobId,
    lifecycleState: (task.lifecycleState as string) || "UNKNOWN",
    lifecycleDetails: readOptionalString(task.lifecycleDetails),
    percentComplete: readOptionalNumber(task.percentComplete),
    fileSizeInBytes: readOptionalNumber(task.fileSizeInBytes),
    fileDurationInSeconds: readOptionalNumber(task.fileDurationInSeconds),
    processingDurationInSeconds: readOptionalNumber(task.processingDurationInSeconds),
    timeStarted: toIsoString(task.timeStarted),
    timeFinished: toIsoString(task.timeFinished),
    inputNamespaceName: readOptionalString(inputLocation?.namespaceName),
    inputBucketName: readOptionalString(inputLocation?.bucketName),
    inputObjectNames: flattenSpeechObjectNames(inputLocation),
    outputNamespaceName: readOptionalString(outputLocation?.namespaceName),
    outputBucketName: readOptionalString(outputLocation?.bucketName),
    outputObjectNames: flattenSpeechObjectNames(outputLocation),
  };
}

function getSpeechInputLocations(
  inputLocation: aispeech.models.TranscriptionJob["inputLocation"] | undefined,
): aispeech.models.ObjectLocation[] {
  if (!inputLocation || typeof inputLocation !== "object") {
    return [];
  }

  const inlineLocations = (inputLocation as aispeech.models.ObjectListInlineInputLocation).objectLocations;
  if (Array.isArray(inlineLocations)) {
    return inlineLocations.filter((location): location is aispeech.models.ObjectLocation => Boolean(location));
  }

  const fileLocation = (inputLocation as aispeech.models.ObjectListFileInputLocation).objectLocation;
  return fileLocation ? [fileLocation] : [];
}

function flattenSpeechInputObjectNames(locations: aispeech.models.ObjectLocation[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const location of locations) {
    if (!Array.isArray(location?.objectNames)) {
      continue;
    }
    for (const value of location.objectNames) {
      const name = String(value ?? "").trim();
      if (!name || seen.has(name)) {
        continue;
      }
      seen.add(name);
      names.push(name);
    }
  }

  return names;
}

function flattenSpeechObjectNames(location: aispeech.models.ObjectLocation | undefined): string[] {
  if (!location) {
    return [];
  }
  return flattenSpeechInputObjectNames([location]);
}

function mapBastionSessionResource(sessionLike: any, bastionId: string): BastionSessionResource {
  return {
    id: sessionLike?.id || "",
    name: sessionLike?.displayName || sessionLike?.name || sessionLike?.id || "Unnamed Session",
    lifecycleState: (sessionLike?.lifecycleState as string) || "UNKNOWN",
    bastionId: sessionLike?.bastionId || bastionId,
    targetResourceDetails: sessionLike?.targetResourceDetails,
    keyDetails: sessionLike?.keyDetails,
    sessionTtlInSeconds: sessionLike?.sessionTtlInSeconds,
    sshMetadata: sessionLike?.sshMetadata,
  };
}

function splitRegions(raw: string): string[] {
  const regions = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return regions.length > 0 ? regions : [""];
}

function normalizeCompartmentIds(compartmentIds: string[]): string[] {
  return compartmentIds
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0);
}

function sanitizeConnectionLabel(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.-]+/g, "_");
}

function addConnectionValue(
  target: Map<string, string>,
  seenValues: Set<string>,
  name: string,
  value: string,
  publicIp?: string
): void {
  const normalized = String(value ?? "").trim();
  if (!normalized || seenValues.has(normalized)) {
    return;
  }

  target.set(name, normalized);
  seenValues.add(normalized);

  const normalizedPublicIp = String(publicIp ?? "").trim();
  if (!normalizedPublicIp) {
    return;
  }

  const serviceName = extractServiceName(normalized);
  if (!serviceName) {
    return;
  }

  const publicIpConnectString = `${normalizedPublicIp}:1521/${serviceName}`;
  if (seenValues.has(publicIpConnectString)) {
    return;
  }
  target.set(`${name}.publicIp`, publicIpConnectString);
  seenValues.add(publicIpConnectString);
}

function extractServiceName(connectString: string): string {
  const raw = String(connectString ?? "").trim();
  if (!raw) return "";

  const descriptorMatch = raw.match(/SERVICE_NAME\s*=\s*([^) \t\r\n]+)/i);
  if (descriptorMatch?.[1]) {
    return descriptorMatch[1].trim().replace(/[)\s]+$/g, "");
  }

  const normalized = raw.replace(/^[a-z]+:\/\//i, "");
  const slashIdx = normalized.lastIndexOf("/");
  if (slashIdx < 0 || slashIdx >= normalized.length - 1) {
    return "";
  }
  const suffix = normalized.slice(slashIdx + 1).split(/[?\s]/)[0] || "";
  return suffix.trim();
}

function isSpeechSupportedObjectName(objectName: string): boolean {
  const normalized = String(objectName ?? "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const leafName = normalized.split("/").filter(Boolean).pop() || normalized;
  const lastDotIdx = leafName.lastIndexOf(".");
  if (lastDotIdx <= 0 || lastDotIdx >= leafName.length - 1) {
    return false;
  }
  return OCI_SPEECH_SUPPORTED_OBJECT_EXTENSIONS.has(leafName.slice(lastDotIdx + 1));
}

function readOptionalString(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toIsoString(value: Date | string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}

function compareOptionalDate(left: string | undefined, right: string | undefined): number {
  const leftTime = left ? Date.parse(left) : Number.NaN;
  const rightTime = right ? Date.parse(right) : Number.NaN;
  const leftSafe = Number.isFinite(leftTime) ? leftTime : 0;
  const rightSafe = Number.isFinite(rightTime) ? rightTime : 0;
  return leftSafe - rightSafe;
}

function encodeObjectStorageQueryParams(params?: common.Params): common.Params | undefined {
  if (!params) {
    return undefined;
  }

  const encodedEntries = Object.entries(params).map(([key, value]) => {
    if (Array.isArray(value)) {
      return [key, value.map((item) => encodeURIComponent(String(item)))] as const;
    }
    if (value === undefined || value === null) {
      return [key, value] as const;
    }
    return [key, encodeURIComponent(String(value))] as const;
  });

  return Object.fromEntries(encodedEntries);
}

async function formatObjectStorageError(response: Response): Promise<string> {
  const fallback = `Object Storage request failed with status ${response.status}.`;
  try {
    const text = await response.text();
    if (!text) {
      return fallback;
    }
    try {
      const payload = JSON.parse(text) as Record<string, unknown>;
      const message = readOptionalString(payload.message) || readOptionalString(payload.code);
      return message || text || fallback;
    } catch {
      return text;
    }
  } catch {
    return fallback;
  }
}

function parseObjectStorageContentLength(value: string | null): number | null {
  const parsed = Number(value ?? "");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseObjectStorageContentRangeTotal(value: string | null): number | null {
  const match = /^bytes\s+\d+-\d+\/(\d+|\*)$/i.exec(String(value ?? "").trim());
  if (!match || match[1] === "*") {
    return null;
  }
  return parseObjectStorageContentLength(match[1]);
}

function isInvalidObjectStorageRangeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /invalid byte range|requested range not satisfiable/i.test(message);
}

function sanitizeParName(objectName: string): string {
  const base = String(objectName ?? "").trim().split("/").filter(Boolean).pop() || "object";
  return base.replace(/[^a-zA-Z0-9_.-]+/g, "-").slice(0, 40) || "object";
}

function normalizeSpeechDisplayName(value: unknown, inputObjectNames: string[]): string | undefined {
  const explicit = readOptionalString(value);
  if (explicit) {
    const sanitized = sanitizeSpeechDisplayName(explicit);
    if (sanitized) {
      return sanitized;
    }
  }
  return buildSuggestedSpeechDisplayName(inputObjectNames);
}

function buildSuggestedSpeechDisplayName(objectNames: string[]): string {
  const baseName = String(objectNames[0] ?? "").trim().split("/").filter(Boolean).pop() || "";
  const seed = sanitizeSpeechDisplayName(baseName.replace(/\.[^.]+$/, ""), OCI_SPEECH_AUTO_DISPLAY_NAME_SEED_LENGTH);
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "").replace(/[-:T]/g, "");
  return `speech-${seed || "job"}-${timestamp}`;
}

function sanitizeSpeechDisplayName(value: string, maxLength?: number): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/_{2,}/g, "_")
    .replace(/^[-_]+|[-_]+$/g, "");
  if (typeof maxLength !== "number" || maxLength <= 0) {
    return normalized;
  }
  return normalized.slice(0, maxLength).replace(/^[-_]+|[-_]+$/g, "");
}
