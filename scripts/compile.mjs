// 将插件源码预编译为 OpenTUI universal ESM；检查模式只比较产物，不改写文件。
import { readdir, readFile, mkdir, writeFile, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { transformAsync } from "@babel/core"
import typescript from "@babel/preset-typescript"
import solid from "babel-preset-solid"

const root = fileURLToPath(new URL("../", import.meta.url))
const source = path.join(root, "src")
const destination = path.join(root, "dist")
const args = process.argv.slice(2)
if (args.some(arg => arg !== "--check")) throw new Error("仅支持 --check 参数")
const checking = args.includes("--check")

async function files(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true, recursive: true })
    return entries.filter(entry => entry.isFile()).map(entry =>
      path.relative(directory, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"),
    ).sort()
  } catch (error) {
    if (error.code === "ENOENT") return []
    throw error
  }
}

const output = new Map()
for (const file of await files(source)) {
  if (!/\.tsx?$/.test(file) || file.endsWith(".d.ts")) continue
  const filename = path.join(source, file)
  const result = await transformAsync(await readFile(filename, "utf8"), {
    filename,
    configFile: false,
    babelrc: false,
    presets: [
      ...(file.endsWith(".tsx") ? [[solid, { moduleName: "@opentui/solid", generate: "universal" }]] : []),
      [typescript],
    ],
  })
  if (!result?.code) throw new Error(`编译没有输出：${file}`)
  // 不打包依赖；裸模块导入由宿主提供同一份 Solid/OpenTUI 运行时。
  output.set(file.replace(/\.tsx?$/, ".js"), `// 自动生成：npm run compile；请修改 src 中的源码。\n${result.code}\n`)
}
if (!output.has("tui.js")) throw new Error("缺少 src/tui.tsx 入口")

const existing = await files(destination)
if (checking) {
  const differences = []
  for (const [file, contents] of output) {
    if (!existing.includes(file) || await readFile(path.join(destination, file), "utf8") !== contents) differences.push(file)
  }
  for (const file of existing) if (!output.has(file)) differences.push(file)
  if (differences.length) throw new Error(`dist 已过期或包含多余文件，请运行 npm run compile：${differences.join(", ")}`)
  console.log(`构建新鲜度检查通过：${output.size} 个 ESM 文件`)
} else {
  // 仅在全部源码成功编译后替换项目自己的构建目录。
  await rm(destination, { recursive: true, force: true })
  for (const [file, contents] of output) {
    await mkdir(path.dirname(path.join(destination, file)), { recursive: true })
    await writeFile(path.join(destination, file), contents)
  }
  console.log(`已构建 dist：${output.size} 个 ESM 文件`)
}
