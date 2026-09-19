# OpenCode 子代理树

面向 **OpenCode v2.0.8** 的独立、只读 TUI 插件。在主会话侧栏内容之后显示当前根会话的整棵子代理树；进入子会话后，可从命令面板手动打开同一棵树。

> 当前为初始开发版本：类型检查与单元测试已通过，**尚未完成真实 TUI 加载及交互验证**。不承诺其他 OpenCode 版本兼容。项目按 [MIT 许可证](LICENSE) 开源。

## 使用方式

- **主会话**：显示在 `after: "sidebar.content"`，位置在侧栏内容之后，并非保证紧贴 MCP 区块。沿用宿主侧栏滚动。
- **子会话**：宿主隐藏侧栏。按 `Ctrl+P`，选择 **打开子代理树**。插件默认不设置打开快捷键，不自动打开面板。
- **面板**：宿主默认分栏，终端宽度不超过 80 列时强制全屏。关闭按钮、面板聚焦时的 `Escape`、命令面板 **关闭子代理树** 都可以关闭。
- **切换会话**：宿主关闭面板；在子会话中需要再次手动打开。同一树的编号和本次历史保持一致。
- 任务内容只读，没有会话导航、取消或详情操作。确认没有可展示任务时，侧栏隐藏，插件仅关闭自己的面板。
- 加载中、读取失败和已知数据过期会显示提示。重新执行 **打开子代理树** 可手动重新读取。

示意：

```text
运行中 #01 检查客户端接口
explore · gpt-6-astra      1m23s
待授权 #03 ←#01 验证嵌套调用
general · gpt-6-astra         —
成功 #02 整理类型定义
explore · gpt-6-astra         42s
```

编号在本次树生命周期内稳定；`←#01` 表示父节点，即使该父节点已不在最近三条历史中。普通 child 仅在需要表达父级关系时拥有编号，不会因此作为任务显示。

## 安装

### 从 GitHub 安装到全局配置

先备份全局 `cli.json`（通常位于 `~/.config/opencode/cli.json`），保留已有插件和其他设置，然后执行：

```powershell
opencode plugin add github:liantian-cn/opencode-subagent-sidebar
```

OpenCode v2.0.8 会识别本包只有 `./tui` 入口，自动更新全局 **CLI** 插件配置；无需 `--global`、`--cli` 或 `--tui`，也不应将本插件加到服务端配置中。

为保证源码版本可复现，建议固定已检查的完整提交 SHA：

```powershell
opencode plugin add "github:liantian-cn/opencode-subagent-sidebar#<完整40位提交SHA>"
```

请用实际提交替换占位符，只选择以上一种安装引用，不要重复添加。完整 SHA 固定源码，但**不锁定间接依赖**。不带 SHA 的重复 `add` 可能复用缓存，不能当作自动升级命令。

**配置修改可能让正在运行的 TUI 立即热加载插件**，不保证等到重开才生效。`plugin add` 本身不启动或重启共享服务，不发送提示词；加载后的插件会进行只读会话查询。不要将 `plugin list/check/update` 当作无副作用验证入口，它们可能触发服务发现或启动。

GitHub 安装在 OpenCode 自己的 npm 缓存 generation 中重新解析依赖，不使用本仓库 `package-lock.json` 作为安装根锁文件，且安装器默认关闭 audit。应对实际安装 generation 的锁文件检查依赖和审计，不能直接沿用文末本地 `npm ci` 的审计结果。可通过该命令进程的 `npm_config_registry` 环境变量指定 registry，无需修改全局 npm 配置。

### 本地开发与目录安装

开发环境使用 Node.js 22 和 npm 10。宿主负责 TSX 编译以及 Solid/OpenTUI 运行时注入，无需安装 Bun 或额外打包。

克隆仓库并安装依赖：

```powershell
git clone https://github.com/liantian-cn/opencode-subagent-sidebar.git
cd opencode-subagent-sidebar
npm ci
npm run check
npm test
```

依赖由 `package-lock.json` 锁定：`@opencode/plugin` / `@opencode/theme` 为 2.0.8，OpenTUI 为 0.5.10，Solid 为 1.9.12，TypeScript 为 5.8.2。不要强制跳过 peer 依赖检查。根目录 `tui.tsx` 是本地目录加载入口；`exports["./tui"]` 同时声明包入口。没有打包私有 Solid 副本。

#### 将本地目录加入全局 CLI 配置

