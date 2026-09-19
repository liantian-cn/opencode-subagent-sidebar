import { test } from "node:test"
import assert from "node:assert/strict"
import type { OpenCodeEvent, SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageInfo } from "@opencode/client"
import { event208, link208, messages208, source208 } from "../src/v208.js"
import type { Context } from "@opencode/plugin/tui/context"

function tool(id: string, child?: string, description?: string): SessionMessageAssistantTool {
  return { type: "tool", id, name: "subagent", time: { created: 10, ran: 20 }, state: { status: "running", input: { ...(description ? { description } : {}) }, metadata: child ? { sessionID: child } : {} } }
}
function assistant(id: string, at: number, content: SessionMessageAssistantTool[] = []): SessionMessageAssistant {
  return { type: "assistant", id, time: { created: at }, agent: id, model: { providerID: "test", id: `test/${id}` }, content }
}
const durable = { aggregateID: "child", seq: 1, version: 1 as const }

test("版本适配：严格 subagent 名称；metadata 优先，恢复 input 次之，completed 不等于 child 结束", () => {
  const initial = tool("tool", "child", "任务摘要")
  assert.equal(link208("root", initial)?.childID, "child")
  assert.equal(link208("root", { ...initial, name: "another" }), undefined)
  assert.equal(link208("root", tool("tool")), undefined)
  initial.state = { status: "completed", input: { sessionID: "resumed", description: "恢复摘要" }, metadata: {}, content: [{ type: "text", text: "已提交" }] }
  assert.equal(link208("root", initial)?.childID, "resumed")
  assert.equal(link208("root", initial)?.description, "恢复摘要")
  initial.state.metadata = { sessionID: "actual" }
  assert.equal(link208("root", initial)?.childID, "actual")
  assert.equal(event208({ id: "evt", type: "session.tool.success", created: 40, durable: { ...durable, version: 2 }, data: { sessionID: "root", assistantMessageID: "msg", id: "tool", metadata: { sessionID: "child" }, content: [{ type: "text", text: "已提交" }], executed: false } }), undefined)
})

test("最新轮 assistant 优先；没有本轮 assistant 时不误用旧轮模型", () => {
  const messages: SessionMessageInfo[] = [assistant("old", 10), { type: "idle", id: "idle", time: { created: 20 }, outcome: "succeeded" }, assistant("new", 30)]
  const current = messages208({ id: "child", idle: 20 }, messages, true)
  assert.equal(current.assistant?.agent, "new")
  assert.equal(current.assistant?.model, "test/new")
  assert.equal(messages208({ id: "child", idle: 20 }, messages.slice(0, 2), true).assistant, undefined)
  assert.equal(messages208({ id: "child", idle: 20 }, messages.slice(0, 2), false).assistant?.agent, "old")
  const finished: SessionMessageInfo[] = [...messages, { type: "idle", id: "idle2", time: { created: 40 }, outcome: "failed" }]
  assert.equal(messages208({ id: "child", idle: 20 }, finished, false).assistant?.agent, "new")
  assert.equal(messages208({ id: "child", idle: 20 }, finished, false).info.idle, 40)
})

test("一条父消息中多个调用全部保留，关联时间使用工具调用而非父消息", () => {
  const first = tool("one", "a", "旧描述")
  const second = tool("two", "a", "新描述")
  second.time.ran = 30
  const result = messages208({ id: "root" }, [assistant("parent", 1, [first, second])], true)
  assert.deepEqual(result.links.map(link => [link.at, link.description]), [[20, "旧描述"], [30, "新描述"]])
})

test("execution.started 用事件 created；shutdown 非终态，等待事件使用真实 session ID", () => {
  const start: OpenCodeEvent = { type: "session.execution.started", id: "evt1", created: 123, durable, data: { sessionID: "child" } }
  assert.deepEqual(event208(start), { kind: "start", id: "evt1", at: 123, sessionID: "child", seq: 1 })
  assert.equal(event208({ ...start, type: "session.execution.interrupted", data: { sessionID: "child", reason: "shutdown" } })?.kind, "shutdown")
  assert.equal(event208({ ...start, type: "session.execution.interrupted", data: { sessionID: "child", reason: "user" } })?.kind, "end")
})

test("SDK 适配真实 message.list 分页并读取权限/表单；复用宿主监听且可注销", async () => {
  const cursors: Array<string | undefined> = []
  let handler: ((input: { details: OpenCodeEvent }) => void) | undefined
  let stopped = false
  // 只桩本测试使用的公开只读方法，不创建服务或真实 TUI。
  const context = {
    client: {
      message: { list: async (input: { cursor?: string }, options: { signal: AbortSignal }) => {
        assert.ok(options.signal)
        cursors.push(input.cursor)
        return input.cursor
          ? { data: [assistant("latest", 30)], cursor: {} }
          : { data: [assistant("parent", 10, [tool("call", "child", "分页摘要")])], cursor: { next: "page2" } }
      } },
      permission: { list: async () => [{ id: "permission" }] },
      session: { form: { list: async () => [{ id: "form" }] } },
    },
    data: { listen: (value: typeof handler) => { handler = value; return () => { stopped = true; handler = undefined } } },
  } as unknown as Context
  const source = source208(context)
  const events: unknown[] = []
  const stop = source.listen(event => events.push(event))
  const snapshot = await source.snapshot({ id: "root" }, true, new AbortController().signal)
  assert.deepEqual(cursors, [undefined, "page2"])
  assert.equal(snapshot.links[0].childID, "child")
  assert.equal(snapshot.assistant?.agent, "latest")
  assert.deepEqual(snapshot.permissions, ["permission"])
  assert.deepEqual(snapshot.forms, ["form"])
  handler?.({ details: { type: "session.execution.started", id: "evt", created: 50, durable, data: { sessionID: "child" } } })
  assert.equal(events.length, 1)
  stop()
  assert.ok(stopped)
  assert.equal(handler, undefined)
})

test("P1 订阅前遗漏 input.started/called，progress 必须请求父消息补读并从快照还原关联", async () => {
  let handler: ((input: { details: OpenCodeEvent }) => void) | undefined
  const context = {
    client: {
      message: { list: async () => ({ data: [assistant("parent", 10, [tool("call", "child", "晚到关联")])], cursor: {} }) },
      permission: { list: async () => [] },
      session: { form: { list: async () => [] } },
    },
    data: { listen: (value: typeof handler) => { handler = value; return () => { handler = undefined } } },
  } as unknown as Context
  const source = source208(context)
  const events: unknown[] = []
  const stop = source.listen(event => events.push(event))
  handler?.({ details: { type: "session.tool.progress", id: "progress", created: 30,
    data: { sessionID: "root", assistantMessageID: "parent", id: "call", metadata: { sessionID: "child" } } } })
  assert.deepEqual(events, [{ kind: "refresh", sessionID: "root" }])
  const snapshot = await source.snapshot({ id: "root" }, true, new AbortController().signal)
  assert.deepEqual(snapshot.links.map(link => [link.childID, link.description]), [["child", "晚到关联"]])
  stop()
})
