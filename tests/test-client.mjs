// ============================================================================
// test-client.mjs — dsh-fuse 浏览器半区测试（jsdom 模拟 DOM + __ModuleLoader__ + fetch）
// 运行: node tests/test-client.mjs
// 验证: DOM 通道渲染、dsh-fuse 围栏渲染、走查器样式采集、撤销快照、清理
// ============================================================================
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_SRC = path.join(__dirname, '..', 'client.js')
let failures = 0
function check(label, cond, extra = '') {
  if (cond) { console.log('  ok   ' + label) }
  else { failures++; console.log('  FAIL ' + label + (extra ? '  -> ' + extra : '')) }
}
const tick = () => new Promise((r) => setTimeout(r, 30))

// ---- 准备 jsdom 窗口 ----
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://127.0.0.1:3080/', runScripts: 'outside-only' })
const { window } = dom
const { document } = window

// fetch 桩：config API 返回主题令牌
window.fetch = async (url) => {
  if (typeof url === 'string' && url.includes('/api/fuse/config')) {
    return {
      ok: true,
      json: async () => ({
        themes: {
          default: {
            colors: { primary: '#2563EB', accent: '#0EA5E9', neutralBg: '#FFFFFF', neutralSurface: '#F5F6F8', neutralText: '#1A1A1A', neutralTextMuted: '#6B7280', border: '#E5E7EB' },
            feedback: { success: '#2E7D32', warning: '#ED6C02', error: '#C62828' },
            spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
            radius: { sm: 8, md: 12, lg: 16 },
            typography: { fontFamily: 'sans-serif' },
          },
        },
        codeStyle: { formatting: { indentSize: 2 } },
        pageKinds: ['login_form'],
        componentTypes: ['input', 'button'],
      }),
    }
  }
  return { ok: false, status: 404 }
}

// 加载 client.js（经 __ModuleLoader__.load 契约）
let loadedExports = null
window.__ModuleLoader__ = {
  load: ({ id, factory }) => {
    loadedExports = factory(() => ({})) // 无 primitives → 走 DOM 通道
  },
}
// MutationObserver 在 jsdom 有实现；fetch 需要真实 window 上（已装）
vm.runInContext(readFileSync(CLIENT_SRC, 'utf8'), dom.getInternalVMContext())
check('bundle 注册（__ModuleLoader__.load 契约）', !!loadedExports && typeof loadedExports.apply === 'function')

// ---- 启动插件（DOM 通道：无 registerFenceRenderer） ----
const sent = []
const fakeCtx = {
  slots: {
    inject: () => () => {},
    register: () => () => {},
  },
  sessions: {
    current: () => 'sess-1',
    scope: () => ({ get: () => ({ send: (m) => { sent.push(m); return Promise.resolve() } }) }),
  },
  effect: (fn) => fn(),
}
const disposer = loadedExports.apply(fakeCtx)
check('apply 返回清理函数', typeof disposer === 'function')
await tick()

// ---- 插入 dsh-fuse 围栏代码块（模拟对话流） ----
function insertFenceBlock(raw) {
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
  return { block, pre }
}

