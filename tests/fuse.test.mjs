// dsh-fuse 冒烟测试（node:test，零依赖）
// 覆盖：validateFuseSpec 白名单校验 / 配置加载 / 主题令牌摘要 / 代码规范摘要
//      + 浏览器半区（client.js）jsdom 集成：steps 的 XSS 路径 / 节点预算 60 生效
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'
import { validateFuseSpec, FUSE_PAGE_KINDS, FUSE_COMPONENT_TYPES, FUSE_SECTION_TEXT, FUSE_SECTION_ORDER } from '../index.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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

test('context 产品上下文：合法对象通过，非法形态被拒绝', () => {
  const ok = { type: 'dashboard', context: { product: '网页', audience: '个人用户', task: '查看数据' }, components: [{ type: 'text', content: 'x' }] }
  assert.deepEqual(validateFuseSpec(ok), [])
  const bad = { type: 'dashboard', context: 'web', components: [{ type: 'text', content: 'x' }] }
  assert.ok(validateFuseSpec(bad).some((e) => e.includes('context')))
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
  const theme = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'theme.json'), 'utf8'))
  const style = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'code-style.json'), 'utf8'))
  assert.ok(theme.themes.default.colors.primary)
  assert.ok(theme.themes.apple && theme.themes.dark)
  assert.ok(theme.themes.default.spacing.sm === 8)
  assert.ok(theme.themes.default.typography.sizes.h1 === 36)
  assert.equal(style.naming.components, 'PascalCase')
  assert.equal(style.formatting.indentSize, 2)
})

test('theme.json：brand 段与 themes 令牌一致（单一事实来源不漂移）', () => {
  const theme = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'theme.json'), 'utf8'))
  const b = theme.brand.fuse
  assert.equal(b.primary, theme.themes.default.colors.primary, 'brand.fuse.primary ↔ default.primary')
  assert.equal(b.accent, theme.themes.default.colors.accent, 'brand.fuse.accent ↔ default.accent')
  assert.equal(b.darkPrimary, theme.themes.dark.colors.primary, 'brand.fuse.darkPrimary ↔ dark.primary')
  assert.equal(b.darkSecondary, theme.themes.dark.colors.accent, 'brand.fuse.darkSecondary ↔ dark.accent')
})

// ---------- 浏览器半区（client.js）：jsdom 集成（XSS 路径 / 节点预算） ----------
// client.js 是浏览器半区 bundle（__ModuleLoader__ 契约），这里用 jsdom + vm 载入真实源码、
// 走 DOM 渲染通道做行为验证（与 tests/test-client.mjs 同款手法，断言并入 node:test）

const CLIENT_SRC = path.join(__dirname, '..', 'client.js')
let clientEnv = null

async function loadClient() {
  if (clientEnv) return clientEnv
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://127.0.0.1:3080/',
    runScripts: 'outside-only',
  })
  const { window } = dom
  window.fetch = async () => ({ ok: false, status: 404 }) // 令牌 API 不可用 → :root 字面量兜底
  let mod = null
  window.__ModuleLoader__ = { load: ({ factory }) => { mod = factory(() => ({})) } }
  vm.runInContext(fs.readFileSync(CLIENT_SRC, 'utf8'), dom.getInternalVMContext())
  const ctx = {
    slots: { inject: () => () => {}, register: () => () => {} },
    sessions: { current: () => 'sess-test', scope: () => ({ get: () => ({ send: () => Promise.resolve() }) }) },
    effect: (fn) => fn(),
  }
  const dispose = mod.apply(ctx)
  clientEnv = { window, document: window.document, dispose }
  return clientEnv
}

/** 插入一个 dsh-fuse 围栏代码块（模拟对话流），返回其中的 pre */
function insertFence(document, raw) {
  const block = document.createElement('div')
  block.className = 'md-code-block'
  const header = document.createElement('div')
  header.className = 'md-code-block__header'
  const label = document.createElement('div')
  label.textContent = 'dsh-fuse'
  header.appendChild(label)
  const pre = document.createElement('pre')
  pre.textContent = raw
  block.append(header, pre)
  document.body.appendChild(block)
  return pre
}

const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms))

after(() => {
  // 释放插件（清 interval / observer / 定时器）并关闭 jsdom（清其内部 timer），避免测试进程被挂住
  if (clientEnv) { clientEnv.dispose(); clientEnv.window.close() }
})

