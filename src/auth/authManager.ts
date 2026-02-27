import * as vscode from "vscode";

const SECRET_FIELDS = ["tenancyOcid", "userOcid", "fingerprint", "privateKey", "privateKeyPassphrase"] as const;
const AUTH_MODES = ["auto", "api-key", "config-file"] as const;

function secretKey(profile: string, field: typeof SECRET_FIELDS[number]): string {
  return `ociAi.${profile}.${field}`;
}

function getProfileRegionMap(): Record<string, string> {
  const cfg = vscode.workspace.getConfiguration("ociAi");
  const raw = cfg.get<Record<string, string>>("profileRegionMap", {});
  return raw && typeof raw === "object" ? raw : {};
}

export type ApiKeySecrets = {
  tenancyOcid: string;
  userOcid: string;
  fingerprint: string;
  privateKey: string;
  privateKeyPassphrase: string;
};

export type AuthMode = typeof AUTH_MODES[number];

export class AuthManager {
  constructor(private readonly context: vscode.ExtensionContext) { }

  public getAuthMode(): AuthMode {
    const mode = String(
      vscode.workspace.getConfiguration("ociAi").get<string>("authMode", "auto")
    ).trim() as AuthMode;
    return (AUTH_MODES as readonly string[]).includes(mode) ? mode : "auto";
  }

  public getProfile(): string {
    const raw = vscode.workspace.getConfiguration("ociAi").get<string>("profile", "DEFAULT");
    const normalized = String(raw ?? "").trim();
    return normalized.length > 0 ? normalized : "DEFAULT";
  }

  public getRegion(): string | undefined {
    const profile = this.getProfile();
    const profileRegion = getProfileRegionMap()[profile];
    const region = String(
      profileRegion ?? vscode.workspace.getConfiguration("ociAi").get<string>("region", "")
    ).trim();
    return region.length > 0 ? region : undefined;
  }

  public getCompartmentId(): string | undefined {
    const compartmentId = vscode.workspace
      .getConfiguration("ociAi")
      .get<string>("compartmentId", "")
      .trim();
    return compartmentId.length > 0 ? compartmentId : undefined;
  }

  public getConfigFilePath(): string | undefined {
    const configFilePath = vscode.workspace
      .getConfiguration("ociAi")
      .get<string>("configFilePath", "")
      .trim();
    return configFilePath.length > 0 ? configFilePath : undefined;
  }

