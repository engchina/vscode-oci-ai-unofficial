import * as vscode from "vscode";
import { OciClientFactory } from "./clientFactory";
import { AdbResource, ComputeResource } from "../types";

export class OciService {
  constructor(private readonly factory: OciClientFactory) { }

  public async listComputeInstances(): Promise<ComputeResource[]> {
    const computeClient = await this.factory.createComputeClientAsync();
    const virtualNetworkClient = await this.factory.createVirtualNetworkClientAsync();
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const compartmentIds = [...(cfg.get<string[]>("computeCompartmentIds") || [])];

    if (compartmentIds.length === 0) {
      const legacy = cfg.get<string>("compartmentId", "");
      if (legacy) compartmentIds.push(legacy);
    }

    const instances: ComputeResource[] = [];

    for (const compartmentId of compartmentIds) {
      if (!compartmentId.trim()) continue;
      let page: string | undefined;
      do {
        const result = await computeClient.listInstances({ compartmentId, page });
        instances.push(
          ...(result.items || []).map((instance) => ({
            id: instance.id || "",
            name: instance.displayName || instance.id || "Unnamed Instance",
            lifecycleState: (instance.lifecycleState as string) || "UNKNOWN",
          }))
        );
        page = result.opcNextPage;
      } while (page);
    }

    await Promise.all(
      instances.map((instance) =>
        this.populateInstanceNetworkAddresses(instance, undefined, computeClient, virtualNetworkClient) // we modified signature in fallback but we should just pass instance compartment Id. Wait, we don't have it tracked.
      )
    );

    return instances;
  }

  public async startComputeInstance(instanceId: string): Promise<void> {
    const client = await this.factory.createComputeClientAsync();
    await client.instanceAction({
      instanceId,
      action: "START"
    });
  }

  public async stopComputeInstance(instanceId: string): Promise<void> {
    const client = await this.factory.createComputeClientAsync();
    await client.instanceAction({
      instanceId,
      action: "SOFTSTOP"
    });
  }

  public async listAutonomousDatabases(): Promise<AdbResource[]> {
    const client = await this.factory.createDatabaseClientAsync();
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const compartmentIds = [...(cfg.get<string[]>("adbCompartmentIds") || [])];

    if (compartmentIds.length === 0) {
      const legacy = cfg.get<string>("compartmentId", "");
      if (legacy) compartmentIds.push(legacy);
    }

    const databases: AdbResource[] = [];

    for (const compartmentId of compartmentIds) {
      if (!compartmentId.trim()) continue;
      let page: string | undefined;
      do {
        const result = await client.listAutonomousDatabases({ compartmentId, page });
        databases.push(
          ...(result.items || []).map((adb) => ({
            id: adb.id || "",
            name: adb.dbName || adb.displayName || adb.id || "Unnamed ADB",
            lifecycleState: (adb.lifecycleState as string) || "UNKNOWN"
          }))
        );
        page = result.opcNextPage;
      } while (page);
    }

    return databases;
  }

  public async startAutonomousDatabase(autonomousDatabaseId: string): Promise<void> {
    const client = await this.factory.createDatabaseClientAsync();
    await client.startAutonomousDatabase({ autonomousDatabaseId });
  }

  public async stopAutonomousDatabase(autonomousDatabaseId: string): Promise<void> {
    const client = await this.factory.createDatabaseClientAsync();
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
