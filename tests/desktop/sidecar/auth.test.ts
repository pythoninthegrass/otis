import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { generateToken, readBridgeFile, writeBridgeFile } from "../../../src/desktop/sidecar/auth.js"

let dir: string | undefined

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = undefined
})

async function tempDir() {
  dir = await mkdtemp(join(tmpdir(), "otis-sidecar-auth-"))
  return dir
}

describe("generateToken", () => {
  it("is high-entropy and unique across calls", () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(32)
    expect(/^[0-9a-f]+$/.test(a)).toBe(true)
  })
})

describe("bridge file", () => {
  it("round-trips port and token", async () => {
    const root = await tempDir()
    const path = join(root, "runtime", "bridge.json")
    await writeBridgeFile(path, { port: 51234, token: generateToken() })
    const read = await readBridgeFile(path)
    expect(read.port).toBe(51234)
    expect(typeof read.token).toBe("string")
  })

  it("writes the file and parent directory with private permissions", async () => {
    if (process.platform === "win32") return
    const root = await tempDir()
    const path = join(root, "runtime", "bridge.json")
    await writeBridgeFile(path, { port: 1, token: generateToken() })
    const fileStat = await stat(path)
    const dirStat = await stat(join(root, "runtime"))
    expect(fileStat.mode & 0o777).toBe(0o600)
    expect(dirStat.mode & 0o777).toBe(0o700)
  })

  it("overwrites a stale file atomically", async () => {
    const root = await tempDir()
    const path = join(root, "runtime", "bridge.json")
    await writeBridgeFile(path, { port: 1, token: "a" })
    await writeBridgeFile(path, { port: 2, token: "b" })
    const read = await readBridgeFile(path)
    expect(read.port).toBe(2)
    expect(read.token).toBe("b")
  })
})
