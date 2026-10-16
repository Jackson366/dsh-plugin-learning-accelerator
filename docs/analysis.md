# DSH 插件机制与 Learning-Accelerator 原理分析

本文档记录编写 `dsh-plugin-learning-accelerator` 之前与过程中对两个系统的分析结论，以及由这些结论直接推导出的设计决策。所有结论都有源码或运行验证作为依据。

验证环境：

- 已安装的桌面端 **0.2.0-rc.2**（`/Applications/DeepSeek Harness.app`，Node 24.21.0）
- 源码 checkout **0.1.0-rc.5**（`~/Desktop/project/github/deepseek-harness`）

---

## 第一部分：DSH 的插件机制

### 1.1 三层结构：Loader → Cordis → Bundle

DSH 不是一个"读配置启动"的程序，而是一个**由配置组合出来的 Cordis 应用**。

```
profile (package.json 的 dsh.profile.bundles)
  └── bundle 层（每个 bundle 提供一个 cordis.patch.yml）
        └── patch 行（id + name + config + inject + disabled）
              └── Cordis Loader 把每一行挂载成一个 plugin fiber
```

关键点：

- **`id` 是稳定身份**。Loader 按 `id` 做 diff，所以修一行配置只会重挂那一行；没有 `id` 的行每次读文件都算新增+删除。
- **层叠顺序**：bundle 层（按 `bundles` 数组顺序）→ profile 自己的 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → 命令行 `--patch`。后者按行覆盖前者，且**整块替换 `config`，不做深合并**。
- **`!!js` 表达式**只能出现在 `config` 里和 `disabled` 字段上，在挂载决策时求值。

### 1.2 插件的形状

Cordis 接受三种 plugin：

```js
// 1. 函数
export function apply(ctx, config) {}
// 2. 对象
export const plugin = { name, inject, Config, apply(ctx, config) {} }
// 3. Service 子类
export class MyService extends Service { constructor(ctx) { super(ctx, 'myService') } }
```

- **`inject` 是服务名**（`['tools', 'systemPrompt']`），不是包名。Cordis 会把缺依赖的插件停在 `PENDING` 状态，**不报错、静默等待**——这是排查"插件没反应"时首先要看的状态。
- **注册即 effect**：`ctx.on` / `ctx.plugin` / `ctx.tools.register` / `ctx.slots.register` 返回的 disposer 都挂在当前 fiber 上。卸载或热重载会自动撤销。这一条决定了插件的卸载测试该怎么写。

### 1.3 Host 侧扩展点（本插件用到的）

| 扩展点 | 用途 | 关键约束 |
|---|---|---|
| `ctx.tools.register(defineTool({...}))` | 注册模型可调用工具 | `output.schema` 是**唯一权威返回值**，`output.render` 只负责面向模型的呈现，两者分离；`presentCall`/`presentResult` 必须是**纯函数**（会用于日志回放） |
| `ctx.systemPrompt.context({ name, order, text })` | 注入动态运行时上下文 | `text` 可以是函数，每次 assemble 求值；同层重名会抛错；**全局注册的 provider 对所有 scope 生效**，可在回调里读 `assemble.agent` |
| `ctx.webServer.register({ kind, path, handler })` | 注册 HTTP 路由 | 无 method 字段，method 判断在 handler 内做；同 `(kind, path)` 重复注册抛错 |
| `ctx.inject(deps, cb)` | **等待**可选依赖 | 返回 fiber，不是 disposer；依赖缺失时停在 PENDING |

#### 一个必须记住的坑：`ctx.get` vs `ctx.inject`

第一版实现用 `ctx.get('webServer')` 探测 HTTP carrier，结果是**每次启动路由都静默丢失**。

原因：`webServer` 是由**另一个 loader 行**挂载的，它的服务在插件 `apply` 执行时还不存在。`ctx.get` 在那一刻返回 `undefined`。

正确做法是把可选依赖声明在**嵌套插件**上：

```js
ctx.inject(['webServer'], injected => {
  injected.effect(() => injected.webServer.register({ ... }))
})
```

这样既不阻塞主插件（无 HTTP carrier 的组合里嵌套 fiber 停在 PENDING，工具照常工作），又能在 carrier 出现后自动注册。

### 1.4 客户端（浏览器）半边

