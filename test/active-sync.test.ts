import { test, type TestContext } from "node:test"
import assert from "node:assert/strict"
import type { Context } from "@opencode/plugin/tui/context"
import { Controller } from "../src/core/controller.js"
import { Tree } from "../src/core/tree.js"
import { EventJournal } from "../src/core/journal.js"
import { MissingSession, type Snapshot } from "../src/core/types.js"
import { source208 } from "../src/v208.js"
import { deferred, end, event, FakeSource, snapshot, task } from "./helpers.js"

const link = (childID: string, parentID = "root") => ({ parentID, childID, key: childID, at: 1 })
function fixture() {
  return new FakeSource().add(snapshot("root", undefined, { links: [link("a"), link("b"), link("c")] }),
    ...["a", "b", "c"].map(id => task(id, "root", { running: true })))
}
const visible = (controller: Controller) => controller.current!.rows().map(row => row.id)
async function flush(context: TestContext) {
  context.mock.timers.tick(150)
  await new Promise<void>(resolve => setImmediate(resolve))
}

test("局部 A 失败后 B 成功不能清 A；A 真正恢复后 ready，再次失败回 stale", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const api = fixture()
  const controller = new Controller(api, () => {}, () => 10)
  context.after(() => controller.dispose())
  await controller.select("root")
  const get = api.get.bind(api)
  let fail = true
  api.get = async (id, signal) => { if (id === "a" && fail) throw new Error("A 离线"); return get(id, signal) }
  api.emit({ kind: "refresh", sessionID: "a" })
  await flush(context)
  assert.equal(controller.state, "stale")
  assert.deepEqual(visible(controller), ["b", "c"])
  const calls = api.requests.length
  await flush(context)
  assert.equal(api.requests.length, calls, "无事件时不定时重试网络")
  api.emit({ kind: "refresh", sessionID: "b" })
  await flush(context)
  assert.equal(controller.state, "stale")
  assert.deepEqual(visible(controller), ["b", "c"])
  fail = false
  api.emit({ kind: "refresh", sessionID: "a" })
  await flush(context)
  assert.equal(controller.state, "ready")
  assert.deepEqual(visible(controller), ["a", "b", "c"])
  fail = true
  api.emit({ kind: "refresh", sessionID: "a" })
  await flush(context)
  assert.equal(controller.state, "stale")
})

test("明确删除失败范围后清除过期提示，但其他失败范围仍保留", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const api = fixture()
  const controller = new Controller(api, () => {}, () => 10)
  context.after(() => controller.dispose())
  await controller.select("root")
  const get = api.get.bind(api)
  api.get = async (id, signal) => { if (id === "a" || id === "b") throw new Error("不可读"); return get(id, signal) }
  for (const id of ["a", "b"]) api.emit({ kind: "refresh", sessionID: id })
  await flush(context)
  assert.equal(controller.state, "stale")
  api.emit({ kind: "deleted", id: "delete-a", sessionID: "a", at: 20 })
  assert.equal(controller.state, "stale")
  assert.deepEqual(visible(controller), ["c"])
  api.emit({ kind: "deleted", id: "delete-b", sessionID: "b", at: 30 })
  assert.equal(controller.state, "ready")
  assert.deepEqual(visible(controller), ["c"])
})

test("同批 A/B/C 补读 B 失败仍提交 C，不丢未完成范围", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const api = fixture()
  const controller = new Controller(api, () => {}, () => 10)
  context.after(() => controller.dispose())
  await controller.select("root")
  api.gate = async info => { if (info.id === "b") throw new Error("B"); return api.snapshots.get(info.id)! }
  api.add(task("c", "root", { running: true, forms: ["form"] }))
  for (const id of ["a", "b", "c"]) api.emit({ kind: "refresh", sessionID: id })
  await flush(context)
  assert.equal(controller.state, "stale")
  assert.deepEqual(visible(controller), ["a", "c"])
  assert.equal(controller.current!.rows().find(row => row.id === "c")!.status, "待输入")
  assert.deepEqual([...controller.current!.invalidScopes], ["b"])
})

