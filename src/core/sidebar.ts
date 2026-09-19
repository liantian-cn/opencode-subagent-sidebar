import type { Data } from "@opencode/plugin/tui/context"

export type SidebarSession = Pick<ReturnType<Data["session"]["list"]>[number], "id" | "parentID" | "agent" | "title" | "time">

export interface SidebarEntry {
  id: string
  agent: string
  title: string
}

// 复用 v2.0.8 官方 picker 的标题和代理名规则，不导入宿主内部组件。
function entry(session: SidebarSession): SidebarEntry {
  const title = session.title ?? `${session.parentID ? "Child" : "New"} session - ${new Date(session.time.created).toISOString()}`
  const match = title.match(/@(\w+) subagent/)
  return {
    id: session.id,
    agent: (session.agent || match?.[1] || "Subagent").replace(/\b\w/g, char => char.toUpperCase()),
    title: match ? title.replace(match[0], "").trim() || title : title,
  }
}

export function activeSubagents(
  sessions: readonly SidebarSession[],
  sessionID: string,
  status: Data["session"]["status"],
): SidebarEntry[] {
  // 只收窄官方候选范围；保留宿主顺序，不额外查消息证明工具来源。
  return sessions
    .filter(session => session.id !== sessionID && session.parentID === sessionID && status(session.id) === "running")
    .map(entry)
}
