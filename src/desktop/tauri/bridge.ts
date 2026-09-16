import { invoke } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { open } from "@tauri-apps/plugin-dialog"
import { openUrl } from "@tauri-apps/plugin-opener"
import {
  DESKTOP_CHANNELS,
  type DesktopApi,
  type DesktopEvent,
  type DesktopImageInput,
  type DesktopWindowState,
} from "../contracts.js"
import { startAutoUpdates } from "./updater.js"

/**
 * Contract with the Rust side: a Tauri command named `bridge_endpoint`, invoked via `invoke("bridge_endpoint")`,
 * returns `{ port: number, token: string }` for the sidecar WebSocket server. Read from the bridge-file the
 * sidecar wrote (0600 permissions, `{port, token}`). This shape is fixed by this module — the Rust command must
 * match it exactly.
 */
type BridgeEndpoint = { port: number; token: string }

/** One in-flight request keyed by id, resolved or rejected when the matching response frame arrives. */
type PendingCall = { resolve: (value: unknown) => void; reject: (reason: unknown) => void }

type RequestFrame = { id: number; method: string; params: unknown[] }
type ResponseFrame = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string }
type EventFrame = { method: "desktop:event"; params: [DesktopEvent] }

function isEventFrame(frame: ResponseFrame | EventFrame): frame is EventFrame {
  return "method" in frame && frame.method === "desktop:event"
}

/** Builds the DesktopApi for the Tauri renderer, backed by the sidecar's WebSocket server. */
export async function createSidecarApi(): Promise<DesktopApi> {
  const { port, token } = await invoke<BridgeEndpoint>("bridge_endpoint")
  const socket = await connect(port, token)

  let nextId = 1
  const pending = new Map<number, PendingCall>()
  const eventListeners = new Set<(event: DesktopEvent) => void>()

  socket.addEventListener("message", (message) => {
    const frame = JSON.parse(message.data as string) as ResponseFrame | EventFrame
    if (isEventFrame(frame)) {
      const [event] = frame.params
      for (const listener of eventListeners) listener(event)
      return
    }
    const call = pending.get(frame.id)
    if (!call) return
    pending.delete(frame.id)
    if (frame.ok) call.resolve(frame.value)
    else call.reject(new Error(frame.error))
  })
  socket.addEventListener("close", () => {
    for (const call of pending.values()) call.reject(new Error("The desktop bridge connection closed."))
    pending.clear()
  })

  const send = <T>(method: string, params: unknown[]): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      const frame: RequestFrame = { id, method, params }
      socket.send(JSON.stringify(frame))
    })

  const updater = startAutoUpdates({ isPackaged: !import.meta.env.DEV, onState: () => {} })

  const api: DesktopApi = {
    getSnapshot: () => send(DESKTOP_CHANNELS.getSnapshot, []),
    getWindowState: async () => ({ fullscreen: await getCurrentWindow().isFullscreen() }),
    sendPrompt: (text, images) => send(DESKTOP_CHANNELS.sendPrompt, [text, images ? images.map(encodeImage) : images]),
    stop: () => send(DESKTOP_CHANNELS.stop, []),
    respondToPermission: (id, allow) => send(DESKTOP_CHANNELS.respondToPermission, [id, allow]),
    selectSession: (id, dirName) => send(DESKTOP_CHANNELS.selectSession, [id, dirName]),
    searchSessions: (query) => send(DESKTOP_CHANNELS.searchSessions, [query]),
    startNewSession: () => send(DESKTOP_CHANNELS.startNewSession, []),
    deleteSession: (id, dirName) => send(DESKTOP_CHANNELS.deleteSession, [id, dirName]),
    refreshSessions: () => send(DESKTOP_CHANNELS.refreshSessions, []),
    openSessionAt: (workspacePath, sessionId, dirName) =>
      send(DESKTOP_CHANNELS.openSessionAt, [workspacePath, sessionId, dirName]),
    openWorkspace: (path) => send(DESKTOP_CHANNELS.openWorkspace, [path]),
    locateWorkspace: (path) => send(DESKTOP_CHANNELS.locateWorkspace, [path]),
    pickWorkspaceFolder: async () => {
      const result = await open({ directory: true, title: "Open Folder" })
      return result ?? undefined
    },
    registerWorkspace: (dirName, path) => send(DESKTOP_CHANNELS.registerWorkspace, [dirName, path]),
    listModels: () => send(DESKTOP_CHANNELS.listModels, []),
    selectModel: (id) => send(DESKTOP_CHANNELS.selectModel, [id]),
    cancelModelSelection: () => send(DESKTOP_CHANNELS.cancelModelSelection, []),
    getSubagentTrace: (toolCallId) => send(DESKTOP_CHANNELS.getSubagentTrace, [toolCallId]),
    setAgentsPanelVisible: (visible) => send(DESKTOP_CHANNELS.setAgentsPanelVisible, [visible]),
    setTheme: (theme) => send(DESKTOP_CHANNELS.setTheme, [theme]),
    setThinkingVisible: (visible) => send(DESKTOP_CHANNELS.setThinkingVisible, [visible]),
    setPermissionMode: (mode) => send(DESKTOP_CHANNELS.setPermissionMode, [mode]),
    setFastServing: (fast) => send(DESKTOP_CHANNELS.setFastServing, [fast]),
    openFireworksKeyPage: () => openUrl("https://app.fireworks.ai/api-keys"),
    setFireworksApiKey: (apiKey) => send(DESKTOP_CHANNELS.setFireworksApiKey, [apiKey]),
    connectPairEndpoints: (endpoints) => send(DESKTOP_CHANNELS.connectPairEndpoints, [endpoints]),
    deleteLocalModel: (id) => send(DESKTOP_CHANNELS.deleteLocalModel, [id]),
    setDebugMode: (enabled) => send(DESKTOP_CHANNELS.setDebugMode, [enabled]),
    checkForUpdates: () => updater.check(),
    installUpdate: () => updater.install(),
    subscribeWindowState: (listener) => subscribeWindowState(listener),
    subscribe: (listener) => {
      eventListeners.add(listener)
      return () => eventListeners.delete(listener)
    },
  }
  return api
}