test('steps 的 title/desc 走 textContent：fence 注入不生成元素、不执行', async () => {
  const { window, document } = await loadClient()
  const payload = '<img src=x onerror="window.__fuseXss=1">'
  insertFence(document, JSON.stringify({
    type: 'dashboard',
    title: '注入测试',
    theme: 'default',
    components: [{
      type: 'steps',
      current: 0,
      steps: [{ title: payload, desc: '</b><script>window.__fuseXss=2</script>' }],
    }],
  }))
  await tick()
  const row = document.querySelector('.fuse-steps')
  assert.ok(row, '步骤组件已渲染')
  assert.equal(row.querySelectorAll('img, script').length, 0, '不可信文本不得被解析成元素（innerHTML 路径）')
  assert.equal(row.querySelector('b').textContent, payload, 'title 必须原样作为文本')
  assert.equal(window.__fuseXss, undefined, '注入载荷不得执行')
})

test('节点预算 60（含嵌套容器）：宿主与渲染器一致报错并拒绝渲染', async () => {
  // 30 张卡片 × (卡片 + 3 子节点) = 120 节点，顶层仅 30 个 → 旧的「只数顶层」实现会误放行
  const spec = {
    type: 'form',
    components: Array.from({ length: 30 }, () => ({
      type: 'card',
      title: 'C',
      items: [
        { type: 'text', content: 'a' },
        { type: 'text', content: 'b' },
        { type: 'text', content: 'c' },
      ],
    })),
  }
  const hostErrs = validateFuseSpec(spec)
  assert.ok(hostErrs.some((e) => e.includes('60') && e.includes('上限')), `宿主应报节点预算错误：${JSON.stringify(hostErrs)}`)
  const { document } = await loadClient()
  insertFence(document, JSON.stringify(spec))
  await tick()
  const errs = [...document.querySelectorAll('.fuse-error')]
  assert.ok(errs.length > 0, '渲染器应给出错误提示')
  assert.ok(errs[errs.length - 1].textContent.includes('60'), errs[errs.length - 1].textContent)
  assert.equal(document.querySelectorAll('.fuse-card-box').length, 0, '超限规格不得渲染任何组件')
})

test('tabs 内的非法组件被宿主拒绝（与前端同构的递归校验）', () => {
  const bad = {
    type: 'dashboard',
    components: [{
      type: 'tabs',
      items: [
        { label: '概览', content: [{ type: 'text', content: 'ok' }] },
        { label: '详情', content: [{ type: 'magic-widget' }] },
      ],
    }],
  }
  const errs = validateFuseSpec(bad)
  assert.ok(errs.some((e) => e.includes('未知组件类型') && e.includes('magic-widget')), `宿主必须递归校验 tab 内容：${JSON.stringify(errs)}`)
  const ok = { type: 'dashboard', components: [{ type: 'tabs', items: [{ label: '概览', content: [{ type: 'stat', label: 'A', value: '1' }] }] }] }
  assert.deepEqual(validateFuseSpec(ok), [], '合法 tab 内容不得误报')
})

test('差分：宿主与渲染器对同一批规格的接受/拒绝判定完全一致', async () => {
  const { document } = await loadClient()
  const cases = [
    ['合法登录页', { type: 'login_form', components: [{ type: 'input', label: 'U' }, { type: 'button', text: 'go', action: 'go' }] }],
    ['未知页面类型', { type: 'spaceship', components: [{ type: 'text', content: 'x' }] }],
    ['未知组件类型', { type: 'form', components: [{ type: 'magic-widget' }] }],
    ['tab 内非法组件', { type: 'dashboard', components: [{ type: 'tabs', items: [{ label: 'A', content: [{ type: 'text', content: 'x' }] }, { label: 'B', content: [{ type: 'nope' }] }] }] }],
    ['合法 tab 内容', { type: 'dashboard', components: [{ type: 'tabs', items: [{ label: 'A', content: [{ type: 'stat', label: 'L', value: '1' }] }] }] }],
    ['嵌套超预算（12 行 × 5 子节点 = 72 > 60）', { type: 'form', components: Array.from({ length: 12 }, () => ({ type: 'row', items: Array.from({ length: 5 }, (_, i) => ({ type: 'text', content: String(i) })) })) }],
    ['容器缺 items', { type: 'form', components: [{ type: 'grid', cols: 2 }] }],
    ['非对象组件', { type: 'form', components: ['text'] }],
  ]
  for (const [name, spec] of cases) {
    const hostRejects = validateFuseSpec(spec).length > 0
    const before = document.querySelectorAll('.fuse-error').length
    insertFence(document, JSON.stringify(spec))
    await tick(60)
    const rendererRejects = document.querySelectorAll('.fuse-error').length > before
    assert.equal(rendererRejects, hostRejects, `${name}：宿主${hostRejects ? '拒绝' : '放行'} vs 渲染器${rendererRejects ? '拒绝' : '放行'}`)
  }
})
