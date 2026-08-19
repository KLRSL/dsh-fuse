// ============================================================================
// test-board.mjs — dsh-fuse 画板 dock 测试（输入框上方，宽度与输入框对齐）
// 运行: node tests\test-board.mjs
// 验证: composer.dock 注册 / 不再注册 sidebar.footer.action / 画板内容 /
//       宽度 100%（与输入框对齐）/ 样式注入
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

const Mock = (tag) => ({ variant, size, icon, children, ...rest }) => React.createElement(tag, rest, children)
const primMock = {
  Button: Mock('button'), Input: Mock('input'), StateDot: () => React.createElement('span'),
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
        inject: (name, cb) => { cb(); return () => {} },
        register: (def, comp) => { registered.push({ def, comp }); return { component: comp, def } },
      },
      sessions: { current: () => 'sess-1', scope: () => ({ get: () => ({ send: () => Promise.resolve() }) }) },
      effect: (fn) => fn(),
    }
    const ex = factory(capturedRequire)
    moduleExports = ex
    ex.apply(fakeCtx)
  },
}
vm.runInContext(readFileSync(CLIENT_SRC, 'utf8'), dom.getInternalVMContext())
await tick()

console.log('\n[1] 注册检查')
{
  const dock = registered.find((r) => r.def?.name === 'conversation.composer.dock')
  check('composer.dock 已注册（输入框上方）', !!dock, JSON.stringify(registered.map((r) => r.def?.name)))
  check('id = fuse-board', dock?.def?.id === 'fuse-board')
  const sidebar = registered.find((r) => r.def?.name === 'sidebar.footer.action')
  check('不再注册 sidebar.footer.action（侧边栏入口已删）', !sidebar)
  const settings = registered.find((r) => r.def?.name === 'settings.section')
  check('设置页注册保留', !!settings)
}

console.log('\n[2] 画板渲染（输入框上方 dock）')
{
  const Dock = registered.find((r) => r.def?.name === 'conversation.composer.dock')?.comp
  check('dock 组件可渲染', typeof Dock === 'function')
  const appRoot = createRoot(document.getElementById('app'))
  appRoot.render(React.createElement(Dock))
  await tick()
  const dock = document.querySelector('.fuse-board-dock')
  check('dock 容器渲染', !!dock)
  const card = document.querySelector('.fuse-board-card')
  check('画板卡片渲染', !!card)
  const head = document.querySelector('.fuse-board-head')
  check('画板标题（UI 工作台 · 设计稿 v2）', !!head && head.textContent.includes('UI 工作台') && head.textContent.includes('设计稿 v2'), head && head.textContent)
  const stats = [...document.querySelectorAll('.fuse-board-stat .v')].map((s) => s.textContent)
  check('4 状态卡（151/15/512维/26）', stats.length === 4 && stats.includes('151') && stats.includes('15') && stats.includes('512维') && stats.includes('26'), stats.join(','))
  const cols = [...document.querySelectorAll('.fuse-board-col h5')].map((s) => s.textContent)
  check('构成三列（类型/权重/近7天）', cols.length === 3 && cols[0].includes('类型') && cols[1].includes('权重'), cols.join(','))
  const modes = [...document.querySelectorAll('.fuse-board-mode')]
  check('记忆流模式按钮（3 个）', modes.length >= 3, String(modes.length))
  check('hybrid 高亮（on 类）', modes.some((m) => m.classList.contains('on')))
  appRoot.unmount()
}

console.log('\n[3] 宽度对齐（与输入框一致）')
{
  const Dock = registered.find((r) => r.def?.name === 'conversation.composer.dock')?.comp
  const appRoot = createRoot(document.getElementById('app'))
  appRoot.render(React.createElement(Dock))
  await tick()
  const dock = document.querySelector('.fuse-board-dock')
  const card = document.querySelector('.fuse-board-card')
  check('dock 宽度 100%', !!dock && dock.style.width === '' && getComputedStyle(dock).width !== '0px')
  check('画板卡片宽度 100%', !!card && getComputedStyle(card).width !== '0px')
  appRoot.unmount()
}

console.log('\n[4] 样式注入')
{
  const style = document.getElementById('fuse-board-style')
  check('画板样式已注入（fuse-board-style）', !!style && style.textContent.includes('fuse-board-dock'))
  check('样式含宽度 100%', !!style && style.textContent.includes('width:100%'))
}

console.log(failures === 0 ? '\n✅ 画板 dock 测试全部通过' : `\n❌ ${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
