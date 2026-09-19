// 自动生成：npm run build；请修改 src 中的源码。
// durable 序列属于会话；易失事件的因果关系属于请求或工具调用，不能共享时间水位。
export class EventOrder {
  sequence = -1;
  recent = new Set();
  lifecycleTime = -Infinity;
  active = new Map();
  settled = new Map();
  retiredThrough = -Infinity;
  calls = new Map();
  refresh = false;
  rememberSettled(key, at) {
    this.active.delete(key);
    this.settled.set(key, at);
    if (this.settled.size > 64) {
      const [old, time] = this.settled.entries().next().value;
      this.settled.delete(old);
      this.retiredThrough = Math.max(this.retiredThrough, time);
    }
  }
  accept(event) {
    if (event.seq !== undefined) {
      if (event.seq <= this.sequence) return false;
      this.sequence = event.seq;
      return true;
    }
    if (event.kind === "permission" || event.kind === "form") {
      const key = `${event.kind}:${event.requestID}`;
      // 请求 ID 为一次性身份：终结优先，reply 先到也不能被迟到 asked 复活。
      if (this.settled.has(key)) return false;
      if (!event.pending) {
        this.rememberSettled(key, Math.max(event.at, this.active.get(key) ?? -Infinity));
        return true;
      }
      if (this.active.has(key)) return false;
      if (event.at <= this.retiredThrough) {
        // 已淘汰身份与合法迟到请求无法仅凭时间区分，交由快照确认而非丢弃合法请求。
        this.refresh = true;
        return false;
      }
      this.active.set(key, event.at);
      return true;
    }
    if (this.recent.has(event.id)) return false;
    if (["start", "end", "shutdown", "deleted"].includes(event.kind)) {
      if (event.at <= this.lifecycleTime) return false;
      this.lifecycleTime = event.at;
    }
    if (event.kind === "link") {
      const key = event.scope ?? event.link.key;
      if (event.at < (this.calls.get(key) ?? -Infinity)) return false;
      this.calls.delete(key);
      this.calls.set(key, event.at);
      if (this.calls.size > 64) this.calls.delete(this.calls.keys().next().value);
    }
    this.recent.add(event.id);
    if (this.recent.size > 64) this.recent.delete(this.recent.values().next().value);
    return true;
  }
  reconcileRequests(permissions, forms) {
    const pending = new Set([...permissions].map(id => `permission:${id}`).concat([...forms].map(id => `form:${id}`)));
    for (const [key, at] of this.active) if (!pending.has(key)) this.rememberSettled(key, at);
    for (const key of pending) {
      this.settled.delete(key);
      // 快照不提供 asked 时间；将来淘汰这种身份后，迟到 asked 必须重新读取确认。
      if (!this.active.has(key)) this.active.set(key, Infinity);
    }
  }
  takeRefresh() {
    const refresh = this.refresh;
    this.refresh = false;
    return refresh;
  }
  get retainedIDs() {
    return this.recent.size;
  }
  get settledRequests() {
    return this.settled.size;
  }
  get retainedCalls() {
    return this.calls.size;
  }
}