这是最容易踩坑的部分，因为它的契约和普通前端插件完全不同。

#### bundle 的形态

```js
// lib/client.js —— 是 classic script，不是 ES module
window.__ModuleLoader__.load({
  id: 'dsh-plugin-learning-accelerator',   // 必须等于包名，否则 loader 抛错
  factory: (require) => {
    const React = require('react')        // 来自模块表，不是 import
    return { name, inject: ['slots', 'locale'], apply(ctx) { ... } }   // cordis object-plugin 形状
  },
})
```

- **顶层不能有 `import`/`export`**：host 用 `<script src>` 加载它。
- **不能直接写 JSX**：手写路径必须用 `React.createElement`。
- **`require` 只有模块表里的 specifier 可用**：platform seed 提供 `react`、`react-dom`、`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-web-react`、`@deepseek-ai/dsh-client-ui-primitives` 等。
- **必须 external `react`**（手写 JS 天然满足；构建路径下由 purity gate 强制）。

#### `dsh.client` 声明与扫描

```json
"exports": { "./client": "./lib/client.js" },
"dsh": { "client": { "platform": "web", "inject": [] } }
```

- `platform` 必须是 `'web'`，否则该包**永久**被判为非 client 包（结论被缓存，不失效）。
- `dsh.client.inject` 是**包名**的信息性边，不是服务名；真正的 fiber 依赖来自 bundle 导出的 `inject`。
- host 用 `createRequire(profileDir)` 解析包，因此插件必须装在 profile 的 `node_modules` 下。
- 扫描结果进入 `window.__DSH_BOOT__`；**包集合变化需要重启**，bundle 内容变化走 HMR。

#### Slot 注册

```js
ctx.slots.inject('conversation.view', () => ctx.slots.register({
  name: 'conversation.view', id: 'learning', order: 30, locale: NS,
  label: () => t('view.learning'),      // thunk：跟随语言切换
}, LearningView))
```

- `ctx.slots.inject(key, cb)` 等的是**slot 声明**（由别的插件 declare），声明存在则同步执行 cb。目标 slot 由他人声明时，这是唯一顺序安全的写法。
- list 槽必须给 `id`，keyed 槽必须给 `key`；同 cell 同 priority 二次注册**抛错**。
- 本插件使用的两个 seat：
  - `conversation.view`（list / session）——会话区的 tab 环，是"主面板加一个面板"的正解；
  - `sidebar.footer.action`（list / root，owner props `{ wide }`）——侧边栏底部入口。
- **不存在 `main` 这个 keyed slot**，也不存在 `sidebar.panellist`。`details` 是 single，注册进去等于替换整个右栏；本版本没有"右栏 tab"这一层。

#### 样式

- 用 `--dsw-alias-*` 语义 token，不写字面色值、不做明暗分支。
- 手写路径直接注入 `<style>`；模块系统在 materialize 时会**认领未打标的 style 标签**，HMR 卸载时按 `data-plugin` 清理：

```js
const style = document.createElement('style')
style.setAttribute('data-plugin-css', STYLE_ID)
```

#### Host ↔ Client 通信

`@Remote` 需要 TypeScript 装饰器 + typert 代码生成，**纯 JS 不可行**（等于手搓生成器）。可行方案有两条：

| 方案 | 可用性 | 说明 |
|---|---|---|
| `ctx.connection.rpc.handle(channel, handler)` | 0.1.x 起 | `channel` 不能是 `/api`；只有 POST + JSON 信封 |
| `ctx.webServer.register({ kind, path, handler })` | 所有带 HTTP carrier 的组合 | 无信封协议，最简单 |

**本插件选第二条**：版本无关、无协议负担。代价是必须自己承担鉴权，见 1.5。

### 1.5 自己开路由就必须自己守门

carrier 的 `/api` 网关自带浏览器信任栅和 token，但**自定义路由不在其内**。本插件的面板路由会暴露一个学习者的档案与进度，因此自己做两层判断：

1. **`Host` 必须是 loopback**（`127.0.0.1` / `localhost` / `::1`）——这是真正的边界，挡住 DNS rebinding 与 loopback 端口上的代理；
2. **`Origin` 存在时必须是本地来源**（loopback http(s)、`dsh-app:`、`file:`、`null`）——纵深防御。

有意不做得更严：能读本地文件的进程本来就能直接读那个 JSON，`file:` 与 `Origin: null` 放行不损失安全性。

