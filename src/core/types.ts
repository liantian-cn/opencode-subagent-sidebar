export type Outcome = "succeeded" | "failed" | "interrupted"
export interface Info {
  id: string
  parentID?: string
  title?: string
  agent?: string
  model?: string
  outcome?: Outcome
  idle?: number
}
export interface Assistant {
  at: number
  agent?: string
  model?: string
  retryAt?: number
}
export interface Link {
  parentID: string
  childID: string
  description?: string
  at: number
  key: string
}
export interface Snapshot {
  info: Info
  running: boolean
  assistant?: Assistant
  permissions: string[]
  forms: string[]
  links: Link[]
}
export type Event = { id: string; sessionID: string; at: number; seq?: number; scope?: string } & (
  | { kind: "start" | "shutdown" | "retry-clear" | "deleted" }
  | { kind: "end"; outcome: Outcome }
  | { kind: "step"; assistant: Assistant }
  | { kind: "retry"; until: number }
  | { kind: "permission" | "form"; requestID: string; pending: boolean }
  | { kind: "info"; info: Partial<Info> }
  | { kind: "created"; info: Info }
  | { kind: "link"; link: Link }
)
export interface Row {
  id: string
  number: string
  parent?: string
  summary: string
  agent: string
  model: string
  status: string
  started?: number
  ended?: number
}
export interface Page<T> { data: T[]; next?: string | null }
export class MissingSession extends Error {
  constructor(readonly sessionID: string) { super(`会话不存在：${sessionID}`) }
}
export interface Source {
  get(id: string, signal: AbortSignal): Promise<Info>
  children(id: string, cursor: string | undefined, signal: AbortSignal): Promise<Page<Info>>
  active(signal: AbortSignal): Promise<Set<string>>
  snapshot(info: Info, running: boolean, signal: AbortSignal): Promise<Snapshot>
  listen(listener: (event: Event | { kind: "connected" } | { kind: "refresh"; sessionID: string }) => void): () => void
}
