# dsh-fuse · Fuse v1.2.1

**UI 设计 + 代码规范一体化能力插件**（DeepSeek Harness）

> **v1.2.0 (2026-09-05)**：插件管理 UI 按「骨架/血肉/呼吸」设计语言重构（预览卡壳/工具栏/设置页全部令牌驱动，--fs-* 变量取自 theme.json，壳随围栏主题切换）；融合「规则是骨架，语义是血肉，情绪是呼吸」设计原则与通用 UI/UX Prompt Framework（适配四问 + context 字段 + 风格扩展）；走查闭环升级为 Spec valid ≠ Render correct（渲染器回传 viewport/overflow/clipped/primaryButtonCount 状态，Agent 走 expected→observed→diff→fix）；兼容性：DeepSeek Harness ≥ 0.1.1-rc.2。

Fuse 为 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（DSH）提供页面级 UI 产物的生成、渲染与微调能力：以设计令牌（theme.json）与代码规范（code-style.json）为约束，通过 `dsh-fuse` 围栏输出结构化规格，由浏览器端渲染器即时呈现，并支持像素级走查微调与撤销回退。

## ✨ 核心特性

| 特性 | 说明 |
|---|---|
| 一键生成 | 自然语言描述 → Agent 输出 `dsh-fuse` 围栏 → 渲染页面 UI |
| 即时预览 | 渲染于 DSH 对话流内，所见即所得 |
| 像素级微调 | 点击元素 → 走查器采集 `getComputedStyle` + 渲染状态 → 回传 Agent 修正重渲染 |
| 渲染状态回传 | viewport / overflow / clipped / primaryButtonCount——Spec valid ≠ Render correct，expected→observed→diff→fix |
| 撤销 / 历史 | 环形缓冲暂存最近 10 次快照，预览卡支持回退 |
| 设计令牌 | theme.json 提供 default / apple / dark 三套主题（可扩展新风格主题），CSS 变量映射 |
| 设计原则 | 骨架（规则）→ 血肉（语义）→ 呼吸（克制）；四问适配（产品/受众/任务/媒介）写入 context 字段 |
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

## 📜 版本历史

- **v1.2.0 (2026-09-05)**：插件自身 UI 重构——预览卡壳/工具栏/设置页按「骨架/血肉/呼吸」设计语言重做（:root --fs-* 令牌取自 theme.json default；新增页头副标题、工具栏「Fuse 预览 · 主题」标识、走查高亮与主题切换按钮令牌化；清除 dsw-alias 依赖；修复 React key 警告）；类名零变更，全部测试原样通过。
- **v1.1.0 (2026-09-05)**：融合「规则是骨架，语义是血肉，情绪是呼吸」+ 通用 UI/UX Prompt Framework——适配四问（产品/受众/任务/媒介）、根节点 `context` 字段（validator 校验形态）、风格扩展指南（theme.json 新增主题零改代码）；走查闭环强化：渲染器回传渲染状态（viewport/overflow/clipped/primaryButtonCount），系统指令引导 expected→observed→diff→fix；UI 修改建议落地（diff 自审清单）。
- **v1.0.2 (2026-09-03)**：修复 DOM 通道双重渲染回归（代码块容器与内嵌 `<pre>` 都被接管 → 同一内容渲染两遍、输入框/工具栏翻倍）；元数据（repository/homepage/bugs/keywords）与 README 全量对齐；peerDeps 放宽至 `>=0.1.1-rc.2`。
- **v1.0.1 (2026-08-28)**：渲染器适配 DSH 0.1.1-rc.2 前端（补 `dsh.client.inject`、DOM 通道"双判"渲染、pre 直接解析）；渲染容器宽度与输入框对齐（748px 居中，全屏不撑满）。
- **v1.0.0**：初版——ui-aesthetics 技能升级版（设计令牌 + 代码规范 + fence 渲染 + 走查器 + 撤销撤销历史）。

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
