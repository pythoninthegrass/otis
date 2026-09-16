import { describe, expect, it } from "vitest"
import { DESKTOP_CHANNELS } from "../../../src/desktop/contracts.js"
import {
  CLIENT_SIDE_CHANNELS,
  DISPATCH_METHODS,
  decodeImageInput,
  encodeImageInput,
} from "../../../src/desktop/sidecar/protocol.js"

describe("DISPATCH_METHODS", () => {
  it("covers every DESKTOP_CHANNELS value except the client-side-only ones", () => {
    for (const channel of Object.values(DESKTOP_CHANNELS)) {
      if (CLIENT_SIDE_CHANNELS.has(channel)) {
        expect(DISPATCH_METHODS[channel]).toBeUndefined()
      } else {
        expect(typeof DISPATCH_METHODS[channel]).toBe("string")
        expect(DISPATCH_METHODS[channel]?.length).toBeGreaterThan(0)
      }
    }
  })

  it("maps every dispatch entry back to a known channel value", () => {
    const known = new Set<string>(Object.values(DESKTOP_CHANNELS))
    for (const channel of Object.keys(DISPATCH_METHODS)) {
      expect(known.has(channel)).toBe(true)
    }
  })

  it("routes openSessionAt to switchWorkspace, matching main/ipc.ts's mapping", () => {
    expect(DISPATCH_METHODS[DESKTOP_CHANNELS.openSessionAt]).toBe("switchWorkspace")
  })
})

describe("image input round-trip", () => {
  it("round-trips arbitrary bytes byte-for-byte", () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255, 127, 128, 65, 90])
    const wire = encodeImageInput({ name: "photo.png", mimeType: "image/png", bytes })
    expect(typeof wire.bytesBase64).toBe("string")
    const decoded = decodeImageInput(wire)
    expect(decoded.name).toBe("photo.png")
    expect(decoded.mimeType).toBe("image/png")
    expect([...decoded.bytes]).toEqual([...bytes])
  })

  it("round-trips an empty byte array", () => {
    const wire = encodeImageInput({ name: "empty.bin", mimeType: "application/octet-stream", bytes: new Uint8Array() })
    const decoded = decodeImageInput(wire)
    expect(decoded.bytes.byteLength).toBe(0)
  })

  it("round-trips the full byte range, including non-ASCII-adjacent bytes", () => {
    const bytes = new Uint8Array(256)
    for (let i = 0; i < 256; i += 1) bytes[i] = i
    const decoded = decodeImageInput(
      encodeImageInput({ name: "range.bin", mimeType: "application/octet-stream", bytes }),
    )
    expect([...decoded.bytes]).toEqual([...bytes])
  })
})
