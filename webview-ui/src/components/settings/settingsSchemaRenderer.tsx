import { Bot, Plug } from "lucide-react"
import { Fragment } from "react"
import type { ReactNode } from "react"
import Card from "../ui/Card"
import Input from "../ui/Input"
import Textarea from "../ui/Textarea"
import Toggle from "../ui/Toggle"

export type SettingsSchemaIconName = "bot" | "plug"

export type SettingsSchemaFieldKind =
  | "int"
  | "float"
  | "string"
  | "textarea"
  | "toggle"
  | "notice"
  | "fileUpload"
  | "custom"

export type SettingsSchemaFieldSpec = {
  kind: SettingsSchemaFieldKind
  defaultValue: number | string | boolean | null
  uiInputType?: "text" | "password"
  min?: number
  max?: number
  step?: number
  uiLabel?: string
  uiHelpText?: string
  uiPlaceholder?: string
  textareaRows?: number
  uiFileAccept?: string
}

export type SettingsSchemaCard<K extends string> = {
  id: string
  title: string
  fields: readonly K[]
}

export type SettingsSchemaFieldUpdater<TValues, K extends keyof TValues = keyof TValues> = <Field extends K>(
  field: Field,
  value: TValues[Field],
) => void

export type SettingsSchemaCustomFieldRenderer<
  TValues extends object,
  K extends Extract<keyof TValues, string>,
> = (
  fieldKey: K,
  spec: SettingsSchemaFieldSpec,
  values: Pick<TValues, K>,
  updateField: SettingsSchemaFieldUpdater<TValues, K>,
) => ReactNode

export type SettingsSchemaCustomFieldRenderers<
  TValues extends object,
  K extends Extract<keyof TValues, string>,
> = Partial<Record<K, SettingsSchemaCustomFieldRenderer<TValues, K>>>

export type SettingsSchemaFileUploadHandler<K extends string> = (file: File | undefined) => void

export type SettingsSchemaRenderOptions<
  TValues extends object,
  K extends Extract<keyof TValues, string>,
> = {
  customRenderers?: SettingsSchemaCustomFieldRenderers<TValues, K>
  fileUploadHandlers?: Partial<Record<K, SettingsSchemaFileUploadHandler<K>>>
}

export function renderSettingsSchemaIcon(iconName: SettingsSchemaIconName | string | undefined, size: number): ReactNode {
  switch (iconName) {
    case "plug":
      return <Plug size={size} />
    case "bot":
    default:
      return <Bot size={size} />
  }
}

export function renderSettingsSchemaCards<
  TValues extends object,
  K extends Extract<keyof TValues, string>,
>(
  cards: ReadonlyArray<SettingsSchemaCard<K>>,
  specs: Record<K, SettingsSchemaFieldSpec>,
  values: Pick<TValues, K>,
  updateField: SettingsSchemaFieldUpdater<TValues, K>,
  options?: SettingsSchemaRenderOptions<TValues, K>,
): ReactNode {
  return cards.map((card) => (
    <Card key={card.id} title={card.title}>
      {renderSettingsSchemaFields(card.fields, specs, values, updateField, options)}
    </Card>
  ))
}

export function renderSettingsSchemaFields<
  TValues extends object,
  K extends Extract<keyof TValues, string>,
>(
  fields: ReadonlyArray<K>,
  specs: Record<K, SettingsSchemaFieldSpec>,
  values: Pick<TValues, K>,
  updateField: SettingsSchemaFieldUpdater<TValues, K>,
  options?: SettingsSchemaRenderOptions<TValues, K>,
): ReactNode {
  return fields.map((fieldKey) => (
    <Fragment key={fieldKey}>
      {renderSettingsSchemaField(fieldKey, specs, values, updateField, options)}
    </Fragment>
  ))
}

function renderSettingsSchemaField<
  TValues extends object,
  K extends Extract<keyof TValues, string>,
