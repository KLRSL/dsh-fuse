---
name: fuse
description: |
  Fuse —— UI 设计 + 代码规范一体化能力（ui-aesthetics 技能升级版）。
  生成「页面级 UI 产物」（登录页/注册页/仪表盘/设置页/表格页/落地页/个人卡片/弹窗/表单）时启用：
  用 dsh-fuse 围栏输出 JSON 规格，渲染器渲染为真实页面 UI；用户点击元素走查微调；
  配套代码遵循 code-style.json 规范。页面类产物用 dsh-fuse，对话内小卡片仍用 dsh-ui。
  v1.1 融合「规则是骨架，语义是血肉，情绪是呼吸」设计原则 + 通用 UI/UX Prompt Framework：
  任何产品/媒介先做上下文分析再适配，风格可扩展，渲染状态可回传做 expected→observed diff。
triggers:
  - "生成登录页"
  - "做一个仪表盘"
  - "页面 UI"
  - "网页界面"
  - "表单页"
  - "落地页"
  - "要好看"
---

# Fuse · UI 设计 + 代码规范一体化

> ui-aesthetics 技能的插件化升级版：审美规范数值化为设计令牌（theme.json），
> 渲染器把 JSON 规格渲染成页面级 UI，走查器支持像素级微调，代码输出遵循代码规范。
> 设计哲学：**规则是骨架，语义是血肉，情绪是呼吸**——任何产物先立规则，再填内容，最后调情绪。

## 0. 设计原则（每次产出前默念）

### 0.1 三段式：骨架 → 血肉 → 呼吸

1. **骨架（规则）**：信息架构与布局先行——页面类型、模块分区、层级关系清晰可循，逻辑自洽。
2. **血肉（语义）**：内容与交互详实——每块都有真实的文字、真实的数据、真实的按钮，绝不做占位壳。
3. **呼吸（情绪）**：克制——留白间距、微动画动效、低饱和柔色调，情绪靠克制而非堆砌。

顺序铁律：先骨架、再血肉、后呼吸。不许先选一堆颜色再想结构。

### 0.2 通用适配流程（任何产品/媒介，先问四件事）

1. **产品是什么**：网页 / APP / 车载 HMI / 智能穿戴 / 数据大屏 / 3D 空间界面……
2. **给谁用**：目标受众、使用场景与阅读环境。
3. **核心任务**：用户进来要完成什么——每屏只服务一个焦点。
4. **媒介约束**：响应式断点 / 触控目标尺寸 / 视觉距离 / 亮度与对比度。

→ 按答案选择 `theme`、调整密度与层级，再写 fence 规格。通用不是千篇一律，而是**先分析再适配**。

### 0.3 风格扩展（主题是风格基调，不是新体系）

- 基础主题：`default`（现代极简）/ `apple`（苹果 HIG）/ `dark`（暗黑科技）。
- 新风格（可爱风 / 黑暗风 / 杂志风 …）= 在 theme.json 里**新增主题**：复用 4/8px 栅格与字号阶梯，
  配色仍守住「≤3 色 + 中性色」，可以改变主色、圆角与阴影，不推翻骨架与呼吸规则。
- 风格要服务于内容：可爱风呼应轻松消遣场景，暗黑风呼应数据大屏，别为风格而风格。

### 0.4 铁律（继承自 ui-aesthetics）

1. **先定风格，再写内容**——每个页面显式声明 `theme`（default/apple/dark），不许白板。
2. **4/8px 栅格**——间距、内边距、圆角一律落在 4px 或 8px 的倍数上。
3. **配色不超过 3 色**——1 主色 + 1 强调色 + 中性色系；文字不用纯黑，用 #1A1A1A。
4. **字体两级足够**——标题 + 正文；最多三级，不许五六个字号乱飞。
5. **每屏只有一个焦点**——一个主操作按钮（style="primary"），其余按钮降级为 ghost/secondary。
6. **留白是设计的一部分**——宁可空，不可挤。

## 1. dsh-fuse 围栏

回答正文中输出 `dsh-fuse` 围栏（fenced block with language tag `dsh-fuse`），内含 JSON 规格：

````markdown
```dsh-fuse
{"type":"login_form","title":"登录","theme":"default","components":[...]}
```
````

### 页面类型（根 type 必选其一）

`login_form` `signup_form` `dashboard` `settings_page` `table_page` `landing_page` `profile_card` `pricing_page` `modal` `form`

### 组件词汇（白名单，只允许这些 type）

- 容器：`page` `card` `grid`（cols） `row` `col` `section` `tabs`（items 带 label+content） `hero`（title/subtitle/actions） `nav`（items） `header`（title/subtitle） `footer`（text） `form`（items）
- 展示：`text`（size: h1/h2/h3/body/caption/muted, content, center） `badge`（label, tone: success/warn/danger/accent） `stat`（label, value） `list`（items 字符串或 {title,desc}） `table`（columns, rows） `divider` `avatar`（name, color） `chart`（kind: bars/donut/line, data: [{label,value,color}]） `steps`（current, steps: [{title,desc}]）
- 表单：`form` `input`（label, placeholder, inputType, action） `select`（label, options, selected, action） `textarea`（label, placeholder, action） `checkbox`/`radio`（label, checked, action） `button`（text, style: primary/secondary/ghost/danger, full, small, action） `link`（label, href）