test("局部失效覆盖后代，子节点成功不解除祖先失败，父子整段恢复才解除", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const api = fixture().add(task("a", "root", { running: true, links: [link("deep", "a")] }), task("deep", "a", { running: true }))
  const controller = new Controller(api, () => {}, () => 10)
  context.after(() => controller.dispose())
  await controller.select("root")
  api.gate = async info => { if (info.id === "a") throw new Error("A"); return api.snapshots.get(info.id)! }
  api.emit({ kind: "refresh", sessionID: "a" })
  await flush(context)
  assert.deepEqual(visible(controller), ["b", "c"])
  api.emit({ kind: "refresh", sessionID: "deep" })
  await flush(context)
  assert.equal(controller.state, "stale")
  assert.deepEqual(visible(controller), ["b", "c"])
  api.gate = undefined
  api.emit({ kind: "refresh", sessionID: "a" })
  await flush(context)
  assert.equal(controller.state, "ready")
  assert.deepEqual(visible(controller), ["a", "b", "c", "deep"])
})

test("全量枚举遗漏已知失败节点时须补查，不能清除尚未成功读取的范围", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const api = fixture()
  const controller = new Controller(api, () => {}, () => 10)
  context.after(() => controller.dispose())
  await controller.select("root")
  const get = api.get.bind(api)
  let fail = true
  api.get = async (id, signal) => { if (id === "a" && fail) throw new Error("A 不可读"); return get(id, signal) }
  api.emit({ kind: "refresh", sessionID: "a" })
  await flush(context)
  api.childPages.set("root", [["b", "c"]])
  await controller.refresh()
  assert.equal(controller.state, "stale")
  assert.equal(controller.current!.invalidScopes.has("a"), true)
  assert.equal(controller.current!.deleted("a"), false)
  fail = false
  await controller.refresh()
  assert.equal(controller.state, "ready")
  assert.deepEqual(visible(controller), ["a", "b", "c"])
})

test("未落地关联失败可由手动全量校准恢复，不依赖再次收到同 child 事件", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const api = new FakeSource().add(snapshot("root", undefined, { links: [link("a")] }))
  const controller = new Controller(api, () => {}, () => 10)
  context.after(() => controller.dispose())
  await controller.select("root")
  await flush(context)
  assert.equal(controller.state, "stale")
  api.add(task("a", "root", { running: true }))
  api.childPages.set("root", [[]])
  await controller.refresh()
  await flush(context)
  assert.equal(controller.state, "ready")
  assert.deepEqual(visible(controller), ["a"])
})

test("选择 child 时局部普通读取失败仍只隐藏该分支", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const api = fixture()
  const controller = new Controller(api, () => {}, () => 10)
  context.after(() => controller.dispose())
  await controller.select("a")
  api.gate = async info => { if (info.id === "a") throw new Error("A"); return api.snapshots.get(info.id)! }
  api.emit({ kind: "refresh", sessionID: "a" })
  await flush(context)
  assert.equal(controller.state, "stale")
  assert.deepEqual(visible(controller), ["b", "c"])
})

test("start/end/info 事件只触发补读，不能自行清 stale", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const api = fixture()
  const controller = new Controller(api, () => {}, () => 10)
  context.after(() => controller.dispose())
  await controller.select("root")
  api.gate = async () => { throw new Error("断网") }
  api.emit({ kind: "refresh", sessionID: "a" })
  await flush(context)
  for (const input of [event("start", "a", 20), end("a", 30), { kind: "info" as const, id: "rename", at: 40, sessionID: "a", info: { title: "新标题" } }]) {
    api.emit(input)
    assert.equal(controller.state, "stale")
    assert.deepEqual(visible(controller), ["b", "c"])
  }
  await flush(context)
  assert.equal(controller.state, "stale")
})

