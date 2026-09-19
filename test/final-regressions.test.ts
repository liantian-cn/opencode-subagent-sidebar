import { test } from "node:test"
import assert from "node:assert/strict"
import type { Context } from "@opencode/plugin/tui/context"
import { Controller } from "../src/core/controller.js"
import { Tree } from "../src/core/tree.js"
import { EventJournal } from "../src/core/journal.js"
import { MissingSession, type Event, type Snapshot } from "../src/core/types.js"
import { sessionNotFound208, source208 } from "../src/v208.js"
import { FakeSource, deferred, event, end, snapshot, task } from "./helpers.js"

const link = (childID: string, parentID = "root") => ({ parentID, childID, at: 1, key: childID })
function seeded() {
  const tree = new Tree("root", 10)
  tree.snapshot(snapshot("root"), 0)
  tree.snapshot(task("a", "root", { running: true }), 0)
  tree.associate(link("a"))
  tree.initialized = true
  return tree
}
function request(kind: "permission" | "form", id: string, at: number, pending: boolean): Event {
  return { kind, id: `${kind}-${id}-${at}-${pending}`, at, sessionID: "a", requestID: id, pending }
}

test("最终 P1 SDK 明确 SessionNotFoundError 才归类删除，不把裸 404/权限/网络错误当删除", async () => {
  const missing = { _tag: "SessionNotFoundError", sessionID: "gone", message: "Not found" }
  assert.equal(sessionNotFound208(missing, "gone"), true)
  const errors = [{ status: 404 }, { _tag: "UnauthorizedError", message: "Denied" },
    { _tag: "SessionNotFoundError", sessionID: "other", message: "Not found" }, new Error("network")]
  for (const error of errors) assert.equal(sessionNotFound208(error, "gone"), false)
  let thrown: unknown = missing
  const context = { client: { session: { get: async () => { throw thrown } } } } as unknown as Context
  const source = source208(context)
  await assert.rejects(source.get("gone", new AbortController().signal), error => error instanceof MissingSession && error.sessionID === "gone")
  for (const error of errors) {
    thrown = error
    await assert.rejects(source.get("gone", new AbortController().signal), value => value === error)
  }
})

test("最终 P1 历史 link 指向明确不存在 child，墓碑使正常空态且刷新不再 GET", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const api = new FakeSource().add(snapshot("root", undefined, { links: [link("gone")] }))
  const get = api.get.bind(api)
  let missingReads = 0
  api.get = async (id, signal) => {
    if (id === "gone") { missingReads++; throw new MissingSession(id) }
    return get(id, signal)
  }
  let done = deferred<void>()
  const controller = new Controller(api, () => { if (controller.state === "ready") done.resolve() }, () => 10)
  await controller.select("root")
  assert.equal(controller.state, "loading")
  context.mock.timers.tick(150)
  await done.promise
  assert.equal(controller.state, "ready")
  assert.deepEqual(controller.current!.rows(), [])
  assert.deepEqual(controller.current!.pendingIDs(), [])
  assert.equal(controller.current!.deleted("gone"), true)
  done = deferred<void>()
  await controller.refresh()
  context.mock.timers.tick(150)
  assert.equal(missingReads, 1)
  assert.equal(controller.state, "ready")
  controller.dispose()
})

test("最终 P1 父快照返回前 unknown child deleted，旧 link 到达后绑定删除而不补读", async () => {
  const api = new FakeSource().add(snapshot("root"))
  const gate = deferred<Snapshot>()
  const reached = deferred<void>()
  api.gate = async () => { reached.resolve(); return gate.promise }
  const controller = new Controller(api, () => {}, () => 10)
  const loading = controller.select("root")
  await reached.promise
  api.emit({ kind: "deleted", id: "delete-gone", sessionID: "gone", at: 30, seq: 8 })
  gate.resolve(snapshot("root", undefined, { links: [link("gone")] }))
  await loading
  assert.equal(controller.state, "ready")
  assert.equal(controller.current!.deleted("gone"), true)
  assert.equal(api.requests.some(request => request.id === "gone"), false)
  assert.deepEqual(controller.current!.pendingIDs(), [])
  assert.deepEqual(controller.current!.rows(), [])
  controller.dispose()
})

test("最终 P1 pending child 的删除立即投影，unknown 删除只在关联树生效", () => {
  const journal = new EventJournal()
  const a = new Tree("root", 10)
  const b = new Tree("other", 10)
  a.snapshot(snapshot("root"), 0)
  b.snapshot(snapshot("other"), 0)
  journal.add({ kind: "deleted", id: "delete", sessionID: "gone", at: 20, seq: 1 })
  journal.drain(b)
  assert.equal(b.deleted("gone"), false)
  a.associate(link("gone"))
  journal.drain(a)
  assert.equal(a.deleted("gone"), true)
  assert.equal(b.deleted("gone"), false)
  a.associate(link("second"))
  a.event({ kind: "deleted", id: "delete-second", sessionID: "second", at: 30 })
  assert.equal(a.deleted("second"), true)
})

