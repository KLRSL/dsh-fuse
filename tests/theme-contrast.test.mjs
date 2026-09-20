// ============================================================================
// dsh-fuse · 设计令牌对比度守卫（WCAG 2.1）
//
// 背景（市场对比后的自查项）：dsh-theme-studio 等同类插件带「对比度守卫」，
// 而我们的 theme.json 只是数值集合，没有任何校验——改一个色值可能让正文在某个主题下
// 变得不可读，且**没有任何地方会报错**。这个用例把可读性变成可回归的门槛。
//
// 阈值依据 WCAG 2.1：
//   - 正文文本（neutralText / neutralTextMuted 当正文用）→ ≥ 4.5:1
//   - 大号文本与 UI 组件边界（primary / feedback 作为强调与状态色）→ ≥ 3:1
//   - 非文本分隔线（border）→ ≥ 1.15:1（只因"看不见的边框"是低级错误；apple HIG 的 hairline 本身就约 1.2 级）。⚠️ 已知缺口：本项目没有独立的 borderStrong 令牌，
//     若把 border 用作输入框/焦点环这类**功能性边界**，WCAG 1.4.11 要求 ≥3:1——待补令牌后单独加检查。
// 品牌色按同样的口径检查（浅色主题的品牌色要能在白底上当文字用，
// 深色主题的 dark* 变体要能在深底上用）。
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const THEME = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'theme.json'), 'utf-8'))

function parseColor(c) {
  const s = String(c).trim()
  const hex = s.match(/^#([0-9a-f]{6})$/i)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const rgba = s.match(/^rgba?\(([^)]+)\)$/i)
  if (rgba) {
    const p = rgba[1].split(',').map((x) => Number(x.trim()))
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }
  }
  return null
}

/** 把带 alpha 的颜色合成到给定背景上（border 用了 rgba，必须先合成才能算对比度） */
function flatten(fg, bg) {
  if (!fg) return null
  if (fg.a >= 1) return fg
  return {
    r: Math.round(fg.r * fg.a + bg.r * (1 - fg.a)),
    g: Math.round(fg.g * fg.a + bg.g * (1 - fg.a)),
    b: Math.round(fg.b * fg.a + bg.b * (1 - fg.a)),
    a: 1,
  }
}

function luminance({ r, g, b }) {
  const f = (v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

const RATIOS = []
function check(label, fgRaw, bgRaw, min) {
  const bg = parseColor(bgRaw)
  const fg = flatten(parseColor(fgRaw), bg)
  assert.ok(bg && fg, `${label}: 颜色无法解析（fg=${fgRaw} bg=${bgRaw}）`)
  const ratio = contrast(fg, bg)
  RATIOS.push({ label, ratio, min })
  assert.ok(
    ratio >= min,
    `${label} 对比度不足：${ratio.toFixed(2)}:1 < ${min}:1（fg=${fgRaw} on bg=${bgRaw}）——按 WCAG 这会让该主题下的文本/组件不可读`
  )
}

test('theme.json 三个主题的文本可读性达标（WCAG：正文 ≥4.5，强调/状态 ≥3）', () => {
  for (const [name, theme] of Object.entries(THEME.themes)) {
    const c = theme.colors
    const f = theme.feedback
    check(`${name}/正文 on 背景`, c.neutralText, c.neutralBg, 4.5)
    check(`${name}/正文 on 面板`, c.neutralText, c.neutralSurface, 4.5)
    check(`${name}/弱化正文 on 背景`, c.neutralTextMuted, c.neutralBg, 4.5)
    check(`${name}/弱化正文 on 面板`, c.neutralTextMuted, c.neutralSurface, 4.5)
    check(`${name}/主色 on 背景`, c.primary, c.neutralBg, 3)
    check(`${name}/强调色 on 背景`, c.accent, c.neutralBg, 3)
    check(`${name}/success on 背景`, f.success, c.neutralBg, 3)
    check(`${name}/warning on 背景`, f.warning, c.neutralBg, 3)
    check(`${name}/error on 背景`, f.error, c.neutralBg, 3)
    check(`${name}/分隔线可见 on 背景`, c.border, c.neutralBg, 1.15) // 装饰性分隔线；功能性边界（输入框/焦点环）需 3:1，见下方「待补 borderStrong」说明
  }
})

test('品牌色在对应主题底色上可用（浅色用 primary，深色用 darkPrimary）', () => {
  const light = THEME.themes.default.colors
  const dark = THEME.themes.dark.colors
  for (const [plugin, colors] of Object.entries(THEME.brand)) {
    if (plugin.startsWith('$')) continue
    check(`brand/${plugin} primary（浅底）`, colors.primary, light.neutralBg, 3)
    check(`brand/${plugin} darkPrimary（深底）`, colors.darkPrimary, dark.neutralBg, 3)
    check(`brand/${plugin} secondary（浅底）`, colors.secondary, light.neutralBg, 3)
    check(`brand/${plugin} darkSecondary（深底）`, colors.darkSecondary, dark.neutralBg, 3)
  }
})

test('打印全部对比度实测值（便于人工复核与调色）', () => {
  const lines = RATIOS.map((r) => `${r.ratio.toFixed(2)}:1 (min ${r.min})  ${r.label}`)
  console.log(`\n[对比度实测 ${RATIOS.length} 项]\n${lines.join('\n')}\n`)
  assert.ok(RATIOS.length > 0)
})
