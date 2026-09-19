// 自动生成：npm run build；请修改 src 中的源码。
import { readTree, root } from "./reader.js";
import { Tree } from "./tree.js";
import { EventJournal } from "./journal.js";
import { MissingSession } from "./types.js";
export class Controller {
  state = "loading";
  disposed = false;
  generation = 0;
  dirty = new Set();
  constructor(source, changed, clock = Date.now, retained) {
    this.source = source;
    this.changed = changed;
    this.clock = clock;
    this.retained = retained;
    this.trees = retained ?? new Map();
    // 必须先订阅；祖先解析和首个 HTTP 快照期间也要保留事件。
    this.stop = source.listen(event => this.receive(event));
  }
  knows(tree, event) {
    return tree.nodes.has(event.sessionID) || tree.deleted(event.sessionID) || event.kind === "deleted" && tree.hasPending(event.sessionID) || event.kind === "created" && !!event.info.parentID && tree.nodes.has(event.info.parentID);
  }
  receive(event) {
    if (this.disposed) return;
    if (event.kind === "connected") {
      if (this.selected) void this.load(this.selected, true);
      return;
    }
    if (event.kind === "refresh") {
      // 初载尚无 current 时也保留补读要求；提交后按已确认树范围过滤。
      if (this.journal || this.current?.nodes.has(event.sessionID)) this.schedule(event.sessionID);
      return;
    }
    let applied = false;
    for (const tree of this.trees.values()) {
      if (!this.knows(tree, event)) continue;
      applied = true;
      tree.event(event);
      this.journal?.drain(tree);
      if (tree === this.current) {
        const requests = tree.takeSyncRequests();
        for (const id of requests) this.schedule(id);
        if (requests.length && this.state === "ready") this.state = "loading";
      }
      tree.prune();
    }
    if (!applied && this.journal && !this.journal.add(event)) {
      // 有界缓冲耗尽时禁止提交不完整快照，明确标记过期，不逐出后假装成功。
      this.request?.abort();
      this.journal = undefined;
      this.dirty.clear();
      this.state = this.current ? "stale" : "error";
    }
    if (event.kind === "created" && (this.journal || this.current?.nodes.has(event.sessionID))) this.schedule(event.sessionID);
    this.changed();
  }
  async select(id) {
    if (this.disposed || id === this.selected) return;
    this.selected = id;
    if (!id) {
      this.cancel();
      this.current = undefined;
      this.changed();
      return;
    }
    await this.load(id);
  }
  async refresh() {
    if (!this.disposed && this.selected) await this.load(this.selected, true);
  }
  cancel() {
    this.generation++;
    this.request?.abort();
    this.request = undefined;
    this.journal = undefined;
    this.loadingID = undefined;
    this.enteredAt = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.dirty.clear();
  }
  discover(tree, revisions, info) {
    if (!revisions.has(info.id)) revisions.set(info.id, tree.nodes.get(info.id)?.revision ?? 0);
    tree.discover(info);
    this.journal?.drain(tree);
  }
  commit(tree, revisions, snapshots) {
    for (const snapshot of snapshots) {
      const accepted = tree.snapshot(snapshot, revisions.get(snapshot.info.id) ?? 0);
      if (!accepted && !tree.deleted(snapshot.info.id)) this.dirty.add(snapshot.info.id);
    }
    for (const snapshot of snapshots) for (const link of snapshot.links) tree.associate(link);
    this.journal?.drain(tree);
    for (const id of tree.pendingIDs()) this.dirty.add(id);
    for (const id of tree.takeSyncRequests()) this.dirty.add(id);
    tree.prune();
  }
  async load(id, reconnect = false) {
    if (this.disposed) return;
    const continuing = this.loadingID === id || !this.loadingID && !!this.request && !!this.current?.nodes.has(id);
    const carry = continuing ? this.journal : undefined;
    const entered = this.loadingID === id ? this.enteredAt ?? this.clock() : this.clock();
    const dirty = continuing ? [...this.dirty] : [];
    this.cancel();
    this.loadingID = id;
    this.enteredAt = entered;
    for (const id of dirty) this.dirty.add(id);
    const generation = this.generation;
    const controller = this.request = new AbortController();
    this.journal = carry ?? new EventJournal();
    this.current = [...this.trees.values()].find(tree => tree.nodes.has(id));
    this.state = reconnect && this.current ? "stale" : "loading";
    // 在任何 await 前固定版本，删除墓碑独立于此表，永不被旧响应重新创建。
    const revisions = new Map([...this.trees.values()].flatMap(tree => [...tree.nodes].map(([key, node]) => [key, node.revision])));
    this.changed();
    try {
      const ancestor = await root(this.source, id, controller.signal);
      if (generation !== this.generation || this.disposed || controller.signal.aborted) return;
      const tree = this.trees.get(ancestor.id) ?? new Tree(ancestor.id, entered);
      this.trees.set(tree.rootID, tree);
      this.current = tree;
      this.discover(tree, revisions, ancestor);
      const snapshots = await readTree(this.source, ancestor, controller.signal, info => this.discover(tree, revisions, info));
      if (generation !== this.generation || this.disposed || controller.signal.aborted) return;
      this.commit(tree, revisions, snapshots);
      tree.initialized = true;
      const incomplete = tree.requiresValidation() || tree.pendingIDs().length > 0 || tree.rows().length === 0 && [...this.dirty].some(id => tree.nodes.has(id));
      this.state = incomplete ? "loading" : "ready";
    } catch {
      if (controller.signal.aborted || generation !== this.generation || this.disposed) return;
      controller.abort();
      this.state = this.current ? "stale" : "error";
    } finally {
      if (generation === this.generation && !this.disposed) {
        this.request = undefined;
        this.journal = undefined;
        this.loadingID = undefined;
        this.enteredAt = undefined;
        this.changed();
        if (this.dirty.size) this.schedule();
      }
    }
  }
  schedule(id) {
    if (id) this.dirty.add(id);
    if (this.request || this.timer || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.readDirty();
    }, 150);
  }
  async readDirty() {
    const tree = this.current;
    if (!tree || this.disposed || this.request) return;
    const pending = new Set(tree.pendingIDs());
    const ids = [...this.dirty].filter(id => !tree.deleted(id) && (tree.nodes.has(id) || pending.has(id)));
    this.dirty.clear();
    const generation = this.generation;
    const controller = this.request = new AbortController();
    this.journal = new EventJournal();
    const revisions = new Map([...tree.nodes].map(([id, node]) => [id, node.revision]));
    const loaded = new Set();
    try {
      // 子树逐个补齐，子树内部并发四；不会把并发上限乘起来。
      for (const id of ids) {
        if (loaded.has(id) || tree.deleted(id)) continue;
        let info;
        try {
          info = await this.source.get(id, controller.signal);
        } catch (error) {
          if (generation !== this.generation || this.disposed || controller.signal.aborted) return;
          if (!(error instanceof MissingSession) || error.sessionID !== id) throw error;
          tree.missing(id);
          continue;
        }
        if (info.id !== tree.rootID && (!info.parentID || !tree.nodes.has(info.parentID))) continue;
        const snapshots = await readTree(this.source, info, controller.signal, info => this.discover(tree, revisions, info));
        if (generation !== this.generation || this.disposed || controller.signal.aborted) return;
        this.commit(tree, revisions, snapshots);
        for (const snapshot of snapshots) loaded.add(snapshot.info.id);
      }
      if (generation === this.generation && this.state === "loading" && !tree.pendingIDs().length && !tree.requiresValidation()) this.state = "ready";
    } catch {
      if (!controller.signal.aborted && generation === this.generation) {
        controller.abort();
        this.state = "stale";
      }
    } finally {
      if (generation === this.generation && !this.disposed) {
        this.request = undefined;
        this.journal = undefined;
        this.changed();
        if (this.dirty.size) this.schedule();
      }
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.stop();
    if (!this.retained) this.trees.clear();
    this.current = undefined;
  }
}
