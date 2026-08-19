# dsh-fuse · Fuse v1.0

**UI 设计 + 代码规范一体化插件** —— 自研 ui-aesthetics 技能（`~/.dsh/skills/ui-aesthetics`）的插件化升级版。

让 DSH 用自然语言生成「大厂味道」的页面级 UI 产物：界面有设计语言（设计令牌），代码有工程规范（代码规范）。

## 能力（v1.0）

| 功能 | 说明 | 实现 |
|---|---|---|
| 一键生成 | 自然语言描述 → Agent 输出 `dsh-fuse` 围栏 → 渲染页面 UI | 系统指令 + 渲染器 |
| 即时预览 | 渲染在 DSH 对话流中，所见即所得 | DOM 通道 / fence-registry 双通道 |
| 像素级微调 | 点击元素 → 走查器采集 getComputedStyle → 回传 Agent 修正重渲染 | 走查器 Inspector |
| 撤销/历史 | 环形缓冲暂存最近 10 次快照，预览卡 ↩️ 回退 | 快照机制 |
| 代码规范 | 生成代码遵循 code-style.json（命名/缩进/结构） | 系统指令注入 |
| 设计令牌 | theme.json 可配置（default/apple/dark 三主题） | CSS 变量映射 |

## 架构

```
dsh-fuse/
├── index.mjs          # host 半区：系统指令注册 + validate_fuse_spec 工具 + /api/fuse/config
├── client.js          # 浏览器半区：dsh-fuse 围栏渲染器 + 走查器 + 撤销历史
├── config/
│   ├── theme.json     # 设计令牌（配色≤3色 / 4-8px 栅格 / 字号阶梯 / 圆角体系）
│   └── code-style.json# 代码规范（命名 / 格式化 / 结构 / React / CSS）
├── SKILL.md           # fuse 技能（围栏语法 + 审美铁律 + 自审清单）
└── tests/             # 单元测试 + apply 冒烟 + jsdom 客户端闭环
```

### 渲染通道（双通道，与 genui 同款）

- **Registry channel**：宿主提供 `registerFenceRenderer('dsh-fuse', …)` 扩展点 → 直挂
- **DOM channel**：原版 DSH 无扩展点 → MutationObserver 观察对话 DOM，接管标 `dsh-fuse` 的代码块

### 走查闭环（文档 §5.2 / §6.2）

1. 用户点击预览内元素 → 黄色高亮（已选中）
2. 走查器 `getComputedStyle` 采集 → 蓝色（采集中）
3. `[fuse-inspect]` + 样式数据回传 Agent → 紫色（修正中）
4. Agent 输出修正后的完整围栏 → 重渲染 → 高亮消失
5. 失败 → 红色 + 错误提示

## 使用

模型在回答正文输出 `dsh-fuse` 围栏：

````markdown
```dsh-fuse
{"type":"login_form","title":"欢迎回来","theme":"default","components":[
  {"type":"input","label":"用户名","placeholder":"请输入用户名"},
  {"type":"input","label":"密码","inputType":"password"},
  {"type":"button","text":"登 录","style":"primary","full":true,"action":"login"}
]}
```
````

### 页面类型

`login_form` `signup_form` `dashboard` `settings_page` `table_page` `landing_page` `profile_card` `pricing_page` `modal` `form`

### 组件词汇（白名单）

- 容器：`page` `card` `grid` `row` `col` `section` `tabs` `hero` `nav` `header` `footer` `form`
- 展示：`text` `badge` `stat` `list` `table` `divider` `avatar` `chart` `steps`
- 表单：`input` `select` `textarea` `checkbox` `radio` `button` `link`

完整语法与审美规范见 `SKILL.md`。

## 开发

```sh
node --test tests\fuse.test.mjs   # host 单元测试（13 项）
node tests\apply-smoke.mjs        # apply() 注册冒烟
node tests\test-client.mjs        # jsdom 客户端闭环（渲染/走查/撤销/清理）
```

## 借鉴对象（开发文档 §2，仅借鉴数据结构/交互逻辑/设计数值）

- OpenPencil：设计令牌体系（theme.json 的 colors/spacing/typography/radius 结构）
- dsh-genui：结构化渲染思想（JSON → 渲染引擎）
- dsh-annotate / dsh-web-review：样式走查与反馈回路
- Airbnb/Google/阿里：编码规范（code-style.json）
