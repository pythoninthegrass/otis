import { describe, expect, it } from "vitest"
import { LLAMA_CPP_RELEASE_TAG, pinnedLlamaCppAsset, supportsLlamaCppTarget } from "../../src/inference/llama-binary.js"

describe("llama.cpp binary selection", () => {
  it("builds deterministic asset URLs for the pinned release", () => {
    expect(LLAMA_CPP_RELEASE_TAG).toBe("b10920")
    expect(pinnedLlamaCppAsset({ platform: "darwin", arch: "arm64", backend: "metal" })).toEqual({
      name: "llama-b10920-bin-macos-arm64.tar.gz",
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b10920/llama-b10920-bin-macos-arm64.tar.gz",
      size: 11_153_577,
      sha256: "a05ab1b397698b7efc19bbfc75523f7a4cfc6c34d1757c464797917a8fbc2ce5",
    })
    expect(pinnedLlamaCppAsset({ platform: "linux", arch: "x64", backend: "vulkan" }).name).toBe(
      "llama-b10920-bin-ubuntu-vulkan-x64.tar.gz",
    )
    expect(pinnedLlamaCppAsset({ platform: "linux", arch: "x64", backend: "cpu" }).name).toBe(
      "llama-b10920-bin-ubuntu-x64.tar.gz",
    )
  })

  it("rejects unsupported platforms before a model is selected", () => {
    expect(supportsLlamaCppTarget({ platform: "linux", arch: "x64" })).toBe(true)
    expect(supportsLlamaCppTarget({ platform: "darwin", arch: "arm64" })).toBe(true)
    expect(supportsLlamaCppTarget({ platform: "win32", arch: "x64" })).toBe(false)
    expect(() => pinnedLlamaCppAsset({ platform: "win32", arch: "x64", backend: "cpu" })).toThrow(
      "Local inference is not supported on win32/x64.",
    )
  })
})
