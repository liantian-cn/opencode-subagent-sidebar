# OpenCode 子代理侧栏

面向 **OpenCode v2.0.8** 的只读 TUI 插件。在官方侧栏显示当前会话正在进行中的直接子会话，复用官方 **↓ Subagent picker** 的宿主 `context.data` 缓存与候选语义。

> 本文描述**当前工作区重构，尚未发布，也尚未完成真实 TUI 验收**。包版本暂保留 **0.1.4**，不代表已发布的同版本包含此设计；历史版本的测试或用户验收不能作为本次重构的验证结果。不承诺其他 OpenCode 版本兼容。项目按 [MIT 许可证](LICENSE) 开源。

## 使用方式

- **官方侧栏**：通过 `sidebar.content` 插槽显示，沿用宿主的布局与滚动；侧栏是否可见由宿主决定。
- **当前会话**：以插槽的响应式 `props.sessionID` 为准，切换后展示新会话的直接 child，不追溯根会话或递归显示后代。
- **显示内容**：agent、会话标题和“进行中”；不显示模型、时长或编号。等待授权、输入或重试，只要宿主仍将其标为 `running`，也统一显示“进行中”。
- **空状态**：保留“子代理”标题，显示“暂无活动子代理”。
- **只读展示**：没有跳转或控制操作。重构移除独立面板和“打开/关闭子代理树”命令。
- **子会话**：宿主没有侧栏时，使用官方 **↓ Subagent picker**。

示意：

```text
子代理
进行中 · Explore
检查客户端接口
进行中 · General
核对类型定义
```

没有匹配项时：

```text
子代理
暂无活动子代理
```

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

**配置修改可能让正在运行的 TUI 立即热加载插件**，不保证等到重开才生效。`plugin add` 本身不启动或重启共享服务，不发送提示词；本次重构的插件加载后只读取宿主缓存。不要将 `plugin list/check/update` 当作无副作用验证入口，它们可能触发服务发现或启动。

GitHub 安装在 OpenCode 自己的 npm 缓存 generation 中重新解析依赖，不使用本仓库 `package-lock.json` 作为安装根锁文件，且安装器默认关闭 audit。应对实际安装 generation 的锁文件检查依赖和审计，不能直接沿用文末本地 `npm ci` 的审计结果。可通过该命令进程的 `npm_config_registry` 环境变量指定 registry，无需修改全局 npm 配置。

安装包使用随 Git 提交的预编译 `dist`，无需在用户机器上执行 `prepare` 或安装 React。OpenTUI 0.5.10 的 Solid 转换器排除 `node_modules`，因此不能把原始 TSX 当作 Git 安装入口。

开发命令使用 `compile`，**不保留 `build` 别名，也不声明准备/安装脚本或 workspaces**：这些字段可能让 pacote 在 Git 打包前另行启动依赖准备安装，即使外层设置了 `ignoreScripts: true`。

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
- `npm test`：清理旧 `.test-build` 后，运行侧栏派生、文本截断、Solid 响应式组件测试，以及现有发布包和 Git 安装契约测试。真实 `npm pack --ignore-scripts` 归档检查需要系统 `tar`（Windows 自带、Linux/macOS 常用工具）；验证资料保存在忽略的 `.script/package-verification-*` 下。
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
5. 在当前会话的官方侧栏检查直接 child 的“进行中”列表及空状态；子会话中宿主没有侧栏时使用官方 **↓ Subagent picker**。

这是 GitHub 安装的替代方式；不要同时配置 GitHub 引用和本地目录，否则可能重复加载。

## 数据与状态语义

侧栏从 `context.data.session.list()` 读取宿主缓存，只保留同时满足以下条件的会话：

1. `session.parentID === props.sessionID`，即当前会话的直接 child。
2. `context.data.session.status(session.id) === "running"`。

agent 与标题来自会话缓存，标题是 session title，不读取工具调用的 description 或消息内容。长文本按 Unicode 字素和终端列宽截断。

这一筛选遵循官方 Subagent picker 的候选语义，**不证明会话由 `subagent` 工具创建**；具有相同父会话且正在进行中的普通 fork 也可能入列。孙级及更深的后代不在当前列表中。

宿主缓存的 `idle` 包含未加载的情形，不能解释为成功完成。空状态仅表示缓存中没有符合筛选条件的会话，也不证明所有任务已完成。

同步与重连由宿主负责。插件不读取消息、不发送额外 HTTP 请求、不轮询，也不维护独立事件状态机、历史任务状态或快照恢复流程；不调用额外同步来补全候选。显示随宿主响应式缓存更新，不保证独立识别断线、缓存过期或同步健康状况。

## 实现与验证