test("全量失败后已排队的单子树成功不能清整树失效；后续事件合并触发全量恢复", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const api = fixture()
  const controller = new Controller(api, () => {}, () => 10)
  context.after(() => controller.dispose())
  await controller.select("root")
  const gate = deferred<Snapshot>()
  const reached = deferred<void>()
  api.gate = async info => { if (info.id === "a") { reached.resolve(); return gate.promise } return api.snapshots.get(info.id)! }
  const loading = controller.refresh()
  await reached.promise
  api.emit({ kind: "refresh", sessionID: "b" })
  gate.reject(new Error("全量 A 失败"))
  await loading
  api.gate = undefined
  await flush(context)
  assert.equal(controller.state, "stale")
  assert.deepEqual(visible(controller), [])
  const roots = api.requests.filter(request => request.id === "root").length
  for (let i = 0; i < 5; i++) api.emit({ kind: "refresh", sessionID: "b" })
  assert.equal(controller.state, "stale")
  await flush(context)
  assert.equal(controller.state, "ready")
  assert.equal(api.requests.filter(request => request.id === "root").length - roots, 2)
  assert.deepEqual(visible(controller), ["a", "b", "c"])
  api.gate = async () => { throw new Error("再次失败") }
  api.emit({ kind: "refresh", sessionID: "a" })
  await flush(context)
  assert.equal(controller.state, "stale")
  assert.deepEqual(visible(controller), ["b", "c"])
})

test("全局 active 读取失败不能当局部故障，整树隐藏", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const api = fixture()
  const controller = new Controller(api, () => {}, () => 10)
  context.after(() => controller.dispose())
  await controller.select("root")
  api.active = async () => { throw new Error("active 不可用") }
  api.emit({ kind: "refresh", sessionID: "a" })
  await flush(context)
  assert.equal(controller.state, "stale")
  assert.deepEqual(visible(controller), [])
})

test("局部失败恢复时 revision 拒绝不能 ready，后续成功提交才恢复", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const api = fixture()
  const controller = new Controller(api, () => {}, () => 10)
  context.after(() => controller.dispose())
  await controller.select("root")
  api.gate = async () => { throw new Error("读取失败") }
  api.emit({ kind: "refresh", sessionID: "a" })
  await flush(context)
  const gate = deferred<Snapshot>()
  const reached = deferred<void>()
  api.gate = async info => { reached.resolve(); return gate.promise }
  api.emit({ kind: "refresh", sessionID: "a" })
  context.mock.timers.tick(150)
  await reached.promise
  api.emit(event("start", "a", 20))
  gate.resolve(api.snapshots.get("a")!)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(controller.state, "stale")
  assert.deepEqual(visible(controller), ["b", "c"])
  api.gate = undefined
  await flush(context)
  assert.equal(controller.state, "ready")
  assert.equal(controller.current!.rows()[0].started, 20)
})

test("全量失效恢复遇 revision 竞争，单项重读成功仍不能替代全量校准", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const api = fixture()
  const controller = new Controller(api, () => {}, () => 10)
  context.after(() => controller.dispose())
  await controller.select("root")
  api.gate = async () => { throw new Error("失败") }
  await controller.refresh()
  const gate = deferred<Snapshot>()
  const reached = deferred<void>()
  api.gate = async info => { if (info.id === "a") { reached.resolve(); return gate.promise } return api.snapshots.get(info.id)! }
  const loading = controller.refresh()
  await reached.promise
  // 直接模拟读取期间 revision 变化，不额外触发新一轮整树事件调度。
  controller.current!.event(event("start", "a", 20))
  gate.resolve(api.snapshots.get("a")!)
  await loading
  assert.equal(controller.state, "stale")
  api.gate = undefined
  await flush(context)
  assert.equal(controller.state, "stale")
  assert.deepEqual(visible(controller), [])
  await controller.refresh()
  assert.equal(controller.state, "ready")
})

