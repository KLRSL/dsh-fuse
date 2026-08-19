// dsh-fuse apply() 冒烟：模拟 ctx 验证 host 半区注册路径 + webServer handler 真实响应
import { apply, validateFuseSpec } from '../index.mjs'

const sections = []
const toolsArr = []
const webRoutes = []

function makeFakeRes() {
  const res = { statusCode: 0, headers: {}, body: '', ended: false }
  res.setHeader = (k, v) => { res.headers[k] = v }
  res.end = (b) => { res.body = b; res.ended = true }
  return res
}

const ctx = {
  logger: { info: (s) => console.log('[log]', s) },
  systemPrompt: { section: (s) => sections.push(s) },
  reflect: { get: () => undefined },
  on: (ev, fn) => {
    if (ev === 'internal/service') {
      fn({ name: 'tools', value: { register: (t) => toolsArr.push(t.name) } })
    }
  },
  inject: (names, cb) => {
    if (names.includes('webServer')) {
      const httpCtx = {
        webServer: { register: (r) => webRoutes.push(r) },
        effect: (fn) => fn(),
      }
      cb(httpCtx)
    }
  },
}

apply(ctx)

console.log('sections:', sections.length, '| name:', sections[0]?.name, '| order:', sections[0]?.order, '| textLen:', sections[0]?.text?.length)
console.log('tools:', JSON.stringify(toolsArr))
console.log('webRoutes:', JSON.stringify(webRoutes.map((r) => ({ kind: r.kind, path: r.path }))))

// webServer handler 真实响应验证
const route = webRoutes[0]
const res = makeFakeRes()
await route.handler({ method: 'GET', url: '/api/fuse/config' }, res)
console.log('handler GET /api/fuse/config:', res.statusCode, 'ended:', res.ended, 'len:', res.body?.length)
const parsed = JSON.parse(res.body ?? '{}')
console.log('  themes:', Object.keys(parsed.themes ?? {}).join(','), '| pageKinds:', parsed.pageKinds?.length, '| componentTypes:', parsed.componentTypes?.length)

const res404 = makeFakeRes()
await route.handler({ method: 'GET', url: '/api/fuse/nope' }, res404)
console.log('handler 404:', res404.statusCode)

const ok = validateFuseSpec({ type: 'login_form', components: [{ type: 'input', label: 'u' }, { type: 'button', text: 'go', action: 'x' }] })
console.log('validate login_form:', JSON.stringify(ok))

const bad = validateFuseSpec({ type: 'spaceship', components: [{ type: 'magic' }] })
console.log('validate bad:', JSON.stringify(bad))

if (sections.length !== 1 || !toolsArr.includes('validate_fuse_spec') || webRoutes.length !== 1) {
  console.error('FAIL: 注册不完整')
  process.exit(1)
}
if (route.kind !== 'prefix' || res.statusCode !== 200 || !res.ended || !parsed.themes?.default) {
  console.error('FAIL: webServer handler 响应不正确')
  process.exit(1)
}
if (res404.statusCode !== 404) {
  console.error('FAIL: 404 分支不正确')
  process.exit(1)
}
console.log('PASS: apply() 注册完整 + webServer 响应正确')