```text
tui.js                  本地目录及包共用入口
dist/                   随 Git 发布的预编译 ESM
scripts/compile.mjs     Node/Babel universal 编译及新鲜度检查
src/tui.tsx             官方侧栏插槽与 Solid 响应式展示
src/core/sidebar.ts     当前会话直接 child 的纯派生筛选
src/core/format.ts      Unicode 字素/终端列宽截断
test/sidebar.test.ts    侧栏候选与状态筛选
test/format.test.ts     文本截断
test/tui-sidebar.test.mjs  真实 Solid 响应式与 renderer stub
test/                   现有 package / git-package 契约测试
```

上表为本次工作区重构的结构。`tui-sidebar.test.mjs` 使用真实 Solid 响应式运行时和 renderer stub 验证组件更新，不启动真实 TUI。现有 package 测试检查归档、入口及 Node VM 模块链接/声明求值，git-package 测试检查 Git 依赖准备安装契约。

**本次工作区验证（2026-09-19）**：`npm run compile`、`npm run check`、`npm test` 和 `git diff --check` 均通过，18 项测试通过。组件测试使用真实 Solid 响应式运行时与内存 renderer 宿主，并禁止额外宿主 API、定时器和网络访问。

**验证边界**：自动化检查不能替代真实 OpenCode 的 loader、终端布局、字体宽度和宿主同步行为验收。本次重构尚未发布，真实 TUI 验收待完成；没有修改全局配置或重启服务。

### 真实 TUI 验收清单

在兼容的现有 TUI 中加载本地改动后，检查以下行为；这些操作需由使用者在适合的测试会话中完成，不属于上述自动化测试：

- 当前会话已有活动子代理时，无需先按 `↓`，边栏就能展示；与官方 picker 对比当前会话的**直接**活动子会话，不要求包含其孙级或兄弟分支。
- 宿主将任务标为 `idle` 后，它从边栏移除；后台委派工具返回但子会话仍为 `running` 时，条目继续显示。
- 全部活动项消失后，仍显示“子代理 / 暂无活动子代理”。切换主会话时，不残留上一个会话的条目。
- 缩窄再放宽侧栏，中文、长标题和 emoji 不越界；不出现插件自己的打开/关闭树命令、独立面板或重新打开提示。
- 同步与恢复表现跟随官方缓存，不把空列表当作连接健康或全部成功完成的证明。

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
- [v2.0.8 宿主响应式数据](https://github.com/anomalyco/opencode/blob/v2.0.8/packages/client/src/solid/data.ts)
- [v2.0.8 官方 Subagent picker](https://github.com/anomalyco/opencode/blob/v2.0.8/packages/tui/src/routes/session/composer/subagents-tab.tsx)
- [v2.0.8 侧栏布局](https://github.com/anomalyco/opencode/blob/v2.0.8/packages/tui/src/routes/session/sidebar.tsx)

官方在线文档可能随新版本更新；实现以已安装的 2.0.8 类型和同版本源码为准。例如真实主题字段为 `theme.text.default`，并非当前文档示例的 `theme.text.base`。

## 许可证

[MIT](LICENSE)，Copyright (c) 2026 liantian-cn。

## 已知依赖安全告警

以下为 **2026-09-19 的历史审计记录，本次 README 重构未重新执行审计**。当时使用官方 npm registry 对本仓库锁定依赖执行：

```powershell
npm audit --omit=dev --registry=https://registry.npmjs.org
```

当时结果为 **13 个受影响包条目：11 个中危、2 个低危，0 个高危/严重**。包条目包含传播影响，并非 13 个不同漏洞；该次命令以非零状态退出，**不能视为审计通过**。

- **OpenTelemetry**：`@opentelemetry/core@2.6.1` 命中 [GHSA-8988-4f7v-96qf](https://github.com/advisories/GHSA-8988-4f7v-96qf)。相关 SDK/exporter 被 `@opencode/util@2.0.8` 精确锁定；本版本未强制覆盖其配套依赖。
- **Babel**：`@babel/core@7.28.0` 命中 [GHSA-4x5r-pxfx-6jf8](https://github.com/advisories/GHSA-4x5r-pxfx-6jf8)，由 `@opentui/solid@0.5.10` 精确锁定，位于其嵌套依赖中。本项目直接构建依赖使用不在该公告受影响范围内的 `@babel/core@7.29.7`；未强制覆盖宿主相关转换依赖。
- `rimraf` 下的 `glob` 已在父依赖允许范围内从 `10.4.5` 更新至 `10.5.0`，在该次审计中不再命中 [CLI 命令注入公告](https://github.com/advisories/GHSA-5j98-mcp5-4vw2)。其他 glob 副本也按各自兼容范围更新。旧 glob 主版本仍有上游弃用提示，不代表已获得长期维护保证。

这些是依赖版本命中公告的结果；尚未完成实际调用路径的可利用性验证，不能断言在本插件中可利用或不可利用。当前选择保持 OpenCode v2.0.8 兼容基线并公开披露，不使用 `--force` 或未经宿主验证的 overrides。上述历史依赖调整及审计针对克隆仓库后 `npm ci` 的安装方式；不能据此承诺其他分发/安装路径具有相同依赖树。安全要求不允许这些告警时，请暂缓使用。
