import { mkdir } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { sidecarRuntimeDirectory } from "../../local/paths.js"
import { loadLocalSettings } from "../../local/settings.js"
import { DesktopRuntime } from "../main/runtime.js"
import { resolveWorkspaceCwd } from "../main/workspace.js"
import { generateToken, writeBridgeFile } from "./auth.js"
import { createBridgeServer } from "./server.js"
import { createShutdownController } from "./shutdown.js"

/** Rust resolves the same `sidecarRuntimeDirectory()` path independently and passes it via `--runtime-dir`, so
 * both sides agree even though Rust can't import paths.ts; this is the authoritative value when present. */
function runtimeDirFromArgs(): string | undefined {
  const flagIndex = process.argv.indexOf("--runtime-dir")
  return flagIndex === -1 ? undefined : process.argv[flagIndex + 1]
}

async function main() {
  const lastWorkspace = (await loadLocalSettings()).lastWorkspace
  const cwd = resolveWorkspaceCwd(process.env, process.cwd(), homedir(), lastWorkspace)
  try {
    await mkdir(cwd, { recursive: true })
  } catch (cause) {
    // TODO(tauri-port): surface as a boot-error over the bridge instead of exit; see the plan's
    // "Known sharp edges" section — the sidecar cannot show a native dialog to recover the workspace.
    console.error(`Otis couldn't use its workspace at ${cwd}: ${cause instanceof Error ? cause.message : cause}`)
    process.exit(1)
  }

  const token = generateToken()
  let server: ReturnType<typeof createBridgeServer> | undefined
  const runtime = await DesktopRuntime.create({
    cwd,
    checkForUpdates: async () => {},
    installUpdate: async () => {},
    version: process.env.OTIS_VERSION ?? "0.0.0-dev",
    platform: process.platform,
    send: (event) => server?.broadcast(event),
  })

  const shutdownController = createShutdownController({ runtime })

  server = createBridgeServer({
    runtime,
    token,
    onClientConnected: () => shutdownController.onReconnect(),
    onClientDisconnected: () => shutdownController.onDisconnect(),
  })

  const bridgePath = join(runtimeDirFromArgs() ?? sidecarRuntimeDirectory(), "bridge.json")
  await writeBridgeFile(bridgePath, { port: server.port, token })

  console.error(`[sidecar] listening on 127.0.0.1:${server.port}, bridge file at ${bridgePath}`)

  const shutdownAndExit = async (signal: string) => {
    console.error(`[sidecar] received ${signal}, shutting down`)
    await shutdownController.requestShutdown()
    process.exit(0)
  }
  process.on("SIGTERM", () => void shutdownAndExit("SIGTERM"))
  process.on("SIGINT", () => void shutdownAndExit("SIGINT"))
  process.on("beforeExit", (code) => console.error(`[sidecar] beforeExit fired with code ${code}`))
}

void main()
