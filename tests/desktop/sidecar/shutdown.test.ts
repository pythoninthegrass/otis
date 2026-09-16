import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createShutdownController } from "../../../src/desktop/sidecar/shutdown.js"

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

function setup(watchdogMs = 2000) {
  const shutdown = vi.fn().mockResolvedValue(undefined)
  const exit = vi.fn()
  const controller = createShutdownController({ runtime: { shutdown }, watchdogMs, exit })
  return { controller, shutdown, exit }
}

describe("createShutdownController", () => {
  it("shuts down exactly once when the RPC fires before the watchdog elapses", async () => {
    const { controller, shutdown, exit } = setup()
    controller.onDisconnect()
    await controller.requestShutdown()
    await vi.advanceTimersByTimeAsync(5000)
    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(exit).not.toHaveBeenCalled()
  })

  it("shuts down exactly once when the watchdog elapses before the RPC fires", async () => {
    const { controller, shutdown, exit } = setup()
    controller.onDisconnect()
    await vi.advanceTimersByTimeAsync(2000)
    await controller.requestShutdown()
    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it("cancels the pending shutdown when the client reconnects before the watchdog elapses", async () => {
    const { controller, shutdown, exit } = setup()
    controller.onDisconnect()
    controller.onReconnect()
    await vi.advanceTimersByTimeAsync(5000)
    expect(shutdown).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
  })

  it("calls process exit after the watchdog runs shutdown", async () => {
    const { controller, shutdown, exit } = setup()
    controller.onDisconnect()
    await vi.advanceTimersByTimeAsync(2000)
    expect(shutdown).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it("does not re-arm the watchdog for a second onDisconnect while one is already pending", async () => {
    const { controller, shutdown } = setup()
    controller.onDisconnect()
    controller.onDisconnect()
    await vi.advanceTimersByTimeAsync(2000)
    expect(shutdown).toHaveBeenCalledTimes(1)
  })
})
