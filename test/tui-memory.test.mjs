// 用隔离 VM 和显式宿主桩验证内存升级与空面板关闭，不启动 TUI、渲染器或服务。
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import vm from "node:vm"

test("热重载使用新 schema 内存，旧 rows 不执行；ready 无活跃只关闭自己的面板", async () => {
  const effects = []
  const unexpected = () => { throw new Error("不得调用真实渲染或网络") }
  const scope = vm.createContext({ AbortController, AbortSignal, setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval: () => {} })
  const exports = {
    "@opencode/plugin/tui": { Plugin: { define: value => value } },
    "solid-js": {
      createSignal: value => [() => value, next => { value = typeof next === "function" ? next(value) : next }],
      createMemo: fn => fn, createEffect: fn => { effects.push(fn); fn() }, For: unexpected, Show: unexpected,
    },
    "@opentui/solid": Object.fromEntries(["memo", "createTextNode", "insertNode", "createComponent", "effect", "insert", "setProp", "use", "createElement"].map(name => [name, unexpected])),
    "string-width": { default: unexpected },
  }
  const mocks = new Map(Object.entries(exports).map(([name, values]) => [name, new vm.SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value)
  }, { context: scope })]))
  const modules = new Map()
  const load = url => {
    if (!modules.has(url)) modules.set(url, new vm.SourceTextModule(readFileSync(new URL(url), "utf8"), { context: scope, identifier: url }))
    return modules.get(url)
  }
  const entry = load(new URL("../dist/tui.js", import.meta.url).href)
  await entry.link((name, parent) => name.startsWith(".") ? load(new URL(name, parent.identifier).href) : mocks.get(name))
  await entry.evaluate()
  const old = { trees: new Map([["root", { rows: unexpected }]]) }
  const memories = new Map([["trees", old]])
  const slots = []
  let listener, panel = { name: "subagent-sidebar.tree" }, closed = 0
  const infos = [{ id: "root", time: {} }, { id: "a", parentID: "root", time: {} }]
  const context = {
    storage: { memory: (key, { initial }) => { if (!memories.has(key)) memories.set(key, initial); return [memories.get(key)] } },
    client: {
      session: { get: async ({ sessionID }) => infos.find(info => info.id === sessionID),
        list: async ({ parentID }) => ({ data: infos.filter(info => info.parentID === parentID), cursor: {} }),
        active: async () => ({ a: {} }), form: { list: async () => [] } },
      message: { list: async ({ sessionID }) => ({ data: sessionID === "root" ? [{ type: "assistant", id: "msg", time: { created: 1 }, content: [
        { type: "tool", id: "call", name: "subagent", time: { created: 1 }, state: { status: "completed", input: { sessionID: "a" }, metadata: {} } },
      ] }] : [], cursor: {} }) }, permission: { list: async () => [] },
    },
    data: { listen: fn => { listener = fn; return () => { listener = undefined } } },
    keymap: { layer: () => {} },
    ui: { slot: value => { slots.push(value); return () => {} }, router: { current: () => ({ type: "session", sessionID: "root" }) },
      panel: { current: () => panel, close: () => { closed++; panel = undefined } } },
  }
  const stop = entry.namespace.default.setup(context)
  try {
    slots.find(slot => slot.append === "app").render()
    await new Promise(resolve => setImmediate(resolve))
    const tree = memories.get("trees-active-v1").trees.get("root")
    assert.notEqual(tree, old.trees.get("root"))
    assert.equal(memories.get("trees"), old)
    assert.equal(tree.rows().length, 1)
    assert.equal(tree.rows()[0].started, undefined, "升级恢复不得伪造开始时间")
    listener({ details: { type: "session.execution.succeeded", id: "end", created: Date.now() + 1, data: { sessionID: "a" } } })
    for (const effect of effects) effect()
    assert.equal(tree.rows().length, 0)
    assert.equal(closed, 1)
    panel = { name: "other-plugin.panel" }
    for (const effect of effects) effect()
    assert.equal(closed, 1)
  } finally { stop() }
})
