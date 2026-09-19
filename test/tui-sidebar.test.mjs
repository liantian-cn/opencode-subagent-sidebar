// 使用真实 Solid 响应式和 universal renderer，仅用内存节点替代终端宿主。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import vm from "node:vm"
import * as Solid from "solid-js/dist/solid.js"
import stringWidth from "string-width"

const forbidden = () => { throw new Error("只读边栏不得访问额外宿主 API、定时器或网络") }
const only = values => new Proxy(values, { get(target, key) {
  return Object.hasOwn(target, key) ? target[key] : forbidden()
} })
const node = (type, value = "") => ({ type, value, children: [], props: {}, parent: null, width: 30 })
const removeNode = (parent, child) => {
  assert.equal(child.parent, parent)
  parent.children.splice(parent.children.indexOf(child), 1)
  child.parent = null
}
const text = item => item.type === "#text" ? item.value : item.children.map(text).join("")
const lines = item => item.type === "text" ? [text(item)] : item.children.flatMap(lines)
const session = (id, parentID = "main", title = id, agent = "explore") =>
  ({ id, parentID, title, agent, time: { created: 0 } })

async function harness(t, initial, initialStatus) {
  const scope = vm.createContext(Object.fromEntries([
    "setTimeout", "setInterval", "setImmediate", "clearTimeout", "clearInterval", "clearImmediate", "fetch",
  ].map(name => [name, forbidden])))
  const synthetic = (name, exports) => new vm.SyntheticModule(Object.keys(exports), function () {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value)
  }, { context: scope, identifier: name })
  const solid = synthetic("solid-js", Solid)
  const universal = new vm.SourceTextModule(readFileSync(
    new URL("../node_modules/solid-js/universal/dist/universal.js", import.meta.url), "utf8",
  ), { context: scope })
  await universal.link(name => { assert.equal(name, "solid-js"); return solid })
  await universal.evaluate()
  const renderer = universal.namespace.createRenderer({
    createElement: type => node(type), createTextNode: value => node("#text", value),
    isTextNode: item => item.type === "#text", replaceText: (item, value) => { item.value = value },
    insertNode(parent, child, anchor) {
      if (child === anchor) return
      if (child.parent) removeNode(child.parent, child)
      const index = anchor == null ? parent.children.length : parent.children.indexOf(anchor)
      assert.ok(index >= 0)
      parent.children.splice(index, 0, child)
      child.parent = parent
    },
    removeNode, setProperty: (item, key, value) => { item.props[key] = value },
    getParentNode: item => item.parent, getFirstChild: item => item.children[0],
    getNextSibling: item => item.parent?.children[item.parent.children.indexOf(item) + 1],
  })
  const externals = new Map([
    ["solid-js", solid], ["@opentui/solid", synthetic("@opentui/solid", renderer)],
    ["string-width", synthetic("string-width", { default: stringWidth })],
    ["@opencode/plugin/tui", synthetic("@opencode/plugin/tui", { Plugin: { define: value => value } })],
  ])
  const modules = new Map(), requested = new Set()
  const directory = new URL("../dist/", import.meta.url)
  const load = url => {
    assert.ok(url.href.startsWith(directory.href), `相对导入越界：${url}`)
    if (!modules.has(url.href)) modules.set(url.href, new vm.SourceTextModule(readFileSync(url, "utf8"), {
      context: scope, identifier: url.href, importModuleDynamically: forbidden,
    }))
    return modules.get(url.href)
  }
  const entry = load(new URL("tui.js", directory))
  await entry.link((name, parent) => {
    if (name.startsWith(".")) return load(new URL(name, parent.identifier))
    assert.ok(externals.has(name), `未允许的运行依赖：${name}`)
    requested.add(name)
    return externals.get(name)
  })
  await entry.evaluate({ timeout: 1000 })
  assert.deepEqual([...requested].sort(), [...externals.keys()].sort())
  const [list, setList] = Solid.createSignal(initial), [status, setStatus] = Solid.createSignal(initialStatus)
  let reads = 0, unregisters = 0
  const slots = [], disposers = []
  const unregister = () => { unregisters++; disposers.splice(0).forEach(dispose => dispose()) }
  const cleanup = entry.namespace.default.setup(only({
    data: only({ session: only({ list: () => { reads++; return list() },
      status: id => { reads++; return status()[id] } }) }),
    theme: { text: { default: "white", subdued: "gray" } },
    ui: only({ slot: config => { slots.push(config); return unregister } }),
  }))
  t.after(() => { if (!unregisters) cleanup() })
  assert.equal(cleanup, unregister)
  assert.equal(slots.length, 1)
  assert.deepEqual(Object.keys(slots[0]).sort(), ["after", "render"])
  assert.equal(slots[0].after, "sidebar.content")
  assert.equal(reads, 0, "缓存应在插槽挂载时读取")
  return { setList, setStatus, cleanup, reads: () => reads, unregisters: () => unregisters,
    mount(id = "main") {
      const [sessionID, setSessionID] = Solid.createSignal(id), root = node("root")
      disposers.push(renderer.render(() => slots[0].render({ get sessionID() { return sessionID() } }), root))
      return { lines: () => lines(root), setSessionID, resize(width) {
        const box = root.children[0]
        box.width = width
        box.props.onSizeChange()
      } }
    },
  }
}