路径也**故意不放在 `/api` 下**：蹭那个前缀会变成"过了一道鉴权又绕过另一道"。

---

## 第二部分：Learning-Accelerator 的原理

### 2.1 它是什么

上游项目（`~/Desktop/project/github/Learning-Accelerator`）是一个**通用学习操作系统**，不是教程合集。它由三部分组成：

| 组成 | 作用 |
|---|---|
| `SKILL.md` / `SYSTEM_PROMPT.md` | 注入到 agent 的教学协议：模式分类、教学单元序列、输出结构 |
| `references/learning_os_protocol.md` | 状态 schema 与操作协议：间隔重复、练习生成、错误分析、难度校准 |
| `learning_accelerator/` | Python 参考实现：`JsonStateStore` + CLI + dashboard/TUI |

核心主张：**学习状态要持久化，复习要按算法调度，难度要按证据调整**——而不是每轮对话从零开始。

### 2.2 状态模型

```json
{
  "schema_version": 1,
  "learner_profile": { "learning_domain", "known_skills", "experience_level",
                       "learning_goal", "target_outcome", "constraints", ... },
  "topic_state":     { "current_topic", "level", "mastered_concepts", "weak_concepts",
                       "concept_progress": { "<concept>": ConceptProgress }, ... },
  "practice_state":  { "exercise_specs", "attempt_records", "current_tasks", ... },
  "review_state":    { "due_items", "next_review_items", "review_history" },
  "difficulty_state":{ "current_difficulty": 1..5, "evidence": [...], "next_adjustment" }
}
```

三个设计要点值得单独指出：

1. **`concept_progress` 是关键**。它让复习调度不再依赖对话记忆：`strength`（0–1）控制间隔增长，`correct_streak` 决定下一个间隔，`failure_count` 让反复出错的概念持续可见，`next_due_at` 让 agent 能排序。
2. **id 是确定性的**。`_stable_id(*parts)` = `sha1(小写去空、'\n' 连接)[:12]`。同一概念+题目再次调度时是 **upsert 而不是追加**，所以复习队列不会膨胀。
3. **状态是可迁移的**。`migrate()` 补齐旧版字段（`known_stack` → `known_skills`、`current_project_tasks` → `current_tasks`、给缺 id 的复习项补 id），`validate()` 兜底并强制 schema_version。这使文件可以手改、可以跨版本读。

### 2.3 间隔重复与优先级

写入路径（`complete_review`）在一次调用里做四件事：

```
归档到 review_history
  → 按 result 重新调度（correct=1d / second_correct=3d / third_correct=7d / fuzzy|incorrect=0d）
  → 更新概念所属列表（incorrect|fuzzy → weak；second|third_correct → mastered）
  → 更新 concept_progress（strength ±0.1/0.2、streak、failure_count、next_due_at）
  → 追加难度证据并重算难度
```

读取路径（`priority_reviews`）的排序权重：

```
priority = (到期 ? 20 : 0) + (薄弱概念 ? 30 : 0) + (1 - strength) × 20 + failure_count × 3
```

即"到期 + 薄弱 + 掌握度低 + 反复失败"四者叠加，再按到期日、概念名**码点序**稳定排序，最后取 limit 条（默认 5）。这解释了协议里"不要把所有东西都拿去复习，挑 2–5 个高价值项"。

第三级比较必须是码点序（`compareCodePoints()`）而非 `localeCompare`：后者是 locale 排序、大小写不敏感，`'B' < 'aaa'` 在 Python 成立而在 locale 下不成立。这一级不落盘，所以逐字节等价测试看不见它——v0.2.0 就把它漏过去了（见第五部分与 `CHANGELOG.md` v0.2.1）。

### 2.4 难度校准

```
evidence 追加 signal（保留最近 20 条）
  → 看最近 2 条：两个正向信号 → 难度 +1；两个负向 → 难度 −1；否则不变（都钳在 1..5）
```

正向：`exercise_completed` / `explain_correct` / `recall_correct`
负向：`exercise_failed` / `recall_incorrect` / `explain_fuzzy` / `setup_failed`

注意它**不看用户自述的信心**，只看观察到的行为证据——这是协议里明确写的反模式。

### 2.5 一个不一致之处（实现时顺手修掉）

