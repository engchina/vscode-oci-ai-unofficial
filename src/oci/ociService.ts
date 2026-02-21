import { OciClientFactory } from "./clientFactory";
import { AdbResource, ComputeResource } from "../types";

export class OciService {
  constructor(private readonly factory: OciClientFactory) {}

  public async listComputeInstances(): Promise<ComputeResource[]> {
    const client = await this.factory.createComputeClientAsync();
    const compartmentId = this.factory.getCompartmentId();
    const instances: ComputeResource[] = [];
    let page: string | undefined;

    do {
      const result = await client.listInstances({ compartmentId, page });
      instances.push(
        ...(result.items || []).map((instance) => ({
          id: instance.id || "",
          name: instance.displayName || instance.id || "Unnamed Instance",
          lifecycleState: (instance.lifecycleState as string) || "UNKNOWN"
        }))
      );
      page = result.opcNextPage;
    } while (page);

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
    const compartmentId = this.factory.getCompartmentId();
    const databases: AdbResource[] = [];
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
}
