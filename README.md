# OpenCode 子代理树

面向 **OpenCode v2.0.8** 的独立、只读 TUI 插件。在主会话侧栏内容之后显示当前根会话的整棵子代理树；进入子会话后，可从命令面板手动打开同一棵树。

> 当前版本为 **0.1.3**，提供预编译的 JavaScript 入口，仅展示已确认活跃的子代理。0.1.2 已由用户确认在真实 TUI 成功加载并显示任务；本次活跃过滤和恢复行为通过自动化验证，**尚未完成真实 TUI 交互验收**。不承诺其他 OpenCode 版本兼容。项目按 [MIT 许可证](LICENSE) 开源。

## 使用方式

- **主会话**：显示在 `after: "sidebar.content"`，位置在侧栏内容之后，并非保证紧贴 MCP 区块。沿用宿主侧栏滚动。
- **子会话**：宿主隐藏侧栏。按 `Ctrl+P`，选择 **打开子代理树**。插件默认不设置打开快捷键，不自动打开面板。
- **面板**：宿主默认分栏，终端宽度不超过 80 列时强制全屏。关闭按钮、面板聚焦时的 `Escape`、命令面板 **关闭子代理树** 都可以关闭。
- **切换会话**：宿主关闭面板；在子会话中需要再次手动打开。同一树的编号和内部轮次保持一致。
- 任务内容只读，没有会话导航、取消或详情操作。确认没有可展示任务时，侧栏隐藏，插件仅关闭自己的面板。
- 加载中、读取失败和已知数据过期会显示提示。重新执行 **打开子代理树** 可手动重新读取。

示意：

```text
运行中 #01 检查客户端接口
explore · gpt-6-astra      1m23s
待授权 #03 ←#01 验证嵌套调用
general · gpt-6-astra         —
重试等待 #02 核对类型定义
explore · gpt-6-astra         42s
```

编号在本次树生命周期内稳定；`←#01` 表示父节点，即使该父节点已经结束并隐藏，活跃后代仍可显示。普通 child 仅在需要表达父级关系时拥有编号，不会因此作为任务显示。

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

**0.1.1 修复了包安装时原始 TSX 触发 `Cannot find package 'react'` 的问题。** OpenTUI 0.5.10 的 Solid 转换器排除 `node_modules`，而 Git 包安装在该目录中。发布提交已携带 `dist`，无需在用户机器上执行 `prepare` 或安装 React。若此前固定了 0.1.0 的完整 SHA，更新 `main` 不会改变旧安装，需将安装引用替换为已验证的修复提交，避免同时保留两份引用。

**0.1.2 移除了 Git 依赖准备安装的触发条件。** 0.1.1 的 `scripts.build` 会让 pacote 在 Git 包打包前另行启动 npm 安装，即使外层设置了 `ignoreScripts: true`；实际安装曾在此阶段报 `git dep preparation failed`。开发命令现为 `compile`，不保留 `build` 别名，也不声明准备/安装脚本或 workspaces。预编译产物、共享运行时与插件功能保持原方案。

**0.1.3 改为仅显示活跃项，并修复同步过期提示的恢复。** 成功、失败、普通中断立即移出列表；未知或尚未恢复的 shutdown 隐藏。局部读取失败只隐藏受影响子树，全量失败隐藏整树项；全部未解决范围成功校准后才清除提示。

### 本地开发与目录安装

开发环境使用 Node.js 22 和 npm 10。Node/Babel 在发布前将 TSX 编译为 OpenTUI universal JavaScript；宿主注入共享的 Solid/OpenTUI 运行时，无需独立 Bun。宿主的 Solid TSX 转换适用于其过滤器接受的工作区源码，不应依赖它编译安装到 `node_modules` 的包。

克隆仓库并安装依赖：

```powershell
git clone https://github.com/liantian-cn/opencode-subagent-sidebar.git
cd opencode-subagent-sidebar
npm ci
npm run compile
npm run check
npm test
```

依赖由 `package-lock.json` 锁定：`@opencode/plugin` / `@opencode/theme` 为 2.0.8，OpenTUI 为 0.5.10，Solid 为 1.9.12，TypeScript 为 5.8.2。构建工具直接锁定 `@babel/core@7.29.7`、`@babel/preset-typescript@7.27.1`、`babel-preset-solid@1.9.12`。不要强制跳过 peer 依赖检查。

