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
    // 节点预算：全部节点（含嵌套容器）计数上限，与宿主 index.mjs 的 FUSE_MAX_NODES
    // 必须保持一致——两侧判定不同构就会出现「宿主说可安全渲染、前端却拒绝」的假阳性
    const MAX_NODES = 60
    const MAX_DEPTH = 8

    const CODE_BLOCK_SELECTORS = 'pre, .md-code-block, .code-block, .code-block-small, [data-lang]'

    // 白名单组件词汇（与 host 侧 FUSE_COMPONENT_TYPES 一致）
    const CONTAINER_TYPES = new Set(['page', 'card', 'grid', 'row', 'col', 'section', 'tabs', 'hero', 'nav', 'header', 'footer', 'form'])
    const DISPLAY_TYPES = new Set(['text', 'badge', 'stat', 'list', 'table', 'divider', 'avatar', 'chart', 'steps'])
    const FORM_TYPES = new Set(['input', 'select', 'textarea', 'checkbox', 'radio', 'button', 'link'])
    const ALL_TYPES = new Set([...CONTAINER_TYPES, ...DISPLAY_TYPES, ...FORM_TYPES])
    const PAGE_KINDS = new Set(['login_form', 'signup_form', 'dashboard', 'settings_page', 'table_page', 'landing_page', 'profile_card', 'pricing_page', 'modal', 'form'])

    // 走查高亮色阶（文档 §6.2）：黄=已选中 蓝=采集中 紫=修正中 红=失败
    const INSPECT_COLORS = { selected: '#FACC15', collecting: '#3B82F6', fixing: '#8B5CF6', failed: '#EF4444' }

    // ---------- 全局样式 ----------
    // 插件自生 UI 令牌（两组分离）：
    //   --fs-shell-* = 插件壳令牌（预览卡/工具栏/设置页/高亮反馈/画布渐变）——默认
    //                  浅色（themes.default 同构），深色由 html[data-dsh-theme="dark"]
    //                  覆盖（值 = themes.dark 令牌，soft/阴影/渐变派生自令牌），
    //                  与围栏 theme 无关（installShellThemeSync 探测 DSH 主题）；
    //   --fs-*/--fuse-* = 渲染产物令牌（applyTheme 按围栏主题写入卡片根，不动）。
    const FS_TOKENS_CSS = `
:root{
  /* ---- 壳令牌（浅色 default 语义）---- */
  --fs-shell-bg:#FFFFFF;
  --fs-shell-surface:#F5F6F8;
  --fs-shell-text:#1A1A1A;
  --fs-shell-muted:#6B7280;
  --fs-shell-border:#E5E7EB;
  --fs-shell-primary:#2563EB;
  --fs-shell-secondary:#8B5CF6;
  --fs-shell-accent:#0EA5E9;
  --fs-shell-success:#2E7D32;
  --fs-shell-warning:#ED6C02;
  --fs-shell-error:#C62828;
  --fs-shell-primary-soft:color-mix(in srgb,var(--fs-shell-primary) 8%,transparent);
  --fs-shell-secondary-soft:color-mix(in srgb,var(--fs-shell-secondary) 10%,transparent);
  --fs-shell-accent-soft:color-mix(in srgb,var(--fs-shell-accent) 8%,transparent);
  --fs-shell-success-soft:color-mix(in srgb,var(--fs-shell-success) 12%,transparent);
  --fs-shell-warning-soft:color-mix(in srgb,var(--fs-shell-warning) 12%,transparent);
  --fs-shell-error-soft:color-mix(in srgb,var(--fs-shell-error) 10%,transparent);
  --fs-shell-error-border:color-mix(in srgb,var(--fs-shell-error) 32%,transparent);
  --fs-shell-shadow-card:0 1px 3px rgba(26,26,26,.08);
  --fs-shell-shadow-float:0 10px 30px rgba(26,26,26,.14);
  /* 画布呼吸：中性面 → 极淡主色渐变（壳背景用） */
  --fs-shell-grad:linear-gradient(180deg,var(--fs-shell-surface),color-mix(in srgb,var(--fs-shell-primary) 3%,var(--fs-shell-surface)));
  /* ---- 渲染产物令牌（默认 = default 主题；applyTheme 覆盖到卡片根）---- */
  --fs-primary:#2563EB;
  --fs-accent:#0EA5E9;
  --fs-bg:#FFFFFF;
  --fs-surface:#F5F6F8;
  --fs-text:#1A1A1A;
  --fs-muted:#6B7280;
  --fs-border:#E5E7EB;
  --fs-success:#2E7D32;
  --fs-warning:#ED6C02;
  --fs-error:#C62828;
  --fs-primary-soft:rgba(37,99,235,.08);
  --fs-success-soft:rgba(46,125,50,.10);
  --fs-warning-soft:rgba(237,108,2,.10);
  --fs-error-soft:rgba(198,40,40,.08);
  --fs-error-border:rgba(198,40,40,.32);
  --fs-radius-sm:8px;
  --fs-radius-md:12px;
  --fs-radius-lg:16px;
  --fs-space-xs:4px;
  --fs-space-sm:8px;
  --fs-space-md:16px;
  --fs-space-lg:24px;
  --fs-space-xl:32px;
  --fs-fs-caption:12px;
  --fs-fs-body:14px;
  --fs-fs-bodylg:16px;
  --fs-fs-h3:20px;
  --fs-fs-h2:28px;
  --fs-fs-h1:36px;
  --fs-fs-display:48px;
  --fs-lh-body:1.7;
  --fs-lh-heading:1.25;
  --fs-shadow-card:0 1px 3px rgba(26,26,26,.08);
  --fs-shadow-float:0 10px 30px rgba(26,26,26,.14);
  --fs-font:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Roboto,sans-serif;
  /* 走查高亮色阶：黄=已选中 蓝=采集中 紫=修正中 红=失败 */
  --fs-highlight-selected:#FACC15;
  --fs-highlight-collecting:#3B82F6;
  --fs-highlight-fixing:#8B5CF6;
  --fs-highlight-failed:#EF4444;
}
/* 深色壳覆盖：值 = config/theme.json themes.dark 令牌（radius/space/字号不变）；
   data-dsh-theme 由 installShellThemeSync 按 DSH 主题属性/系统外观实时置位 */
html[data-dsh-theme="dark"]{
  --fs-shell-bg:#0F1115;
  --fs-shell-surface:#1A1D23;
  --fs-shell-text:#E8EAED;
  --fs-shell-muted:#9AA0A6;
  --fs-shell-border:#2A2E37;
  --fs-shell-primary:#22D3EE;
  --fs-shell-secondary:#A78BFA;
  --fs-shell-accent:#22D3EE;
  --fs-shell-success:#34D399;
  --fs-shell-warning:#FBBF24;
  --fs-shell-error:#F87171;
  --fs-shell-shadow-card:0 1px 3px rgba(0,0,0,.4);
  --fs-shell-shadow-float:0 10px 30px rgba(0,0,0,.5);
  /* 走查高亮深色提亮：mix 亮色（--fs-shell-text）增强可读性，色相/语义不变 */
  --fs-highlight-selected:color-mix(in srgb,#FACC15 76%,var(--fs-shell-text));
  --fs-highlight-collecting:color-mix(in srgb,#3B82F6 76%,var(--fs-shell-text));
  --fs-highlight-fixing:color-mix(in srgb,#8B5CF6 76%,var(--fs-shell-text));
  --fs-highlight-failed:color-mix(in srgb,#EF4444 76%,var(--fs-shell-text));
}
`

    const CSS = `
/* 渲染容器宽度与输入框（composer）对齐：跟随 DSH 对话内容宽度
   （--dsh-chat-content-width 由 conversation 包定义，实测 680–920px 区间；
   748px 只是变量缺失时的兜底）；全屏时也不撑满 */
.fuse-root-holder{width:100%;max-width:var(--dsh-chat-content-width,748px);margin-left:auto;margin-right:auto;box-sizing:border-box}
${FS_TOKENS_CSS}
/* ===== 插件自生 UI 壳（预览卡容器/工具栏/高亮反馈）=====
   DSH 官方变量优先（--dsw-alias-*），回落 --fs-shell-*（html[data-dsh-theme="dark"] 深色覆盖） */
.fuse-root{position:relative;font-family:var(--fs-font);color:var(--dsw-alias-label-primary,var(--fs-shell-text));line-height:var(--fs-lh-body);font-size:var(--fs-fs-body)}
.fuse-root *{box-sizing:border-box}
.fuse-card{background:var(--dsw-alias-bg-layer-1,var(--fs-shell-bg));border:1px solid var(--dsw-alias-border-l2,var(--fs-shell-border));border-radius:var(--fs-radius-lg);box-shadow:var(--fs-shell-shadow-card);overflow:hidden;transition:box-shadow .18s ease,border-color .18s ease}
.fuse-card:hover{box-shadow:var(--fs-shell-shadow-float)}
html[data-dsh-theme="dark"] .fuse-card:hover{border-color:color-mix(in srgb,var(--fs-shell-primary) 30%,var(--fs-shell-border))}
.fuse-toolbar{display:flex;align-items:center;justify-content:flex-end;gap:var(--fs-space-sm);padding:var(--fs-space-sm) var(--fs-space-md);background:var(--dsw-alias-bg-layer-2,var(--fs-shell-surface));border-bottom:1px solid var(--dsw-alias-border-l1,var(--fs-shell-border))}
.fuse-toolbar-label{margin-right:auto;font-size:var(--fs-fs-caption);color:var(--dsw-alias-label-secondary,var(--fs-shell-muted))}
.fuse-toolbar button{display:inline-flex;align-items:center;gap:var(--fs-space-xs);border:1px solid var(--dsw-alias-border-l1,var(--fs-shell-border));background:var(--dsw-alias-bg-layer-1,var(--fs-shell-bg));border-radius:var(--fs-radius-sm);padding:var(--fs-space-xs) var(--fs-space-md);font-size:var(--fs-fs-caption);font-family:inherit;cursor:pointer;color:var(--dsw-alias-label-secondary,var(--fs-shell-muted));transition:background-color .15s ease,border-color .15s ease,color .15s ease}
.fuse-toolbar button:hover{background:var(--fs-shell-primary-soft);border-color:var(--fs-shell-secondary);color:var(--fs-shell-secondary)}
/* 画布区：中性面 → 极淡主色渐变（呼吸），留白保持 lg 24px */
.fuse-body{padding:var(--fs-space-lg);background:var(--fs-shell-grad)}
.fuse-title{font-size:var(--fs-fs-h2);font-weight:600;line-height:var(--fs-lh-heading);letter-spacing:-.01em;margin:0 0 var(--fs-space-xs);color:var(--dsw-alias-label-primary,var(--fs-shell-text))}
.fuse-subtitle{font-size:var(--fs-fs-body);color:var(--dsw-alias-label-secondary,var(--fs-shell-muted));margin:0 0 var(--fs-space-lg)}
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
.fuse-error{margin:0 0 var(--fs-space-sm);padding:var(--fs-space-sm);border-radius:var(--fs-radius-sm);background:var(--fs-shell-error-soft);border:1px solid var(--fs-shell-error-border);color:var(--dsw-alias-state-error-primary,var(--fs-shell-error));font-size:var(--fs-fs-caption);line-height:1.55;white-space:pre-wrap}
.fuse-empty{padding:var(--fs-space-xs) var(--fs-space-sm);border-radius:var(--fs-radius-sm);background:var(--fs-shell-primary-soft);border:1px dashed var(--fs-shell-primary);color:var(--dsw-alias-label-secondary,var(--fs-shell-muted));font-size:var(--fs-fs-caption)}
/* 走查高亮（黄 → 蓝 → 紫 → 红） */
.fuse-inspect{outline:2px solid var(--fs-highlight-selected);outline-offset:2px;cursor:crosshair}
.fuse-inspect.collecting{outline-color:var(--fs-highlight-collecting)}
.fuse-inspect.fixing{outline-color:var(--fs-highlight-fixing)}
.fuse-inspect.failed{outline-color:var(--fs-highlight-failed)}
`

    // ---------- 工具 ----------
    function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) }

    /** 流式残缺 JSON 的补全：按字符串状态机统计未闭合括号（忽略字符串内与转义后的
        括号），按栈序补上对应闭合符；无法可靠补全（字符串未闭合 / 无未闭合括号）→ null */
    function closeJson(text) {
      const stack = []
      let inStr = false
      let esc = false
      for (const ch of text) {
        if (inStr) {
          if (esc) esc = false
          else if (ch === '\\') esc = true
          else if (ch === '"') inStr = false
          continue
        }
        if (ch === '"') inStr = true
        else if (ch === '{') stack.push('}')
        else if (ch === '[') stack.push(']')
        else if (ch === '}' || ch === ']') stack.pop()
      }
      if (inStr || stack.length === 0) return null
      return text + stack.reverse().join('')
    }

    /** 解析 fence 体：完整 JSON → 对象；流式部分 JSON → 尽力补全解析；垃圾 → null */
    function parseSpec(raw) {
      const t = raw.trim()
      if (!t) return null
      try {
        const v = JSON.parse(t)
        return isPlainObject(v) ? v : null
      } catch {
        const closed = closeJson(t)
        if (closed === null) return null
        try {
          const v = JSON.parse(closed)
          return isPlainObject(v) ? v : null
        } catch { return null }
      }
    }

    /** fence 体是否已是完整 JSON（流式中间态 = 需补括号才能解析 → false）。
        撤销快照只收完整态，避免残缺中间态挤满环形缓冲（见 pushSnapshot） */
    function isCompleteSpec(raw) {
      const t = raw.trim()
      if (!t) return false
      try { return isPlainObject(JSON.parse(t)) } catch { return false }
    }

    /** 白名单校验（与 host validateFuseSpec 同构，浏览器端预检）
        ⚠ 两侧必须同步：index.mjs 的 validateFuseSpec 是同一套规则（白名单 / 容器递归 /
        tabs 内容递归 / 节点预算 / 嵌套深度），任何一侧改动都要同步另一侧；
        唯一有意的差异：宿主额外校验 theme 是否在白名单内（前端在令牌未就绪时不做主题校验，
        未知主题回落 default 渲染），方向上只会更严，不会出现「宿主放行、前端失败」 */
    function validateSpec(spec) {
      const errors = []
      if (!isPlainObject(spec)) return ['规格必须是 JSON 对象']
      if (!PAGE_KINDS.has(spec.type)) errors.push(`未知页面类型 "${spec.type}"`)
      const comps = spec.components
      if (!Array.isArray(comps)) return [...errors, 'components 必须是数组']
      let count = 0
      let budgetHit = false
      // 组件容器（items 是组件树）才递归；nav/hero/list 的 items/actions 与 chart.data
      // 是数据结构（{text,active} / 按钮描述 / 数据点），不递归校验
      const COMPONENT_CONTAINERS = new Set(['page', 'card', 'grid', 'row', 'col', 'section', 'form'])
      const walk = (node, depth) => {
        if (budgetHit) return
        count++
        // 节点预算：超限必须报错并拒绝渲染整份规格（此前只累加计数、静默丢弃子树）
        if (count > MAX_NODES) {
          budgetHit = true
          errors.push(`节点数超过 ${MAX_NODES} 个上限（含嵌套容器），拒绝渲染`)
          return
        }
        if (depth > MAX_DEPTH) { errors.push(`嵌套超过 ${MAX_DEPTH} 层`); return }
        if (!isPlainObject(node)) { errors.push('组件必须是 JSON 对象'); return }
        if (!ALL_TYPES.has(node.type)) { errors.push(`未知组件类型 "${node.type}"`); return }
        if (COMPONENT_CONTAINERS.has(node.type)) {
          const items = node.items ?? node.components
          if (items === undefined) errors.push(`容器组件 "${node.type}" 需要 items/components 数组`)
          else if (Array.isArray(items)) for (const it of items) walk(it, depth + 1)
        }
        // tabs：items[].content / items[].items 是组件树（渲染器会递归渲染），必须一并校验，
        // 否则 tab 内的非法 type 会「预检通过 → 渲染成占位壳」（宿主侧同一段逻辑）
        if (node.type === 'tabs') {
          const tabs = Array.isArray(node.items) ? node.items : []
          for (const it of tabs) {
            if (!isPlainObject(it)) continue
            const sub = it.content ?? it.items
            if (sub === undefined) continue
            if (!Array.isArray(sub)) { errors.push('tabs 项的 content/items 必须是数组'); continue }
            for (const s of sub) walk(s, depth + 1)
          }
        }
      }
      for (const c of comps) walk(c, 1)
      if (comps.length === 0) errors.push('components 不能为空')
      return errors
    }

    // ---------- 主题令牌加载 ----------
    let THEMES = null
    let themeLoad = null
    /** 拉取 /api/fuse/config 令牌（单次请求，结果缓存；失败也缓存，避免反复重试） */
    function loadThemes() {
      if (THEMES) return Promise.resolve(THEMES)
      if (!themeLoad) {
        themeLoad = fetch(CONFIG_API, { headers: { accept: 'application/json' } })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => { THEMES = data?.themes ?? null; return THEMES })
          .catch(() => { THEMES = null; return null })
      }
      return themeLoad
    }

    /** 首帧令牌补齐的重试标记（每张卡片根最多补一次，避免 promise 自旋） */
    const themeRetried = new WeakSet()

    /** 应用主题令牌为 CSS 变量（--fuse-* 与 --fs-* 供渲染产物，随围栏 theme 覆盖卡片根；
        --fs-shell-* 为插件壳专用，不作为围栏 theme 覆盖对象，由 installShellThemeSync 管理） */
    function applyTheme(root, themeName) {
      const theme = (THEMES && THEMES[themeName]) || (THEMES && THEMES.default) || null
      if (!theme) {
        // 首帧令牌未就绪（apply() 未 await 拉取）：先用 :root 里的字面量默认色渲染，
        // 令牌到达后只覆盖同一卡片根的变量（不重建整树，避免闪烁与重排）
        if (root && !themeRetried.has(root)) {
          themeRetried.add(root)
          loadThemes().then((themes) => { if (themes) applyTheme(root, themeName) })
        }
        return
      }
      const set = (k, v) => { if (v !== undefined && v !== null) root.style.setProperty(k, v) }
      const c = theme.colors ?? {}
      const s = theme.spacing ?? {}
      const r = theme.radius ?? {}
      const t = theme.typography ?? {}
      const fb = theme.feedback ?? {}
      set('--fuse-primary', c.primary)
      set('--fuse-accent', c.accent)
      set('--fuse-bg', c.neutralBg)
      set('--fuse-surface', c.neutralSurface)
      set('--fuse-text', c.neutralText)
      set('--fuse-muted', c.neutralTextMuted)
      set('--fuse-border', c.border)
      set('--fuse-success', fb.success)
      set('--fuse-warning', fb.warning)
      set('--fuse-error', fb.error)
      set('--fuse-radius-sm', r.sm !== undefined ? r.sm + 'px' : undefined)
      set('--fuse-radius-md', r.md !== undefined ? r.md + 'px' : undefined)
      set('--fuse-radius-lg', r.lg !== undefined ? r.lg + 'px' : undefined)
      if (s.md !== undefined) set('--fuse-gap', s.md + 'px')
      if (t.fontFamily) root.style.setProperty('--fuse-font', t.fontFamily)
      // 渲染产物壳外令牌（--fs-* 尺寸/圆角/字体 + 产物标题色）：值随规格主题覆盖；
      // 注意：插件壳专用令牌 --fs-shell-* 不在此覆盖（跟随 DSH 主题，见 installShellThemeSync）
      set('--fs-primary', c.primary)
      set('--fs-accent', c.accent)
      set('--fs-bg', c.neutralBg)
      set('--fs-surface', c.neutralSurface)
      set('--fs-text', c.neutralText)
      set('--fs-muted', c.neutralTextMuted)
      set('--fs-border', c.border)
      set('--fs-success', fb.success)
      set('--fs-warning', fb.warning)
      set('--fs-error', fb.error)
      set('--fs-radius-sm', r.sm !== undefined ? r.sm + 'px' : undefined)
      set('--fs-radius-md', r.md !== undefined ? r.md + 'px' : undefined)
      set('--fs-radius-lg', r.lg !== undefined ? r.lg + 'px' : undefined)
      const px = (v) => (v !== undefined && v !== null ? v + 'px' : undefined)
      set('--fs-space-xs', px(s.xs))
      set('--fs-space-sm', px(s.sm))
      set('--fs-space-md', px(s.md))
      set('--fs-space-lg', px(s.lg))
      set('--fs-space-xl', px(s.xl))
      const sz = t.sizes ?? {}
      set('--fs-fs-caption', px(sz.caption))
      set('--fs-fs-body', px(sz.body))
      set('--fs-fs-bodylg', px(sz.bodyLg))
      set('--fs-fs-h3', px(sz.h3))
      set('--fs-fs-h2', px(sz.h2))
      set('--fs-fs-h1', px(sz.h1))
      set('--fs-fs-display', px(sz.display))
      const lh = t.lineHeights ?? {}
      const lineH = (v) => (v !== undefined && v !== null ? String(v) : undefined)
      set('--fs-lh-body', lineH(lh.body))
      set('--fs-lh-heading', lineH(lh.heading))
      const sh = theme.shadow ?? {}
      set('--fs-shadow-card', sh.card)
      set('--fs-shadow-float', sh.float)
      if (t.fontFamily) root.style.setProperty('--fs-font', t.fontFamily)
    }

    // ---------- 壳主题探测（--fs-shell-* 双通道；壳跟随 DSH 主题而非围栏 theme） ----------
    // 通道1: DSH 运行时以布尔属性写 body[data-ds-dark-theme]（toggleAttribute，存在即暗色），
    //        兼容显式值 "dark"/"light"（html/body 任一命中）；通道2: prefers-color-scheme 兜底。
    // 结果同步为 documentElement 的 data-dsh-theme（作用于整页壳），监听变化实时更新；
    // 多实例同源写入幂等：observer 各管各的，值一致，互不干扰。
    function detectShellDark() {
      for (const el of [document.body, document.documentElement]) {
        if (el && el.hasAttribute('data-ds-dark-theme')) {
          return el.getAttribute('data-ds-dark-theme') !== 'light'
        }
      }
      try {
        return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
      } catch { return false }
    }

    function syncShellThemeAttr() {
      const root = document.documentElement
      if (detectShellDark()) root.setAttribute('data-dsh-theme', 'dark')
      else root.removeAttribute('data-dsh-theme')
    }

    function installShellThemeSync() {
      syncShellThemeAttr()
      let obs = null
      if (typeof MutationObserver !== 'undefined') {
        // 观察整页 data-ds-dark-theme（body 挂载前也能命中 html 根）
        obs = new MutationObserver(syncShellThemeAttr)
        obs.observe(document.documentElement, {
          subtree: true,
          attributes: true,
          attributeFilter: ['data-ds-dark-theme'],
        })
      }
      let mq = null
      const onMq = () => syncShellThemeAttr()
      try {
        mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)')
        if (mq) mq.addEventListener('change', onMq)
      } catch { mq = null }
      return () => {
        if (obs) obs.disconnect()
        if (mq && mq.removeEventListener) mq.removeEventListener('change', onMq)
      }
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
          const current = Number(node.current) || 0
          steps.forEach((s, i) => {
            const row = el('div', 'fuse-steps')
            const dot = el('div', 'dot ' + (i < current ? 'done' : i === current ? '' : 'pending'), String(i + 1))
            const t = el('div')
            // title/desc 来自模型 fence（不可信输入）：一律用 DOM 节点 / textContent 构造，
            // 禁止 innerHTML 拼接（否则 <img onerror> / <script> 类载荷会被解析执行）
            t.appendChild(el('b', null, String(s?.title ?? '')))
            if (s?.desc) t.appendChild(document.createTextNode(' — ' + String(s.desc)))
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
        case 'page': {
          // page 在白名单与校验器的容器集合里，渲染器此前漏了该分支 → 合法规格被渲染成
          // 「未知组件: page」占位壳；此处按容器语义渲染 items
          const p = el('div')
          const items = Array.isArray(node.items ?? node.components) ? (node.items ?? node.components) : []
          items.forEach((it, i) => {
            const [n] = renderNode(it, ctx, key + ':page:' + i)
            p.appendChild(n)
          })
          return [p, true]
        }
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
        // 渲染状态（observed：规格合法 ≠ 渲染正确，随走查回传供 expected→observed→diff→fix）
        const crect = container.getBoundingClientRect()
        const erect = styleTarget.getBoundingClientRect()
        const overflowX = container.scrollWidth > container.clientWidth + 1
        const overflowY = container.scrollHeight > container.clientHeight + 1
        const clipped = erect.left < crect.left - 1 || erect.right > crect.right + 1 || erect.top < crect.top - 1 || erect.bottom > crect.bottom + 1
        styles.renderState = {
          viewport: { width: Math.round(crect.width), height: Math.round(crect.height) },
          overflow: overflowX || overflowY ? { x: overflowX, y: overflowY } : false,
          clipped,
          primaryButtonCount: container.querySelectorAll('.fuse-btn.primary').length,
          rect: { left: Math.round(erect.left - crect.left), top: Math.round(erect.top - crect.top), width: Math.round(erect.width), height: Math.round(erect.height) },
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
      const msg = `[fuse-inspect] 用户在 Fuse 预览中点击了元素 "${elementKey}"（fence ${fenceKey}）。\n走查器采集到的样式数据与渲染状态: ${payload}\n注意：validate_fuse_spec 通过只代表规格合法（Spec valid），渲染状态是实际结果（Render correct），二者可能不一致。修正流程：expected（你的规格意图）→ observed（上述数据）→ diff（间距/圆角/配色/字号/溢出/主按钮重复）→ fix（输出修正后的完整 dsh-fuse 围栏重新渲染，不要解释过程）。`
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

    /** 压栈（撤销用）：只收「结构完整」的快照，并与上一条 raw 去重。
        修复：流式过程中的残缺/非法中间态此前也入栈，10 格很快被占满，撤销退不回真实历史 */
    function pushSnapshot(fenceKey, spec, raw) {
      if (!isPlainObject(spec) || !Array.isArray(spec.components) || spec.components.length === 0) return false
      const arr = snapshots.get(fenceKey) ?? []
      const last = arr[arr.length - 1]
      if (last && last.raw === raw) return false
      arr.push({ spec, raw })
      if (arr.length > SNAPSHOT_CAP) arr.shift()
      snapshots.set(fenceKey, arr)
      return true
    }

    /** 渲染完整预览卡：工具栏（🔄 ↩️）+ 页面体；返回 [card, 错误文本] */
    function renderFenceCard(ctx, fenceKey, raw, onRerender) {
      const spec = parseSpec(raw)
      const errors = spec ? validateSpec(spec) : ['JSON 解析失败']
      const card = el('div', 'fuse-root fuse-card')
      // 工具栏：Fuse 预览标识 + 🔄 刷新预览 / ↩️ 撤销
      const toolbar = el('div', 'fuse-toolbar')
      const label = el('span', 'fuse-toolbar-label', `Fuse 预览 · ${spec?.theme ?? 'default'}`)
      const undoBtn = el('button', null, '↩️ 撤销')
      undoBtn.title = '回退到上一次微调前的状态（最近 10 次快照）'
      const refreshBtn = el('button', null, '🔄 刷新预览')
      toolbar.append(label, undoBtn, refreshBtn)
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
      // 快照：仅在「非流式」（fence 体已是完整 JSON）且渲染成功时入栈（撤销用）；
      // 流式中间态需要补括号才能解析，不是有效历史（宿主 data-streaming 属性时序不可靠，
      // 这里以 JSON 完整性作为流式判据）
      if (isCompleteSpec(raw)) pushSnapshot(fenceKey, spec, raw)
      return { card, ok: true, spec }
    }

    // ---------- DOM 通道（原版 DSH 无 fence-registry 扩展点） ----------
    function installDomFenceRenderer(ctx) {
      const style = document.createElement('style')
      style.textContent = CSS
      document.head.appendChild(style)
      const mounts = new Map() // fenceKey -> { container, block, lastRaw }

      const findBlocks = () => {
        const cans = Array.from(document.querySelectorAll(CODE_BLOCK_SELECTORS))
        return cans.filter((b) => {
          if (b.hasAttribute(PROCESSED)) return false
          // ① 语言标签 = dsh-fuse（支持常见的 pre 头/旧结构）
          const label = b.querySelector('.md-code-block__header, .code-block__header, [class*="lang"], [data-lang]')
          if (label !== null && label.textContent.trim() === FENCE_LANG) return true
          // ② 结构无关兜底：内容本身是合法 dsh-fuse 规格（新前端哈希化 class 也能拦到）
          const raw = b.tagName === 'PRE' ? b.textContent : (b.querySelector('pre')?.textContent ?? b.textContent)
          const spec = parseSpec(raw ?? '')
          return spec !== null && PAGE_KINDS.has(spec.type) && Array.isArray(spec.components)
        })
      }

      const mountOne = (block) => {
        const pre = block.tagName === 'PRE' ? block : block.querySelector('pre')
        if (!pre) return
        block.setAttribute(PROCESSED, '1')
        const fenceKey = 'fuse:' + Math.random().toString(36).slice(2, 9)
        const container = el('div', 'fuse-root-holder')
        block.style.display = 'none'
        block.parentNode?.insertBefore(container, block)
        const state = { container, block, pre, lastRaw: '', cleanup: null }
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
        // 流式节流：characterData 观察器每个 token 触发一次 → 合并到一帧（rAF）再整树重建；
        // rAF 不可用或后台标签页不触发时用 ~120ms 尾沿定时兜底（重复调用被 lastRaw 拦截）
        let rafId = 0
        let timerId = 0
        const cancelPendingRender = () => {
          if (rafId) {
            if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafId)
            rafId = 0
          }
          if (timerId) { clearTimeout(timerId); timerId = 0 }
        }
        const flushStream = () => {
          cancelPendingRender()
          const raw = pre.textContent ?? ''
          if (raw !== state.lastRaw) rerender(raw, false)
        }
        const scheduleStream = () => {
          if (rafId || timerId) return
          if (typeof requestAnimationFrame === 'function') rafId = requestAnimationFrame(flushStream)
          timerId = setTimeout(flushStream, 120)
        }
        // 观察原块文本变化（流式重渲染）
        const obs = new MutationObserver(scheduleStream)
        obs.observe(pre, { childList: true, characterData: true, subtree: true })
        state.cleanup = () => { obs.disconnect(); cancelPendingRender() }
        rerender(pre.textContent ?? '', true)
      }

      const mountAll = () => {
        for (const b of findBlocks()) {
          // 防嵌套双渲染：容器（.md-code-block 等）已接管时，跳过其内部的 pre
          // （CODE_BLOCK_SELECTORS 同时匹配容器与其中的 pre；先处理容器即标记 PROCESSED）
          if (b.closest(`[${PROCESSED}]`)) continue
          try { mountOne(b) } catch (err) { console.warn('[dsh-fuse] 渲染失败：', err) }
        }
      }

      // 观察对话区新增代码块
      const observer = new MutationObserver(mountAll)
      observer.observe(document.body, { childList: true, subtree: true })
      // 1s 兜底清扫（历史加载、漏批属性批次）
      const sweep = setInterval(mountAll, SWEEP_MS)
      // 初始清扫
      mountAll()
      return () => {
        clearInterval(sweep)
        observer.disconnect()
        // 还原被接管的代码块，卸载挂载容器，移除插件样式
        for (const { container, block, cleanup } of mounts.values()) {
          cleanup?.()
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
        subtitle: '页面级 UI 渲染插件：设计令牌（theme.json）与代码规范（code-style.json）配置',
        loading: '正在读取配置…',
        unavailable: '暂时无法读取 Fuse 配置（/api/fuse/config），渲染器不受影响。',
        tabTokens: '设计令牌',
        tabCode: '代码规范',
        tabDemo: '实时示例',
        theme: '主题',
        themeNote: '切换主题可预览对应令牌值；渲染产物按围栏 theme 字段自动应用。',
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

      // 主题按钮三色 preview 圆点（主色/底/边框；数据驱动，零硬编码色值）
      const themeDots = (name) => {
        const c = (cfg.themes?.[name] ?? {}).colors ?? {}
        return {
          '--fs-t-primary': c.primary || 'transparent',
          '--fs-t-bg': c.neutralBg || 'transparent',
          '--fs-t-border': c.border || 'transparent',
        }
      }

      // 色板块
      const colorChip = (label, value, key) => {
        if (value === undefined || value === null) return null
        return h('div', { className: 'fs-chip fs-chip-' + String(key).replace(/^key-/, ''), key }, [
          h('span', { key: 'swatch', className: 'fs-swatch', style: { background: value } }),
          h('span', { key: 'label', className: 'fs-chip-label' }, label),
          h('code', { key: 'value' }, String(value)),
        ])
      }

      // Tab 1：设计令牌
      const tokensSection = h('div', { key: 'tokens', className: 'fs-block' }, [
        h('h4', { key: 'h-theme' }, t.theme),
        h('p', { key: 'theme-note', className: 'fs-note' }, t.themeNote),
        h('div', { key: 'theme-row', className: 'fs-theme-row' }, themeNames.map((name) => h('button', {
          key: name,
          className: 'fs-theme-btn' + (name === themeName ? ' active' : ''),
          onClick: () => setThemeName(name),
          style: themeDots(name),
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

      // Tab 2：代码规范（速览自审清单 + 完整 JSON）
      const cs = cfg.codeStyle ?? {}
      const quick = [
        cs.naming?.components ? `组件命名 ${cs.naming.components}` : null,
        cs.formatting?.indentSize ? `缩进 ${cs.formatting.indentSize} 空格` : null,
        cs.formatting?.quoteStyle ? `引号 ${cs.formatting.quoteStyle}` : null,
        cs.formatting?.semicolons ? '统一分号' : null,
        cs.syntax?.preferConst ? 'const 优先' : null,
        cs.syntax?.typescriptStrict ? 'TS strict' : null,
        cs.css?.colorUsage ? 'CSS 只取设计令牌' : null,
      ].filter(Boolean)
      const codeSection = h('div', { key: 'code', className: 'fs-block' }, [
        h('p', { key: 'note', className: 'fs-note' }, t.codeNote),
        quick.length > 0 ? h('div', { key: 'quick', className: 'fs-quick' },
          quick.map((q, i) => h('span', { key: 'q' + i, className: 'fs-quick-item' }, q))) : null,
        h('pre', { key: 'code-json', className: 'fs-pre fs-code' }, JSON.stringify(cfg.codeStyle ?? {}, null, 2)),
      ])

      // Tab 3：实时示例（标注当前主题语义，浅色/深色）
      const demoSection = h('div', { key: 'demo', className: 'fs-block' }, [
        h('p', { key: 'note', className: 'fs-note' }, t.demoNote),
        h('div', { key: 'demo-body', ref: demoRef, className: 'fs-demo fs-demo-' + themeName }),
      ])

      const body = cfg.kind === 'loading' ? h('div', { key: 'loading', className: 'fs-note' }, t.loading)
        : cfg.kind === 'error' ? h('div', { key: 'err', className: 'fs-err' }, t.unavailable)
        : tab === 'tokens' ? tokensSection : tab === 'code' ? codeSection : demoSection

      return h('div', { className: 'fs-page' }, [
        h('style', { key: 'styles' }, FS_STYLES),
        h('div', { key: 'header', className: 'fs-header' }, [
          h('h3', { key: 'title' }, t.title),
          h('p', { key: 'subtitle', className: 'fs-subtitle' }, t.subtitle),
        ]),
        h('div', { key: 'tabs', className: 'fs-tabs' }, [tabBtn('tokens', t.tabTokens), tabBtn('code', t.tabCode), tabBtn('demo', t.tabDemo)]),
        body,
      ])
    }

    const FS_STYLES = `
${FS_TOKENS_CSS}
/* ===== 设置页（settings.section）：规范工作台 · 分段工具切换 + 卡片式色板 ===== */
.fs-page{display:flex;flex-direction:column;gap:var(--fs-space-lg);max-width:860px;font-size:var(--fs-fs-body);color:var(--dsw-alias-label-primary,var(--fs-shell-text));line-height:var(--fs-lh-body)}
.fs-header{display:flex;flex-direction:column;gap:var(--fs-space-xs)}
.fs-page h3{margin:0;font-size:var(--fs-fs-h3);font-weight:600;letter-spacing:-.01em;line-height:var(--fs-lh-heading)}
.fs-subtitle{margin:0;font-size:var(--fs-fs-body);color:var(--dsw-alias-label-secondary,var(--fs-shell-muted))}
.fs-page h4{margin:0 0 var(--fs-space-sm);font-size:var(--fs-fs-bodylg);font-weight:600;display:flex;align-items:center;gap:var(--fs-space-sm);color:var(--dsw-alias-label-primary,var(--fs-shell-text))}
.fs-page h4::before{content:"";width:4px;height:16px;border-radius:999px;background:linear-gradient(180deg,var(--fs-shell-primary),var(--fs-shell-secondary));flex:none}
.fs-page h5{margin:var(--fs-space-md) 0 var(--fs-space-sm);font-size:var(--fs-fs-caption);font-weight:600;color:var(--dsw-alias-label-secondary,var(--fs-shell-muted))}
.fs-tabs{display:flex;gap:var(--fs-space-xs);padding:var(--fs-space-xs);border:1px solid var(--dsw-alias-border-l1,var(--fs-shell-border));border-radius:var(--fs-radius-md);background:var(--dsw-alias-bg-layer-2,var(--fs-shell-surface));width:max-content}
.fs-tab{padding:var(--fs-space-xs) var(--fs-space-md);border:1px solid transparent;border-radius:calc(var(--fs-radius-sm) - 2px);background:none;color:var(--dsw-alias-label-secondary,var(--fs-shell-muted));cursor:pointer;font-size:var(--fs-fs-caption);font-weight:500;font-family:inherit;transition:background-color .15s ease,border-color .15s ease,color .15s ease,box-shadow .15s ease}
.fs-tab:hover{color:var(--dsw-alias-label-primary,var(--fs-shell-text));background:var(--dsw-alias-bg-layer-1,var(--fs-shell-bg))}
.fs-tab.active{background:var(--dsw-alias-bg-layer-1,var(--fs-shell-bg));border-color:var(--dsw-alias-border-l2,var(--fs-shell-border));color:var(--fs-shell-primary);font-weight:600;box-shadow:var(--fs-shell-shadow-card)}
.fs-block{padding:var(--fs-space-lg);border:1px solid var(--dsw-alias-border-l2,var(--fs-shell-border));border-radius:var(--fs-radius-lg);background:var(--dsw-alias-bg-layer-1,var(--fs-shell-bg));box-shadow:var(--fs-shell-shadow-card)}
.fs-note{color:var(--dsw-alias-label-secondary,var(--fs-shell-muted));font-size:var(--fs-fs-caption);margin:0}
.fs-err{color:var(--dsw-alias-state-error-primary,var(--fs-shell-error));font-size:var(--fs-fs-caption);margin:0;padding:var(--fs-space-md);border:1px solid var(--fs-shell-error-border);border-radius:var(--fs-radius-md);background:var(--fs-shell-error-soft)}
.fs-theme-row{display:flex;gap:var(--fs-space-sm);flex-wrap:wrap;margin:var(--fs-space-sm) 0 var(--fs-space-md)}
.fs-theme-btn{display:inline-flex;align-items:center;gap:var(--fs-space-sm);padding:var(--fs-space-sm) var(--fs-space-md);border:1px solid var(--dsw-alias-border-l1,var(--fs-shell-border));border-radius:var(--fs-radius-sm);background:var(--dsw-alias-bg-layer-2,var(--fs-shell-surface));cursor:pointer;font-size:var(--fs-fs-caption);font-weight:500;font-family:inherit;color:var(--dsw-alias-label-primary,var(--fs-shell-text));transition:border-color .15s ease,background-color .15s ease,color .15s ease}
.fs-theme-btn::before{content:"";width:18px;height:8px;flex:none;background:
  radial-gradient(circle at 3px 4px,var(--fs-t-primary,transparent) 0 2.5px,transparent 3px),
  radial-gradient(circle at 9px 4px,var(--fs-t-bg,transparent) 0 2.5px,transparent 3px),
  radial-gradient(circle at 15px 4px,var(--fs-t-border,transparent) 0 2.5px,transparent 3px),
  radial-gradient(circle at 3px 4px,var(--dsw-alias-border-l1,var(--fs-shell-border)) 0 3.5px,transparent 4px),
  radial-gradient(circle at 9px 4px,var(--dsw-alias-border-l1,var(--fs-shell-border)) 0 3.5px,transparent 4px),
  radial-gradient(circle at 15px 4px,var(--dsw-alias-border-l1,var(--fs-shell-border)) 0 3.5px,transparent 4px)}
.fs-theme-btn:hover{border-color:var(--fs-shell-secondary);background:var(--fs-shell-secondary-soft)}
.fs-theme-btn.active{border-color:var(--fs-shell-primary);background:var(--fs-shell-primary-soft);color:var(--fs-shell-primary);font-weight:600;box-shadow:0 0 0 1px var(--fs-shell-primary-soft)}
.fs-token-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--fs-space-md)}
.fs-token-col{display:flex;flex-direction:column;gap:var(--fs-space-sm);padding:var(--fs-space-md);border:1px solid var(--dsw-alias-border-l1,var(--fs-shell-border));border-radius:var(--fs-radius-md);background:var(--dsw-alias-bg-layer-2,var(--fs-shell-surface))}
.fs-chips{display:flex;flex-direction:column;gap:var(--fs-space-sm);margin-top:var(--fs-space-xs)}
.fs-chip{display:flex;align-items:center;gap:var(--fs-space-sm);font-size:var(--fs-fs-caption);padding:var(--fs-space-sm);border-radius:var(--fs-radius-sm);background:var(--dsw-alias-bg-layer-1,var(--fs-shell-bg))}
.fs-chip::after{content:"";margin-left:auto;color:var(--dsw-alias-label-tertiary,var(--fs-shell-muted))}
.fs-chip-primary::after{content:"品牌主色 · 主操作/焦点"}
.fs-chip-accent::after{content:"强调色 · 渐变/点缀"}
.fs-chip-bg::after{content:"页面背景"}
.fs-chip-surface::after{content:"卡片表面"}
.fs-chip-text::after{content:"正文文字"}
.fs-chip-muted::after{content:"弱化说明"}
.fs-chip-border::after{content:"分隔边框"}
.fs-chip-success::after{content:"成功反馈"}
.fs-chip-warning::after{content:"警告反馈"}
.fs-chip-error::after{content:"错误反馈"}
.fs-chip-label{width:52px;flex:none;color:var(--dsw-alias-label-secondary,var(--fs-shell-muted));font-weight:500}
.fs-swatch{width:22px;height:22px;border-radius:var(--fs-radius-sm);flex:none;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l1,var(--fs-shell-border))}
.fs-chip code{font-family:ui-monospace,Consolas,monospace;font-size:var(--fs-fs-caption);color:var(--dsw-alias-label-secondary,var(--fs-shell-muted))}
.fs-pre{background:var(--dsw-alias-bg-layer-2,var(--fs-shell-surface));border:1px solid var(--dsw-alias-border-l1,var(--fs-shell-border));border-radius:var(--fs-radius-sm);padding:var(--fs-space-md);font-family:ui-monospace,Consolas,monospace;font-size:var(--fs-fs-caption);overflow:auto;margin:0;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-primary,var(--fs-shell-text))}
.fs-code{max-height:440px}
/* 代码规范速览 · 自审清单（数据驱动，随 code-style.json 渲染） */
.fs-quick{display:flex;flex-wrap:wrap;gap:var(--fs-space-sm);margin:0 0 var(--fs-space-md)}
.fs-quick-item{display:inline-flex;align-items:center;gap:var(--fs-space-xs);padding:var(--fs-space-xs) var(--fs-space-sm);border-radius:999px;border:1px solid var(--dsw-alias-border-l1,var(--fs-shell-border));background:var(--dsw-alias-bg-layer-2,var(--fs-shell-surface));color:var(--dsw-alias-label-secondary,var(--fs-shell-muted));font-size:var(--fs-fs-caption)}
.fs-quick-item::before{content:"✓";color:var(--fs-shell-success)}
/* 实时示例：标注当前主题语义（浅色/深色） */
.fs-demo{padding:var(--fs-space-md);background:var(--dsw-alias-bg-layer-2,var(--fs-shell-surface));border-radius:var(--fs-radius-sm)}
.fs-demo::after{display:block;margin-top:var(--fs-space-sm);font-size:var(--fs-fs-caption);color:var(--dsw-alias-label-secondary,var(--fs-shell-muted))}
.fs-demo-default::after{content:"默认主题 · 浅色语义"}
.fs-demo-apple::after{content:"苹果风格 · 浅色语义"}
.fs-demo-dark::after{content:"暗黑科技 · 深色语义"}
.fs-demo .fuse-card{max-width:420px;margin:0 auto}
`;

    function apply(ctx) {
      runtimeCtx = ctx
      loadThemes()
      const disposers = []
      // 壳主题同步（--fs-shell-* 跟随 DSH 主题，与围栏 theme 解耦）
      disposers.push(installShellThemeSync())

      // 设置页注册（biomemory 同款：settings.section slots 注入；缺失容错，不阻断）
      try {
        disposers.push(ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'fuse-settings',
          order: 70,
          label: () => FS_COPY['zh-CN'].title,
        }, FuseSettingsPage)), 'dsh-fuse: settings'))
      } catch (e) {
        console.info('[dsh-fuse] 设置页注册跳过（slots 未注入）', e instanceof Error ? e.message : e)
      }

      // Registry channel: host 提供 registerFenceRenderer 时直挂（契约宿主）
      let primitives = null
      try { primitives = require('@deepseek-ai/dsh-client-ui-primitives') ?? {} } catch (e) { primitives = null }
      const registerFn = primitives?.registerFenceRenderer
      if (typeof registerFn === 'function') {
        try {
          disposers.push(registerFn(FENCE_LANG, (raw, key, context) => {
            // 返回 ReactNode 需要 React——零依赖下用轻量桥：若 React 可用则用，
            // 否则降级 DOM 通道。契约宿主场景通常也有 React；这里保持简单：
            return renderFenceCard(ctx, `fence:${String(key)}`, raw, () => {}).card
          }))
          console.info('[dsh-fuse] fence-registry 通道已挂载')
        } catch (e) {
          console.info('[dsh-fuse] registry 挂载失败，回退 DOM 通道', e instanceof Error ? e.message : e)
          disposers.push(installDomFenceRenderer(ctx))
        }
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