console.log('\n[1] dsh-fuse 围栏渲染（登录页）')
{
  const { block } = insertFenceBlock(JSON.stringify({
    type: 'login_form',
    title: '欢迎回来',
    theme: 'default',
    components: [
      { type: 'input', label: '用户名', placeholder: '请输入用户名' },
      { type: 'input', label: '密码', inputType: 'password' },
      { type: 'button', text: '登 录', style: 'primary', full: true, action: 'login' },
    ],
  }))
  await tick()
  const holder = document.querySelector('.fuse-root-holder')
  check('DOM 通道接管（holder 挂载）', !!holder)
  const card = document.querySelector('.fuse-card')
  check('预览卡渲染', !!card)
  const title = document.querySelector('.fuse-title')
  check('页面标题渲染', !!title && title.textContent === '欢迎回来', title && title.textContent)
  const inputs = document.querySelectorAll('.fuse-input')
  check('输入框渲染（2 个）', inputs.length === 2, String(inputs.length))
  const btn = document.querySelector('.fuse-btn')
  check('主按钮 primary + full', !!btn && btn.classList.contains('primary') && btn.classList.contains('full') && btn.textContent === '登 录')
  check('带 action 的按钮可点击', !btn.disabled)
  check('原代码块已隐藏', block.style.display === 'none')
  // 令牌变量注入
  const rootStyle = card.style
  check('令牌 CSS 变量注入（--fuse-primary）', rootStyle.getPropertyValue('--fuse-primary') === '#2563EB', rootStyle.getPropertyValue('--fuse-primary'))
  check('令牌圆角注入', rootStyle.getPropertyValue('--fuse-radius-lg') === '16px')
  // 工具栏
  const toolbarBtns = document.querySelectorAll('.fuse-toolbar button')
  check('工具栏按钮（🔄 ↩️）', toolbarBtns.length === 2 && toolbarBtns[0].textContent.includes('撤销') && toolbarBtns[1].textContent.includes('刷新'), Array.from(toolbarBtns).map((b) => b.textContent).join(','))
}

console.log('\n[2] 走查器：点击元素采集样式')
{
  const input = document.querySelector('.fuse-input')
  input.dispatchEvent(new window.MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 }))
  await tick()
  check('走查数据回传（[fuse-inspect]）', sent.length > 0 && sent[0].includes('[fuse-inspect]'), sent[0]?.slice(0, 80))
  check('回传含样式数据', sent[0].includes('styles') && sent[0].includes('borderRadius'))
  const inspected = document.querySelector('.fuse-inspect')
  check('元素高亮（fuse-inspect 类）', !!inspected)
}

console.log('\n[3] 撤销快照（↩️ 回退）')
{
  const toolbarBtns = document.querySelectorAll('.fuse-toolbar button')
  const undoBtn = toolbarBtns[1]
  // 更新围栏内容触发重渲染（模拟模型修正）→ 快照 +1
  const holder = document.querySelector('.fuse-root-holder')
  const pre = document.querySelector('.md-code-block pre')
  const updated = JSON.stringify({
    type: 'login_form',
    title: '欢迎回来（已修正）',
    theme: 'default',
    components: [
      { type: 'input', label: '用户名', placeholder: '请输入用户名' },
      { type: 'button', text: '登 录', style: 'primary', action: 'login' },
    ],
  })
  pre.textContent = updated // textContent 赋值触发 characterData 观察
  await tick()
  check('修正后标题更新', document.querySelector('.fuse-title')?.textContent === '欢迎回来（已修正）')
  // 撤销 → 回退到上一快照
  undoBtn.click()
  await tick()
  const titleAfterUndo = document.querySelector('.fuse-title')?.textContent
  check('撤销回退到上一快照', titleAfterUndo === '欢迎回来', titleAfterUndo)
}

console.log('\n[4] 坏规格：JSON 解析失败 → 错误提示 + 原块保留')
{
  insertFenceBlock('{ 这不是 JSON')
  await tick()
  const err = document.querySelector('.fuse-error')
  check('错误提示显示', !!err && err.textContent.includes('JSON 解析失败'), err && err.textContent)
}

console.log('\n[5] 白名单拒绝：未知组件 → 错误提示')
{
  insertFenceBlock(JSON.stringify({ type: 'login_form', components: [{ type: 'magic-widget' }] }))
  await tick()
  const errs = [...document.querySelectorAll('.fuse-error')]
  const last = errs[errs.length - 1]
  check('未知组件被拒绝', !!last && last.textContent.includes('未知组件类型'), last && last.textContent)
}

console.log('\n[6] 清理（disposer）')
{
  disposer()
  const styles = [...document.querySelectorAll('style')]
  check('插件样式已移除', styles.length === 0)
}

console.log(failures === 0 ? '\n✅ 客户端测试全部通过' : `\n❌ ${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)

