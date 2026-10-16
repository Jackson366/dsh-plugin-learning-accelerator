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

即"到期 + 薄弱 + 掌握度低 + 反复失败"四者叠加，再按到期日、概念名字典序稳定排序，最后取 limit 条（默认 5）。这解释了协议里"不要把所有东西都拿去复习，挑 2–5 个高价值项"。

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
| bundle 路由 | ⚠️ 该运行时对所有插件的 `/plugins/<id>/client.js` 都返回 404（含官方包），说明这条路由的挂载方式与源码 checkout 的文档描述不同，与本插件无关；graph row 与 rev 已正确生成 |

单元测试 74 项全绿（v0.2.0，补齐教学协议之后）：

```sh
cd ~/Desktop/project/github/dsh-plugin-learning-accelerator && node --test tests/
# tests 74  pass 74  fail 0
```

其中包括"JS 状态内核与 Python 产物逐字节一致"与"插件卸载后工具与两个提示词上下文全部撤销"两项关键回归。

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

本轮未重跑桌面端（0.2.0-rc.2 独立 profile）的端到端验证，所以第 4 部分上半部分的记录仍是 v0.1.0 的
运行时结果。但其中一行现在需要修正：那条记录里的 `"source": "process-cwd"` 当时被当作正常输出，
v0.2.0 查明它是一个**接线 bug**——面板的"跟随学习者"分支在默认配置下根本不可达，因为 `apply` 总把
带默认值的 `scope` 传给路由，而 `panelRequest` 把任何显式 scope 都当成"停止跟随"。修法与回归测试见
`docs/architecture.md` 第七节；`docs/analysis.md` 保留这条旧记录，是因为它恰好是"单测全绿但真实挂载
走错分支"的现场证据。

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

一处**故意保留的不一致**：`attempt` 的 `partial` 在落盘时仍按 `fail` 处理（与上游 Python 一致，
以保证逐字节等价），但返回值里额外保留 `outcome: 'partial'`，让模型不丢失表达力。这是"内核忠实、
集成层补全"的分工，`tests/store-equivalence.test.js` 守着前一半，`tests/host-plugin.test.js` 守着后一半。
