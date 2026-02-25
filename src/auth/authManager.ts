import * as vscode from "vscode";

const SECRET_KEYS = {
  tenancyOcid: "ociAi.tenancyOcid",
  userOcid: "ociAi.userOcid",
  fingerprint: "ociAi.fingerprint",
  privateKey: "ociAi.privateKey",
  privateKeyPassphrase: "ociAi.privateKeyPassphrase"
} as const;

export type ApiKeySecrets = {
  tenancyOcid: string;
  userOcid: string;
  fingerprint: string;
  privateKey: string;
  privateKeyPassphrase: string;
};

export class AuthManager {
  constructor(private readonly context: vscode.ExtensionContext) { }

  public getProfile(): string {
    return vscode.workspace.getConfiguration("ociAi").get<string>("profile", "DEFAULT");
  }

  public getRegion(): string | undefined {
    const region = vscode.workspace.getConfiguration("ociAi").get<string>("region", "").trim();
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
    const currentActive = cfg.get<string>("activeProfile", "DEFAULT");
    const profilesConfig = cfg.get<{ name: string; compartments: { id: string; name: string }[] }[]>("profilesConfig", []);
    const profiles = Array.isArray(profilesConfig) ? profilesConfig : [];

    // Build QuickPick items from configured profiles
    type QpItem = vscode.QuickPickItem & { profileName: string };
    const items: QpItem[] = [];

    // Always include DEFAULT
    items.push({
      label: "DEFAULT",
      description: currentActive === "DEFAULT" ? "$(check) Active" : undefined,
      profileName: "DEFAULT",
    });

    // Add configured profiles
    for (const p of profiles) {
      if (p.name === "DEFAULT") continue; // avoid duplicate
      const compartmentCount = p.compartments?.length ?? 0;
      items.push({
        label: p.name,
        description: currentActive === p.name ? "$(check) Active" : undefined,
        detail: `${compartmentCount} compartment${compartmentCount !== 1 ? "s" : ""} configured`,
        profileName: p.name,
      });
    }

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: `Current: ${currentActive}`,
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

    await this.context.secrets.store(SECRET_KEYS.tenancyOcid, tenancyOcid.trim());
    await this.context.secrets.store(SECRET_KEYS.userOcid, userOcid.trim());
    await this.context.secrets.store(SECRET_KEYS.fingerprint, fingerprint.trim());
    await this.context.secrets.store(SECRET_KEYS.privateKey, privateKey.trim());
    await this.context.secrets.store(SECRET_KEYS.privateKeyPassphrase, passphrase.trim());

    vscode.window.showInformationMessage("SecretStorage updated for OCI API key fields.");
  }

  public async getApiKeySecrets(): Promise<ApiKeySecrets> {
    return {
      tenancyOcid: (await this.context.secrets.get(SECRET_KEYS.tenancyOcid)) ?? "",
      userOcid: (await this.context.secrets.get(SECRET_KEYS.userOcid)) ?? "",
      fingerprint: (await this.context.secrets.get(SECRET_KEYS.fingerprint)) ?? "",
      privateKey: (await this.context.secrets.get(SECRET_KEYS.privateKey)) ?? "",
      privateKeyPassphrase: (await this.context.secrets.get(SECRET_KEYS.privateKeyPassphrase)) ?? ""
    };
  }

  public async updateCompartmentId(compartmentId: string): Promise<void> {
    await vscode.workspace
      .getConfiguration("ociAi")
      .update("compartmentId", compartmentId.trim(), vscode.ConfigurationTarget.Global);
  }

  public async updateRegion(region: string): Promise<void> {
    await vscode.workspace
      .getConfiguration("ociAi")
      .update("region", region.trim(), vscode.ConfigurationTarget.Global);
  }

  public async updateApiKeySecrets(input: ApiKeySecrets): Promise<void> {
    await this.context.secrets.store(SECRET_KEYS.tenancyOcid, input.tenancyOcid.trim());
    await this.context.secrets.store(SECRET_KEYS.userOcid, input.userOcid.trim());
    await this.context.secrets.store(SECRET_KEYS.fingerprint, input.fingerprint.trim());
    await this.context.secrets.store(SECRET_KEYS.privateKey, input.privateKey.trim());
    await this.context.secrets.store(SECRET_KEYS.privateKeyPassphrase, input.privateKeyPassphrase.trim());
  }
}
