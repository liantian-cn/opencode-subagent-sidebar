// 自动生成：npm run compile；请修改 src 中的源码。
import { EventOrder } from "./order.js";
const compareID = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
export class Tree {
  nodes = new Map();
  links = new Map();
  nextNumber = 1;
  tombstones = new Set();
  pendingLinks = new Map();
  syncRequests = new Set();
  unverified = new Set();
  invalidScopes = new Set();
  invalidAll = false;
  initialized = false;
  constructor(rootID, visitedAt) {
    this.rootID = rootID;
    this.visitedAt = visitedAt;
  }
  ensure(info) {
    let node = this.nodes.get(info.id);
    if (!node) {
      node = {
        info,
        number: info.id === this.rootID ? "根" : String(this.nextNumber++).padStart(2, "0"),
        round: {
          phase: "unknown"
        },
        permissions: new Set(),
        forms: new Set(),
        revision: 0,
        hydrated: false,
        lifecycleObserved: false,
        order: new EventOrder(),
        eventFloor: -Infinity
      };
      this.nodes.set(info.id, node);
      const link = this.pendingLinks.get(info.id);
      if (link) {
        this.pendingLinks.delete(info.id);
        this.associate(link);
      }
    }
    return node;
  }
  associate(link) {
    if (this.tombstones.has(link.childID) || this.tombstones.has(link.parentID) || link.childID === this.rootID) return;
    const child = this.nodes.get(link.childID);
    if (child && child.info.parentID !== link.parentID) return;
    const links = child ? this.links : this.pendingLinks;
    const previous = links.get(link.childID);
    if (!previous || link.at > previous.at || link.at === previous.at && link.key > previous.key) links.set(link.childID, link);
  }
  deleted(id) {
    return this.tombstones.has(id);
  }
  hasPending(id) {
    return this.pendingLinks.has(id);
  }
  pendingIDs() {
    return [...this.pendingLinks.keys()];
  }
  requireSync(id) {
    if (this.deleted(id)) return;
    this.syncRequests.add(id);
    this.unverified.add(id);
    const node = this.nodes.get(id);
    if (node) node.revision++;
  }
  requiresValidation() {
    return this.unverified.size > 0;
  }
  unverify(id) {
    if (!this.deleted(id)) this.unverified.add(id);
  }
  within(id, scope) {
    const seen = new Set();
    while (!seen.has(id)) {
      if (id === scope) return true;
      seen.add(id);
      const parent = this.nodes.get(id)?.info.parentID ?? this.pendingLinks.get(id)?.parentID;
      if (!parent) return false;
      id = parent;
    }
    return false;
  }
  invalid(id) {
    return this.invalidAll || [...this.invalidScopes, ...this.unverified].some(scope => this.within(id, scope));
  }
  recover(scope, covered) {
    for (const id of this.invalidScopes) if (covered.has(id) && this.within(id, scope) || this.deleted(id)) this.invalidScopes.delete(id);
  }
  takeSyncRequests() {
    const ids = [...this.syncRequests];
    this.syncRequests.clear();
    return ids;
  }
  missing(id) {
    if (this.nodes.has(id) || this.pendingLinks.has(id)) this.remove(id);
  }
  discover(info) {
    if (this.tombstones.has(info.id) || info.parentID && this.tombstones.has(info.parentID)) return;
    this.ensure(info);
  }
  remove(id) {
    const pending = [id];
    while (pending.length) {
      const current = pending.pop();
      if (this.tombstones.has(current)) continue;
      this.tombstones.add(current);
      for (const node of this.nodes.values()) if (node.info.parentID === current) pending.push(node.info.id);
      for (const link of this.pendingLinks.values()) if (link.parentID === current) pending.push(link.childID);
      this.nodes.delete(current);
      this.links.delete(current);
      this.pendingLinks.delete(current);
      this.syncRequests.delete(current);
      this.unverified.delete(current);
      this.invalidScopes.delete(current);
    }
  }
  connected(id) {
    const seen = new Set();
    while (id !== this.rootID) {
      if (seen.has(id) || this.tombstones.has(id)) return false;
      seen.add(id);
      const parent = this.nodes.get(id)?.info.parentID;
      if (!parent) return false;
      id = parent;
    }
    return this.nodes.has(id) && !this.tombstones.has(id);
  }
  snapshot(snapshot, revision) {
    if (this.tombstones.has(snapshot.info.id) || snapshot.info.parentID && this.tombstones.has(snapshot.info.parentID)) return;
    const previous = this.nodes.get(snapshot.info.id);
    const fresh = !previous || !previous.hydrated && !previous.lifecycleObserved;
    // 本次请求之后的事件优先；旧响应不能覆盖本轮状态或选择字段。
    if ((this.nodes.get(snapshot.info.id)?.revision ?? 0) !== revision) return;
    const node = this.ensure(snapshot.info);
    this.unverified.delete(snapshot.info.id);
    node.hydrated = true;
    node.info = snapshot.info;
    node.permissions = new Set(snapshot.permissions);
    node.forms = new Set(snapshot.forms);
    node.order.reconcileRequests(node.permissions, node.forms);
    const round = node.round;
    const idle = snapshot.info.idle;
    const idleAdvanced = idle !== undefined && idle > (round.baselineIdle ?? -Infinity);
    if (snapshot.running) {
      if (round.phase === "ended" || !fresh && idleAdvanced && (round.started === undefined || idle >= round.started)) {
        node.round = {
          phase: "running",
          baselineIdle: idle
        };
        node.permissions = new Set(snapshot.permissions);
        node.forms = new Set(snapshot.forms);
      } else round.phase = "running";
      node.round.assistant = snapshot.assistant;
      node.round.retryAt = snapshot.assistant?.retryAt;
    } else if (fresh) {
      // 终态只建立内部基线，保留轮次与重放保护，不参与展示。
      round.phase = snapshot.info.outcome ? "ended" : "unknown";
      round.outcome = snapshot.info.outcome;
      round.ended = idle;
      round.assistant = snapshot.assistant;
    } else if (snapshot.info.outcome && idle !== undefined && idle > (round.baselineIdle ?? -Infinity) && idle >= this.visitedAt && (round.started === undefined || idle >= round.started)) {
      // 已访问树在断线期间可能完整跑过新一轮；新的 idle 才是新结束证据。
      const completed = round.phase === "ended" ? node.round = {
        phase: "ended"
      } : round;
      completed.phase = "ended";
      completed.outcome = snapshot.info.outcome;
      completed.ended = idle;
      completed.retryAt = undefined;
      completed.shutdown = false;
      completed.assistant = snapshot.assistant ?? completed.assistant;
    } else if (round.phase === "running") {
      round.phase = "unknown";
    }
    if (!snapshot.running) node.round.retryAt = node.round.phase !== "ended" && !node.round.shutdown ? snapshot.assistant?.retryAt : undefined;
    node.round.baselineIdle = Math.max(node.round.baselineIdle ?? -Infinity, idle ?? -Infinity);
    if (this.initialized && idle !== undefined) node.eventFloor = Math.max(node.eventFloor, idle);
    return true;
  }
  event(event) {
    if (this.tombstones.has(event.sessionID)) return;
    if (event.kind === "deleted") {
      if (this.nodes.has(event.sessionID) || this.pendingLinks.has(event.sessionID)) this.remove(event.sessionID);
      return;
    }
    if (event.kind === "created") {
      if (!event.info.parentID || !this.nodes.has(event.info.parentID) || this.tombstones.has(event.info.parentID)) return;
      this.ensure(event.info);
    }
    const node = this.nodes.get(event.sessionID);
    if (!node) return;
    const execution = ["start", "end", "shutdown", "step", "retry", "retry-clear"].includes(event.kind);
    if (execution && event.at < node.eventFloor) return;
    if (!node.order.accept(event)) {
      if (node.order.takeRefresh()) this.requireSync(event.sessionID);
      return;
    }
    if (execution) node.lifecycleObserved = true;
    node.revision++;
    const round = node.round;
    switch (event.kind) {
      case "start":
        if (!round.shutdown) {
          node.round = {
            phase: "running",
            started: event.at,
            baselineIdle: node.info.idle
          };
          node.permissions.clear();
          node.forms.clear();
          node.order.reconcileRequests(node.permissions, node.forms);
        } else {
          // shutdown 保留执行意图；普通 distinct start 则必定开始新 busy period。
          round.phase = "running";
          round.shutdown = false;
        }
        break;
      case "shutdown":
        round.phase = "unknown";
        round.shutdown = true;
        round.retryAt = undefined;
        break;
      case "end":
        if (event.at < this.visitedAt) break;
        if (round.ended !== undefined && event.at <= round.ended) break;
        if (round.started !== undefined && event.at < round.started) break;
        Object.assign(round, {
          phase: "ended",
          ended: event.at,
          baselineIdle: event.at,
          outcome: event.outcome,
          retryAt: undefined,
          shutdown: false
        });
        node.info.idle = event.at;
        node.info.outcome = event.outcome;
        node.permissions.clear();
        node.forms.clear();
        node.order.reconcileRequests(node.permissions, node.forms);
        break;
      case "step":
        if (round.phase === "ended" && event.at > (round.ended ?? -Infinity)) node.round = {
          phase: "running",
          baselineIdle: node.info.idle
        };
        if (node.round.phase !== "ended") node.round.phase = "running";
        node.round.assistant = event.assistant;
        node.round.retryAt = undefined;
        break;
      case "retry":
        round.retryAt = event.until;
        break;
      case "retry-clear":
        round.retryAt = undefined;
        break;
      case "permission":
      case "form":
        {
          const pending = event.kind === "permission" ? node.permissions : node.forms;
          if (event.pending) pending.add(event.requestID);else pending.delete(event.requestID);
          break;
        }
      case "info":
        Object.assign(node.info, event.info);
        break;
      case "link":
        this.associate(event.link);
        break;
    }
  }
  rows(_now) {
    const rows = [...this.nodes.values()].filter(node => this.connected(node.info.id) && this.links.has(node.info.id) && !this.invalid(node.info.id) && node.round.phase !== "ended" && (node.round.phase === "running" || !node.round.shutdown && (node.permissions.size > 0 || node.forms.size > 0 || node.round.retryAt !== undefined)));
    rows.sort((a, b) => {
      const time = (a.round.started ?? Infinity) - (b.round.started ?? Infinity);
      return time || compareID(a.info, b.info);
    });
    return rows.map(node => {
      const {
        round,
        info
      } = node;
      const status = node.permissions.size ? "待授权" : node.forms.size ? "待输入" : round.retryAt !== undefined ? "重试等待" : "运行中";
      return {
        id: info.id,
        number: node.number,
        parent: info.parentID && info.parentID !== this.rootID ? this.nodes.get(info.parentID)?.number ?? "?" : undefined,
        summary: this.links.get(info.id)?.description || info.title || "—",
        agent: round.assistant?.agent || info.agent || "—",
        model: (round.assistant?.model || info.model)?.split("/").at(-1) || "—",
        status,
        started: round.started,
        ended: round.phase === "ended" ? round.ended : undefined
      };
    });
  }
}
