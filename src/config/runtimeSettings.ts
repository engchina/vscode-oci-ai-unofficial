import * as vscode from "vscode";
import type { SaveSettingsRequest } from "../shared/services";
import runtimeSettingsMetadata from "./runtimeSettings.metadata.json";

export type RuntimeSettings = Pick<
  SaveSettingsRequest,
  | "shellIntegrationTimeoutSec"
  | "chatMaxTokens"
  | "chatTemperature"
  | "chatTopP"
  | "mcpFetchAutoPaginationMaxHops"
  | "mcpFetchAutoPaginationMaxTotalChars"
>;

type RuntimeSettingKey = keyof RuntimeSettings;
type RuntimeSettingSpec = {
  key: RuntimeSettingKey;
  defaultValue: number;
  min: number;
  max: number;
  step?: number;
  kind: "int" | "float";
  uiLabel?: string;
  uiHelpText?: string;
  uiPlaceholder?: string;
  description?: string;
  packageGroup?: "main" | "runtime";
};

const RUNTIME_SETTING_SPECS = runtimeSettingsMetadata as RuntimeSettingSpec[];

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = buildRuntimeSettings((spec) => spec.defaultValue);

export function readRuntimeSettings(
  cfg: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("ociAi"),
): RuntimeSettings {
  return buildRuntimeSettings((spec) => cfg.get<number>(spec.key, spec.defaultValue));
}

export async function saveRuntimeSettings(
  cfg: vscode.WorkspaceConfiguration,
  source: Partial<Record<RuntimeSettingKey, unknown>>,
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global,
): Promise<RuntimeSettings> {
  const normalized = normalizeRuntimeSettings(source);
  await Promise.all(
    RUNTIME_SETTING_SPECS.map((spec) => cfg.update(spec.key, normalized[spec.key], target)),
  );
  return normalized;
}

export function normalizeRuntimeSettings(
  source: Partial<Record<RuntimeSettingKey, unknown>>,
): RuntimeSettings {
  return buildRuntimeSettings((spec) => source[spec.key]);
}

export function readMcpFetchAutoPaginationSettings(
  cfg: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration("ociAi"),
): Pick<RuntimeSettings, "mcpFetchAutoPaginationMaxHops" | "mcpFetchAutoPaginationMaxTotalChars"> {
  const settings = readRuntimeSettings(cfg);
  return {
    mcpFetchAutoPaginationMaxHops: settings.mcpFetchAutoPaginationMaxHops,
    mcpFetchAutoPaginationMaxTotalChars: settings.mcpFetchAutoPaginationMaxTotalChars,
  };
}

function buildRuntimeSettings(
  resolveValue: (spec: RuntimeSettingSpec) => unknown,
): RuntimeSettings {
  const settings = {} as RuntimeSettings;
  for (const spec of RUNTIME_SETTING_SPECS) {
    settings[spec.key] = coerceRuntimeValue(resolveValue(spec), spec);
  }
  return settings;
}

function coerceRuntimeValue(value: unknown, spec: RuntimeSettingSpec): number {
  const numericValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return spec.defaultValue;
  }
  const normalized =
    spec.kind === "int"
      ? Math.trunc(numericValue)
      : numericValue;
  return Math.min(spec.max, Math.max(spec.min, normalized));
}
