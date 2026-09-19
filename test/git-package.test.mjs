// 宿主依赖契约测试：执行其真实 GitFetcher 分支，拦截网络、缓存和 npm，不安装或写临时文件。
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { test } from "node:test"
import vm from "node:vm"

// 只解析路径，不加载 OpenCode 服务；选择 @opencode/util 实际依赖的 pacote。
const utilRequire = createRequire(import.meta.resolve("@opencode/util/npm"))
const entry = utilRequire.resolve("pacote/lib/git.js")
const pacoteRequire = createRequire(entry)
const symbols = pacoteRequire("./util/protected.js")
const { Minipass } = pacoteRequire("minipass")
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))

test("发布 manifest 拒绝 Git 准备安装的六个脚本与 workspaces", () => {
  for (const name of ["postinstall", "build", "preinstall", "install", "prepack", "prepare"]) {
    assert.equal(Object.hasOwn(manifest.scripts, name), false, `禁止触发 Git 准备安装：${name}`)
  }
  assert.equal(Object.hasOwn(manifest, "workspaces"), false)
})

test("真实 GitFetcher：当前 manifest 不启动 npm，build 与 workspaces 正对照触发拦截", async t => {
  const calls = []
  let archives = 0
  const unexpected = () => { throw new Error("GitFetcher 契约测试禁止真实网络、文件准备或子进程") }
  class Remote {
    extract() { return Promise.resolve() }
  }
  class Directory {
    [symbols.tarballFromResolved]() {
      archives++
      const stream = new Minipass()
      queueMicrotask(() => stream.end("mock-archive"))
      return stream
    }
  }
  const replacements = {
    cacache: { tmp: { withTmp: (_cache, _options, callback) => callback("virtual-git-directory") } },
    "@npmcli/git": { clone: unexpected, revs: unexpected, errors: { GitPathspecError: class extends Error {} } },
    "proc-log": { log: { warn: unexpected, info: unexpected } },
    "./remote.js": Remote,
    "./dir.js": Directory,
    "./file.js": class { manifest() { return unexpected() } },
    "./util/npm.js": (bin, args) => { calls.push({ bin, args }); return Promise.resolve() },
  }
  const allowed = new Set([
    "npm-package-arg", "npm-pick-manifest", "minipass", "./fetcher.js", "./util/protected.js", "./util/add-git-sha.js",
  ])
  const module = { exports: {} }
  vm.runInNewContext(readFileSync(entry, "utf8"), {
    module,
    require(name) {
      if (Object.hasOwn(replacements, name)) return replacements[name]
      assert.ok(allowed.has(name), `未隔离的 GitFetcher 依赖：${name}`)
      return pacoteRequire(name)
    },
    process: { env: {} },
  }, { filename: entry, timeout: 1000 })

  for (const [name, input, expected] of [
    ["当前发布 manifest", manifest, 0],
    ["build 正对照", { ...manifest, scripts: { ...manifest.scripts, build: "必须被拦截，不能执行" } }, 1],
    ["workspaces 正对照", { ...manifest, workspaces: [] }, 1],
  ]) {
    calls.length = 0
    const fetcher = new module.exports(`github:liantian-cn/opencode-subagent-sidebar#${"a".repeat(40)}`, {
      ignoreScripts: true,
      Arborist: class {},
      cache: "virtual-cache/_cacache",
      npmBin: "virtual-npm-cli.js",
    })
    // 覆盖 manifest 读取点，使真实私有 #prepareDir 使用内存夹具而非文件系统。
    fetcher[symbols.readPackageJson] = async () => input
    await fetcher[symbols.tarballFromResolved]().concat()
    assert.equal(calls.length, expected, name)
    if (expected) {
      assert.equal(calls[0].bin, "virtual-npm-cli.js")
      assert.equal(calls[0].args[0], "install")
    }
    t.diagnostic(`${name}：ignoreScripts=true，npm 调用拦截数 ${calls.length}`)
  }
  assert.equal(archives, 3, "所有夹具必须经过真实 GitFetcher 归档分支")
})
