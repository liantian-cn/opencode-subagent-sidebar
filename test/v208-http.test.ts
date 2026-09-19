// 用真实 2.0.8 Promise SDK 验证 HTTP 请求契约；fetch 完全由内存 fixture 接管，不联网或调用插件 setup。
import { test } from "node:test"
import assert from "node:assert/strict"
import { OpenCode, type FormInfo, type PermissionRequest, type SessionInfo, type SessionMessageInfo } from "@opencode/client"
import type { Context } from "@opencode/plugin/tui/context"
import { Controller } from "../src/core/controller.js"
import { source208 } from "../src/v208.js"

const rootID = "ses_fixture_root"
const childID = "ses_fixture_child"
const invalidCursor = { _tag: "InvalidCursorError", message: "Cursor cannot be combined with order" }
const messageCursor = (id: string) => Buffer.from(JSON.stringify({ id, order: "asc", direction: "next" })).toString("base64url")

function session(id: string, parentID?: string): SessionInfo {
  return { id, parentID, title: "契约测试", projectID: "fixture", location: { directory: "/fixture" },
    time: { created: 1, updated: 1 }, cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }
}

function fixture(count: number) {
  const infos = [session(rootID), session(childID, rootID)]
  const histories = new Map(infos.map(info => [info.id, Array.from({ length: count }, (_, index): SessionMessageInfo => ({
    type: "assistant", id: `msg_${info.id}_${index}`, time: { created: index + 2 }, agent: "fixture", model: { providerID: "fixture", id: "fixture-model" },
    // 将关联放在最后一条，101 条时必须真正读到第二页才能展示 child。
    content: info.id === rootID && index === count - 1 ? [{ type: "tool", id: "tool_fixture", name: "subagent", time: { created: index + 2 },
      state: { status: "running", input: { description: "分页关联" }, metadata: { sessionID: childID } } }] : [],
  }))]))
  const requests: Array<{ path: string; query: Record<string, string> }> = []
  // 依据 v2.0.8 packages/server/src/handlers/message.ts:35–61：拒绝 cursor+order，所有非空页都返回 next。
  // https://github.com/anomalyco/opencode/blob/v2.0.8/packages/server/src/handlers/message.ts#L35-L61
  // 其他响应对应 handlers/session.ts:63–100,179–195,633–637 与 handlers/permission.ts:60–66 的 HTTP envelope。
  const client = OpenCode.make({ baseUrl: "http://fixture.invalid", fetch: async (input, options) => {
    const url = new URL(input instanceof Request ? input.url : input)
    assert.equal(url.origin, "http://fixture.invalid")
    assert.equal(options?.method, "GET")
    assert.ok(options.signal instanceof AbortSignal)
    const query = url.searchParams
    requests.push({ path: url.pathname, query: Object.fromEntries(query) })
    if (url.pathname === "/api/session/active") return Response.json({ data: { [childID]: { type: "running" } } })
    if (url.pathname === "/api/session") {
      // session.list 与 message.list 不同，游标携带查询条件，允许外层保留 order。
      const data = query.has("cursor") ? [] : infos.filter(info => info.parentID === query.get("parentID"))
      return Response.json({ data, cursor: data.length ? { next: "fixture-children-next" } : {} })
    }
    const match = /^\/api\/session\/([^/]+)(?:\/(message|permission|form))?$/.exec(url.pathname)
    assert.ok(match, `未预期的 fixture 路径：${url.pathname}`)
    const [, id, resource] = match
    const info = infos.find(info => info.id === id)
    assert.ok(info)
    if (!resource) return Response.json({ data: info })
    if (resource === "permission") {
      const data: PermissionRequest[] = id === childID ? [{ id: "per_fixture", sessionID: id, action: "fixture", resources: [] }] : []
      return Response.json({ data })
    }
    if (resource === "form") {
      const data: FormInfo[] = id === childID ? [{ id: "form_fixture", sessionID: id, title: "测试表单", fields: [{ key: "answer", type: "string" }] }] : []
      return Response.json({ data })
    }
    if (query.has("cursor") && query.has("order")) return Response.json(invalidCursor, { status: 400 })
    const history = histories.get(id)!
    const cursor = query.get("cursor")
    const decoded = cursor ? JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { id: string; order: string; direction: string } : undefined
    assert.equal(decoded?.order ?? query.get("order"), "asc")
    assert.equal(decoded?.direction ?? "next", "next")
    const anchor = decoded ? history.findIndex(message => message.id === decoded.id) : -1
    if (decoded) assert.ok(anchor >= 0)
    const data = history.slice(anchor + 1, anchor + 1 + Number(query.get("limit")))
    const last = data.at(-1)
    return Response.json({ data, cursor: last ? { next: messageCursor(last.id) } : {} })
  } })
  const context = { client, data: { listen: () => () => {} } } as unknown as Context
  return { client, context, requests, source: source208(context) }
}

