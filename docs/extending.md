# 扩展指南

面向"要给这个插件加东西"的人。四类常见改动各给一份清单，每一步都标出**改哪里**和**漏了会怎样**——
后者比前者重要，因为这个包的设计原则是"能静默退化"的地方都留了兜底，兜底反而容易让遗漏藏起来。

引用约定：`lib/**`、`tests/**` 是本仓库路径；`node_modules/@deepseek-ai/**` 是本包已安装的 harness
依赖源码，`packages/core/**` 是 DSH 源码 checkout 里的对应包——两者都是用来核对"契约到底怎么规定"的
一手依据，不是抄来的说法。

---

## 一、新增一个学习领域

四个编辑点，落在三个文件里。缺任何一个都不会崩溃，这正是它需要清单的原因。

### 1. `lib/learning-store.js:87-160` — `DOMAIN_TEMPLATES`

加一个 key，字段照抄现有条目（六个字段一个都不能少）：

```js
music: {
  domain: 'music',
  focus_areas: ['乐理', '视唱', '节奏', '曲目'],
  practice_types: ['跟练', '听辨', '小段演奏', '复盘录音'],
  review_strategy: 'Review weak passages, repeated rhythmic mistakes, and recently learned repertoire.',
  onboarding_questions: [
    '你想学什么乐器或哪类音乐知识？',
    '你现在熟悉哪些乐理、乐器或练习方法？',
    '你希望达到什么具体结果？',
    '你每天能练多久？',
  ],
},
```

这是 `learning_session` 返回的 `onboarding_questions` 与 `learning_domain` 的**唯一**数据源
（`lib/learning-store.js:757-765`，`LearningStore.domainTemplate()`）。

### 2. `lib/protocol.js:178-185` — `DOMAIN_TEACHING_NOTES`

加一条领域教学注记（一句话，写"这个领域该怎么教"，不是"教什么"）：

```js
music: '以听辨与跟练为主，一次只推进一个小节；用录音复盘代替主观感受。',
```

`composeTeachingProtocol()` 用它拼协议里的"领域适配"段（`lib/protocol.js:263,323-324`）。

### 3. `lib/tools/session.js` 与 `lib/tools/domain.js` — 两个 `enum`

同一个枚举写了两遍：`learning_session` 的 `domain` 与 `learning_domain` 的 `domain`。两处都要加
`'music'`。

### 漏改会怎样

| 漏了哪一处 | 后果 | 证据 |
|---|---|---|
| 两个 enum 之一 | 该领域对模型**完全不可达**：`defineTool` 在调用 `execute` 之前就按 `parameters` 校验，越界值抛 `ToolArgsError`，消息形如 `invalid arguments: "domain" must be one of [...]`。**不是**回退到 `general`，而是整个调用被拒。 | `node_modules/@deepseek-ai/dsh-tools/src/schema.ts:478-480`（`validateArgs`）、`:461-470`（`ToolArgsError`）、`:554-579`（`defineTool` 包装）；断言见 `tests/host-plugin.test.js:484-487` |
| `DOMAIN_TEACHING_NOTES` | 领域仍可用，但教法静默退回通用注记——最难发现的一类退化。 | `lib/protocol.js:263`（`?? DOMAIN_TEACHING_NOTES.general`） |
| `DOMAIN_TEMPLATES` | `learning_session` / `learning_domain` 返回 general 的模板，`template.domain` 会是 `general`。 | `lib/learning-store.js:763-765`；测试 `tests/host-plugin.test.js:488-490` |

补充两点：

- `schemas/learning_state.schema.json:28` 的描述文字里列了已知领域名。它是散文、不是 enum，校验不读
  它；为一致性顺手改，但不改不会有测试红。
- `tests/protocol.test.js:127-133` 会遍历 `DOMAIN_TEACHING_NOTES` 自动覆盖新领域；而
  `tests/host-plugin.test.js:476` 是**硬编码**的领域数组，需要手动加。`tests/host-plugin.test.js:472-494`
  还断言"越界领域必须被拒 + store 层仍然兜底"，加领域时别把这两条改反了。

---

## 二、新增一个 `learning_record` action

`learning_record` 是唯一写入路径，所以加 action 等于扩写路径。五个编辑点：

### 1. `lib/tools/record.js` 的 `action.enum` — 把 action 名加进去

