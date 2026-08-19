// ============================================================================
// dsh-fuse — Fuse v1.0 · UI 设计 + 代码规范一体化插件（host 半区）
//
// 定位：ui-aesthetics 技能（~/.dsh/skills/ui-aesthetics）的插件化升级版。
// 借鉴对象（见开发文档 §2）：OpenPencil 设计令牌体系 / dsh-genui 结构化渲染
// 思想 / dsh-annotate·dsh-web-review 走查反馈回路 / Airbnb·Google·阿里代码规范。
//
// 职责（host 半区）：
//   1. 系统指令注册（systemPrompt.section）：注入 dsh-fuse fence 语言规范、
//      设计令牌摘要（theme.json）、代码规范摘要（code-style.json）——对应
//      文档 §4.2.1「系统指令注册器」，由 DSH 平台拼装进每次 LLM 请求
//   2. validate_fuse_spec 工具：模型输出前的 JSON 预检（白名单校验）
//   3. webServer API：GET /api/fuse/config 供浏览器端渲染器拉取完整令牌
//
// 浏览器半区见 client.js（渲染器 + 走查器 + 撤销历史）。
//
// 官方契约要点（rc.6/rc.7，与 dsh-biomemory 同款、逐条核对过 lib 源码）：
//   - PromptSection = { name, order, text }；缺 name/text 会破坏提示词装配
//   - 工具体签名 execute(args, exec)；output.render(args, value) 返回
//     ContentBlock[]（[{type:'text',text}]）；参数 schema 字段名 parameters
//   - 可选服务（tools/webServer）用 ctx.inject 订阅，不做硬注入（服务可能
//     由其他 bundle 晚到）
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// ---------- 配置与常量 ----------

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_DIR = path.join(__dirname, 'config')

export const inject = ['systemPrompt']

/** 系统指令段 order：约定 100-199 为工具指引区；bash=104、genui=105，Fuse=106 */
export const FUSE_SECTION_ORDER = 106

/** 页面级组件词汇（白名单，与 genui 的对话内卡片互补：Fuse 管页面级 UI 产物） */
export const FUSE_COMPONENT_TYPES = [
  // 页面容器
  'page', 'card', 'grid', 'row', 'col', 'nav', 'header', 'footer', 'section', 'tabs', 'hero',
  // 展示
  'text', 'badge', 'stat', 'list', 'table', 'divider', 'avatar', 'chart', 'steps',
  // 表单
  'form', 'input', 'select', 'textarea', 'checkbox', 'radio', 'button', 'link',
]

/** 页面类型（fence 根 type）：语义化页面模板，渲染器按模板布局 */
export const FUSE_PAGE_KINDS = [
  'login_form', 'signup_form', 'dashboard', 'settings_page', 'table_page',
  'landing_page', 'profile_card', 'pricing_page', 'modal', 'form',
]

/** 允许的交互动作名（回传给 Agent 的 [fuse-action] / [fuse-inspect]） */
export const FUSE_ACTION_PREFIX = '[fuse-action]'
export const FUSE_INSPECT_PREFIX = '[fuse-inspect]'

// ---------- 配置加载（theme.json / code-style.json） ----------

