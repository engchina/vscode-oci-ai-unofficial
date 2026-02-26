import * as os from "os";
import * as path from "path";
import * as common from "oci-common";
import * as compute from "oci-core";
import * as database from "oci-database";
import * as vscode from "vscode";
import { AuthManager } from "../auth/authManager";

export class OciClientFactory {
  private readonly fallbackNoticeKeys = new Set<string>();

  constructor(private readonly authManager: AuthManager) {}

  public getCompartmentId(): string {
    const compartmentId = this.authManager.getCompartmentId();
    if (!compartmentId) {
      throw new Error("Missing setting: ociAi.compartmentId");
    }
    return compartmentId;
  }

  /** Returns the active auth provider.
   *  Honors `ociAi.authMode`:
   *  - `api-key`: requires SecretStorage credentials and never falls back.
   *  - `config-file`: always reads OCI config file.
   *  - `auto`: prefers API key, falls back to OCI config file. */
  public async createAuthenticationProviderAsync(): Promise<common.AuthenticationDetailsProvider> {
    const secrets = await this.authManager.getApiKeySecrets();
    const missing: string[] = [];
    if (!secrets.tenancyOcid) missing.push("tenancyOcid");
    if (!secrets.userOcid) missing.push("userOcid");
    if (!secrets.fingerprint) missing.push("fingerprint");
    if (!secrets.privateKey) missing.push("privateKey");
    const hasApiKeySecrets = missing.length === 0;
    const authMode = this.authManager.getAuthMode();

    if (authMode === "api-key" && !hasApiKeySecrets) {
      const profile = this.authManager.getProfile() || "DEFAULT";
      throw new Error(
        `Auth mode is set to api-key, but required SecretStorage fields are missing for profile "${profile}": ${missing.join(", ")}`
      );
    }

    if (authMode === "config-file") {
      return this.createAuthenticationProvider();
    }

    if (hasApiKeySecrets) {
      return new common.SimpleAuthenticationDetailsProvider(
        secrets.tenancyOcid,
        secrets.userOcid,
        secrets.fingerprint,
        secrets.privateKey,
        secrets.privateKeyPassphrase || null
      );
    }
    return this.createAuthenticationProvider();
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

  /** Synchronous fallback — reads from OCI config file only. */
  public createComputeClient(): compute.ComputeClient {
    const authenticationDetailsProvider = this.createAuthenticationProvider();
    const client = new compute.ComputeClient({ authenticationDetailsProvider });
    const region = this.authManager.getRegion();
    if (region) {
      client.regionId = region;
    }
    return client;
  }

  public createDatabaseClient(): database.DatabaseClient {
    const authenticationDetailsProvider = this.createAuthenticationProvider();
    const client = new database.DatabaseClient({ authenticationDetailsProvider });
    const region = this.authManager.getRegion();
    if (region) {
      client.regionId = region;
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
      if (this.isMissingProfileError(error)) {
        const availableProfiles = this.listAvailableProfiles(configFilePath);
        const fallbackCandidates = this.getFallbackCandidates(profile, availableProfiles);
        for (const fallbackProfile of fallbackCandidates) {
          try {
            const provider = new common.ConfigFileAuthenticationDetailsProvider(configFilePath, fallbackProfile);
            this.showFallbackNoticeOnce(profile, fallbackProfile, configFilePath);
            return provider;
          } catch {
            // Try next candidate.
          }
        }
      }

      const message = this.getErrorMessage(error);
      vscode.window.showErrorMessage(`OCI auth initialization failed: ${message}`);
      throw error;
    }
  }

  private isMissingProfileError(error: unknown): boolean {
    return /No profile named .* exists in the configuration file/i.test(this.getErrorMessage(error));
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private listAvailableProfiles(configFilePath: string): string[] {
    try {
      const configFile = common.ConfigFileReader.parseFileFromPath(configFilePath, null);
      return Array.from(configFile.profileCredentials.configurationsByProfile.keys());
    } catch {
      return [];
    }
  }

  private getFallbackCandidates(currentProfile: string, availableProfiles: string[]): string[] {
    const normalizedCurrent = currentProfile.trim();
    const candidates = [
      common.ConfigFileReader.DEFAULT_PROFILE_NAME,
      ...availableProfiles,
    ];
    const deduped: string[] = [];
    for (const name of candidates) {
      const normalized = String(name ?? "").trim();
      if (!normalized || normalized === normalizedCurrent || deduped.includes(normalized)) {
        continue;
      }
      deduped.push(normalized);
    }
    return deduped;
  }

  private showFallbackNoticeOnce(requestedProfile: string, fallbackProfile: string, configFilePath: string): void {
    const key = `${requestedProfile}=>${fallbackProfile}@${configFilePath}`;
    if (this.fallbackNoticeKeys.has(key)) {
      return;
    }
    this.fallbackNoticeKeys.add(key);
    vscode.window.showWarningMessage(
      `OCI profile "${requestedProfile}" was not found in ${configFilePath}. Falling back to "${fallbackProfile}".`
    );
  }
}
