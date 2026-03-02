import type { ReactNode } from "react"
import { ExtensionStateContextProvider } from "./context/ExtensionStateContext"
import { WorkbenchInsightProvider } from "./context/WorkbenchInsightContext"

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ExtensionStateContextProvider>
      <WorkbenchInsightProvider>{children}</WorkbenchInsightProvider>
    </ExtensionStateContextProvider>
  )
}
