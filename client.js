// ============================================================================
// dsh-fuse · browser half (client.js)
// Fuse v1.0 —— UI 设计 + 代码规范一体化插件（ui-aesthetics 技能升级版）
//
// 契约: 本文件是 web dsh.client 包的浏览器半区，由 __ModuleLoader__ 加载：
//   window.__ModuleLoader__.load({ id, factory })
// factory(require) 返回 cordis 客户端插件 { apply }。纯 DOM 实现，零依赖。
//
// 能力（对应开发文档 §3.1 v1.0 核心功能）：
//   1. dsh-fuse fence 渲染器：页面级 UI（登录页/仪表盘/表单…）渲染到对话流
//   2. 走查器（Inspector）：点击预览元素 → getComputedStyle 采集 → 结构化
//      回传 Agent（[fuse-inspect]）→ 高亮色阶反馈（黄→蓝→紫→消失/红）
//   3. 撤销/历史回退：环形缓冲暂存最近 10 次快照，预览卡右上角 ↩️ 回退
//   4. 设计令牌：启动时拉取 /api/fuse/config 的 theme.json，CSS 变量注入
//
// 渲染通道（与 genui 同款双通道）：
//   [Registry channel] host 提供 registerFenceRenderer('dsh-fuse', …) 时直挂
//   [DOM channel]      原版 DSH 无扩展点 → MutationObserver 观察对话 DOM，
//                      接管标 dsh-fuse 的代码块（.md-code-block）
// ============================================================================
window.__ModuleLoader__.load({
  id: 'dsh-fuse',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // ---------- 常量 ----------
    const CONFIG_API = '/api/fuse/config'
    const FENCE_LANG = 'dsh-fuse'
    const PROCESSED = 'data-fuse-rendered'
    const STREAMING = '[data-streaming]'
    const SWEEP_MS = 1000
    const SNAPSHOT_CAP = 10            // 撤销历史环形缓冲上限（文档 §6.3）
    const MAX_NODES = 200              // 节点预算（防恶意输入，同 genui 量级）
    const MAX_DEPTH = 8

    const CODE_BLOCK_SELECTORS = '.md-code-block, .code-block, .code-block-small'

    // 白名单组件词汇（与 host 侧 FUSE_COMPONENT_TYPES 一致）
    const CONTAINER_TYPES = new Set(['page', 'card', 'grid', 'row', 'col', 'section', 'tabs', 'hero', 'nav', 'header', 'footer', 'form'])
    const DISPLAY_TYPES = new Set(['text', 'badge', 'stat', 'list', 'table', 'divider', 'avatar', 'chart', 'steps'])
    const FORM_TYPES = new Set(['input', 'select', 'textarea', 'checkbox', 'radio', 'button', 'link'])
    const ALL_TYPES = new Set([...CONTAINER_TYPES, ...DISPLAY_TYPES, ...FORM_TYPES])
    const PAGE_KINDS = new Set(['login_form', 'signup_form', 'dashboard', 'settings_page', 'table_page', 'landing_page', 'profile_card', 'pricing_page', 'modal', 'form'])

    // 走查高亮色阶（文档 §6.2）：黄=已选中 蓝=采集中 紫=修正中 红=失败
    const INSPECT_COLORS = { selected: '#FACC15', collecting: '#3B82F6', fixing: '#8B5CF6', failed: '#EF4444' }

    // ---------- 全局样式（含令牌 CSS 变量占位） ----------
    const CSS = `
.fuse-root{position:relative;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Roboto,sans-serif;color:var(--fuse-text,#1A1A1A);line-height:1.7;font-size:14px}
.fuse-root *{box-sizing:border-box}
.fuse-card{background:var(--fuse-bg,#fff);border:1px solid var(--fuse-border,#E5E7EB);border-radius:var(--fuse-radius-lg,16px);box-shadow:var(--fuse-shadow-card,0 1px 3px rgba(26,26,26,.08));overflow:hidden}
.fuse-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:6px;padding:8px 12px;background:var(--fuse-surface,#F5F6F8);border-bottom:1px solid var(--fuse-border,#E5E7EB)}
.fuse-toolbar button{border:1px solid var(--fuse-border,#E5E7EB);background:#fff;border-radius:8px;padding:3px 10px;font-size:12px;cursor:pointer;color:#55585E}
.fuse-toolbar button:hover{background:#F2F4F7}
.fuse-body{padding:20px 24px}
.fuse-title{font-size:28px;font-weight:600;line-height:1.25;margin:0 0 4px;color:var(--fuse-text,#1A1A1A)}
.fuse-subtitle{font-size:14px;color:var(--fuse-muted,#6B7280);margin:0 0 20px}
.fuse-label{display:block;font-size:12px;font-weight:500;color:var(--fuse-muted,#6B7280);margin-bottom:5px}
.fuse-input{width:100%;height:42px;padding:0 12px;border:1px solid var(--fuse-border,#E5E7EB);border-radius:var(--fuse-radius-sm,8px);font-size:14px;background:#fff;color:var(--fuse-text,#1A1A1A);margin-bottom:14px}
.fuse-input:focus{outline:2px solid var(--fuse-primary,#2563EB);outline-offset:-1px;border-color:transparent}
.fuse-textarea{width:100%;padding:10px 12px;border:1px solid var(--fuse-border,#E5E7EB);border-radius:var(--fuse-radius-sm,8px);font-size:14px;min-height:88px;resize:vertical;margin-bottom:14px}
.fuse-select{width:100%;height:42px;padding:0 12px;border:1px solid var(--fuse-border,#E5E7EB);border-radius:var(--fuse-radius-sm,8px);font-size:14px;background:#fff;margin-bottom:14px}
.fuse-check,.fuse-radio{display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:14px;cursor:pointer}
.fuse-check input,.fuse-radio input{accent-color:var(--fuse-primary,#2563EB);width:15px;height:15px}
.fuse-btn{display:inline-flex;align-items:center;justify-content:center;height:40px;padding:0 20px;border-radius:var(--fuse-radius-sm,8px);font-size:14px;font-weight:500;border:1px solid transparent;cursor:pointer;gap:6px}
.fuse-btn.primary{background:var(--fuse-primary,#2563EB);color:#fff}
.fuse-btn.primary:hover{filter:brightness(1.08)}
.fuse-btn.secondary,.fuse-btn.ghost{background:transparent;border-color:var(--fuse-border,#E5E7EB);color:var(--fuse-text,#1A1A1A)}
.fuse-btn.secondary:hover{background:var(--fuse-surface,#F5F6F8)}
.fuse-btn.danger{background:var(--fuse-error,#C62828);color:#fff}
.fuse-btn.small{height:30px;padding:0 12px;font-size:12px}
.fuse-btn.full{width:100%}
.fuse-btn[disabled]{opacity:.45;cursor:not-allowed}
.fuse-link{color:var(--fuse-primary,#2563EB);text-decoration:none;cursor:pointer}
.fuse-link:hover{text-decoration:underline}
.fuse-badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:500}
.fuse-badge.success{background:rgba(46,125,50,.12);color:var(--fuse-success,#2E7D32)}
.fuse-badge.warn{background:rgba(237,108,2,.12);color:var(--fuse-warning,#ED6C02)}
.fuse-badge.danger{background:rgba(198,40,40,.12);color:var(--fuse-error,#C62828)}
.fuse-badge.accent{background:rgba(37,99,235,.12);color:var(--fuse-primary,#2563EB)}
.fuse-grid{display:grid;gap:16px}
.fuse-row{display:flex;gap:12px;flex-wrap:wrap}
.fuse-card-box{border:1px solid var(--fuse-border,#E5E7EB);border-radius:var(--fuse-radius-md,12px);padding:16px;background:var(--fuse-surface,#F5F6F8)}
.fuse-card-box .fuse-card-title{font-size:16px;font-weight:600;margin:0 0 10px}
.fuse-stat{display:flex;flex-direction:column;gap:2px;padding:14px 16px;border:1px solid var(--fuse-border,#E5E7EB);border-radius:var(--fuse-radius-md,12px);background:#fff}
.fuse-stat .v{font-size:28px;font-weight:600;color:var(--fuse-text,#1A1A1A)}
.fuse-stat .l{font-size:12px;color:var(--fuse-muted,#6B7280)}
.fuse-table{width:100%;border-collapse:collapse;font-size:13px}
.fuse-table th{text-align:left;padding:9px 12px;border-bottom:2px solid var(--fuse-border,#E5E7EB);color:var(--fuse-muted,#6B7280);font-weight:600;font-size:12px}
.fuse-table td{padding:9px 12px;border-bottom:1px solid var(--fuse-border,#E5E7EB)}
.fuse-divider{height:1px;background:var(--fuse-border,#E5E7EB);margin:16px 0;border:0}
.fuse-list{list-style:none;margin:0;padding:0}
.fuse-list li{padding:8px 0;border-bottom:1px solid var(--fuse-border,#E5E7EB)}
.fuse-list li:last-child{border-bottom:0}
.fuse-list .t{font-size:14px;font-weight:500}
.fuse-list .d{font-size:12.5px;color:var(--fuse-muted,#6B7280)}
.fuse-nav{display:flex;gap:18px;padding:0 0 12px;border-bottom:1px solid var(--fuse-border,#E5E7EB);margin-bottom:16px;font-size:14px}
.fuse-nav a{color:var(--fuse-muted,#6B7280);text-decoration:none;cursor:pointer;padding-bottom:10px;border-bottom:2px solid transparent}
.fuse-nav a.active{color:var(--fuse-primary,#2563EB);border-bottom-color:var(--fuse-primary,#2563EB);font-weight:500}
.fuse-tabs{display:flex;gap:14px;border-bottom:1px solid var(--fuse-border,#E5E7EB);margin-bottom:14px;font-size:14px}
.fuse-tabs .tab{padding:8px 2px;cursor:pointer;color:var(--fuse-muted,#6B7280);border-bottom:2px solid transparent}
.fuse-tabs .tab.active{color:var(--fuse-primary,#2563EB);border-bottom-color:var(--fuse-primary,#2563EB);font-weight:500}
.fuse-steps{display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;font-size:13px}
.fuse-steps .dot{width:22px;height:22px;border-radius:50%;background:var(--fuse-primary,#2563EB);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;flex:none}
.fuse-steps .dot.done{background:#2E7D32}
.fuse-steps .dot.pending{background:var(--fuse-border,#E5E7EB);color:var(--fuse-muted,#6B7280)}
.fuse-hero{text-align:center;padding:40px 24px}
.fuse-hero h1{font-size:36px;font-weight:600;margin:0 0 12px;line-height:1.25}
.fuse-hero p{font-size:16px;color:var(--fuse-muted,#6B7280);margin:0 0 24px}
.fuse-hero .actions{display:flex;gap:12px;justify-content:center}
.fuse-avatar{width:40px;height:40px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:16px;flex:none}
.fuse-chart{display:flex;align-items:flex-end;gap:10px;height:140px;padding:10px 0 0}
.fuse-chart .bar{flex:1;background:var(--fuse-primary,#2563EB);border-radius:6px 6px 0 0;min-height:4px;position:relative}
.fuse-chart .bar span{position:absolute;bottom:calc(100% + 4px);left:50%;transform:translateX(-50%);font-size:11px;color:var(--fuse-muted,#6B7280)}
.fuse-error{margin:0 0 8px;padding:6px 10px;border-radius:6px;background:rgba(239,68,68,.14);border:1px solid rgba(239,68,68,.4);color:#f87171;font-size:12px;line-height:1.55;white-space:pre-wrap}
.fuse-empty{padding:6px 10px;border-radius:6px;background:rgba(37,99,235,.08);border:1px dashed var(--fuse-primary,#2563EB);color:var(--fuse-muted,#6B7280);font-size:12px}
/* 走查高亮 */
.fuse-inspect{outline:2px solid #FACC15;outline-offset:2px;cursor:crosshair}
.fuse-inspect.collecting{outline-color:#3B82F6}
.fuse-inspect.fixing{outline-color:#8B5CF6}
.fuse-inspect.failed{outline-color:#EF4444}
`

    // ---------- 工具 ----------
    function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) }

    /** 解析 fence 体：完整 JSON → 对象；流式部分 JSON → 尽力解析；垃圾 → null */
    function parseSpec(raw) {
      const t = raw.trim()
      if (!t) return null
      try {
        const v = JSON.parse(t)
        return isPlainObject(v) ? v : null
      } catch {
        // 流式部分：尝试补齐闭合括号后解析
        let depth = 0
        for (const ch of t) {
          if (ch === '{' || ch === '[') depth++
          else if (ch === '}' || ch === ']') depth--
        }
        if (depth > 0) {
          try {
            const v = JSON.parse(t + '}'.repeat(depth))
            return isPlainObject(v) ? v : null
          } catch { /* fallthrough */ }
        }
        return null
      }
    }

    /** 白名单校验（与 host validateFuseSpec 同构，浏览器端预检） */
    function validateSpec(spec) {
      const errors = []
      if (!isPlainObject(spec)) return ['规格必须是 JSON 对象']
      if (!PAGE_KINDS.has(spec.type)) errors.push(`未知页面类型 "${spec.type}"`)
      const comps = spec.components
      if (!Array.isArray(comps)) return [...errors, 'components 必须是数组']
      let count = 0
      // 组件容器（items 是组件树）才递归；nav/tabs/hero 的 items/actions 是
      // 数据结构（{text,active} / {label,content} / 按钮描述），不递归校验
      const COMPONENT_CONTAINERS = new Set(['page', 'card', 'grid', 'row', 'col', 'section', 'form'])
      const walk = (node, depth) => {
        if (count > MAX_NODES) return
        count++
        if (depth > MAX_DEPTH) { errors.push('嵌套超过 8 层'); return }
        if (!isPlainObject(node)) { errors.push('组件必须是 JSON 对象'); return }
        if (!ALL_TYPES.has(node.type)) { errors.push(`未知组件类型 "${node.type}"`); return }
        if (COMPONENT_CONTAINERS.has(node.type)) {
          const items = node.items ?? node.components
          if (items === undefined) errors.push(`容器组件 "${node.type}" 需要 items/components 数组`)
          else if (Array.isArray(items)) for (const it of items) walk(it, depth + 1)
        }
      }
      for (const c of comps) walk(c, 1)
      if (comps.length === 0) errors.push('components 不能为空')
      return errors
    }

    // ---------- 主题令牌加载 ----------
    let THEMES = null
    async function loadThemes() {
      if (THEMES) return THEMES
      try {
        const res = await fetch(CONFIG_API, { headers: { accept: 'application/json' } })
        if (!res.ok) return null
        const data = await res.json()
        THEMES = data.themes ?? null
      } catch { THEMES = null }
      return THEMES
    }

    /** 应用主题令牌为 CSS 变量（--fuse-*） */
    function applyTheme(root, themeName) {
      const theme = (THEMES && THEMES[themeName]) || (THEMES && THEMES.default) || null
      if (!theme) return
      const set = (k, v) => { if (v !== undefined && v !== null) root.style.setProperty(k, v) }
      const c = theme.colors ?? {}
      const s = theme.spacing ?? {}
      const r = theme.radius ?? {}
      const t = theme.typography ?? {}
      set('--fuse-primary', c.primary)
      set('--fuse-accent', c.accent)
      set('--fuse-bg', c.neutralBg)
      set('--fuse-surface', c.neutralSurface)
      set('--fuse-text', c.neutralText)
      set('--fuse-muted', c.neutralTextMuted)
      set('--fuse-border', c.border)
      set('--fuse-success', theme.feedback?.success)
      set('--fuse-warning', theme.feedback?.warning)
      set('--fuse-error', theme.feedback?.error)
      set('--fuse-radius-sm', r.sm !== undefined ? r.sm + 'px' : undefined)
      set('--fuse-radius-md', r.md !== undefined ? r.md + 'px' : undefined)
      set('--fuse-radius-lg', r.lg !== undefined ? r.lg + 'px' : undefined)
      if (s.md !== undefined) set('--fuse-gap', s.md + 'px')
      if (t.fontFamily) root.style.setProperty('--fuse-font', t.fontFamily)
    }

    // ---------- 组件渲染（JSON → DOM，白名单） ----------
    function el(tag, cls, text) {
      const node = document.createElement(tag)
      if (cls) node.className = cls
      if (text !== undefined) node.textContent = text
      return node
    }

    /** 渲染单个组件节点；返回 [element, inspectable]（inspectable=是否可走查） */
    function renderNode(node, ctx, key) {
      const type = node.type
      const out = (tag, cls, child) => {
        const e = el(tag, cls)
        if (child !== undefined && child !== null) {
          if (typeof child === 'string') e.textContent = child
          else if (Array.isArray(child)) for (const c of child) if (c) e.appendChild(c)
          else e.appendChild(child)
        }
        return e
      }

      switch (type) {
        // ---- 展示 ----
        case 'text': {
          const sizes = { h1: '28px', h2: '24px', h3: '20px', body: '14px', caption: '12px', muted: '12px' }
          const tag = node.size === 'h1' || node.size === 'h2' || node.size === 'h3' ? { h1: 'h1', h2: 'h2', h3: 'h3' }[node.size] : 'div'
          const e = el(tag)
          e.style.fontSize = sizes[node.size] || sizes.body
          e.style.fontWeight = node.size?.startsWith?.('h') ? 600 : undefined
          e.style.color = node.size === 'muted' ? 'var(--fuse-muted)' : undefined
          e.style.margin = node.size?.startsWith?.('h') ? '0 0 8px' : '0 0 12px'
          if (node.center) e.style.textAlign = 'center'
          e.textContent = String(node.content ?? node.text ?? '')
          return [e, true]
        }
        case 'badge': {
          const e = el('span', 'fuse-badge ' + (node.tone ?? 'accent'), node.label ?? node.text ?? '')
          return [e, true]
        }
        case 'stat': {
          const box = el('div', 'fuse-stat')
          const v = el('div', 'v', String(node.value ?? ''))
          const l = el('div', 'l', String(node.label ?? ''))
          box.append(v, l)
          return [box, true]
        }
        case 'list': {
          const ul = el('ul', 'fuse-list')
          const items = Array.isArray(node.items) ? node.items : []
          for (const it of items) {
            const li = el('li')
            if (typeof it === 'string') li.textContent = it
            else if (isPlainObject(it)) {
              const t = el('div', 't', String(it.title ?? ''))
              const d = el('div', 'd', String(it.desc ?? ''))
              li.append(t, d)
            }
            ul.appendChild(li)
          }
          return [ul, true]
        }
        case 'table': {
          const tb = el('table', 'fuse-table')
          const cols = Array.isArray(node.columns) ? node.columns : []
          const rows = Array.isArray(node.rows) ? node.rows : []
          if (cols.length > 0) {
            const tr = el('tr')
            for (const c of cols) tr.appendChild(el('th', null, String(c)))
            tb.appendChild(el('thead').appendChild(tr) && tr)
          }
          const body = el('tbody')
          for (const row of rows) {
            const tr = el('tr')
            const cells = Array.isArray(row) ? row : [row]
            for (const c of cells) tr.appendChild(el('td', null, String(c ?? '')))
            body.appendChild(tr)
          }
          tb.appendChild(body)
          return [tb, true]
        }
        case 'divider': return [el('hr', 'fuse-divider'), false]
        case 'avatar': {
          const name = String(node.name ?? '?')
          const e = el('span', 'fuse-avatar', name.slice(0, 1).toUpperCase())
          e.style.background = node.color ?? 'var(--fuse-primary,#2563EB)'
          return [e, true]
        }
        case 'chart': {
          const kind = node.kind ?? 'bars'
          const data = Array.isArray(node.data) ? node.data : []
          if (kind === 'bars') {
            const box = el('div', 'fuse-chart')
            const max = Math.max(1, ...data.map((d) => Number(d.value) || 0))
            for (const d of data) {
              const h = Math.max(4, Math.round((Number(d.value) || 0) / max * 120))
              const bar = el('div', 'bar')
              bar.style.height = h + 'px'
              bar.style.background = d.color ?? 'var(--fuse-primary,#2563EB)'
              bar.appendChild(el('span', null, String(d.value ?? '')))
              box.appendChild(bar)
            }
            return [box, true]
          }
          if (kind === 'donut') {
            const e = el('div', 'fuse-row')
            for (const d of data) {
              const seg = el('span', 'fuse-badge accent', `${d.label ?? ''} ${d.value ?? ''}`)
              e.appendChild(seg)
            }
            return [e, true]
          }
          // line: 简化折线（SVG 点线）
          const e = el('div', 'fuse-row')
          for (const d of data) e.appendChild(el('span', 'fuse-badge accent', `${d.label ?? ''} ${d.value ?? ''}`))
          return [e, true]
        }
        case 'steps': {
          const box = el('div')
          const steps = Array.isArray(node.steps) ? node.steps : []
          steps.forEach((s, i) => {
            const row = el('div', 'fuse-steps')
            const dot = el('div', 'dot ' + (i < (node.current ?? 0) ? 'done' : i === (node.current ?? 0) ? '' : 'pending'), String(i + 1))
            const t = el('div', null, `<b>${String(s.title ?? '')}</b>${s.desc ? ' — ' + String(s.desc) : ''}`)
            t.innerHTML = `<b>${String(s.title ?? '')}</b>${s.desc ? ' — ' + String(s.desc) : ''}`
            row.append(dot, t)
            box.appendChild(row)
          })
          return [box, true]
        }

        // ---- 表单 ----
        case 'input': {
          const wrap = el('div')
          if (node.label) wrap.appendChild(el('label', 'fuse-label', String(node.label)))
          const input = el('input', 'fuse-input')
          input.type = node.inputType ?? 'text'
          input.placeholder = String(node.placeholder ?? '')
          input.name = key
          if (node.action) {
            input.addEventListener('change', () => sendAction(ctx, key, node.action, { id: key, value: input.value }))
          }
          wrap.appendChild(input)
          return [wrap, true]
        }
        case 'select': {
          const wrap = el('div')
          if (node.label) wrap.appendChild(el('label', 'fuse-label', String(node.label)))
          const sel = el('select', 'fuse-select')
          const options = Array.isArray(node.options) ? node.options : []
          options.forEach((o, i) => {
            const opt = el('option', null, String(typeof o === 'string' ? o : o.label ?? o))
            if (i === node.selected) opt.selected = true
            sel.appendChild(opt)
          })
          if (node.action) sel.addEventListener('change', () => sendAction(ctx, key, node.action, { id: key, value: sel.value }))
          wrap.appendChild(sel)
          return [wrap, true]
        }
        case 'textarea': {
          const wrap = el('div')
          if (node.label) wrap.appendChild(el('label', 'fuse-label', String(node.label)))
          const ta = el('textarea', 'fuse-textarea')
          ta.placeholder = String(node.placeholder ?? '')
          if (node.action) ta.addEventListener('change', () => sendAction(ctx, key, node.action, { id: key, value: ta.value }))
          wrap.appendChild(ta)
          return [wrap, true]
        }
        case 'checkbox':
        case 'radio': {
          const wrap = el('label', 'fuse-check')
          const input = el('input')
          input.type = type
          input.checked = !!node.checked
          if (node.action) input.addEventListener('change', () => sendAction(ctx, key, node.action, { id: key, checked: input.checked }))
          wrap.append(input, el('span', null, String(node.label ?? '')))
          return [wrap, true]
        }
        case 'button': {
          const b = el('button', 'fuse-btn ' + (node.style ?? 'secondary') + (node.full ? ' full' : '') + (node.small ? ' small' : ''))
          b.textContent = String(node.text ?? '')
          if (node.action) {
            b.addEventListener('click', () => {
              b.classList.add('fuse-btn-triggered')
              sendAction(ctx, key, node.action, { id: key })
              setTimeout(() => b.classList.remove('fuse-btn-triggered'), 800)
            })
          } else {
            b.disabled = true
          }
          return [b, true]
        }
        case 'link': {
          const a = el('a', 'fuse-link', String(node.label ?? node.text ?? ''))
          if (node.href && /^https?:|^mailto:/.test(node.href)) a.href = node.href
          return [a, true]
        }

        // ---- 容器 ----
        case 'hero': {
          const hero = el('div', 'fuse-hero')
          if (node.title) hero.appendChild(el('h1', null, String(node.title)))
          if (node.subtitle) hero.appendChild(el('p', null, String(node.subtitle)))
          const actions = Array.isArray(node.actions) ? node.actions : []
          if (actions.length > 0) {
            const row = el('div', 'actions')
            for (const a of actions) {
              const [btn] = renderNode({ ...a, type: 'button' }, ctx, key + ':act:' + (a.action ?? Math.random().toString(36).slice(2)))
              row.appendChild(btn)
            }
            hero.appendChild(row)
          }
          return [hero, true]
        }
        case 'nav': {
          const nav = el('nav', 'fuse-nav')
          const items = Array.isArray(node.items) ? node.items : []
          items.forEach((it, i) => {
            const a = el('a', null, String(typeof it === 'string' ? it : it.text ?? ''))
            if (it.active || i === 0 && node.items.length === 1) a.className = 'active'
            if (isPlainObject(it) && it.active) a.className = 'active'
            nav.appendChild(a)
          })
          return [nav, true]
        }
        case 'tabs': {
          const box = el('div')
          const bar = el('div', 'fuse-tabs')
          const tabs = Array.isArray(node.items) ? node.items : []
          const content = el('div')
          let active = 0
          const renderTab = (i) => {
            content.innerHTML = ''
            const it = tabs[i]
            if (isPlainObject(it)) {
              const items = it.content ?? it.items ?? []
              for (const sub of items) {
                const [n] = renderNode(sub, ctx, key + ':tab:' + i)
                content.appendChild(n)
              }
            }
          }
          tabs.forEach((it, i) => {
            const tab = el('span', 'tab' + (i === active ? ' active' : ''), String(typeof it === 'string' ? it : it.label ?? ''))
            tab.addEventListener('click', () => {
              active = i
              for (const c of bar.children) c.className = 'tab'
              tab.className = 'tab active'
              renderTab(i)
            })
            bar.appendChild(tab)
          })
          box.append(bar, content)
          renderTab(0)
          return [box, true]
        }
        case 'grid': {
          const g = el('div', 'fuse-grid')
          g.style.gridTemplateColumns = `repeat(${node.cols ?? 2}, 1fr)`
          const items = Array.isArray(node.items) ? node.items : []
          items.forEach((it, i) => {
            const [n] = renderNode(it, ctx, key + ':grid:' + i)
            g.appendChild(n)
          })
          return [g, true]
        }
        case 'row': {
          const r = el('div', 'fuse-row')
          const items = Array.isArray(node.items) ? node.items : []
          items.forEach((it, i) => {
            const [n] = renderNode(it, ctx, key + ':row:' + i)
            r.appendChild(n)
          })
          return [r, true]
        }
        case 'col': {
          const c = el('div')
          c.style.flex = '1'
          const items = Array.isArray(node.items) ? node.items : []
          items.forEach((it, i) => {
            const [n] = renderNode(it, ctx, key + ':col:' + i)
            c.appendChild(n)
          })
          return [c, true]
        }
        case 'card': {
          const box = el('div', 'fuse-card-box')
          if (node.title) box.appendChild(el('div', 'fuse-card-title', String(node.title)))
          const items = Array.isArray(node.items) ? node.items : []
          items.forEach((it, i) => {
            const [n] = renderNode(it, ctx, key + ':card:' + i)
            box.appendChild(n)
          })
          return [box, true]
        }
        case 'section': {
          const s = el('div')
          s.style.marginBottom = '16px'
          const items = Array.isArray(node.items) ? node.items : []
          items.forEach((it, i) => {
            const [n] = renderNode(it, ctx, key + ':sec:' + i)
            s.appendChild(n)
          })
          return [s, true]
        }
        case 'form': {
          const f = el('form')
          f.addEventListener('submit', (e) => e.preventDefault())
          const items = Array.isArray(node.items) ? node.items : []
          items.forEach((it, i) => {
            const [n] = renderNode(it, ctx, key + ':form:' + i)
            f.appendChild(n)
          })
          return [f, true]
        }
        case 'header': {
          const h = el('header')
          h.style.marginBottom = '16px'
          if (node.title) h.appendChild(el('div', 'fuse-title', String(node.title)))
          if (node.subtitle) h.appendChild(el('div', 'fuse-subtitle', String(node.subtitle)))
          return [h, false]
        }
        case 'footer': {
          const f = el('footer')
          f.style.marginTop = '16px'
          f.style.fontSize = '12px'
          f.style.color = 'var(--fuse-muted)'
          f.textContent = String(node.text ?? '')
          return [f, false]
        }
        default: return [el('div', 'fuse-empty', `未知组件: ${type}`), false]
      }
    }

    // ---------- 走查器（Inspector） ----------
    /** 点击元素 → 黄框 → getComputedStyle 采集 → 蓝框 → 回传 Agent → 紫框 */
    function installInspector(container, ctx, fenceKey) {
      container.addEventListener('click', (ev) => {
        const target = ev.target.closest('.fuse-body *')
        if (!target || !container.contains(target)) return
        if (target.closest('.fuse-toolbar')) return
        // 忽略走查高亮自身与工具栏
        const styleTarget = target.closest('[data-fuse-key]') ?? target
        const key = styleTarget.dataset.fuseKey ?? fenceKey
        // 视觉反馈：黄 → 蓝（采集中）
        clearInspect(container)
        styleTarget.classList.add('fuse-inspect')
        let styles
        try {
          const cs = getComputedStyle(styleTarget)
          styles = {
            element: styleTarget.tagName.toLowerCase(),
            className: styleTarget.className || undefined,
            styles: {
              width: cs.width,
              height: cs.height,
              margin: cs.margin,
              padding: cs.padding,
              background: cs.backgroundColor,
              color: cs.color,
              borderRadius: cs.borderRadius,
              fontSize: cs.fontSize,
              lineHeight: cs.lineHeight,
              fontWeight: cs.fontWeight,
              border: cs.border,
              display: cs.display,
            },
          }
        } catch (err) {
          styleTarget.classList.remove('fuse-inspect')
          styleTarget.classList.add('fuse-inspect', 'failed')
          return
        }
        styleTarget.classList.add('collecting')
        // 回传 Agent（[fuse-inspect] + 样式数据）→ 模型定位问题 → 重新渲染
        sendInspect(ctx, fenceKey, key, styles)
        // 短暂展示紫色「修正中」（模型重渲染后整个卡片刷新，高亮消失；超时兜底清除）
        setTimeout(() => {
          styleTarget.classList.remove('collecting')
          styleTarget.classList.add('fixing')
        }, 60)
        setTimeout(() => { if (container.isConnected) clearInspect(container) }, 15000)
      })
    }

    function clearInspect(container) {
      for (const e of container.querySelectorAll('.fuse-inspect')) e.classList.remove('fuse-inspect', 'collecting', 'fixing', 'failed')
    }

    /** 发送 [fuse-inspect]：走查数据回传 Agent（scoped conversation send） */
    function sendInspect(ctx, fenceKey, elementKey, styles) {
      const sessionId = ctx?.sessions?.current?.()
      const conversation = sessionId ? ctx.sessions.scope(sessionId)?.get?.('conversation') : undefined
      const payload = JSON.stringify({ element: elementKey, ...styles })
      const msg = `[fuse-inspect] 用户在 Fuse 预览中点击了元素 "${elementKey}"（fence ${fenceKey}）。\n走查器采集到的样式数据: ${payload}\n请根据样式数据分析 UI 问题（间距/圆角/配色/字号/布局），输出修正后的完整 dsh-fuse 围栏重新渲染，不要解释过程。`
      if (conversation?.send) {
        conversation.send(msg).catch(() => { /* 会话结束则丢弃 */ })
      } else {
        console.warn('[dsh-fuse] 无 conversation 通道，走查数据未回传', msg)
      }
    }

    /** 发送 [fuse-action]：交互组件动作回传 */
    function sendAction(ctx, elementKey, action, payload) {
      const sessionId = ctx?.sessions?.current?.()
      const conversation = sessionId ? ctx.sessions.scope(sessionId)?.get?.('conversation') : undefined
      const payloadText = payload ? ` 组件数据: ${JSON.stringify(payload)}` : ''
      const msg = `[fuse-action] ${action}。用户刚刚在 Fuse 界面中触发了动作 "${action}"（元素 ${elementKey}）。${payloadText} 请根据组件数据执行相应操作，并用 dsh-fuse 输出更新后的界面。`
      if (conversation?.send) {
        conversation.send(msg).catch(() => { /* 会话结束则丢弃 */ })
      } else {
        console.warn('[dsh-fuse] 无 conversation 通道，动作未回传', msg)
      }
    }

    // ---------- 预览卡组装（fence → 卡片 + 工具栏 + 走查） ----------
    const snapshots = new Map() // fenceKey -> [{spec, raw}] 环形缓冲

    function pushSnapshot(fenceKey, spec, raw) {
      const arr = snapshots.get(fenceKey) ?? []
      arr.push({ spec, raw })
      if (arr.length > SNAPSHOT_CAP) arr.shift()
      snapshots.set(fenceKey, arr)
    }

    /** 渲染完整预览卡：工具栏（🔄 ↩️）+ 页面体；返回 [card, 错误文本] */
    function renderFenceCard(ctx, fenceKey, raw, onRerender) {
      const spec = parseSpec(raw)
      const errors = spec ? validateSpec(spec) : ['JSON 解析失败']
      const card = el('div', 'fuse-root fuse-card')
      // 工具栏：🔄 刷新预览 / ↩️ 撤销
      const toolbar = el('div', 'fuse-toolbar')
      const undoBtn = el('button', null, '↩️ 撤销')
      undoBtn.title = '回退到上一次微调前的状态（最近 10 次快照）'
      const refreshBtn = el('button', null, '🔄 刷新预览')
      toolbar.append(undoBtn, refreshBtn)
      card.appendChild(toolbar)
      const body = el('div', 'fuse-body')
      card.appendChild(body)
      // 令牌
      const themeName = spec?.theme ?? 'default'
      applyTheme(card, themeName)
      // 校验失败 → 错误提示 + 原始代码保持
      if (errors.length > 0) {
        body.appendChild(el('div', 'fuse-error', errors.join('\n')))
        return { card, ok: false, spec: null }
      }
      // 页面标题
      if (spec.title) {
        body.appendChild(el('div', 'fuse-title', String(spec.title)))
        const subtitle = spec.subtitle
        if (subtitle) body.appendChild(el('div', 'fuse-subtitle', String(subtitle)))
      }
      // 渲染组件
      const comps = Array.isArray(spec.components) ? spec.components : []
      comps.forEach((c, i) => {
        const [n] = renderNode(c, ctx, `${fenceKey}:${i}`)
        n.dataset.fuseKey = `${fenceKey}:${i}`
        body.appendChild(n)
      })
      // 撤销：回退到上一快照并重渲染
      undoBtn.addEventListener('click', () => {
        const arr = snapshots.get(fenceKey) ?? []
        if (arr.length <= 1) return
        arr.pop() // 丢弃当前
        const prev = arr[arr.length - 1]
        if (!prev) return
        onRerender(prev.raw, true)
      })
      refreshBtn.addEventListener('click', () => {
        // 重新拉取令牌后重渲染当前原始体
        loadThemes().then(() => onRerender(raw, true))
      })
      // 快照：渲染成功后记录（撤销用）
      pushSnapshot(fenceKey, spec, raw)
      return { card, ok: true, spec }
    }

    // ---------- DOM 通道（原版 DSH 无 fence-registry 扩展点） ----------
    function installDomFenceRenderer(ctx) {
      const style = document.createElement('style')
      style.textContent = CSS
      document.head.appendChild(style)
      const mounts = new Map() // fenceKey -> { container, block, lastRaw }

      const findBlocks = () => Array.from(document.querySelectorAll(CODE_BLOCK_SELECTORS))
        .filter((b) => {
          if (b.hasAttribute(PROCESSED)) return false
          const label = b.querySelector('.md-code-block__header, .code-block__header, [class*="lang"]')
          return label !== null && label.textContent.trim() === FENCE_LANG
        })

      const mountOne = (block) => {
        const pre = block.querySelector('pre')
        if (!pre) return
        block.setAttribute(PROCESSED, '1')
        const fenceKey = 'fuse:' + Math.random().toString(36).slice(2, 9)
        const container = el('div', 'fuse-root-holder')
        block.style.display = 'none'
        block.parentNode?.insertBefore(container, block)
        const state = { container, block, pre, lastRaw: '' }
        mounts.set(fenceKey, state)
        const rerender = (raw, force) => {
          if (!force && raw === state.lastRaw) return
          state.lastRaw = raw
          container.innerHTML = ''
          const { card } = renderFenceCard(ctx, fenceKey, raw, (newRaw, isHistory) => {
            rerender(newRaw, true)
          })
          container.appendChild(card)
          installInspector(container, ctx, fenceKey)
        }
        // 观察原块文本变化（流式重渲染）
        const obs = new MutationObserver(() => {
          const raw = pre.textContent ?? ''
          if (raw !== state.lastRaw) rerender(raw, false)
        })
        obs.observe(pre, { childList: true, characterData: true, subtree: true })
        rerender(pre.textContent ?? '', true)
        return () => obs.disconnect()
      }

      // 观察对话区新增代码块
      const observer = new MutationObserver(() => {
        for (const b of findBlocks()) {
          try { mountOne(b) } catch (err) { console.warn('[dsh-fuse] 渲染失败：', err) }
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
      // 1s 兜底清扫（历史加载、漏批属性批次）
      const sweep = setInterval(() => {
        for (const b of findBlocks()) {
          try { mountOne(b) } catch (err) { console.warn('[dsh-fuse] 渲染失败：', err) }
        }
      }, SWEEP_MS)
      // 初始清扫
      for (const b of findBlocks()) {
        try { mountOne(b) } catch (err) { console.warn('[dsh-fuse] 渲染失败：', err) }
      }
      return () => {
        clearInterval(sweep)
        observer.disconnect()
        // 还原被接管的代码块，卸载挂载容器，移除插件样式
        for (const { container, block } of mounts.values()) {
          container.remove()
          block.style.display = ''
          block.removeAttribute(PROCESSED)
        }
        mounts.clear()
        style.remove()
      }
    }

    // ---------- 插件主体 ----------
    // 设置页需要 slots（settings.section 注入）；走查/动作回传需要 sessions
    // （scoped conversation send）。两者都是 web 平台核心服务，硬注入安全
    //（genui/biomemory 同款）；DOM 渲染通道本身不依赖它们，但 apply 要等
    // 服务就绪后才执行——web 壳必提供，无碍。
    const inject = ['slots', 'sessions']
    // apply 时写入的运行时 ctx（设置页示例渲染等异步场景需要）
    let runtimeCtx = null

    // ==========================================================================
    // 设置页 UI（文档 §3.2「设计令牌可配置」）：设计令牌 / 代码规范 / 实时示例
    // 契约：ctx.slots.inject('settings.section', …)（biomemory client.js 同款）
    // ==========================================================================

    const FS_COPY = {
      'zh-CN': {
        title: 'Fuse · UI 设计',
        loading: '正在读取配置…',
        unavailable: '暂时无法读取 Fuse 配置（/api/fuse/config），渲染器不受影响。',
        tabTokens: '设计令牌',
        tabCode: '代码规范',
        tabDemo: '实时示例',
        theme: '主题',
        colors: '配色',
        spacing: '间距栅格',
        radius: '圆角',
        typography: '字号阶梯',
        primary: '主色',
        accent: '强调色',
        bg: '背景',
        surface: '表面',
        text: '正文',
        muted: '弱化',
        border: '边框',
        success: '成功',
        warning: '警告',
        error: '错误',
        px: 'px',
        demoNote: '以下示例使用当前主题令牌实时渲染（dsh-fuse 围栏产物）',
        demoSpec: '登录页示例',
        codeNote: 'Fuse 生成配套代码时遵循以下规范（注入系统指令，模型必守）',
      },
    }

    function FuseSettingsPage() {
      const react2 = require('react')
      const [tab, setTab] = react2.useState('tokens')
      const [cfg, setCfg] = react2.useState({ kind: 'loading', themes: null, codeStyle: null })
      const [themeName, setThemeName] = react2.useState('default')
      const demoRef = react2.useRef(null)

      react2.useEffect(() => {
        const ctrl = new AbortController()
        fetch(CONFIG_API, { credentials: 'same-origin', signal: ctrl.signal })
          .then(async (r) => {
            if (!r.ok) throw new Error('config unavailable')
            const d = await r.json()
            setCfg({ kind: 'ready', themes: d.themes ?? {}, codeStyle: d.codeStyle ?? {} })
          })
          .catch(() => setCfg({ kind: 'error', themes: null, codeStyle: null }))
        return () => ctrl.abort()
      }, [])

      // 示例页：当前主题下渲染一个登录页（复用 renderNode）
      react2.useEffect(() => {
        if (tab !== 'demo' || !demoRef.current || !cfg.themes) return
        const host = demoRef.current
        host.innerHTML = ''
        const card = document.createElement('div')
        card.className = 'fuse-root fuse-card'
        applyTheme(card, themeName)
        const body = document.createElement('div')
        body.className = 'fuse-body'
        card.appendChild(body)
        body.appendChild(Object.assign(document.createElement('div'), { className: 'fuse-title', textContent: '欢迎回来' }))
        body.appendChild(Object.assign(document.createElement('div'), { className: 'fuse-subtitle', textContent: '登录你的账户继续' }))
        const demo = {
          type: 'login_form',
          components: [
            { type: 'input', label: '用户名', placeholder: '请输入用户名' },
            { type: 'input', label: '密码', inputType: 'password' },
            { type: 'row', items: [{ type: 'checkbox', label: '记住我' }, { type: 'link', label: '忘记密码？' }] },
            { type: 'button', text: '登 录', style: 'primary', full: true },
          ],
        }
        for (const c of demo.components) {
          const [node] = renderNode(c, runtimeCtx ?? {}, 'demo:' + c.type)
          body.appendChild(node)
        }
        host.appendChild(card)
      }, [tab, themeName, cfg])

      const h = react2.createElement
      const t = FS_COPY['zh-CN']
      const themeNames = cfg.themes ? Object.keys(cfg.themes) : []
      const theme = cfg.themes?.[themeName] ?? null

      // Tab 按钮
      const tabBtn = (id, label) => h('button', {
        key: id,
        className: 'fs-tab' + (tab === id ? ' active' : ''),
        onClick: () => setTab(id),
      }, label)

      // 色板块
      const colorChip = (label, value, key) => {
        if (value === undefined || value === null) return null
        return h('div', { className: 'fs-chip', key }, [
          h('span', { className: 'fs-swatch', style: { background: value, border: '1px solid rgba(128,128,128,.25)' } }),
          h('span', { className: 'fs-chip-label' }, label),
          h('code', null, String(value)),
        ])
      }

      // Tab 1：设计令牌
      const tokensSection = h('div', { className: 'fs-block' }, [
        h('h4', { key: 'h-theme' }, t.theme),
        h('div', { key: 'theme-row', className: 'fs-theme-row' }, themeNames.map((name) => h('button', {
          key: name,
          className: 'fs-theme-btn' + (name === themeName ? ' active' : ''),
          onClick: () => setThemeName(name),
        }, name))),
        theme ? h('div', { key: 'token-grid', className: 'fs-token-grid' }, [
          h('div', { key: 'col-colors', className: 'fs-token-col' }, [
            h('h5', { key: 'h-colors' }, t.colors),
            h('div', { key: 'chips', className: 'fs-chips' }, [
              colorChip(t.primary, theme.colors?.primary, 'key-primary'),
              colorChip(t.accent, theme.colors?.accent, 'key-accent'),
              colorChip(t.bg, theme.colors?.neutralBg, 'key-bg'),
              colorChip(t.surface, theme.colors?.neutralSurface, 'key-surface'),
              colorChip(t.text, theme.colors?.neutralText, 'key-text'),
              colorChip(t.muted, theme.colors?.neutralTextMuted, 'key-muted'),
              colorChip(t.border, theme.colors?.border, 'key-border'),
              colorChip(t.success, theme.feedback?.success, 'key-success'),
              colorChip(t.warning, theme.feedback?.warning, 'key-warning'),
              colorChip(t.error, theme.feedback?.error, 'key-error'),
            ]),
          ]),
          h('div', { key: 'col-space', className: 'fs-token-col' }, [
            h('h5', { key: 'h-space' }, t.spacing),
            h('pre', { key: 'pre-space', className: 'fs-pre' }, JSON.stringify(theme.spacing ?? {}, null, 2)),
            h('h5', { key: 'h-radius' }, t.radius),
            h('pre', { key: 'pre-radius', className: 'fs-pre' }, JSON.stringify(theme.radius ?? {}, null, 2)),
          ]),
          h('div', { key: 'col-type', className: 'fs-token-col' }, [
            h('h5', { key: 'h-type' }, t.typography),
            h('pre', { key: 'pre-type', className: 'fs-pre' }, JSON.stringify(theme.typography ?? {}, null, 2)),
          ]),
        ]) : null,
      ])

      // Tab 2：代码规范
      const codeSection = h('div', { className: 'fs-block' }, [
        h('p', { key: 'note', className: 'fs-note' }, t.codeNote),
        h('pre', { key: 'code', className: 'fs-pre fs-code' }, JSON.stringify(cfg.codeStyle ?? {}, null, 2)),
      ])

      // Tab 3：实时示例
      const demoSection = h('div', { className: 'fs-block' }, [
        h('p', { key: 'note', className: 'fs-note' }, t.demoNote),
        h('div', { key: 'demo', ref: demoRef, className: 'fs-demo' }),
      ])

      const body = cfg.kind === 'loading' ? h('div', { className: 'fs-note' }, t.loading)
        : cfg.kind === 'error' ? h('div', { className: 'fs-err' }, t.unavailable)
        : tab === 'tokens' ? tokensSection : tab === 'code' ? codeSection : demoSection

      return h('div', { className: 'fs-page' }, [
        h('style', null, FS_STYLES),
        h('h3', null, t.title),
        h('div', { className: 'fs-tabs' }, [tabBtn('tokens', t.tabTokens), tabBtn('code', t.tabCode), tabBtn('demo', t.tabDemo)]),
        body,
      ])
    }

    const FS_STYLES = `
.fs-page{display:flex;flex-direction:column;gap:12px;font-size:13px;color:var(--dsw-alias-label-primary,#1f2328)}
.fs-page h3{margin:0;font-size:16px}
.fs-page h4{margin:14px 0 8px;font-size:13.5px}
.fs-page h5{margin:10px 0 6px;font-size:12.5px;color:var(--dsw-alias-label-secondary,#57606a)}
.fs-tabs{display:flex;gap:8px;border-bottom:1px solid var(--dsw-alias-border-l2,#d0d7de);padding-bottom:8px}
.fs-tab{padding:5px 12px;border:1px solid transparent;border-radius:8px;background:none;color:var(--dsw-alias-label-secondary,#57606a);cursor:pointer;font-size:12.5px}
.fs-tab.active{background:var(--dsw-alias-bg-layer-2,#f6f8fa);border-color:var(--dsw-alias-border-l2,#d0d7de);color:var(--dsw-alias-label-primary,#1f2328);font-weight:600}
.fs-block{display:flex;flex-direction:column;gap:8px}
.fs-note{color:var(--dsw-alias-label-secondary,#57606a);font-size:12.5px;margin:0}
.fs-err{color:#c62828;font-size:12.5px;margin:0}
.fs-theme-row{display:flex;gap:8px;flex-wrap:wrap}
.fs-theme-btn{padding:6px 14px;border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f6f8fa);cursor:pointer;font-size:12.5px}
.fs-theme-btn.active{border-color:#2563EB;background:rgba(37,99,235,.08);color:#2563EB;font-weight:600}
.fs-token-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}
.fs-chips{display:flex;flex-direction:column;gap:5px}
.fs-chip{display:flex;align-items:center;gap:8px;font-size:12px}
.fs-swatch{width:18px;height:18px;border-radius:5px;flex:none}
.fs-chip-label{width:44px;flex:none;color:var(--dsw-alias-label-secondary,#57606a)}
.fs-chip code{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dsw-alias-label-secondary,#57606a)}
.fs-pre{background:var(--dsw-alias-bg-layer-2,#f6f8fa);border:1px solid var(--dsw-alias-border-l2,#d0d7de);border-radius:8px;padding:10px 12px;font-family:ui-monospace,Consolas,monospace;font-size:11.5px;overflow:auto;margin:0;white-space:pre-wrap;word-break:break-all}
.fs-code{max-height:420px}
.fs-demo .fuse-card{max-width:420px;margin:0 auto}
`

    function apply(ctx) {
      runtimeCtx = ctx
      loadThemes()
      const disposers = []

      // 设置页注册（biomemory 同款：settings.section slots 注入）
      disposers.push(ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'fuse-settings',
        order: 70,
        label: () => FS_COPY['zh-CN'].title,
      }, FuseSettingsPage)), 'dsh-fuse: settings'))

      // Registry channel: host 提供 registerFenceRenderer 时直挂（契约宿主）
      const primitives = require?.('@deepseek-ai/dsh-client-ui-primitives') ?? {}
      const registerFn = primitives.registerFenceRenderer
      if (typeof registerFn === 'function') {
        disposers.push(registerFn(FENCE_LANG, (raw, key, context) => {
          // 返回 ReactNode 需要 React——零依赖下用轻量桥：若 React 可用则用，
          // 否则降级 DOM 通道。契约宿主场景通常也有 React；这里保持简单：
          return renderFenceCard(ctx, `fence:${String(key)}`, raw, () => {}).card
        }))
        console.info('[dsh-fuse] fence-registry 通道已挂载')
      } else {
        console.info('[dsh-fuse] fence-registry 扩展点不存在（原版 DSH）——启用 DOM 渲染通道')
        disposers.push(installDomFenceRenderer(ctx))
      }
      return () => { for (const d of disposers) d?.() }
    }

    module.exports = { apply, inject }
    return module.exports
  },
})
