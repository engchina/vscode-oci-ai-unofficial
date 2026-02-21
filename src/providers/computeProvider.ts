import * as vscode from "vscode";
import { OciService } from "../oci/ociService";
import { ComputeResource } from "../types";

export class ComputeTreeItem extends vscode.TreeItem {
  constructor(public readonly resource: ComputeResource) {
    super(resource.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "computeInstance";
    this.description = resource.lifecycleState;
    this.tooltip = `${resource.name}\n${resource.id}`;
  }
}

export class ComputeProvider implements vscode.TreeDataProvider<ComputeTreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ComputeTreeItem | undefined>();
  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly ociService: OciService) {}

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public getTreeItem(element: ComputeTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(): Promise<ComputeTreeItem[]> {
    try {
      const resources = await this.ociService.listComputeInstances();
      if (resources.length === 0) {
        const empty = new ComputeTreeItem({ id: "", name: "No Compute instances found", lifecycleState: "" });
        empty.contextValue = "message";
        return [empty];
      }
      return resources.map((resource) => new ComputeTreeItem(resource));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const item = new ComputeTreeItem({ id: "", name: `Error: ${message}`, lifecycleState: "" });
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
