export const LLAMA_CPP_RELEASE_TAG = "b10920"

const LLAMA_CPP_RELEASE_BASE_URL = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_RELEASE_TAG}`

const LLAMA_CPP_ASSETS = {
  "llama-b10920-bin-macos-arm64.tar.gz": {
    size: 11_153_577,
    sha256: "a05ab1b397698b7efc19bbfc75523f7a4cfc6c34d1757c464797917a8fbc2ce5",
  },
  "llama-b10920-bin-macos-x64.tar.gz": {
    size: 11_199_734,
    sha256: "dba733f9d21c4cd6e48b96fca56c73b61838c6515bab498d79f32f9056b29481",
  },
  "llama-b10920-bin-ubuntu-arm64.tar.gz": {
    size: 13_440_604,
    sha256: "b584f40001ead185a981a49d1a6d266baded6a5e00c6c5400963e81f2b230b9b",
  },
  "llama-b10920-bin-ubuntu-vulkan-arm64.tar.gz": {
    size: 24_201_486,
    sha256: "e91f9dfd15b8577523e9da1e928f73fb8445b3ad7ca4bdb702a40996382ad5a1",
  },
  "llama-b10920-bin-ubuntu-vulkan-x64.tar.gz": {
    size: 30_156_764,
    sha256: "96dda76d3c1ce5916879f4786e3130d4e1a1e1e00ca829782ad8931e3d5c3a57",
  },
  "llama-b10920-bin-ubuntu-x64.tar.gz": {
    size: 16_813_896,
    sha256: "701e191422c33bf790fc60640fa36360f1eb40e755a7bda7fd09312340866bec",
  },
} as const

export type LlamaCppAsset = {
  name: keyof typeof LLAMA_CPP_ASSETS
  url: string
  size: number
  sha256: string
}

export type LlamaBinaryTarget = {
  platform: NodeJS.Platform
  arch: string
  backend: "metal" | "vulkan" | "cpu"
}

export function supportsLlamaCppTarget(target: Pick<LlamaBinaryTarget, "platform" | "arch">) {
  return (
    (target.platform === "darwin" || target.platform === "linux") && (target.arch === "arm64" || target.arch === "x64")
  )
}

export function unsupportedLlamaCppTargetMessage(target: Pick<LlamaBinaryTarget, "platform" | "arch">) {
  return `Local inference is not supported on ${target.platform}/${target.arch}.`
}

export function pinnedLlamaCppAsset(target: LlamaBinaryTarget): LlamaCppAsset {
  const name = assetName(target)
  return { name, url: `${LLAMA_CPP_RELEASE_BASE_URL}/${name}`, ...LLAMA_CPP_ASSETS[name] }
}

function assetName(target: LlamaBinaryTarget): keyof typeof LLAMA_CPP_ASSETS {
  if (target.platform === "darwin" && target.arch === "arm64") {
    return `llama-${LLAMA_CPP_RELEASE_TAG}-bin-macos-arm64.tar.gz`
  }
  if (target.platform === "darwin" && target.arch === "x64") {
    return `llama-${LLAMA_CPP_RELEASE_TAG}-bin-macos-x64.tar.gz`
  }
  if (target.platform === "linux" && target.arch === "arm64") {
    return target.backend === "cpu"
      ? `llama-${LLAMA_CPP_RELEASE_TAG}-bin-ubuntu-arm64.tar.gz`
      : `llama-${LLAMA_CPP_RELEASE_TAG}-bin-ubuntu-vulkan-arm64.tar.gz`
  }
  if (target.platform === "linux" && target.arch === "x64") {
    return target.backend === "cpu"
      ? `llama-${LLAMA_CPP_RELEASE_TAG}-bin-ubuntu-x64.tar.gz`
      : `llama-${LLAMA_CPP_RELEASE_TAG}-bin-ubuntu-vulkan-x64.tar.gz`
  }
  throw new Error(unsupportedLlamaCppTargetMessage(target))
}
