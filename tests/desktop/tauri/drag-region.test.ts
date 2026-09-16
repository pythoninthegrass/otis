// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"
import { initTitleBarDrag } from "../../../src/desktop/tauri/drag-region.js"

const startDragging = vi.fn()
const toggleMaximize = vi.fn()
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    startDragging: (...args: unknown[]) => startDragging(...args),
    toggleMaximize: (...args: unknown[]) => toggleMaximize(...args),
  }),
}))

function mousedown(target: Element, detail = 1) {
  target.dispatchEvent(new MouseEvent("mousedown", { button: 0, detail, bubbles: true, cancelable: true }))
}

let unsubscribe: (() => void) | undefined

afterEach(() => {
  unsubscribe?.()
  unsubscribe = undefined
  document.body.innerHTML = ""
  startDragging.mockClear()
  toggleMaximize.mockClear()
})

describe("initTitleBarDrag", () => {
  it("starts dragging on a single mousedown inside a drag region", () => {
    document.body.innerHTML = '<header class="workspaceHeader"><span id="label">Otis</span></header>'
    unsubscribe = initTitleBarDrag()
    mousedown(document.getElementById("label") as Element)
    expect(startDragging).toHaveBeenCalledTimes(1)
    expect(toggleMaximize).not.toHaveBeenCalled()
  })

  it("toggles maximize on a double-click inside a drag region", () => {
    document.body.innerHTML = '<div class="settingsPage-header"><span id="label">Settings</span></div>'
    unsubscribe = initTitleBarDrag()
    mousedown(document.getElementById("label") as Element, 2)
    expect(toggleMaximize).toHaveBeenCalledTimes(1)
    expect(startDragging).not.toHaveBeenCalled()
  })

  it("ignores a mousedown on a .noDrag element even inside a drag region", () => {
    document.body.innerHTML =
      '<header class="workspaceHeader"><button class="noDrag" id="btn">Settings</button></header>'
    unsubscribe = initTitleBarDrag()
    mousedown(document.getElementById("btn") as Element)
    expect(startDragging).not.toHaveBeenCalled()
    expect(toggleMaximize).not.toHaveBeenCalled()
  })

  it("ignores a mousedown outside any drag region", () => {
    document.body.innerHTML = '<div id="elsewhere">Not a drag region</div>'
    unsubscribe = initTitleBarDrag()
    mousedown(document.getElementById("elsewhere") as Element)
    expect(startDragging).not.toHaveBeenCalled()
  })

  it("ignores a non-primary mouse button", () => {
    document.body.innerHTML = '<header class="workspaceHeader"><span id="label">Otis</span></header>'
    unsubscribe = initTitleBarDrag()
    document
      .getElementById("label")
      ?.dispatchEvent(new MouseEvent("mousedown", { button: 2, detail: 1, bubbles: true, cancelable: true }))
    expect(startDragging).not.toHaveBeenCalled()
  })

  it("stops listening after unsubscribe", () => {
    document.body.innerHTML = '<header class="workspaceHeader"><span id="label">Otis</span></header>'
    unsubscribe = initTitleBarDrag()
    unsubscribe()
    mousedown(document.getElementById("label") as Element)
    expect(startDragging).not.toHaveBeenCalled()
  })
})