test("缓存已有任务立即显示，仅列出直属 running 子代理，结束后保留标题和空态", async t => {
  const h = await harness(t, [session("first"), session("second"), session("idle"), session("retry"),
    session("busy"), session("grandchild", "first"), session("other", "elsewhere"), session("main")],
  { first: "running", second: "running", idle: "idle", retry: "retry", busy: "busy",
    grandchild: "running", other: "running", main: "running" })
  const view = h.mount()
  assert.deepEqual(view.lines(), ["子代理", "进行中 · Explore", "first", "进行中 · Explore", "second"])
  h.setStatus(previous => ({ ...previous, first: "idle" }))
  assert.deepEqual(view.lines(), ["子代理", "进行中 · Explore", "second"])
  h.setStatus(previous => ({ ...previous, second: "idle" }))
  assert.deepEqual(view.lines(), ["子代理", "暂无活动子代理"])
})

test("缓存增改和状态响应式更新，切换会话与双插槽独立，卸载停止读取", async t => {
  const h = await harness(t, [session("a"), session("b", "other")], { a: "idle", b: "running" })
  const first = h.mount(), second = h.mount("other")
  assert.deepEqual(first.lines(), ["子代理", "暂无活动子代理"])
  assert.deepEqual(second.lines(), ["子代理", "进行中 · Explore", "b"])
  h.setStatus(previous => ({ ...previous, a: "running", c: "running" }))
  assert.deepEqual(first.lines(), ["子代理", "进行中 · Explore", "a"])
  h.setList(previous => [...previous, session("c", "main", "新增任务", "general")])
  assert.deepEqual(first.lines(), ["子代理", "进行中 · Explore", "a", "进行中 · General", "新增任务"])
  h.setList(previous => previous.map(item => item.id === "a" ? { ...item, title: "更新标题", agent: "reviewer" } : item))
  assert.deepEqual(first.lines(), ["子代理", "进行中 · Reviewer", "更新标题", "进行中 · General", "新增任务"])
  assert.deepEqual(second.lines(), ["子代理", "进行中 · Explore", "b"])
  first.setSessionID("other")
  assert.deepEqual(first.lines(), second.lines())
  second.setSessionID("missing")
  assert.deepEqual(second.lines(), ["子代理", "暂无活动子代理"])
  assert.deepEqual(first.lines(), ["子代理", "进行中 · Explore", "b"])
  first.setSessionID("main")
  assert.deepEqual(first.lines(), ["子代理", "进行中 · Reviewer", "更新标题", "进行中 · General", "新增任务"])
  h.cleanup()
  assert.equal(h.unregisters(), 1)
  const reads = h.reads(), snapshot = first.lines()
  h.setList([session("late")]); h.setStatus({ late: "running" })
  first.setSessionID("other"); second.setSessionID("main"); first.resize(1)
  assert.equal(h.reads(), reads, "dispose 后不应再订阅缓存或插槽属性")
  assert.deepEqual(first.lines(), snapshot)
})

test("box 测量宽度实时截断中文与 emoji，恢复宽度还原完整内容", async t => {
  const title = "中文👩‍💻中文🇨🇳结束"
  const h = await harness(t, [session("a", "main", title)], { a: "running" })
  const first = h.mount(), second = h.mount()
  assert.equal(first.lines()[2], title)
  for (const [width, expected] of [[8, "中文👩‍💻…"], [6, "中文…"], [1, "…"], [0, ""], [30, title]]) {
    first.resize(width)
    assert.equal(first.lines()[2], expected)
    assert.ok(first.lines().every(line => stringWidth(line) <= width))
    assert.equal(second.lines()[2], title, "一个插槽的宽度不得影响另一个插槽")
  }
  h.setStatus({ a: "idle" })
  first.resize(8)
  assert.deepEqual(first.lines(), ["子代理", "暂无活…"])
})
