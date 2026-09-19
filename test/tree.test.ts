import { test } from "node:test"
import assert from "node:assert/strict"
import { Tree } from "../src/core/tree.js"
import { duration, lines, truncate } from "../src/core/format.js"
import stringWidth from "string-width"
import { end, event, snapshot, task } from "./helpers.js"
import { event208 } from "../src/v208.js"

function seeded(...ids: string[]) {
  const tree = new Tree("root", 10)
  tree.snapshot(snapshot("root"), 0)
  for (const id of ids) {
    tree.snapshot(task(id, "root", { running: true }), 0)
    tree.associate({ parentID: "root", childID: id, at: 1, key: id })
  }
  return tree
}

test("只显示有内置工具证据的 child，根排除，深层父编号稳定", () => {
  const tree = seeded("a")
  tree.snapshot(task("ordinary"), 0)
  tree.snapshot(task("nested", "ordinary", { running: true }), 0)
  tree.associate({ parentID: "root", childID: "nested", at: 1, key: "wrong" })
  assert.deepEqual(tree.rows(100).map(r => r.id), ["a"])
  tree.associate({ parentID: "ordinary", childID: "nested", at: 2, key: "right" })
  assert.equal(tree.rows(100).find(r => r.id === "nested")?.parent, tree.nodes.get("ordinary")?.number)
  tree.associate({ parentID: "root", childID: "a", at: 2, key: "new", description: "最新摘要" })
  tree.associate({ parentID: "root", childID: "a", at: 1, key: "old", description: "旧摘要" })
  assert.equal(tree.rows(100)[0].summary, "最新摘要")
})

test("启动不恢复历史，运行状态覆盖旧 outcome，缺少起点不估算", () => {
  const tree = seeded()
  tree.snapshot(task("old", "root", { info: { id: "old", parentID: "root", outcome: "succeeded", idle: 5 } }), 0)
  tree.snapshot(task("busy", "root", { info: { id: "busy", parentID: "root", outcome: "failed", idle: 5 }, running: true }), 0)
  for (const id of ["old", "busy"]) tree.associate({ parentID: "root", childID: id, at: 0, key: id })
  assert.deepEqual(tree.rows(100).map(r => [r.id, r.status]), [["busy", "运行中"]])
  assert.equal(duration(tree.rows(100)[0], 100), "—")
  assert.equal(tree.rows(100)[0].agent, "—")
  assert.equal(tree.rows(100)[0].model, "—")
  tree.event(end("old", 5))
  assert.equal(tree.rows(100).length, 1)
})

test("一个 busy period 一轮，steering 不重置，结束隐藏并保留时间，再启动清空旧模型", () => {
  const tree = seeded("a")
  tree.event(event("start", "a", 1000))
  tree.event({ id: "step", sessionID: "a", at: 1100, kind: "step", assistant: { at: 1100, agent: "explore", model: "provider/model" } })
  const steering = event208({ id: "steering", created: 2000, type: "session.inbox.enqueued",
    durable: { aggregateID: "a", seq: 3, version: 1 },
    data: { sessionID: "a", inboxID: "input", item: { type: "user", delivery: "steer", payload: { text: "补充任务" } } } })
  assert.equal(steering, undefined)
  if (steering) tree.event(steering)
  assert.equal(tree.rows(4000)[0].started, 1000)
  assert.equal(tree.rows(4000)[0].model, "model")
  tree.event(end("a", 5000))
  assert.deepEqual(tree.rows(99999), [])
  assert.equal(tree.nodes.get("a")!.round.ended, 5000)
  tree.event(event("start", "a", 6000))
  assert.equal(tree.rows(7000)[0].status, "运行中")
  assert.equal(tree.rows(7000)[0].started, 6000)
  assert.equal(tree.rows(7000)[0].model, "—")
})

test("shutdown 不是终结，恢复不重置原起点", () => {
  const tree = seeded("a")
  tree.event(event("start", "a", 100))
  tree.event(event("shutdown", "a", 200))
  assert.deepEqual(tree.rows(300), [])
  assert.equal(tree.nodes.get("a")!.round.ended, undefined)
  tree.event(event("start", "a", 400))
  assert.equal(tree.rows(500)[0].started, 100)
  tree.event(end("a", 600, "interrupted"))
  assert.deepEqual(tree.rows(1000), [])
  assert.equal(tree.nodes.get("a")!.round.outcome, "interrupted")
})