function readConfigJson(name) {
  try {
    const raw = fs.readFileSync(path.join(CONFIG_DIR, name), 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    console.warn(`[dsh-fuse] 读取 ${name} 失败，使用空配置：`, err instanceof Error ? err.message : String(err))
    return null
  }
}

const themeConfig = readConfigJson('theme.json')
const codeStyleConfig = readConfigJson('code-style.json')

/** 令牌摘要：把 theme.json 压成模型可见的紧凑文本（token 敏感） */
function summarizeTheme() {
  const themes = themeConfig?.themes ?? {}
  const names = Object.keys(themes)
  if (names.length === 0) return '（无主题配置）'
  const first = themes[names[0]] ?? {}
  const c = first.colors ?? {}
  const s = first.spacing ?? {}
  const r = first.radius ?? {}
  const t = first.typography ?? {}
  const sizes = t.sizes ?? {}
  return [
    `可选主题：${names.join(' / ')}（默认 ${names[0]}）`,
    `主色 ${c.primary ?? '-'} · 强调色 ${c.accent ?? '-'} · 背景 ${c.neutralBg ?? '-'} · 正文 ${c.neutralText ?? '-'}`,
    `间距栅格 ${JSON.stringify(s)} · 圆角 ${JSON.stringify(r)}`,
    `字号阶梯 ${JSON.stringify(Object.values(sizes))}px · 行高 正文${t.lineHeights?.body ?? 1.7}/标题${t.lineHeights?.heading ?? 1.25}`,
  ].join('\n')
}

/** 代码规范摘要（模型生成代码时必须遵守） */
function summarizeCodeStyle() {
  if (!codeStyleConfig) return '（无代码规范配置）'
  const n = codeStyleConfig.naming ?? {}
  const f = codeStyleConfig.formatting ?? {}
  const s = codeStyleConfig.syntax ?? {}
  return [
    `命名 ${n.variables ?? '-'}/${n.components ?? '-'}/${n.directories ?? '-'}（变量/组件/目录）`,
    `格式化 缩进${f.indentSize ?? 2}空格 · 行长≤${f.maxLineLength ?? 100} · ${f.quoteStyle ?? 'single'}引号 · ${f.semicolons ? '加分号' : '不加分号'}`,
    `语法 ${s.preferConst ? 'const 优先' : ''}${s.forbidVar ? '·禁 var' : ''} · TS strict`,
    `CSS 只用设计令牌取色/圆角，禁止硬编码十六进制`,
  ].join('\n')
}

/** dsh-fuse fence 语言规范（注入系统指令，模型输出时必须遵守） */
export const FUSE_SECTION_TEXT = `## Fuse — 页面级 UI 生成规范（dsh-fuse fence）

需要生成「页面级 UI 产物」（登录页/注册页/仪表盘/设置页/表格页/落地页/个人卡片/弹窗/表单）时，
在回答正文中用 dsh-fuse 围栏输出 JSON 规格，渲染器会渲染成真实页面 UI。这是页面级组件体系，
与 dsh-ui（对话内小卡片）互补——页面类产物一律用 dsh-fuse。

### 页面类型（根 type，必须取其一）
${FUSE_PAGE_KINDS.join(' / ')}

### 组件词汇（白名单，只允许这些 type）
${FUSE_COMPONENT_TYPES.join(' ')}

### 结构
{"type":"<页面类型>","title":"页面标题","theme":"default","components":[...]}
- components 内每个元素必须有合法 type；未知 type 整体拒绝渲染
- 根节点可加 "actions":[{"action":"name","label":"按钮文字","tone":"primary|ghost"}] 放页面主操作
- 交互组件（button/input/select/checkbox/radio）带 "action":"name" 时，点击后以 [fuse-action] 回传；
  不带 action 的按钮渲染为禁用态
- 表单类页面：input/select/textarea 用 label 字段标注，按钮 style="primary" 为主操作（每页只有一个主操作）

### 设计令牌（theme.json，theme 字段选主题名）
${summarizeTheme()}

### 代码规范（code-style.json，Fuse 生成配套代码时必守）
${summarizeCodeStyle()}

### 走查微调
用户点击预览中某个元素后，会收到 [fuse-inspect] + 该元素的 getComputedStyle 样式数据。
根据样式数据定位问题（间距/圆角/配色/字号），输出修正后的完整 dsh-fuse 围栏重新渲染，
不要解释过程。预览卡右上角提供 ↩️ 撤销（最近 10 次快照）。`

// ---------- 预检工具：validate_fuse_spec ----------

const VALIDATE_TOOL = {
  name: 'validate_fuse_spec',
  description: 'Fuse 页面级 UI 规格预检：校验 dsh-fuse fence 的 JSON 体（白名单组件/页面类型/结构限制），返回校验报告。输出 dsh-fuse 围栏前先调用，坏规格被拒绝渲染。',
  parameters: {
    type: 'object',
    properties: {
      spec: { type: 'object', description: 'dsh-fuse fence 的 JSON 规格对象（不是字符串）' },
    },
    required: ['spec'],
    additionalProperties: false,
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        errors: { type: 'array', items: { type: 'string' } },
      },
      required: ['ok', 'errors'],
    },
    render(args, value) {
      const ok = value.ok === true
      const head = ok ? '✅ Fuse 规格校验通过' : '❌ Fuse 规格校验失败'
      const body = value.errors.length > 0 ? value.errors.join('\n') : '可安全渲染'
      return [{ type: 'text', text: `${head}\n${body}` }]
    },
  },
  async execute(args) {
    const spec = args?.spec
    const errors = validateFuseSpec(spec)
    return { ok: errors.length === 0, errors }
  },
}