`action` 是唯一带 `required: true` 的参数。若新 action 需要新参数，同时加进
`lib/tools/record.js` 的 `parameters`：

- 数组参数要写 `{ type: 'array', items: { type: 'string' } }`（照 `concepts` / `constraints`）；
- 必填参数写 `required: true`（照 `action`）；
- 能用内核常量就别手抄字面量：`difficulty` 是 `enum: [...EXERCISE_DIFFICULTIES]`（`lib/tools/record.js`），
  而 `signal` 是手抄的七项（`:359-363`）——前者是正确示范。

### 2. `lib/tools/record.js` 的 `execute` — 加 `case`

固定三步：先做自己的必填检查（现有写法是 `throw new Error('<action> requires <param>')`），再调 store
的公开方法落盘，最后只把"改了什么"挂到 `payload` 上。

两个已经踩过的坑，别重演：

- **返回值会被冻结**：registry 快照 `execute` 的返回值、按 `output.schema` 校验并 `deepFreeze`
  （`node_modules/@deepseek-ai/dsh-tools/src/index.ts:1839-1844`）。所以不要返回 store 的活对象，
  也不要指望之后还能改它。
- **要读回"刚写进去的那一行"，就用确定性 id 重算**，不要猜是最后一条：范例见
  `lib/tools/record.js`（`stableId('review', concept, prompt)` 与 `stableId('exercise-spec', ...)` 两处）
  （`stableId('exercise-spec', ...)`）。

### 3. `lib/tools/record.js` 的 `output.render` — 文案

规范值保持不变，把人类/模型要读的解释写在这里。字段块已经是可复用的（`value.review` / `value.exercise` /
`value.attempt` / `value.concept_progress` / `value.difficulty`），新 action 通常加一个 `if` 块。
`presentationMeta`一般不用动。

### 4. `lib/protocol.js:306-308` — 协议里的 action 清单

"状态写入"一节列了全部 action 名。这一步不是可选的：`tests/protocol.test.js:135-144` 会断言清单里的
每个 action 都出现在协议文本中，漏了直接红。

### 5. `tests/host-plugin.test.js` — 加用例

照现有两条链路的写法：`review_add → learning_due 读回 → review_complete`（`:213-250`），
以及 `exercise_spec → attempt`（`:252-312`）。模式是"先 onboarding 建状态 → 触发 action → 用另一个工具
把结果读回来"，只断言返回值不够。

---

## 三、新增一个工具

### 步骤

1. 在 `registerLearningTools()`（`lib/tools/index.js`）的 `TOOLS` 数组里加你的工厂。
   `ctx.tools.register` 的 disposer 自动挂到当前 fiber，不需要手写清理。
2. 五个必需件：`name` / `description` / `parameters` / `output.schema` / `output.render` / `execute`
   （`presentCall` / `presentResult` 可选但本项目每个工具都写了）。
3. 依赖的 harness 服务不用另外声明：`tools` 已经在 `lib/index.js:47` 的 `inject` 里。

### DSH 工具契约（三条硬约束）

| 约束 | 含义 | 依据 |
|---|---|---|
| `output.schema` 是**唯一权威返回值** | `execute` 的返回值被快照、按 schema 校验、冻结，然后作为 `value` 存进规范结果。schema 里没声明的字段等于不存在。 | `node_modules/@deepseek-ai/dsh-tools/src/index.ts:1839-1844`；`schema.ts:491-495` |
| `output.render` 才是给模型看的文案 | registry 用 `render(args, value)` 的返回作为 `content`；解释性文字写这里，规范值保持干净、可程序化消费。 | `index.ts:1845-1851` |
| `presentCall` / `presentResult` 必须是**纯函数** | UI 会在实时流式**和会话日志回放**两种场景下调用它们，所以只能依赖 `args` 与耐久的结果投影。 | `node_modules/@deepseek-ai/dsh-tools/src/schema.ts:283-299` |

本项目里这三条都有现成范例：`learning_status` 的 `output.schema: { type: 'json' }` + 中文
`render` 与只读 `args` / `result.content` 的 presenter（范例见 `lib/tools/status.js`）。

### 必须同步的硬编码（不改就红）

