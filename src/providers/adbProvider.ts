import * as vscode from "vscode";
import { OciService } from "../oci/ociService";
import { AdbResource } from "../types";

export class AdbTreeItem extends vscode.TreeItem {
  constructor(public readonly resource: AdbResource) {
    super(resource.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "adbInstance";
    this.description = resource.lifecycleState;
    this.tooltip = `${resource.name}\n${resource.id}`;
  }
}

export class AdbProvider implements vscode.TreeDataProvider<AdbTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<AdbTreeItem | undefined>();
  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly ociService: OciService) {}

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public getTreeItem(element: AdbTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(): Promise<AdbTreeItem[]> {
    try {
      const resources = await this.ociService.listAutonomousDatabases();
      if (resources.length === 0) {
        const empty = new AdbTreeItem({ id: "", name: "No ADB instances found", lifecycleState: "" });
        empty.contextValue = "message";
        return [empty];
      }
      return resources.map((resource) => new AdbTreeItem(resource));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const item = new AdbTreeItem({ id: "", name: `Error: ${message}`, lifecycleState: "" });
      item.contextValue = "message";
      if (message.includes("Missing setting: ociAi.compartmentId")) {
        item.description = "Click to open OCI settings";
        item.command = {
          command: "ociAi.openSettings",
          title: "Open OCI Settings"
        };
      }
      return [item];
    }
  }
}
