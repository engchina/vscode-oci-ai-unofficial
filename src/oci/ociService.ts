import * as vscode from "vscode";
import { OciClientFactory } from "./clientFactory";
import { AdbResource, ComputeResource } from "../types";

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
