// 自动生成：npm run compile；请修改 src 中的源码。
import { effect as _$effect } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { createMemo, createSignal, For } from "solid-js";
import { activeSubagents } from "./core/sidebar.js";
import { truncate } from "./core/format.js";
export default Plugin.define({
  id: "subagent-sidebar",
  setup(context) {
    function Sidebar(props) {
      // 在插槽组件内读取响应式 props 和宿主缓存，切换会话无需另建生命周期。
      const rows = createMemo(() => activeSubagents(context.data.session.list(), props.sessionID, id => context.data.session.status(id)));
      const [width, setWidth] = createSignal(30);
      let box;
      return (() => {
        var _el$ = _$createElement("box"),
          _el$2 = _$createElement("text");
        _$insertNode(_el$, _el$2);
        var _ref$ = box;
        typeof _ref$ === "function" ? _$use(_ref$, _el$) : box = _el$;
        _$setProp(_el$, "flexDirection", "column");
        _$setProp(_el$, "flexShrink", 0);
        _$setProp(_el$, "width", "100%");
        _$setProp(_el$, "marginTop", 1);
        _$setProp(_el$, "onSizeChange", () => setWidth(box?.width ?? 30));
        _$setProp(_el$2, "wrapMode", "none");
        _$insert(_el$2, () => truncate("子代理", width()));
        _$insert(_el$, _$createComponent(For, {
          get each() {
            return rows();
          },
          get fallback() {
            return (() => {
              var _el$3 = _$createElement("text");
              _$setProp(_el$3, "wrapMode", "none");
              _$insert(_el$3, () => truncate("暂无活动子代理", width()));
              _$effect(_$p => _$setProp(_el$3, "fg", context.theme.text.subdued, _$p));
              return _el$3;
            })();
          },
          children: row => (() => {
            var _el$4 = _$createElement("box"),
              _el$5 = _$createElement("text"),
              _el$6 = _$createElement("text");
            _$insertNode(_el$4, _el$5);
            _$insertNode(_el$4, _el$6);
            _$setProp(_el$4, "flexDirection", "column");
            _$setProp(_el$4, "flexShrink", 0);
            _$setProp(_el$4, "marginTop", 1);
            _$setProp(_el$5, "wrapMode", "none");
            _$insert(_el$5, () => truncate(`进行中 · ${row.agent}`, width()));
            _$setProp(_el$6, "wrapMode", "none");
            _$insert(_el$6, () => truncate(row.title, width()));
            _$effect(_p$ => {
              var _v$ = context.theme.text.default,
                _v$2 = context.theme.text.subdued;
              _v$ !== _p$.e && (_p$.e = _$setProp(_el$5, "fg", _v$, _p$.e));
              _v$2 !== _p$.t && (_p$.t = _$setProp(_el$6, "fg", _v$2, _p$.t));
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$4;
          })()
        }), null);
        _$effect(_$p => _$setProp(_el$2, "fg", context.theme.text.default, _$p));
        return _el$;
      })();
    }

    // 同步、重连与缓存由宿主负责；插件只注册一个只读边栏插槽。
    return context.ui.slot({
      after: "sidebar.content",
      render: props => _$createComponent(Sidebar, {
        get sessionID() {
          return props.sessionID;
        }
      })
    });
  }
});
