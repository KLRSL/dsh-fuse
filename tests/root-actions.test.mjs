// ============================================================================
// dsh-fuse · 根级 actions 与按钮字段兼容（自审 F4/F7 回归）
//
// 背景（宣称与实现不符）：
//   - 系统指令与 README 都要求模型把**主操作**写进根节点 `actions`，而渲染器只读 `hero.actions`
//     → 主操作静默消失；
//   - 规格里按钮文案字段叫 `label`、语气字段叫 `tone`，渲染器只认 `text`/`style`
//     → 按规格写的按钮渲染成**空白按钮**；
//   - 按钮点击未阻止冒泡，同一次点击会被容器当成走查点击，一次点击发两条竞争指令。
//
// 手法与 tests/fuse.test.mjs 一致：jsdom + vm 载入真实浏览器半区源码，走 DOM 渲染通道。
// ============================================================================

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_SRC = path.join(__dirname, '..', 'lib', 'client.js')
const tick = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms))

let clientEnv = null
async function loadClient() {
  if (clientEnv) return clientEnv
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    pretendToBeVisual: true,
    url: 'http://127.0.0.1:3080/',
    runScripts: 'outside-only',
  })
  const { window } = dom
  window.fetch = async () => ({ ok: false, status: 404 })
  const sent = []
  let mod = null
  window.__ModuleLoader__ = { load: ({ factory }) => { mod = factory(() => ({})) } }
  vm.runInContext(fs.readFileSync(CLIENT_SRC, 'utf8'), dom.getInternalVMContext())
  const ctx = {
    slots: { inject: () => () => {}, register: () => () => {} },
    sessions: {
      current: () => 'sess-test',
      scope: () => ({ get: () => ({ send: (payload) => { sent.push(payload); return Promise.resolve() } }) }),
    },
    effect: (fn) => fn(),
  }
  const dispose = mod.apply(ctx)
  clientEnv = { window, document: window.document, sent, dispose }
  return clientEnv
}

/** 插入一个 dsh-fuse 围栏代码块（raw = 规格 JSON 本体，不含围栏标记） */
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

after(() => {
  if (clientEnv) { clientEnv.dispose(); clientEnv.window.close() }
})

function spec(actions) {
  return JSON.stringify({
    type: 'form',
    title: '注册',
    theme: 'default',
    components: [{ type: 'text', text: '正文' }],
    ...(actions ? { actions } : {}),
  })
}

test('根级 actions 渲染成操作条（此前没有读取点，主操作静默消失）', async () => {
  const { document } = await loadClient()
  insertFence(document, spec([
    { action: 'submit', label: '创建账号', tone: 'primary' },
    { action: 'cancel', label: '取消', tone: 'ghost' },
  ]))
  await tick()
  const bar = document.querySelector('.fuse-root-actions')
  assert.ok(bar, '根级 actions 应渲染出 .fuse-root-actions 操作条')
  const buttons = bar.querySelectorAll('button')
  assert.equal(buttons.length, 2)
  assert.equal(buttons[0].textContent, '创建账号', '按钮文案取规格的 label 字段')
  assert.equal(buttons[1].textContent, '取消')
  assert.ok(buttons[0].className.includes('primary'), 'tone=primary 映射成 primary 样式')
  assert.ok(buttons[1].className.includes('ghost'), 'tone=ghost 映射成 ghost 样式')
})

test('按钮点击恰好回传一次 action（阻止冒泡后不再多出一条走查指令）', async () => {
  const { document, sent } = await loadClient()
  insertFence(document, spec([{ action: 'go', label: '开始', tone: 'primary' }]))
  await tick()
  const btn = document.querySelector('.fuse-root-actions button')
  assert.ok(btn, '操作条按钮已渲染')
  assert.equal(btn.disabled, false, '带 action 的按钮必须可点')
  const before = sent.length
  btn.dispatchEvent(new document.defaultView.MouseEvent('click', { bubbles: true }))
  await tick(30)
  assert.equal(sent.length, before + 1, '一次点击只回传一条 action')
})

test('没有根级 actions 的规格不出现空操作条（不回归）', async () => {
  const { document } = await loadClient()
  const pre = insertFence(document, spec())
  await tick()
  // 三个用例共用同一个 jsdom，前两个用例的围栏块还在 body 里 → 必须在本块内查询
  const block = pre.closest('.md-code-block')
  assert.ok(block.querySelector('.fuse-card') || block.textContent.length > 0, '规格仍被渲染')
  assert.equal(block.querySelector('.fuse-root-actions'), null, '无 actions 时不应出现操作条')
})