  public async configureProfileInteractive(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const rawActiveProfile = cfg.get<string>("activeProfile", "").trim();
    const currentActive = rawActiveProfile.length > 0 ? rawActiveProfile : undefined;
    const profilesConfig = cfg.get<{ name: string; compartments: { id: string; name: string }[] }[]>("profilesConfig", []);
    const profiles = Array.isArray(profilesConfig) ? profilesConfig : [];
    const getCompartmentCount = (profileName: string): number =>
      (profiles.find(p => p.name === profileName)?.compartments?.length ?? 0) + 1;
    const formatProfileDisplay = (profileName: string, compartmentCount: number): string =>
      `${profileName} (${compartmentCount} Compartments)`;

    // Build QuickPick items from configured profiles only
    type QpItem = vscode.QuickPickItem & { profileName: string };
    const items: QpItem[] = [];

    for (const p of profiles) {
      const compartmentCount = (p.compartments?.length ?? 0) + 1;
      items.push({
        label: formatProfileDisplay(p.name, compartmentCount),
        description: currentActive === p.name ? "$(check) Active" : undefined,
        profileName: p.name,
      });
    }

    const currentProfileDisplay = currentActive
      ? formatProfileDisplay(currentActive, getCompartmentCount(currentActive))
      : "Please select a profile";

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `Profile: ${currentProfileDisplay}`,
      title: "Switch Active Profile",
    });
    if (!picked) return;

    const targetProfile = picked.profileName;

    if (targetProfile === currentActive) {
      return; // no change needed
    }

    await cfg.update("activeProfile", targetProfile, vscode.ConfigurationTarget.Global);
    await cfg.update("profile", targetProfile, vscode.ConfigurationTarget.Global);

    vscode.window.showInformationMessage(`Switched to profile: ${targetProfile}`);
  }

  public async configureApiKeyInteractive(): Promise<void> {
    const tenancyOcid = await vscode.window.showInputBox({
      title: "Tenancy OCID",
      prompt: "Optional. Stored in SecretStorage for future auth modes",
      ignoreFocusOut: true
    });
    if (tenancyOcid === undefined) {
      return;
    }

    const userOcid = await vscode.window.showInputBox({
      title: "User OCID",
      prompt: "Optional. Stored in SecretStorage",
      ignoreFocusOut: true
    });
    if (userOcid === undefined) {
      return;
    }

    const fingerprint = await vscode.window.showInputBox({
      title: "API Key Fingerprint",
      prompt: "Optional. Stored in SecretStorage",
      ignoreFocusOut: true
    });
    if (fingerprint === undefined) {
      return;
    }

    const privateKey = await vscode.window.showInputBox({
      title: "Private Key Content",
      prompt: "Paste private key content if you do not want to use config file key_path",
      password: true,
      ignoreFocusOut: true
    });
    if (privateKey === undefined) {
      return;
    }

    const passphrase = await vscode.window.showInputBox({
      title: "Private Key Passphrase",
      prompt: "Optional passphrase",
      password: true,
      ignoreFocusOut: true
    });
    if (passphrase === undefined) {
      return;
    }

    const profile = this.getProfile();
    await this.context.secrets.store(secretKey(profile, "tenancyOcid"), tenancyOcid.trim());
    await this.context.secrets.store(secretKey(profile, "userOcid"), userOcid.trim());
    await this.context.secrets.store(secretKey(profile, "fingerprint"), fingerprint.trim());
    await this.context.secrets.store(secretKey(profile, "privateKey"), privateKey.trim());
    await this.context.secrets.store(secretKey(profile, "privateKeyPassphrase"), passphrase.trim());

    vscode.window.showInformationMessage("SecretStorage updated for OCI API key fields.");
  }

  public async getApiKeySecrets(profile?: string): Promise<ApiKeySecrets> {
    const p = profile ?? this.getProfile();
    return {
      tenancyOcid: (await this.context.secrets.get(secretKey(p, "tenancyOcid"))) ?? "",
      userOcid: (await this.context.secrets.get(secretKey(p, "userOcid"))) ?? "",
      fingerprint: (await this.context.secrets.get(secretKey(p, "fingerprint"))) ?? "",
      privateKey: (await this.context.secrets.get(secretKey(p, "privateKey"))) ?? "",
      privateKeyPassphrase: (await this.context.secrets.get(secretKey(p, "privateKeyPassphrase"))) ?? ""
    };
  }

  public async updateCompartmentId(compartmentId: string): Promise<void> {
    await vscode.workspace
      .getConfiguration("ociAi")
      .update("compartmentId", compartmentId.trim(), vscode.ConfigurationTarget.Global);
  }

  public async updateRegion(region: string): Promise<void> {
    await this.updateRegionForProfile(this.getProfile(), region);
  }

  public async getRegionForProfile(profile: string): Promise<string> {
    const profileRegion = getProfileRegionMap()[profile];
    if (typeof profileRegion === "string" && profileRegion.trim().length > 0) {
      return profileRegion.trim();
    }
    // Return empty string for profiles without a saved region
    // This prevents showing region from a different profile when switching to a new one
    return "";
  }

  public async updateRegionForProfile(profile: string, region: string): Promise<void> {
    const trimmedProfile = profile.trim() || "DEFAULT";
    const trimmedRegion = region.trim();
    const cfg = vscode.workspace.getConfiguration("ociAi");
    const current = getProfileRegionMap();
    const next = { ...current, [trimmedProfile]: trimmedRegion };
    await cfg.update("profileRegionMap", next, vscode.ConfigurationTarget.Global);
    await cfg.update("region", trimmedRegion, vscode.ConfigurationTarget.Global);
  }

  public async updateApiKeySecrets(input: ApiKeySecrets, profile?: string): Promise<void> {
    const p = profile ?? this.getProfile();
    await this.context.secrets.store(secretKey(p, "tenancyOcid"), input.tenancyOcid.trim());
    await this.context.secrets.store(secretKey(p, "userOcid"), input.userOcid.trim());
    await this.context.secrets.store(secretKey(p, "fingerprint"), input.fingerprint.trim());
    await this.context.secrets.store(secretKey(p, "privateKey"), input.privateKey.trim());
    await this.context.secrets.store(secretKey(p, "privateKeyPassphrase"), input.privateKeyPassphrase.trim());
  }
}
