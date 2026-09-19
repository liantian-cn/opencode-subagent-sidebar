import { test } from "node:test"
import assert from "node:assert/strict"
import { Controller } from "../src/core/controller.js"
import { mapLimit, pages, readTree, root } from "../src/core/reader.js"
import { FakeSource, deferred, end, event, snapshot, task } from "./helpers.js"
import type { Snapshot } from "../src/core/types.js"

const signal = () => new AbortController().signal
function fixture() {
  const source = new FakeSource().add(snapshot("root", undefined, { links: [{ parentID: "root", childID: "a", at: 1, key: "tool" }] }), task("a", "root", { running: true }))
  return source
}

test("递归分页、逐级祖先补齐，不能依赖 family 缓存", async () => {
  const source = fixture().add(task("b"), task("deep", "a"), task("deeper", "deep"))
  source.childPages.set("root", [["a"], ["b"]])
  assert.equal((await root(source, "deeper", signal())).id, "root")
  const result = await readTree(source, source.snapshots.get("root")!.info, signal())
  assert.deepEqual(result.map(s => s.info.id).sort(), ["a", "b", "deep", "deeper", "root"])
  assert.ok(source.cursors.includes("root:1"))
  await assert.rejects(pages(async () => ({ data: [], next: "same" }), signal()), /游标重复/)
})

test("先订阅后快照；加载中先 start/end，最终快照已经结束仍计入本次历史", async () => {
  const source = fixture()
  const gate = deferred<Snapshot>()
  const reached = deferred<void>()
  source.gate = async info => {
    if (info.id !== "a") return source.snapshots.get(info.id)!
    reached.resolve()
    return gate.promise
  }
  const controller = new Controller(source, () => {}, () => 10)
  const loading = controller.select("root")
  await reached.promise
  source.emit(event("start", "a", 20))
  source.emit(end("a", 30))
  gate.resolve(task("a", "root", { info: { id: "a", parentID: "root", outcome: "succeeded", idle: 30 } }))
  await loading
  assert.equal(controller.state, "ready")
  assert.equal(controller.current!.rows(50)[0].status, "成功")
  assert.equal(controller.current!.rows(50)[0].started, 20)
  controller.dispose()
})

test("首次快照期间只观察到结束也保留；重启新 controller 不恢复", async () => {
  const source = fixture()
  const gate = deferred<Snapshot>()
  const reached = deferred<void>()
  source.gate = async info => {
    if (info.id !== "a") return source.snapshots.get(info.id)!
    reached.resolve()
    return gate.promise
  }
  const controller = new Controller(source, () => {}, () => 10)
  const loading = controller.select("root")
  await reached.promise
  source.emit(end("a", 30))
  const done = task("a", "root", { info: { id: "a", parentID: "root", outcome: "succeeded", idle: 30 } })
  gate.resolve(done)
  await loading
  assert.equal(controller.current!.rows(50).length, 1)
  assert.equal(controller.current!.rows(50)[0].started, undefined)
  controller.dispose()
  source.gate = undefined
  source.add(done)
  const restarted = new Controller(source, () => {}, () => 100)
  await restarted.select("root")
  assert.deepEqual(restarted.current!.rows(100), [])
  restarted.dispose()
})

test("跨 child 保持同树编号，跨 root 不串数据，离开后仍监听终结", async () => {
  const source = fixture().add(snapshot("other"))
  const controller = new Controller(source, () => {}, () => 10)
  await controller.select("root")
  const original = controller.current!
  const number = original.rows(50)[0].number
  await controller.select("a")
  assert.equal(controller.current, original)
  assert.equal(controller.current!.rows(50)[0].number, number)
  await controller.select("other")
  assert.equal(controller.current!.rootID, "other")
  source.emit(end("a", 60))
  assert.equal(original.rows(70)[0].status, "成功")
  source.add(task("a", "root", { info: { id: "a", parentID: "root", outcome: "succeeded", idle: 60 } }))
  await controller.select("a")
  assert.equal(controller.current, original)
  assert.equal(controller.current!.rows(70)[0].number, number)
  controller.dispose()
})