`record_attempt` 的 `result` 校验只接受 `pass | partial | fail`，但内部把非 `pass` 一律折算成 `fail`：

```python
review_result = "correct" if result == "pass" else "incorrect"
```

也就是说 `partial` 在调度语义上等于 `fail`。这会让模型以为可以表达"部分正确"，但落盘信息丢失。

本插件的处理：**保留两种语义**。工具的 `attempt` 动作使用独立的 `attempt_result` 参数（`pass | partial | fail`），落盘时按上游规则折算给 store（`partial` → `fail`），同时把原始判断记在返回值的 `attempt.outcome` 上。store 与 Python 仍逐字节一致，模型也不丢失表达力。

---

## 第三部分：从原理到设计决策

| 分析结论 | 由此产生的设计决策 |
|---|---|
| 学习状态是本插件的核心资产，读写必须无歧义 | 用纯 JS 移植 `state.py`，并用测试**逐字节**比对 Python 产物；两边可互相读写同一文件 |
| 状态文件的归属必须唯一，否则学习进度会静默走失 | 单一优先级链（`state_file` → session cwd → 配置 root → 进程 cwd），集中在 `lib/scope.js`，单独单测 |
| Prompt 注入能让模型"零成本"知道该复习什么 | 用 `systemPrompt.context` 而不是静态 section（每轮重新求值）；**只在状态文件已存在且非空时注入**，无关会话一个 token 都不花 |
| 上游的*方法*（`SKILL.md` / `SYSTEM_PROMPT.md` / `references/learning_os_protocol.md`）只以"请 agent 去读"的形式存在，而这门插件已经拥有了*状态*——只有状态没有方法，等于一个复习调度器 | 把三份 markdown 移植成 `lib/protocol.js`（纯数据 + 纯函数），作为**第二个**注入块 `learning-accelerator/protocol`（order 比状态块小 1，先方法后状态），与状态块共用同一门禁 |
| 一条全新学习线的第一轮还没有 state 文件，两个注入块都静默，方法会缺席最关键的那一轮 | `learning_session` / `learning_domain` 的返回值带 `teaching_protocol` 并渲染进模型可见文案：第一轮由工具带回，第二轮起由注入块承担 |
| 上游把"不要默认对方懂前端"写成纪律，但执行它靠模型的自觉 | 画像适配改成按档案数据分派（`profileTrack()`）：`no_programming` 优先于一切，只有明确写了前端/JS/TS/React/Node 才给前端对照表，未知背景两者都不给 |
| 提示词里的协议越长，每轮成本越高，且会随上游文档更新而漂移 | 注入版只保留"怎么教"的必需项，长度由测试卡在 6000 字符以内；状态 schema 不复述，交给内核与 `schemas/` |
| 工具返回值是程序 API，正文是给人看的 | 五个工具都返回结构化 JSON；解释性文案全部放在 `output.render` |
| 写入路径越多，越容易写出不一致的状态 | `learning_record` 是唯一写入工具，`action` 枚举分派；每次返回"改了什么"而不是"成功" |
| 读路径不该因为文件被手改坏就毁掉一整轮 | 读工具捕获解析错误，返回 `{ ok: false, error }` 让面板和模型都能解释并修复 |
| 客户端半边无构建、无 `@Remote` | 用 `webServer` 路由 + 浏览器 `fetch`；客户端 bundle 是 classic script |
| 自建路由等于自建信任边界 | Host/Origin 双重校验；测试里显式覆盖 DNS rebinding 场景 |
| 可选依赖探测会静默失败 | 用嵌套 `ctx.inject(['webServer'])` 等待，而不是 `ctx.get` 探测 |
| Cordis 会按 `inject` 门禁服务读取 | 服务实例在 `apply` 里构造一次，工具与提示词回调**闭包引用**该实例，避免在非 fiber 上下文里读 `ctx.<service>` |
| 侧边栏 seat 无法激活会话 tab | 侧边栏入口只做它真能做的事（显示到期数量与提示），不假装能打开 tab |

---

## 第四部分：真机验证记录

用已打包的 dsh **0.2.0-rc.2** 在独立 profile 上端到端验证（不触碰当前 GUI）：

```sh
dsh plugin --profile learning-test add ./dsh-plugin-learning-accelerator
dsh --profile learning-test --port 3099 --no-open
```