test("缓冲溢出隐藏全树并阻止晚响应提交，下一事件须全量恢复", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const api = fixture()
  const controller = new Controller(api, () => {}, () => 10)
  context.after(() => controller.dispose())
  await controller.select("root")
  const gate = deferred<Snapshot>()
  const reached = deferred<void>()
  api.gate = async info => { if (info.id === "a") { reached.resolve(); return gate.promise } return api.snapshots.get(info.id)! }
  const loading = controller.refresh()
  await reached.promise
  for (let i = 0; i <= EventJournal.limit; i++) api.emit({ kind: "permission", id: `p${i}`, at: 20 + i, sessionID: "unknown", requestID: String(i), pending: true })
  assert.equal(controller.state, "stale")
  assert.deepEqual(visible(controller), [])
  gate.resolve(api.snapshots.get("a")!)
  await loading
  assert.equal(controller.state, "stale")
  api.gate = undefined
  api.emit({ kind: "refresh", sessionID: "b" })
  await flush(context)
  assert.equal(controller.state, "ready")
})

test("切换根时中止局部读取，晚到 children 不写旧树，失效范围不串新树", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const api = fixture().add(snapshot("other"))
  const controller = new Controller(api, () => {}, () => 10)
  context.after(() => controller.dispose())
  await controller.select("root")
  const old = controller.current!
  const children = api.children.bind(api)
  const reached = deferred<void>()
  const gate = deferred<void>()
  api.children = async (id, cursor) => { if (id === "a") { reached.resolve(); await gate.promise; return { data: [{ id: "late", parentID: "a" }] } } return children(id, cursor) }
  api.emit({ kind: "refresh", sessionID: "a" })
  context.mock.timers.tick(150)
  await reached.promise
  await controller.select("other")
  gate.resolve()
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(controller.state, "ready")
  assert.equal(controller.current!.rootID, "other")
  assert.equal(old.nodes.has("late"), false)
  assert.equal(old.requiresValidation(), true)
  assert.deepEqual(visible(controller), [])
  api.children = children
  await controller.select("root")
  assert.equal(controller.state, "ready")
  assert.equal(old.requiresValidation(), false)
})

test("确认不存在的 child snapshot/children 剔除整段分支，其余活跃项正常", async () => {
  for (const boundary of ["snapshot", "children"] as const) {
    const api = fixture().add(task("a", "root", { links: [link("deep", "a")] }), task("deep", "a", { running: true }))
    if (boundary === "snapshot") api.gate = async info => { if (info.id === "a") throw new MissingSession("a"); return api.snapshots.get(info.id)! }
    else {
      const children = api.children.bind(api)
      api.children = async (id, cursor) => { if (id === "a") throw new MissingSession("a"); return children(id, cursor) }
    }
    const controller = new Controller(api, () => {}, () => 10)
    await controller.select("root")
    assert.equal(controller.state, "ready")
    assert.deepEqual(visible(controller), ["b", "c"])
    assert.equal(controller.current!.deleted("a"), true)
    assert.equal(controller.current!.nodes.has("deep"), false)
    controller.dispose()
  }
})

test("根/所选会话不存在不能成为健康空树，普通 snapshot 失败不能删除", async () => {
  for (const id of ["root", "a"]) {
    const api = fixture()
    api.gate = async info => { if (info.id === id) throw new MissingSession(id); return api.snapshots.get(info.id)! }
    const controller = new Controller(api, () => {}, () => 10)
    await controller.select(id)
    assert.equal(controller.state, "error")
    assert.deepEqual(visible(controller), [])
    controller.dispose()
  }
  const api = fixture()
  api.gate = async info => { if (info.id === "a") throw new Error("普通失败"); return api.snapshots.get(info.id)! }
  const controller = new Controller(api, () => {}, () => 10)
  await controller.select("root")
  assert.equal(controller.state, "stale")
  assert.equal(controller.current!.deleted("a"), false)
  controller.dispose()
})

