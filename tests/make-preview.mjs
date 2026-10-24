// 生成 README 用的预览页：把示例规格用真实渲染器渲进一个独立 HTML（不含对话外壳）
// 用法：node tests/make-preview.mjs    → 产出 docs/preview.html
//      再用无头浏览器截图成 docs/preview.png（命令见 README「预览图」一节）
import fs from 'node:fs'
import { JSDOM } from 'jsdom'

const clientSrc = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const themeConfig = JSON.parse(fs.readFileSync(new URL('../config/theme.json', import.meta.url), 'utf8'))

export const DEMO_SPEC = {
  type: 'dashboard',
  title: '今日运营',
  theme: 'default',
  components: [
    { type: 'row', components: [
      { type: 'stat', value: '1,284', label: '今日新增' },
      { type: 'stat', value: '96.2%', label: '任务成功率' },
      { type: 'stat', value: '3.4 万', label: '活跃用户' },
    ] },
    { type: 'card', title: '月度目标', components: [
      { type: 'progress', label: '完成度', value: 68, max: 100 },
    ] },
    { type: 'card', title: '近 5 日', components: [
      { type: 'chart', kind: 'bars', data: [
        { label: '一', value: 12 }, { label: '二', value: 18 }, { label: '三', value: 15 },
        { label: '四', value: 24 }, { label: '五', value: 21 },
      ] },
    ] },
  ],
}

const block = (body) => `<div class="md-code-block" data-lang="dsh-fuse"><div class="md-code-block__header">dsh-fuse</div><pre>${body}</pre></div>`

export function renderToHtml(spec = DEMO_SPEC) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body><div class="conversation">${block(JSON.stringify(spec))}</div></body></html>`, { runScripts: 'outside-only' })
  const { window } = dom
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  window.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({ themes: themeConfig.themes }) })
  let plugin = null
  window.__ModuleLoader__ = { load: ({ factory }) => { plugin = factory(() => ({})) } }
  window.eval(clientSrc)
  plugin.apply({ sessions: { current: () => null }, effect: (fn) => fn() })

  return new Promise((resolve) => setTimeout(() => {
    const d = window.document
    const card = d.querySelector('.fuse-card')
    const styles = [...d.querySelectorAll('style')].map((s) => s.textContent).join('\n')
    const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>dsh-fuse 预览</title>
<style>
${styles}
html,body{margin:0;background:#FBFAF7}
body{display:flex;justify-content:center;padding:24px 24px 32px}
.fuse-card{max-width:760px;width:100%;box-shadow:0 1px 2px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.06)}
</style></head>
<body>${card ? card.outerHTML : '<p>渲染失败</p>'}</body></html>`
    resolve(html)
  }, 200))
}

const out = new URL('../docs/preview.html', import.meta.url)
fs.mkdirSync(new URL('../docs/', import.meta.url), { recursive: true })
fs.writeFileSync(out, await renderToHtml(), 'utf8')
console.log('wrote', out.pathname)