根目录 `tui.js` 同时作为本地目录入口与 `exports["./tui"]` 的包入口，统一转发至 `dist/tui.js`。Babel 保留 `@opencode/plugin/tui`、`@opentui/solid`、`solid-js` 的裸模块导入，由宿主共享运行时解析；没有打包私有 Solid 副本。修改源码后需要重新运行 `npm run compile`。

#### 构建与发布包验证

- `npm run compile`：编译整个 `src`，生成确定性的 `dist/**/*.js`，不包含时间戳。
- `npm run compile:check`：在内存中重新编译，逐文件比较内容和文件集合；源码变更、缺失或多余产物均报错，不会自动改写产物。`npm test` 首先执行此检查。
- `npm test`：运行核心测试、真实 `npm pack --ignore-scripts` 归档检查，以及 Node VM mock 的模块链接/声明求值测试。打包测试需要系统 `tar`（Windows 自带、Linux/macOS 常用工具）；验证资料保存在忽略的 `.script/package-verification-*` 下。
- 包白名单只包含 `tui.js`、`dist`，以及 npm 默认包含的 `package.json`、README、LICENSE。源码、测试和构建工具留在仓库，不发布进安装包。

发布前运行 `npm run compile`、`npm run check`、`npm test`，将源码与最新 `dist` 一起提交，再固定该提交 SHA。项目不依赖安装时构建；直接执行 `npm pack` 也不会自动构建。发布包验证把实际归档解包到含 `node_modules` 的路径，按包 `exports` 解析入口，并验证全部相对导入、external 白名单及 `Plugin.define` 的声明形状。

Git 安装契约测试额外拒绝 manifest 中的 `postinstall`、`build`、`preinstall`、`install`、`prepack`、`prepare` 和 `workspaces`。它从 `@opencode/util` 的实际依赖解析已安装的 pacote，执行真实 GitFetcher 源码并 mock 网络、缓存目录及 npm 子进程：当前 manifest 不启动准备安装，含 `build` 或 workspaces 的正对照必须触发一次拦截。此测试不执行真实 `npm install --force`，也不等同于真实 GitHub 安装成功。

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
5. 在已有子代理会话中检查侧栏和手动面板。首次加载时仅显示确认正在运行或等待授权、输入、重试的任务。

这是 GitHub 安装的替代方式；不要同时配置 GitHub 引用和本地目录，否则可能重复加载。

## 活跃状态、计时和编号规则

- 一条记录对应一个 child 会话；只纳入有内置 `subagent` 工具关联证据的任务，根会话不展示。递归分页读取所有后代，并逐级读取祖先确定根。
- 摘要采用最新关联调用的 `description`，缺失时采用 child 标题。`metadata.sessionID` / `input.sessionID` 是 **2.0.8 的内置实现约定**，隔离在 `src/v208.ts`。
- 当前轮最新 assistant 的 agent/model 优先；当前轮尚无 assistant 时回退会话选择，缺失显示 `—`。模型显示短名。
- 列表只显示运行中、待授权、待输入、重试等待。成功、失败、普通中断立即隐藏；证据不足的未知状态不显示。当前运行证据优先于旧 outcome。
- 只有实际观察到 `session.execution.started.created` 才开始计时。首次打开已经运行的任务没有可靠起点，因此显示 `—`。不把会话创建、父工具返回或消息开始时间当作执行起点。
- 时长为一个 busy period 的墙钟时间，包括重试、权限和表单等待；steering 不重置，结束时间保留在内部，新一轮重置。`shutdown` 不代表终结，隐藏期间仍保留原起点，确认恢复后延续原轮次和墙钟。
- 活跃项按起点从早到晚排列，未知起点靠后，相同时间按 ID 稳定排序。已结束项不保留展示数量；内部节点、终态和事件序列水位保留，用于防止旧事件复活任务和维持后代关系。同一 child 再次运行使用原编号。
- 本次 TUI 内已访问的树分别保留编号和轮次，离开后继续轻量监听事件；父子导航不重建编号。使用宿主 `storage.memory`，无磁盘状态，TUI 退出即清空。同一内存 schema 的插件重载可复用；从旧历史展示版本升级时使用新 schema 内存键，重新读取活跃任务，不沿用旧实例方法，也不补造无法恢复的开始时间。

## 实现与验证

