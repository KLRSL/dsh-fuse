# dsh-fuse

> **页面级 UI 渲染插件**：自然语言描述 → 结构化规格围栏 → 真实页面 UI，并带像素级走查闭环。
>
> [简体中文](README.md) · [English](README.en.md)

> **v1.2.2** · MIT License · DSH ≥ 0.1.1-rc.2（已适配 0.1.5-rc.1）· Node `^22.19.0 || >=24.0.0`

dsh-fuse 是 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（DSH）插件，也是 **ui-aesthetics 技能的插件化升级版**：把审美规范数值化为设计令牌（`theme.json`）、把代码规约沉淀为 `code-style.json`，让生成的页面级 UI **从构造上就正确**，并通过闭环走查器把细节微调到像素级。

## 是什么

模型获得「UI 设计 + 代码规范」一体化能力，三步走：

1. **生成** —— 模型用自然语言描述页面，在回答正文中输出 `dsh-fuse` 围栏（结构化 JSON 规格）；输出前经 `validate_fuse_spec` 预检，坏规格先被拦截。
2. **渲染** —— 浏览器端把规格渲染成真实页面 UI，内联呈现在对话流中；宽度跟随对话内容宽度（`max-width: var(--dsh-chat-content-width)`，实测 680–920px 区间），居中且与输入框同宽，全屏也不撑满。
3. **微调** —— 点击预览内任意元素，采集 `getComputedStyle` + 渲染状态，按 `expected → observed → diff → fix` 闭环修正后重新输出完整围栏；环形缓冲保留最近 10 次快照可供撤销。

设计哲学：**规则是骨架，语义是血肉，情绪是呼吸**。每份规格通过 `theme`（default / apple / dark）显式决定情绪基调，拒绝占位壳，间距一律落在 4/8px 栅格上。

## 功能特性

| 特性 | 说明 |
| --- | --- |
| 一键生成 | 自然语言描述 → Agent 输出 `dsh-fuse` 围栏 → 渲染出真实页面 UI |
| 内联预览 | 渲染于 DSH 对话流内；宽度继承对话内容宽度（`--dsh-chat-content-width`，实测 680–920px），与输入框（composer）同宽，全屏不撑满 |
| 像素级走查 | 点击预览元素 → 采集 `getComputedStyle` + 渲染状态 → `[fuse-inspect]` 回传模型 |
| 渲染状态回传 | viewport / overflow / clipped / primaryButtonCount —— **Spec valid ≠ Render correct** |
| 修正闭环 | expected（规格意图）→ observed（实际渲染）→ diff（定位差异）→ fix（重输出完整围栏） |
| 撤销 / 历史 | 环形缓冲保留最近 10 次快照；预览卡右上角 ↩️ 回退 |
| 设计令牌 | `theme.json`：default / apple / dark 三套主题，CSS 变量映射，新风格即插即用 |
| 设计原则 | 骨架 → 血肉 → 呼吸；适配四问（产品/受众/任务/媒介）结论写入根节点 `context` |
| 代码规范 | 生成配套代码必守 `code-style.json`（命名 / 格式化 / 语法 / CSS） |
| 双通道渲染 | 宿主提供 `registerFenceRenderer` 扩展点时直挂；原版 DSH 回退 DOM 通道 |
| 深色模式 | 插件壳跟随 DSH 主题：双通道探测（`body[data-ds-dark-theme]` / `prefers-color-scheme` + MutationObserver） |

## 安装

### 从 GitHub 安装（推荐）

```bash
# 需要已安装 git；--profile web 换成你的 profile 名
dsh plugin --profile web add github:KLRSL/dsh-fuse
```

### 本地 bundle（开发 / link）

```bash
# 在项目目录下执行
dsh plugin --profile web add link:./dsh-fuse
```

`dsh plugin` 会自动把安装的包登记到 profile 的 `dsh.profile.bundles` 并挂载补丁；安装完成后重启 DSH（HTML 客户端注入在启动时生效）。

### 安装后验证

1. **宿主半区** —— 启动日志出现 `[dsh-fuse] 启动完成：系统指令 + validate_fuse_spec + /api/fuse/config`；系统提示词包含 Fuse 段（`name: fuse`，`order: 106`）；tools 服务可用时 `validate_fuse_spec` 工具注册成功。
2. **浏览器半区** —— 控制台报告所用通道：
   - `[dsh-fuse] fence-registry 通道已挂载`（注册表通道，契约宿主）
   - `[dsh-fuse] fence-registry 扩展点不存在（原版 DSH）——启用 DOM 渲染通道`（DOM 通道）
