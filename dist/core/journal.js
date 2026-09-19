// 自动生成：npm run build；请修改 src 中的源码。
import { EventOrder } from "./order.js";
// 仅缓冲尚未归属已访问树的会话；已知会话直接投影，不复制成长事件日志。
export class EventJournal {
  sessions = new Map();
  index = 0;
  static limit = 4096;
  get size() {
    let size = 0;
    for (const session of this.sessions.values()) size += session.events.size;
    return size;
  }
  add(event) {
    let session = this.sessions.get(event.sessionID);
    if (!session) {
      session = {
        order: new EventOrder(),
        events: new Map(),
        shutdown: false,
        refresh: false
      };
      this.sessions.set(event.sessionID, session);
    }
    if (!session.order.accept(event)) {
      if (session.order.takeRefresh()) session.refresh = true;
      return true;
    }
    let key = event.kind;
    if (event.kind === "start") {
      if (session.shutdown) key = "resume";else for (const name of session.events.keys()) {
        if (!["created", "info", "deleted"].includes(name) && !name.startsWith("link:")) session.events.delete(name);
      }
      session.shutdown = false;
      if (key !== "resume") session.order.reconcileRequests([], []);
    } else if (event.kind === "shutdown") {
      session.shutdown = true;
      session.events.delete("resume");
    } else if (event.kind === "end" || event.kind === "deleted") {
      session.shutdown = false;
      session.order.reconcileRequests([], []);
      for (const name of session.events.keys()) if (name.startsWith("permission:") || name.startsWith("form:") || name === "retry") session.events.delete(name);
    } else if (event.kind === "permission" || event.kind === "form") key = `${event.kind}:${event.requestID}`;else if (event.kind === "link") key = `link:${event.link.childID}`;else if (event.kind === "retry-clear") key = "retry";else if (event.kind === "info") {
      const old = session.events.get(key)?.event;
      if (old?.kind === "info") event = {
        ...event,
        info: {
          ...old.info,
          ...event.info
        }
      };
    }
    session.events.set(key, {
      event,
      index: this.index++
    });
    // 不静默逐出关联或生命周期；极端未归属输入使本次读取明确失败，等待重校准。
    return this.size <= EventJournal.limit;
  }
  drain(tree) {
    let progress = true;
    while (progress) {
      progress = false;
      for (const [id, session] of this.sessions) {
        const created = session.events.get("created")?.event;
        const pendingDeletion = tree.hasPending(id) && session.events.has("deleted");
        if (!tree.nodes.has(id) && !tree.deleted(id) && !pendingDeletion && !(created?.kind === "created" && created.info.parentID && tree.nodes.has(created.info.parentID))) continue;
        for (const {
          event
        } of [...session.events.values()].sort((a, b) => a.index - b.index)) tree.event(event);
        if (session.refresh) tree.requireSync(id);
        this.sessions.delete(id);
        progress = true;
      }
    }
  }
}
