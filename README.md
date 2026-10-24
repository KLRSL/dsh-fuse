# dsh-fuse v2.0

把 `dsh-fuse` 围栏渲染成页面级 UI 的 DSH 插件。**只做渲染**，不做平台化。

## 能力

- **围栏渲染**：回答正文里的 `dsh-fuse` 代码围栏（JSON 规格）→ 页面级 UI（登录页/仪表盘/表格页/落地页/表单…）
- **三态兜底**：流式生成中显示骨架屏；规格非法显示错误卡（原因 + 原始 JSON 折叠）；正常则渲染
- **一键导出 HTML**：预览卡工具栏 `⬇️ HTML` 下载自包含单页
- **宽度切换**：`🖥` 桌面 / `📱` 手机（420px）两档预览
- **交互回传**：带 `action` 的按钮/输入控件点击后以 `[fuse-action]` 回传会话
- **主题令牌**：`config/theme.json` 提供主题令牌，壳随 DSH 深浅色自动适配

## 结构（5 个文件）

```
index.mjs          host 半区：系统指令注册 + GET /api/fuse/config
spec.mjs           页面类型/组件白名单/预算 + 系统指令正文
lib/client.js      浏览器半区：单文件零依赖渲染器（校验·解析·渲染·导出·DOM 通道）
config/theme.json  设计令牌
cordis.patch.yml   bundle 挂载
```

## 规格格式

```json
{"type":"dashboard","title":"运营看板","theme":"default","components":[
  {"type":"stat","value":"1,284","label":"今日新增"},
  {"type":"progress","label":"月度目标","value":68,"max":100},
  {"type":"chart","kind":"bars","data":[{"label":"一","value":12},{"label":"二","value":18}]}
]}
```

页面类型：`login_form / signup_form / dashboard / settings_page / table_page / landing_page / profile_card / pricing_page / modal / form`

组件白名单、预算（60 节点 / 8 层）见 `spec.mjs`；浏览器端校验与宿主提示词由 `tests/prompt-sync.test.mjs` 守一致。

## v1 → v2 删掉了什么

走查器（Inspector）、撤销快照、设置页、代码规范注入（`code-style.json`）、`validate_fuse_spec` 预检工具。
理由：它们是「微调 / 平台化」能力，不是渲染本身；砍掉后 client.js 1609 → ~900 行，每次请求也少烧一段提示词。

## 测试

```bash
npm test
```
