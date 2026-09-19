import { test } from "node:test"
import assert from "node:assert/strict"
import { Tree } from "../src/core/tree.js"
import { Controller } from "../src/core/controller.js"
import { EventJournal } from "../src/core/journal.js"
import { deferred, end, event, FakeSource, snapshot, task } from "./helpers.js"
import type { Snapshot } from "../src/core/types.js"

const link = (childID: string, parentID = "root") => ({ parentID, childID, at: 10, key: childID })
function tree() {
  const tree = new Tree("root", 10)
  tree.snapshot(snapshot("root"), 0)
  tree.snapshot(task("a"), 0)
  tree.associate(link("a"))
  tree.initialized = true
  return tree
}
function source() {
  return new FakeSource().add(snapshot("root", undefined, { links: [link("a")] }), task("a", "root", { running: true }))
}

test("P1 枚举结束后创建 child，父消息快照是唯一关联证据，首次加载立即显示", async () => {
  const api = new FakeSource().add(snapshot("root"))
  const reached = deferred<void>()
  const gate = deferred<Snapshot>()
  api.gate = async info => {
    if (info.id !== "root") return api.snapshots.get(info.id)!
    reached.resolve()
    return gate.promise
  }
  const controller = new Controller(api, () => {}, () => 10)
  const loading = controller.select("root")
  await reached.promise
  api.add(task("a", "root", { running: true }))
  api.emit({ kind: "created", id: "create-a", at: 20, sessionID: "a", info: { id: "a", parentID: "root" } })
  api.emit(event("start", "a", 21))
  // 模拟订阅前已 input.started/called、缓存缺失的 progress 适配结果。
  api.emit({ kind: "refresh", sessionID: "root" })
  gate.resolve(snapshot("root", undefined, { links: [link("a")] }))
  await loading
  assert.deepEqual(controller.current!.rows().map(row => [row.id, row.status, row.started]), [["a", "运行中", 21]])
  controller.dispose()
})

test("P1 父未返回前收到 refresh，提交后保留补读；漏枚举 child 的子树继续补齐", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const api = new FakeSource().add(snapshot("root"))
  const ancestor = deferred<void>()
  const reached = deferred<void>()
  const get = api.get.bind(api)
  let first = true
  api.get = async (id, signal) => {
    if (first) { first = false; reached.resolve(); await ancestor.promise }
    return get(id, signal)
  }
  let finishEnabled = false
  const finished = deferred<void>()
  const controller = new Controller(api, () => { if (finishEnabled && controller.state === "ready") finished.resolve() }, () => 10)
  const loading = controller.select("root")
  await reached.promise
  api.emit({ kind: "refresh", sessionID: "root" })
  ancestor.resolve()
  await loading
  api.add(snapshot("root", undefined, { links: [link("a")] }), task("a", "root", { running: true, links: [link("deep", "a")] }), task("deep", "a", { running: true }))
  finishEnabled = true
  context.mock.timers.tick(150)
  await finished.promise
  assert.deepEqual(controller.current!.rows().map(row => row.id), ["a", "deep"])
  controller.dispose()
})

test("P1 pending link 在 child/祖先出现后激活，不依赖额外工具事件", () => {
  const current = new Tree("root", 10)
  current.snapshot(snapshot("root"), 0)
  current.associate(link("a"))
  assert.equal(current.rows().length, 0)
  current.event({ kind: "created", id: "create", sessionID: "a", at: 20, info: { id: "a", parentID: "root" } })
  assert.equal(current.rows().length, 0)
  current.event(event("start", "a", 21))
  assert.equal(current.rows()[0].id, "a")
})

test("P2 漏 end 后 distinct start 必须新建轮次；重复事件不重置", () => {
  const current = tree()
  const first = { ...event("start", "a", 100), seq: 1 }
  current.event(first)
  current.event({ kind: "step", id: "step", sessionID: "a", at: 110, seq: 2, assistant: { at: 110, agent: "old", model: "old" } })
  current.event({ ...event("start", "a", 300), seq: 4 })
  assert.equal(current.rows()[0].started, 300)
  assert.equal(current.rows()[0].agent, "—")
  current.event({ kind: "step", id: "step-new", sessionID: "a", at: 310, seq: 5, assistant: { at: 310, agent: "new" } })
  current.event({ ...event("start", "a", 300), seq: 4 })
  assert.equal(current.rows()[0].agent, "new")
  current.event(first)
  assert.equal(current.rows()[0].started, 300)
})

test("P2 漏 end/start 但 running 快照 idle 推进，旧起点和 assistant 清空", () => {
  const current = tree()
  current.event(event("start", "a", 100))
  current.event({ kind: "step", id: "step", sessionID: "a", at: 110, assistant: { at: 110, agent: "old", model: "old" } })
  current.snapshot(task("a", "root", { running: true, info: { id: "a", parentID: "root", idle: 200, outcome: "succeeded", agent: "selected" } }), current.nodes.get("a")!.revision)
  assert.equal(current.rows()[0].started, undefined)
  assert.equal(current.rows()[0].agent, "selected")
  assert.equal(current.rows()[0].status, "运行中")
  current.event(event("start", "a", 100))
  assert.equal(current.rows()[0].started, undefined)
})