3. **配置 API** —— `GET http://localhost:<端口>/api/fuse/config` 返回 `{ themes, codeStyle, pageKinds, componentTypes }`。

然后让模型「做一个登录页」——对话流中应直接出现渲染好的 `dsh-fuse` 预览卡。

> **安全说明：** 围栏走「白名单校验 → 渲染」管道。未知组件 type 整体拒绝渲染；节点预算两侧一致：**60 节点（含嵌套容器与 `tabs` 内容）/ 8 层深**，超限即报错并拒绝渲染该规格。不可信文本（`title`/`desc`/`label` 等）一律以 DOM 节点 + `textContent` 构造，不使用 `innerHTML`。

## 快速开始

模型在回答正文中输出 `dsh-fuse` 围栏：

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

接下来会发生什么：

- **预检** —— `validate_fuse_spec` 按白名单校验（页面类型 / 组件词汇 / 容器规则 / 预算），坏规格在渲染前被拒绝。
- **渲染** —— 浏览器端从 `/api/fuse/config` 拉取设计令牌，把所选 `theme` 映射为 CSS 变量，渲染实时预览卡；卡片宽度跟随对话内容宽度（`--dsh-chat-content-width`），与输入框同宽。
- **交互** —— 点击带 `"action": "login"` 的「登 录」按钮，回传 `[fuse-action] login`，对话继续推进流程（模拟登录 / 展示错误 / 跳转等）。
- **禁用态** —— 不带 `action` 的按钮渲染为禁用态。

> **页面级 vs 卡片级：** dsh-fuse 管页面级 UI（登录页/仪表盘/设置页/表格页/落地页/个人卡片/弹窗/表单），对话内小卡片仍用 dsh-ui。完整语法以 `SKILL.md` 为准。

## 围栏规范

### 根结构

```json
{
  "type": "<页面类型>",
  "title": "<页面标题>",
  "theme": "default",
  "context": { ... },
  "actions": [ ... ],
  "components": [ ... ]
}
```

### 页面类型（根 `type`，必须取其一）

| 类型 | 适用场景 |
| --- | --- |
| `login_form` | 登录页 |
| `signup_form` | 注册页 |
| `dashboard` | 控制台 / 数据总览 |
| `settings_page` | 设置页 |
| `table_page` | 数据表格页 |
| `landing_page` | 营销落地页 |
| `profile_card` | 个人资料卡 |
| `pricing_page` | 定价 / 套餐对比 |
| `modal` | 弹窗 / 浮层 |
| `form` | 通用表单页 |

### 组件词汇（白名单）

未知 `type` **整体拒绝渲染**。

| 类别 | 类型 |
| --- | --- |
| 容器 | `page` `card` `grid` `row` `col` `section` `tabs` `hero` `nav` `header` `footer` `form` |
| 展示 | `text` `badge` `stat` `list` `table` `divider` `avatar` `chart` `steps` |
| 表单 | `input` `select` `textarea` `checkbox` `radio` `button` `link` |

字段细节（以 `SKILL.md` 为准）：`grid` 带 `cols`；`tabs` 带 `items`（label + content）；`hero` 带 `title`/`subtitle`/`actions`；`nav` 带 `items`；`header` 带 `title`/`subtitle`；`footer` 带 `text`；`text` 带 `size`（h1/h2/h3/body/caption/muted）、`content`、`center`；`badge` 带 `label` + `tone`（success/warn/danger/accent）；`stat` 带 `label`+`value`；`list` 的 items 为字符串或 `{title,desc}`；`table` 带 `columns`+`rows`；`avatar` 带 `name`/`color`；`chart` 带 `kind`（bars/donut/line）+ `data` `[{label,value,color}]`；`steps` 带 `current` + `steps` `[{title,desc}]`；input 带 `label`/`placeholder`/`inputType`/`action`；select 带 `label`/`options`/`selected`/`action`；textarea 带 `label`/`placeholder`/`action`；checkbox/radio 带 `label`/`checked`/`action`；button 带 `text`/`style`（primary/secondary/ghost/danger）/`full`/`small`/`action`；link 带 `label`/`href`。容器组件（`page`/`card`/`grid`/`row`/`col`/`section`/`form`）用 `items` 或 `components` 放子节点。

