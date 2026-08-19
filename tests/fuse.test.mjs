// dsh-fuse 冒烟测试（node:test，零依赖）
// 覆盖：validateFuseSpec 白名单校验 / 配置加载 / 主题令牌摘要 / 代码规范摘要
import test from 'node:test'
import assert from 'node:assert/strict'
import { validateFuseSpec, FUSE_PAGE_KINDS, FUSE_COMPONENT_TYPES, FUSE_SECTION_TEXT, FUSE_SECTION_ORDER } from '../index.mjs'

// ---------- validateFuseSpec ----------

test('合法登录页规格通过', () => {
  const spec = {
    type: 'login_form',
    title: '登录',
    theme: 'default',
    components: [
      { type: 'input', label: '用户名' },
      { type: 'input', label: '密码', inputType: 'password' },
      { type: 'button', text: '登录', style: 'primary', action: 'login' },
    ],
  }
  assert.deepEqual(validateFuseSpec(spec), [])
})

test('未知页面类型被拒绝', () => {
  const spec = { type: 'spaceship', components: [] }
  const errs = validateFuseSpec(spec)
  assert.ok(errs.some((e) => e.includes('未知页面类型')))
})

test('未知组件类型被拒绝', () => {
  const spec = { type: 'form', components: [{ type: 'magic-widget' }] }
  const errs = validateFuseSpec(spec)
  assert.ok(errs.some((e) => e.includes('未知组件类型')))
})

test('未知主题被拒绝', () => {
  const spec = { type: 'form', theme: 'neon-rainbow', components: [{ type: 'text', content: 'x' }] }
  const errs = validateFuseSpec(spec)
  assert.ok(errs.some((e) => e.includes('未知主题')))
})

test('components 缺失/为空被拒绝', () => {
  assert.ok(validateFuseSpec({ type: 'form' }).some((e) => e.includes('components')))
  assert.ok(validateFuseSpec({ type: 'form', components: [] }).some((e) => e.includes('不能为空')))
})

test('嵌套超过 8 层被拒绝', () => {
  const deep = { type: 'text', content: 'x' }
  let node = deep
  for (let i = 0; i < 10; i++) node = { type: 'card', items: [node] }
  const spec = { type: 'form', components: [node] }
  const errs = validateFuseSpec(spec)
  assert.ok(errs.some((e) => e.includes('嵌套')))
})

test('容器组件带 items 递归校验', () => {
  const spec = {
    type: 'dashboard',
    components: [
      { type: 'grid', cols: 2, items: [{ type: 'stat', label: 'A', value: '1' }] },
      { type: 'card', title: 'C', items: [{ type: 'badge', label: 'ok' }] },
    ],
  }
  assert.deepEqual(validateFuseSpec(spec), [])
})

test('容器组件缺 items 被拒绝', () => {
  const spec = { type: 'form', components: [{ type: 'grid', cols: 2 }] }
  const errs = validateFuseSpec(spec)
  assert.ok(errs.some((e) => e.includes('需要 items')))
})

test('非对象规格被拒绝', () => {
  assert.ok(validateFuseSpec(null).length > 0)
  assert.ok(validateFuseSpec('login').length > 0)
  assert.ok(validateFuseSpec([1, 2]).length > 0)
})

test('节点预算：60 组件上限', () => {
  const comps = Array.from({ length: 61 }, (_, i) => ({ type: 'text', content: String(i) }))
  const errs = validateFuseSpec({ type: 'form', components: comps })
  assert.ok(errs.some((e) => e.includes('60')))
})

// ---------- 常量与配置摘要 ----------

test('页面类型与组件词汇非空且互斥合理', () => {
  assert.ok(FUSE_PAGE_KINDS.length >= 10)
  assert.ok(FUSE_COMPONENT_TYPES.length >= 20)
  assert.ok(FUSE_PAGE_KINDS.includes('login_form'))
  assert.ok(FUSE_COMPONENT_TYPES.includes('button'))
})

test('系统指令段包含 fence 语法与令牌摘要', () => {
  assert.equal(FUSE_SECTION_ORDER, 106)
  assert.ok(FUSE_SECTION_TEXT.includes('dsh-fuse'))
  assert.ok(FUSE_SECTION_TEXT.includes('login_form'))
  assert.ok(FUSE_SECTION_TEXT.includes('theme.json'))
  assert.ok(FUSE_SECTION_TEXT.includes('code-style.json'))
  assert.ok(FUSE_SECTION_TEXT.includes('2563EB')) // default 主题主色
})

test('配置文件可读且结构完整', async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const theme = JSON.parse(fs.readFileSync(path.join(dir, '..', 'config', 'theme.json'), 'utf8'))
  const style = JSON.parse(fs.readFileSync(path.join(dir, '..', 'config', 'code-style.json'), 'utf8'))
  assert.ok(theme.themes.default.colors.primary)
  assert.ok(theme.themes.apple && theme.themes.dark)
  assert.ok(theme.themes.default.spacing.sm === 8)
  assert.ok(theme.themes.default.typography.sizes.h1 === 36)
  assert.equal(style.naming.components, 'PascalCase')
  assert.equal(style.formatting.indentSize, 2)
})