test("P2 shutdown 仅在没有新 idle 证据时保留原轮次", () => {
  const current = tree()
  current.event(event("start", "a", 100))
  current.event(event("shutdown", "a", 150))
  current.snapshot(task("a", "root", { running: true }), current.nodes.get("a")!.revision)
  current.event(event("start", "a", 170))
  assert.equal(current.rows()[0].started, 100)
  current.event(event("shutdown", "a", 180))
  current.snapshot(task("a", "root", { running: true, info: { id: "a", parentID: "root", idle: 200, outcome: "succeeded" } }), current.nodes.get("a")!.revision)
  current.event(event("start", "a", 300))
  assert.equal(current.rows()[0].started, 300)
})

test("P3 已访问空树刷新发现新结束 child，只保留内部轮次", async () => {
  const api = new FakeSource().add(snapshot("root"))
  const controller = new Controller(api, () => {}, () => 10)
  await controller.select("root")
  api.add(snapshot("root", undefined, { links: [link("a")] }), task("a", "root", { info: { id: "a", parentID: "root", idle: 30, outcome: "succeeded" } }))
  await controller.refresh()
  assert.deepEqual(controller.current!.rows(), [])
  assert.equal(controller.current!.nodes.get("a")!.round.outcome, "succeeded")
  assert.equal(controller.current!.nodes.get("a")!.round.ended, 30)
  controller.dispose()
  const initial = new Controller(api, () => {}, () => 10)
  await initial.select("root")
  assert.deepEqual(initial.current!.rows(), [])
  initial.dispose()
})

test("P4 全量刷新期间 deleted，旧 snapshot 和旧父 link 均不能复活节点", async () => {
  const api = source()
  const controller = new Controller(api, () => {}, () => 10)
  await controller.select("root")
  const reached = deferred<void>()
  const gate = deferred<Snapshot>()
  api.gate = async info => {
    if (info.id !== "a") return api.snapshots.get(info.id)!
    reached.resolve()
    return gate.promise
  }
  const loading = controller.refresh()
  await reached.promise
  api.emit({ ...event("start", "a", 30), kind: "deleted" })
  gate.resolve(api.snapshots.get("a")!)
  await loading
  assert.equal(controller.current!.nodes.has("a"), false)
  assert.equal(controller.current!.links.has("a"), false)
  assert.equal(controller.current!.rows().length, 0)
  controller.dispose()
})

test("P4 dirty 子树读取期间删除祖先，后代不以游离节点重新展示", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const api = source().add(task("a", "root", { running: true, links: [link("deep", "a")] }), task("deep", "a", { running: true }))
  let finishEnabled = false
  const finished = deferred<void>()
  const controller = new Controller(api, () => { if (finishEnabled) finished.resolve() }, () => 10)
  await controller.select("root")
  const reached = deferred<void>()
  const gate = deferred<Snapshot>()
  api.gate = async info => {
    if (info.id !== "a") return api.snapshots.get(info.id)!
    reached.resolve()
    return gate.promise
  }
  api.emit({ kind: "refresh", sessionID: "a" })
  context.mock.timers.tick(150)
  await reached.promise
  api.emit({ ...event("start", "a", 30), kind: "deleted" })
  finishEnabled = true
  gate.resolve(api.snapshots.get("a")!)
  await finished.promise
  assert.equal(controller.current!.nodes.has("a"), false)
  assert.equal(controller.current!.nodes.has("deep"), false)
  assert.deepEqual(controller.current!.rows(), [])
  controller.current!.snapshot(task("later", "a"), 0)
  controller.current!.associate(link("later", "a"))
  assert.equal(controller.current!.nodes.has("later"), false)
  controller.dispose()
})

test("P5 十万轮仅保存序列水位，旧 start/end 重放和重复终态不改新轮", () => {
  const current = tree()
  for (let i = 1; i <= 100_000; i++) {
    current.event({ ...event("start", "a", i * 10 + 10), seq: i * 2 })
    current.event({ ...end("a", i * 10 + 11), seq: i * 2 + 1 })
  }
  assert.ok(current.nodes.get("a")!.order.retainedIDs <= 64)
  assert.deepEqual(current.rows(), [])
  const last = structuredClone(current.nodes.get("a")!.round)
  current.event({ ...event("start", "a", 20), seq: 2 })
  current.event({ ...end("a", 21), seq: 3 })
  current.event({ ...end("a", 1_000_011), seq: 200_001 })
  assert.deepEqual(current.nodes.get("a")!.round, last)
  assert.deepEqual(current.rows(), [])
  current.event({ ...event("start", "a", 1_000_020), seq: 200_002 })
  current.event({ ...end("a", 1_000_011), seq: 200_001 })
  assert.equal(current.rows()[0].status, "运行中")
  assert.equal(current.rows()[0].started, 1_000_020)
})

