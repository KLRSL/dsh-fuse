# dsh-fuse · Fuse v1.0

**UI 设计 + 代码规范一体化能力插件**（DeepSeek Harness）

Fuse 为 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（DSH）提供页面级 UI 产物的生成、渲染与微调能力：以设计令牌（theme.json）与代码规范（code-style.json）为约束，通过 `dsh-fuse` 围栏输出结构化规格，由浏览器端渲染器即时呈现，并支持像素级走查微调与撤销回退。

## ✨ 核心特性

| 特性 | 说明 |
|---|---|
| 一键生成 | 自然语言描述 → Agent 输出 `dsh-fuse` 围栏 → 渲染页面 UI |
| 即时预览 | 渲染于 DSH 对话流内，所见即所得 |
| 像素级微调 | 点击元素 → 走查器采集 `getComputedStyle` → 回传 Agent 修正重渲染 |
| 撤销 / 历史 | 环形缓冲暂存最近 10 次快照，预览卡支持回退 |
| 设计令牌 | theme.json 提供 default / apple / dark 三套主题，CSS 变量映射 |
| 代码规范 | 生成代码遵循 code-style.json（命名 / 格式化 / 结构） |

## 🛠️ 技术架构

```
dsh-fuse/
├── index.mjs          # Host 半区：系统指令注册 + validate_fuse_spec 工具 + /api/fuse/config
├── client.js          # 浏览器半区：dsh-fuse 围栏渲染器 + 走查器 + 撤销历史
├── config/
│   ├── theme.json     # 设计令牌（配色 ≤3 色 / 4-8px 栅格 / 字号阶梯 / 圆角体系）
│   └── code-style.json# 代码规范（命名 / 格式化 / 结构 / React / CSS）
├── SKILL.md           # Fuse 技能（围栏语法 + 审美规范 + 自审清单）
└── tests/             # 单元测试 + apply 冒烟 + jsdom 客户端闭环
```

渲染采用双通道架构：宿主提供 `registerFenceRenderer` 扩展点时直挂注册；原版宿主则通过 DOM 观察器接管 `dsh-fuse` 代码块。

## 📦 安装

```bash
# 作为本地 bundle 安装到 DSH profile
dsh plugin --profile web add link:./dsh-fuse

# 并在 profile 的 dsh.profile.bundles 中登记
```

## 🚀 快速开始

模型在回答正文中输出 `dsh-fuse` 围栏，渲染器即呈现对应页面：

````markdown
```dsh-fuse
{"type":"login_form","title":"欢迎回来","theme":"default","components":[
  {"type":"input","label":"用户名","placeholder":"请输入用户名"},
  {"type":"input","label":"密码","inputType":"password"},
  {"type":"button","text":"登 录","style":"primary","full":true,"action":"login"}
]}
```
````

- 页面类型：`login_form` `signup_form` `dashboard` `settings_page` `table_page` `landing_page` `profile_card` `pricing_page` `modal` `form`
- 组件词汇：容器（page/card/grid/row/col/section/tabs/hero/nav/header/footer/form）、展示（text/badge/stat/list/table/divider/avatar/chart/steps）、表单（input/select/textarea/checkbox/radio/button/link）

完整语法与审美规范见 `SKILL.md`。

## 🧪 开发

```sh
node --test tests\fuse.test.mjs   # Host 单元测试
node tests\apply-smoke.mjs        # apply() 注册冒烟
node tests\test-client.mjs        # jsdom 客户端闭环
node tests\test-settings.mjs      # 设置页渲染
```

## 📄 许可证

[MIT](LICENSE)

## 🙏 鸣谢

本项目在设计与实现过程中，借鉴了以下开源项目的数据结构、交互逻辑与设计数值（不涉及核心源码的复制）：

- [OpenPencil](https://github.com/open-pencil/open-pencil) — 设计令牌体系（theme.json 的 colors / spacing / typography / radius 结构）
- [dsh-genui](https://github.com/omdsh-dev/dsh-genui) — 结构化渲染思想（JSON → 渲染引擎）
- [dsh-annotate](https://github.com/BrambleXu/dsh-annotate) / [dsh-web-review](https://github.com/CanglongCl/dsh-web-review) — 样式走查与反馈回路
- Airbnb / Google / Alibaba 编码规范 — 代码规范（code-style.json）

我们谨向上述项目的作者与社区致以诚挚的谢意，正是他们的工作为本项目提供了重要的设计基础。
