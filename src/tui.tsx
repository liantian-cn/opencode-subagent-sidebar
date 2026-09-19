import { Plugin } from "@opencode/plugin/tui"
import type { BoxRenderable } from "@opentui/core"
import { createMemo, createSignal, For } from "solid-js"
import { activeSubagents } from "./core/sidebar.js"
import { truncate } from "./core/format.js"

export default Plugin.define({
  id: "subagent-sidebar",
  setup(context) {
    function Sidebar(props: { sessionID: string }) {
      // 在插槽组件内读取响应式 props 和宿主缓存，切换会话无需另建生命周期。
      const rows = createMemo(() => activeSubagents(
        context.data.session.list(), props.sessionID, id => context.data.session.status(id),
      ))
      const [width, setWidth] = createSignal(30)
      let box: BoxRenderable | undefined
      return <box ref={box} flexDirection="column" flexShrink={0} width="100%" marginTop={1}
        onSizeChange={() => setWidth(box?.width ?? 30)}>
        <text fg={context.theme.text.default} wrapMode="none">{truncate("子代理", width())}</text>
        <For each={rows()} fallback={<text fg={context.theme.text.subdued} wrapMode="none">
          {truncate("暂无活动子代理", width())}
        </text>}>{row => <box flexDirection="column" flexShrink={0} marginTop={1}>
          <text fg={context.theme.text.default} wrapMode="none">{truncate(`进行中 · ${row.agent}`, width())}</text>
          <text fg={context.theme.text.subdued} wrapMode="none">{truncate(row.title, width())}</text>
        </box>}</For>
      </box>
    }

    // 同步、重连与缓存由宿主负责；插件只注册一个只读边栏插槽。
    return context.ui.slot({ after: "sidebar.content", render: props => <Sidebar sessionID={props.sessionID} /> })
  },
})