test("最终 P1 补读网络/权限错误保持 stale，不生成删除墓碑", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  for (const error of [new Error("network"), { _tag: "UnauthorizedError", message: "Denied" }]) {
    const api = new FakeSource().add(snapshot("root", undefined, { links: [link("child")] }))
    const get = api.get.bind(api)
    api.get = async (id, signal) => { if (id === "child") throw error; return get(id, signal) }
    const done = deferred<void>()
    const controller = new Controller(api, () => { if (controller.state === "stale") done.resolve() }, () => 10)
    await controller.select("root")
    context.mock.timers.tick(150)
    await done.promise
    assert.equal(controller.current!.deleted("child"), false)
    assert.deepEqual(controller.current!.pendingIDs(), ["child"])
    controller.dispose()
  }
})

test("最终 P2 首次 hydration 前 rename/agent/model 事件不改变旧终态基线资格", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  for (const info of [{ title: "新标题" }, { agent: "review" }, { model: "new-model" }]) {
    const api = new FakeSource().add(snapshot("root", undefined, { links: [link("a")] }),
      task("a", "root", { info: { id: "a", parentID: "root", idle: 5, outcome: "succeeded" } }))
    const reached = deferred<void>()
    const gate = deferred<Snapshot>()
    api.gate = async value => {
      if (value.id !== "a") return api.snapshots.get(value.id)!
      reached.resolve()
      return gate.promise
    }
    const done = deferred<void>()
    let finishing = false
    const controller = new Controller(api, () => { if (finishing) done.resolve() }, () => 10)
    const loading = controller.select("root")
    await reached.promise
    api.emit({ kind: "info", id: "metadata", sessionID: "a", at: 20, seq: 2, info })
    gate.resolve(api.snapshots.get("a")!)
    await loading
    api.gate = undefined
    finishing = true
    context.mock.timers.tick(150)
    await done.promise
    assert.equal(controller.state, "ready")
    assert.deepEqual(controller.current!.rows(), [])
    await controller.refresh()
    assert.deepEqual(controller.current!.rows(), [])
    controller.dispose()
  }
})

test("最终 P2 初始 metadata 竞争延迟基线仍不追溯；真正 start/end 必须保留", () => {
  const initial = seeded()
  const hidden = task("old", "root", { info: { id: "old", parentID: "root", idle: 30, outcome: "succeeded" } })
  initial.initialized = false
  initial.discover(hidden.info)
  initial.event({ kind: "info", id: "rename", sessionID: "old", at: 40, seq: 5, info: { title: "名字" } })
  initial.initialized = true
  initial.snapshot(hidden, initial.nodes.get("old")!.revision)
  initial.associate(link("old"))
  assert.equal(initial.rows().some(row => row.id === "old"), false)
  initial.event({ ...event("start", "old", 50), seq: 6 })
  initial.event({ ...end("old", 60), seq: 7 })
  assert.equal(initial.rows().find(row => row.id === "old")!.ended, 60)
})

test("最终 P3 跨 permission/form 及两个 permission 的迟到回复均按各自身份处理", () => {
  for (const second of ["form", "permission"] as const) {
    const events = [request("permission", "P", 20, true), request(second, "F", 40, true),
      request("permission", "P", 30, false), request(second, "F", 50, false)]
    const direct = seeded()
    const journal = new EventJournal()
    for (const input of events) { direct.event(input); journal.add(input) }
    assert.equal(direct.nodes.get("a")!.permissions.size, 0)
    assert.equal(direct.nodes.get("a")!.forms.size, 0)
    const replayed = seeded()
    journal.drain(replayed)
    assert.equal(replayed.nodes.get("a")!.permissions.size, 0)
    assert.equal(replayed.nodes.get("a")!.forms.size, 0)
  }
})

test("最终 P3 同 request 回复先到或旧 asked 重放均不能复活等待", () => {
  for (const kind of ["permission", "form"] as const) {
    const direct = seeded()
    const journal = new EventJournal()
    for (const input of [request(kind, "P", 30, false), request(kind, "P", 20, true), request(kind, "P", 40, true)]) {
      direct.event(input)
      journal.add(input)
    }
    journal.drain(direct)
    assert.equal(direct.nodes.get("a")!.permissions.size, 0)
    assert.equal(direct.nodes.get("a")!.forms.size, 0)
  }
})

test("最终 P3 durable 序列和 execution 时间边界不丢弃其他作用域的合法等待事件", () => {
  const current = seeded()
  current.snapshot(task("a", "root", { running: true, info: { id: "a", parentID: "root", idle: 50 } }), 0)
  current.event({ ...event("start", "a", 100), seq: 1 })
  current.event(request("permission", "P", 20, true))
  current.event({ kind: "step", id: "step", sessionID: "a", at: 110, seq: 2, assistant: { at: 110, agent: "actual" } })
  current.event(request("form", "F", 40, true))
  current.event(request("permission", "P", 30, false))
  current.event(request("form", "F", 50, false))
  assert.equal(current.rows()[0].status, "运行中")
  assert.equal(current.rows()[0].started, 100)
  assert.equal(current.rows()[0].agent, "actual")
})

