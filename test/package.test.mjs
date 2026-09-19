// 验证实际发布包及其 node_modules 入口；宿主运行时显式 mock，不调用 setup 或真实服务。
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { before, test } from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"
import vm from "node:vm"

const root = fileURLToPath(new URL("../", import.meta.url))
let workspace, packedRoot, manifest, packedFiles, archive

before(() => {
  assert.ok(process.env.npm_execpath, "请通过 npm test 运行发布包验证")
  mkdirSync(path.join(root, ".script"), { recursive: true })
  workspace = mkdtempSync(path.join(root, ".script", "package-verification-"))
  // 独立消费者作用域避免 Node 把包名解析为仓库自身的 self-reference。
  writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ name: "artifact-consumer", private: true, type: "module" }))
  const [packed] = JSON.parse(execFileSync(process.execPath, [
    process.env.npm_execpath, "pack", "--ignore-scripts", "--json", "--pack-destination", workspace,
  ], { cwd: root, encoding: "utf8" }))
  archive = path.join(workspace, packed.filename)
  packedFiles = packed.files.map(file => file.path).sort()
  const local = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
  packedRoot = path.join(workspace, "node_modules", local.name)
  mkdirSync(packedRoot, { recursive: true })
  execFileSync("tar", ["-xf", archive, "-C", packedRoot, "--strip-components=1"], { cwd: root })
  manifest = JSON.parse(readFileSync(path.join(packedRoot, "package.json"), "utf8"))
})

test("实际 npm 包只包含预编译运行文件，根入口与 exports 一致", t => {
  const outputs = readdirSync(path.join(root, "dist"), { recursive: true })
    .filter(file => file.endsWith(".js")).map(file => `dist/${file.replaceAll("\\", "/")}`)
  assert.deepEqual(packedFiles, ["LICENSE", "README.md", "package.json", "tui.js", ...outputs].sort())
  assert.deepEqual(manifest.files, ["tui.js", "dist"])
  assert.equal(manifest.exports["./tui"], "./tui.js")
  assert.equal(manifest.scripts.prepare, undefined)
  assert.equal(manifest.scripts.postinstall, undefined)
  const require = createRequire(path.join(workspace, "consumer.cjs"))
  assert.equal(require.resolve(`${manifest.name}/tui`), path.join(packedRoot, "tui.js"))
  for (const file of packedFiles) {
    assert.equal(readFileSync(path.join(packedRoot, file), "utf8"), readFileSync(path.join(root, file), "utf8"))
    if (!file.endsWith(".js")) continue
    const code = readFileSync(path.join(packedRoot, file), "utf8")
    assert.doesNotMatch(code, /\breact\b|jsx-runtime|jsx-dev-runtime/i, file)
    // 原生 ESM 解析器拒绝原始 JSX/TypeScript；不是仅靠文本模式推断编译成功。
    const parsed = new vm.SourceTextModule(code)
    for (const specifier of parsed.dependencySpecifiers) {
      if (!specifier.startsWith(".")) continue
      const target = path.relative(packedRoot, path.resolve(packedRoot, path.dirname(file), specifier)).replaceAll("\\", "/")
      assert.ok(packedFiles.includes(target), `${file} 引用了未发布文件 ${specifier}`)
      assert.ok(target.endsWith(".js"), `运行时导入必须是 JS：${target}`)
    }
  }
  t.diagnostic(`已验证实际归档：${archive}；${packedFiles.length} 个文件`)
})

test("node_modules 中按 exports 链接并求值声明，共享 runtime 保持 external", async () => {
  const unexpected = () => { throw new Error("声明加载测试不得调用运行时函数或插件 setup") }
  const context = vm.createContext({ setTimeout: unexpected, setInterval: unexpected, fetch: unexpected })
  let definition, definitions = 0
  const exports = {
    "@opencode/plugin/tui": { Plugin: { define(value) { definitions++; definition = value; return value } } },
    "solid-js": Object.fromEntries(["createEffect", "createMemo", "createSignal", "For", "Show"].map(name => [name, unexpected])),
    "@opentui/solid": Object.fromEntries([
      "memo", "createTextNode", "insertNode", "createComponent", "effect", "insert", "setProp", "use", "createElement",
    ].map(name => [name, unexpected])),
    "string-width": { default: unexpected },
  }
  const mocks = new Map(Object.entries(exports).map(([specifier, values]) => [specifier,
    new vm.SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value)
    }, { context, identifier: specifier }),
  ]))
  const modules = new Map()
  const requested = new Set()
  const directory = pathToFileURL(`${packedRoot}${path.sep}`).href
  const load = url => {
    assert.ok(url.startsWith(directory), `导入越过发布包边界：${url}`)
    if (!modules.has(url)) modules.set(url, new vm.SourceTextModule(readFileSync(fileURLToPath(url), "utf8"), {
      context, identifier: url, importModuleDynamically: unexpected,
    }))
    return modules.get(url)
  }
  const entry = load(new URL(manifest.exports["./tui"], directory).href)
  await entry.link((specifier, parent) => {
    if (specifier.startsWith(".")) return load(new URL(specifier, parent.identifier).href)
    assert.ok(mocks.has(specifier), `未声明的 external 导入：${specifier}`)
    requested.add(specifier)
    return mocks.get(specifier)
  })
  await entry.evaluate({ timeout: 1000 })
  assert.deepEqual([...requested].sort(), Object.keys(exports).sort())
  assert.equal(definitions, 1)
  assert.equal(entry.namespace.default, definition)
  assert.equal(definition.id, "subagent-sidebar")
  assert.equal(typeof definition.setup, "function")
  assert.equal(modules.size, packedFiles.filter(file => file.endsWith(".js")).length)
})

test("构建检查拒绝陈旧或多余产物，重建结果可复现", () => {
  // 在隔离的项目内夹具中改动源码，不改动真实源码或已生成的 dist。
  const fixture = path.join(workspace, "freshness")
  mkdirSync(path.join(fixture, "scripts"), { recursive: true })
  mkdirSync(path.join(fixture, "src"))
  copyFileSync(path.join(root, "scripts", "build.mjs"), path.join(fixture, "scripts", "build.mjs"))
  const source = path.join(fixture, "src", "tui.tsx")
  writeFileSync(source, "export default () => <text>构建夹具</text>\n")
  const run = (...args) => spawnSync(process.execPath, [path.join(fixture, "scripts", "build.mjs"), ...args], { encoding: "utf8" })
  assert.equal(run("--check").status, 1)
  const built = run()
  assert.equal(built.status, 0, built.stderr)
  const output = path.join(fixture, "dist", "tui.js")
  const initial = readFileSync(output, "utf8")
  assert.equal(run().status, 0)
  assert.equal(readFileSync(output, "utf8"), initial)
  assert.equal(run("--check").status, 0)
  writeFileSync(source, "export default () => <text>源码已改变</text>\n")
  const stale = run("--check")
  assert.equal(stale.status, 1)
  assert.match(stale.stderr, /dist 已过期/)
  assert.equal(readFileSync(output, "utf8"), initial)
  assert.equal(run().status, 0)
  writeFileSync(path.join(fixture, "dist", "obsolete.js"), "export default 1\n")
  assert.equal(run("--check").status, 1)
  assert.equal(run().status, 0)
  assert.equal(run("--check").status, 0)
})
