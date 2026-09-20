// ============================================================================
// dsh-fuse · spec-validator.mjs —— 规格校验规则【单一事实来源】
//
// 职责：把「dsh-fuse 围栏规格」的校验规则从宿主（index.mjs）与浏览器半区
// （client.js）里抽出来，集中在这一处维护：页面类型白名单 / 组件词汇白名单 /
// 容器递归集合 / tabs 内容递归 / 节点预算 60 / 嵌套深度 8 / theme 白名单。
//
// 为什么还需要生成步骤：client.js 必须保持「浏览器可直接加载的自包含单文件」
// （经 window.__ModuleLoader__.load 加载，不能 import 仓库里的相对文件）。因此
// scripts/build-client.mjs 把本文件里带 SENTINEL 标记的代码块（见文件中的
// SPEC_VALIDATOR_REGION_BEGIN 常量）「逐字节」注入 client.js 的
// `#region spec-validator (generated)` 区间：
//
//     spec-validator.mjs  ──(npm run build:client)──▶  client.js 生成区间
//     index.mjs           ──(import)───────────────▶  spec-validator.mjs
//
// 生成区间的文本 = 原样复制 + 统一缩进，所以两侧规则必然同构；`npm run
// build:client -- --check`（CI + 单测）比对「重新生成的 client.js」与「仓库里的
// client.js」，只改一边就会失败——根治「两份实现各自漂移」。
//
// ⚠ 维护须知：
//   1. 校验规则只能改在本文件的 REGION 区间内。改 client.js 的生成区间无效：
//      build 会覆盖它、--check 会直接报错。
//   2. 改完跑 `npm run build:client` 重新生成 client.js 并提交。
//   3. REGION 内不得出现 ESM import/export（要被浏览器直接执行），也不得引用
//      模块作用域的其它标识符（提取后整体注入 client.js 的闭包，闭包内可能重名）。
//   4. 「容器递归集合」与「组件词汇表」有意分开：词汇表按类别分组（container/
//      display/form），递归集合只含 items 是「组件树」的容器——tabs/hero/nav/
//      header/footer 的 items 是数据结构，不递归。
// ============================================================================

import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const SOURCE_TEXT = fs.readFileSync(fileURLToPath(import.meta.url), 'utf8')

// 说明：常量（FUSE_PAGE_KINDS / FUSE_COMPONENT_TYPES / FUSE_CONTAINER_TYPES /
// FUSE_MAX_NODES / FUSE_MAX_DEPTH）与校验函数都定义在下面的 REGION 区间内，
// 并在区间之后用 `export { … }` 导出——「被注入 client.js 的那份」与「宿主 import
// 的那份」因此是同一段源码，而不是各写一份。

/**
 * 组件词汇白名单（按类别分组）。拍平顺序 = 渲染器接受顺序：未知 type 整体拒绝渲染。
 * 注意 container 组包含 tabs/hero/nav/header/footer——它们是布局容器，但 items 是
 * 数据结构而非组件树，见 FUSE_CONTAINER_TYPES。
 */
export const FUSE_COMPONENT_GROUPS = {
  container: ['page', 'card', 'grid', 'row', 'col', 'nav', 'header', 'footer', 'section', 'tabs', 'hero'],
  display: ['text', 'badge', 'stat', 'list', 'table', 'divider', 'avatar', 'chart', 'steps'],
  form: ['form', 'input', 'select', 'textarea', 'checkbox', 'radio', 'button', 'link'],
}

/** 组件词汇白名单拍平顺序（单测用它与 REGION 内的拍平清单对拍） */
export const FUSE_COMPONENT_TYPES_FLAT = [
  ...FUSE_COMPONENT_GROUPS.container,
  ...FUSE_COMPONENT_GROUPS.display,
  ...FUSE_COMPONENT_GROUPS.form,
]