| 位置 | 内容 |
|---|---|
| `tests/host-plugin.test.js:104` | 轮询条件 `< 5` |
| `tests/host-plugin.test.js:107` | `assert.equal(ctx.tools?.registered.size, 5)` |
| `tests/host-plugin.test.js:142-145` | 工具名排序后的精确数组 |
| `README.md` 的工具表、`lib/index.js:8` 的模块注释 | 都写着"五个工具" |

`tests/host-plugin.test.js:160-172` 是通用体检：每个工具都必须有 `output.schema`、`output.render`、
`execute`，且 `description.length > 20`。

---

## 四、新增一个 prompt 注入块

### 契约（来自 `@deepseek-ai/dsh-system-prompt`）

| 字段 | 规则 | 依据 |
|---|---|---|
| `name` | 必须唯一。**同层重名注册直接抛错**，消息是 `prompt context "<name>" is already registered in this scope`；想给单个 agent 覆盖，走 `agent.ctx` 注册（同一条错误消息里给了指引）。 | `node_modules/@deepseek-ai/dsh-system-prompt/src/index.ts:79-80,408-412` |
| `order` | 必须是有限数字，否则抛 `TypeError`。上下文按 order 升序拼接，相同 order 用名字的 code-unit 序。 | `:82-83,513-516` |
| `text` | 字符串或 `(AssembleContext) => string`；函数形式在每次 assemble 与 admission refresh 时求值。要"每轮反映最新状态"就必须用函数。 | `:84-85` |
| 空文本 | 返回 `''` 等于不贡献，渲染侧会过滤掉（这也是零 token 门禁的实现基础）。 | `:85`，`:326-338` |
| `required` | 不设它，这一块会被组合配置的 `includeRuntimeContext: false` 整体抑制；要免疫就传 `required: true`。本插件的两块都**没有**设，即接受被整体关掉。 | `:88-89,467,686` |

### 步骤

1. **选 order**。官方占用的具名位置是 100/110/115/120/125 与 200/210（`:170-179`）；工具指导带是
   100–199，本插件默认把状态块放 150、协议块放 149（`lib/index.js:64-66,168,183`）。新块要么复用
   `promptContextOrder` 的相邻槽位，要么给它自己的配置键。**给它自己的开关**：否则用户无法单独关掉它，
   而 `tests/host-plugin.test.js:577-593` 的语义就是"每个块都能独立开关"。
2. **在 `ctx.inject(['learningAccelerator'], ...)` 体里注册**（`lib/index.js:160-193`），让 `text` 闭包
   引用同一个 service 实例。不要在 `apply` 顶层直接读 `ctx.learningAccelerator`：Cordis 会按 fiber 的
   `inject` 门禁服务读取，`lib/index.js:156-159` 的注释解释了为什么需要这一层。
3. **在 `Config` 里声明开关与默认值**。`Config`（`lib/index.js:50-70`）是默认值的唯一来源，Cordis 挂载时
   套用；patch 行整块替换 `config`，未重述的键回到这里的默认值。
4. **复用注入门禁** `_injectableSummary()`（`lib/scope.js:257-265`），否则无关会话会被每一轮收税。
5. **防抛**：文本构造函数要吞掉异常返回 `''`（照 `promptContext()` / `protocolContext()` 的
   try/catch，`lib/scope.js:283-303,315-336`）——注入失败不该毁掉一整轮。
6. **测试**：`tests/host-plugin.test.js:138-158`（context 数量、名字、order 的精确断言）与
   `:577-593`（开关独立性）都要跟着改。

另一个容易忽略的点：`text` 回调拿到的是 `AssembleContext`。它的 `agent` 字段不在
`dsh-system-prompt` 自己的类型里，而由 agent 包做模块增补（`packages/core/agent/src/runtime-types.ts:18-23`），
运行时由 `assembleContextFor()` 填入（`packages/core/agent/src/dispatch.ts:174`）。要按会话定位状态文件，
就照 `lib/index.js:172,189` 传 `assemble?.agent`，并在下游对 `undefined` 做兜底
（`lib/scope.js:43-57`）——诊断类装配没有 agent。

---

## 五、浏览器半边的约束

`lib/client.js` 是 classic script，契约和普通前端插件不同，八条约束：

