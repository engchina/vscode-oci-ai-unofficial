import * as vscode from "vscode";

const SECRET_KEYS = {
  tenancyOcid: "ociAi.tenancyOcid",
  userOcid: "ociAi.userOcid",
  fingerprint: "ociAi.fingerprint",
  privateKey: "ociAi.privateKey",
  privateKeyPassphrase: "ociAi.privateKeyPassphrase"
} as const;

export class AuthManager {
  constructor(private readonly context: vscode.ExtensionContext) {}

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
    const existingProfile = cfg.get<string>("profile", "DEFAULT");
    const existingRegion = cfg.get<string>("region", "");
    const existingCompartment = cfg.get<string>("compartmentId", "");
    const existingConfigPath = cfg.get<string>("configFilePath", "");

    const profile = await vscode.window.showInputBox({
      title: "OCI Profile",
      prompt: "Profile name in OCI config file",
      value: existingProfile || "DEFAULT",
      ignoreFocusOut: true
    });
    if (!profile) {
      return;
    }

    const region = await vscode.window.showInputBox({
      title: "OCI Region",
      prompt: "Optional region override (example: us-phoenix-1)",
      value: existingRegion,
      ignoreFocusOut: true
    });
    if (region === undefined) {
      return;
    }

    const compartmentId = await vscode.window.showInputBox({
      title: "Compartment OCID",
      prompt: "Compartment OCID for Compute and ADB operations",
      value: existingCompartment,
      ignoreFocusOut: true
    });
    if (compartmentId === undefined) {
      return;
    }

    const configFilePath = await vscode.window.showInputBox({
      title: "OCI Config File Path",
      prompt: "Optional custom config path. Leave empty to use ~/.oci/config",
      value: existingConfigPath,
      ignoreFocusOut: true
    });
    if (configFilePath === undefined) {
      return;
    }

    await cfg.update("profile", profile.trim() || "DEFAULT", vscode.ConfigurationTarget.Global);
    await cfg.update("region", region.trim(), vscode.ConfigurationTarget.Global);
    await cfg.update("compartmentId", compartmentId.trim(), vscode.ConfigurationTarget.Global);
    await cfg.update("configFilePath", configFilePath.trim(), vscode.ConfigurationTarget.Global);

    vscode.window.showInformationMessage("OCI profile settings updated.");
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
}
