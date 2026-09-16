import { createRoot } from "react-dom/client"
import type { DesktopApi } from "../contracts.js"
import { App, BridgeMissing } from "./App.js"
import { DesktopProvider } from "./runtime.js"
import { DesktopViewStore } from "./state.js"
import { applyStoredTheme } from "./theme.js"

import "./styles/tokens.css"
import "./styles/themes.css"
import "./styles/global.css"
import "./components/components.css"
import "./shell/shell.css"
import "./features/conversation/conversation.css"
import "./features/models/models.css"
import "./features/palette/palette.css"
import "./features/agents/agents.css"
import "./features/canvas/canvas.css"
import "./features/settings/settings.css"
import "./features/onboarding/onboarding.css"

const container = document.getElementById("root")
if (!container) throw new Error("Missing #root element")

// Before the first render so the boot screen already uses the theme from last session.
applyStoredTheme()

const root = createRoot(container)

void bootstrap()

/**
 * Demo mode is UI-review tooling: it exists only in dev servers and bundles built with `--mode demo`, so release
 * builds neither contain the fixture nor honor the query flag. In a release build `?demo` falls through to the
 * real bridge.
 */
async function bootstrap() {
  const demoRequested = new URLSearchParams(location.search).has("demo")
  if (demoRequested && (import.meta.env.DEV || import.meta.env.MODE === "demo")) {
    const { createDemoRuntime } = await import("./demo/demo-runtime.js")
    mount(holdBootScreen(createDemoRuntime(window.otis)))
    return
  }
  const { isTauri } = await import("@tauri-apps/api/core")
  if (isTauri()) {
    try {
      const { createSidecarApi } = await import("../tauri/bridge.js")
      const api = await createSidecarApi()
      mount(api)
      void setupTray(api)
      void revealWindow()
    } catch (error) {
      console.error("Failed to connect to the desktop bridge:", error)
      root.render(<BridgeMissing />)
      void revealWindow()
    }
  } else if (window.otis) {
    mount(window.otis)
  } else {
    root.render(<BridgeMissing />)
  }
}

/**
 * The demo fixture resolves its snapshot in one tick, so the boot screen never paints. Hold the first snapshot
 * briefly to keep "Loading workspace…" reviewable; the real bridge shows it exactly as long as startup takes.
 */
function holdBootScreen(api: DesktopApi): DesktopApi {
  const getSnapshot = api.getSnapshot.bind(api)
  let held = false
  api.getSnapshot = async () => {
    if (!held) {
      held = true
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
    return getSnapshot()
  }
  return api
}

/** Wires the macOS status bar item off the same event stream the window renders from; a no-op off macOS. */
async function setupTray(api: DesktopApi) {
  const [{ createTauriTray }, { getCurrentWindow }] = await Promise.all([
    import("../tauri/tray.js"),
    import("@tauri-apps/api/window"),
  ])
  const tray = await createTauriTray({
    iconDir: "resources/tray",
    actions: {
      focusWindow: () => void getCurrentWindow().setFocus(),
      startNewSession: () => void api.startNewSession(),
      stop: () => void api.stop(),
      installUpdate: () => void api.installUpdate(),
    },
  })
  if (!tray) return
  api.subscribe((event) => {
    if (event.type === "status") tray.update(event.status)
  })
}

/** Matches tauri.conf.json's window "backgroundColor": "#1A1A1A". */
const WINDOW_BACKGROUND: [number, number, number] = [0x1a, 0x1a, 0x1a]

/**
 * The window is created with `visible: false` (see tauri.conf.json) so the user never sees a blank/white
 * webview before React paints. Sets the native background on both the window and the webview, then shows.
 * Waits two animation frames past mount() so the commit has actually painted; createRoot's initial render
 * isn't guaranteed synchronous.
 */
async function revealWindow() {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  try {
    const [{ getCurrentWindow }, { getCurrentWebview }] = await Promise.all([
      import("@tauri-apps/api/window"),
      import("@tauri-apps/api/webview"),
    ])
    const appWindow = getCurrentWindow()
    await appWindow.setBackgroundColor(WINDOW_BACKGROUND)
    await getCurrentWebview().setBackgroundColor(WINDOW_BACKGROUND)
    await appWindow.show()
  } catch (error) {
    console.error("Failed to show the window:", error)
  }
}

function mount(api: DesktopApi) {
  const store = new DesktopViewStore(api)
  void store.start()
  root.render(
    <DesktopProvider value={{ api, store }}>
      <App />
    </DesktopProvider>,
  )
}
