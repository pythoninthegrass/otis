import { join } from "node:path"
import { Image } from "@tauri-apps/api/image"
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu"
import { TrayIcon } from "@tauri-apps/api/tray"
import type { DesktopStatus } from "../contracts.js"

/**
 * The macOS status bar item (menu bar extra), ported from src/desktop/main/tray.ts for the Tauri renderer. The
 * icon is a glanceable activity signal — idle, working, or "needs your approval" — and the menu carries the quick
 * actions. State comes from the same status stream the window sees, and the menu is rebuilt from the latest status
 * at every open, so the tray never drifts from the window.
 */

/** Which template icon the tray shows. Template images are black + alpha; the system tints them per appearance. */
export type TrayIconKey = "idle" | "working" | "alert"

const TRAY_ICON_FILES: Record<TrayIconKey, { base: string; retina: string }> = {
  idle: { base: "otisIdleTemplate.png", retina: "otisIdleTemplate@2x.png" },
  working: { base: "otisWorkingTemplate.png", retina: "otisWorkingTemplate@2x.png" },
  alert: { base: "otisAlertTemplate.png", retina: "otisAlertTemplate@2x.png" },
}

/** The status subset that drives the glanceable state. */
export type TrayState = Pick<DesktopStatus, "busy" | "phase" | "permission" | "modelLoad" | "modelState">

/**
 * The glanceable state: a pending approval outranks activity, because an agent blocked on the user is the one
 * state that needs action. Model work (a turn, a local model booting, a download in flight) reads as working.
 */
export function trayIconKey(status: TrayState): TrayIconKey {
  if (status.permission) return "alert"
  if (status.busy || status.phase !== "idle") return "working"
  if (status.modelState === "starting") return "working"
  if (status.modelLoad?.status.kind === "progress") return "working"
  return "idle"
}

export function trayTooltip(status: TrayState): string {
  const key = trayIconKey(status)
  if (key === "alert") return "Otis — needs your approval"
  if (key === "working") {
    if (status.modelLoad?.status.kind === "progress" || status.modelState === "starting") {
      return "Otis — preparing a model"
    }
    return status.phase === "thinking" ? "Otis — thinking" : "Otis — working"
  }
  return "Otis — ready"
}

export type TrayActions = {
  focusWindow(): void
  startNewSession(): void
  stop(): void
  installUpdate(): void
}

/**
 * Orders the two writers that feed the status bar item: the live status stream and the one-shot seed snapshot.
 * The seed's `busy`/`phase` are captured before its session listing finishes resolving, so when a live status
 * lands while the seed is still in flight, the seed describes an older moment by the time it arrives — applying
 * it would drag the icon back to a stale state until the next event. Every live status applies; the seed applies
 * only while nothing live has been seen yet.
 */
export function trayStatusGate(tray: Pick<StatusTray, "onStatus">) {
  let live = false
  return {
    applyLive(status: DesktopStatus) {
      live = true
      tray.onStatus(status)
    },
    applySeed(status: DesktopStatus) {
      if (!live) tray.onStatus(status)
    },
  }
}

export type StatusTray = {
  onStatus(status: DesktopStatus): void
  destroy(): void
}

function modelLabel(status: DesktopStatus): string {
  if (!status.model || status.modelState === "unconfigured") return "No model selected"
  if (status.modelState === "starting") return "Starting model…"
  if (status.modelState === "failed") return "Model failed to start"
  return `Model: ${status.model.displayName ?? shortModelId(status.model.id)}`
}

/** Mirrors formatTokenCount in the renderer (this module must stay renderer-agnostic otherwise). */
function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}

/** Mirrors shortModelId in the renderer: `accounts/fireworks/models/x` → `x`. */
function shortModelId(id: string): string {
  const segments = id.split("/")
  return segments[segments.length - 1] ?? id
}

/**
 * Builds the tray menu's item options, mirroring buildTrayMenu's business rules (electron main/tray.ts) against
 * Tauri's menu item shape. Informational rows lead, disabled; actions and the update row follow.
 */
