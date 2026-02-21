import type { ReactNode } from "react"
import { ExtensionStateContextProvider } from "./context/ExtensionStateContext"

export function Providers({ children }: { children: ReactNode }) {
  return <ExtensionStateContextProvider>{children}</ExtensionStateContextProvider>
}