test("最终 P3 tool progress 的时间水位按调用作用域，另一个较早调用不被丢弃", () => {
  const current = seeded()
  current.snapshot(task("b"), 0)
  current.event({ kind: "link", id: "newer", sessionID: "root", at: 40, scope: "msg/call-a", link: { ...link("a"), description: "A" } })
  current.event({ kind: "link", id: "older-other", sessionID: "root", at: 30, scope: "msg/call-b", link: { ...link("b"), description: "B" } })
  assert.equal(current.links.has("b"), true)
  current.event({ kind: "link", id: "stale-same", sessionID: "root", at: 20, scope: "msg/call-b", link: { ...link("b"), at: 999, description: "旧进度" } })
  assert.equal(current.links.get("b")!.description, "B")
})

test("最终 P3 请求去重空间有界，淘汰身份的歧义触发补读而非复活或静默丢弃", () => {
  const current = seeded()
  for (let i = 0; i < 10000; i++) {
    current.event(request("permission", String(i), i * 2 + 20, true))
    current.event(request("permission", String(i), i * 2 + 21, false))
  }
  assert.ok(current.nodes.get("a")!.order.settledRequests <= 64)
  current.event(request("permission", "0", 20, true))
  current.event(request("form", "late-but-legitimate", 30, true))
  assert.equal(current.nodes.get("a")!.permissions.size, 0)
  assert.deepEqual(current.takeSyncRequests(), ["a"])
  current.snapshot(task("a", "root", { running: true, forms: ["late-but-legitimate"] }), current.nodes.get("a")!.revision)
  assert.equal(current.rows()[0].status, "待输入")
})

test("最终 P3 控制器对被淘汰身份的合法迟到 asked 进行补读，加载提示后恢复准确等待", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const api = new FakeSource().add(snapshot("root", undefined, { links: [link("a")] }), task("a", "root", { running: true }))
  let watch = false
  const done = deferred<void>()
  const controller = new Controller(api, () => { if (watch && controller.state === "ready") done.resolve() }, () => 10)
  await controller.select("root")
  for (let i = 0; i < 100; i++) {
    api.emit(request("permission", String(i), i * 2 + 20, true))
    api.emit(request("permission", String(i), i * 2 + 21, false))
  }
  api.add(task("a", "root", { running: true, forms: ["late"] }))
  api.emit(request("form", "late", 20, true))
  assert.equal(controller.state, "loading")
  watch = true
  context.mock.timers.tick(150)
  await done.promise
  assert.equal(controller.current!.rows()[0].status, "待输入")
  assert.equal(controller.current!.requiresValidation(), false)
  api.emit(request("form", "late", 30, false))
  assert.equal(controller.current!.rows()[0].status, "运行中")
  controller.dispose()
})

test("最终 P2 metadata 与真实 start/end 同时超过首次旧快照，补读后仍保留真实本轮", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const old = task("a", "root", { info: { id: "a", parentID: "root", idle: 5, outcome: "succeeded" } })
  const api = new FakeSource().add(snapshot("root", undefined, { links: [link("a")] }), old)
  const gate = deferred<Snapshot>()
  const reached = deferred<void>()
  api.gate = async info => { if (info.id === "a") { reached.resolve(); return gate.promise } return api.snapshots.get(info.id)! }
  let watch = false
  const done = deferred<void>()
  const controller = new Controller(api, () => { if (watch) done.resolve() }, () => 10)
  const loading = controller.select("root")
  await reached.promise
  api.emit({ kind: "info", id: "rename", sessionID: "a", at: 20, seq: 2, info: { title: "新任务" } })
  api.emit({ ...event("start", "a", 30), seq: 3 })
  api.emit({ ...end("a", 40), seq: 4 })
  gate.resolve(old)
  await loading
  assert.equal(controller.current!.rows()[0].started, 30)
  assert.equal(controller.current!.rows()[0].ended, 40)
  api.gate = undefined
  api.add(task("a", "root", { info: { id: "a", parentID: "root", idle: 40, outcome: "succeeded" } }))
  watch = true
  context.mock.timers.tick(150)
  await done.promise
  assert.equal(controller.current!.rows()[0].started, 30)
  assert.equal(controller.current!.rows()[0].ended, 40)
  controller.dispose()
})

test("最终 P1 pending link 只能提前接收 delete，其他生命周期缓冲到真实节点出现", () => {
  const current = new Tree("root", 10)
  current.snapshot(snapshot("root"), 0)
  current.associate(link("a"))
  const journal = new EventJournal()
  journal.add(event("start", "a", 20))
  journal.drain(current)
  assert.equal(journal.size, 1)
  current.discover({ id: "a", parentID: "root" })
  journal.drain(current)
  assert.equal(current.rows()[0].started, 20)
  assert.equal(journal.size, 0)
})