async function buildTrayMenuItems(status: DesktopStatus, actions: TrayActions) {
  const items: Array<MenuItem | PredefinedMenuItem> = []
  if (status.session) items.push(await MenuItem.new({ text: status.session.title, enabled: false }))
  items.push(await MenuItem.new({ text: modelLabel(status), enabled: false }))
  items.push(await MenuItem.new({ text: status.workspace.label, enabled: false }))
  if (status.contextTokens !== undefined) {
    items.push(
      await MenuItem.new({
        text: `Context ${formatTokenCount(status.contextTokens)} of ${formatTokenCount(status.contextLimit)}`,
        enabled: false,
      }),
    )
  }
  if (status.modelLoad?.status.kind === "progress") {
    items.push(await MenuItem.new({ text: status.modelLoad.status.label, enabled: false }))
  }
  const runningCoworkers = status.subagents.filter((subagent) => subagent.status === "running").length
  if (runningCoworkers > 0)
    items.push(await MenuItem.new({ text: `Coworkers: ${runningCoworkers} running`, enabled: false }))

  items.push(await PredefinedMenuItem.new({ item: "Separator" }))
  if (status.permission) {
    items.push(
      await MenuItem.new({ text: `Needs approval: ${status.permission.label}`, action: () => actions.focusWindow() }),
    )
  }
  // Mirrors the header button: a fresh start is refused mid-turn, so it is disabled while busy.
  items.push(
    await MenuItem.new({ text: "Fresh start", enabled: !status.busy, action: () => actions.startNewSession() }),
  )
  if (status.busy) items.push(await MenuItem.new({ text: "Stop working", action: () => actions.stop() }))
  items.push(await MenuItem.new({ text: "Show Otis", action: () => actions.focusWindow() }))

  if (status.update.status === "ready" || status.update.status === "downloading") {
    items.push(await PredefinedMenuItem.new({ item: "Separator" }))
    items.push(
      status.update.status === "ready"
        ? await MenuItem.new({
            text: `Restart to update — ${status.update.version}`,
            action: () => actions.installUpdate(),
          })
        : await MenuItem.new({ text: `Downloading update — ${status.update.version}`, enabled: false }),
    )
  }
  items.push(
    await PredefinedMenuItem.new({ item: "Separator" }),
    await PredefinedMenuItem.new({ item: "Quit", text: "Quit Otis" }),
  )
  return items
}

export type CreateTauriTrayOptions = { iconDir: string; actions: TrayActions }

/**
 * TODO: the macOS-only gate should come from Rust (cfg!(target_os = "macos")) once that wiring exists; for now
 * check navigator.platform since @tauri-apps/plugin-os is not yet a dependency.
 */
function isMacOS(): boolean {
  return navigator.platform.toLowerCase().includes("mac")
}

async function loadTrayIcon(dir: string, key: TrayIconKey): Promise<Image | undefined> {
  const image = await Image.fromPath(join(dir, TRAY_ICON_FILES[key].retina)).catch(() => undefined)
  return image
}

/**
 * Creates the status bar item, or undefined off macOS or when the template icons are missing (the tray is a
 * convenience, never a launch dependency). The menu is rebuilt from the latest status on every `update` call.
 */
export async function createTauriTray(
  options: CreateTauriTrayOptions,
): Promise<{ update(status: DesktopStatus): void; destroy(): void } | undefined> {
  if (!isMacOS()) return undefined
  const idleIcon = await loadTrayIcon(options.iconDir, "idle")
  if (!idleIcon) {
    console.warn(`Unable to load the tray icons from ${options.iconDir}; the status bar item is disabled.`)
    return undefined
  }
  let iconKey: TrayIconKey = "idle"
  let tooltip = "Otis — ready"
  const tray = await TrayIcon.new({ icon: idleIcon, tooltip, iconAsTemplate: true })
  let latestStatus: DesktopStatus | undefined
  const refreshMenu = async () => {
    const items = latestStatus
      ? await buildTrayMenuItems(latestStatus, options.actions)
      : [
          await MenuItem.new({ text: "Starting Otis…", enabled: false }),
          await MenuItem.new({ text: "Show Otis", action: () => options.actions.focusWindow() }),
          await PredefinedMenuItem.new({ item: "Quit", text: "Quit Otis" }),
        ]
    await tray.setMenu(await Menu.new({ items }))
  }
  await refreshMenu()
  return {
    update(status) {
      latestStatus = status
      const nextIconKey = trayIconKey(status)
      const nextTooltip = trayTooltip(status)
      void refreshMenu()
      if (nextIconKey !== iconKey) {
        iconKey = nextIconKey
        void loadTrayIcon(options.iconDir, nextIconKey).then((icon) => icon && tray.setIcon(icon))
      }
      if (nextTooltip !== tooltip) {
        tooltip = nextTooltip
        void tray.setTooltip(tooltip)
      }
    },
    destroy() {
      void tray.close()
    },
  }
}
