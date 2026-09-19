import { test } from "node:test"
import assert from "node:assert/strict"
import { activeSubagents, type SidebarSession } from "../src/core/sidebar.js"

const session = (id: string, parentID?: string, extra: Partial<SidebarSession> = {}): SidebarSession => ({
  id, parentID, title: id, time: { created: 0, updated: 0 }, ...extra,
})

test("仅当前会话的直接活动子会话，保持官方缓存顺序", () => {
  const sessions = [session("root"), session("z", "root"), session("a", "root"),
    session("nested", "z"), session("other", "unrelated"), session("idle", "root")]
  const queried: string[] = []
  const rows = activeSubagents(sessions, "root", id => {
    queried.push(id)
    return id === "idle" ? "idle" : "running"
  })
  assert.deepEqual(rows.map(row => row.id), ["z", "a"])
  assert.deepEqual(queried, ["z", "a", "idle"], "不读取祖先、孙级或其他会话状态")
})

test("以插槽当前 ID 为准，不要求根或当前会话元数据已缓存", () => {
  const sessions = [session("a", "root"), session("b", "a"), session("sibling", "root")]
  assert.deepEqual(activeSubagents(sessions, "a", () => "running").map(row => row.id), ["b"])
  assert.deepEqual(activeSubagents(sessions, "missing", () => "running"), [])
  assert.deepEqual(activeSubagents([], "root", () => { throw new Error("无候选时不读取状态") }), [])
})

test("跟随宿主 running，不依据旧 outcome 或 fork 推断来源与完成状态", () => {
  const fork = { ...session("fork", "root"), fork: { sessionID: "root" }, outcome: "succeeded" }
  assert.deepEqual(activeSubagents([fork], "root", () => "running").map(row => row.id), ["fork"])
  assert.deepEqual(activeSubagents([fork], "root", () => "idle"), [])
  assert.deepEqual(activeSubagents([fork], "root", () => "running").map(row => row.id), ["fork"])
})

test("代理名与标题遵循官方 picker 的旧式标记兼容规则", () => {
  const rows = activeSubagents([
    session("current", "root", { title: "核查接口 @explore subagent", agent: "general" }),
    session("legacy", "root", { title: "@explore subagent 检查类型" }),
    session("plain", "root", { title: "任务摘要" }),
    session("marker", "root", { title: "@general subagent" }),
  ], "root", () => "running")
  assert.deepEqual(rows, [
    { id: "current", agent: "General", title: "核查接口" },
    { id: "legacy", agent: "Explore", title: "检查类型" },
    { id: "plain", agent: "Subagent", title: "任务摘要" },
    { id: "marker", agent: "General", title: "@general subagent" },
  ])
})

test("缺少标题使用官方时间戳回退，不生成本轮计时", () => {
  assert.deepEqual(activeSubagents([session("a", "root", { title: undefined })], "root", () => "running"), [
    { id: "a", agent: "Subagent", title: "Child session - 1970-01-01T00:00:00.000Z" },
  ])
})

test("派生不修改宿主数据，不保存上次会话或状态", () => {
  const child = Object.freeze(session("a", "root", { agent: "explore" }))
  const sessions = Object.freeze([child])
  const first = activeSubagents(sessions, "root", () => "running")
  first[0].title = "不应回写"
  assert.equal(child.title, "a")
  assert.equal(activeSubagents(sessions, "root", () => "running")[0].title, "a")
  assert.deepEqual(activeSubagents(sessions, "root", () => "idle"), [])
  assert.deepEqual(activeSubagents(sessions, "other", () => "running"), [])
})

test("大量历史子会话只输出宿主标记活动的项，不构造递归树", () => {
  const sessions = Array.from({ length: 5000 }, (_, i) => session(String(i), "root"))
  assert.deepEqual(activeSubagents(sessions, "root", id => id === "4999" ? "running" : "idle").map(row => row.id), ["4999"])
})