// JS 语法无关的源码标记（本身是合法注释），所以区间可独立编译/执行，便于自检。
// 标记必须独占一行，并且这里的字符串常量本身不能出现在其它注释里（否则 indexOf 会错位）。
const SPEC_VALIDATOR_REGION_BEGIN = '// @@SPEC_VALIDATOR_REGION@@'
const SPEC_VALIDATOR_REGION_END = '// @@SPEC_VALIDATOR_REGION_END@@'

/** 生成区间在 client.js 中的包裹标记（构建脚本与 --check 共用同一份字面量） */
export const SPEC_VALIDATOR_HEADER = '// #region spec-validator (generated) — do not edit'
export const SPEC_VALIDATOR_FOOTER = '// #endregion spec-validator (generated)'

// @@SPEC_VALIDATOR_REGION@@
// ▼▼▼ 以下代码块被 scripts/build-client.mjs 逐字节提取并注入 client.js ▼▼▼
// （浏览器直接执行：禁用 ESM import/export，禁止引用模块作用域外的标识符）
const FUSE_PAGE_KINDS = [
  'login_form', 'signup_form', 'dashboard', 'settings_page', 'table_page',
  'landing_page', 'profile_card', 'pricing_page', 'modal', 'form',
]

const FUSE_COMPONENT_TYPES = [
  'page', 'card', 'grid', 'row', 'col', 'nav', 'header', 'footer', 'section', 'tabs', 'hero',
  'text', 'badge', 'stat', 'list', 'table', 'divider', 'avatar', 'chart', 'steps',
  'form', 'input', 'select', 'textarea', 'checkbox', 'radio', 'button', 'link',
]

// 容器组件（items/components 是组件树）才递归；nav/hero/header/footer/tabs 的 items
// 是数据结构（导航项/按钮描述/tab 描述），chart.data 是数据点，都不递归校验
const FUSE_CONTAINER_TYPES = ['page', 'card', 'grid', 'row', 'col', 'section', 'form']

/** 节点预算：全部节点（含嵌套容器与 tabs 内容）计数上限 */
const FUSE_MAX_NODES = 60
/** 最大嵌套深度 */
const FUSE_MAX_DEPTH = 8

/** 判断值是否为可递归的组件节点对象 */
const isFuseComponentNode = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** 已知主题名集合：空集合 = 不做主题校验（令牌未就绪时放行，避免假阳性） */
const toFuseThemeSet = (themeNames) => {
  const set = new Set()
  if (typeof themeNames === 'string') set.add(themeNames)
  else if (Array.isArray(themeNames) || themeNames instanceof Set) for (const n of themeNames) set.add(n)
  return set
}

/** 从 /api/fuse/config 风格的载荷里取主题名（宿主与前端共用同一解析口径） */
const themeNamesFromConfig = (payload) => {
  const themes = payload?.themes
  if (!themes || typeof themes !== 'object') return []
  return Object.keys(themes)
}

/**
 * 校验 dsh-fuse 规格：白名单（页面类型 / 组件 / 主题）+ 结构 + 容器递归 + 预算。
 * @param {unknown} spec 围栏 JSON 规格（对象）
 * @param {{ themeNames?: Iterable<string>|string|null }} [options] 已知主题名；缺省/空 = 跳过
 * @returns {string[]} 错误列表（空数组 = 通过）
 */
