/**
 * Minimal ambient types for the Bun.serve surface this module uses. Scoped to this directory (excluded from the
 * main tsconfig's program) rather than pulling in the full `@types/bun` package, whose global lib augmentations
 * (ReadableStream, fetch, …) conflict with the rest of the codebase's Node types.
 */
declare namespace Bun {
  interface ServerWebSocket<T> {
    readonly data: T
    send(data: string): void
    close(code?: number, reason?: string): void
  }

  interface WebSocketHandler<T> {
    open?(ws: ServerWebSocket<T>): void
    close?(ws: ServerWebSocket<T>): void
    message?(ws: ServerWebSocket<T>, message: string | Uint8Array): void | Promise<void>
  }

  interface Server {
    readonly port: number
    upgrade(request: Request, options?: { data?: unknown }): boolean
    stop(closeActiveConnections?: boolean): void
  }

  interface ServeOptions<T> {
    hostname?: string
    port?: number
    fetch(request: Request, server: Server): Response | undefined | Promise<Response | undefined>
    websocket: WebSocketHandler<T>
  }

  function serve<T>(options: ServeOptions<T>): Server
}