结果：

| 检查项 | 结果 |
|---|---|
| bundle 层进入组合配置 | ✅ `# == dsh-plugin-learning-accelerator` / `- id: learning-accelerator` |
| 插件加载无错误 | ✅ 启动日志无异常，fiber 未 FAILED |
| 面板路由注册并响应 | ✅ `GET /learning-accelerator/panel` → `200`，`cache-control: no-store` |
| 返回真实状态与解析路径 | ✅ `"path": ".../.learning/state.json"`, `"source": "process-cwd"` |
| 伪造 Host 被拒 | ✅ `Host: evil.example.com` → `403 forbidden` |
| 客户端包被 host 扫描进 boot graph | ✅ `__DSH_BOOT__` 中出现 `dsh-plugin-learning-accelerator/client.js` 及其 rev |
| bundle 路由 | ⚠️ 该运行时对所有插件的 `/plugins/<id>/client.js` 都返回 404（含官方包）；v0.2.0 的复查把这条收窄了，见第 4.5 节 |

### 4.5 v0.2.0 复验（同一打包运行时 0.2.0-rc.2）

补齐教学协议之后重跑了一次真机验证，并且这次把"注入是否真的到达模型"也测了。使用的 CLI 是打包
运行时自带的那一个，不是源码 checkout：

```sh
DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"   # 0.2.0-rc.2
"$DSH" --profile la-web --from-default-profile web --dump-config     # 建临时 profile（不碰 desktop）
"$DSH" plugin --profile la-web add /Users/jackson/Desktop/project/github/dsh-plugin-learning-accelerator
cd /tmp/la-e2e-project && "$DSH" --profile la-web --port 3099 --no-open
```

先在一个临时项目里用**内核自己**写出一份真实状态（技术领域、前端背景、一个薄弱概念、一条到期复习、
一个任务、一条难度证据），再逐项验证：

| 检查项 | 结果 |
|---|---|
| 路由与头 | ✅ `200`、`content-type: application/json; charset=utf-8`、`cache-control: no-store` |
| 真实状态回传 | ✅ `path=/private/tmp/la-e2e-project/.learning/state.json`、`topic=Cordis 插件生命周期`、`weak=[Cordis waterfall 语义]`、`mastered=[插件 apply 函数]`、`due=1` 且带出回述题 |
| 伪造 `Host` | ✅ `403` |
| 远端 `Origin` | ✅ `403` |
| `POST` | ✅ `405` |
| `HEAD` | ✅ `200` |
| loopback 直连、不带 token | ✅ `200`（有意为之：能读本地文件的进程本来就能读那份 JSON） |

**解析来源四级都在真机上跑过**（各自用 `--patch` 覆盖一层配置）：

| 配置 | `payload.source` | 解析到的路径 |
|---|---|---|
| 无（进程 cwd 就是项目） | `process-cwd` | 项目里的 `state.json` |
| `config.root` | `config-root` | 被钉住的项目 |
| `config.scope: user` | `user-scope` | `~/.learning-accelerator/state.json`（未被创建，读路径不写盘） |
| `config.stateFile` | `argument` | 指定文件 |

**注入是否真的到达模型**——用 `headless` profile（同样装了本插件）加 `--json` 看运行事件，三轮都
在临时项目里跑，且要求模型**不要调用任何工具**：

| 目标 | 证据 |
|---|---|
| 状态块进入系统提示 | 模型自己的 thinking：*"The learning state is in the system context: current topic Cordis 插件生命周期, weak point Cordis waterfall 语义, difficulty 1"*，并在一句话里答对这三项；`inputTokens=10842` |
| 协议块进入系统提示 | 问"每轮收尾要生成哪四样、有哪些本轮模式、连续两个同向信号会怎样"，模型 thinking 明说 *"All three are in the context (教学协议)"*，并答出四样收尾产物、七个模式 id、以及"连续两个同向才移动一档（1-5）"加八个信号名与 `evidence` 动作 |
| 门禁：没有学习线就沉默 | 在没有 `state.json` 的目录里问同一件事，模型答 *"没有学习状态"* |
| 会话 cwd 参与解析 | 事件流首行 `{"type":"session","cwd":"/private/tmp/la-e2e-project"}` |
| 只读轮不写盘 | 三轮之后 `review_history=0`、`next_review_items=1`、难度证据 `=1`、`attempt_records=0`——与种子文件完全一致 |
| 无 HTTP carrier 的组合仍可用 | `headless` profile 里没有 webServer，工具与两个注入块照常工作（面板路由的 fiber 停在 PENDING，正是设计预期） |

