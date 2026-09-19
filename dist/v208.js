// 自动生成：npm run build；请修改 src 中的源码。
import { pages } from "./core/reader.js";
import { MissingSession } from "./core/types.js";

// 2.0.8 Promise 客户端直接抛出解码后的协议错误；不把裸 HTTP 404 当会话删除。
export function sessionNotFound208(error, sessionID) {
  return typeof error === "object" && error !== null && "_tag" in error && error._tag === "SessionNotFoundError" && "sessionID" in error && error.sessionID === sessionID && "message" in error && typeof error.message === "string";
}
export function info208(info) {
  return {
    id: info.id,
    parentID: info.parentID,
    title: info.title,
    agent: info.agent,
    model: info.model?.id,
    outcome: info.outcome,
    idle: info.time.idle
  };
}
const text = value => typeof value === "string" && value.length > 0 ? value : undefined;
// 仅此处依赖 2.0.8 内置 subagent 的 metadata/input.sessionID 约定。
export function link208(parentID, tool) {
  if (tool.name !== "subagent" || tool.state.status === "streaming") return;
  const childID = text(tool.state.metadata?.sessionID) ?? text(tool.state.input.sessionID);
  if (!childID) return;
  return {
    parentID,
    childID,
    description: text(tool.state.input.description),
    at: tool.time.ran ?? tool.time.created,
    key: tool.id
  };
}
export function messages208(info, messages, running) {
  const sorted = [...messages].sort((a, b) => a.time.created - b.time.created || a.id.localeCompare(b.id));
  const idles = sorted.filter(message => message.type === "idle");
  const lastIdle = idles.at(-1);
  const boundary = running ? Math.max(lastIdle?.time.created ?? -Infinity, info.idle ?? -Infinity) : idles.at(-2)?.time.created ?? -Infinity;
  const assistant = sorted.findLast(message => message.type === "assistant" && message.time.created > boundary && (running || !lastIdle || message.time.created <= lastIdle.time.created));
  const links = sorted.flatMap(message => message.type === "assistant" ? message.content.flatMap(part => {
    if (part.type !== "tool") return [];
    const link = link208(info.id, part);
    return link ? [link] : [];
  }) : []);
  return {
    info: lastIdle && lastIdle.time.created > (info.idle ?? -Infinity) ? {
      ...info,
      idle: lastIdle.time.created,
      outcome: lastIdle.outcome
    } : info,
    assistant: assistant?.type === "assistant" ? {
      at: assistant.time.created,
      agent: assistant.agent,
      model: assistant.model?.id,
      retryAt: assistant.retry?.at
    } : undefined,
    links
  };
}
export function event208(event) {
  if (!("created" in event)) return;
  if (!("sessionID" in event.data)) {
    if (event.type === "form.created") return {
      id: event.id,
      at: event.created,
      sessionID: event.data.form.sessionID,
      kind: "form",
      requestID: event.data.form.id,
      pending: true
    };
    return;
  }
  const sessionID = event.data.sessionID;
  const base = {
    id: event.id,
    at: event.created,
    sessionID,
    ...("durable" in event && event.durable.aggregateID === sessionID ? {
      seq: event.durable.seq
    } : {})
  };
  switch (event.type) {
    case "session.execution.started":
      return {
        ...base,
        kind: "start"
      };
    case "session.execution.succeeded":
      return {
        ...base,
        kind: "end",
        outcome: "succeeded"
      };
    case "session.execution.failed":
      return {
        ...base,
        kind: "end",
        outcome: "failed"
      };
    case "session.execution.interrupted":
      return event.data.reason === "shutdown" ? {
        ...base,
        kind: "shutdown"
      } : {
        ...base,
        kind: "end",
        outcome: "interrupted"
      };
    case "session.step.started":
      return {
        ...base,
        kind: "step",
        assistant: {
          at: event.data.started,
          agent: event.data.agent,
          model: event.data.model.id
        }
      };
    case "session.retry.scheduled":
      return {
        ...base,
        kind: "retry",
        until: event.data.at
      };
    case "session.step.failed":
      return {
        ...base,
        kind: "retry-clear"
      };
    case "permission.asked":
      return {
        ...base,
        kind: "permission",
        requestID: event.data.id,
        pending: true
      };
    case "permission.replied":
      return {
        ...base,
        kind: "permission",
        requestID: event.data.requestID,
        pending: false
      };
    case "form.replied":
    case "form.cancelled":
      return {
        ...base,
        kind: "form",
        requestID: event.data.id,
        pending: false
      };
    case "session.created":
      return {
        ...base,
        kind: "created",
        info: {
          id: base.sessionID,
          parentID: event.data.parentID,
          title: event.data.title,
          agent: event.data.agent,
          model: event.data.model?.id
        }
      };
    case "session.deleted":
      return {
        ...base,
        kind: "deleted"
      };
    case "session.agent.selected":
      return {
        ...base,
        kind: "info",
        info: {
          agent: event.data.agent
        }
      };
    case "session.model.selected":
      return {
        ...base,
        kind: "info",
        info: {
          model: event.data.model.id
        }
      };
    case "session.renamed":
      return {
        ...base,
        kind: "info",
        info: {
          title: event.data.title
        }
      };
  }
}
export function source208(context) {
  const client = context.client;
  const tools = new Map();
  const otherTools = new Set();
  const toolKey = (sessionID, messageID, toolID) => `${sessionID}/${messageID}/${toolID}`;
  return {
    async get(id, signal) {
      try {
        return info208(await client.session.get({
          sessionID: id
        }, {
          signal
        }));
      } catch (error) {
        if (sessionNotFound208(error, id)) throw new MissingSession(id);
        throw error;
      }
    },
    async children(id, cursor, signal) {
      const response = await client.session.list({
        parentID: id,
        cursor,
        limit: 100,
        order: "asc"
      }, {
        signal
      });
      return {
        data: response.data.map(info208),
        next: response.cursor.next
      };
    },
    async active(signal) {
      return new Set(Object.keys(await client.session.active({
        signal
      })));
    },
    async snapshot(info, running, signal) {
      const messages = await pages(async cursor => {
        const response = await client.message.list({
          sessionID: info.id,
          cursor,
          limit: 100,
          order: "asc"
        }, {
          signal
        });
        return {
          data: response.data,
          next: response.cursor.next
        };
      }, signal);
      // 使用可取消的公开读取；不依赖宿主缓存是否已加载此树。
      const permissions = await client.permission.list({
        sessionID: info.id
      }, {
        signal
      });
      const forms = await client.session.form.list({
        sessionID: info.id
      }, {
        signal
      });
      signal.throwIfAborted();
      for (const message of messages) if (message.type === "assistant") for (const tool of message.content) {
        if (tool.type !== "tool" || tool.state.status !== "streaming" && tool.state.status !== "running") continue;
        const key = toolKey(info.id, message.id, tool.id);
        if (tool.name !== "subagent") {
          otherTools.add(key);
          continue;
        }
        if (!tools.has(key)) tools.set(key, {
          parentID: info.id,
          tool
        });
      }
      return {
        ...messages208(info, messages, running),
        running,
        permissions: permissions.map(item => item.id),
        forms: forms.map(item => item.id)
      };
    },
    listen(listener) {
      const stop = context.data.listen(({
        details: event
      }) => {
        if (event.type === "server.connected") {
          listener({
            kind: "connected"
          });
          return;
        }
        const normalized = event208(event);
        if (normalized) listener(normalized);
        if (!("sessionID" in event.data)) return;
        const sessionID = event.data.sessionID;
        if (event.type === "session.tool.input.started") {
          const key = toolKey(sessionID, event.data.assistantMessageID, event.data.id);
          if (event.data.name !== "subagent") otherTools.add(key);else tools.set(key, {
            parentID: sessionID,
            tool: {
              type: "tool",
              id: event.data.id,
              name: "subagent",
              time: {
                created: event.created
              },
              state: {
                status: "streaming",
                input: ""
              }
            }
          });
        }
        if (event.type !== "session.tool.called" && event.type !== "session.tool.progress" && event.type !== "session.tool.success" && event.type !== "session.tool.failed") return;
        const key = toolKey(sessionID, event.data.assistantMessageID, event.data.id);
        if (otherTools.has(key)) {
          if (event.type === "session.tool.success" || event.type === "session.tool.failed") otherTools.delete(key);
          return;
        }
        const entry = tools.get(key);
        if (entry) {
          if (event.type === "session.tool.called") {
            entry.tool.time.ran = event.created;
            entry.tool.state = {
              status: "running",
              input: event.data.input,
              metadata: {}
            };
          } else if (entry.tool.state.status !== "streaming") entry.tool.state.metadata = event.data.metadata;
          const link = link208(sessionID, entry.tool);
          if (link) listener({
            kind: "link",
            id: `${event.id}/link`,
            sessionID,
            at: event.created,
            scope: key,
            ...("durable" in event ? {
              seq: event.durable.seq
            } : {}),
            link
          });
        }
        // 缺少 input.started 或快照之前的工具事件，通过该父会话的公开消息分页补齐。
        if (!entry || event.type !== "session.tool.called") listener({
          kind: "refresh",
          sessionID
        });
        if (event.type === "session.tool.success" || event.type === "session.tool.failed") tools.delete(key);
      });
      return () => {
        stop();
        tools.clear();
        otherTools.clear();
      };
    }
  };
}
