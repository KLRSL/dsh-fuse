// ============================================================================
// test-settings.mjs — dsh-fuse 设置页组件测试（jsdom + React 真实渲染）
// 运行: node tests/test-settings.mjs
// 验证: settings.section 注册、三 tab 渲染、主题令牌展示、代码规范展示、示例页
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

// ---- 准备 jsdom 窗口 ----
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { pretendToBeVisual: true, url: 'http://127.0.0.1:3080/', runScripts: 'outside-only' })
const { window } = dom
const { document } = window
// React 需要的全局
globalThis.window = window
globalThis.document = document
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true })
globalThis.HTMLElement = window.HTMLElement
globalThis.Node = window.Node
globalThis.getComputedStyle = window.getComputedStyle
window.React = React
window.requestAnimationFrame = (cb) => setTimeout(cb, 0)
window.cancelAnimationFrame = (id) => clearTimeout(id)

// fetch 桩
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
            typography: { sizes: { caption: 12, body: 14, h3: 20, h2: 28, h1: 36, display: 48 } },
          },
          apple: { colors: { primary: '#0071E3' }, spacing: {}, radius: {}, typography: {} },
          dark: { colors: { primary: '#22D3EE' }, spacing: {}, radius: {}, typography: {} },
        },
        codeStyle: { naming: { components: 'PascalCase' }, formatting: { indentSize: 2, quoteStyle: 'single' } },
        pageKinds: ['login_form'],
        componentTypes: ['input', 'button'],
      }),
    }
  }
  return { ok: false, status: 404 }
}

// ---- 加载 client.js，捕获设置页组件 ----
let captured = null
window.__ModuleLoader__ = {
  load: ({ id, factory }) => {
    factory((name) => {
      if (name === 'react') return React
      return {}
    })
  },
}
// 让 client.js 的 factory 把 exports 暴露出来——需要改写：__ModuleLoader__ 捕获 exports
let moduleExports = null
window.__ModuleLoader__ = {
  load: ({ id, factory }) => {
    // factory 返回 module.exports；我们在这里构造 require 环境
    const capturedRequire = (name) => {
      if (name === 'react') return React
      if (name === 'react-dom') return { createRoot }
      return {}
    }
    // 直接调用 factory 会执行到 module.exports；但组件需要 slots 注入时才能拿到。
    // 方案：模拟 slots 的 register/inject 捕获组件
    const sent = []
    const fakeCtx = {
      slots: {
        inject: (slotName, registerFn) => {
          // registerFn() 返回 register() 的结果；register 捕获组件
          captured = { slotName }
          const result = registerFn()
          if (result && result.component) captured.component = result.component
          return () => {}
        },
        register: (def, comp) => {
          if (captured) captured.component = comp
          return { component: comp, def }
        },
      },
      sessions: {
        current: () => 'sess-1',
        scope: () => ({ get: () => ({ send: (m) => { sent.push(m); return Promise.resolve() } }) }),
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
check('apply 已注册 settings.section', !!captured && captured.slotName === 'settings.section')
check('exports.inject 声明 slots+sessions', Array.isArray(moduleExports?.inject) && moduleExports.inject.includes('slots') && moduleExports.inject.includes('sessions'), JSON.stringify(moduleExports?.inject))

// ---- 用 React 渲染设置页组件 ----
const Component = captured?.component
check('设置页组件已捕获', !!Component)
if (!Component) {
  console.log('❌ 无法继续（组件未捕获）')
  process.exit(failures === 0 ? 0 : 1)
}

const appRoot = createRoot(document.getElementById('app'))
appRoot.render(React.createElement(Component))
await tick()

console.log('\n[1] 页面骨架')
{
  const h3 = document.querySelector('.fs-page h3')
  check('页面标题', !!h3 && h3.textContent.includes('Fuse'), h3 && h3.textContent)
  const tabs = [...document.querySelectorAll('.fs-tab')]
  check('三个 tab（令牌/规范/示例）', tabs.length === 3 && tabs[0].textContent.includes('设计令牌') && tabs[1].textContent.includes('代码规范') && tabs[2].textContent.includes('实时示例'), tabs.map((t) => t.textContent).join(','))
  check('默认 tab 激活（设计令牌）', tabs[0].classList.contains('active'))
}

console.log('\n[2] 设计令牌 tab')
{
  const themeBtns = [...document.querySelectorAll('.fs-theme-btn')]
  check('三个主题按钮', themeBtns.length === 3 && themeBtns[0].textContent === 'default', themeBtns.map((b) => b.textContent).join(','))
  check('default 激活', themeBtns[0].classList.contains('active'))
  const chips = [...document.querySelectorAll('.fs-chip')]
  check('色板 chip 渲染（含主色/正文）', chips.length >= 7, String(chips.length))
  const code = document.querySelector('.fs-pre code') || [...document.querySelectorAll('.fs-chip code')].find((c) => c.textContent === '#2563EB')
  check('主色值 #2563EB', !!code && code.textContent === '#2563EB', code && code.textContent)
  const pres = [...document.querySelectorAll('.fs-pre')]
  check('间距/圆角/字号 JSON 展示', pres.length >= 2, String(pres.length))
}

console.log('\n[3] 切换主题')
{
  const themeBtns = [...document.querySelectorAll('.fs-theme-btn')]
  themeBtns[1].click() // apple
  await tick()
  const active = document.querySelector('.fs-theme-btn.active')
  check('apple 主题激活', active && active.textContent === 'apple')
}

console.log('\n[4] 代码规范 tab')
{
  const tabs = [...document.querySelectorAll('.fs-tab')]
  tabs[1].click()
  await tick()
  const pre = document.querySelector('.fs-code')
  check('代码规范 JSON 展示', !!pre && pre.textContent.includes('PascalCase') && pre.textContent.includes('single'), pre && pre.textContent.slice(0, 60))
}

console.log('\n[5] 实时示例 tab')
{
  // 切回设计令牌 tab，选回 default 主题（[3] 切到过 apple），断言令牌跟随主题
  const tabs = [...document.querySelectorAll('.fs-tab')]
  tabs[0].click()
  await tick()
  const themeBtns = [...document.querySelectorAll('.fs-theme-btn')]
  themeBtns[0].click()
  await tick()
  tabs[2].click()
  await tick()
  const demoCard = document.querySelector('.fs-demo .fuse-card')
  check('示例卡片渲染', !!demoCard)
  const demoTitle = document.querySelector('.fs-demo .fuse-title')
  check('示例标题「欢迎回来」', !!demoTitle && demoTitle.textContent === '欢迎回来', demoTitle && demoTitle.textContent)
  const inputs = document.querySelectorAll('.fs-demo .fuse-input')
  check('示例输入框（2 个）', inputs.length === 2, String(inputs.length))
  const btn = document.querySelector('.fs-demo .fuse-btn')
  check('示例主按钮', !!btn && btn.textContent === '登 录' && btn.classList.contains('primary'))
  const style = document.querySelector('.fs-demo .fuse-card')
  check('示例应用令牌（--fuse-primary）', style.style.getPropertyValue('--fuse-primary') === '#2563EB')
}

console.log('\n[6] 清理')
{
  appRoot.unmount()
  check('React 卸载', !document.querySelector('.fs-page'))
}

console.log(failures === 0 ? '\n✅ 设置页测试全部通过' : `\n❌ ${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)