1. 找到全局配置文件：通常为 `%USERPROFILE%\.config\opencode\cli.json`；若设置 `XDG_CONFIG_HOME`，则为 `$XDG_CONFIG_HOME/opencode/cli.json`。没有项目级 `cli.json`。
2. 先复制该文件作为备份，例如 `cli.json.before-subagent-sidebar.bak`。若已有同名备份，请使用新名称。
3. 保留所有原有字段及插件条目，只向顶层 `plugins` 数组追加本地目录 URL：

```json
{
  "plugins": [
    "file:///C:/Projects/opencode-subagent-sidebar"
  ]
}
```

把示例 URL 换成你实际克隆目录的绝对 `file:` URL（示例并非固定安装位置），引用目录而非单个 TSX 文件。上例仅展示应合并的字段，不要用它覆盖整个文件，也不要写入服务端 `opencode.json(c)`。

4. 重新打开 **TUI 客户端**加载插件。不要为安装此插件重启共享后台服务。应使用与现有服务兼容的 v2.0.8 客户端和既有连接方式；普通 `opencode` 启动在版本不匹配时可能替换共享服务，因此实施阶段没有代为启动它。
5. 在已有子代理会话中检查侧栏和手动面板。首次加载时只显示运行中/未确认项，不恢复此前已经结束的任务。

这是 GitHub 安装的替代方式；不要同时配置 GitHub 引用和本地目录，否则可能重复加载。

## 状态、计时和历史规则

- 一条记录对应一个 child 会话；只纳入有内置 `subagent` 工具关联证据的任务，根会话不展示。递归分页读取所有后代，并逐级读取祖先确定根。
- 摘要采用最新关联调用的 `description`，缺失时采用 child 标题。`metadata.sessionID` / `input.sessionID` 是 **2.0.8 的内置实现约定**，隔离在 `src/v208.ts`。
- 当前轮最新 assistant 的 agent/model 优先；当前轮尚无 assistant 时回退会话选择，缺失显示 `—`。模型显示短名。
- 状态包括运行中、待授权、待输入、重试等待、成功、失败、中断，以及证据不足时的未确认。运行状态优先于旧 outcome。
- 只有实际观察到 `session.execution.started.created` 才开始计时。首次打开已经运行的任务没有可靠起点，因此显示 `—`。不把会话创建、父工具返回或消息开始时间当作执行起点。
- 时长为一个 busy period 的墙钟时间，包括重试、权限和表单等待；steering 不重置，结束后冻结，新一轮重置。`shutdown` 不代表终结，恢复延续原轮次。
- 所有运行中及未确认未结束项保留；按起点从早到晚排列，未知起点靠后，相同时间按 ID 稳定排序。整棵树仅展示最近三个已结束任务，按结束时间倒序。
- 历史仅属于本次 TUI 内访问过的树；首次快照中的旧 outcome 不进入历史。离开树后继续轻量监听结束事件。父子导航不重建历史。使用宿主 `storage.memory` 保留本次 TUI 内存历史，插件热重载后可复用；无磁盘历史，TUI 退出即清空。

## 实现与验证

```text
tui.tsx                 本地目录入口
src/tui.tsx             常驻命令、侧栏与 session.panel
src/v208.ts             2.0.8 类型、公开 API、工具关联与事件适配
src/core/controller.ts  先订阅后快照、generation/abort、跨树生命周期
src/core/reader.ts      祖先补齐、递归分页、限并发读取
src/core/tree.ts        轮次、状态、编号、排序与内存历史
src/core/order.ts       会话事件序列水位与有界去重
src/core/journal.ts     加载期间未知会话事件压缩与缓冲上限
src/core/format.ts      Unicode 字素/终端列宽截断与时长
test/                   node:test 旁路测试，不依赖真实服务
```

初始进入树、重新打开或 `server.connected` 时校准；工具关联事件按会话合并后补读。全部 HTTP 读取使用宿主 `context.client`，复用宿主 `context.data.listen` 事件流，不创建第二条 SSE。读取最多四个会话并发，不假设 `session.list` 会写入宿主缓存。权限与表单使用可取消的公开 API 快照，随后由宿主事件驱动更新；公开 pending getter 的签名也已核实。

一秒定时器只更新本地时间，没有定时网络轮询。卸载清理插槽、组件所有的键盘层、事件、定时器及可取消请求。关闭面板始终调用所有权安全的 `context.ui.panel.close()`。

加载期间未归属的事件使用压缩缓冲，最多 4096 条；超限会明确中止本次同步并显示错误/过期，而不是静默丢弃事件后显示“同步成功”。已归属会话采用事件序列水位及有界近期去重，避免去重记录随累计运行轮次无限增长。

