import * as vscode from "vscode";

export class SettingsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element) {
      return [];
    }

    const openSettings = new vscode.TreeItem("Open OCI Settings", vscode.TreeItemCollapsibleState.None);
    openSettings.description = "Profile, model, and extension preferences";
    openSettings.tooltip = "Open OCI settings";
    openSettings.iconPath = new vscode.ThemeIcon("settings-gear");
    openSettings.command = {
      command: "ociAi.openSettings",
      title: "Open OCI Settings"
    };

    return [openSettings];
  }
}
