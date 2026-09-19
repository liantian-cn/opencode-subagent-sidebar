// 自动生成：npm run compile；请修改 src 中的源码。
import { FullReadError, readTree, root } from "./reader.js";
import { Tree } from "./tree.js";
import { EventJournal } from "./journal.js";
import { MissingSession } from "./types.js";
export class Controller {
  state = "loading";
  disposed = false;
  generation = 0;
  dirty = new Set();
  fullQueued = false;
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
      if (this.selected) void this.load(this.selected);
      return;
    }
    if (event.kind === "refresh") {
      // 初载尚无 current 时也保留补读要求；提交后按已确认树范围过滤。
      if (this.journal || this.current?.nodes.has(event.sessionID) || this.current?.hasPending(event.sessionID)) {
        if (this.current?.invalidAll) this.fullQueued = true;
        this.schedule(event.sessionID);
      }
      return;
    }
    let applied = false;
    for (const tree of this.trees.values()) {
      if (!this.knows(tree, event)) continue;
      applied = true;
      tree.event(event);
      this.journal?.drain(tree);
      if (tree === this.current) {
        // 事件只触发校准，不解除失败范围；同批事件合并为一次全量读取。
        if (tree.invalidAll) {
          this.fullQueued = true;
          this.schedule();
        } else if ([...tree.invalidScopes].some(id => tree.within(event.sessionID, id))) {
          for (const id of tree.invalidScopes) if (tree.within(event.sessionID, id)) this.schedule(id);
        }
        const requests = tree.takeSyncRequests();
        for (const id of requests) this.schedule(id);
        if (requests.length && this.state === "ready") this.state = "loading";
        // 明确删除可以解除对应失效范围；普通事件仍受尚未恢复范围约束。
        // 读取期间保留加载状态，避免未提交快照时提前宣布空树健康。
        if (!this.request) this.state = this.status(tree);
      }
    }
    if (!applied && this.journal && !this.journal.add(event)) {
      // 有界缓冲耗尽时禁止提交不完整快照，明确标记过期，不逐出后假装成功。
      this.request?.abort();
      this.journal = undefined;
      this.dirty.clear();
      if (this.current) this.current.invalidAll = true;
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
    if (!this.disposed && this.selected) await this.load(this.selected);
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
    this.fullQueued = false;
  }
  discover(tree, revisions, info) {
    if (!revisions.has(info.id)) revisions.set(info.id, tree.nodes.get(info.id)?.revision ?? 0);
    tree.discover(info);
    this.journal?.drain(tree);
  }
  commit(tree, revisions, snapshots) {
    let complete = true;
    for (const snapshot of snapshots) {
      const accepted = tree.snapshot(snapshot, revisions.get(snapshot.info.id) ?? 0);
      if (!accepted && !tree.deleted(snapshot.info.id)) {
        complete = false;
        tree.unverify(snapshot.info.id);
        this.dirty.add(snapshot.info.id);
      }
    }
    for (const snapshot of snapshots) for (const link of snapshot.links) tree.associate(link);
    this.journal?.drain(tree);
    for (const id of tree.pendingIDs()) if (!tree.invalidScopes.has(id)) this.dirty.add(id);
    for (const id of tree.takeSyncRequests()) this.dirty.add(id);
    return complete;
  }
  status(tree) {
    if (tree.deleted(tree.rootID) || this.selected && tree.deleted(this.selected)) return "error";
    if (tree.invalidAll || tree.invalidScopes.size) return "stale";
    return tree.requiresValidation() || tree.pendingIDs().length || [...this.dirty].some(id => tree.nodes.has(id)) ? "loading" : "ready";
  }
  async load(id) {
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
    this.state = this.current && (this.current.invalidAll || this.current.invalidScopes.size) ? "stale" : "loading";
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
      const snapshots = await readTree(this.source, ancestor, controller.signal, info => {
        if (generation === this.generation && !controller.signal.aborted) this.discover(tree, revisions, info);
      }, id => {
        if (generation === this.generation && !controller.signal.aborted) tree.missing(id);
      }, [...tree.nodes.values()].map(node => node.info));
      if (generation !== this.generation || this.disposed || controller.signal.aborted) return;
      const complete = this.commit(tree, revisions, snapshots);
      if (tree.deleted(id)) throw new MissingSession(id);
      if (complete) {
        tree.invalidAll = false;
        tree.recover(tree.rootID, new Set(snapshots.map(snapshot => snapshot.info.id)));
      }
      // 手动/全量校准也重试此前失败的未落地关联；普通局部成功不会循环重试它们。
      for (const pending of tree.pendingIDs()) this.dirty.add(pending);
      tree.initialized = true;
      this.state = this.status(tree);
    } catch (error) {
      if (controller.signal.aborted || generation !== this.generation || this.disposed) return;
      controller.abort();
      if (this.current) this.current.invalidAll = true;
      this.state = error instanceof MissingSession || !this.current ? "error" : "stale";
    } finally {
      if (generation === this.generation && !this.disposed) {
        this.request = undefined;
        this.journal = undefined;
        this.loadingID = undefined;
        this.enteredAt = undefined;
        this.changed();
        if (this.dirty.size || this.fullQueued) this.schedule();
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
    if (this.fullQueued && this.selected && !this.request && !this.disposed) {
      await this.load(this.selected);
      return;
    }
    const tree = this.current;
    if (!tree || this.disposed || this.request) return;
    const pending = new Set(tree.pendingIDs());
    const ids = [...this.dirty].filter(id => !tree.deleted(id) && (tree.nodes.has(id) || pending.has(id)));
    // 出队先登记未完成范围，切换、取消或批次中途失败不会把它们伪装成已同步。
    for (const id of ids) tree.unverify(id);
    this.dirty.clear();
    const generation = this.generation;
    const controller = this.request = new AbortController();
    this.journal = new EventJournal();
    const revisions = new Map([...tree.nodes].map(([id, node]) => [id, node.revision]));
    const loaded = new Set();
    this.state = this.status(tree);
    this.changed();
    try {
      // 子树逐个补齐，子树内部并发四；不会把并发上限乘起来。
      for (const id of ids) {
        if (loaded.has(id) || tree.deleted(id)) continue;
        try {
          const info = await this.source.get(id, controller.signal);
          if (generation !== this.generation || this.disposed || controller.signal.aborted) return;
          if (info.id !== tree.rootID && (!info.parentID || !tree.nodes.has(info.parentID))) throw new Error("子树祖先尚未确认");
          const snapshots = await readTree(this.source, info, controller.signal, info => {
            if (generation === this.generation && !controller.signal.aborted) this.discover(tree, revisions, info);
          }, id => {
            if (generation === this.generation && !controller.signal.aborted) tree.missing(id);
          }, [...tree.nodes.values()].filter(node => tree.within(node.info.id, id)).map(node => node.info));
          if (generation !== this.generation || this.disposed || controller.signal.aborted) return;
          if (this.commit(tree, revisions, snapshots)) {
            tree.recover(id, new Set(snapshots.map(snapshot => snapshot.info.id)));
            for (const snapshot of snapshots) loaded.add(snapshot.info.id);
          }
        } catch (error) {
          if (generation !== this.generation || this.disposed || controller.signal.aborted) return;
          if (error instanceof MissingSession && error.sessionID === id && id !== tree.rootID && id !== this.selected) tree.missing(id);else if (error instanceof FullReadError || id === tree.rootID || error instanceof MissingSession && id === this.selected) {
            tree.invalidAll = true;
            if (error instanceof MissingSession) tree.missing(id);
          } else tree.invalidScopes.add(id);
          // 一个子树失败不丢掉本批后续范围，也不立即重试失败请求。
        }
      }
      if (generation === this.generation && !controller.signal.aborted) this.state = this.status(tree);
    } finally {
      if (generation === this.generation && !this.disposed) {
        this.request = undefined;
        this.journal = undefined;
        this.changed();
        if (this.dirty.size || this.fullQueued) this.schedule();
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