### 产品上下文（可选，推荐）——通用适配的落点

根节点可加 `"context":{"product":"<网页|APP|…>","audience":"<目标受众>","task":"<核心任务>"}`，
声明产品/受众/任务；按 §0.2 的四问结论填写，渲染器不消费但 Agent 自省与走查 diff 会用到。

### 结构示例

```json
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

## 2. 交互与走查闭环（Spec valid ≠ Render correct）

- **交互组件带 `"action":"name"`**：点击后回传 `[fuse-action]`；不带 action 的按钮渲染为禁用态。
- **走查微调**：用户点击预览内元素 → 收到 `[fuse-inspect]` + **样式数据 + 渲染状态**。
  渲染状态包含：`viewport`（预览容器尺寸）/ `overflow`（是否溢出）/ `clipped`（元素是否被裁切）/
  `primaryButtonCount`（主操作按钮数）。这些状态是**observed**（实际渲染），
  `validate_fuse_spec` 通过只是 **spec valid**（规格合法），二者不是一回事。
- **修正流程（expected → observed → diff → fix）**：收到 `[fuse-inspect]` 后，
  1) expected：回看自己规格的意图（该元素应有的大小/间距/层级/字数）；
  2) observed：读样式数据与渲染状态；
  3) diff：找差异（间距/圆角/配色/字号/溢出/主按钮重复）；
  4) fix：输出**修正后的完整 dsh-fuse 围栏**重新渲染，不要解释过程。
- **撤销**：预览卡右上角 ↩️ 回退最近 10 次快照，🔄 手动刷新。

## 3. 设计令牌（theme.json）

| 主题 | 特征 | 适用 |
|---|---|---|
| default（默认） | 白底、主色 #2563EB、圆角 8/12/16 | 通用工具类页面 |
| apple | 浅灰底 #F5F5F7、大圆角 10/14/18、SF 字体感 | 消费类页面 |
| dark | #0F1115 底、青/紫强调、发光感 | 数据大屏、开发者工具 |

- 配色只从令牌取：主色 `colors.primary`、强调 `colors.accent`、中性 `neutralBg/Surface/Text/Muted`、边框 `border`。
- 反馈色：成功 #2E7D32 / 警告 #ED6C02 / 错误 #C62828（克制饱和度）。
- 间距：4/8/16/24/32；字号阶梯：12/14/16/20/28/36/48；行高正文 1.7、标题 1.25。
- 新增风格主题（§0.3）：在 theme.json 的 `themes` 里加同名令牌组，渲染器动态生效，无需改代码。

## 4. 代码规范（code-style.json，生成配套代码时必守）

- 命名：变量/函数 camelCase，组件 PascalCase，文件/目录 kebab-case，常量 UPPER_SNAKE_CASE。
- 格式化：2 空格缩进，行长 ≤100，单引号，加分号。
- 语法：const 优先、禁 var、箭头函数、TS strict 无 any。
- CSS：只用设计令牌取色/圆角（CSS 变量），禁止硬编码十六进制。
- React：函数组件、hooks 顺序稳定、布尔 props 用 is/has 前缀、事件 on 前缀。
- 结构：单文件 ≤800 行、函数 ≤60 行，目录 src/components、src/pages、src/utils。

## 5. 产出前自审清单

- [ ] 已按 §0.2 四问分析产品/受众/任务，context 已填写（或明确说明为何省略）
- [ ] 骨架清晰：页面类型合法、分区层级可循；theme 显式声明
- [ ] 血肉详实：无占位内容，文字/数据/按钮真实可用
- [ ] 呼吸克制：配色 ≤3 色 + 中性色，间距全走 4/8px，字号走阶梯，无高饱和泛滥
- [ ] 每屏只有一个 primary 主操作按钮
- [ ] 组件（按钮/输入框/卡片）风格全页统一
- [ ] 表单字段有 label，输入框高度 42px
- [ ] 空状态/加载/错误三态齐全（应用类）
- [ ] 配套代码符合 code-style.json
- [ ] 若收到过 [fuse-inspect]，确认 observed 与 expected 的 diff 已被本轮修正消除

## 6. 使用方式

1. 用户要求生成页面/应用/界面时，本技能自动启用；
2. 先做 §0.2 四问分析 → 页面类产物输出 dsh-fuse 围栏（对话内小卡片仍用 dsh-ui）；
3. 完成后用 §5 清单自审，不合格先改再交付；
4. 交付说明里标注采用的风格与主题，方便用户要求调整。
