import * as vscode from "vscode";
import { OciClientFactory } from "./clientFactory";
import { AdbResource, ComputeResource, VcnResource, SecurityListResource, SecurityRule, DbSystemResource } from "../types";

export class OciService {
  constructor(private readonly factory: OciClientFactory) { }

  public async listComputeInstances(): Promise<ComputeResource[]> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const compartmentIds = [...(cfg.get<string[]>("computeCompartmentIds") || [])];
    const regions = splitRegions(cfg.get<string>("region", ""));

    if (compartmentIds.length === 0) {
      const legacy = cfg.get<string>("compartmentId", "");
      if (legacy) compartmentIds.push(legacy);
    }

    const instances: ComputeResource[] = [];

    for (const region of regions) {
      const computeClient = await this.factory.createComputeClientAsync(region);
      const virtualNetworkClient = await this.factory.createVirtualNetworkClientAsync(region);
      for (const compartmentId of compartmentIds) {
        const normalizedCompartmentId = compartmentId.trim();
        if (!normalizedCompartmentId) continue;
        let page: string | undefined;
        do {
          const result = await computeClient.listInstances({ compartmentId: normalizedCompartmentId, page });
          const regionInstances = (result.items || []).map((instance) => ({
            id: instance.id || "",
            name: instance.displayName || instance.id || "Unnamed Instance",
            lifecycleState: (instance.lifecycleState as string) || "UNKNOWN",
            compartmentId: normalizedCompartmentId,
            region,
          }));
          instances.push(...regionInstances);
          await Promise.all(
            regionInstances.map((instance) =>
              this.populateInstanceNetworkAddresses(instance, normalizedCompartmentId, computeClient, virtualNetworkClient)
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
    const compartmentIds = [...(cfg.get<string[]>("adbCompartmentIds") || [])];
    const regions = splitRegions(cfg.get<string>("region", ""));

    if (compartmentIds.length === 0) {
      const legacy = cfg.get<string>("compartmentId", "");
      if (legacy) compartmentIds.push(legacy);
    }

    const databases: AdbResource[] = [];

    for (const region of regions) {
      const client = await this.factory.createDatabaseClientAsync(region);
      for (const compartmentId of compartmentIds) {
        const normalizedCompartmentId = compartmentId.trim();
        if (!normalizedCompartmentId) continue;
        let page: string | undefined;
        do {
          const result = await client.listAutonomousDatabases({ compartmentId: normalizedCompartmentId, page });
          databases.push(
            ...(result.items || []).map((adb) => ({
              id: adb.id || "",
              name: adb.dbName || adb.displayName || adb.id || "Unnamed ADB",
              lifecycleState: (adb.lifecycleState as string) || "UNKNOWN",
              compartmentId: normalizedCompartmentId,
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
    const compartmentIds = [...(cfg.get<string[]>("dbSystemCompartmentIds") || [])];
    const regions = splitRegions(cfg.get<string>("region", ""));

    if (compartmentIds.length === 0) {
      const legacy = cfg.get<string>("compartmentId", "");
      if (legacy) compartmentIds.push(legacy);
    }

    const dbSystems: DbSystemResource[] = [];

    for (const region of regions) {
      const dbClient = await this.factory.createDatabaseClientAsync(region);
      const vcnClient = await this.factory.createVirtualNetworkClientAsync(region);

      for (const compartmentId of compartmentIds) {
        const normalized = compartmentId.trim();
        if (!normalized) continue;

        let page: string | undefined;
        do {
          const result = await dbClient.listDbSystems({ compartmentId: normalized, page });
          const regionSystems = (result.items || []).map((sys) => ({
            id: sys.id || "",
            name: sys.displayName || sys.id || "Unnamed DB System",
            lifecycleState: (sys.lifecycleState as string) || "UNKNOWN",
            compartmentId: normalized,
            region,
            nodeIps: [],
          }));

          dbSystems.push(...regionSystems);

          await Promise.all(
            regionSystems.map((sys) =>
              this.populateDbSystemNetworkAddresses(sys, normalized, dbClient, vcnClient)
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

  public async listVcns(): Promise<VcnResource[]> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const compartmentIds = [...(cfg.get<string[]>("vcnCompartmentIds") || [])];
    const regions = splitRegions(cfg.get<string>("region", ""));

    if (compartmentIds.length === 0) {
      const legacy = cfg.get<string>("compartmentId", "");
      if (legacy) compartmentIds.push(legacy);
    }

    const vcns: VcnResource[] = [];

    for (const region of regions) {
      const client = await this.factory.createVirtualNetworkClientAsync(region);
      for (const compartmentId of compartmentIds) {
        const normalizedCompartmentId = compartmentId.trim();
        if (!normalizedCompartmentId) continue;
        let page: string | undefined;
        do {
          const result = await client.listVcns({ compartmentId: normalizedCompartmentId, page });
          vcns.push(
            ...(result.items || []).map((vcn) => ({
              id: vcn.id || "",
              name: vcn.displayName || vcn.id || "Unnamed VCN",
              lifecycleState: (vcn.lifecycleState as string) || "UNKNOWN",
              compartmentId: normalizedCompartmentId,
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
      const ips: string[] = [];
      for (const node of nodesResult.items || []) {
        if (node.vnicId) {
          try {
            const vnic = (await vcnClient.getVnic({ vnicId: node.vnicId })).vnic;
            if (vnic?.privateIp) ips.push(vnic.privateIp);
            if (vnic?.publicIp) ips.push(vnic.publicIp);
          } catch { }
        }
      }
      dbSystem.nodeIps = ips.filter((v, i, a) => a.indexOf(v) === i); // Unique IPs
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
}

function splitRegions(raw: string): string[] {
  const regions = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return regions.length > 0 ? regions : [""];
}