**客户端半边这次也复查了，结论比第 4 部分更窄也更准**：boot graph 里确实有本包的行与 rev
（`dsh-plugin-learning-accelerator/client.js&rev=b532120ea95c`，且出现在一个 combo 分组行里），但
`/plugins/<id>/client.js` 的四种写法（单文件、`?rev=`、`&rev=`、带 token）以及页面实际使用的
`/plugins/??a/client.js,b/client.js` combo 形式**全部 404**，而且官方包
（`@deepseek-ai/dsh-client-ui-cartoon`、`@deepseek-ai/dsh-client-ui-deliverables`）走同一路径也是
404。所以这是**运行时级的资产路由缺失**，与本插件无关，但也意味着**浏览器半边在本机无法做真实渲染
验证**：tab 与侧边栏角标在这个运行时里不会被加载，只能靠 `tests/client-plugin.test.js`（用带真实
重渲染语义的 React stand-in 断言双语文案）保证。

还**没有**在真机上验证的一项：面板"跟随会话"那条分支需要 web 进程内先跑过一轮对话（`storeFor` 才会
记下会话路径），这需要一个 LLM 轮次；本次只验证了同一条解析链的另外三档（`process-cwd` /
`config-root` / `user-scope` / `argument`）。接线本身由 `tests/host-plugin.test.js` 里那两条走完
`apply` → 真实路由 handler 的回归测试覆盖。

验证用的临时 profile、session 记录与 `/tmp` 现场都已删除；当前 GUI（19387）未被触碰。


单元测试 74 项全绿（v0.2.0，补齐教学协议之后）：

```sh
cd ~/Desktop/project/github/dsh-plugin-learning-accelerator && node --test tests/
# tests 74  pass 74  fail 0
```

其中包括"JS 状态内核与 Python 产物逐字节一致"与"插件卸载后工具与两个提示词上下文全部撤销"两项关键回归。

> v0.2.1 起为 **80 项**。新增的六项针对 v0.2.0 漏掉的一类缺陷：逐字节等价只证明**落盘数据**一致，
> 证明不了**模型看到的内容**一致。并列项的排序（`localeCompare` vs 码点）、两个工具的 `limit`
> 上限、`on_date` 的 UTC/本地口径，都不进状态文件，因此等价测试全绿也发现不了；`priority_reviews`
> 的并列排序就是这样漏过去的。详见 `CHANGELOG.md` 的 v0.2.1 与 `tests/store-equivalence.test.js`。

### 补充：在"只有已发布依赖"的环境里复现

第 4 部分的真机验证用的是本机 checkout 的 peer 软链。v0.2.0 额外验证了 CI 路径——不依赖本地
`deepseek-harness` checkout，只用 npm 上已发布的 peer 包：

```sh
# 复刻 .github/workflows/ci.yml 的步骤
git clone --depth 1 https://github.com/Maolipeng/Learning-Accelerator.git ../Learning-Accelerator
npm install --no-save --no-package-lock \
  @deepseek-ai/cordis@^4.0.4 @deepseek-ai/schemastery@^3.18.2 \
  @deepseek-ai/dsh-tools@0.2.0-rc.2 @deepseek-ai/dsh-system-prompt@0.2.0-rc.2
node --test tests/
# tests 74  pass 74  fail 0  skipped 0
```

注意 `skipped 0`：上游 checkout 就位后，逐字节等价测试是**真的跑了**，而不是静默跳过。

同一路径也确认了一件事：`@deepseek-ai/dsh-tools` 的 npm `latest` 标签是 `0.0.1-rc.1`，
**不满足**本包 `>=0.1.0-rc.5` 的 peer 范围；要装 `next`（`0.2.0-rc.2`）或 `alpha`。CI 因此把版本钉死，
而不是浮在标签上。