const validateFuseSpec = (spec, options) => {
  const errors = []
  if (spec === null || typeof spec !== 'object' || Array.isArray(spec)) {
    return ['规格必须是 JSON 对象']
  }
  if (!FUSE_PAGE_KINDS.includes(spec.type)) {
    errors.push(`未知页面类型 "${spec.type}"，可选：${FUSE_PAGE_KINDS.join(' / ')}`)
  }
  const themeSet = toFuseThemeSet(options ? options.themeNames : undefined)
  // v1.2.5（自审 F5）：README 与 SKILL 都写「theme 必填、不许白板」，而这里此前只在"提供了 theme"
  // 时才校验 → 缺 theme 的规格照样按默认主题渲染，规范形同虚设。现在缺 theme 直接判错。
  if (spec.theme === undefined || spec.theme === null || spec.theme === '') {
    errors.push(`缺少必填字段 theme（可选：${[...themeSet].join(' / ') || 'default / apple / dark'}）`)
  } else if (themeSet.size > 0 && !themeSet.has(spec.theme)) {
    errors.push(`未知主题 "${spec.theme}"，可选：${[...themeSet].join(' / ')}`)
  }
  // 产品上下文（可选）：声明产品/受众/任务，仅允许对象形态，字段不强制
  if (spec.context !== undefined && !isFuseComponentNode(spec.context)) {
    errors.push('context 必须是对象（product/audience/task 之一或多个）')
  }
  const comps = spec.components
  if (!Array.isArray(comps)) {
    errors.push('components 必须是数组')
    return errors
  }
  if (comps.length === 0) errors.push('components 不能为空')
  let count = 0
  let budgetHit = false
  const walk = (node, depth) => {
    if (budgetHit) return
    count++
    // 节点预算：超限即报错并拒绝整份规格（含嵌套计数）
    if (count > FUSE_MAX_NODES) {
      budgetHit = true
      errors.push(`节点数超过 ${FUSE_MAX_NODES} 个上限（含嵌套容器），拒绝渲染`)
      return
    }
    if (depth > FUSE_MAX_DEPTH) { errors.push(`嵌套超过 ${FUSE_MAX_DEPTH} 层`); return }
    if (!isFuseComponentNode(node)) {
      errors.push('组件必须是 JSON 对象'); return
    }
    const t = node.type
    if (!FUSE_COMPONENT_TYPES.includes(t)) {
      errors.push(`未知组件类型 "${t}"，可选：${FUSE_COMPONENT_TYPES.join(' / ')}`)
      return
    }
    if (FUSE_CONTAINER_TYPES.includes(t)) {
      const items = node.items ?? node.components
      if (items === undefined) {
        errors.push(`容器组件 "${t}" 需要 items/components 数组`)
      } else if (Array.isArray(items)) {
        for (const it of items) walk(it, depth + 1)
      }
    }
    // tabs：items[].content / items[].items 是组件树（渲染器 renderNode 会递归渲染），
    // 必须一并递归校验，否则 tab 内的非法组件能过预检、却必被渲染器拒绝
    if (t === 'tabs') {
      const tabs = Array.isArray(node.items) ? node.items : []
      for (const it of tabs) {
        if (!isFuseComponentNode(it)) continue
        const sub = it.content ?? it.items
        if (sub === undefined) continue
        if (!Array.isArray(sub)) { errors.push('tabs 项的 content/items 必须是数组'); continue }
        for (const s of sub) walk(s, depth + 1)
      }
    }
  }
  for (const c of comps) walk(c, 1)
  return errors
}

// @@SPEC_VALIDATOR_REGION_END@@

// 导出 REGION 区间内的常量与校验器（导出语句在标记之外，因此不会被注入 client.js）
export {
  validateFuseSpec,
  themeNamesFromConfig,
  FUSE_PAGE_KINDS,
  FUSE_COMPONENT_TYPES,
  FUSE_CONTAINER_TYPES,
  FUSE_MAX_NODES,
  FUSE_MAX_DEPTH,
}

/**
 * 宿主入口：把「已知主题名」（theme.json 的 themes）注入校验器。
 * 宿主 index.mjs 只认这一层，因此宿主与前端对同一批规格必然是同一套判定。
 */
export function createHostValidator(themeNames) {
  const names = [...toFuseThemeSet(themeNames)]
  return (spec) => validateFuseSpec(spec, { themeNames: names })
}

/** ⚠ 自检：被提取的区间必须只含「常量 + 函数表达式」，不得出现 ESM 语句 */
const REGION_FORBIDDEN = /^\s*(?:import|export)\b/m

