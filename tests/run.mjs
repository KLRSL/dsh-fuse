// dsh-fuse v2.0 测试：每个用例一个独立进程跑（jsdom 与测试编排共进程时会互相等，实测挂起）。
// 主进程只用 execFileSync 依次拉起自己；子进程跑完一个用例就 process.exit。
//
// 覆盖：
//   ① 词汇表同步：spec.mjs（宿主提示词）↔ lib/client.js（浏览器白名单）
//   ② 渲染器：合法规格 / 工具栏 / 宽度档 / 流式骨架屏 / 流式结束升级错误卡 / 非法规格
//   ③ 令牌对比度：theme.json 两套主题正文 WCAG ≥ 4.5
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { JSDOM } from 'jsdom'

import {
  FUSE_PAGE_KINDS,
  FUSE_COMPONENT_TYPES,
  FUSE_CONTAINER_TYPES,
  FUSE_MAX_NODES,
  FUSE_MAX_DEPTH,
  buildFuseSectionText,
  summarizeTheme,
} from '../spec.mjs'

const clientSrc = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const themeConfig = JSON.parse(fs.readFileSync(new URL('../config/theme.json', import.meta.url), 'utf8'))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const block = (body) => `<div class="md-code-block" data-lang="dsh-fuse"><div class="md-code-block__header">dsh-fuse</div><pre>${body}</pre></div>`

function boot(html) {
  const dom = new JSDOM(`<!doctype html><html><body><div class="conversation">${html}</div></body></html>`, { runScripts: 'outside-only' })
  const { window } = dom
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ themes: themeConfig.themes }) })
  let plugin = null
  window.__ModuleLoader__ = { load: ({ factory }) => { plugin = factory(() => ({})) } }
  window.eval(clientSrc)
  const dispose = plugin.apply({ sessions: { current: () => null }, effect: (fn) => fn() })
  return { document: window.document, close: () => { dispose?.(); window.close() } }
}