真机验证已经在 4.5 节补跑（同一打包运行时 0.2.0-rc.2，含面板四级解析来源与两轮"注入是否到达模型"的
证明）。第 4 部分上半部分那行旧记录仍然保留，并且**现在能确定它是 bug 现场**：那里的
`"source": "process-cwd"` 当时被当作正常输出，v0.2.0 查明面板的"跟随学习者"分支在默认配置下根本
不可达——因为 `apply` 总把带默认值的 `scope` 传给路由，而 `panelRequest` 把任何显式 scope 都当成
"停止跟随"。修法与回归测试见 `docs/architecture.md` 第七节；4.5 节里 `process-cwd` 再次出现是另一回事
（那次进程 cwd 恰好就是项目目录，属于文档化的正常兜底）。

---

## 第五部分：与上游的差距，以及有意不对齐的部分

v0.2.0 对齐掉了四类差距：教学协议（`lib/protocol.js` + 第二个注入块 + 工具带回）、机器契约
（`schemas/learning_state.schema.json`）、工程化（CI、CHANGELOG、版本、LICENSE）、内容资产
（`docs/` 与 `examples/`）。**以下四项是有意不搬的**，理由要能被将来的维护者反驳，所以写在这里：

| 上游有 | 本插件不做的理由 | 如果将来要做 |
|---|---|---|
| Python CLI 的 26 个子命令（`show` / `summary` / `concept-progress` / `exercise-show` / `due` / `dashboard` …） | 这些命令在插件里的消费方是**模型**，而模型已经有五个返回结构化 JSON 的工具；再包一层 CLI 等于给同一份内核加第二个入口，两边都要维护参数校验 | 若使用者（人/脚本）需要命令行，应写成薄薄的 `bin/*.js`，直接调 `LearningStore`，不复制语义 |
| 终端 dashboard 与交互式 TUI | 本插件已有 Web 面板（`conversation.view` tab + 侧边栏到期角标），而且面板跟随会话所在的 state 文件；终端渲染是同一份 `summary()` 的第三种呈现 | 只有当使用者在无 GUI 环境（纯 ACP/headless）里学习时才值得做，且应复用 `panelPayload()` 形状 |
| `SKILL.md` / `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / `.cursor/rules` / `manifest.json` / `skills.sh.json` | 这些是"让另一种 agent 运行时加载这门 skill"的适配层。本插件是 DSH 原生能力：协议进 prompt、状态进内核，不依赖任何宿主去读 markdown | 若要把协议卖给别的运行时，导出 `lib/protocol.js` 的纯函数即可，不需要维护七份 markdown 副本 |
| `pyproject.toml` / pytest / 覆盖率门（`fail_under = 80`） | 内核已经是 JS；Python 只作为**等价性对照物**存在，CI 把上游 clone 到旁边跑逐字节比对，而不是让它成为本包的运行依赖 | 若要自测覆盖率，用 `node --test --experimental-test-coverage`，并给同类阈值 |

v0.2.1 又补掉了两类**不是有意取舍、而是真的缺**的差距：

1. **`learning_record` 的 `exercise` action**。上游 `exercise complete|fail` 走 `record_exercise()`，
   那是 `completed_exercises` / `failed_exercises` 的唯一写入口，也是 `exercise_completed` /
   `exercise_failed` 两个难度信号唯一的自动来源。内核方法在 v0.2.0 就存在且有单测，但**没有任何
   action 调它**，所以这两个列表对只用工具的 learner 恒为空。见 `CHANGELOG.md` v0.2.1 的 Added。
2. **tag 触发的发布链路**（`.github/workflows/release.yml`）。上游有 `release.yml`（tag → 测试 →
   `python -m build` → 上传 dist），v0.2.0 只有 `ci.yml`，即"能验证但不能发布"。现在 `v*` tag 会
   校验 tag 与 `package.json` 版本一致、跑完整套件（含逐字节等价，上游 clone 到旁边）、`npm pack`
   并把 tarball 挂到 GitHub Release；带 `NPM_TOKEN` 时另起一个 job 用 `--provenance` 发布到 npm，
   没有该 secret 就只发 GitHub Release、不静默失败。

一处**故意保留的不一致**：`attempt` 的 `partial` 在落盘时仍按 `fail` 处理（与上游 Python 一致，
以保证逐字节等价），但返回值里额外保留 `outcome: 'partial'`，让模型不丢失表达力。这是"内核忠实、
集成层补全"的分工，`tests/store-equivalence.test.js` 守着前一半，`tests/host-plugin.test.js` 守着后一半。
