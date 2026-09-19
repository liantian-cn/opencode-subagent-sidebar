import { Plugin } from "@opencode/plugin/tui"
import type { PanelInput } from "@opencode/plugin/tui/context"
import type { BoxRenderable } from "@opentui/core"
import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { Controller } from "./core/controller.js"
import { Tree } from "./core/tree.js"
import { lines, truncate } from "./core/format.js"
import { source208 } from "./v208.js"

const panelName = "subagent-sidebar.tree"

export default Plugin.define({
  id: "subagent-sidebar",
  setup(context) {
    const [revision, setRevision] = createSignal(0)
    const [memory] = context.storage.memory("trees", { initial: { trees: new Map<string, Tree>() } })
    const controller = new Controller(source208(context), () => setRevision(value => value + 1), Date.now, memory.trees)
    const [now, setNow] = createSignal(Date.now())
    // 只刷新本地时长，不进行网络轮询。
    const timer = setInterval(() => setNow(Date.now()), 1000)
    const state = () => { revision(); return controller.state }
    const tree = () => { revision(); return controller.current }
    const rows = createMemo(() => tree()?.rows() ?? [])
    const notice = () => state() === "loading" ? "正在加载子代理树…" : state() === "error" ? "加载失败；请重新打开子代理树" : state() === "stale" ? "数据可能过期；请重新打开刷新" : undefined

    function Content(props: { width?: number }) {
      const [measured, setMeasured] = createSignal(30)
      let box: BoxRenderable | undefined
      const width = () => Math.max(0, props.width ?? measured())
      return <box ref={box} flexDirection="column" flexShrink={0} width="100%" onSizeChange={() => setMeasured(box?.width ?? 30)}>
        <Show when={notice()}><text fg={context.theme.text.default} wrapMode="none">{truncate(notice()!, width())}</text></Show>
        <For each={rows()}>{row => {
          const display = createMemo(() => lines(row, width(), now()))
          return <box flexDirection="column" flexShrink={0} marginBottom={1}>
            <text fg={context.theme.text.default} wrapMode="none">{display()[0]}</text>
            <text fg={context.theme.text.subdued} wrapMode="none">{display()[1]}</text>
          </box>
        }}</For>
      </box>
    }

    function Panel(props: { panel: PanelInput }) {
      context.keymap.layer(() => ({
        enabled: () => props.panel.focused,
        commands: [{ id: "subagent-sidebar.escape", bind: "escape", run: () => context.ui.panel.close() }],
      }))
      return <box height="100%" width="100%" flexDirection="column" onMouseDown={() => props.panel.focus()}>
        <box flexDirection="row" flexShrink={0} justifyContent="space-between">
          <text fg={context.theme.text.default}>子代理树</text>
          <text fg={context.theme.text.default} onMouseUp={() => context.ui.panel.close()}>[关闭]</text>
        </box>
        <scrollbox flexGrow={1} minHeight={0} horizontalScrollbarOptions={{ visible: false }}>
          <Content width={Math.max(0, props.panel.width - 2)} />
        </scrollbox>
      </box>
    }

    const slots = [
      context.ui.slot({ append: "app", render: () => {
        context.keymap.layer(() => ({ mode: "global", commands: [
          { id: "subagent-sidebar.open", title: "打开子代理树", group: "子代理树", palette: true,
            enabled: () => context.ui.router.current().type === "session",
            run: () => { context.ui.panel.open(panelName); void controller.refresh() } },
          { id: "subagent-sidebar.close", title: "关闭子代理树", group: "子代理树", palette: true,
            enabled: () => context.ui.panel.current()?.name === panelName,
            run: () => context.ui.panel.close() },
        ] }))
        createEffect(() => {
          const route = context.ui.router.current()
          void controller.select(route.type === "session" ? route.sessionID : undefined)
        })
        createEffect(() => {
          const current = context.ui.panel.current()
          if (current?.name === panelName && state() === "ready" && rows().length === 0) context.ui.panel.close()
        })
        return null
      } }),
      context.ui.slot({ after: "sidebar.content", render: () => <Show when={notice() || rows().length > 0}>
        <box flexDirection="column" flexShrink={0} marginTop={1}>
          <text fg={context.theme.text.default}>子代理树</text>
          <Content />
        </box>
      </Show> }),
      context.ui.slot({ append: "session.panel", render: panel => <Show when={panel.name === panelName}><Panel panel={panel} /></Show> }),
    ]
    return () => {
      controller.dispose()
      clearInterval(timer)
      context.ui.panel.close()
      for (const stop of slots.reverse()) stop()
    }
  },
})
