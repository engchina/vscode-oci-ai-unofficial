import * as vscode from "vscode";
import * as common from "oci-common";
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
  ObjectStorageObjectResource
} from "../types";

export class OciService {
  constructor(private readonly factory: OciClientFactory) { }

  public async listComputeInstances(): Promise<ComputeResource[]> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const compartmentIds = normalizeCompartmentIds(cfg.get<string[]>("computeCompartmentIds") || []);
    if (compartmentIds.length === 0) {
      return [];
    }
    const regions = splitRegions(cfg.get<string>("region", ""));

    const instances: ComputeResource[] = [];

    for (const region of regions) {
      const computeClient = await this.factory.createComputeClientAsync(region);
      const virtualNetworkClient = await this.factory.createVirtualNetworkClientAsync(region);
      for (const compartmentId of compartmentIds) {
        let page: string | undefined;
        do {
          const result = await computeClient.listInstances({ compartmentId, page });
          const regionInstances = (result.items || []).map((instance) => ({
            id: instance.id || "",
            name: instance.displayName || instance.id || "Unnamed Instance",
            lifecycleState: (instance.lifecycleState as string) || "UNKNOWN",
            compartmentId,
            region,
          }));
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
    const regions = splitRegions(cfg.get<string>("region", ""));

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
    const regions = splitRegions(cfg.get<string>("region", ""));

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
    const regions = splitRegions(cfg.get<string>("region", ""));

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

    const buckets: ObjectStorageBucketResource[] = [];
    for (const region of splitRegions(cfg.get<string>("region", ""))) {
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
              const details = await this.getObjectStorageBucketDetails(namespaceName, name, resolvedRegion);
              const exactStats = await this.getObjectStorageBucketExactStats(namespaceName, name, resolvedRegion);
              return {
                name,
                compartmentId,
                namespaceName,
                region: resolvedRegion,
                storageTier: readOptionalString(details.storageTier ?? bucket.storageTier),
                publicAccessType: readOptionalString(details.publicAccessType ?? bucket.publicAccessType),
                approximateCount: exactStats.approximateCount,
                approximateSize: exactStats.approximateSize,
                createdAt: readOptionalString(details.timeCreated ?? bucket.timeCreated),
              } satisfies ObjectStorageBucketResource;
            })
          );
          buckets.push(...detailedBuckets.filter((bucket): bucket is ObjectStorageBucketResource => bucket !== null));
          page = response.headers.get("opc-next-page") || undefined;
        } while (page);
      }
    }

    return buckets.sort((a, b) =>
      a.compartmentId.localeCompare(b.compartmentId) ||
      a.region.localeCompare(b.region) ||
      a.name.localeCompare(b.name)
    );
  }

  public async listObjectStorageObjects(
    namespaceName: string,
    bucketName: string,
    prefix = "",
    region?: string
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
        delimiter: "/",
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
      queryParams: params.queryParams,
      headerParams: params.headerParams,
      bodyContent: params.bodyContent,
    });
    const response = await httpClient.send(request, params.method === "GET" || params.method === "HEAD");
    if (!response.ok) {
      throw new Error(await formatObjectStorageError(response));
    }
    return response;
  }

  private async resolveRegionId(regionOverride?: string): Promise<string> {
    const client = await this.factory.createComputeClientAsync(regionOverride);
    return String(client.regionId || regionOverride || "").trim();
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

function readOptionalString(value: unknown): string | undefined {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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

function sanitizeParName(objectName: string): string {
  const base = String(objectName ?? "").trim().split("/").filter(Boolean).pop() || "object";
  return base.replace(/[^a-zA-Z0-9_.-]+/g, "-").slice(0, 40) || "object";
}
