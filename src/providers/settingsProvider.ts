import * as vscode from "vscode";

export class SettingsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element) {
      return [];
    }

    const openSettings = new vscode.TreeItem("Open Settings", vscode.TreeItemCollapsibleState.None);
    openSettings.description = "Profile, model, and extension preferences";
    openSettings.tooltip = "Open Settings";
    openSettings.iconPath = new vscode.ThemeIcon("settings-gear");
    openSettings.command = {
      command: "ociAi.openSettings",
      title: "Open Settings"
    };

    return [openSettings];
  }
}
