import { relaunch } from "@tauri-apps/plugin-process"
import { check, type Update } from "@tauri-apps/plugin-updater"
import type { DesktopUpdateState } from "../contracts.js"

const CHECK_INTERVAL_MS = 60 * 60 * 1000

/**
 * GitHub Releases auto-update via the Tauri updater plugin, ported from src/desktop/main/updater.ts. Checks on
 * launch and hourly; downloads in the background and reports progress to Settings, leaving the restart decision
 * to the user. Automatic and manual checks share one in-flight operation, including its download.
 *
 * Unlike the Electron version, a failed downloadAndInstall() rejection is the only failure signal — there is no
 * quit-lifecycle to infer failure from, so createInstallGuard has no equivalent here.
 */
export function startAutoUpdates(deps: { isPackaged: boolean; onState: (state: DesktopUpdateState) => void }): {
  check: () => Promise<void>
  install: () => Promise<void>
  isInstalling: () => boolean
} {
  if (!deps.isPackaged) {
    deps.onState({ status: "unavailable" })
    return { check: async () => {}, install: async () => {}, isInstalling: () => false }
  }

  let state: DesktopUpdateState = { status: "idle" }
  let pending: Promise<void> | undefined
  let installing = false
  let readyUpdate: Update | undefined
  const report = (next: DesktopUpdateState) => {
    state = next
    deps.onState(next)
  }

  const runCheck = async () => {
    report({ status: "checking" })
    try {
      const result = await check()
      if (!result) {
        // Unlike autoUpdater.checkForUpdates(), the Tauri updater plugin returns null both when this install
        // cannot check (no updater config) and when it is simply current — there is no way to tell them apart.
        report({ status: "current" })
        return
      }
      report({ status: "downloading", version: result.version })
      await result.download()
      readyUpdate = result
      report({ status: "ready", version: result.version })
    } catch {
      report({
        status: "error",
        message:
          state.status === "downloading"
            ? "The update couldn’t be downloaded. Please try again."
            : "Couldn’t check for updates. Please try again.",
      })
    }
  }
  const runCheckFn = (): Promise<void> => {
    if (pending) return pending
    if (installing || state.status === "ready") return Promise.resolve()
    pending = runCheck().finally(() => {
      pending = undefined
    })
    return pending
  }

  void runCheckFn()
  setInterval(() => void runCheckFn(), CHECK_INTERVAL_MS).unref?.()

  return {
    check: runCheckFn,
    isInstalling: () => installing,
    install: async () => {
      if (installing || state.status !== "ready" || !readyUpdate) return
      installing = true
      try {
        await readyUpdate.install()
        await relaunch()
      } catch {
        installing = false
        report({ status: "error", message: "The update couldn’t be installed. Please try again." })
      }
    },
  }
}
