// ============================================================================
// dsh-fuse · 令牌漂移守卫：theme.json ↔ 浏览器半区 CSS 兜底值
//
// 背景（自审发现，属「宣称与实现不符」）：config/theme.json 自称设计令牌的
// **单一事实来源**，但 lib/client.js 的 FS_TOKENS_CSS 里把同一批值又硬编码了一份
// （改 theme.json 不会影响前端，改 client.js 也不会回写 theme.json）。
// 根治办法是构建时生成；在那之前，这个用例把「两份必须一致」变成会失败的门槛——
// 任何一边单独改动，npm test 立即报错并指出是哪一条令牌。
//
// 覆盖：壳令牌（浅色 = themes.default / 深色 = themes.dark）+ 品牌色（brand.fuse）
//       + 圆角 / 间距 / 字号阶梯 / 行高。
// 不覆盖：派生值（color-mix / rgba soft / 阴影 / 渐变）与走查高亮色（它们由基色派生或有独立语义）。
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const theme = JSON.parse(fs.readFileSync(path.join(root, 'config', 'theme.json'), 'utf-8'))
const clientSrc = fs.readFileSync(path.join(root, 'lib', 'client.js'), 'utf-8')

const src = clientSrc.match(/const FS_TOKENS_CSS = `([\s\S]*?)`;/)
assert.ok(src, 'lib/client.js 里找不到 FS_TOKENS_CSS 模板（改过结构就必须同步更新本用例）')
const css = src[1]

function blockOf(selector) {
  const at = css.indexOf(selector)
  assert.ok(at >= 0, `FS_TOKENS_CSS 里找不到 ${selector} 块`)
  const open = css.indexOf('{', at)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}
function varsOf(text) {
  const out = {}
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*--([a-z0-9-]+)\s*:\s*([^;]+);/i)
    if (m) out[m[1].toLowerCase()] = m[2].trim()
  }
  return out
}

const light = varsOf(blockOf(':root'))
const dark = varsOf(blockOf('html[data-dsh-theme="dark"]'))

const L = theme.themes.default
const D = theme.themes.dark
const F = theme.brand.fuse
const px = (n) => `${n}px`

const LIGHT_EXPECT = {
  'fs-shell-bg': L.colors.neutralBg,
  'fs-shell-surface': L.colors.neutralSurface,
  'fs-shell-text': L.colors.neutralText,
  'fs-shell-muted': L.colors.neutralTextMuted,
  'fs-shell-border': L.colors.border,
  'fs-shell-primary': L.colors.primary,
  'fs-shell-secondary': F.secondary,
  'fs-shell-accent': L.colors.accent,
  'fs-shell-success': L.feedback.success,
  'fs-shell-warning': L.feedback.warning,
  'fs-shell-error': L.feedback.error,
  'fs-primary': L.colors.primary,
  'fs-accent': L.colors.accent,
  'fs-bg': L.colors.neutralBg,
  'fs-surface': L.colors.neutralSurface,
  'fs-text': L.colors.neutralText,
  'fs-muted': L.colors.neutralTextMuted,
  'fs-border': L.colors.border,
  'fs-success': L.feedback.success,
  'fs-warning': L.feedback.warning,
  'fs-error': L.feedback.error,
  'fs-radius-sm': px(L.radius.sm),
  'fs-radius-md': px(L.radius.md),
  'fs-radius-lg': px(L.radius.lg),
  'fs-space-xs': px(L.spacing.xs),
  'fs-space-sm': px(L.spacing.sm),
  'fs-space-md': px(L.spacing.md),
  'fs-space-lg': px(L.spacing.lg),
  'fs-space-xl': px(L.spacing.xl),
  'fs-fs-caption': px(L.typography.sizes.caption),
  'fs-fs-body': px(L.typography.sizes.body),
  'fs-fs-bodylg': px(L.typography.sizes.bodyLg),
  'fs-fs-h3': px(L.typography.sizes.h3),
  'fs-fs-h2': px(L.typography.sizes.h2),
  'fs-fs-h1': px(L.typography.sizes.h1),
  'fs-fs-display': px(L.typography.sizes.display),
  'fs-lh-body': String(L.typography.lineHeights.body),
  'fs-lh-heading': String(L.typography.lineHeights.heading),
}

const DARK_EXPECT = {
  'fs-shell-bg': D.colors.neutralBg,
  'fs-shell-surface': D.colors.neutralSurface,
  'fs-shell-text': D.colors.neutralText,
  'fs-shell-muted': D.colors.neutralTextMuted,
  'fs-shell-border': D.colors.border,
  'fs-shell-primary': D.colors.primary,
  'fs-shell-secondary': F.darkSecondary,
  'fs-shell-accent': D.colors.accent,
  'fs-shell-success': D.feedback.success,
  'fs-shell-warning': D.feedback.warning,
  'fs-shell-error': D.feedback.error,
}

const norm = (v) => String(v).trim().toUpperCase()

test('浅色壳令牌与 theme.json（themes.default + brand.fuse）逐条一致', () => {
  const bad = []
  for (const [key, expect] of Object.entries(LIGHT_EXPECT)) {
    if (light[key] === undefined) { bad.push(`client 缺少 --${key}`); continue }
    if (norm(light[key]) !== norm(expect)) bad.push(`--${key}: client=${light[key]} ≠ theme.json=${expect}`)
  }
  assert.equal(bad.length, 0, `令牌漂移（theme.json 是单一事实来源，client.js 的兜底值必须跟它一致）：\n${bad.join('\n')}`)
})

test('深色壳令牌与 theme.json（themes.dark + brand.fuse.dark*）逐条一致', () => {
  const bad = []
  for (const [key, expect] of Object.entries(DARK_EXPECT)) {
    if (dark[key] === undefined) { bad.push(`client 缺少 --${key}`); continue }
    if (norm(dark[key]) !== norm(expect)) bad.push(`--${key}: client=${dark[key]} ≠ theme.json=${expect}`)
  }
  assert.equal(bad.length, 0, `深色令牌漂移：\n${bad.join('\n')}`)
})