test("P5 缓冲未知会话的十万轮被压缩为最新轮；回放幂等并保留原始起点", () => {
  const journal = new EventJournal()
  journal.add({ kind: "created", id: "create-a", sessionID: "a", at: 11, seq: 1, info: { id: "a", parentID: "root" } })
  for (let i = 1; i <= 100_000; i++) {
    assert.ok(journal.add({ ...event("start", "a", i * 10 + 10), seq: i * 2 }))
    assert.ok(journal.add({ ...end("a", i * 10 + 11), seq: i * 2 + 1 }))
  }
  assert.ok(journal.size <= 3)
  const current = new Tree("root", 10)
  current.snapshot(snapshot("root"), 0)
  current.associate(link("a"))
  journal.drain(current)
  assert.deepEqual(current.rows(), [])
  assert.equal(current.nodes.get("a")!.round.started, 1_000_010)
  assert.equal(current.nodes.get("a")!.round.ended, 1_000_011)
  assert.equal(journal.size, 0)
  journal.drain(current)
  assert.equal(current.nodes.get("a")!.round.started, 1_000_010)
})

test("P5 durable 同毫秒 distinct start 按 seq 分轮，fallback 旧事件不破坏当前轮", () => {
  const current = tree()
  current.event({ ...event("start", "a", 20), seq: 1 })
  current.event({ kind: "step", id: "step", sessionID: "a", at: 20, seq: 2, assistant: { at: 20, agent: "old" } })
  current.event({ ...event("start", "a", 20), id: "next-start", seq: 3 })
  assert.equal(current.rows()[0].agent, "—")
  const fallback = tree()
  for (let i = 1; i < 1000; i++) {
    fallback.event(event("start", "a", i * 10 + 20))
    fallback.event(end("a", i * 10 + 21))
  }
  const latest = structuredClone(fallback.nodes.get("a")!.round)
  fallback.event(event("start", "a", 30))
  fallback.event(end("a", 31))
  assert.deepEqual(fallback.nodes.get("a")!.round, latest)
  assert.deepEqual(fallback.rows(), [])
  assert.ok(fallback.nodes.get("a")!.order.retainedIDs <= 64)
})

test("P5 终态隐藏不因重放复活，同 schema 热重载保留序列水位和编号", async () => {
  const retained = new Map<string, Tree>()
  const api = source()
  const first = new Controller(api, () => {}, () => 10, retained)
  await first.select("root")
  api.emit({ ...event("start", "a", 20), seq: 10 })
  api.emit({ ...end("a", 30), seq: 11 })
  first.dispose()
  api.add(task("a", "root", { info: { id: "a", parentID: "root", idle: 30, outcome: "succeeded" } }))
  const next = new Controller(api, () => {}, () => 10, retained)
  await next.select("root")
  api.emit({ ...event("start", "a", 20), seq: 10 })
  assert.deepEqual(next.current!.rows(), [])
  assert.equal(next.current!.nodes.get("a")!.round.outcome, "succeeded")
  for (let i = 0; i < 3; i++) {
    const id = `new${i}`
    next.current!.snapshot(task(id), 0)
    next.current!.associate(link(id))
    next.current!.event({ ...end(id, 40 + i), seq: 1 })
  }
  assert.equal(next.current!.rows().some(row => row.id === "a"), false)
  api.emit({ ...end("a", 30), seq: 11 })
  assert.equal(next.current!.rows().some(row => row.id === "a"), false)
  const number = next.current!.nodes.get("a")!.number
  api.emit({ ...event("start", "a", 50), seq: 12 })
  assert.equal(next.current!.rows()[0].number, number)
  assert.equal(next.current!.rows()[0].started, 50)
  next.dispose()
})

test("P5 缓冲大量未归属请求有硬上限，超限明确中止同步而不是静默逐出", async () => {
  const api = new FakeSource().add(snapshot("root"))
  const gate = deferred<void>()
  const reached = deferred<void>()
  const get = api.get.bind(api)
  api.get = async (id, signal) => { reached.resolve(); await gate.promise; return get(id, signal) }
  const controller = new Controller(api, () => {}, () => 10)
  const loading = controller.select("root")
  await reached.promise
  for (let i = 0; i <= EventJournal.limit; i++) api.emit({ kind: "permission", id: `p${i}`, at: 20 + i, sessionID: "unknown", requestID: String(i), pending: true })
  assert.equal(controller.state, "error")
  gate.resolve()
  await loading
  assert.equal(controller.state, "error")
  assert.equal(controller.current, undefined)
  controller.dispose()
})
