import * as common from "oci-common";
import * as compute from "oci-core";
import * as database from "oci-database";
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

  /** Returns the active auth provider using SecretStorage API key material only. */
  public async createAuthenticationProviderAsync(): Promise<common.AuthenticationDetailsProvider> {
    const secrets = await this.authManager.getApiKeySecrets();
    const missing: string[] = [];
    if (!secrets.tenancyOcid) missing.push("tenancyOcid");
    if (!secrets.userOcid) missing.push("userOcid");
    if (!secrets.fingerprint) missing.push("fingerprint");
    if (!secrets.privateKey) missing.push("privateKey");
    if (missing.length > 0) {
      const profile = this.authManager.getProfile() || "DEFAULT";
      throw new Error(
        `Required SecretStorage API key fields are missing for profile "${profile}": ${missing.join(", ")}`
      );
    }

    return new common.SimpleAuthenticationDetailsProvider(
      secrets.tenancyOcid,
      secrets.userOcid,
      secrets.fingerprint,
      secrets.privateKey,
      secrets.privateKeyPassphrase || null
    );
  }

  public async createComputeClientAsync(regionOverride?: string): Promise<compute.ComputeClient> {
    const authenticationDetailsProvider = await this.createAuthenticationProviderAsync();
    const client = new compute.ComputeClient({ authenticationDetailsProvider });
    const region = (regionOverride ?? this.authManager.getRegion() ?? "").trim();
    if (region) {
      client.regionId = region;
    }
    return client;
  }

  public async createVirtualNetworkClientAsync(regionOverride?: string): Promise<compute.VirtualNetworkClient> {
    const authenticationDetailsProvider = await this.createAuthenticationProviderAsync();
    const client = new compute.VirtualNetworkClient({ authenticationDetailsProvider });
    const region = (regionOverride ?? this.authManager.getRegion() ?? "").trim();
    if (region) {
      client.regionId = region;
    }
    return client;
  }

  public async createDatabaseClientAsync(regionOverride?: string): Promise<database.DatabaseClient> {
    const authenticationDetailsProvider = await this.createAuthenticationProviderAsync();
    const client = new database.DatabaseClient({ authenticationDetailsProvider });
    const region = (regionOverride ?? this.authManager.getRegion() ?? "").trim();
    if (region) {
      client.regionId = region;
    }
    return client;
  }

}
