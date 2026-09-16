import { afterEach, describe, expect, it, vi } from "vitest"
import { DESKTOP_CHANNELS, type DesktopEvent } from "../../../src/desktop/contracts.js"
import { createBridgeServer } from "../../../src/desktop/sidecar/server.js"

const TOKEN = "test-token-abc123"

function fakeRuntime() {
  return {
    snapshot: vi.fn().mockResolvedValue({ hello: "world" }),
    sendPrompt: vi.fn().mockResolvedValue({ accepted: true, delivery: "started" }),
    stop: vi.fn().mockResolvedValue(undefined),
    respondToPermission: vi.fn(),
    selectSession: vi.fn().mockResolvedValue({ ok: true }),
    searchSessions: vi.fn().mockResolvedValue([]),
    startNewSession: vi.fn().mockResolvedValue({ ok: true }),
    switchWorkspace: vi.fn().mockResolvedValue({ ok: true }),
    openWorkspace: vi.fn().mockResolvedValue({ ok: true }),
    locateWorkspace: vi.fn().mockResolvedValue({ ok: true }),
    registerWorkspace: vi.fn().mockResolvedValue({ ok: true }),
    refreshSessions: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue({ ok: true }),
    listModels: vi.fn().mockResolvedValue([]),
    selectModel: vi.fn().mockResolvedValue({ ok: true }),
    cancelModelSelection: vi.fn().mockResolvedValue(undefined),
    getSubagentTrace: vi.fn().mockReturnValue([]),
    setAgentsPanelVisible: vi.fn().mockResolvedValue(undefined),
    setTheme: vi.fn().mockResolvedValue(undefined),
    setThinkingVisible: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    setFastServing: vi.fn().mockResolvedValue({ ok: true }),
    setFireworksApiKey: vi.fn().mockResolvedValue({ ok: true }),
    connectPairEndpoints: vi.fn().mockResolvedValue({ ok: true }),
    deleteLocalModel: vi.fn().mockResolvedValue({ ok: true }),
    setDebugMode: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    installUpdate: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    handleRendererGone: vi.fn(),
  }
}

let servers: ReturnType<typeof createBridgeServer>[] = []

function start(token = TOKEN) {
  const runtime = fakeRuntime()
  const server = createBridgeServer({ runtime, token })
  servers.push(server)
  return { runtime, server }
}

function connect(port: number, protocol = `otis.${TOKEN}`) {
  return new WebSocket(`ws://127.0.0.1:${port}`, protocol ? [protocol] : undefined)
}

function waitFor(ws: WebSocket, event: "open" | "close" | "message" | "error"): Promise<Event> {
  return new Promise((resolve) => ws.addEventListener(event, resolve, { once: true }))
}

afterEach(() => {
  for (const server of servers) server.stop()
  servers = []
})

describe("createBridgeServer", () => {
  it("round-trips a successful method call", async () => {
    const { server, runtime } = start()
    const ws = connect(server.port)
    await waitFor(ws, "open")
    const reply = waitFor(ws, "message") as Promise<MessageEvent>
    ws.send(JSON.stringify({ id: 1, method: DESKTOP_CHANNELS.getSnapshot, params: [] }))
    const message = await reply
    const response = JSON.parse(String(message.data))
    expect(response).toEqual({ id: 1, ok: true, value: { hello: "world" } })
    expect(runtime.snapshot).toHaveBeenCalledTimes(1)
    ws.close()
  })

  it("decodes image params for sendPrompt before calling the runtime", async () => {
    const { server, runtime } = start()
    const ws = connect(server.port)
    await waitFor(ws, "open")
    const reply = waitFor(ws, "message") as Promise<MessageEvent>
    const bytes = new Uint8Array([1, 2, 3])
    ws.send(
      JSON.stringify({
        id: 2,
        method: DESKTOP_CHANNELS.sendPrompt,
        params: ["hi", [{ name: "a.png", mimeType: "image/png", bytesBase64: Buffer.from(bytes).toString("base64") }]],
      }),
    )
    await reply
    expect(runtime.sendPrompt).toHaveBeenCalledTimes(1)
    const [text, images] = runtime.sendPrompt.mock.calls[0] as [string, { name: string; bytes: Uint8Array }[]]
    expect(text).toBe("hi")
    expect(images?.[0]?.name).toBe("a.png")
    expect([...(images?.[0]?.bytes ?? [])]).toEqual([1, 2, 3])
    ws.close()
  })

  it("rejects a connection with no token", async () => {
    const { server } = start()
    const ws = connect(server.port, "")
    const outcome = await Promise.race([
      waitFor(ws, "open").then(() => "open"),
      waitFor(ws, "error").then(() => "error"),
      waitFor(ws, "close").then(() => "close"),
    ])
    expect(outcome).not.toBe("open")
  })

  it("rejects a connection with the wrong token", async () => {
    const { server } = start()
    const ws = connect(server.port, "otis.wrong-token")
    const outcome = await Promise.race([
      waitFor(ws, "open").then(() => "open"),
      waitFor(ws, "error").then(() => "error"),
      waitFor(ws, "close").then(() => "close"),
    ])
    expect(outcome).not.toBe("open")
  })

  it("rejects a second concurrent client while keeping the first", async () => {
    const { server, runtime } = start()
    const first = connect(server.port)
    await waitFor(first, "open")

    const second = connect(server.port)
    const secondClosed = waitFor(second, "close")
    await secondClosed

    const reply = waitFor(first, "message") as Promise<MessageEvent>
    first.send(JSON.stringify({ id: 3, method: DESKTOP_CHANNELS.getSnapshot, params: [] }))
    await reply
    expect(runtime.snapshot).toHaveBeenCalledTimes(1)
    first.close()
  })

  it("turns a thrown handler error into an ok:false response instead of closing the socket", async () => {
    const { server, runtime } = start()
    runtime.stop.mockRejectedValueOnce(new Error("boom"))
    const ws = connect(server.port)
    await waitFor(ws, "open")
    const reply = waitFor(ws, "message") as Promise<MessageEvent>
    ws.send(JSON.stringify({ id: 4, method: DESKTOP_CHANNELS.stop, params: [] }))
    const message = await reply
    const response = JSON.parse(String(message.data))
    expect(response).toEqual({ id: 4, ok: false, error: "boom" })
    ws.close()
  })

  it("rejects an unknown method", async () => {
    const { server } = start()
    const ws = connect(server.port)
    await waitFor(ws, "open")
    const reply = waitFor(ws, "message") as Promise<MessageEvent>
    ws.send(JSON.stringify({ id: 5, method: "desktop:not-a-real-method", params: [] }))
    const message = await reply
    const response = JSON.parse(String(message.data))
    expect(response.ok).toBe(false)
    ws.close()
  })

  it("broadcasts an event to the connected client as a notification frame", async () => {
    const { server } = start()
    const ws = connect(server.port)
    await waitFor(ws, "open")
    const reply = waitFor(ws, "message") as Promise<MessageEvent>
    const event: DesktopEvent = { type: "transcript", revision: 1, ops: [] }
    server.broadcast(event)
    const message = await reply
    const notification = JSON.parse(String(message.data))
    expect(notification.method).toBe("desktop:event")
    expect(notification.params[0]).toEqual(event)
    ws.close()
  })

  it("no-ops broadcast when no client is connected", () => {
    const { server } = start()
    expect(() => server.broadcast({ type: "transcript", revision: 1, ops: [] })).not.toThrow()
  })
})
