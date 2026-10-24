// ============================================================================
// dsh-fuse v2.0 · 规格常量与系统提示词（host 半区与浏览器半区共用同一份词汇表）
//
// 注意：浏览器半区 lib/client.js 是单文件、零 import 形态，白名单在那里另有一份
// 字面量副本；tests/prompt-sync.test.mjs 用正则比对两边，任何单边改动都会失败。
// ============================================================================

/** 页面类型（规格根节点的 type 必须取其一） */
export const FUSE_PAGE_KINDS = [
  'login_form', 'signup_form', 'dashboard', 'settings_page', 'table_page',
  'landing_page', 'profile_card', 'pricing_page', 'modal', 'form',
]

/** 组件白名单（渲染器只认这些 type） */
export const FUSE_COMPONENT_TYPES = [
  'page', 'card', 'grid', 'row', 'col', 'nav', 'header', 'footer', 'section', 'tabs', 'hero',
  'text', 'badge', 'stat', 'list', 'table', 'divider', 'avatar', 'chart', 'steps', 'loading', 'skeleton',
  'progress', 'alert', 'timeline', 'code',
  'form', 'input', 'select', 'textarea', 'checkbox', 'radio', 'button', 'link',
]

/** 容器组件（items/components 是组件树，递归校验） */
export const FUSE_CONTAINER_TYPES = ['page', 'card', 'grid', 'row', 'col', 'section', 'form']

/** 节点预算与嵌套深度上限 */
export const FUSE_MAX_NODES = 60
export const FUSE_MAX_DEPTH = 8

/** 系统指令段 order：约定 100-199 为工具指引区（bash=104、genui=105、Fuse=106） */
export const FUSE_SECTION_ORDER = 106

/** 系统指令正文：只讲围栏语法 + 设计原则 + 令牌摘要（代码规范/走查两段已在 v2.0 移除） */
export function buildFuseSectionText(themeSummary) {
  return `## Fuse — 页面级 UI 渲染（dsh-fuse 围栏）

需要页面级 UI（登录/注册/仪表盘/设置/表格/落地页/个人卡片/弹窗/表单）时，在回答正文用 \`dsh-fuse\` 围栏输出 JSON 规格，渲染器会渲染成真实页面。页面类产物一律用它；对话内小卡片用 dsh-ui。

页面类型（根 type，必取其一）：
${FUSE_PAGE_KINDS.join(' / ')}

组件词汇（白名单，只允许这些 type）：
${FUSE_COMPONENT_TYPES.join(' ')}

结构：{"type":"dashboard","title":"页面标题","theme":"default","components":[...]}
- theme 必填（默认 default）；组件总数（含嵌套）≤ ${FUSE_MAX_NODES}、嵌套深度 ≤ ${FUSE_MAX_DEPTH}，超限整份拒绝渲染
- 交互组件（button/input/select/textarea/checkbox/radio）带 "action":"名字" 时点击以 [fuse-action] 回传；不带 action 的按钮渲染为禁用态
- 根节点可选 "context":{"product":"网页|APP|…","audience":"…","task":"…"}；
  可选 "actions":[{"action":"name","label":"按钮文字","tone":"primary|ghost"}] 渲染为底部主操作条（每页一个主操作）
- 设计原则：骨架（页面类型/布局/层级）→ 血肉（真实内容，不用占位壳）→ 呼吸（留白/克制配色），顺序不许倒

### 设计令牌（theme 字段选主题名）
${themeSummary}`
}

/** 把 theme.json 压成模型可见的紧凑文本（token 敏感） */
export function summarizeTheme(themeConfig) {
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
