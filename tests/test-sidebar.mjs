// ============================================================================
// test-sidebar.mjs — dsh-fuse 侧边栏入口 + UI 工作台面板测试
// 运行: node tests\test-sidebar.mjs
// 验证: sidebar.footer.action 注册 / wide+rail 按钮 / 点击弹面板 / 代码规范区 / 关闭
// ============================================================================
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { createRoot } from 'react-dom/client'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_SRC = path.join(__dirname, '..', 'client.js')
let failures = 0
function check(label, cond, extra = '') {
  if (cond) { console.log('  ok   ' + label) }
  else { failures++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')) }
}
const tick = () => new Promise((r) => setTimeout(r, 50))

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true, url: 'http://127.0.0.1:3080/', runScripts: 'outside-only' })
const { window } = dom
const { document } = window
globalThis.window = window
globalThis.document = document
Object.defineProperty(globalThis, 'navigator', { value: { languages: ['zh-CN'], language: 'zh-CN' }, configurable: true })
globalThis.HTMLElement = window.HTMLElement
globalThis.Node = window.Node
globalThis.getComputedStyle = window.getComputedStyle
window.React = React
window.requestAnimationFrame = (cb) => setTimeout(cb, 0)
window.cancelAnimationFrame = (id) => clearTimeout(id)
window.fetch = async () => ({ ok: false, json: async () => ({}) })

// primitives mock
const Mock = (tag) => ({ variant, size, icon, children, ...rest }) => React.createElement(tag, rest, children)
const primMock = {
  Button: Mock('button'),
  Input: Mock('input'),
  StateDot: () => React.createElement('span'),
  IconSearchOutline16: () => React.createElement('span', null, '🔍'),
  IconTrashOutline16: () => React.createElement('span', null, '🗑'),
  IconRefreshOutline14: () => React.createElement('span', null, '🔄'),
  IconCheckOutline16: () => React.createElement('span', null, '✓'),
  IconWarningOutline16: () => React.createElement('span', null, '⚠'),
  IconThinkOutline14: () => React.createElement('span', null, '🧠'),
  IconSettingsOutline16: () => React.createElement('span', null, '⚙'),
  IconLinkOutline14: () => React.createElement('span', null, '🔗'),
  IconBrowseOutline16: () => React.createElement('span', null, '📚'),
}

// 捕获注册
const registered = []
let moduleExports = null
window.__ModuleLoader__ = {
  load: ({ id, factory }) => {
    const capturedRequire = (name) => {
      if (name === 'react') return React
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return primMock
      return {}
    }
    const fakeCtx = {
      slots: {
        inject: (name, cb) => {
          const result = cb()
          return () => {}
        },
        register: (def, comp) => {
          registered.push({ def, comp })
          return { component: comp, def }
        },
      },
      sessions: {
        current: () => 'sess-1',
        scope: () => ({ get: () => ({ send: () => Promise.resolve() }) }),
      },
      effect: (fn) => fn(),
    }
    const ex = factory(capturedRequire)
    moduleExports = ex
    ex.apply(fakeCtx)
  },
}
vm.runInContext(readFileSync(CLIENT_SRC, 'utf8'), dom.getInternalVMContext())
await tick()

console.log('\n[1] 侧边栏入口注册')
{
  const footer = registered.find((r) => r.def?.name === 'sidebar.footer.action')
  check('sidebar.footer.action 已注册', !!footer, JSON.stringify(registered.map((r) => r.def?.name)))
  check('id = fuse-sidebar', footer?.def?.id === 'fuse-sidebar')
  check('order=-1（排在当日费用 order=0 上面）', footer?.def?.order === -1, String(footer?.def?.order))
  const settings = registered.find((r) => r.def?.name === 'settings.section')
  check('设置页注册保留', !!settings)
  const rail = registered.find((r) => r.def?.name === 'sidebar.footer.action')?.comp
  check('组件可渲染', typeof rail === 'function')
}

console.log('\n[2] wide 行按钮渲染')
{
  const SidebarBtn = registered.find((r) => r.def?.name === 'sidebar.footer.action')?.comp
  const appRoot = createRoot(document.getElementById('app'))
  appRoot.render(React.createElement(SidebarBtn, { wide: true }))
  await tick()
  const btn = document.querySelector('.fuse-sidebar-btn')
  check('wide 按钮渲染', !!btn)
  check('文案「UI 工作台」', !!btn && btn.textContent.includes('UI 工作台'), btn && btn.textContent)
  appRoot.unmount()
}

console.log('\n[3] rail 小圆框渲染')
{
  const SidebarBtn = registered.find((r) => r.def?.name === 'sidebar.footer.action')?.comp
  const appRoot = createRoot(document.getElementById('app'))
  appRoot.render(React.createElement(SidebarBtn, { wide: false }))
  await tick()
  const rail = document.querySelector('.fuse-sidebar-rail')
  check('rail 小圆框渲染', !!rail)
  check('小圆框带图标', !!rail && rail.textContent.length > 0)
  appRoot.unmount()
}

console.log('\n[4] 点击打开 UI 工作台面板')
{
  const SidebarBtn = registered.find((r) => r.def?.name === 'sidebar.footer.action')?.comp
  const appRoot = createRoot(document.getElementById('app'))
  appRoot.render(React.createElement(SidebarBtn, { wide: true }))
  await tick()
  const btn = document.querySelector('.fuse-sidebar-btn')
  btn.click()
  await tick()
  const mask = document.querySelector('.fuse-panel-mask')
  check('面板浮层出现', !!mask)
  const panel = document.querySelector('.fuse-panel')
  check('面板容器', !!panel)
  const head = document.querySelector('.fuse-panel-head .t')
  check('面板标题「UI 工作台」', !!head && head.textContent === 'UI 工作台', head && head.textContent)
  const title = document.querySelector('.fuse-panel-body .fuse-title')
  check('示例页面标题', !!title && title.textContent.includes('记忆工作台'), title && title.textContent)
  const stats = [...document.querySelectorAll('.fuse-panel-body .fuse-stat .v')].map((s) => s.textContent)
  check('示例状态卡（151/15/512维/26）', stats.includes('151') && stats.includes('15') && stats.includes('26'), stats.join(','))
  const close = document.querySelector('.fuse-panel-head .x')
  check('✕ 关闭按钮', !!close)
  close.click()
  await tick()
  check('点击 ✕ 面板关闭', !document.querySelector('.fuse-panel-mask'))
  appRoot.unmount()
}

console.log('\n[5] 面板无代码区块（无代码功能，不硬加）')
{
  const SidebarBtn = registered.find((r) => r.def?.name === 'sidebar.footer.action')?.comp
  const appRoot = createRoot(document.getElementById('app'))
  appRoot.render(React.createElement(SidebarBtn, { wide: true }))
  await tick()
  document.querySelector('.fuse-sidebar-btn').click()
  await tick()
  const codeTitle = [...document.querySelectorAll('.fuse-panel-body .fuse-title')].find((t) => t.textContent.includes('代码规范'))
  check('无「代码规范」区块（用户确认不加）', !codeTitle)
  const tip = document.querySelector('.fuse-panel-tip')
  check('提示文案存在', !!tip)
  appRoot.unmount()
}

console.log(failures === 0 ? '\n✅ 侧边栏测试全部通过' : `\n❌ ${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
