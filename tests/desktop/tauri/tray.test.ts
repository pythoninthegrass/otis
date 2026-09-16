import { describe, expect, it } from "vitest"
import type { DesktopStatus } from "../../../src/desktop/contracts.js"
import {
  type StatusTray,
  type TrayIconKey,
  trayIconKey,
  trayStatusGate,
  trayTooltip,
} from "../../../src/desktop/tauri/tray.js"

function statusFixture(overrides: Partial<DesktopStatus> = {}): DesktopStatus {
  return {
    busy: false,
    phase: "idle",
    model: {
      id: "accounts/fireworks/models/kimi-k2",
      provider: "fireworks",
      supportsImageInput: false,
      displayName: "Kimi K2",
    },
    modelState: "ready",
    modelError: undefined,
    session: { id: "s1", title: "Fix session lock behavior" },
    needsWorkspace: false,
    sessions: [],
    workspace: { label: "otis", path: "/Users/n/dev/otis" },
    contextTokens: 41_234,
    contextLimit: 200_000,
    diffs: { added: 12, removed: 3 },
    permission: null,
    stats: undefined,
    modelLoad: null,
    subagents: [],
    agentsPanelVisible: true,
    theme: "default",
    thinkingVisible: true,
    permissionMode: "ask",
    fastServing: { available: false, enabled: false },
    hostedConfigured: true,
    pairConfigured: false,
    pairEndpoints: {},
    debug: false,
    update: { status: "idle" },
    ...overrides,
  }
}

describe("trayIconKey", () => {
  it("is idle when nothing is in flight", () => {
    expect(trayIconKey(statusFixture())).toBe("idle")
  })

  it("is working while a turn is busy or mid-phase", () => {
    expect(trayIconKey(statusFixture({ busy: true }))).toBe("working")
    expect(trayIconKey(statusFixture({ phase: "thinking" }))).toBe("working")
    expect(trayIconKey(statusFixture({ phase: "working" }))).toBe("working")
  })

  it("is working while the model boots or a download is in flight", () => {
    expect(trayIconKey(statusFixture({ modelState: "starting" }))).toBe("working")
    expect(
      trayIconKey(statusFixture({ modelLoad: { modelId: "m", status: { label: "Downloading…", kind: "progress" } } })),
    ).toBe("working")
  })

  it("shows the alert when a permission blocks the run, outranking active work", () => {
    expect(
      trayIconKey(
        statusFixture({
          busy: true,
          phase: "working",
          permission: { id: 4, label: "Edit src/app/conversation.ts", kind: "file_edit", resources: [] },
        }),
      ),
    ).toBe("alert")
  })

  it("treats a failed model load as quiet, not activity", () => {
    expect(
      trayIconKey(statusFixture({ modelLoad: { modelId: "m", status: { label: "Failed: boom", kind: "error" } } })),
    ).toBe("idle")
  })
})

describe("trayTooltip", () => {
  it("tracks the glanceable state", () => {
    expect(trayTooltip(statusFixture())).toBe("Otis — ready")
    expect(trayTooltip(statusFixture({ busy: true, phase: "thinking" }))).toBe("Otis — thinking")
    expect(trayTooltip(statusFixture({ busy: true, phase: "working" }))).toBe("Otis — working")
    expect(trayTooltip(statusFixture({ modelState: "starting" }))).toBe("Otis — preparing a model")
    expect(
      trayTooltip(statusFixture({ modelLoad: { modelId: "m", status: { label: "Downloading…", kind: "progress" } } })),
    ).toBe("Otis — preparing a model")
    expect(
      trayTooltip(statusFixture({ permission: { id: 4, label: "Edit a file", kind: "file_edit", resources: [] } })),
    ).toBe("Otis — needs your approval")
  })
})

describe("trayStatusGate", () => {
  /** Records the icon each applied status would show, the way createTauriTray's update drives the real tray. */
  function recordingTray() {
    const icons: TrayIconKey[] = []
    const tray: Pick<StatusTray, "onStatus"> = { onStatus: (status) => void icons.push(trayIconKey(status)) }
    return { icons, tray }
  }

  it("applies the seed while no live status has arrived", () => {
    const { icons, tray } = recordingTray()
    const gate = trayStatusGate(tray)
    gate.applySeed(statusFixture({ phase: "thinking" }))
    expect(icons).toEqual(["working"])
  })

  it("drops a seed that resolves after a live status, keeping the newer working icon", () => {
    const { icons, tray } = recordingTray()
    const gate = trayStatusGate(tray)
    // The seed's busy/phase were captured before the turn started, so it is stale by the time it resolves.
    const staleSeed = statusFixture()
    gate.applyLive(statusFixture({ phase: "thinking" }))
    gate.applySeed(staleSeed)
    expect(icons).toEqual(["working"])
  })

  it("drops a seed that resolves after a live approval request, keeping the alert icon", () => {
    const { icons, tray } = recordingTray()
    const gate = trayStatusGate(tray)
    gate.applyLive(statusFixture({ permission: { id: 4, label: "Edit a file", kind: "file_edit", resources: [] } }))
    gate.applySeed(statusFixture())
    expect(icons).toEqual(["alert"])
  })

  it("applies every live status; only a pre-live seed applies, and only once", () => {
    const { icons, tray } = recordingTray()
    const gate = trayStatusGate(tray)
    gate.applySeed(statusFixture())
    gate.applyLive(statusFixture({ phase: "thinking" }))
    gate.applySeed(statusFixture()) // a second seed is stale by construction and must be ignored
    gate.applyLive(statusFixture())
    expect(icons).toEqual(["idle", "working", "idle"])
  })
})
