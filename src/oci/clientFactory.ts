import * as os from "os";
import * as path from "path";
import * as common from "oci-common";
import * as compute from "oci-core";
import * as database from "oci-database";
import * as vscode from "vscode";
import { AuthManager } from "../auth/authManager";

export class OciClientFactory {
  constructor(private readonly authManager: AuthManager) {}

  public getCompartmentId(): string {
    const compartmentId = this.authManager.getCompartmentId();
    if (!compartmentId) {
      throw new Error("Missing setting: ociAi.compartmentId");
    }
    return compartmentId;
  }

  public createComputeClient(): compute.ComputeClient {
    const authenticationDetailsProvider = this.createAuthenticationProvider();
    const client = new compute.ComputeClient({ authenticationDetailsProvider });
    const region = this.authManager.getRegion();
    if (region) {
      client.region = region;
    }
    return client;
  }

  public createDatabaseClient(): database.DatabaseClient {
    const authenticationDetailsProvider = this.createAuthenticationProvider();
    const client = new database.DatabaseClient({ authenticationDetailsProvider });
    const region = this.authManager.getRegion();
    if (region) {
      client.region = region;
    }
    return client;
  }

  public createAuthenticationProvider(): common.ConfigFileAuthenticationDetailsProvider {
    const profile = this.authManager.getProfile();
    const configuredPath = this.authManager.getConfigFilePath();
    const configFilePath = configuredPath || path.join(os.homedir(), ".oci", "config");

    if (!profile) {
      throw new Error("Missing setting: ociAi.profile");
    }

    try {
      return new common.ConfigFileAuthenticationDetailsProvider(configFilePath, profile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`OCI auth initialization failed: ${message}`);
      throw error;
    }
  }
}
