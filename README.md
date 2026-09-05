# dsh-fuse · Fuse v1.2.1

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) · DSH `>=0.1.1-rc.2` (adapted for `0.1.2-rc.1`)

> Fuse is the plugin upgrade of the **ui-aesthetics** skill: aesthetic rules are
> crystallized into design tokens (`theme.json`) and code rules into `code-style.json`,
> so that generated page-level UI is **correct by construction** — and can be
> refined down to the pixel through a closed-loop inspector.

**dsh-fuse** is a [DeepSeek Harness](https://github.com/deepseek-ai/dsh) (DSH) plugin that gives the model one integrated capability: **UI design + code-style enforcement**, in three steps — *generate*, *render*, *refine*.

1. **Generate** — the model describes a page in natural language and emits a `dsh-fuse` fence containing a structured JSON spec, validated by `validate_fuse_spec` before it is ever rendered.
2. **Render** — the browser-side renderer turns the spec into a real page UI, rendered inline in the conversation flow, width-aligned with the composer (`748px` centered).
3. **Refine** — click any element in the preview to collect `getComputedStyle` + render-state diagnostics, run the `expected → observed → diff → fix` loop, and re-render a corrected fence. A ring buffer holds the last 10 snapshots for undo.

Design philosophy: **rules are the skeleton, semantics are the flesh, restraint is the breath** (规则是骨架，语义是血肉，情绪是呼吸). Every spec decides its emotional tone through `theme` (default / apple / dark), has no placeholder content, and follows the 4/8px grid.

> **Companion doc:** [README.zh-CN.md](README.zh-CN.md) (简体中文).

## ✨ Core Features

| Feature | Description |
|---|---|
| One-shot generation | Natural language → agent emits a `dsh-fuse` fence → a real page UI renders |
| Inline preview | Rendered inside the DSH conversation flow; 748px max-width, centered, aligned with the composer (never full-bleed) |
| Pixel-level inspection | Click a rendered element → the inspector collects `getComputedStyle` + render state → sends `[fuse-inspect]` back to the model |
| Render-state telemetry | `viewport` / `overflow` / `clipped` / `primaryButtonCount` — **Spec valid ≠ Render correct** |
| Expected → observed → diff → fix | Structured refinement loop: compare intent against reality, localize the mismatch, re-emit the full corrected fence |
| Undo history | Ring buffer of the last 10 snapshots; ↩️ undo in the preview card's top-right corner |
| Design tokens | `theme.json`: default / apple / dark themes, CSS-variable mapping, pluggable new styles |
| Design principles | Skeleton → flesh → breath; four-question adaptation (product / audience / task / medium) recorded in the root `context` field |
| Code-style enforcement | `code-style.json` naming / formatting / syntax / CSS rules for every piece of generated code |
| Dark-mode ready | Plugin shell follows the DSH theme via dual-channel detection (`body[data-ds-dark-theme]` / `prefers-color-scheme` + `MutationObserver`) |
| Dual-channel rendering | `registerFenceRenderer` extension point when the host provides one; DOM channel fallback on stock DSH |

## 📦 Installation

### From npm (published)

```bash
npm install dsh-fuse
```

### As a local bundle (development / link)

```bash
# Add the plugin to a DSH profile as a linked bundle
dsh plugin --profile web add link:./dsh-fuse
```

Register the bundle in the profile's `dsh.profile.bundles` list. Then restart DSH (the HTML client inject is loaded at boot).

### Verify

1. **Host half** — after startup, the log shows `[dsh-fuse] 启动完成：系统指令 + validate_fuse_spec + /api/fuse/config`. The system prompt contains the Fuse section (`name: fuse`, `order: 106`), and the `validate_fuse_spec` tool is registered when the `tools` service is available.
2. **Client half** — the browser console reports which channel attached:
   - `[dsh-fuse] fence-registry 通道已挂载` (registry channel, contract host)
   - `[dsh-fuse] fence-registry 扩展点不存在（原版 DSH）——启用 DOM 渲染通道` (DOM channel)
3. **Config API** — `GET http://127.0.0.1:<port>/api/fuse/config` returns `{ themes, codeStyle, pageKinds, componentTypes }`.

Then ask the model to "make a login page" — a rendered `dsh-fuse` preview card should appear directly in the conversation.

> **Note on safety:** fences are parsed by a strict whitelist validate → render pipeline. Unknown component types reject the whole spec; the node budget is capped at 60 nodes / depth 8 on the host side and 200 nodes / depth 8 in the renderer.

## 🚀 Quick Start

The model emits a `dsh-fuse` fence in the body of its reply:

````markdown
```dsh-fuse
{
  "type": "login_form",
  "title": "欢迎回来",
  "subtitle": "登录你的账户继续",
  "theme": "default",
  "context": { "product": "网页", "audience": "个人用户", "task": "快速登录进入工作台" },
  "components": [
    { "type": "input", "label": "用户名", "placeholder": "请输入用户名" },
    { "type": "input", "label": "密码", "placeholder": "请输入密码", "inputType": "password" },
    { "type": "row", "items": [
      { "type": "checkbox", "label": "记住我" },
      { "type": "link", "label": "忘记密码？" }
    ]},
    { "type": "button", "text": "登 录", "style": "primary", "full": true, "action": "login" }
  ]
}
```
````

What happens next:

- The **validator** (`validate_fuse_spec`) checks the spec against the whitelist (page kinds, component types, container rules, budgets). Bad specs are rejected before rendering.
- The **renderer** fetches design tokens from `/api/fuse/config` in the browser, maps the chosen `theme` to CSS variables, and renders a live preview card. The card is `748px` max-width, centered — the same width as the composer.
- Clicking **登 录** (which carries `"action": "login"`) emits `[fuse-action] login` back to the model, so the conversation can continue the flow (e.g. simulate the login, show an error, navigate).
- Buttons without an `action` render as **disabled**.

> **Page-level vs. card-level:** `dsh-fuse` is the page-level UI system (login pages, dashboards, settings, tables, landing pages, pills, modals, forms). Small in-conversation cards remain the domain of `dsh-ui`. The complete grammar lives in `SKILL.md`.

## 📐 Fence Specification

### Root structure

```json
{
  "type": "<page kind>",
  "title": "<page title>",
  "theme": "default",
  "context": { ... },
  "actions": [ ... ],
  "components": [ ... ]
}
```

### Page kinds (`type`, exactly one)

| Kind | Use case |
|---|---|
| `login_form` | Sign-in page |
| `signup_form` | Registration page |
| `dashboard` | Console / analytics overview |
| `settings_page` | Configuration page |
| `table_page` | Data table page |
| `landing_page` | Marketing landing page |
| `profile_card` | Personal profile card |
| `pricing_page` | Pricing / plan comparison |
| `modal` | Dialog / overlay |
| `form` | General-purpose form page |

### Component vocabulary (whitelist)

Unknown `type` rejects the **entire** spec.

| Category | Types |
|---|---|
| Containers | `page` `card` `grid` `row` `col` `section` `tabs` `hero` `nav` `header` `footer` `form` |
| Display | `text` `badge` `stat` `list` `table` `divider` `avatar` `chart` `steps` |
| Forms | `input` `select` `textarea` `checkbox` `radio` `button` `link` |

Detail (per `SKILL.md`): `grid` takes `cols`; `tabs` takes `items` with `label`+`content`; `hero` takes `title`/`subtitle`/`actions`; `nav` takes `items`; `header` takes `title`/`subtitle`; `footer` takes `text`; `text` takes `size` (h1/h2/h3/body/caption/muted), `content`, `center`; `badge` takes `label` + `tone` (success/warn/danger/accent); `stat` takes `label`+`value`; `list` takes string items or `{title,desc}`; `table` takes `columns`+`rows`; `avatar` takes `name`/`color`; `chart` takes `kind` (bars/donut/line) + `data` `[{label,value,color}]`; `steps` takes `current` + `steps` `[{title,desc}]`; input takes `label`/`placeholder`/`inputType`/`action`; select takes `label`/`options`/`selected`/`action`; textarea takes `label`/`placeholder`/`action`; checkbox/radio take `label`/`checked`/`action`; button takes `text`/`style` (primary/secondary/ghost/danger)/`full`/`small`/`action`; link takes `label`/`href`. Container components (`page`/`card`/`grid`/`row`/`col`/`section`/`form`) hold children in `items` or `components`.

### Root fields

| Field | Required | Meaning |
|---|---|---|
| `type` | ✅ | Page kind, exactly one from the table above |
| `components` | ✅ | Non-empty array of whitelisted component nodes (≤ 60 nodes, depth ≤ 8) |
| `theme` | ✅ | Theme name from `theme.json` — never ship a blank spec |
| `title` | — | Page / card title |
| `context` | — (recommended) | Result of the four-question adaptation: `{ product, audience, task }` — the renderer doesn't consume it, but the model self-checks and the walkthrough diff uses it |
| `actions` | — | Top-level page actions: `[{ "action": "name", "label": "…", "tone": "primary\|ghost" }]` |

### Interaction callbacks

- Interactive components (`button` / `input` / `select` / `checkbox` / `radio`) carrying `"action": "name"` emit **`[fuse-action] name`** when clicked.
- Components without `action` render as disabled states.
- Form pages: `input` / `select` / `textarea` use the `label` field; the primary operation is `style="primary"` — **exactly one primary button per page**.

## 🎨 Design Language

### Skeleton → flesh → breath (order is law)

1. **Skeleton (rules)** — information architecture and layout first: page kind, module regions, hierarchy — clear and self-consistent.
2. **Flesh (semantics)** — real content and interaction: every block has real text, real data, real buttons. No placeholder shells.
3. **Breath (emotion)** — restraint: whitespace, subtle motion, low-saturation soft tones. Emotion comes from restraint, never accumulation.

Never pick a color palette before the structure.

### Four-question adaptation (before writing any spec)

1. **What is the product?** Web / app / automotive HMI / wearable / data wall / 3D spatial UI…
2. **Who is it for?** Audience, context of use, reading environment.
3. **What is the core task?** Every screen serves a single focus.
4. **Medium constraints?** Responsive breakpoints, touch target sizes, viewing distance, luminance & contrast.

The answers decide `theme`, density, and hierarchy — then write the fence. Record them in `context` (see above).

### Design tokens (`config/theme.json`)

| Theme | Character | Best for |
|---|---|---|
| `default` (default) | White base, primary `#2563EB`, radius 8/12/16 | General tool pages |
| `apple` | `#F5F5F7` gray base, large radii 10/14/18, SF-style | Consumer-facing pages |
| `dark` | `#0F1115` base, cyan/purple accents, glow | Data walls, dev tools |

- Colors come only from tokens: primary `colors.primary`, accent `colors.accent`, neutrals `neutralBg/Surface/Text/Muted`, border `border`. Feedback: success `#2E7D32` / warning `#ED6C02` / error `#C62828` (restrained saturation).
- Grid: spacing 4/8/16/24/32 · radii 8/12/16 (default & dark) · type scale 12/14/16/20/28/36/48 · line-heights 1.7 (body) / 1.25 (heading).
- The `brand` section holds plugin brand colors as the single source of truth (fuse = blue-violet).

### Extending with a new style

A new look (cute, magazine, etc.) is a **new theme in `theme.json`** — reuse the 4/8px grid and type scale, keep ≤3 colors + neutrals, and change only primary color / radii / shadows. Never rewrite the skeleton & breath rules; no code changes needed — the renderer picks up new themes dynamically.

> **Shell vs. spec themes are decoupled.** The plugin's own chrome (preview card, toolbar, settings page) follows the **DSH theme** via `--fs-shell-*` tokens (with `--dsw-alias-*`/`data-ds-dark-theme` detection); the rendered **spec** follows the fence's `theme` via `--fs-*` tokens scoped to the card root.

## 🔍 Walkthrough & Refinement

**Spec valid ≠ Render correct.** `validate_fuse_spec` passing only proves the spec is legal; the rendered result may still overflow, clip, duplicate the primary button, or miss the intended hierarchy.

### Inspector flow

1. User clicks an element in the preview — selection is highlighted (yellow → blue while collecting → purple while fixing → red on failure).
2. The model receives **`[fuse-inspect]`** with:
   - `getComputedStyle` data of the element,
   - render state: `viewport` (preview container size) / `overflow` (whether content spills) / `clipped` (whether an element is cut off) / `primaryButtonCount` (count of primary actions).

### Fix loop (expected → observed → diff → fix)

1. **expected** — revisit your own spec's intent: intended size / spacing / hierarchy / word count for this element;
2. **observed** — read the style data and render state;
3. **diff** — localize the problem: spacing / radius / color / font-size / overflow / duplicate primary button;
4. **fix** — re-emit the **complete corrected `dsh-fuse` fence** and re-render. Do not explain the process.

The preview card's top-right corner provides **↩️ undo** (last 10 snapshots) and **🔄 manual refresh**.

## 🏗 Technical Architecture

```
dsh-fuse/
├── index.mjs               # Host half: system-prompt section + validate_fuse_spec tool + /api/fuse/config
├── client.js               # Browser half: fence renderer + inspector + undo history + settings page
├── config/
│   ├── theme.json          # Design tokens: ≤3 colors, 4/8px grid, type scale, radii; brand colors
│   └── code-style.json     # Code rules: naming / formatting / syntax / structure / React / CSS
├── cordis.patch.yml        # Bundle patch for DSH's cordis host
├── SKILL.md                # Fuse skill: full fence grammar + aesthetics + self-review checklist
├── tests/                  # node --test unit tests, apply smoke, jsdom client loop, settings render
├── README.md               # This document (English)
└── README.zh-CN.md         # 简体中文
```

**Host half (`index.mjs`)** — registers a system-prompt section (`name: fuse`, `order: 106`, between bash=104 and genui=105) that injects the fence language, a compact theme summary, and the code-style summary into every request; exposes the `validate_fuse_spec` pre-check tool; and serves `GET /api/fuse/config` (themes, code style, page kinds, component types) to the browser renderer.

**Browser half (`client.js`)** — a zero-dependency pure-DOM renderer (loaded through `__ModuleLoader__`), with `installShellThemeSync()` for DSH-theme following and the inspector/undo machinery.

**Dual-channel rendering** — both halves probe their host:

- *Registry channel:* when the host provides `registerFenceRenderer('dsh-fuse', …)` (DSH `0.1.2-rc.1` contract), the renderer attaches directly;
- *DOM channel:* on stock DSH without the extension point, a `MutationObserver` sweeps conversation code blocks (`pre`, `.md-code-block`, `[data-lang]`) with the `dsh-fuse` language tag and renders them (with a double-render guard so containers and nested `<pre>` are claimed exactly once).

**Width contract** — the rendered card is `max-width: 748px` (from `--dsh-chat-content-width`), centered, so previews always align with the composer and never fill the viewport in full-screen mode.

## 🧪 Development

```sh
# Host unit tests (validator, prompt section, config loading)
node --test tests/fuse.test.mjs

# apply() registration smoke test
node tests/apply-smoke.mjs

# jsdom client closed loop (fence ⇒ DOM ⇒ inspect)
node tests/test-client.mjs

# Settings page rendering
node tests/test-settings.mjs
```

Node `^22.19.0 || >=24.0.0` is required (see `engines`). Dev dependencies: `jsdom`, `react`, `react-dom`.

### Contributing

1. Keep the whitelists in sync — `index.mjs` (`FUSE_COMPONENT_TYPES`, `FUSE_PAGE_KINDS`) and `client.js` (`CONTAINER_TYPES`, `DISPLAY_TYPES`, `FORM_TYPES`, `PAGE_KINDS`) must agree.
2. Any new theme must be added to `config/theme.json` only — no renderer code changes.
3. Behavioral changes must keep `--fs-shell-*` (DSH-theme following) and `--fs-*` (spec-theme) token separation.
4. Run the full test matrix above before submitting; keep class names stable where possible.

## 📜 Changelog

- **v1.2.1 (2026-09-05)** — Adapted to the DSH `0.1.2-rc.1` frontend: `registerFenceRenderer` contract probing (direct mount when the host exposes the extension point, DOM-channel fallback when missing) + dark-mode adaptation of the plugin UI (DSH theme `--dsw-alias-*` following; dual-channel detection via `body[data-ds-dark-theme]` / `prefers-color-scheme` + `MutationObserver`); brand colors (blue-violet · design/rendering) written into the `brand` section of `theme.json` as the single source of truth.
- **v1.2.0 (2026-09-05)** — Plugin's own management UI rebuilt on the skeleton/flesh/breath design language: preview card shell, toolbar, and settings page are token-driven (`--fs-*` variables from `theme.json`); removed the `dsw-alias` hard dependency; fixed React key warnings. Zero class-name changes; all tests pass as-is.
- **v1.1.0 (2026-09-05)** — Merged "rules are the skeleton, semantics are the flesh, restraint is the breath" with a generic UI/UX prompt framework: four-question adaptation (product/audience/task/medium), root `context` field (validator-verified shape), style-extension guide (new theme in `theme.json`, zero code changes); walkthrough loop hardened — renderer reports render state (`viewport`/`overflow`/`clipped`/`primaryButtonCount`), system prompt guides `expected → observed → diff → fix`.
- **v1.0.2 (2026-09-03)** — Fixed a DOM-channel double-render regression (code-block container and nested `<pre>` were both claimed → same content rendered twice, duplicated inputs/toolbar); metadata (repository/homepage/bugs/keywords) aligned with the README; peerDeps relaxed to `>=0.1.1-rc.2`.
- **v1.0.1 (2026-08-28)** — Renderer adapted to the DSH `0.1.1-rc.2` frontend; render container width aligned with the composer (748px centered; never full-bleed).
- **v1.0.0** — First release: the ui-aesthetics skill, upgraded (design tokens + code style + fence rendering + inspector + undo history).

## 🙏 Acknowledgements

This project studied and drew from the data structures, interaction logic, and design values of the following open-source projects (no source-code copying):

- [OpenPencil](https://github.com/open-pencil/open-pencil) — design token system (`theme.json` colors / spacing / typography / radius structure)
- [dsh-annotate](https://github.com/BrambleXu/dsh-annotate) / [dsh-web-review](https://github.com/CanglongCl/dsh-web-review) — style walkthrough and feedback loop
- Airbnb / Google / Alibaba coding standards — code rules (`code-style.json`)

## 📄 License

[MIT](LICENSE)