### 根节点字段

| 字段 | 必填 | 含义 |
| --- | --- | --- |
| `type` | 是 | 页面类型，从上表取其一 |
| `components` | 是 | 非空白名单组件数组（≤ 60 节点含嵌套，深度 ≤ 8） |
| `theme` | 是 | `theme.json` 中的主题名——不许输出白板规格 |
| `title` | 否 | 页面 / 卡片标题 |
| `context` | 否（推荐） | 适配四问的结论：`{ product, audience, task }`——渲染器不消费，但 Agent 自省与走查 diff 会用到 |
| `actions` | 否 | 页面主操作：`[{ "action": "name", "label": "…", "tone": "primary\|ghost" }]` |

### 交互动作回传

- 交互组件（`button` / `input` / `select` / `checkbox` / `radio`）带 `"action": "name"` 时，点击回传 **`[fuse-action] name`**。
- 不带 `action` 的组件渲染为禁用态。
- 表单类页面：`input` / `select` / `textarea` 用 `label` 字段标注；主操作为 `style="primary"`——**每页只有一个主操作按钮**。

## 设计语言

### 骨架 → 血肉 → 呼吸（顺序铁律）

1. **骨架（规则）** —— 信息架构与布局先行：页面类型、模块分区、层级关系清晰可循、逻辑自洽。
2. **血肉（语义）** —— 内容与交互详实：每块都有真实的文字、真实的数据、真实的按钮，绝不做占位壳。
3. **呼吸（情绪）** —— 克制：留白间距、微动画、低饱和柔色调。情绪靠克制而非堆砌。

顺序不许倒：先骨架、再血肉、后呼吸；不许先选一堆颜色再想结构。

### 适配四问（写规格前先回答）

1. **产品是什么** —— 网页 / APP / 车载 HMI / 智能穿戴 / 数据大屏 / 3D 空间界面……
2. **给谁用** —— 目标受众、使用场景与阅读环境。
3. **核心任务** —— 用户进来要完成什么，每屏只服务一个焦点。
4. **媒介约束** —— 响应式断点 / 触控目标尺寸 / 视觉距离 / 亮度与对比度。

按答案选择 `theme`、调整密度与层级，再写围栏规格；结论写入 `context` 字段。

### 设计令牌（`config/theme.json`）

| 主题 | 特征 | 适用 |
| --- | --- | --- |
| `default`（默认） | 白底、主色 `#2563EB`、圆角 8/12/16 | 通用工具类页面 |
| `apple` | `#F5F5F7` 浅灰底、大圆角 10/14/18、SF 字体感 | 消费类页面 |
| `dark` | `#0F1115` 底、青/紫强调、发光感 | 数据大屏、开发者工具 |

- 配色只从令牌取：主色 `colors.primary`、强调色 `colors.accent`、中性色 `neutralBg/Surface/Text/Muted`、边框 `border`；反馈色 success `#2E7D32` / warning `#ED6C02` / error `#C62828`（克制饱和度）。
- 间距栅格 4/8/16/24/32；圆角 8/12/16（default 与 dark）；字号阶梯 12/14/16/20/28/36/48；行高正文 1.7 / 标题 1.25。
- `brand` 段为插件品牌色单一事实来源（fuse = 蓝紫）。

### 风格扩展（主题是风格基调，不是新体系）

新风格（可爱风 / 杂志风…）= **在 `theme.json` 里新增主题**：复用 4/8px 栅格与字号阶梯，配色仍守「≤ 3 色 + 中性色」，只改主色 / 圆角 / 阴影——不推翻骨架与呼吸规则，渲染器动态生效，**无需改代码**。

> **壳与产物解耦：** 插件自身 UI（预览卡、工具栏、设置页）跟随 **DSH 主题**（`--fs-shell-*` 令牌，经 `--dsw-alias-*` / `data-ds-dark-theme` 探测）；渲染**产物**跟随围栏的 `theme`（`--fs-*` 令牌，作用域在卡片根）。

## 走查微调

**Spec valid ≠ Render correct。** `validate_fuse_spec` 通过只代表规格合法；渲染结果仍可能溢出、裁切、主按钮重复或层级不符预期。

### 走查交互流程