function assertMessageRequests(requests: ReturnType<typeof fixture>["requests"], id: string, count: number) {
  const actual = requests.filter(request => request.path === `/api/session/${id}/message`).map(request => request.query)
  const expected: Record<string, string>[] = [{ limit: "100", order: "asc" }]
  for (let offset = 100; offset < count + 100 && count > 0; offset += 100) {
    expected.push({ limit: "100", cursor: messageCursor(`msg_${id}_${Math.min(offset, count) - 1}`) })
  }
  // 精确比较 query，确保游标页不是 order="undefined"，且 next、固定 limit、额外空页都正确。
  assert.deepEqual(actual, expected)
}

for (const count of [0, 1, 101]) {
  test(`真实 SDK / 内存 HTTP：${count} 条消息完整分页，权限和表单正确拆包`, async () => {
    const { source, requests } = fixture(count)
    const signal = new AbortController().signal
    const info = await source.get(childID, signal)
    assert.equal(info.id, childID)
    assert.equal(info.parentID, rootID)
    const active = await source.active(signal)
    assert.deepEqual([...active], [childID])
    const snapshot = await source.snapshot(info, active.has(info.id), signal)
    assert.equal(snapshot.running, true)
    assert.equal(snapshot.assistant?.at, count ? count + 1 : undefined)
    assert.deepEqual(snapshot.links, [])
    assert.deepEqual(snapshot.permissions, ["per_fixture"])
    assert.deepEqual(snapshot.forms, ["form_fixture"])
    assertMessageRequests(requests, childID, count)
  })

  test(`真实 SDK / 内存 HTTP：根和 child 各 ${count} 条消息，整树扫描最终 ready`, async () => {
    const { source, requests } = fixture(count)
    const controller = new Controller(source, () => {})
    try {
      // 从 child 进入，额外覆盖 root 链上的两次 session.get。
      await controller.select(childID)
      assert.equal(controller.state, "ready")
      const tree = controller.current!
      assert.equal(tree.rootID, rootID)
      assert.equal(tree.invalidAll, false)
      assert.equal(tree.invalidScopes.size, 0)
      assert.deepEqual([...tree.nodes.keys()], [rootID, childID])
      for (const id of [rootID, childID]) {
        assertMessageRequests(requests, id, count)
        assert.equal(tree.nodes.get(id)!.hydrated, true)
        for (const resource of ["", "/permission", "/form"]) {
          assert.equal(requests.filter(request => request.path === `/api/session/${id}${resource}`).length, 1)
        }
      }
      assert.equal(tree.nodes.get(childID)!.round.phase, "running")
      assert.deepEqual([...tree.nodes.get(childID)!.permissions], ["per_fixture"])
      assert.deepEqual([...tree.nodes.get(childID)!.forms], ["form_fixture"])
      assert.deepEqual(tree.rows().map(row => row.id), count ? [childID] : [])
      assert.deepEqual(requests.filter(request => request.path === "/api/session").map(request => request.query), [
        { parentID: rootID, limit: "100", order: "asc" },
        { parentID: rootID, cursor: "fixture-children-next", limit: "100", order: "asc" },
        { parentID: childID, limit: "100", order: "asc" },
      ])
    } finally { controller.dispose() }
  })
}

test("HTTP 契约正对照：旧 cursor+order 请求被拒绝，并重现整树 stale", async () => {
  const { client, context } = fixture(1)
  const options = { signal: new AbortController().signal }
  const first = await client.message.list({ sessionID: rootID, order: "asc", limit: 100 }, options)
  assert.ok(first.cursor.next)
  await assert.rejects(client.message.list({ sessionID: rootID, cursor: first.cursor.next, order: "asc", limit: 100 }, options),
    error => { assert.deepEqual(error, invalidCursor); return true })
  // 只在此正对照重放旧参数，仍经过实际 SDK 序列化及同一个 HTTP fixture。
  const oldClient = { ...client, message: { ...client.message,
    list: ((input, options) => client.message.list({ ...input, order: "asc" }, options)) as typeof client.message.list } }
  const controller = new Controller(source208({ ...context, client: oldClient }), () => {})
  try {
    await controller.select(childID)
    assert.equal(controller.state, "stale")
    assert.equal(controller.current!.invalidAll, true)
    assert.deepEqual(controller.current!.rows(), [])
  } finally { controller.dispose() }
})