/** Opens the sidecar WebSocket, authenticating via the `otis.<token>` subprotocol; resolves only once open. */
function connect(port: number, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, `otis.${token}`)
    const onOpen = () => {
      socket.removeEventListener("error", onFailure)
      socket.removeEventListener("close", onFailure)
      resolve(socket)
    }
    const onFailure = () => reject(new Error("Could not connect to the desktop bridge."))
    socket.addEventListener("open", onOpen, { once: true })
    socket.addEventListener("error", onFailure, { once: true })
    socket.addEventListener("close", onFailure, { once: true })
  })
}

/** Wire format must match src/desktop/sidecar/protocol.ts's decodeImageInput: {name, mimeType, bytesBase64}. */
function encodeImage(image: DesktopImageInput) {
  let binary = ""
  for (const byte of image.bytes) binary += String.fromCharCode(byte)
  return { name: image.name, mimeType: image.mimeType, bytesBase64: btoa(binary) }
}

/**
 * No built-in fullscreen-changed event exists on the Tauri Window class (checked window.d.ts); poll isFullscreen()
 * on window resize instead, debounced so a resize drag doesn't spam the callback.
 */
function subscribeWindowState(listener: (state: DesktopWindowState) => void): () => void {
  let lastFullscreen: boolean | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const poll = async () => {
    const fullscreen = await getCurrentWindow().isFullscreen()
    if (fullscreen !== lastFullscreen) {
      lastFullscreen = fullscreen
      listener({ fullscreen })
    }
  }
  const onResize = () => {
    clearTimeout(timer)
    timer = setTimeout(() => void poll(), 150)
  }
  void poll()
  window.addEventListener("resize", onResize)
  return () => {
    clearTimeout(timer)
    window.removeEventListener("resize", onResize)
  }
}
