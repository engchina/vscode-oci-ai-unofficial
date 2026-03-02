import type { ExecuteAdbSqlResponse } from "../../services/types"
import { WorkbenchSurface } from "./DatabaseWorkbenchChrome"

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "NULL"
  }
  if (typeof value === "string") {
    return value
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export default function WorkbenchQueryResult({ result }: { result: ExecuteAdbSqlResponse }) {
  return (
    <WorkbenchSurface>
      <div className="mb-2 text-[12px] text-description">{result.message}</div>
      {result.isSelect ? (
        <div className="max-h-[320px] overflow-auto rounded-[2px] border border-[var(--vscode-panel-border)]">
          <table className="min-w-full border-collapse text-[11px]">
            <thead className="sticky top-0 bg-[var(--vscode-list-hoverBackground)]">
              <tr>
                {result.columns.map((column) => (
                  <th key={column} className="border-b border-[var(--vscode-panel-border)] px-2 py-1.5 text-left font-semibold">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(result.columns.length, 1)} className="px-2 py-2 text-description">
                    No rows
                  </td>
                </tr>
              ) : (
                result.rows.map((row, index) => (
                  <tr key={`result-row-${index}`} className="odd:bg-[color-mix(in_srgb,var(--vscode-editor-background)_98%,white_2%)]">
                    {result.columns.map((column) => (
                      <td key={`${index}-${column}`} className="border-b border-[var(--vscode-panel-border)]/50 px-2 py-1.5 align-top">
                        {formatCell(row[column])}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-[12px] text-description">Rows affected: {result.rowsAffected}</div>
      )}
    </WorkbenchSurface>
  )
}
