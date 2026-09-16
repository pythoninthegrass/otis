import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DesktopUpdateState } from "../../../src/desktop/contracts.js"
import { startAutoUpdates } from "../../../src/desktop/tauri/updater.js"

const relaunch = vi.fn()
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: (...args: unknown[]) => relaunch(...args) }))

const check = vi.fn()
vi.mock("@tauri-apps/plugin-updater", () => ({ check: (...args: unknown[]) => check(...args) }))

function fakeUpdate(
  version = "9.9.9",
  overrides: { download?: () => Promise<void>; install?: () => Promise<void> } = {},
) {
  return {
    version,
    currentVersion: "1.0.0",
    download: overrides.download ?? vi.fn().mockResolvedValue(undefined),
    install: overrides.install ?? vi.fn().mockResolvedValue(undefined),
  }
}

describe("startAutoUpdates", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    check.mockReset().mockResolvedValue(null)
    relaunch.mockReset()
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  function start(isPackaged = true) {
    const states: DesktopUpdateState[] = []
    const controller = startAutoUpdates({ isPackaged, onState: (state) => states.push(state) })
    return { ...controller, states }
  }

  it("does not check, schedule, or install updates in development", async () => {
    const updater = start(false)
    await updater.check()
    await updater.install()
    expect(updater.states).toEqual([{ status: "unavailable" }])
    expect(check).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("shares the startup check with manual requests and allows a fresh check afterward", async () => {
    let resolve!: (value: unknown) => void
    check.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    const updater = start()
    const first = updater.check()
    expect(updater.check()).toBe(first)
    expect(check).toHaveBeenCalledOnce()
    expect(updater.states).toEqual([{ status: "checking" }])
    resolve(null)
    await first
    expect(updater.states.at(-1)).toEqual({ status: "current" })
    await updater.check()
    expect(check).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(check).toHaveBeenCalledTimes(3)
  })

  it("keeps manual and hourly requests from overlapping a background download", async () => {
    let finish!: () => void
    const update = fakeUpdate("9.9.9", {
      download: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve
          }),
      ),
    })
    check.mockResolvedValueOnce(update)
    const updater = start()
    const pending = updater.check()
    await vi.advanceTimersByTimeAsync(0)
    expect(updater.states.at(-1)).toEqual({ status: "downloading", version: "9.9.9" })
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(updater.check()).toBe(pending)
    expect(check).toHaveBeenCalledOnce()
    finish()
    await pending
    expect(updater.states.at(-1)).toEqual({ status: "ready", version: "9.9.9" })
    await updater.check()
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(check).toHaveBeenCalledOnce()
    await updater.install()
    expect(update.install).toHaveBeenCalledOnce()
    expect(relaunch).toHaveBeenCalledOnce()
    expect(updater.isInstalling()).toBe(true)
  })

  it("reports a failed check without rejecting and lets the user retry", async () => {
    check.mockRejectedValueOnce(new Error("offline"))
    const updater = start()
    await expect(updater.check()).resolves.toBeUndefined()
    expect(updater.states.at(-1)).toEqual({ status: "error", message: "Couldn’t check for updates. Please try again." })
    check.mockResolvedValueOnce(null)
    await updater.check()
    expect(updater.states.at(-1)).toEqual({ status: "current" })
  })

  it("reports download rejection and permits downloading again", async () => {
    const update = fakeUpdate("9.9.9", { download: vi.fn().mockRejectedValue(new Error("reset")) })
    check.mockResolvedValueOnce(update)
    const updater = start()
    await expect(updater.check()).resolves.toBeUndefined()
    expect(updater.states.at(-1)).toEqual({
      status: "error",
      message: "The update couldn’t be downloaded. Please try again.",
    })
    check.mockResolvedValueOnce(null)
    await updater.check()
    expect(check).toHaveBeenCalledTimes(2)
  })

  it("reports install failure directly, from the install rejection rather than quit lifecycle", async () => {
    const update = fakeUpdate("9.9.9", { install: vi.fn().mockRejectedValue(new Error("installer unsupported")) })
    check.mockResolvedValueOnce(update)
    const updater = start()
    await updater.check()
    expect(updater.states.at(-1)).toEqual({ status: "ready", version: "9.9.9" })
    await updater.install()
    expect(updater.states.at(-1)).toEqual({
      status: "error",
      message: "The update couldn’t be installed. Please try again.",
    })
    expect(relaunch).not.toHaveBeenCalled()
    expect(updater.isInstalling()).toBe(false)
  })

  it("reports current when the check finds nothing newer", async () => {
    check.mockResolvedValueOnce(null)
    const updater = start()
    await updater.check()
    expect(updater.states.at(-1)).toEqual({ status: "current" })
  })
})
