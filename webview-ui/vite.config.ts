import { writeFileSync } from "node:fs"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react-swc"
import { resolve } from "path"
import { defineConfig, type Plugin, type ViteDevServer } from "vite"

const writePortToFile = (): Plugin => {
  return {
    name: "write-port-to-file",
    configureServer(server: ViteDevServer) {
      server.httpServer?.once("listening", () => {
        const address = server.httpServer?.address()
        const port = typeof address === "object" && address ? address.port : null
        if (port) {
          writeFileSync(resolve(__dirname, ".vite-port"), port.toString())
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), writePortToFile()],
  build: {
    outDir: "build",
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
    chunkSizeWarningLimit: 100000,
  },
  server: {
    port: 25464,
    hmr: {
      host: "localhost",
      protocol: "ws",
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
      "@components": resolve(__dirname, "./src/components"),
      "@context": resolve(__dirname, "./src/context"),
    },
  },
})
