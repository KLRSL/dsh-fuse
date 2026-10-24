// ============================================================================
// dsh-fuse v2.0 · 浏览器半区（单文件、零依赖、零设置页）
//
// 契约：dsh.client 的 web 包，由 __ModuleLoader__ 加载：
//   window.__ModuleLoader__.load({ id, factory })，factory 返回 cordis 插件 { apply, inject }
//   纯 DOM 实现，不发网络请求以外的事情（唯一请求：GET /api/fuse/config 取令牌）
//
// 职责只有一件：dsh-fuse 围栏 → 页面级 UI。
//   · 三态兜底：流式中骨架屏 / 规格错误 → 错误卡 + 原始 JSON 折叠 / 正常 → 渲染
//   · 一键导出 HTML：预览卡工具栏下载自包含单页
//   · 宽度切换：🖥 桌面 / 📱 手机 两档预览
//   · 渲染通道：DOM 通道（0.2.0-rc.2 运行时无 fence-registry 扩展点，实测确认）
// 已移除（v2.0）：走查器、撤销快照、设置页、代码规范注入、validate_fuse_spec 预检工具
// ============================================================================

window.__ModuleLoader__.load({
  id: 'dsh-fuse',
  factory: () => {
    // ---------- 常量（组件词汇与 spec.mjs 同源，tests/prompt-sync.test.mjs 守漂移） ----------
    const CONFIG_API = '/api/fuse/config'
    const FENCE_LANG = 'dsh-fuse'
    const PROCESSED = 'data-fuse-rendered'
    const CODE_BLOCK_SELECTORS = 'pre, .md-code-block, .code-block, .code-block-small, [data-lang]'

    const PAGE_KINDS = [
      'login_form', 'signup_form', 'dashboard', 'settings_page', 'table_page',
      'landing_page', 'profile_card', 'pricing_page', 'modal', 'form',
    ]
    const COMPONENT_TYPES = [
      'page', 'card', 'grid', 'row', 'col', 'nav', 'header', 'footer', 'section', 'tabs', 'hero',
      'text', 'badge', 'stat', 'list', 'table', 'divider', 'avatar', 'chart', 'steps', 'loading', 'skeleton',
      'progress', 'alert', 'timeline', 'code',
      'form', 'input', 'select', 'textarea', 'checkbox', 'radio', 'button', 'link',
    ]
    const CONTAINER_TYPES = ['page', 'card', 'grid', 'row', 'col', 'section', 'form']
    const MAX_NODES = 60
    const MAX_DEPTH = 8

    // ---------- 规格校验（浏览器端唯一判定；坏规格 → 错误卡，不再有 host 预检工具） ----------
    const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

    function validate(spec, themeNames) {
      const errors = []
      if (!isObj(spec)) return ['规格必须是 JSON 对象']
      if (!PAGE_KINDS.includes(spec.type)) errors.push(`未知页面类型 "${spec.type}"，可选：${PAGE_KINDS.join(' / ')}`)
      if (spec.theme === undefined || spec.theme === null || spec.theme === '') {
        errors.push(`缺少必填字段 theme（可选：${(themeNames || []).join(' / ') || 'default / apple / dark'}）`)
      } else if (themeNames && themeNames.length > 0 && !themeNames.includes(spec.theme)) {
        errors.push(`未知主题 "${spec.theme}"，可选：${themeNames.join(' / ')}`)
      }
      if (spec.context !== undefined && !isObj(spec.context)) errors.push('context 必须是对象')
      const comps = spec.components
      if (!Array.isArray(comps)) { errors.push('components 必须是数组'); return errors }
      if (comps.length === 0) errors.push('components 不能为空')
      let count = 0
      let budgetHit = false
      const walk = (node, depth) => {
        if (budgetHit) return
        count++
        if (count > MAX_NODES) { budgetHit = true; errors.push(`组件数超过 ${MAX_NODES} 个上限，拒绝渲染`); return }
        if (depth > MAX_DEPTH) { errors.push(`嵌套超过 ${MAX_DEPTH} 层`); return }
        if (!isObj(node)) { errors.push('组件必须是 JSON 对象'); return }
        const t = node.type
        if (!COMPONENT_TYPES.includes(t)) { errors.push(`未知组件类型 "${t}"，可选：${COMPONENT_TYPES.join(' / ')}`); return }
        if (CONTAINER_TYPES.includes(t)) {
          const items = node.items ?? node.components
          if (items === undefined) errors.push(`容器组件 "${t}" 需要 items/components 数组`)
          else if (Array.isArray(items)) for (const it of items) walk(it, depth + 1)
        }
        if (t === 'tabs') {
          for (const it of (Array.isArray(node.items) ? node.items : [])) {
            if (!isObj(it)) continue
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

    // ---------- 解析（v2.0 底层简化：不猜残缺 JSON） ----------
    // v1 会「补括号 → 半成品渲染」，流式期间每个 token 都整树重建一次（慢 + 闪 + 代码多）。
    // 现在：JSON 不完整一律骨架屏；完整后解析一次。解析失败也不再永久显示骨架——
    // 文本 1.2s 没变就升级成错误卡（见 installDomFenceRenderer.rerender）。
    function parseSpec(raw) {
      const t = raw.trim()
      if (!t) return null
      try { const v = JSON.parse(t); return isObj(v) ? v : null } catch { return null }
    }

    // ---------- 主题令牌 ----------
    let THEMES = null
    let themeLoad = null
    let CONFIG_THEME_NAMES = []

    function loadThemes() {
      if (THEMES) return Promise.resolve(THEMES)
      if (!themeLoad) {
        themeLoad = fetch(CONFIG_API, { headers: { accept: 'application/json' } })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => { THEMES = data?.themes ?? null; CONFIG_THEME_NAMES = Object.keys(THEMES ?? {}); return THEMES })
          .catch(() => { THEMES = null; return null })
          .finally(() => { themeLoad = null })
      }
      return themeLoad
    }

    const themeRetried = new WeakSet()

    function applyTheme(root, themeName) {
      const theme = (THEMES && THEMES[themeName]) || (THEMES && THEMES.default) || null
      if (!theme) {
        if (root && !themeRetried.has(root)) {
          themeRetried.add(root)
          loadThemes().then((themes) => { if (themes) applyTheme(root, themeName) })
        }
        return
      }
      const set = (k, v) => { if (v !== undefined && v !== null) root.style.setProperty(k, v) }
      const px = (v) => (v !== undefined && v !== null ? v + 'px' : undefined)
      const c = theme.colors ?? {}
      const fb = theme.feedback ?? {}
      const s = theme.spacing ?? {}
      const r = theme.radius ?? {}
      const t = theme.typography ?? {}
      const sz = t.sizes ?? {}
      const lh = t.lineHeights ?? {}
      const sh = theme.shadow ?? {}
      for (const p of ['--fuse', '--fs']) {
        set(`${p}-primary`, c.primary)
        set(`${p}-accent`, c.accent)
        set(`${p}-bg`, c.neutralBg)
        set(`${p}-surface`, c.neutralSurface)
        set(`${p}-text`, c.neutralText)
        set(`${p}-muted`, c.neutralTextMuted)
        set(`${p}-border`, c.border)
        set(`${p}-success`, fb.success)
        set(`${p}-warning`, fb.warning)
        set(`${p}-error`, fb.error)
        set(`${p}-radius-sm`, px(r.sm))
        set(`${p}-radius-md`, px(r.md))
        set(`${p}-radius-lg`, px(r.lg))
      }
      set('--fs-space-xs', px(s.xs))
      set('--fs-space-sm', px(s.sm))
      set('--fs-space-md', px(s.md))
      set('--fs-space-lg', px(s.lg))
      set('--fs-space-xl', px(s.xl))
      set('--fs-fs-caption', px(sz.caption))
      set('--fs-fs-body', px(sz.body))
      set('--fs-fs-bodylg', px(sz.bodyLg))
      set('--fs-fs-h3', px(sz.h3))
      set('--fs-fs-h2', px(sz.h2))
      set('--fs-fs-h1', px(sz.h1))
      set('--fs-fs-display', px(sz.display))
      set('--fs-lh-body', lh.body !== undefined ? String(lh.body) : undefined)
      set('--fs-lh-heading', lh.heading !== undefined ? String(lh.heading) : undefined)
      set('--fs-shadow-card', sh.card)
      set('--fs-shadow-float', sh.float)
      if (t.fontFamily) root.style.setProperty('--fuse-font', t.fontFamily)
      if (t.fontFamily) root.style.setProperty('--fs-font', t.fontFamily)
    }

    // ---------- 壳主题（--fs-shell-* 跟随 DSH 主题，与围栏 theme 解耦） ----------
    function detectShellDark() {
      for (const node of [document.body, document.documentElement]) {
        if (node && node.hasAttribute('data-ds-dark-theme')) return node.getAttribute('data-ds-dark-theme') !== 'light'
      }
      try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) } catch { return false }
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
        obs = new MutationObserver(syncShellThemeAttr)
        obs.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-ds-dark-theme'] })
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

    // ---------- 样式 ----------
    const FS_TOKENS_CSS = `
:root{
  --fs-shell-bg:#FBFAF7;--fs-shell-surface:#F1EFE8;--fs-shell-text:#1F2321;--fs-shell-muted:#6B6E6A;
  --fs-shell-border:#E2DED2;--fs-shell-primary:#2F5D50;--fs-shell-secondary:#6E8B7B;--fs-shell-accent:#C8763F;
  --fs-shell-success:#4A7C59;--fs-shell-warning:#C98A2B;--fs-shell-error:#B04A3A;
  --fs-shell-primary-soft:color-mix(in srgb,var(--fs-shell-primary) 8%,transparent);
  --fs-shell-secondary-soft:color-mix(in srgb,var(--fs-shell-secondary) 10%,transparent);
  --fs-shell-error-soft:color-mix(in srgb,var(--fs-shell-error) 10%,transparent);
  --fs-shell-error-border:color-mix(in srgb,var(--fs-shell-error) 32%,transparent);
  --fs-shell-shadow-card:0 1px 3px rgba(26,26,26,.08);
  --fs-shell-shadow-float:0 10px 30px rgba(26,26,26,.14);
  --fs-shell-grad:linear-gradient(180deg,var(--fs-shell-surface),color-mix(in srgb,var(--fs-shell-primary) 3%,var(--fs-shell-surface)));
  --fs-primary:#2F5D50;--fs-accent:#C8763F;--fs-bg:#FBFAF7;--fs-surface:#F1EFE8;--fs-text:#1F2321;
  --fs-muted:#6B6E6A;--fs-border:#E2DED2;--fs-success:#4A7C59;--fs-warning:#C98A2B;--fs-error:#B04A3A;
  --fs-radius-sm:8px;--fs-radius-md:12px;--fs-radius-lg:16px;
  --fs-space-xs:4px;--fs-space-sm:8px;--fs-space-md:16px;--fs-space-lg:24px;--fs-space-xl:32px;
  --fs-fs-caption:12px;--fs-fs-body:14px;--fs-fs-bodylg:16px;--fs-fs-h3:20px;--fs-fs-h2:28px;--fs-fs-h1:36px;--fs-fs-display:48px;
  --fs-lh-body:1.7;--fs-lh-heading:1.25;
  --fs-shadow-card:0 1px 3px rgba(26,26,26,.08);--fs-shadow-float:0 10px 30px rgba(26,26,26,.14);
  --fs-font:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',Roboto,sans-serif;
}
html[data-dsh-theme="dark"]{
  --fs-shell-bg:#16171A;--fs-shell-surface:#1E2025;--fs-shell-text:#EDEBE6;--fs-shell-muted:#9C9A93;
  --fs-shell-border:#2C2F33;--fs-shell-primary:#8FBFA6;--fs-shell-secondary:#E0A66B;--fs-shell-accent:#E0A66B;
  --fs-shell-success:#86C39B;--fs-shell-warning:#E3B04B;--fs-shell-error:#E08B7A;
  --fs-shell-shadow-card:0 1px 3px rgba(0,0,0,.4);--fs-shell-shadow-float:0 10px 30px rgba(0,0,0,.5);
}
`

    const CSS = `
.fuse-root-holder{width:100%;max-width:var(--dsh-chat-content-width,748px);margin:0 auto;box-sizing:border-box;transition:max-width .18s ease}
${FS_TOKENS_CSS}
.fuse-root{position:relative;font-family:var(--fs-font);color:var(--fuse-text,#1F2321);line-height:var(--fs-lh-body);font-size:var(--fs-fs-body)}
.fuse-root *{box-sizing:border-box}
/* 页面画布：整体（卡/工具栏/正文）一律由「围栏主题」own 配色，不再混用 DSH 外壳令牌——
   深色宿主 + default 主题时曾出现白底白字（看不清），v2.0.2 修 */
.fuse-card{background:var(--fuse-bg,#FBFAF7);border:1px solid color-mix(in srgb,var(--fuse-border,#E2DED2) 80%,transparent);border-radius:var(--fs-radius-lg);box-shadow:0 1px 2px rgba(0,0,0,.04),0 12px 32px rgba(0,0,0,.07);overflow:hidden;transition:box-shadow .18s ease,border-color .18s ease}
.fuse-card:hover{box-shadow:0 2px 4px rgba(0,0,0,.05),0 18px 44px rgba(0,0,0,.1)}
.fuse-toolbar{display:flex;align-items:center;gap:6px;padding:8px 12px;background:var(--fuse-surface,#F1EFE8);border-bottom:1px solid color-mix(in srgb,var(--fuse-border,#E2DED2) 70%,transparent)}
.fuse-toolbar-label{margin-right:auto;font-size:12px;font-weight:500;letter-spacing:.02em;color:var(--fuse-muted,#6B6E6A)}
.fuse-toolbar button{height:26px;display:inline-flex;align-items:center;justify-content:center;border:1px solid transparent;background:transparent;border-radius:6px;padding:0 8px;font-size:12px;font-family:inherit;cursor:pointer;color:var(--fuse-muted,#6B6E6A);transition:background-color .15s ease,color .15s ease}
.fuse-toolbar button:hover{background:color-mix(in srgb,var(--fuse-primary,#2F5D50) 10%,transparent);color:var(--fuse-primary,#2F5D50)}
.fuse-toolbar button.active{background:color-mix(in srgb,var(--fuse-primary,#2F5D50) 14%,transparent);color:var(--fuse-primary,#2F5D50)}
.fuse-toolbar button:focus-visible,.fuse-btn:focus-visible,.fuse-link:focus-visible,.fuse-nav a:focus-visible,.fuse-tabs .tab:focus-visible{outline:2px solid var(--fuse-primary,#2F5D50);outline-offset:2px}
.fuse-body{padding:var(--fs-space-xl) var(--fs-space-lg);background:var(--fuse-bg,#FBFAF7)}
.fuse-title{font-size:var(--fs-fs-h2);font-weight:600;line-height:var(--fs-lh-heading);letter-spacing:-.015em;margin:0 0 6px}
.fuse-subtitle{font-size:var(--fs-fs-body);color:var(--fuse-muted,#6B6E6A);margin:0 0 var(--fs-space-xl)}
.fuse-label{display:block;font-size:12px;font-weight:500;color:var(--fuse-muted,#6B6E6A);margin-bottom:4px}
.fuse-input{width:100%;height:42px;padding:0 12px;border:1px solid var(--fuse-border,#E2DED2);border-radius:var(--fuse-radius-sm,8px);font-size:14px;background:var(--fuse-bg,#fff);color:var(--fuse-text,#1F2321);margin-bottom:16px;font-family:inherit}
.fuse-input:focus,.fuse-textarea:focus,.fuse-select:focus{outline:2px solid var(--fuse-primary,#2F5D50);outline-offset:-1px;border-color:transparent}
.fuse-textarea{width:100%;padding:8px 12px;border:1px solid var(--fuse-border,#E2DED2);border-radius:var(--fuse-radius-sm,8px);font-size:14px;min-height:88px;resize:vertical;margin-bottom:16px;background:var(--fuse-bg,#fff);color:var(--fuse-text,#1F2321);font-family:inherit}
.fuse-select{width:100%;height:42px;padding:0 12px;border:1px solid var(--fuse-border,#E2DED2);border-radius:var(--fuse-radius-sm,8px);font-size:14px;background:var(--fuse-bg,#fff);color:var(--fuse-text,#1F2321);margin-bottom:16px;font-family:inherit}
.fuse-check,.fuse-radio{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:14px;cursor:pointer}
.fuse-check input,.fuse-radio input{accent-color:var(--fuse-primary,#2F5D50);width:15px;height:15px}
.fuse-btn{display:inline-flex;align-items:center;justify-content:center;height:40px;padding:0 20px;border-radius:var(--fuse-radius-sm,8px);font-size:14px;font-weight:500;border:1px solid transparent;cursor:pointer;gap:8px;font-family:inherit}
.fuse-btn.primary{background:var(--fuse-primary,#2F5D50);color:#fff;box-shadow:0 1px 2px rgba(0,0,0,.12)}
.fuse-btn.primary:hover{filter:brightness(1.08)}
.fuse-btn.secondary,.fuse-btn.ghost{background:transparent;border-color:var(--fuse-border,#E2DED2);color:var(--fuse-text,#1F2321)}
.fuse-btn.secondary:hover{background:var(--fuse-surface,#F1EFE8)}
.fuse-btn.danger{background:var(--fuse-error,#B04A3A);color:#fff}
.fuse-btn.small{height:30px;padding:0 12px;font-size:12px}
.fuse-btn.full{width:100%}
.fuse-btn[disabled]{opacity:.45;cursor:not-allowed}
.fuse-btn-triggered{outline:2px solid var(--fuse-primary,#2F5D50);outline-offset:2px}
.fuse-link{color:var(--fuse-primary,#2F5D50);text-decoration:none;cursor:pointer}
.fuse-link:hover{text-decoration:underline}
.fuse-badge{display:inline-block;padding:4px 8px;border-radius:999px;font-size:12px;font-weight:500}
.fuse-badge.success{background:color-mix(in srgb,var(--fuse-success,#4A7C59) 12%,transparent);color:var(--fuse-success,#4A7C59)}
.fuse-badge.warn{background:color-mix(in srgb,var(--fuse-warning,#C98A2B) 12%,transparent);color:var(--fuse-warning,#C98A2B)}
.fuse-badge.danger{background:color-mix(in srgb,var(--fuse-error,#B04A3A) 12%,transparent);color:var(--fuse-error,#B04A3A)}
.fuse-badge.accent{background:color-mix(in srgb,var(--fuse-primary,#2F5D50) 12%,transparent);color:var(--fuse-primary,#2F5D50)}
.fuse-grid{display:grid;gap:var(--fs-space-lg)}
.fuse-row{display:flex;gap:var(--fs-space-md);flex-wrap:wrap;align-items:stretch}
.fuse-row>*{flex:1 1 0}
.fuse-card-box{border:1px solid color-mix(in srgb,var(--fuse-border,#E2DED2) 70%,transparent);border-radius:var(--fuse-radius-md,12px);padding:var(--fs-space-lg);background:var(--fuse-bg,#fff)}
.fuse-card-box .fuse-card-title{font-size:15px;font-weight:600;letter-spacing:-.01em;color:var(--fuse-text,#1F2321);margin:0 0 var(--fs-space-md)}
.fuse-stat{display:flex;flex-direction:column;gap:4px;padding:var(--fs-space-lg);border:0;border-radius:var(--fuse-radius-md,12px);background:var(--fuse-surface,#F1EFE8)}
.fuse-stat .v{font-size:32px;font-weight:600;line-height:1.1;letter-spacing:-.025em;font-variant-numeric:tabular-nums;color:var(--fuse-text,#1F2321)}
.fuse-stat .l{font-size:12px;letter-spacing:.03em;color:var(--fuse-muted,#6B6E6A)}
.fuse-tablewrap{width:100%;overflow-x:auto}
.fuse-table{width:100%;border-collapse:collapse;font-size:14px;color:var(--fuse-text,#1F2321)}
.fuse-table th{text-align:left;padding:12px;border-bottom:1px solid color-mix(in srgb,var(--fuse-border,#E2DED2) 80%,transparent);color:var(--fuse-muted,#6B6E6A);font-weight:500;font-size:12px;letter-spacing:.04em;white-space:nowrap}
.fuse-table td{padding:14px 12px;border-bottom:1px solid color-mix(in srgb,var(--fuse-border,#E2DED2) 55%,transparent);font-variant-numeric:tabular-nums}
.fuse-table tr:last-child td{border-bottom:0}
.fuse-divider{height:1px;background:var(--fuse-border,#E2DED2);margin:16px 0;border:0}
.fuse-list{list-style:none;margin:0;padding:0}
.fuse-list li{padding:8px 0;border-bottom:1px solid var(--fuse-border,#E2DED2)}
.fuse-list li:last-child{border-bottom:0}
.fuse-list .t{font-size:14px;font-weight:500}
.fuse-list .d{font-size:12px;color:var(--fuse-muted,#6B6E6A)}
.fuse-nav{display:flex;gap:16px;padding:0 0 12px;border-bottom:1px solid var(--fuse-border,#E2DED2);margin-bottom:16px;font-size:14px;overflow-x:auto}
.fuse-nav a{color:var(--fuse-muted,#6B6E6A);text-decoration:none;cursor:pointer;padding-bottom:8px;border-bottom:2px solid transparent;white-space:nowrap}
.fuse-nav a.active{color:var(--fuse-primary,#2F5D50);border-bottom-color:var(--fuse-primary,#2F5D50);font-weight:500}
.fuse-tabs{display:flex;gap:16px;border-bottom:1px solid var(--fuse-border,#E2DED2);margin-bottom:16px;font-size:14px;overflow-x:auto}
.fuse-tabs .tab{padding:8px 4px;cursor:pointer;color:var(--fuse-muted,#6B6E6A);border-bottom:2px solid transparent;white-space:nowrap}
.fuse-tabs .tab.active{color:var(--fuse-primary,#2F5D50);border-bottom-color:var(--fuse-primary,#2F5D50);font-weight:500}
.fuse-steps{display:flex;align-items:flex-start;gap:8px;margin-bottom:8px;font-size:14px}
.fuse-steps .dot{width:22px;height:22px;border-radius:50%;background:var(--fuse-primary,#2F5D50);color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;flex:none}
.fuse-steps .dot.done{background:var(--fuse-success,#4A7C59)}
.fuse-steps .dot.pending{background:var(--fuse-border,#E2DED2);color:var(--fuse-muted,#6B6E6A)}
.fuse-hero{text-align:center;padding:48px 24px 40px}
.fuse-hero h1{font-size:var(--fs-fs-h1,36px);font-weight:600;letter-spacing:-.025em;margin:0 0 12px;line-height:var(--fs-lh-heading,1.25)}
.fuse-hero p{font-size:16px;color:var(--fuse-muted,#6B6E6A);margin:0 0 28px;line-height:1.7}
.fuse-hero .actions{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.fuse-root-actions{display:flex;gap:var(--fs-space-sm);justify-content:flex-end;margin-top:var(--fs-space-lg);padding-top:var(--fs-space-md);border-top:1px solid color-mix(in srgb,var(--fs-border,#E2DED2) 70%,transparent);flex-wrap:wrap}
.fuse-avatar{width:40px;height:40px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:16px;flex:none}
.fuse-chart{display:flex;align-items:flex-end;gap:8px;height:140px;padding:8px 0 0}
.fuse-chart .bar{flex:1;background:var(--fuse-primary,#2F5D50);border-radius:8px 8px 0 0;min-height:4px;position:relative}
.fuse-chart .bar span{position:absolute;bottom:calc(100% + 4px);left:50%;transform:translateX(-50%);font-size:12px;color:var(--fuse-muted,#6B6E6A)}
.fuse-donut{display:flex;align-items:center;gap:16px;padding:8px 0;flex-wrap:wrap}
.fuse-donut .ring{width:120px;height:120px;border-radius:50%;flex:0 0 auto;background:conic-gradient(var(--fuse-primary,#2F5D50) 0% 100%);position:relative}
.fuse-donut .ring::after{content:"";position:absolute;inset:26px;border-radius:50%;background:var(--fuse-bg,#FBFAF7)}
.fuse-donut .legend{display:flex;flex-direction:column;gap:8px;font-size:12px}
.fuse-donut .legend .item{display:flex;align-items:center;gap:8px}
.fuse-donut .legend .dot{width:10px;height:10px;border-radius:4px;flex:0 0 auto}
.fuse-linewrap{display:flex;flex-direction:column;gap:4px;padding:8px 0}
.fuse-line{width:100%;height:120px;display:block}
.fuse-linewrap .labels{display:flex;justify-content:space-between;font-size:12px;color:var(--fuse-muted,#6B6E6A)}
.fuse-progress{display:flex;flex-direction:column;gap:6px;margin:0 0 12px}
.fuse-progress-head{display:flex;justify-content:space-between;font-size:12px;color:var(--fuse-muted,#6B6E6A)}
.fuse-progress .track{height:6px;border-radius:999px;background:var(--fs-border,#E2DED2);overflow:hidden}
.fuse-progress .fill{height:100%;border-radius:999px;background:var(--fuse-primary,#2F5D50);transition:width .25s ease}
.fuse-progress .fill.success{background:var(--fuse-success,#4A7C59)}
.fuse-progress .fill.warning{background:var(--fuse-warning,#C98A2B)}
.fuse-progress .fill.error{background:var(--fuse-error,#B04A3A)}
.fuse-alert{display:flex;gap:8px;padding:12px;border-radius:var(--fuse-radius-md,12px);border:1px solid var(--fuse-border,#E2DED2);margin:0 0 12px;background:var(--fuse-surface,#F1EFE8)}
.fuse-alert .t{font-weight:600;font-size:14px;margin-bottom:2px}
.fuse-alert .d{font-size:13px;line-height:1.6;color:var(--fuse-muted,#6B6E6A)}
.fuse-alert.success{border-color:color-mix(in srgb,var(--fuse-success,#4A7C59) 40%,transparent);background:color-mix(in srgb,var(--fuse-success,#4A7C59) 8%,transparent)}
.fuse-alert.warning{border-color:color-mix(in srgb,var(--fuse-warning,#C98A2B) 40%,transparent);background:color-mix(in srgb,var(--fuse-warning,#C98A2B) 8%,transparent)}
.fuse-alert.error{border-color:color-mix(in srgb,var(--fuse-error,#B04A3A) 40%,transparent);background:color-mix(in srgb,var(--fuse-error,#B04A3A) 8%,transparent)}
.fuse-timeline{display:flex;flex-direction:column;gap:12px;padding:4px 0}
.fuse-timeline .item{display:flex;gap:10px}
.fuse-timeline .rail{display:flex;flex-direction:column;align-items:center}
.fuse-timeline .dot{width:10px;height:10px;border-radius:50%;background:var(--fuse-primary,#2F5D50);margin-top:4px;flex:none}
.fuse-timeline .dot.done{background:var(--fuse-success,#4A7C59)}
.fuse-timeline .time{font-size:12px;color:var(--fuse-muted,#6B6E6A)}
.fuse-timeline .t{font-size:14px;font-weight:500}
.fuse-timeline .d{font-size:12px;color:var(--fuse-muted,#6B6E6A)}
.fuse-code{background:var(--fuse-surface,#F1EFE8);border:1px solid color-mix(in srgb,var(--fuse-border,#E2DED2) 70%,transparent);border-radius:var(--fuse-radius-sm,8px);padding:12px;overflow:auto;margin:0 0 12px}
.fuse-code .lang{font-size:12px;color:var(--fuse-muted,#6B6E6A);margin-bottom:6px}
.fuse-code pre{margin:0;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:13px;line-height:1.6;white-space:pre;color:var(--fuse-text,#1F2321)}
.fuse-empty{padding:4px 8px;border-radius:var(--fs-radius-sm);background:color-mix(in srgb,var(--fuse-primary,#2F5D50) 8%,transparent);border:1px dashed color-mix(in srgb,var(--fuse-primary,#2F5D50) 45%,transparent);color:var(--fuse-muted,#6B6E6A);font-size:12px}
.fuse-error{margin:0;padding:var(--fs-space-md);border-radius:var(--fuse-radius-md,12px);background:color-mix(in srgb,var(--fuse-error,#B04A3A) 8%,transparent);border:1px solid color-mix(in srgb,var(--fuse-error,#B04A3A) 35%,transparent);color:var(--fuse-error,#B04A3A);font-size:12px;line-height:1.6;white-space:pre-wrap}
.fuse-error b{display:block;font-size:14px;margin-bottom:6px}
.fuse-error details{margin-top:10px;cursor:pointer}
.fuse-error summary{font-size:12px;color:var(--fuse-muted,#6B6E6A)}
.fuse-raw{margin:8px 0 0;max-height:220px;overflow:auto;padding:8px;border-radius:var(--fs-radius-sm);background:var(--fuse-bg,#fff);border:1px solid var(--fuse-border,#E2DED2);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12px;line-height:1.5;white-space:pre-wrap;color:var(--fuse-text,#1F2321)}
.fuse-loading{display:flex;align-items:center;gap:8px;padding:16px;font-size:14px;color:var(--fuse-muted,#6B6E6A)}
.fuse-loading .spinner{width:16px;height:16px;border-radius:50%;border:2px solid var(--fuse-border,#E2DED2);border-top-color:var(--fuse-primary,#2F5D50);animation:fuse-spin .8s linear infinite;flex:none}
@keyframes fuse-spin{to{transform:rotate(360deg)}}
.fuse-skeleton{border-radius:8px;background:linear-gradient(90deg,var(--fuse-surface,#F1EFE8) 25%,color-mix(in srgb,var(--fuse-surface,#F1EFE8) 55%,var(--fuse-bg,#fff)) 37%,var(--fuse-surface,#F1EFE8) 63%);background-size:400% 100%;animation:fuse-shimmer 1.4s ease infinite}
@keyframes fuse-shimmer{0%{background-position:100% 0}100%{background-position:0 0}}
.fuse-skeleton.line{height:12px;margin:8px 0}
.fuse-skeleton.block{height:88px;margin:8px 0}
.fuse-skeleton-group{display:flex;flex-direction:column;gap:8px;padding:8px 0}
@media (prefers-reduced-motion:reduce){.fuse-loading .spinner,.fuse-skeleton{animation:none}}
@media (max-width:560px){.fuse-body{padding:var(--fs-space-md)}.fuse-grid{grid-template-columns:1fr !important}.fuse-row>*{flex-basis:100%}}
`

    const EXPORT_CSS = `
html,body{margin:0;padding:0;background:#F1EFE8}
body{min-height:100vh;display:flex;justify-content:center;align-items:flex-start;padding:24px 12px;font-family:var(--fs-font)}
.fuse-export{width:100%;max-width:760px;background:var(--fs-bg,#fff);border:1px solid var(--fs-border,#E2DED2);border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.08)}
.fuse-export .fuse-body{background:var(--fs-bg,#fff)}
`

    // ---------- 小工具 ----------
    const el = (tag, cls, text) => {
      const node = document.createElement(tag)
      if (cls) node.className = cls
      if (text !== undefined) node.textContent = String(text)
      return node
    }
    const str = (v) => (v === undefined || v === null ? '' : String(v))
    const safeColor = (v) => (typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v.trim()) ? v.trim() : undefined)
    const escHtml = (v) => str(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

    /** 动作回传（[fuse-action] 由会话通道送回 Agent） */
    function sendAction(ctx, key, action, payload) {
      const sessionId = ctx?.sessions?.current?.()
      const conversation = sessionId ? ctx.sessions.scope(sessionId)?.get?.('conversation') : undefined
      const extra = payload ? ` 组件数据: ${JSON.stringify(payload)}` : ''
      const msg = `[fuse-action] ${action}。用户刚刚在 Fuse 界面中触发了动作 "${action}"（元素 ${key}）。${extra} 请根据组件数据执行相应操作，并用 dsh-fuse 输出更新后的界面。`
      if (conversation?.send) conversation.send(msg).catch(() => console.warn('[dsh-fuse] 动作回传失败：会话已结束'))
      else console.warn('[dsh-fuse] 无 conversation 通道，动作未回传')
    }

    // ---------- 组件渲染（JSON → DOM；纯 textContent，禁 innerHTML） ----------
    function renderNode(node, ctx, key) {
      const type = node?.type
      switch (type) {
        case 'text': {
          const sizes = { h1: 'var(--fs-fs-h1,36px)', h2: 'var(--fs-fs-h2,28px)', h3: 'var(--fs-fs-h3,20px)', body: 'var(--fs-fs-body,14px)', bodyLg: 'var(--fs-fs-bodylg,16px)', caption: 'var(--fs-fs-caption,12px)', muted: 'var(--fs-fs-caption,12px)' }
          const tag = { h1: 'h1', h2: 'h2', h3: 'h3' }[node.size] ?? 'div'
          const d = el(tag)
          d.style.fontSize = sizes[node.size] || sizes.body
          if (String(node.size).startsWith('h')) { d.style.fontWeight = '600'; d.style.margin = '0 0 8px' } else d.style.margin = '0 0 12px'
          if (node.size === 'muted') d.style.color = 'var(--fuse-muted,#6B6E6A)'
          if (node.center) d.style.textAlign = 'center'
          d.textContent = str(node.content ?? node.text)
          return d
        }
        case 'badge': return el('span', 'fuse-badge ' + (['success', 'warn', 'danger', 'accent'].includes(node.tone) ? node.tone : 'accent'), node.label ?? node.text)
        case 'stat': {
          const box = el('div', 'fuse-stat')
          box.append(el('div', 'v', str(node.value)), el('div', 'l', str(node.label)))
          return box
        }
        case 'list': {
          const ul = el('ul', 'fuse-list')
          for (const it of (Array.isArray(node.items) ? node.items : [])) {
            const li = el('li')
            if (isObj(it)) li.append(el('div', 't', str(it.title)), el('div', 'd', str(it.desc)))
            else li.textContent = str(it)
            ul.appendChild(li)
          }
          return ul
        }
        case 'table': {
          const wrap = el('div', 'fuse-tablewrap')
          const tb = el('table', 'fuse-table')
          const cols = Array.isArray(node.columns) ? node.columns : []
          if (cols.length) {
            const head = el('thead')
            const tr = el('tr')
            for (const c of cols) tr.appendChild(el('th', null, str(c)))
            head.appendChild(tr)
            tb.appendChild(head)
          }
          const body = el('tbody')
          for (const row of (Array.isArray(node.rows) ? node.rows : [])) {
            const tr = el('tr')
            for (const c of (Array.isArray(row) ? row : [row])) tr.appendChild(el('td', null, str(c)))
            body.appendChild(tr)
          }
          tb.appendChild(body)
          wrap.appendChild(tb)
          return wrap
        }
        case 'divider': return el('hr', 'fuse-divider')
        case 'loading': {
          const wrap = el('div', 'fuse-loading')
          wrap.append(el('span', 'spinner'), el('span', null, str(node.label ?? '加载中…')))
          return wrap
        }
        case 'skeleton': {
          const box = el('div', 'fuse-skeleton-group')
          const lines = Math.max(1, Math.min(8, Number(node.lines) || 3))
          const variant = node.variant === 'block' ? 'block' : 'line'
          for (let i = 0; i < lines; i++) box.appendChild(el('div', `fuse-skeleton ${variant}`))
          return box
        }
        case 'avatar': {
          const a = el('span', 'fuse-avatar', str(node.name ?? '?').slice(0, 1).toUpperCase())
          a.style.background = safeColor(node.color) ?? 'var(--fuse-primary,#2F5D50)'
          return a
        }
        case 'progress': {
          const wrap = el('div', 'fuse-progress')
          const max = Number(node.max) > 0 ? Number(node.max) : 100
          const val = Math.max(0, Math.min(max, Number(node.value) || 0))
          const pctv = Math.round((val / max) * 100)
          const head = el('div', 'fuse-progress-head')
          head.append(el('span', null, str(node.label)), el('span', null, str(node.text ?? pctv + '%')))
          const track = el('div', 'track')
          const fill = el('div', 'fill ' + (['success', 'warning', 'error'].includes(node.tone) ? node.tone : ''))
          fill.style.width = pctv + '%'
          track.appendChild(fill)
          wrap.append(head, track)
          return wrap
        }
        case 'alert': {
          const tone = ['success', 'warning', 'error'].includes(node.tone) ? node.tone : 'info'
          const box = el('div', 'fuse-alert ' + tone)
          const body = el('div')
          if (node.title) body.appendChild(el('div', 't', str(node.title)))
          if (node.text ?? node.content) body.appendChild(el('div', 'd', str(node.text ?? node.content)))
          box.appendChild(body)
          return box
        }
        case 'timeline': {
          const box = el('div', 'fuse-timeline')
          for (const it of (Array.isArray(node.items) ? node.items : [])) {
            const row = el('div', 'item')
            const rail = el('div', 'rail')
            rail.appendChild(el('div', 'dot' + (isObj(it) && it.done ? ' done' : '')))
            const body = el('div')
            if (isObj(it)) {
              if (it.time) body.appendChild(el('div', 'time', str(it.time)))
              body.appendChild(el('div', 't', str(it.title)))
              if (it.desc) body.appendChild(el('div', 'd', str(it.desc)))
            } else body.appendChild(el('div', 't', str(it)))
            row.append(rail, body)
            box.appendChild(row)
          }
          return box
        }
        case 'code': {
          const wrap = el('div', 'fuse-code')
          if (node.lang) wrap.appendChild(el('div', 'lang', str(node.lang)))
          const pre = el('pre')
          pre.appendChild(el('code', null, str(node.content ?? node.code)))
          wrap.appendChild(pre)
          return wrap
        }
        case 'chart': {
          const kind = node.kind ?? 'bars'
          const data = Array.isArray(node.data) ? node.data : []
          const palette = ['var(--fuse-primary,#2F5D50)', 'var(--fuse-accent,#C8763F)', 'var(--fuse-success,#4A7C59)', 'var(--fuse-warning,#C98A2B)', 'var(--fuse-error,#B04A3A)']
          if (kind === 'bars') {
            const box = el('div', 'fuse-chart')
            const max = Math.max(1, ...data.map((d) => Number(d.value) || 0))
            for (const d of data) {
              const bar = el('div', 'bar')
              bar.style.height = Math.max(4, Math.round(((Number(d.value) || 0) / max) * 120)) + 'px'
              bar.style.background = safeColor(d.color) ?? 'var(--fuse-primary,#2F5D50)'
              bar.appendChild(el('span', null, str(d.value)))
              box.appendChild(bar)
            }
            return box
          }
          if (kind === 'donut') {
            const box = el('div', 'fuse-donut')
            const ring = el('div', 'ring')
            const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0) || 1
            let acc = 0
            const stops = []
            data.forEach((d, i) => {
              const pct = Math.max(0, ((Number(d.value) || 0) / total) * 100)
              const color = safeColor(d.color) ?? palette[i % palette.length]
              stops.push(`${color} ${acc}% ${acc + pct}%`)
              acc += pct
            })
            if (stops.length) ring.style.background = `conic-gradient(${stops.join(',')})`
            const legend = el('div', 'legend')
            data.forEach((d, i) => {
              const item = el('div', 'item')
              const dot = el('span', 'dot')
              dot.style.background = safeColor(d.color) ?? palette[i % palette.length]
              item.append(dot, el('span', null, `${str(d.label)} ${str(d.value)}`))
              legend.appendChild(item)
            })
            box.append(ring, legend)
            return box
          }
          // line / area：SVG 折线
          const pts = data.map((d) => Number(d.value) || 0)
          const wrap = el('div', 'fuse-linewrap')
          if (pts.length >= 2) {
            const W = 320
            const H = 120
            const top = Math.max(1, ...pts)
            const NS = 'http://www.w3.org/2000/svg'
            const svg = document.createElementNS(NS, 'svg')
            svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
            svg.setAttribute('preserveAspectRatio', 'none')
            svg.setAttribute('class', 'fuse-line')
            const poly = document.createElementNS(NS, 'polyline')
            poly.setAttribute('points', pts.map((v, i) => `${((i / (pts.length - 1)) * W).toFixed(1)},${(H - Math.max(4, (v / top) * (H - 12))).toFixed(1)}`).join(' '))
            poly.setAttribute('fill', 'none')
            poly.setAttribute('stroke', 'var(--fuse-primary,#2F5D50)')
            poly.setAttribute('stroke-width', '2')
            svg.appendChild(poly)
            wrap.appendChild(svg)
            const labels = el('div', 'labels')
            data.forEach((d, i) => {
              if (i === 0 || i === data.length - 1 || data.length <= 8) labels.appendChild(el('span', null, str(d.label)))
            })
            wrap.appendChild(labels)
          }
          return wrap
        }
        case 'steps': {
          const box = el('div')
          const steps = Array.isArray(node.steps) ? node.steps : []
          const current = Number(node.current) || 0
          steps.forEach((s, i) => {
            const row = el('div', 'fuse-steps')
            row.appendChild(el('div', 'dot ' + (i < current ? 'done' : i === current ? '' : 'pending'), String(i + 1)))
            const t = el('div')
            t.appendChild(el('b', null, str(s?.title)))
            if (s?.desc) t.appendChild(document.createTextNode(' — ' + str(s.desc)))
            row.appendChild(t)
            box.appendChild(row)
          })
          return box
        }
        case 'input': {
          const wrap = el('div')
          if (node.label) wrap.appendChild(el('label', 'fuse-label', str(node.label)))
          const input = el('input', 'fuse-input')
          input.type = node.inputType ?? 'text'
          input.placeholder = str(node.placeholder)
          input.name = key
          if (node.action) input.addEventListener('change', () => sendAction(ctx, key, node.action, { id: key, value: input.value }))
          wrap.appendChild(input)
          return wrap
        }
        case 'select': {
          const wrap = el('div')
          if (node.label) wrap.appendChild(el('label', 'fuse-label', str(node.label)))
          const sel = el('select', 'fuse-select')
          ;(Array.isArray(node.options) ? node.options : []).forEach((o, i) => {
            const opt = el('option', null, typeof o === 'string' ? o : str(o.label ?? o))
            if (i === node.selected) opt.selected = true
            sel.appendChild(opt)
          })
          if (node.action) sel.addEventListener('change', () => sendAction(ctx, key, node.action, { id: key, value: sel.value }))
          wrap.appendChild(sel)
          return wrap
        }
        case 'textarea': {
          const wrap = el('div')
          if (node.label) wrap.appendChild(el('label', 'fuse-label', str(node.label)))
          const ta = el('textarea', 'fuse-textarea')
          ta.placeholder = str(node.placeholder)
          if (node.action) ta.addEventListener('change', () => sendAction(ctx, key, node.action, { id: key, value: ta.value }))
          wrap.appendChild(ta)
          return wrap
        }
        case 'checkbox':
        case 'radio': {
          const wrap = el('label', type === 'radio' ? 'fuse-radio' : 'fuse-check')
          const input = el('input')
          input.type = type
          input.checked = !!node.checked
          if (node.action) input.addEventListener('change', () => sendAction(ctx, key, node.action, { id: key, checked: input.checked }))
          wrap.append(input, el('span', null, str(node.label)))
          return wrap
        }
        case 'button': {
          const b = el('button', 'fuse-btn ' + str(node.style ?? node.tone ?? 'secondary') + (node.full ? ' full' : '') + (node.small ? ' small' : ''))
          b.textContent = str(node.text ?? node.label)
          if (node.action) {
            b.addEventListener('click', (ev) => {
              if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation()
              b.classList.add('fuse-btn-triggered')
              sendAction(ctx, key, node.action, { id: key })
              setTimeout(() => b.classList.remove('fuse-btn-triggered'), 800)
            })
          } else b.disabled = true
          return b
        }
        case 'link': {
          const a = el('a', 'fuse-link', str(node.label ?? node.text))
          if (node.href && /^https?:|^mailto:/.test(node.href)) a.href = node.href
          return a
        }
        case 'page': {
          const box = el('div')
          ;(Array.isArray(node.items ?? node.components) ? node.items ?? node.components : []).forEach((it, i) => box.appendChild(renderNode(it, ctx, key + ':page:' + i)))
          return box
        }
        case 'hero': {
          const hero = el('div', 'fuse-hero')
          if (node.title) hero.appendChild(el('h1', null, str(node.title)))
          if (node.subtitle) hero.appendChild(el('p', null, str(node.subtitle)))
          const actions = Array.isArray(node.actions) ? node.actions : []
          if (actions.length) {
            const row = el('div', 'actions')
            actions.forEach((a, i) => row.appendChild(renderNode({ ...a, type: 'button' }, ctx, key + ':act:' + i)))
            hero.appendChild(row)
          }
          return hero
        }
        case 'nav': {
          const nav = el('nav', 'fuse-nav')
          ;(Array.isArray(node.items) ? node.items : []).forEach((it) => {
            const a = el('a', null, typeof it === 'string' ? it : str(it.text))
            if ((isObj(it) && it.active) || (!isObj(it) && node.items.length === 1)) a.className = 'active'
            nav.appendChild(a)
          })
          return nav
        }
        case 'tabs': {
          const box = el('div')
          const bar = el('div', 'fuse-tabs')
          const content = el('div')
          const tabs = Array.isArray(node.items) ? node.items : []
          const renderTab = (i) => {
            content.textContent = ''
            const it = tabs[i]
            if (!isObj(it)) return
            for (const sub of (Array.isArray(it.content ?? it.items) ? it.content ?? it.items : [])) content.appendChild(renderNode(sub, ctx, key + ':tab:' + i))
          }
          tabs.forEach((it, i) => {
            const tab = el('span', 'tab' + (i === 0 ? ' active' : ''), typeof it === 'string' ? it : str(it.label))
            tab.addEventListener('click', () => {
              for (const c of bar.children) c.className = 'tab'
              tab.className = 'tab active'
              renderTab(i)
            })
            bar.appendChild(tab)
          })
          box.append(bar, content)
          renderTab(0)
          return box
        }
        case 'grid': {
          const g = el('div', 'fuse-grid')
          g.style.gridTemplateColumns = `repeat(${Math.max(1, Math.min(6, Number(node.cols) || 2))}, 1fr)`
          ;(Array.isArray(node.items) ? node.items : []).forEach((it, i) => g.appendChild(renderNode(it, ctx, key + ':grid:' + i)))
          return g
        }
        case 'row': {
          const r = el('div', 'fuse-row')
          ;(Array.isArray(node.items) ? node.items : []).forEach((it, i) => r.appendChild(renderNode(it, ctx, key + ':row:' + i)))
          return r
        }
        case 'col': {
          const c = el('div')
          c.style.flex = '1 1 0'
          ;(Array.isArray(node.items) ? node.items : []).forEach((it, i) => c.appendChild(renderNode(it, ctx, key + ':col:' + i)))
          return c
        }
        case 'card': {
          const box = el('div', 'fuse-card-box')
          if (node.title) box.appendChild(el('div', 'fuse-card-title', str(node.title)))
          ;(Array.isArray(node.items) ? node.items : []).forEach((it, i) => box.appendChild(renderNode(it, ctx, key + ':card:' + i)))
          return box
        }
        case 'section': {
          const s = el('div')
          s.style.marginBottom = '16px'
          ;(Array.isArray(node.items) ? node.items : []).forEach((it, i) => s.appendChild(renderNode(it, ctx, key + ':sec:' + i)))
          return s
        }
        case 'form': {
          const f = el('form')
          f.addEventListener('submit', (e) => e.preventDefault())
          ;(Array.isArray(node.items) ? node.items : []).forEach((it, i) => f.appendChild(renderNode(it, ctx, key + ':form:' + i)))
          return f
        }
        case 'header': {
          const h = el('header')
          h.style.marginBottom = '16px'
          if (node.title) h.appendChild(el('div', 'fuse-title', str(node.title)))
          if (node.subtitle) h.appendChild(el('div', 'fuse-subtitle', str(node.subtitle)))
          return h
        }
        case 'footer': {
          const f = el('footer')
          f.style.marginTop = '16px'
          f.style.fontSize = '12px'
          f.style.color = 'var(--fuse-muted,#6B6E6A)'
          f.textContent = str(node.text)
          return f
        }
        default: return el('div', 'fuse-empty', `未知组件: ${str(type)}`)
      }
    }

    // ---------- 导出 HTML（自包含单页：渲染结果 + 令牌 + 样式） ----------
    function exportHtml(spec, card) {
      try {
        const body = card.querySelector('.fuse-body')
        if (!body) return
        const vars = card.getAttribute('style') ?? ''
        const title = str(spec?.title || 'Fuse 页面')
        const html = '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8">'
          + '<meta name="viewport" content="width=device-width,initial-scale=1">'
          + `<title>${escHtml(title)}</title><style>${FS_TOKENS_CSS}${CSS}${EXPORT_CSS}</style></head><body>`
          + `<div class="fuse-root fuse-export" style="${escHtml(vars)}"><div class="fuse-body">${body.innerHTML}</div></div>`
          + '</body></html>'
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = (title.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || 'fuse-page') + '.html'
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 2000)
      } catch (err) {
        console.warn('[dsh-fuse] 导出 HTML 失败：', err)
      }
    }

    // ---------- 预览卡 ----------
    function renderFenceCard(ctx, fenceKey, raw, onRerender, opts = {}) {
      const spec = parseSpec(raw)
      const errors = spec ? validate(spec, CONFIG_THEME_NAMES) : []
      const renderable = spec !== null && errors.length === 0
      const card = el('div', 'fuse-root fuse-card')
      const toolbar = el('div', 'fuse-toolbar')
      const label = el('span', 'fuse-toolbar-label', `Fuse 预览 · ${str(spec?.theme ?? 'default')}`)
      const mkBtn = (text, title) => {
        const b = el('button', null, text)
        b.title = title
        b.setAttribute('aria-label', title)
        return b
      }
      // 工具栏只用文字，不用 emoji / 图标（用户口径：不要 emoji 图案）
      const desktopBtn = mkBtn('桌面', '桌面宽度预览')
      const mobileBtn = mkBtn('手机', '手机宽度预览（420px）')
      const exportBtn = mkBtn('导出 HTML', '导出为自包含 HTML 单页')
      const refreshBtn = mkBtn('刷新', '重新拉取令牌并刷新预览')
      desktopBtn.setAttribute('aria-pressed', 'true')
      toolbar.append(label, desktopBtn, mobileBtn, exportBtn, refreshBtn)
      card.appendChild(toolbar)
      const body = el('div', 'fuse-body')
      card.appendChild(body)
      applyTheme(card, spec?.theme ?? 'default')

      // 宽度切换（作用于挂载容器；卡片在 renderFenceCard 返回后才被 append，故点击时再取 holder）
      const setViewport = (mode) => {
        const holder = card.closest?.('.fuse-root-holder')
        if (holder) holder.style.maxWidth = mode === 'mobile' ? '420px' : ''
        desktopBtn.classList.toggle('active', mode !== 'mobile')
        mobileBtn.classList.toggle('active', mode === 'mobile')
      }
      desktopBtn.addEventListener('click', () => setViewport('desktop'))
      mobileBtn.addEventListener('click', () => setViewport('mobile'))
      setViewport('desktop')
      exportBtn.disabled = !renderable
      exportBtn.addEventListener('click', () => { if (renderable) exportHtml(spec, card) })
      refreshBtn.addEventListener('click', () => { loadThemes().then(() => onRerender(raw, { force: true })) })

      // ① JSON 还没完整 → 骨架屏；流式已结束仍不完整（opts.final）→ 错误卡
      if (!spec) {
        if (!opts.final) {
          const loading = el('div', 'fuse-loading')
          loading.append(el('span', 'spinner'), el('span', null, '正在生成页面…'))
          const sk = el('div', 'fuse-skeleton-group')
          sk.append(el('div', 'fuse-skeleton block'), el('div', 'fuse-skeleton line'), el('div', 'fuse-skeleton line'))
          body.append(loading, sk)
          return { card, ok: false }
        }
        const box = el('div', 'fuse-error')
        box.appendChild(el('b', null, '❌ 渲染失败：围栏内容不是合法 JSON 对象'))
        const details = el('details')
        details.appendChild(el('summary', null, '查看原始内容'))
        details.appendChild(el('pre', 'fuse-raw', raw))
        box.appendChild(details)
        body.appendChild(box)
        return { card, ok: false }
      }
      // ② 完整但非法 → 错误卡 + 原始 JSON 折叠
      if (errors.length > 0) {
        const box = el('div', 'fuse-error')
        box.appendChild(el('b', null, '❌ 渲染失败：规格不合法'))
        box.appendChild(document.createTextNode(errors.join('\n')))
        const details = el('details')
        details.appendChild(el('summary', null, '查看原始 JSON'))
        details.appendChild(el('pre', 'fuse-raw', raw))
        box.appendChild(details)
        body.appendChild(box)
        return { card, ok: false }
      }
      // ③ 正常渲染
      if (spec.title) {
        body.appendChild(el('div', 'fuse-title', str(spec.title)))
        if (spec.subtitle) body.appendChild(el('div', 'fuse-subtitle', str(spec.subtitle)))
      }
      for (const [i, c] of (Array.isArray(spec.components) ? spec.components : []).entries()) {
        const n = renderNode(c, ctx, `${fenceKey}:${i}`)
        n.dataset.fuseKey = `${fenceKey}:${i}`
        body.appendChild(n)
      }
      const rootActions = Array.isArray(spec.actions) ? spec.actions : []
      if (rootActions.length) {
        const bar = el('div', 'fuse-root-actions')
        rootActions.forEach((a, i) => {
          const btn = renderNode({ ...a, type: 'button' }, ctx, `${fenceKey}:act:${i}`)
          btn.dataset.fuseKey = `${fenceKey}:act:${i}`
          bar.appendChild(btn)
        })
        body.appendChild(bar)
      }
      return { card, ok: true }
    }

    // ---------- DOM 通道（当前运行时唯一可用的渲染通道） ----------
    function installDomFenceRenderer(ctx) {
      const style = document.createElement('style')
      style.textContent = CSS
      document.head.appendChild(style)
      const mounts = new Map()

      const findBlocks = () => Array.from(document.querySelectorAll(CODE_BLOCK_SELECTORS)).filter((block) => {
        if (block.hasAttribute(PROCESSED)) return false
        // 关键：插件自己渲染出来的容器里也有 <pre>（错误卡的原始 JSON、代码组件），
        // 不排除会把自己的输出当成新围栏再渲染一遍 → 无限递归。v2.0 实测踩到，必须挡。
        if (block.closest('.fuse-root-holder')) return false
        const label = block.querySelector('.md-code-block__header, .code-block__header, [class*="lang"], [data-lang]')
        if (label !== null && label.textContent.trim() === FENCE_LANG) return true
        const raw = block.tagName === 'PRE' ? block.textContent : (block.querySelector('pre')?.textContent ?? block.textContent)
        const spec = parseSpec(raw ?? '')
        return spec !== null && PAGE_KINDS.includes(spec.type) && Array.isArray(spec.components)
      })

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
        let idleTimer = 0
        const clearIdle = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = 0 } }
        const rerender = (raw, opts = {}) => {
          if (!opts.force && raw === state.lastRaw) return
          state.lastRaw = raw
          clearIdle()
          container.textContent = ''
          const { card, ok } = renderFenceCard(
            ctx, fenceKey, raw,
            (newRaw, o) => rerender(newRaw, { force: true, ...(o || {}) }),
            opts,
          )
          container.appendChild(card)
          // 流式未完成 → 1.2s 后文本仍未变且还是骨架屏，就升级成错误卡（不永久转圈）
          if (!ok && opts.final !== true) {
            idleTimer = setTimeout(() => {
              idleTimer = 0
              if ((pre.textContent ?? '') === raw && container.querySelector('.fuse-loading')) rerender(raw, { final: true, force: true })
            }, 1200)
            if (typeof idleTimer.unref === 'function') idleTimer.unref()
          }
        }
        // 去抖 300ms：流式 token 逐个到达时只合并刷新，不再每帧整树重建
        let timerId = 0
        function flushStream() {
          if (timerId) { clearTimeout(timerId); timerId = 0 }
          const raw = pre.textContent ?? ''
          if (raw !== state.lastRaw) rerender(raw)
        }
        function scheduleStream() {
          if (timerId) return
          timerId = setTimeout(flushStream, 300)
          if (typeof timerId.unref === 'function') timerId.unref()
        }
        const obs = new MutationObserver(scheduleStream)
        obs.observe(pre, { childList: true, characterData: true, subtree: true })
        state.cleanup = () => {
          obs.disconnect()
          clearIdle()
          if (timerId) { clearTimeout(timerId); timerId = 0 }
        }
        rerender(pre.textContent ?? '', { force: true })
      }

      const mountAll = () => {
        for (const b of findBlocks()) {
          if (b.closest(`[${PROCESSED}]`)) continue
          try { mountOne(b) } catch (err) { console.warn('[dsh-fuse] 渲染失败：', err) }
        }
      }

      const observer = new MutationObserver(mountAll)
      observer.observe(document.body, { childList: true, subtree: true })
      mountAll()
      return () => {
        observer.disconnect()
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
    const inject = ['sessions']

    function apply(ctx) {
      loadThemes()
      const disposers = [installShellThemeSync(), installDomFenceRenderer(ctx)]
      return () => { for (const d of disposers) d?.() }
    }

    return { apply, inject }
  },
})
