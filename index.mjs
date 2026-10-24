// ============================================================================
// dsh-fuse v2.0 · host 半区（小而美：只做「告诉模型怎么写围栏」+「给浏览器端发令牌」）
//
// 职责只有两件：
//   1. 系统指令注册（systemPrompt.section）：dsh-fuse 围栏语法 + 设计令牌摘要
//   2. GET /api/fuse/config：把 theme.json 的令牌发给浏览器端渲染器
//
// 已移除（v2.0）：代码规范注入（code-style.json）、validate_fuse_spec 预检工具、
// 设置页支撑点（settings.section / 客户端 ui-settings 注入）。
// 官方契约：PromptSection = { name, order, text }；webServer 必须用 ctx.inject 懒注入。
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  FUSE_PAGE_KINDS,
  FUSE_COMPONENT_TYPES,
  FUSE_MAX_NODES,
  FUSE_MAX_DEPTH,
  FUSE_SECTION_ORDER,
  buildFuseSectionText,
  summarizeTheme,
} from './spec.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const inject = ['systemPrompt']

export { FUSE_PAGE_KINDS, FUSE_COMPONENT_TYPES, FUSE_MAX_NODES, FUSE_MAX_DEPTH, FUSE_SECTION_ORDER }

function readTheme() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'config', 'theme.json'), 'utf8'))
  } catch (err) {
    console.warn('[dsh-fuse] 读取 config/theme.json 失败，使用空令牌：', err instanceof Error ? err.message : String(err))
    return null
  }
}

/** dsh-fuse fence 语言规范（注入系统指令） */
export const FUSE_SECTION_TEXT = buildFuseSectionText(summarizeTheme(readTheme()))

export function apply(ctx) {
  const themeConfig = readTheme()

  ctx.systemPrompt.section({
    name: 'fuse',
    order: FUSE_SECTION_ORDER,
    text: FUSE_SECTION_TEXT,
  })

  // 浏览器端渲染器拉取令牌（官方契约：kind='prefix' + Node 风格 (req,res) handler）
  ctx.inject(['webServer'], (httpCtx) => {
    httpCtx.effect(() => httpCtx.webServer.register({
      kind: 'prefix',
      path: '/api/fuse',
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'https://dsh.invalid')
        const p = url.pathname.replace(/^\/api\/fuse/, '') || '/'
        res.setHeader('content-type', 'application/json; charset=utf-8')
        const send = (code, body) => { res.statusCode = code; res.end(JSON.stringify(body)) }
        if (req.method === 'GET' && p === '/config') {
          return send(200, {
            themes: themeConfig?.themes ?? {},
            pageKinds: FUSE_PAGE_KINDS,
            componentTypes: FUSE_COMPONENT_TYPES,
            limits: { maxNodes: FUSE_MAX_NODES, maxDepth: FUSE_MAX_DEPTH },
          })
        }
        return send(404, { ok: false, error: 'not found' })
      },
    }), 'dsh-fuse: config API')
  })

  ctx.logger?.info?.('[dsh-fuse] v2.0 启动：围栏规范 + /api/fuse/config（无预检工具、无设置页）')
}
