import { test } from "node:test"
import assert from "node:assert/strict"
import stringWidth from "string-width"
import { clean, truncate } from "../src/core/format.js"

test("中文、组合字符与 emoji 按字素和终端列宽截断", () => {
  for (const sample of ["中文测试", "a👨‍👩‍👧‍👦b", "👩🏽‍💻研发", "e\u0301组合", "🇨🇳旗帜", "a\n\tb"]) {
    for (let width = 0; width < 40; width++) assert.ok(stringWidth(truncate(sample, width)) <= width)
  }
  assert.equal(truncate("a👨‍👩‍👧‍👦bc", 4), "a👨‍👩‍👧‍👦…")
  assert.equal(truncate("e\u0301组合", 2), "e\u0301…")
})

test("窄边栏与完整可用宽度不溢出", () => {
  assert.equal(truncate("子代理", 0), "")
  assert.equal(truncate("子代理", -1), "")
  assert.equal(truncate("子代理", 1), "…")
  assert.equal(truncate("子代理", 6), "子代理")
  assert.equal(truncate("暂无活动子代理", 4.9), "暂…")
  assert.equal(truncate("", 0), "")
})

test("会话标题中的控制字符和换行不能破坏边栏布局", () => {
  assert.equal(clean("  检查\n\t接口\u0000\u007f  "), "检查 接口")
  assert.equal(truncate("  检查\n接口  ", 30), "检查 接口")
  assert.doesNotMatch(truncate("\u001b[31m标题\u009b\r\n", 30), /[\u0000-\u001f\u007f-\u009f]/)
})
