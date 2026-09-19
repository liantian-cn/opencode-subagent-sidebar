// 自动生成：npm run compile；请修改 src 中的源码。
import { memo as _$memo } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { use as _$use } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { Plugin } from "@opencode/plugin/tui";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Controller } from "./core/controller.js";
import { lines, truncate } from "./core/format.js";
import { source208 } from "./v208.js";
const panelName = "subagent-sidebar.tree";
export default Plugin.define({
  id: "subagent-sidebar",
  setup(context) {
    const [revision, setRevision] = createSignal(0);
    const [memory] = context.storage.memory("trees", {
      initial: {
        trees: new Map()
      }
    });
    const controller = new Controller(source208(context), () => setRevision(value => value + 1), Date.now, memory.trees);
    const [now, setNow] = createSignal(Date.now());
    // 只刷新本地时长，不进行网络轮询。
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const state = () => {
      revision();
      return controller.state;
    };
    const tree = () => {
      revision();
      return controller.current;
    };
    const rows = createMemo(() => tree()?.rows() ?? []);
    const notice = () => state() === "loading" ? "正在加载子代理树…" : state() === "error" ? "加载失败；请重新打开子代理树" : state() === "stale" ? "数据可能过期；请重新打开刷新" : undefined;
    function Content(props) {
      const [measured, setMeasured] = createSignal(30);
      let box;
      const width = () => Math.max(0, props.width ?? measured());
      return (() => {
        var _el$ = _$createElement("box");
        var _ref$ = box;
        typeof _ref$ === "function" ? _$use(_ref$, _el$) : box = _el$;
        _$setProp(_el$, "flexDirection", "column");
        _$setProp(_el$, "flexShrink", 0);
        _$setProp(_el$, "width", "100%");
        _$setProp(_el$, "onSizeChange", () => setMeasured(box?.width ?? 30));
        _$insert(_el$, _$createComponent(Show, {
          get when() {
            return notice();
          },
          get children() {
            var _el$2 = _$createElement("text");
            _$setProp(_el$2, "wrapMode", "none");
            _$insert(_el$2, () => truncate(notice(), width()));
            _$effect(_$p => _$setProp(_el$2, "fg", context.theme.text.default, _$p));
            return _el$2;
          }
        }), null);
        _$insert(_el$, _$createComponent(For, {
          get each() {
            return rows();
          },
          children: row => {
            const display = createMemo(() => lines(row, width(), now()));
            return (() => {
              var _el$3 = _$createElement("box"),
                _el$4 = _$createElement("text"),
                _el$5 = _$createElement("text");
              _$insertNode(_el$3, _el$4);
              _$insertNode(_el$3, _el$5);
              _$setProp(_el$3, "flexDirection", "column");
              _$setProp(_el$3, "flexShrink", 0);
              _$setProp(_el$3, "marginBottom", 1);
              _$setProp(_el$4, "wrapMode", "none");
              _$insert(_el$4, () => display()[0]);
              _$setProp(_el$5, "wrapMode", "none");
              _$insert(_el$5, () => display()[1]);
              _$effect(_p$ => {
                var _v$ = context.theme.text.default,
                  _v$2 = context.theme.text.subdued;
                _v$ !== _p$.e && (_p$.e = _$setProp(_el$4, "fg", _v$, _p$.e));
                _v$2 !== _p$.t && (_p$.t = _$setProp(_el$5, "fg", _v$2, _p$.t));
                return _p$;
              }, {
                e: undefined,
                t: undefined
              });
              return _el$3;
            })();
          }
        }), null);
        return _el$;
      })();
    }
    function Panel(props) {
      context.keymap.layer(() => ({
        enabled: () => props.panel.focused,
        commands: [{
          id: "subagent-sidebar.escape",
          bind: "escape",
          run: () => context.ui.panel.close()
        }]
      }));
      return (() => {
        var _el$6 = _$createElement("box"),
          _el$7 = _$createElement("box"),
          _el$8 = _$createElement("text"),
          _el$0 = _$createElement("text"),
          _el$10 = _$createElement("scrollbox");
        _$insertNode(_el$6, _el$7);
        _$insertNode(_el$6, _el$10);
        _$setProp(_el$6, "height", "100%");
        _$setProp(_el$6, "width", "100%");
        _$setProp(_el$6, "flexDirection", "column");
        _$setProp(_el$6, "onMouseDown", () => props.panel.focus());
        _$insertNode(_el$7, _el$8);
        _$insertNode(_el$7, _el$0);
        _$setProp(_el$7, "flexDirection", "row");
        _$setProp(_el$7, "flexShrink", 0);
        _$setProp(_el$7, "justifyContent", "space-between");
        _$insertNode(_el$8, _$createTextNode(`子代理树`));
        _$insertNode(_el$0, _$createTextNode(`[关闭]`));
        _$setProp(_el$0, "onMouseUp", () => context.ui.panel.close());
        _$setProp(_el$10, "flexGrow", 1);
        _$setProp(_el$10, "minHeight", 0);
        _$setProp(_el$10, "horizontalScrollbarOptions", {
          visible: false
        });
        _$insert(_el$10, _$createComponent(Content, {
          get width() {
            return Math.max(0, props.panel.width - 2);
          }
        }));
        _$effect(_p$ => {
          var _v$3 = context.theme.text.default,
            _v$4 = context.theme.text.default;
          _v$3 !== _p$.e && (_p$.e = _$setProp(_el$8, "fg", _v$3, _p$.e));
          _v$4 !== _p$.t && (_p$.t = _$setProp(_el$0, "fg", _v$4, _p$.t));
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$6;
      })();
    }
    const slots = [context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [{
            id: "subagent-sidebar.open",
            title: "打开子代理树",
            group: "子代理树",
            palette: true,
            enabled: () => context.ui.router.current().type === "session",
            run: () => {
              context.ui.panel.open(panelName);
              void controller.refresh();
            }
          }, {
            id: "subagent-sidebar.close",
            title: "关闭子代理树",
            group: "子代理树",
            palette: true,
            enabled: () => context.ui.panel.current()?.name === panelName,
            run: () => context.ui.panel.close()
          }]
        }));
        createEffect(() => {
          const route = context.ui.router.current();
          void controller.select(route.type === "session" ? route.sessionID : undefined);
        });
        createEffect(() => {
          const current = context.ui.panel.current();
          if (current?.name === panelName && state() === "ready" && rows().length === 0) context.ui.panel.close();
        });
        return null;
      }
    }), context.ui.slot({
      after: "sidebar.content",
      render: () => _$createComponent(Show, {
        get when() {
          return notice() || rows().length > 0;
        },
        get children() {
          var _el$11 = _$createElement("box"),
            _el$12 = _$createElement("text");
          _$insertNode(_el$11, _el$12);
          _$setProp(_el$11, "flexDirection", "column");
          _$setProp(_el$11, "flexShrink", 0);
          _$setProp(_el$11, "marginTop", 1);
          _$insertNode(_el$12, _$createTextNode(`子代理树`));
          _$insert(_el$11, _$createComponent(Content, {}), null);
          _$effect(_$p => _$setProp(_el$12, "fg", context.theme.text.default, _$p));
          return _el$11;
        }
      })
    }), context.ui.slot({
      append: "session.panel",
      render: panel => _$createComponent(Show, {
        get when() {
          return panel.name === panelName;
        },
        get children() {
          return _$createComponent(Panel, {
            panel: panel
          });
        }
      })
    })];
    return () => {
      controller.dispose();
      clearInterval(timer);
      context.ui.panel.close();
      for (const stop of slots.reverse()) stop();
    };
  }
});