const grabArray = (name) => {
  const m = clientSrc.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`))
  assert.ok(m, `client.js 里找不到 const ${name}`)
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1])
}
const grabNumber = (name) => {
  const m = clientSrc.match(new RegExp(`const ${name} = (\\d+)`))
  assert.ok(m, `client.js 里找不到 const ${name}`)
  return Number(m[1])
}

const cases = {
  '词汇表同步': () => {
    assert.deepEqual(grabArray('PAGE_KINDS'), FUSE_PAGE_KINDS)
    assert.deepEqual(grabArray('COMPONENT_TYPES'), FUSE_COMPONENT_TYPES)
    assert.deepEqual(grabArray('CONTAINER_TYPES'), FUSE_CONTAINER_TYPES)
    assert.equal(grabNumber('MAX_NODES'), FUSE_MAX_NODES)
    assert.equal(grabNumber('MAX_DEPTH'), FUSE_MAX_DEPTH)
    for (const type of FUSE_COMPONENT_TYPES) assert.ok(clientSrc.includes(`case '${type}'`), `渲染器缺少 case '${type}'`)
    const text = buildFuseSectionText(summarizeTheme(themeConfig))
    for (const kind of FUSE_PAGE_KINDS) assert.ok(text.includes(kind), `提示词缺少页面类型 ${kind}`)
    for (const type of FUSE_COMPONENT_TYPES) assert.ok(text.includes(type), `提示词缺少组件 ${type}`)
    assert.ok(text.includes(String(FUSE_MAX_NODES)) && text.includes(String(FUSE_MAX_DEPTH)))
  },

  '嵌套组件': async () => {
    // 回归：容器（row/grid/col/card/section/form/page）过去只认 node.items，
    // 而校验器认 items ?? components —— 用 components 写的嵌套会被校验放行、渲染成空壳。
    const spec = {
      type: 'dashboard',
      title: '嵌套',
      theme: 'default',
      components: [
        { type: 'row', components: [
          { type: 'stat', value: '1,284', label: '今日新增' },
          { type: 'stat', value: '96.2%', label: '任务成功率' },
        ] },
        { type: 'grid', cols: 2, components: [
          { type: 'card', title: '月度目标', components: [{ type: 'progress', label: '完成度', value: 68, max: 100 }] },
          { type: 'card', title: '近 5 日', components: [{ type: 'chart', kind: 'bars', data: [{ label: '一', value: 12 }, { label: '二', value: 18 }] }] },
        ] },
      ],
    }
    const { document, close } = boot(block(JSON.stringify(spec)))
    await wait(80)
    assert.equal(document.querySelectorAll('.fuse-row .fuse-stat').length, 2, 'row 里的 stat 应渲染')
    assert.equal(document.querySelector('.fuse-row .fuse-stat .v')?.textContent, '1,284')
    assert.ok(document.querySelector('.fuse-grid .fuse-card-box'), 'grid 里的 card 应渲染')
    assert.ok(document.querySelector('.fuse-grid .fuse-progress .fill'), 'card 里的 progress 应渲染')
    assert.equal(document.querySelectorAll('.fuse-chart .bar').length, 2, 'card 里的 chart 柱应渲染')
    assert.equal(document.querySelectorAll('.fuse-error').length, 0)
    close()
  },

  '合法渲染': async () => {
    const spec = {
      type: 'dashboard',
      title: '运营看板',
      theme: 'default',
      components: [
        { type: 'stat', value: '1,284', label: '今日新增' },
        { type: 'progress', label: '月度目标', value: 68, max: 100 },
        { type: 'timeline', items: [{ time: '09:00', title: '上线', desc: '灰度 10%' }] },
        { type: 'code', lang: 'bash', content: 'npm test' },
      ],
    }
    const { document, close } = boot(block(JSON.stringify(spec)))
    await wait(80)
    assert.ok(document.querySelector('.fuse-card'), '应渲染预览卡')
    assert.equal(document.querySelector('.fuse-title')?.textContent, '运营看板')
    assert.equal(document.querySelector('.fuse-stat .v')?.textContent, '1,284')
    assert.ok(document.querySelector('.fuse-progress .fill'), 'progress 应渲染填充条')
    assert.ok(document.querySelector('.fuse-timeline .item'), 'timeline 应渲染条目')
    assert.equal(document.querySelector('.fuse-code pre')?.textContent, 'npm test')
    assert.equal(document.querySelectorAll('.fuse-error').length, 0)
    const buttons = [...document.querySelectorAll('.fuse-toolbar button')]
    assert.equal(buttons.length, 4, '工具栏应有 4 个按钮')
    assert.equal(buttons.find((b) => b.textContent.includes('HTML')).disabled, false, '合法页面可导出')
    assert.deepEqual(buttons.map((b) => b.textContent), ['桌面', '手机', '导出 HTML', '刷新'], '工具栏只用文字，不用 emoji')
    buttons.find((b) => b.textContent === '手机').click()
    assert.equal(document.querySelector('.fuse-root-holder').style.maxWidth, '420px', '手机档应限制 420px')
    close()
  },

  '流式骨架屏': async () => {
    const { document, close } = boot(block('{"type":"dashboard","title":"半截","theme":"default","components":[{"type":"sta'))
    await wait(80)
    assert.ok(document.querySelector('.fuse-loading'), '应显示加载态')
    assert.ok(document.querySelector('.fuse-skeleton'), '应显示骨架屏')
    assert.equal(document.querySelectorAll('.fuse-error').length, 0, '流式中不得报错')
    close()
  },

  '流式结束升级错误卡': async () => {
    const { document, close } = boot(block('{"type":"dashboard", 坏掉了'))
    await wait(1400)
    assert.ok(document.querySelector('.fuse-error'), '应升级为错误卡')
    assert.ok(document.querySelector('.fuse-raw').textContent.includes('坏掉了'), '应折叠原始内容')
    close()
  },

  '非法规格错误卡': async () => {
    const bad = { type: 'dashboard', title: '坏页面', theme: 'default', components: [{ type: 'nope' }] }
    const { document, close } = boot(block(JSON.stringify(bad)))
    await wait(80)
    const err = document.querySelector('.fuse-error')
    assert.ok(err, '应显示错误卡')
    assert.match(err.textContent, /未知组件类型/)
    assert.ok(err.querySelector('details pre.fuse-raw').textContent.includes('"nope"'), '应折叠原始 JSON')
    const btn = [...document.querySelectorAll('.fuse-toolbar button')].find((b) => b.textContent.includes('HTML'))
    assert.equal(btn.disabled, true, '非法页面禁用导出')
    close()
  },

  '宿主集成': async () => {
    const host = await import('../index.mjs')
    const sections = []
    let route = null
    const ctx = {
      systemPrompt: { section: (s) => sections.push(s) },
      inject: (_deps, cb) => {
        const httpCtx = { effect: (fn) => fn(), webServer: { register: (r) => { route = r } } }
        cb(httpCtx)
      },
      logger: {},
    }
    host.apply(ctx)
    assert.equal(sections.length, 1, '应注册一段系统指令')
    assert.equal(sections[0].name, 'fuse')
    assert.ok(sections[0].text.includes('dsh-fuse 围栏'), '系统指令应讲围栏语法')
    assert.equal(route?.kind, 'prefix')
    assert.equal(route?.path, '/api/fuse')

    const res = {
      statusCode: 0,
      body: '',
      setHeader() {},
      end(body) { this.body = body },
    }
    await route.handler({ method: 'GET', url: '/api/fuse/config' }, res)
    assert.equal(res.statusCode, 200)
    const data = JSON.parse(res.body)
    assert.ok(data.themes?.default?.colors?.primary, '应返回令牌')
    assert.deepEqual(data.pageKinds, FUSE_PAGE_KINDS)
    assert.equal(data.limits.maxNodes, FUSE_MAX_NODES)

    const res404 = { statusCode: 0, body: '', setHeader() {}, end(b) { this.body = b } }
    await route.handler({ method: 'GET', url: '/api/fuse/nope' }, res404)
    assert.equal(res404.statusCode, 404)
  },

  '令牌对比度': () => {
    const luminance = (hex) => {
      const c = hex.replace('#', '')
      const full = c.length === 3 ? c.split('').map((x) => x + x).join('') : c
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
      const f = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const ratio = (a, b) => {
      const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
      return (x + 0.05) / (y + 0.05)
    }
    for (const [name, theme] of Object.entries(themeConfig.themes)) {
      const c = theme.colors
      assert.ok(ratio(c.neutralText, c.neutralBg) >= 4.5, `${name} 正文对比度不足 4.5`)
    }
  },
}

const name = process.env.FUSE_TEST_CASE ?? '词汇表同步'
const run = cases[name]
assert.ok(run, `未知用例 ${name}`)
await run()
console.log('✔', name)
process.exit(0)