1. **顶层不能有 `import` / `export`**：host 用 `<script src>` 加载它（`lib/client.js:6-12,30`）。
2. **不能写 JSX**：手写路径只能用 `React.createElement`，文件里别名成 `h`（`lib/client.js:35`）。
3. **`require` 只能取模块表里的 specifier**：当前用 `react` 与
   `@deepseek-ai/dsh-client-ui-primitives`（`lib/client.js:33-34`）。测试里的 `require` 桩对未知 specifier
   直接抛 `unexpected require`（`tests/client-plugin.test.js:226-229`），所以漏声明会立刻暴露。
4. **必须 external `react`**：手写 JS 天然满足；构建路径下由 purity gate 强制（`docs/analysis.md` 1.4）。
5. **`id` 必须等于包名** `dsh-plugin-learning-accelerator`，否则 loader 抛错
   （`lib/client.js:30-31`；断言见 `tests/client-plugin.test.js:311-319`）。
6. **样式**：只用 `--dsw-alias-*` 语义 token，不写字面色值、不做明暗分支；注入的 `<style>` 必须打
   `data-plugin-css` 标记，否则 HMR 卸载时清不掉（`lib/client.js:98-108`；测试 `:481-490`）。
7. **标签用 thunk**：`label: () => t('view.learning')`，语言切换不需要重新注册
   （`lib/client.js:390-391`；测试 `:321-337`）。
8. **`dsh.client.platform` 必须是 `'web'`**，且这个判定会被缓存、不会失效（`package.json:27-30`；
   `docs/analysis.md` 1.4）。`dsh.client.inject` 是**包名**的信息性边，真正的 fiber 依赖来自 bundle 导出的
   `inject: ['slots', 'locale']`（`lib/client.js:378`）。

注册 slot 时，目标 slot 由别的包声明，所以用 `ctx.slots.inject(key, cb)` 等声明而不是直接
`register`（`lib/client.js:385,396`）：声明不存在时 cb 不会执行，这是唯一顺序安全的写法。
list 槽必须给 `id`，同 cell 同 priority 二次注册会抛错（`docs/analysis.md` 1.4）。

---

## 六、测试怎么写

- **框架**：`node:test` + `node:assert/strict`，没有测试框架依赖。跑全套：`node --test tests/`。
- **纯模块优先**：`lib/protocol.js`、`lib/learning-store.js`、`lib/scope.js` 都能脱离 Cordis 直接 import，
  优先给它们写纯函数单测（`tests/protocol.test.js`、`tests/store-equivalence.test.js`、
  `tests/schema.test.js` 都是这种）。
- **宿主测试用 `ToolsMock` / `SystemPromptMock`**（`tests/host-plugin.test.js:49-86`）。写 mock 的关键不是
  记录调用，而是**复刻生命周期契约**：`register()` 通过 `ctx.effect` 挂 disposer，`context()` 卸载时
  **原地 splice** 而不是重新赋值。做不到这两点，`tests/host-plugin.test.js:564-575` 的"卸载后全部撤销"
  会空过——它仍然会绿，但什么都没验证。
- **等可观察结果，不 sleep**：`mountPlugin()` 轮询的是"工具是否已注册"（`:104-107`）。另外 `FiberState`
  是 TS 的 `const enum`，编译期内联、运行时没有导出，所以测试里手写了常量表（`:25-40`）。
- **mock 之外要真的读文件**：`tests/host-plugin.test.js:204-207` 在写入后用 `readFileSync` 断言落盘，
  防止"只在内存里对"。
- **浏览器半边**：`lib/client.js` 不能用 import，测试手工搭 `window.__ModuleLoader__`、`document`、
  require 桩和一套带真实重渲染语义的 React 替身（`tests/client-plugin.test.js:192-250`）。React 替身故意
  不偷懒：函数组件真的被调用、hook 状态按位置保存、effect 里调 setter 会再跑一遍（`:27-40`）。
- **等价性测试会跳过**：缺 `python3` 或上游 checkout 时 `tests/store-equivalence.test.js:167` 让用例
  skip 而不是 fail。新增内核方法时，记得把操作加进 `SCENARIO`（`:44-77`）**并同时更新两个 driver**
  （`:80-116` 与 `:119-165`），否则等价性覆盖会静默留空，而测试依然全绿。
- **改动前先跑一遍**：`tests/docs.test.js` 会检查文档里的相对链接是否都存在、`package.json` 的
  `exports`/`files` 是否指向真实文件——加文件、改文件名时它会替你抓住 404。