>(
  fieldKey: K,
  specs: Record<K, SettingsSchemaFieldSpec>,
  values: Pick<TValues, K>,
  updateField: SettingsSchemaFieldUpdater<TValues, K>,
  options?: SettingsSchemaRenderOptions<TValues, K>,
): ReactNode {
  const spec = specs[fieldKey]
  const value = values[fieldKey]
  const normalizedValue =
    typeof value === "number" || typeof value === "string" || typeof value === "boolean"
      ? value
      : spec.defaultValue
  const customRenderer = options?.customRenderers?.[fieldKey]

  if (spec.kind === "custom") {
    return customRenderer ? customRenderer(fieldKey, spec, values, updateField) : null
  }

  return (
    <>
      {spec.kind === "notice" ? (
        <div className="rounded-[2px] border border-[var(--vscode-panel-border)] bg-[color-mix(in_srgb,var(--vscode-editor-background)_94%,black_6%)] px-3 py-2">
          {spec.uiLabel && <div className="text-[13px] font-medium text-foreground">{spec.uiLabel}</div>}
          {spec.uiHelpText && <div className="mt-1 text-xs text-description">{spec.uiHelpText}</div>}
        </div>
      ) : spec.kind === "toggle" ? (
        <Toggle
          checked={Boolean(normalizedValue)}
          onChange={(checked) => updateField(fieldKey, checked as TValues[K])}
          label={spec.uiLabel}
          description={spec.uiHelpText}
        />
      ) : spec.kind === "fileUpload" ? (
        <>
          <div className="flex flex-col gap-1">
            {spec.uiLabel && <label className="text-[13px] leading-none text-foreground">{spec.uiLabel}</label>}
            <input
              type="file"
              accept={spec.uiFileAccept}
              onChange={(e) => options?.fileUploadHandlers?.[fieldKey]?.(e.target.files?.[0])}
              className="text-xs text-description file:mr-2 file:rounded-md file:border file:border-input-border file:bg-button-secondary-background file:px-2.5 file:py-1.5 file:text-xs file:text-button-secondary-foreground"
            />
          </div>
          {spec.uiHelpText && <p className="-mt-1 text-xs text-description">{spec.uiHelpText}</p>}
        </>
      ) : spec.kind === "textarea" ? (
        <Textarea
          id={fieldKey}
          label={spec.uiLabel}
          placeholder={spec.uiPlaceholder}
          value={String(normalizedValue)}
          rows={spec.textareaRows}
          onChange={(e) => updateField(
            fieldKey,
            parseSettingsSchemaInputValue(spec, e.target.value) as TValues[K],
          )}
        />
      ) : (
        <Input
          id={fieldKey}
          label={spec.uiLabel}
          type={spec.kind === "string" ? (spec.uiInputType ?? "text") : "number"}
          step={spec.step}
          min={spec.min}
          max={spec.max}
          placeholder={spec.uiPlaceholder}
          value={typeof normalizedValue === "string" || typeof normalizedValue === "number" ? normalizedValue : ""}
          onChange={(e) => updateField(
            fieldKey,
            parseSettingsSchemaInputValue(spec, e.target.value) as TValues[K],
          )}
        />
      )}
      {spec.uiHelpText && <p className="-mt-1 text-xs text-description">{spec.uiHelpText}</p>}
    </>
  )
}

function parseSettingsSchemaInputValue(spec: SettingsSchemaFieldSpec, rawValue: string): number | string {
  switch (spec.kind) {
    case "float":
      return parseFloatInput(rawValue, toNumber(typeof spec.defaultValue === "number" ? spec.defaultValue : 0, 0), spec.min ?? Number.NEGATIVE_INFINITY, spec.max ?? Number.POSITIVE_INFINITY)
    case "int":
      return parseIntInput(rawValue, toNumber(typeof spec.defaultValue === "number" ? spec.defaultValue : 0, 0), spec.min ?? Number.NEGATIVE_INFINITY, spec.max ?? Number.POSITIVE_INFINITY)
    case "string":
    case "textarea":
    case "toggle":
    case "notice":
    case "fileUpload":
    case "custom":
    default:
      return rawValue
  }
}

function toNumber(value: string | number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function parseIntInput(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.max(min, Math.min(max, parsed))
}

function parseFloatInput(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.max(min, Math.min(max, parsed))
}
