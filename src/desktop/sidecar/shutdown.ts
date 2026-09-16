export type ShutdownRuntime = { shutdown(): Promise<void> }

export type ShutdownControllerOptions = {
  runtime: ShutdownRuntime
  /** How long a disconnected client has to reconnect before the watchdog shuts the process down. */
  watchdogMs?: number
  /** Injectable so tests don't kill the test runner. */
  exit?: () => void
}

export type ShutdownController = {
  /** Arms the watchdog. A no-op while one is already pending. */
  onDisconnect(): void
  /** Cancels a pending watchdog. */
  onReconnect(): void
  /** The explicit shutdown RPC path. */
  requestShutdown(): Promise<void>
}

/**
 * runtime.shutdown() must run at most once even when the watchdog fires and the shutdown RPC arrives
 * concurrently — Application.shutdown() must complete or llama-server children are orphaned.
 */
export function createShutdownController(options: ShutdownControllerOptions): ShutdownController {
  const { runtime, watchdogMs = 2000, exit = () => process.exit(0) } = options
  let watchdog: ReturnType<typeof setTimeout> | undefined
  let shuttingDown: Promise<void> | undefined

  function runShutdownOnce(): Promise<void> {
    if (!shuttingDown) shuttingDown = runtime.shutdown()
    return shuttingDown
  }

  return {
    onDisconnect() {
      if (watchdog || shuttingDown) return
      console.error(`[sidecar] client disconnected, watchdog armed for ${watchdogMs}ms`)
      watchdog = setTimeout(() => {
        watchdog = undefined
        console.error("[sidecar] watchdog elapsed with no reconnect, shutting down")
        void runShutdownOnce().then(() => exit())
      }, watchdogMs)
    },
    onReconnect() {
      if (watchdog) {
        clearTimeout(watchdog)
        watchdog = undefined
      }
    },
    async requestShutdown() {
      if (watchdog) {
        clearTimeout(watchdog)
        watchdog = undefined
      }
      await runShutdownOnce()
    },
  }
}
