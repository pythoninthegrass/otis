import { DESKTOP_CHANNELS, type DesktopEvent } from "../contracts.js"
import type { DesktopRuntime } from "../main/runtime.js"
import {
  type DesktopImageInput,
  DISPATCH_METHODS,
  decodeImageInput,
  type RpcRequest,
  type RpcResponse,
} from "./protocol.js"

/** The subset of DesktopRuntime the sidecar dispatches over RPC; lets tests inject a plain fake object. */
export type SidecarRuntime = Pick<
  DesktopRuntime,
  | "snapshot"
  | "sendPrompt"
  | "stop"
  | "respondToPermission"
  | "selectSession"
  | "searchSessions"
  | "startNewSession"
  | "switchWorkspace"
  | "openWorkspace"
  | "locateWorkspace"
  | "registerWorkspace"
  | "refreshSessions"
  | "deleteSession"
  | "listModels"
  | "selectModel"
  | "cancelModelSelection"
  | "getSubagentTrace"
  | "setAgentsPanelVisible"
  | "setTheme"
  | "setThinkingVisible"
  | "setPermissionMode"
  | "setFastServing"
  | "setFireworksApiKey"
  | "connectPairEndpoints"
  | "deleteLocalModel"
  | "setDebugMode"
  | "checkForUpdates"
  | "installUpdate"
>

export type BridgeServer = {
  port: number
  stop(): void
  broadcast(event: DesktopEvent): void
}

export type CreateBridgeServerOptions = {
  runtime: SidecarRuntime
  token: string
  /** Fires for the single accepted client's connect/disconnect, not for a refused second client. Feeds the
   * shutdown watchdog: a disconnect with no reconnect inside its window shuts the process down. */
  onClientConnected?: () => void
  onClientDisconnected?: () => void
}

type ClientData = Record<string, never>

/**
 * Bun.serve WebSocket host that dispatches JSON-RPC frames to a DesktopRuntime, over a token-authed loopback
 * connection. Not exported by any other module under src/ — this is the one place Bun.serve is allowed, since
 * it only ever runs compiled by Bun.
 */
export function createBridgeServer(options: CreateBridgeServerOptions): BridgeServer {
  const { runtime, token, onClientConnected, onClientDisconnected } = options
  const expectedProtocol = `otis.${token}`
  let activeClient: Bun.ServerWebSocket<ClientData> | undefined

  const server = Bun.serve<ClientData>({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req, srv) {
      const origin = req.headers.get("origin")
      if (origin && origin !== "null") return new Response("forbidden origin", { status: 401 })
      const protocolHeader = req.headers.get("sec-websocket-protocol")
      if (protocolHeader !== expectedProtocol) return new Response("unauthorized", { status: 401 })
      const upgraded = srv.upgrade(req, { data: {} })
      return upgraded ? undefined : new Response("upgrade failed", { status: 400 })
    },
    websocket: {
      open(ws) {
        if (activeClient) {
          ws.close(4000, "another client is already connected")
          return
        }
        activeClient = ws
        onClientConnected?.()
      },
      close(ws) {
        if (activeClient !== ws) return
        activeClient = undefined
        onClientDisconnected?.()
      },
      async message(ws, raw) {
        let request: RpcRequest
        try {
          request = JSON.parse(String(raw)) as RpcRequest
        } catch {
          return
        }
        await handleRequest(runtime, request, (response) => ws.send(JSON.stringify(response)))
      },
    },
  })

  return {
    port: server.port,
    stop() {
      server.stop(true)
    },
    broadcast(event) {
      activeClient?.send(JSON.stringify({ method: "desktop:event", params: [event] }))
    },
  }
}

async function handleRequest(runtime: SidecarRuntime, request: RpcRequest, respond: (response: RpcResponse) => void) {
  const method = DISPATCH_METHODS[request.method]
  if (!method) {
    respond({ id: request.id, ok: false, error: `Unknown method: ${request.method}` })
    return
  }
  try {
    const params = decodeParams(request.method, request.params)
    const handler = (runtime as unknown as Record<string, (...args: unknown[]) => unknown>)[method]
    const value = await handler.apply(runtime, params)
    respond({ id: request.id, ok: true, value })
  } catch (error) {
    respond({ id: request.id, ok: false, error: String((error as { message?: unknown })?.message ?? error) })
  }
}

function decodeParams(channel: string, params: unknown[]): unknown[] {
  if (channel !== DESKTOP_CHANNELS.sendPrompt) return params
  const [text, images] = params
  if (images === undefined) return [text]
  if (!Array.isArray(images)) throw new Error("sendPrompt expects an array of images")
  return [text, images.map((image) => decodeImageInput(image as DesktopImageInput))]
}
