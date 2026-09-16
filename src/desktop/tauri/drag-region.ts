import { getCurrentWindow } from "@tauri-apps/api/window"

/**
 * Electron's BrowserWindow drags the window for any element styled `-webkit-app-region: drag` (see shell.css,
 * settings.css, agents.css, onboarding.css); WKWebView doesn't implement that property at all, so under Tauri
 * nothing happens on mousedown. Reuses the same class names already marking those regions — and the `.noDrag`
 * opt-out already applied to every interactive element inside them — as the one source of truth, rather than
 * introducing a second "is this draggable" marker in the markup.
 */
const DRAG_REGION_SELECTOR = ".workspaceHeader, .settingsPage-header, .workspaceRail-header, .onboarding-topbar"

/** Wires native window dragging for Tauri. Single click-drag moves the window; double-click toggles maximize,
 * matching the native title-bar convention. Returns an unsubscribe. */
export function initTitleBarDrag(): () => void {
  const appWindow = getCurrentWindow()
  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) return
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest(".noDrag")) return
    if (!target.closest(DRAG_REGION_SELECTOR)) return
    event.preventDefault()
    if (event.detail === 2) void appWindow.toggleMaximize()
    else void appWindow.startDragging()
  }
  window.addEventListener("mousedown", onMouseDown)
  return () => window.removeEventListener("mousedown", onMouseDown)
}