test("权限、表单、重试等待计入墙钟；终态清除等待", () => {
  const tree = seeded("a")
  tree.event(event("start", "a", 1000))
  tree.event({ id: "retry", kind: "retry", sessionID: "a", at: 1100, until: 5000 })
  assert.equal(tree.rows(2000)[0].status, "重试等待")
  assert.equal(tree.rows(6000)[0].status, "重试等待")
  tree.event({ id: "form", kind: "form", sessionID: "a", at: 1200, requestID: "f", pending: true })
  assert.equal(tree.rows(2000)[0].status, "待输入")
  tree.event({ id: "permission", kind: "permission", sessionID: "a", at: 1300, requestID: "p", pending: true })
  assert.equal(tree.rows(2000)[0].status, "待授权")
  tree.event({ id: "permission-done", kind: "permission", sessionID: "a", at: 2300, requestID: "p", pending: false })
  assert.equal(tree.rows(3000)[0].status, "待输入")
  tree.event(end("a", 4000, "failed"))
  assert.deepEqual(tree.rows(9000), [])
  assert.equal(tree.nodes.get("a")!.round.ended, 4000)
  assert.equal(tree.nodes.get("a")!.permissions.size, 0)
  assert.equal(tree.nodes.get("a")!.forms.size, 0)
})

test("所有终态与未知隐藏；活跃项按时间与 ID 排序，结束父节点保留后代关系", () => {
  const tree = seeded("z", "b", "a", "unknown", "e1", "e2", "e3", "e4")
  tree.snapshot(task("unknown"), 0)
  tree.event(event("start", "z", 20))
  tree.event(event("start", "b", 30))
  tree.event(event("start", "a", 30))
  for (let i = 1; i <= 4; i++) tree.event(end(`e${i}`, 100 + i))
  assert.deepEqual(tree.rows(200).map(r => r.id), ["z", "a", "b"])
  const parentNumber = tree.nodes.get("e1")!.number
  tree.snapshot(task("nested", "e1", { running: true }), 0)
  tree.associate({ parentID: "e1", childID: "nested", at: 200, key: "nested" })
  assert.equal(tree.rows(300).find(r => r.id === "nested")!.parent, parentNumber)
})

test("旧快照不能覆盖事件；新 idle 才能补认结束，重连不重复写历史", () => {
  const tree = seeded("a")
  tree.event(event("start", "a", 100))
  tree.snapshot(task("a", "root", { info: { id: "a", parentID: "root", outcome: "failed", idle: 5 } }), 0)
  assert.equal(tree.rows(200)[0].status, "运行中")
  const rev = tree.nodes.get("a")!.revision
  tree.snapshot(task("a", "root", { info: { id: "a", parentID: "root", outcome: "succeeded", idle: 300 } }), rev)
  assert.deepEqual(tree.rows(400), [])
  tree.snapshot(task("a", "root", { info: { id: "a", parentID: "root", outcome: "succeeded", idle: 300 } }), rev)
  assert.equal(tree.nodes.get("a")!.round.ended, 300)
  assert.equal(tree.nodes.get("a")!.round.started, 100)
  tree.snapshot(task("a", "root", { info: { id: "a", parentID: "root", outcome: "failed", idle: 600 } }), rev)
  assert.deepEqual(tree.rows(700), [])
  assert.equal(tree.nodes.get("a")!.round.outcome, "failed")
  assert.equal(tree.nodes.get("a")!.round.started, undefined)
  assert.equal(tree.nodes.get("a")!.round.ended, 600)
})

test("窄宽度优先时长、中文和 emoji 字素安全截断", () => {
  const samples = ["中文测试", "a👨‍👩‍👧‍👦b", "👩🏽‍💻研发", "e\u0301组合", "🇨🇳旗帜", "a\n\tb"]
  for (const sample of samples) for (let width = 0; width < 20; width++) assert.ok(stringWidth(truncate(sample, width)) <= width)
  assert.equal(truncate("a👨‍👩‍👧‍👦bc", 4), "a👨‍👩‍👧‍👦…")
  const row = seeded("a").rows(100)[0]
  for (let width = 0; width < 40; width++) for (const line of lines({ ...row, started: 1000 }, width, 5000)) assert.ok(stringWidth(line) <= width)
  assert.equal(lines({ ...row, started: 1000 }, 2, 5000)[1], "4s")
})