// ---------- 生成区间的提取 / 评估 / 差分（构建脚本与测试共用） ----------

/** 从任意源码文本里截取 REGION 标记之间的代码（不含标记行本身） */
export function extractSpecValidatorRegion(source) {
  // 标记必须「独占一行且整行内容恰好等于标记」（防止常量赋值行/说明注释被误命中）
  const first = (marker) => {
    const body = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const m = new RegExp(`^[ \\t]*${body}[ \\t]*\\r?$`, 'm').exec(source)
    if (!m) throw new Error(`源码缺少独占一行的 ${marker} 标记`)
    return m
  }
  const begin = first(SPEC_VALIDATOR_REGION_BEGIN)
  const end = first(SPEC_VALIDATOR_REGION_END)
  if (end.index <= begin.index) throw new Error('REGION 结束标记出现在开始标记之前')
  const afterBegin = source.indexOf('\n', begin.index)
  if (afterBegin < 0 || afterBegin > end.index) throw new Error('REGION 标记之间没有代码')
  return source.slice(afterBegin + 1, end.index)
}

/** 本文件（单一事实来源）里的 REGION 源码 */
export function specValidatorRegionSource() {
  const region = extractSpecValidatorRegion(SOURCE_TEXT)
  const hit = REGION_FORBIDDEN.exec(region)
  if (hit) throw new Error(`REGION 区间出现 ESM ${hit[0].trim()}（浏览器直接执行，不允许）`)
  return region
}

/** 统一缩进（只加前导空格，不改任何内容），用于嵌入客户端闭包层级 */
export function indentSpecValidatorRegion(region, indent) {
  return region
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : indent + line))
    .join('\n')
}

const REGION_EXPORT_NAMES = [
  'FUSE_PAGE_KINDS', 'FUSE_COMPONENT_TYPES', 'FUSE_CONTAINER_TYPES', 'FUSE_MAX_NODES', 'FUSE_MAX_DEPTH',
  'themeNamesFromConfig',
]

/**
 * 在干净上下文里评估 REGION 源码，返回其中声明的校验器与常量。
 * 既验证「提取出来的代码块自包含、可被浏览器直接执行」，也供差分对拍取前端侧实现。
 */
export function loadSpecValidatorRegion(region, { filename = 'spec-validator-region.js' } = {}) {
  const code = `(() => {\n${region}\nreturn { validateFuseSpec, ${REGION_EXPORT_NAMES.join(', ')} }\n})()`
  const exported = vm.runInNewContext(code, {}, { filename, timeout: 1000 })
  if (typeof exported?.validateFuseSpec !== 'function') {
    throw new Error('REGION 源码里没有可用的 validateFuseSpec（校验器必须定义在该区间内）')
  }
  for (const n of REGION_EXPORT_NAMES) {
    if (exported[n] === undefined) throw new Error(`REGION 源码缺少 ${n} 声明`)
  }
  return exported
}

/** 取规格的错误列表（传函数或模块命名空间都行） */
function callValidator(validator, spec, options) {
  const fn = typeof validator === 'function' ? validator : validator?.validateFuseSpec
  if (typeof fn !== 'function') throw new TypeError('validator 必须是校验函数或含 validateFuseSpec 的模块')
  const out = fn(spec, options)
  return Array.isArray(out) ? out : []
}

/**
 * 差分对拍：同一批规格分别喂给两侧校验器，逐条比对 accept/reject 判定。
 * 返回 { ok, total, diffs }；diffs 的 kind 区分「假阳性」（宿主放行/前端拒绝）
 * 与「假阴性」（宿主拒绝/前端放行）——两者都必须为 0。
 */