```text
tui.js                  本地目录及包共用入口
dist/                   随 Git 发布的预编译 ESM
scripts/compile.mjs     Node/Babel universal 编译及新鲜度检查
src/tui.tsx             常驻命令、侧栏与 session.panel
src/v208.ts             2.0.8 类型、公开 API、工具关联与事件适配
src/core/controller.ts  先订阅后快照、generation/abort、跨树生命周期
src/core/reader.ts      祖先补齐、递归分页、限并发读取
src/core/tree.ts        轮次、活跃投影、失效范围与稳定编号
src/core/order.ts       会话事件序列水位与有界去重
src/core/journal.ts     加载期间未知会话事件压缩与缓冲上限
src/core/format.ts      Unicode 字素/终端列宽截断与时长
test/                   node:test 核心测试与实际发布包验证
```

初始进入树、重新打开或 `server.connected` 时校准；工具关联事件按会话合并后补读。全部 HTTP 读取使用宿主 `context.client`，复用宿主 `context.data.listen` 事件流，不创建第二条 SSE。读取最多四个会话并发，不假设 `session.list` 会写入宿主缓存。权限与表单使用可取消的公开 API 快照，随后由宿主事件驱动更新；公开 pending getter 的签名也已核实。

局部失败按子树记录范围，其他已确认活跃项继续显示；全量失败、无法界定范围的运行状态读取失败或缓冲溢出隐藏整树项并保留提示。其他子树成功或新的 start/end/元数据事件不会自行清除失败；相应范围必须成功读取且通过版本竞争检查后才能恢复。全量失效需要完整校准，后续相关事件可合并触发校准，手动打开和重连也可恢复。所有未解决范围恢复后变为 ready；此时若没有活跃任务，自动隐藏区块并仅关闭自己持有的面板。

仍读取未展示节点的关联和祖先，避免遗漏活跃后代。只有结构正确、会话 ID 匹配的 `SessionNotFoundError` 才认定节点已删除，移除该分支并保留墓碑；裸 404、网络或权限错误不作为删除。根或当前所选会话不存在时显示错误，不能伪装成健康空树。

一秒定时器只更新本地时间，没有定时网络轮询。卸载清理插槽、组件所有的键盘层、事件、定时器及可取消请求。关闭面板始终调用所有权安全的 `context.ui.panel.close()`。

加载期间未归属的事件使用压缩缓冲，最多 4096 条；超限会明确中止本次同步并显示错误/过期，而不是静默丢弃事件后显示“同步成功”。已归属会话采用事件序列水位及有界近期去重，避免去重记录随累计运行轮次无限增长。

**验证边界**：类型检查和标准单元测试验证活跃投影、分页、事件竞争、失效范围恢复、删除边界、切换、Unicode 及清理。发布包检查确认 JavaScript 可解析、没有 React/JSX runtime 引用，且包内运行文件完整；发布包 Node VM 检查只链接并求值声明。另有隔离宿主桩测试调用 `setup` 验证内存 schema 和空面板关闭，不执行真实渲染或 API。自动化检查不能替代 Bun 的 loader 链或真实宿主行为。用户已确认 0.1.2 真实加载和任务显示；0.1.3 尚未另开 TUI 冒烟，终端字体的实际 emoji 宽度、面板焦点/滚动及完整恢复交互仍待验收。宿主公开插件接口没有即时断线状态，无法在所有断线发生的瞬间提示；重连/读取失败时进行校准和过期提示，不虚构网络状态。

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
- **Babel**：`@babel/core@7.28.0` 命中 [GHSA-4x5r-pxfx-6jf8](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8)，由 `@opentui/solid@0.5.10` 精确锁定，位于其嵌套依赖中。本项目新增的直接构建依赖使用不在该公告受影响范围内的 `@babel/core@7.29.7`；未强制覆盖宿主相关转换依赖。0.1.1 变更后再次执行上述生产依赖审计，条目数量和严重级别保持不变。
- `rimraf` 下的 `glob` 已在父依赖允许范围内从 `10.4.5` 更新至 `10.5.0`，不再命中本次审计报告的 [CLI 命令注入公告](https://github.com/advisories/GHSA-5j98-mcp5-4vw2)。其他 glob 副本也按各自兼容范围更新。旧 glob 主版本仍有上游弃用提示，不代表已获得长期维护保证。

这些是依赖版本命中公告的结果；尚未完成实际调用路径的可利用性验证，不能断言在本插件中可利用或不可利用。当前选择保持 OpenCode v2.0.8 兼容基线并公开披露，不使用 `--force` 或未经宿主验证的 overrides。此修复针对克隆仓库后 `npm ci` 的安装方式；不能据此承诺其他分发/安装路径具有相同依赖树。安全要求不允许这些告警时，请暂缓使用。
