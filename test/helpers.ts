import type { Event, Info, Snapshot, Source } from "../src/core/types.js"

export function snapshot(id: string, parentID?: string, changes: Partial<Snapshot> = {}): Snapshot {
  return { info: { id, parentID, title: `任务 ${id}` }, running: false, permissions: [], forms: [], links: [], ...changes }
}
export function task(id: string, parentID = "root", changes: Partial<Snapshot> = {}): Snapshot {
  return snapshot(id, parentID, changes)
}
export function event(kind: "start" | "shutdown" | "retry-clear", sessionID: string, at: number): Event {
  return { id: `${sessionID}-${kind}-${at}`, sessionID, at, kind }
}
export function end(sessionID: string, at: number, outcome: "succeeded" | "failed" | "interrupted" = "succeeded"): Event {
  return { id: `${sessionID}-end-${at}`, sessionID, at, kind: "end", outcome }
}
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
export class FakeSource implements Source {
  snapshots = new Map<string, Snapshot>()
  listener?: Parameters<Source["listen"]>[0]
  stops = 0
  requests: { id: string; signal: AbortSignal }[] = []
  gate?: (info: Info, signal: AbortSignal) => Promise<Snapshot>
  childPages = new Map<string, string[][]>()
  cursors: string[] = []
  listen(listener: Parameters<Source["listen"]>[0]) { this.listener = listener; return () => { this.listener = undefined; this.stops++ } }
  emit(event: Parameters<Parameters<Source["listen"]>[0]>[0]) { this.listener?.(event) }
  async get(id: string, signal: AbortSignal) {
    this.requests.push({ id, signal })
    const item = this.snapshots.get(id)
    if (!item) throw new Error(`缺少测试会话 ${id}`)
    return structuredClone(item.info)
  }
  async children(id: string, cursor: string | undefined) {
    this.cursors.push(`${id}:${cursor ?? "first"}`)
    const explicit = this.childPages.get(id)
    if (explicit) {
      const index = Number(cursor ?? 0)
      return { data: explicit[index].map(id => this.snapshots.get(id)!.info), next: index + 1 < explicit.length ? String(index + 1) : undefined }
    }
    return { data: [...this.snapshots.values()].filter(s => s.info.parentID === id).map(s => structuredClone(s.info)) }
  }
  async active() { return new Set([...this.snapshots.values()].filter(s => s.running).map(s => s.info.id)) }
  async snapshot(info: Info, _running: boolean, signal: AbortSignal) {
    this.requests.push({ id: info.id, signal })
    return this.gate ? this.gate(info, signal) : structuredClone(this.snapshots.get(info.id)!)
  }
  add(...snapshots: Snapshot[]) { for (const item of snapshots) this.snapshots.set(item.info.id, item); return this }
}