export function compareSpecValidators(hostValidator, clientValidator, cases, options) {
  if (!Array.isArray(cases)) throw new TypeError('cases 必须是数组（[{name, spec, options?}]）')
  const diffs = []
  for (const [i, item] of cases.entries()) {
    const name = item?.name ?? `#${i}`
    const opts = item?.options === undefined ? options : item.options
    const hostErrors = callValidator(hostValidator, item?.spec, opts)
    const clientErrors = callValidator(clientValidator, item?.spec, opts)
    const hostRejects = hostErrors.length > 0
    const clientRejects = clientErrors.length > 0
    if (hostRejects !== clientRejects) {
      diffs.push({
        name,
        kind: hostRejects ? '假阴性：宿主拒绝但前端放行' : '假阳性：宿主放行但前端拒绝',
        hostErrors,
        clientErrors,
      })
    }
  }
  return { ok: diffs.length === 0, total: cases.length, diffs }
}

/** 默认对拍样本集：合法路径 + 各条拒绝路径 + 深度/预算边界 + tabs 递归 */
export function specValidatorDiffCases() {
  const text = (content) => ({ type: 'text', content })
  const deepChain = (levels) => {
    let node = text('x')
    for (let i = 0; i < levels; i++) node = { type: 'card', items: [node] }
    return node
  }
  return [
    ['合法登录页', { type: 'login_form', theme: 'default', components: [{ type: 'input', label: 'U' }, { type: 'button', text: 'go', action: 'go' }] }],
    ['未知页面类型', { type: 'spaceship', components: [text('x')] }],
    ['非对象规格 null', null],
    ['非对象规格字符串', 'login'],
    ['数组规格', [1, 2]],
    ['未知组件类型', { type: 'form', components: [{ type: 'magic-widget' }] }],
    ['components 缺失', { type: 'form' }],
    ['components 为空', { type: 'form', components: [] }],
    ['非对象组件', { type: 'form', components: ['text'] }],
    ['容器缺 items', { type: 'form', components: [{ type: 'grid', cols: 2 }] }],
    ['容器 items 递归合法', { type: 'dashboard', components: [{ type: 'grid', cols: 2, items: [{ type: 'stat', label: 'A', value: '1' }] }] }],
    ['tabs 内合法组件', { type: 'dashboard', components: [{ type: 'tabs', items: [{ label: 'A', content: [{ type: 'stat', label: 'L', value: '1' }] }] }] }],
    ['tabs 内非法组件', { type: 'dashboard', components: [{ type: 'tabs', items: [{ label: 'A', content: [text('x')] }, { label: 'B', content: [{ type: 'nope' }] }] }] }],
    ['tabs 项 content 非数组', { type: 'dashboard', components: [{ type: 'tabs', items: [{ label: 'A', content: 'x' }] }] }],
    ['tabs 纯数据结构', { type: 'dashboard', components: [{ type: 'tabs', items: [{ label: 'A' }] }] }],
    ['nav 的 items 不递归', { type: 'dashboard', components: [{ type: 'nav', items: [{ text: '首页', active: true }] }] }],
    ['context 合法对象', { type: 'dashboard', context: { product: '网页', audience: '个人', task: '看数据' }, components: [text('x')] }],
    ['context 非法形态', { type: 'dashboard', context: 'web', components: [text('x')] }],
    ['深度 8 层（边界内）', { type: 'form', components: [deepChain(7)] }],
    ['深度 9 层（越界）', { type: 'form', components: [deepChain(9)] }],
    ['节点数 60（预算内）', { type: 'form', components: Array.from({ length: 59 }, (_, i) => text(String(i))) }],
    ['节点数 61（越界）', { type: 'form', components: Array.from({ length: 60 }, (_, i) => text(String(i))) }],
    ['嵌套容器计入预算（12×5=72）', { type: 'form', components: Array.from({ length: 12 }, () => ({ type: 'row', items: Array.from({ length: 5 }, (_, i) => text(String(i))) })) }],
    ['theme 已知', { type: 'form', theme: 'apple', components: [text('x')] }],
    ['theme 未知', { type: 'form', theme: 'neon-rainbow', components: [text('x')] }],
  ]
}
