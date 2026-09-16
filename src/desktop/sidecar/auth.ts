import { randomBytes } from "node:crypto"
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export function generateToken(): string {
  return randomBytes(32).toString("hex")
}

export type BridgeFile = { port: number; token: string }

/** Deletes any stale file first: a hard-killed sidecar leaves its runtime file behind, and a later reader must
 * never see a dead port. Written 0600 under a 0700 parent, matching src/local/settings.ts's discipline. */
export async function writeBridgeFile(path: string, bridge: BridgeFile) {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  await chmodPrivate(directory, 0o700)
  await rm(path, { force: true })
  const temporaryFile = `${path}.${process.pid}.tmp`
  try {
    await writeFile(temporaryFile, `${JSON.stringify(bridge, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
    await chmodPrivate(temporaryFile, 0o600)
    await rename(temporaryFile, path)
  } finally {
    await rm(temporaryFile, { force: true })
  }
}

export async function readBridgeFile(path: string): Promise<BridgeFile> {
  const content = await readFile(path, "utf8")
  const value: unknown = JSON.parse(content)
  if (
    typeof value !== "object" ||
    value === null ||
    typeof (value as Record<string, unknown>).port !== "number" ||
    typeof (value as Record<string, unknown>).token !== "string"
  ) {
    throw new Error(`Invalid bridge file: ${path}`)
  }
  return value as BridgeFile
}

async function chmodPrivate(path: string, mode: number) {
  if (process.platform !== "win32") await chmod(path, mode)
}