**验证边界**：类型检查和标准单元测试可以验证投影、分页、事件竞争、历史边界、切换、Unicode 及清理，但尚未运行真实 TUI 冒烟测试。终端字体的实际 emoji 宽度、面板焦点/滚动和全局本地加载仍需在用户选择的安全 TUI 环境验证。宿主公开插件接口没有即时断线状态，无法在所有断线发生的瞬间提示；重连/读取失败时进行校准和过期提示，不虚构网络状态。

### 卸载与回滚

1. GitHub 安装使用 `opencode plugin remove "<安装时使用的完整 spec>"`，例如 `opencode plugin remove github:liantian-cn/opencode-subagent-sidebar`；固定 SHA 时也要带上相同的 `#SHA`。本地目录安装则从全局 `cli.json` 的 `plugins` 数组删除对应 URL，保留其他条目。
2. 配置变化可能即时卸载插件；必要时重新打开 TUI 客户端，无需重启共享服务。
3. 如果要恢复配置，先比较备份与现有文件，避免覆盖安装之后的其他修改。
4. 确认移除引用后，可自行删除本地工程目录。GitHub 安装的 remove 只移除配置，不清理下载缓存；不要为卸载清空共享缓存或删除服务数据库。本插件不写入磁盘任务历史。

## 接口核查来源

- [V2 插件总览](https://opencode.ai/v2/docs/build/plugins)
- [V2 CLI 插件开发](https://opencode.ai/v2/docs/build/plugins/cli)
- [V2 CLI 插件加载](https://opencode.ai/v2/docs/cli/plugins)
- [V2 CLI 配置](https://opencode.ai/v2/docs/cli/config)
- [`@opencode/plugin@2.0.8` TUI 类型](https://unpkg.com/@opencode/plugin@2.0.8/dist/tui/context.d.ts)
- [`@opencode/client@2.0.8` 类型](https://unpkg.com/@opencode/client@2.0.8/dist/promise/generated/types.d.ts)
- [v2.0.8 内置 subagent](https://github.com/anomalyco/opencode/blob/v2.0.8/packages/core/src/tool/plugin/subagent.ts)
- [v2.0.8 执行生命周期](https://github.com/anomalyco/opencode/blob/v2.0.8/packages/core/src/session/execution.ts)
- [v2.0.8 宿主响应式数据](https://github.com/anomalyco/opencode/blob/v2.0.8/packages/client/src/solid/data.ts)
- [v2.0.8 侧栏布局](https://github.com/anomalyco/opencode/blob/v2.0.8/packages/tui/src/routes/session/sidebar.tsx)

官方在线文档可能随新版本更新；实现以已安装的 2.0.8 类型和同版本源码为准。例如真实主题字段为 `theme.text.default`，并非当前文档示例的 `theme.text.base`。

## 许可证

[MIT](LICENSE)，Copyright (c) 2026 liantian-cn。

## 已知依赖安全告警

2026-09-19 使用官方 npm registry 对本仓库锁定依赖执行：

```powershell
npm audit --omit=dev --registry=https://registry.npmjs.org
```

结果仍有 **13 个受影响包条目：11 个中危、2 个低危，0 个高危/严重**。包条目包含传播影响，并非 13 个不同漏洞；该命令仍会以非零状态退出，**不能视为审计通过**。

- **OpenTelemetry**：`@opentelemetry/core@2.6.1` 命中 [GHSA-8988-4f7v-96qf](https://github.com/advisories/GHSA-8988-4f7v-96qf)。相关 SDK/exporter 被 `@opencode/util@2.0.8` 精确锁定；本版本未强制覆盖其配套依赖。
- **Babel**：`@babel/core@7.28.0` 命中 [GHSA-4x5r-pxfx-6jf8](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8)，由 `@opentui/solid@0.5.10` 精确锁定。本版本未强制覆盖宿主相关转换依赖。
- `rimraf` 下的 `glob` 已在父依赖允许范围内从 `10.4.5` 更新至 `10.5.0`，不再命中本次审计报告的 [CLI 命令注入公告](https://github.com/advisories/GHSA-5j98-mcp5-4vw2)。其他 glob 副本也按各自兼容范围更新。旧 glob 主版本仍有上游弃用提示，不代表已获得长期维护保证。

这些是依赖版本命中公告的结果；尚未完成实际调用路径的可利用性验证，不能断言在本插件中可利用或不可利用。当前选择保持 OpenCode v2.0.8 兼容基线并公开披露，不使用 `--force` 或未经宿主验证的 overrides。此修复针对克隆仓库后 `npm ci` 的安装方式；不能据此承诺其他分发/安装路径具有相同依赖树。安全要求不允许这些告警时，请暂缓使用。