1. 用户点击预览内元素——选中即高亮（黄 = 选中 → 蓝 = 采集中 → 紫 = 修正中 → 红 = 失败）。
2. 模型收到 **`[fuse-inspect]`**，附：
   - 该元素的 `getComputedStyle` 样式数据；
   - 渲染状态：`viewport`（预览容器尺寸）/ `overflow`（是否溢出）/ `clipped`（元素是否被裁切）/ `primaryButtonCount`（主操作按钮数）。

### 修正闭环（expected → observed → diff → fix）

1. **expected** —— 回看自己规格的意图：该元素应有的尺寸 / 间距 / 层级 / 字数；
2. **observed** —— 读样式数据与渲染状态；
3. **diff** —— 定位差异：间距 / 圆角 / 配色 / 字号 / 溢出 / 主按钮重复；
4. **fix** —— 输出**修正后的完整 dsh-fuse 围栏**重新渲染，不要解释过程。

预览卡右上角提供 **↩️ 撤销**（最近 10 次快照）与 **🔄 手动刷新**。

## 技术架构

```
dsh-fuse/
├── index.mjs               # 宿主半区：系统指令注册 + validate_fuse_spec 工具 + /api/fuse/config
├── client.js               # 浏览器半区：围栏渲染器 + 走查器 + 撤销历史 + 设置页
├── config/
│   ├── theme.json          # 设计令牌：配色 ≤ 3 色 / 4-8px 栅格 / 字号阶梯 / 圆角；品牌色
│   └── code-style.json     # 代码规范：命名 / 格式化 / 语法 / 结构 / React / CSS
├── cordis.patch.yml        # DSH cordis 宿主 bundle 补丁
├── SKILL.md                # Fuse 技能：完整围栏语法 + 审美规范 + 自审清单
├── tests/                  # node --test 单元测试、apply 冒烟、jsdom 客户端闭环、设置页渲染
├── README.md               # 本文件（简体中文）
└── README.en.md            # English
```

**宿主半区（index.mjs）** —— 注册系统指令段（`name: fuse`，`order: 106`，位于 bash=104 与 genui=105 之间），向每次请求注入围栏语言规范、紧凑主题摘要与代码规范摘要；暴露 `validate_fuse_spec` 预检工具；提供 `GET /api/fuse/config`（themes / codeStyle / pageKinds / componentTypes）供浏览器端拉取完整令牌。

**浏览器半区（client.js）** —— 零依赖纯 DOM 渲染器（经 `__ModuleLoader__` 加载），内置 `installShellThemeSync()` 做 DSH 主题跟随，以及走查器与撤销机制。

**双通道渲染** —— 两侧各自探测宿主：

- *注册表通道：* 宿主提供 `registerFenceRenderer('dsh-fuse', …)`（DSH `0.1.2-rc.1` 契约）时直挂；
- *DOM 通道：* 原版 DSH 无扩展点 → `MutationObserver` 扫描对话流中标 `dsh-fuse` 的代码块（`pre`、`.md-code-block`、`[data-lang]`）接管渲染（带双重渲染守卫，容器与内嵌 `<pre>` 只接管一次）。

**宽度契约** —— 渲染卡片 `max-width: var(--dsh-chat-content-width, 748px)`：宽度继承 DSH 对话内容宽度（**实测 680–920px 区间**，随窗口/侧栏变化；`748px` 只是变量缺失时的兜底值），居中并与输入框对齐，全屏也不撑满。

## 开发

```sh
# 宿主单元测试（校验器 / 系统指令段 / 配置加载）
node --test tests/fuse.test.mjs

# apply() 注册冒烟
node tests/apply-smoke.mjs

# jsdom 客户端闭环（fence ⇒ DOM ⇒ 走查）
node tests/test-client.mjs

# 设置页渲染
node tests/test-settings.mjs
```

需要 Node `^22.19.0 || >=24.0.0`（见 `engines`）。开发依赖：`jsdom`、`react`、`react-dom`。

> **依赖说明（peerDependencies）** —— `@deepseek-ai/dsh-system-prompt` 的范围写作 `>=0.1.1-rc.2`，但按 semver 预发布规则它**并不接受** `0.1.5-rc.1`（实测 `semver.satisfies('0.1.5-rc.1', '>=0.1.1-rc.2') === false`）。该范围仅作参考：DSH 宿主必定提供该包，故已在 `peerDependenciesMeta` 中标记为 `optional`，消除消费方的 unmet peer 噪音；**实际版本以宿主提供的为准，已实测 DSH `0.1.5-rc.1` 正常加载运行**。

### 如何贡献