/** 校验 dsh-fuse 规格（白名单 + 结构 + 预算），返回错误列表（空=通过） */
export function validateFuseSpec(spec) {
  const errors = []
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return ['规格必须是 JSON 对象']
  }
  const kind = spec.type
  if (!FUSE_PAGE_KINDS.includes(kind)) {
    errors.push(`未知页面类型 "${kind}"，可选：${FUSE_PAGE_KINDS.join(' / ')}`)
  }
  if (spec.theme !== undefined && !(themeConfig?.themes ?? {})[spec.theme]) {
    errors.push(`未知主题 "${spec.theme}"，可选：${Object.keys(themeConfig?.themes ?? {}).join(' / ')}`)
  }
  const comps = spec.components
  if (!Array.isArray(comps)) {
    errors.push('components 必须是数组')
    return errors
  }
  if (comps.length === 0) errors.push('components 不能为空')
  if (comps.length > 60) errors.push('components 超过 60 个节点上限')
  const walk = (node, depth) => {
    if (depth > 8) { errors.push('嵌套超过 8 层'); return }
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      errors.push('组件必须是 JSON 对象'); return
    }
    const t = node.type
    if (!FUSE_COMPONENT_TYPES.includes(t)) {
      errors.push(`未知组件类型 "${t}"，可选：${FUSE_COMPONENT_TYPES.join(' / ')}`)
      return
    }
    // 组件容器（items 是组件树）才递归；nav/tabs/hero 的 items/actions 是
    // 数据结构（{text,active} / {label,content} / 按钮描述），不递归校验
    const COMPONENT_CONTAINERS = new Set(['page', 'card', 'grid', 'row', 'col', 'section', 'form'])
    if (COMPONENT_CONTAINERS.has(t)) {
      const items = node.items ?? node.components
      if (items === undefined) {
        errors.push(`容器组件 "${t}" 需要 items/components 数组`)
      } else if (Array.isArray(items)) {
        for (const it of items) walk(it, depth + 1)
      }
    }
  }
  for (const c of comps) walk(c, 1)
  return errors
}

// ---------- 插件入口 ----------

export function apply(ctx) {
  // 1. 系统指令注册：fence 语言 + 令牌 + 代码规范（硬注入 systemPrompt 已在 export const inject 声明）
  ctx.systemPrompt.section({
    name: 'fuse',
    order: FUSE_SECTION_ORDER,
    text: FUSE_SECTION_TEXT,
  })

  // 2. validate_fuse_spec 工具：tools 服务可选（genui 同款探测，注册失败不致命）
  let toolsRegistered = false
  const tryRegisterTools = (tools) => {
    if (toolsRegistered || tools === undefined) return
    try {
      tools.register(VALIDATE_TOOL)
      toolsRegistered = true
    } catch (err) {
      console.warn('[dsh-fuse] validate_fuse_spec 注册失败：', err instanceof Error ? err.message : String(err))
    }
  }
  tryRegisterTools(ctx.reflect?.get('tools', false))
  ctx.on('internal/service', (e) => { if (e?.name === 'tools') tryRegisterTools(e.value) })

  // 3. webServer：GET /api/fuse/config 返回完整令牌与代码规范（浏览器渲染器拉取）
  //    官方契约：kind='prefix' + Node 风格 (req, res) handler（biomemory 同款）；
  //    不能直接访问 ctx.webServer（未注入时 Proxy getter 抛），用 ctx.inject 懒注入
  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(() => httpCtx.webServer.register({
      kind: 'prefix',
      path: '/api/fuse',
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'https://dsh.invalid')
        const p = url.pathname.replace(/^\/api\/fuse/, '') || '/'
        res.setHeader('content-type', 'application/json; charset=utf-8')
        const send = (code, body) => {
          res.statusCode = code
          res.end(JSON.stringify(body))
        }
        if (req.method === 'GET' && p === '/config') {
          return send(200, {
            themes: themeConfig?.themes ?? {},
            codeStyle: codeStyleConfig,
            pageKinds: FUSE_PAGE_KINDS,
            componentTypes: FUSE_COMPONENT_TYPES,
          })
        }
        return send(404, { ok: false, error: 'not found' })
      },
    }), 'dsh-fuse: config API')
  })

  ctx.logger?.info?.('[dsh-fuse] 启动完成：系统指令 + validate_fuse_spec + /api/fuse/config')
}
