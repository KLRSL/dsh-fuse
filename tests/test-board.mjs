// ============================================================================
// test-board.mjs — dsh-fuse 画板渲染测试（对话流卡片，宽度 100% 对齐输入框）
// 运行: node tests\test-board.mjs
// 验证: 不注册 composer.dock / 不注册 sidebar.footer.action /
//       画板内容渲染 / 宽度 100% / 样式注入幂等
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

console.log('\n[1] 注册检查（不占 dock、不占侧边栏）')
{
  const dock = registered.find((r) => r.def?.name === 'conversation.composer.dock')
  check('不注册 composer.dock（不占输入框上方，不与费用条挤）', !dock)
  const sidebar = registered.find((r) => r.def?.name === 'sidebar.footer.action')
  check('不注册 sidebar.footer.action（无侧边栏入口）', !sidebar)
  const settings = registered.find((r) => r.def?.name === 'settings.section')
  check('设置页注册保留', !!settings)
  check('导出 renderBoardCanvas', typeof moduleExports?.renderBoardCanvas === 'function')
}

console.log('\n[2] 画板渲染（对话流卡片）')
{
  const host = document.createElement('div')
  document.body.appendChild(host)
  const wrap = moduleExports.renderBoardCanvas(host)
  check('画板卡片渲染', !!wrap && wrap.classList.contains('fuse-board-card'))
  const head = wrap.querySelector('.fuse-board-head')
  check('画板标题（UI 工作台 · 设计稿 v2）', !!head && head.textContent.includes('UI 工作台') && head.textContent.includes('设计稿 v2'), head && head.textContent)
  const stats = [...wrap.querySelectorAll('.fuse-board-stat .v')].map((s) => s.textContent)
  check('4 状态卡（151/15/512维/26）', stats.length === 4 && stats.includes('151') && stats.includes('15') && stats.includes('512维') && stats.includes('26'), stats.join(','))
  const cols = [...wrap.querySelectorAll('.fuse-board-col h5')].map((s) => s.textContent)
  check('构成三列（类型/权重/近7天）', cols.length === 3 && cols[0].includes('类型') && cols[1].includes('权重'), cols.join(','))
  const modes = [...wrap.querySelectorAll('.fuse-board-body > div:last-child .fuse-board-mode')]
  check('记忆流模式（hybrid/exact/semantic）', modes.length === 3 && modes[0].textContent.includes('hybrid'), String(modes.length))
  check('hybrid 高亮（on 类）', modes.some((m) => m.classList.contains('on')))
  host.remove()
}

console.log('\n[3] 宽度 100%（与输入框对齐）')
{
  const style = document.getElementById('fuse-board-style')
  check('画板样式已注入（fuse-board-style）', !!style)
  check('样式含宽度 100%', !!style && style.textContent.includes('width:100%'))
  const holderCss = style && style.textContent.includes('.fuse-root-holder{width:100%')
  check('对话流容器宽度 100%（fuse-root-holder）', !!holderCss)
}

console.log('\n[4] ensureBoardStyles 幂等')
{
  moduleExports.ensureBoardStyles()
  moduleExports.ensureBoardStyles()
  const styles = [...document.querySelectorAll('style')].filter((s) => s.id === 'fuse-board-style')
  check('样式只注入一次（幂等）', styles.length === 1, String(styles.length))
}

console.log(failures === 0 ? '\n✅ 画板测试全部通过' : `\n❌ ${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