test("快速切换/卸载 abort 请求，晚到响应无写回，订阅仅清理一次", async () => {
  const source = fixture().add(snapshot("other"))
  const gate = deferred<Snapshot>()
  const reached = deferred<void>()
  source.gate = async info => {
    if (info.id !== "a") return source.snapshots.get(info.id)!
    reached.resolve()
    return gate.promise
  }
  let changes = 0
  const controller = new Controller(source, () => { changes++ }, () => 10)
  const loading = controller.select("root")
  await reached.promise
  await controller.select("other")
  assert.ok(source.requests.some(request => request.id === "a" && request.signal.aborted))
  gate.resolve(source.snapshots.get("a")!)
  await loading
  assert.equal(controller.current!.rootID, "other")
  controller.dispose()
  controller.dispose()
  const before = changes
  source.emit(end("a", 50))
  assert.equal(changes, before)
  assert.equal(source.stops, 1)
  assert.equal(controller.trees.size, 0)
  const requestCount = source.requests.length
  await controller.refresh()
  assert.equal(source.requests.length, requestCount)
})

test("加载失败与未加载不是空态；刷新失败保留数据并标记过期", async () => {
  const source = fixture()
  const controller = new Controller(source, () => {}, () => 10)
  await controller.select("missing")
  assert.equal(controller.state, "error")
  await controller.select("root")
  source.gate = async () => { throw new Error("测试网络故障") }
  await controller.refresh()
  assert.equal(controller.state, "stale")
  assert.equal(controller.current!.rows(20).length, 1)
  controller.dispose()
})

test("重新校准期间的 end 覆盖旧 running 快照；重连不重置本轮起点", async () => {
  const source = fixture()
  const controller = new Controller(source, () => {}, () => 10)
  await controller.select("root")
  source.emit(event("start", "a", 20))
  const gate = deferred<Snapshot>()
  const reached = deferred<void>()
  source.gate = async info => {
    if (info.id !== "a") return source.snapshots.get(info.id)!
    reached.resolve()
    return gate.promise
  }
  const loading = controller.refresh()
  await reached.promise
  source.emit(end("a", 40))
  gate.resolve(task("a", "root", { running: true }))
  await loading
  assert.equal(controller.current!.rows(50)[0].status, "成功")
  assert.equal(controller.current!.rows(50)[0].started, 20)
  assert.equal(controller.current!.rows(50)[0].ended, 40)
  controller.dispose()
})

test("事件驱动刷新按会话合并；卸载清理待执行定时器", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const source = fixture()
  const controller = new Controller(source, () => {}, () => 10)
  await controller.select("root")
  const before = source.requests.length
  for (let i = 0; i < 5; i++) source.emit({ kind: "refresh", sessionID: "a" })
  controller.dispose()
  context.mock.timers.tick(1000)
  await Promise.resolve()
  assert.equal(source.requests.length, before)
})

test("分页读取并发上限为四，abort 不再请求下一页", async () => {
  let current = 0
  let maximum = 0
  await mapLimit(Array.from({ length: 30 }, (_, i) => i), 4, async value => {
    current++
    maximum = Math.max(maximum, current)
    await Promise.resolve()
    current--
    return value
  })
  assert.equal(maximum, 4)
  let calls = 0
  const abort = new AbortController()
  await assert.rejects(pages(async () => {
    calls++
    abort.abort()
    return { data: [], next: "next" }
  }, abort.signal))
  assert.equal(calls, 1)
})

test("首次读取被重连替换时保留已观察到的起点和结束事件", async () => {
  const source = fixture()
  const gate = deferred<Snapshot>()
  const reached = deferred<void>()
  let first = true
  source.gate = async info => {
    if (info.id !== "a" || !first) return source.snapshots.get(info.id)!
    first = false
    reached.resolve()
    return gate.promise
  }
  const controller = new Controller(source, () => {}, () => 10)
  const loading = controller.select("root")
  await reached.promise
  source.emit(event("start", "a", 20))
  source.emit(end("a", 40))
  source.add(task("a", "root", { info: { id: "a", parentID: "root", idle: 40, outcome: "succeeded" } }))
  await controller.refresh()
  gate.resolve(source.snapshots.get("a")!)
  await loading
  assert.equal(controller.current!.rows(50)[0].started, 20)
  assert.equal(controller.current!.rows(50)[0].ended, 40)
  controller.dispose()
})
