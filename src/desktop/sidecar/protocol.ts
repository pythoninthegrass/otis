import { DESKTOP_CHANNELS } from "../contracts.js"

export type RpcRequest = { id: number; method: string; params: unknown[] }
export type RpcResponse = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string }
export type RpcNotification = { method: "desktop:event" | "desktop:window-state"; params: [unknown] }

/** Wire shape for DesktopImageInput: base64 instead of Uint8Array, since JSON can't carry binary. */
export type DesktopImageInput = { name: string; mimeType: string; bytesBase64: string }

export function encodeImageInput(input: { name: string; mimeType: string; bytes: Uint8Array }): DesktopImageInput {
  return { name: input.name, mimeType: input.mimeType, bytesBase64: Buffer.from(input.bytes).toString("base64") }
}

export function decodeImageInput(wire: DesktopImageInput): { name: string; mimeType: string; bytes: Uint8Array } {
  return { name: wire.name, mimeType: wire.mimeType, bytes: new Uint8Array(Buffer.from(wire.bytesBase64, "base64")) }
}

/**
 * Wire channel -> DesktopRuntime method name, for every channel the sidecar dispatches over RPC. openSessionAt
 * maps to switchWorkspace, matching main/ipc.ts's existing validated mapping.
 */
export const DISPATCH_METHODS: Record<string, string> = {
  [DESKTOP_CHANNELS.getSnapshot]: "snapshot",
  [DESKTOP_CHANNELS.sendPrompt]: "sendPrompt",
  [DESKTOP_CHANNELS.stop]: "stop",
  [DESKTOP_CHANNELS.respondToPermission]: "respondToPermission",
  [DESKTOP_CHANNELS.selectSession]: "selectSession",
  [DESKTOP_CHANNELS.searchSessions]: "searchSessions",
  [DESKTOP_CHANNELS.startNewSession]: "startNewSession",
  [DESKTOP_CHANNELS.openSessionAt]: "switchWorkspace",
  [DESKTOP_CHANNELS.openWorkspace]: "openWorkspace",
  [DESKTOP_CHANNELS.locateWorkspace]: "locateWorkspace",
  [DESKTOP_CHANNELS.registerWorkspace]: "registerWorkspace",
  [DESKTOP_CHANNELS.refreshSessions]: "refreshSessions",
  [DESKTOP_CHANNELS.deleteSession]: "deleteSession",
  [DESKTOP_CHANNELS.listModels]: "listModels",
  [DESKTOP_CHANNELS.selectModel]: "selectModel",
  [DESKTOP_CHANNELS.cancelModelSelection]: "cancelModelSelection",
  [DESKTOP_CHANNELS.getSubagentTrace]: "getSubagentTrace",
  [DESKTOP_CHANNELS.setAgentsPanelVisible]: "setAgentsPanelVisible",
  [DESKTOP_CHANNELS.setTheme]: "setTheme",
  [DESKTOP_CHANNELS.setThinkingVisible]: "setThinkingVisible",
  [DESKTOP_CHANNELS.setPermissionMode]: "setPermissionMode",
  [DESKTOP_CHANNELS.setFastServing]: "setFastServing",
  [DESKTOP_CHANNELS.setFireworksApiKey]: "setFireworksApiKey",
  [DESKTOP_CHANNELS.connectPairEndpoints]: "connectPairEndpoints",
  [DESKTOP_CHANNELS.deleteLocalModel]: "deleteLocalModel",
  [DESKTOP_CHANNELS.setDebugMode]: "setDebugMode",
  [DESKTOP_CHANNELS.checkForUpdates]: "checkForUpdates",
  [DESKTOP_CHANNELS.installUpdate]: "installUpdate",
}

/**
 * Channels that never reach the sidecar: pickWorkspaceFolder, getWindowState and openFireworksKeyPage are
 * Tauri-JS-plugin concerns handled by the renderer bridge directly, and windowState/event are push notifications,
 * not RPC calls.
 */
export const CLIENT_SIDE_CHANNELS = new Set<string>([
  DESKTOP_CHANNELS.pickWorkspaceFolder,
  DESKTOP_CHANNELS.getWindowState,
  DESKTOP_CHANNELS.windowState,
  DESKTOP_CHANNELS.openFireworksKeyPage,
  DESKTOP_CHANNELS.event,
])