1. **白名单与校验规则保持同步** —— `index.mjs`（`FUSE_COMPONENT_TYPES`、`FUSE_PAGE_KINDS`、`FUSE_MAX_NODES`/`FUSE_MAX_DEPTH`）与 `client.js`（`CONTAINER_TYPES`、`DISPLAY_TYPES`、`FORM_TYPES`、`PAGE_KINDS`、`MAX_NODES`/`MAX_DEPTH`）必须一致；容器递归集合与 `tabs.items[].content` 递归规则也必须两侧同构——否则会出现「宿主说可安全渲染、前端却渲染失败」的判定分裂。
2. 新主题只加进 `config/theme.json`，**不改渲染器代码**。
3. 行为变更必须保持 `--fs-shell-*`（跟随 DSH 主题）与 `--fs-*`（跟随围栏主题）两套令牌分离。
4. 提交前跑完整测试矩阵；类名尽量保持稳定。

## 版本历史

| 版本 | 日期 | 要点 |
| --- | --- | --- |
| **v1.2.2** | 2026-09-16 | 安全与一致性修复：`steps` 的 title/desc 不再用 `innerHTML` 拼接（改 DOM 节点 + `textContent`，堵住 fence 注入路径）；节点预算真正生效——声明后从未使用的 `MAX_NODES` 改为 60 并在超限时报错拒绝渲染，宿主与渲染器两侧同构；宿主校验补上 `tabs.items[].content` 递归（此前 tab 内非法组件能过宿主校验却必被前端拒绝）；撤销栈只收结构完整且非流式的快照并与上一条 `raw` 去重（中间态不再挤爆 10 格）；流式重渲染用 requestAnimationFrame 合并（120ms 尾沿兜底）；`parseSpec` 括号补齐改按字符串状态机；补 `page` 容器的渲染分支；首帧令牌未就绪时异步补齐；窗口宽度文档改为「继承对话宽度（实测 680–920px）」；`test` 脚本改为跨平台 glob；`dsh-system-prompt` 标记为 optional peer |
| **v1.2.1** | 2026-09-05 | 适配 DSH `0.1.2-rc.1` 前端：`registerFenceRenderer` 契约探测（宿主提供扩展点时直挂，缺失时回退 DOM 通道）+ 插件 UI 深色适配（DSH 主题跟随，双通道探测 + MutationObserver）；品牌色（蓝紫 · 设计渲染）写入 theme.json 的 `brand` 段作单一事实来源 |
| **v1.2.0** | 2026-09-05 | 插件自身管理 UI 按「骨架/血肉/呼吸」重构：预览卡壳、工具栏、设置页全部令牌驱动（`--fs-*` 变量取自 theme.json），清除 `dsw-alias` 硬依赖；修复 React key 警告；类名零变更，测试全绿 |
| **v1.1.0** | 2026-09-05 | 融合「规则是骨架，语义是血肉，情绪是呼吸」+ 通用 UI/UX Prompt Framework：适配四问、根节点 `context` 字段（validator 校验形态）、风格扩展指南（theme.json 新增主题零改代码）；走查闭环强化——渲染器回传渲染状态，系统指令引导 expected→observed→diff→fix |
| **v1.0.2** | 2026-09-03 | 修复 DOM 通道双重渲染回归（代码块容器与内嵌 `<pre>` 都被接管 → 同一内容渲染两遍）；元数据与 README 全量对齐；peerDeps 放宽至 `>=0.1.1-rc.2` |
| **v1.0.1** | 2026-08-28 | 渲染器适配 DSH `0.1.1-rc.2` 前端；渲染容器宽度与输入框对齐（居中、全屏不撑满） |
| **v1.0.0** | — | 初版：ui-aesthetics 技能升级版（设计令牌 + 代码规范 + 围栏渲染 + 走查器 + 撤销历史） |

## 鸣谢

本项目在设计与实现过程中，研究并借鉴了以下开源项目的数据结构、交互逻辑与设计数值（不涉及核心源码的复制）：

- [OpenPencil](https://github.com/open-pencil/open-pencil) — 设计令牌体系（theme.json 的 colors / spacing / typography / radius 结构）
- [dsh-annotate](https://github.com/BrambleXu/dsh-annotate) / [dsh-web-review](https://github.com/CanglongCl/dsh-web-review) — 样式走查与反馈回路
- Airbnb / Google / Alibaba 编码规范 — 代码规范（code-style.json）

## License

[MIT](LICENSE)