test("适配器各读取边界只转换 ID 匹配且结构正确的 SessionNotFoundError", async () => {
  const signal = new AbortController().signal
  for (const boundary of ["children", "message", "permission", "form"] as const) {
    const errors = [{ _tag: "SessionNotFoundError", sessionID: "a", message: "不存在" },
      { status: 404 }, new Error("network"), { _tag: "UnauthorizedError", message: "禁止" },
      { _tag: "SessionNotFoundError", sessionID: "other", message: "不存在" }, { _tag: "SessionNotFoundError", sessionID: "a" }]
    for (const [index, error] of errors.entries()) {
      const read = (name: string) => async () => { if (name === boundary) throw error; return { data: [], cursor: {} } }
      const context = { client: {
        session: { list: read("children"), form: { list: async () => { if (boundary === "form") throw error; return [] } } },
        message: { list: read("message") }, permission: { list: async () => { if (boundary === "permission") throw error; return [] } },
      } } as unknown as Context
      const source = source208(context)
      await assert.rejects(boundary === "children" ? source.children("a", undefined, signal) : source.snapshot({ id: "a" }, false, signal),
        value => index === 0 ? value instanceof MissingSession && value.sessionID === "a" : value === error)
    }
  }
})

test("未知/终态隐藏且编号稳定；当前等待可显示，shutdown 等待隐藏恢复延续墙钟", () => {
  const tree = new Tree("root", 10)
  tree.snapshot(snapshot("root"), 0)
  tree.snapshot(task("a"), 0)
  tree.associate(link("a"))
  const number = tree.nodes.get("a")!.number
  assert.deepEqual(tree.rows(), [])
  for (const kind of ["permission", "form"] as const) {
    tree.event({ kind, id: kind, sessionID: "a", at: 20, requestID: kind, pending: true })
    assert.equal(tree.rows().length, 1)
    assert.equal(tree.rows()[0].started, undefined)
    tree.event({ kind, id: `${kind}-done`, sessionID: "a", at: 21, requestID: kind, pending: false })
    assert.deepEqual(tree.rows(), [])
  }
  tree.event({ kind: "retry", id: "retry", sessionID: "a", at: 25, until: 50 })
  assert.equal(tree.rows()[0].status, "重试等待")
  tree.event(event("start", "a", 100))
  tree.event({ kind: "permission", id: "p2", sessionID: "a", at: 110, requestID: "p2", pending: true })
  tree.event(event("shutdown", "a", 120))
  assert.deepEqual(tree.rows(), [])
  tree.snapshot(task("a", "root", { running: true }), tree.nodes.get("a")!.revision)
  assert.equal(tree.rows()[0].started, 100)
  tree.event(event("start", "a", 130))
  assert.equal(tree.rows()[0].started, 100)
  for (const [index, outcome] of (["succeeded", "failed", "interrupted"] as const).entries()) {
    const at = 200 + index * 100
    tree.event(end("a", at, outcome))
    assert.deepEqual(tree.rows(), [])
    assert.equal(tree.nodes.get("a")!.round.outcome, outcome)
    tree.event({ kind: "permission", id: `late${index}`, sessionID: "a", at: at + 1, requestID: `late${index}`, pending: true })
    assert.deepEqual(tree.rows(), [])
    tree.event(event("start", "a", at + 10))
    assert.equal(tree.rows()[0].number, number)
    assert.equal(tree.rows()[0].started, at + 10)
  }
})

test("快照清除旧重试证据；shutdown 后快照确认结束，新 start 必须新轮", () => {
  const tree = new Tree("root", 10)
  tree.snapshot(snapshot("root"), 0)
  tree.snapshot(task("a", "root", { assistant: { at: 20, retryAt: 50 } }), 0)
  tree.associate(link("a"))
  assert.equal(tree.rows()[0].status, "重试等待")
  tree.snapshot(task("a"), 0)
  assert.deepEqual(tree.rows(), [])
  tree.event(event("start", "a", 100))
  tree.event(event("shutdown", "a", 120))
  tree.snapshot(task("a", "root", { info: { id: "a", parentID: "root", idle: 150, outcome: "failed" } }), tree.nodes.get("a")!.revision)
  assert.deepEqual(tree.rows(), [])
  tree.event(event("start", "a", 200))
  assert.equal(tree.rows()[0].started, 200)
  assert.equal(tree.nodes.get("a")!.round.ended, undefined)
})
