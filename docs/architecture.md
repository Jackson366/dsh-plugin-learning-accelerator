# 架构与设计取舍

面向"要改这个插件的代码"的人。本文只回答两类问题：**每个模块负责什么**，以及**为什么是这样而不是
那样**。所有结论都能在源码里找到对应位置，行号按当前提交。

引用约定：`lib/**`、`tests/**`、`package.json`、`cordis.patch.yml` 都是本仓库路径；
`node_modules/@deepseek-ai/**` 是本包已安装的 harness 依赖源码（版本见 `package.json:32-37` 的
peerDependencies）；`packages/core/**` 是 DSH 源码 checkout（`~/Desktop/project/github/deepseek-harness`）
里对应包的路径，用于核对运行时行为。

---

## 一、DSH 侧的前提

DSH 不是一个"读配置启动"的程序，而是一个**由配置组合出来的 Cordis 应用**：

```
profile（package.json 的 dsh.profile.bundles）
  └── bundle 层（每个 bundle 提供一个 cordis.patch.yml）
        └── patch 行（id + name + config + inject + disabled）
              └── Loader 把每一行挂载成一个 plugin fiber
```

三条与本插件直接相关的性质（细节见 `docs/analysis.md` 第一部分）：

1. **`id` 是稳定身份**，Loader 按它做 diff，所以改一行配置只重挂那一行。
2. **层叠时整块替换 `config`**，不做深合并。
3. **`inject` 是服务名，不是包名**；缺依赖的插件停在 PENDING，不报错。

Cordis 接受三种插件形状（函数 / 对象 / Service 子类）。本插件三处都用到了，各取所需：

| 位置 | 形状 | 为什么 |
|---|---|---|
| `lib/index.js:144-212` | 对象形状：导出 `name` / `inject` / `Config` / `apply(ctx, config)` | 需要一个 `Config` schema 来声明默认值，并需要一个地方把共享的 service 实例造一次。 |
| `lib/index.js:86-121` + `:152-154` | `Service` 子类 `LearningAccelerator` | 让别的插件能通过 `ctx.learningAccelerator` 读到同一份缓存 store，而不是各自重写 scope 解析（`lib/index.js:148-151`）。 |
| `lib/index.js:160-193`、`lib/panel-route.js:136-175` | 嵌套 `ctx.inject(...)` | 声明"可选依赖"，见下面第四节。 |
| `lib/client/index.js` | 对象插件 `{ name, inject, apply }` | 浏览器半边的 loader 拿到的是工厂返回值，只接受这个形状（形状说明见 `docs/analysis.md` 1.4）。 |

包级声明只有两个文件：

- `package.json:23-31`：`dsh.bundle.patch` 指向 `./cordis.patch.yml`（host 半边怎么被挂载），
  `dsh.client.platform: 'web'` + `exports["./client"]`（浏览器半边怎么被发现）。
- `cordis.patch.yml:4-6`：一个 `- insert:` 块，只写 `id: learning-accelerator` 与
  `name: dsh-plugin-learning-accelerator`，不带 `config`——所以安装后一切走 `Config` 默认值。

---

## 二、模块职责

| 模块 | 行数 | 职责 | 关键边界 |
|---|---|---|---|
| `lib/learning-store.js` | 988 | 状态内核：`LearningStore`（load/save/validate/migrate）、间隔重复、概念进度、难度校准、确定性 id、领域模板。 | 纯 Node 内建依赖，不 import 任何 Cordis；与上游 Python `state.py` 逐字节等价。 |
| `lib/scope.js` | 337 | scope 解析（`resolveStatePath` / `sessionCwd`）、按路径缓存的 `LearningAcceleratorService`、两块注入文本的渲染与门禁。 | 唯一决定"这轮属于哪个文件"的地方；不认识 Cordis，可独立单测。 |
| `lib/protocol.js` | 344 | 教学协议：纯数据（七种模式、教学单元、错误分析步骤、信号极性、两张类比表）+ 纯字符串构造函数。 | 无 Cordis、无文件系统、无时钟；`composeTeachingProtocol()` 是全函数，永不抛。 |
| `lib/tools/` | 5 个文件 | 五个模型可调用工具，一文件一个（`status` / `due` / `session` / `record` / `domain`）；`index.js` 只做注册。 | 只通过 `service` 访问状态；`learning_record` 是唯一写入路径。 |
| `lib/panel.js` | 75 | 把一次 `summarize()` 的结果压成面板 payload。 | 纯函数：无 Cordis、无 HTTP；分页与排序只做一次，浏览器不接触状态 schema。 |
| `lib/panel-route.js` | 176 | 面板 HTTP 路由 `PANEL_ROUTE`、方法判断、Host/Origin 守门。 | 自己承担鉴权（路由不在 `/api` 网关内）。 |
| `lib/index.js` | 212 | Cordis 入口：`Config`、service 挂载、五个工具、两个 `systemPrompt.context`、面板路由接线。 | 所有注册都是 effect，卸载即撤销。 |
| `lib/client.js` | 生成 | 浏览器半边：两个 seat、locale 字典、样式注入、fetch 面板数据。**由 `lib/client/` 生成**，不要手改。 | classic script，无 JSX。宿主每包只服务一个 bundle，所以源按职责拆成 6 个片段、产物合成一个文件；`tests/client-build.test.js` 防止产物过期。 |

另有 `schemas/learning_state.schema.json`：README 用的状态形状文档，`tests/schema.test.js` 保证它与
内核常量（`SCHEMA_VERSION`、枚举、`defaultState()` 的键）一致。内核才是权威，schema 是投影。

---

## 三、为什么状态内核要用纯 JS 重写

`lib/learning-store.js:1-13` 写明了理由：宿主侧必须能在**已打包的桌面应用**里工作，那里既没有保证
存在的 Python 解释器，也没有仓库 checkout。所以内核整个带进包里，只用 Node 内建模块。

代价是"两份实现可能悄悄分叉"，而分叉的表现是学习者的 `.learning/state.json` 变成两种互不兼容的形状。
处理办法不是人工 review，而是让**测试逐字节比对**（`tests/store-equivalence.test.js`）：

- 一份声明式场景（`SCENARIO`，`:44-77`）同时驱动两个实现——Node driver 调 JS store（`:80-116`），
  Python driver 是同一串操作的脚本（`:119-165`）；
- 比对分三层：结构 `deepEqual`（`:191`）、`schema_version`（`:192`），最后是**磁盘字节相等**
  （`:193-197`），即 `readFileSync(pyFile, 'utf8') === jsText`。

为了让字节相等成立，JS 侧必须精确复刻 Python 的落盘格式（`lib/learning-store.js:409-418`）：
`JSON.stringify(sortKeysDeep(state), null, 2)` 加一个尾随换行，对应 Python 的
`json.dumps(..., ensure_ascii=False, indent=2, sort_keys=True)`。两个细节值得记住：

- `sortKeysDeep()`（`:280-288`）是必需的，因为 JS 对象不保证键序；
- 写入是**先写临时文件再 rename**（`:414-416`），避免并发读者看到半个文件。

等价的另一半是**确定性 id**：`stableId(*parts) = sha1(小写去空、'\n' 连接)[:12]`
（`:263-266`）。它让"同一概念 + 同一题目"再次调度时是 upsert 而不是追加（`:269-277`），队列因此不会
膨胀；工具层也靠重算同一个 id 把刚写进去的那一行读回来（`lib/tools/record.js`，`stableId` 两处）。

测试在 `python3` 或上游 checkout 缺失时**跳过而不是失败**（`tests/store-equivalence.test.js:27-37,167`），
所以这个包可以脱离上游单独跑测试。

---

## 四、一个必须记住的坑：`ctx.get` vs 嵌套 `ctx.inject`

第一版实现用 `ctx.get('webServer')` 探测 HTTP carrier，结果是**每次启动路由都静默丢失**：carrier 由
**另一个 loader 行**挂载，它的服务在本插件 `apply` 执行时还不存在，`ctx.get` 那一刻返回 `undefined`
（`docs/analysis.md` 1.3）。运行验证阶段看到的就是"组合配置里有这一行、插件没报错、路由却 404"。

正确做法是把可选依赖声明在**嵌套插件**上（`lib/panel-route.js:135-139`）：

```js
return ctx.inject(['webServer'], injected => {
  injected.effect(() => injected.webServer.register({ ... }))
})
```

这样做有两个好处，缺一不可：

1. carrier 出现之后自动注册（不像 `ctx.get` 那样只探测一次，错过就永远错过）；
2. carrier 不存在时**只有嵌套 fiber 停在 PENDING**，主插件的工具与提示词照常加载
   （`lib/index.js:202-204`；`docs/usage.md` 的 FAQ 里说明了怎么区分这两种 PENDING）。

这条约束有专门的回归测试：`tests/panel-route.test.js:126-144` 给 `ctx` 的 `get()` 装了"一调用就抛"
的桩，断言 `registerPanelRoute` 只走 `inject(['webServer'])`。

对比之下，`tools` 与 `systemPrompt` 是**必需**依赖，声明在插件自己的 `inject` 上
（`lib/index.js:47`），缺了就该停——因为缺了它们这个插件没有任何意义。

---

## 五、注册即 effect

Cordis 把 `ctx.on` / `ctx.plugin` / `ctx.tools.register` / `ctx.systemPrompt.context` /
`webServer.register` 返回的 disposer 都挂在当前 fiber 上，卸载或热重载自动撤销
（`docs/analysis.md` 1.2）。本插件没有一行手工清理代码，全部依赖这一条：

| 注册 | 位置 |
|---|---|
| service 挂载 | `lib/index.js:152-154` |
| 五个工具 | `lib/tools/index.js` 的 `registerLearningTools`（逐个 `ctx.tools.register`） |
| 协议块 | `lib/index.js:166-174` |
| 状态块 | `lib/index.js:181-191` |
| 面板路由 | `lib/panel-route.js:139` 的 `injected.effect(...)` |
| 浏览器侧两个 seat 与字典 | `lib/client/index.js`（注册）+ `lib/client/00-strings.js`（字典） |

`tests/host-plugin.test.js:564-575` 断言 dispose 之后工具表为空、两个 context 也都消失。这条测试能
成立的前提是 mock 复刻了真实生命周期契约，见第八节。

---

## 六、注入门禁：无关会话零 token

两个注入块共用一个门禁（`lib/scope.js:257-265`）：

```
状态文件存在？
  且（current_topic 或 learning_goal 或 priority_reviews 非空 或 current_tasks 非空）
  → 返回 summary，否则返回 null
```

不满足时 `promptContext()` / `protocolContext()` 返回 `''`（`lib/scope.js:289,321`）。空文本在 harness
侧被过滤掉（`node_modules/@deepseek-ai/dsh-system-prompt/src/index.ts:326-338`），所以设计目标"在一个
无关仓库里开会话不花一个 token"是字面成立的，而不是近似成立。

门禁只放在这一处，两个块因此**同进同退**：有学习线时方法和状态一起到，没有时一起沉默。

协议块的适配数据来自文件而不是 summary（`lib/scope.js:292-299`），因为 summary 是内核的紧凑形状，
刻意不含 `experience_level`——而画像适配恰恰需要它。`profileTrack()` 的取值规则是
"`no_programming` 永远优先，其次才看已知技能里是否出现前端关键词，宁可漏判也不假设"
（`lib/protocol.js:196-219`）。

还有一条容易忽略的接线：`systemPrompt.context` 的 `text` 回调收到的是 harness 的 `AssembleContext`。
该类型本身只声明 `scope` / `signal`，`agent` 字段由 agent 包做模块增补
（`packages/core/agent/src/runtime-types.ts:18-23`），运行时由 `assembleContextFor()` 填进去
（`packages/core/agent/src/dispatch.ts:174`）。`lib/index.js:172,189` 传的 `assemble?.agent` 就是靠这条
链路拿到会话 cwd；属性缺失时 `sessionCwd()` 会安全退化成"没有项目提示"（`lib/scope.js:43-57`）。

---

## 七、面板路由的信任边界与已知限制

### 为什么要自己守门

浏览器半边是零构建的 classic script，用不了 `@Remote`（需要 TS 装饰器 + typert 代码生成），于是走
`ctx.webServer.register()` 这条更低层、更稳定的路（`lib/panel-route.js:1-24` 的模块注释即完整的取舍）。
carrier 的 `/api` 网关自带鉴权，**自定义路由不在其内**，而这个路由会暴露一个学习者的档案与进度，
所以自己做两层判断（`lib/panel-route.js:61-89`）：

1. **`Host` 必须是 loopback**：`127.0.0.1`、`localhost`、`::1`、`[::1]`（`:32`）。这是真正的边界，
   挡住 DNS rebinding 与 loopback 端口上的代理；缺 `Host` 头也算拒绝。
2. **`Origin` 存在时必须是本地来源**：loopback http(s)、`dsh-app:`、`file:`、`null`（`:33,71-86`）。
   这是纵深防御。

有意不做得更严：能读本地文件的进程本来就能直接读那个 JSON，放行 `file:` 与 `Origin: null` 不损失安全性
（`:47-56`）。这套判断被三类测试覆盖：loopback 接受（`tests/panel-route.test.js:87-91`）、
非 loopback 拒绝即 DNS rebinding 场景（`:93-99`）、远程 Origin 拒绝而本地/`dsh-app:` 放行（`:101-115`）。

路径**故意不放在 `/api` 下**（`lib/panel-route.js:109-116`）：蹭那个前缀会变成"过了一道鉴权又绕过
另一道"。代价是必须自己承担鉴权，也就是上面两条。

### 面板跟随学习者：一个曾经只在单测里成立的契约

设计意图很清楚：浏览器请求不携带会话身份，所以面板不能像工具那样问"这个会话属于哪个文件"，只能按
"本进程最近解析过的会话工作目录 → 配置 `root` → 进程目录"来选，并把最终选中的 `path` 报回 UI
（`lib/scope.js:168-202`，`lib/panel.js:39-44`）。`tests/panel-route.test.js:225-320` 覆盖了它：最近会话
优先、显式/配置 scope 优先、没有状态文件的新项目仍然优先于进程目录、项目目录被删掉时跳过、列表上限
8 条。

**但这条链路曾经在真实挂载下不可达**，值得作为一个案例记下来：

- `Config.scope` 的默认值是 `'project'`（`lib/index.js:55-57`），Cordis 挂载时会套用默认值；
- 老代码把 `scope: config.scope` 原样交给路由（`lib/index.js`），路由再原样交给 `panelRequest`
  （`lib/panel-route.js:159-162`）；
- 而 `panelRequest()` 的第一行是"只要 `stateFile` 或 `scope` 不是 `undefined` 就直接返回它"
  （`lib/scope.js:194`）。

于是默认配置下面板解析到的是配置 `root` 或进程目录，会话提示分支从不执行——`docs/analysis.md` 第四
部分的真机记录里那句 `"source": "process-cwd"` 正是这个结果。**所有单测都是绿的**，因为它们测的是
`panelRequest()` 的无参形态（设计意图），而不是 `apply` 真正传进去的那组参数（接线）。这是"逻辑对、
接线错"的典型：只有走完 `apply` → 路由 handler 的测试才看得见。

修法（v0.2.0 已实施）：`apply` 只在操作者选了**非默认** scope 时才把它交给路由——

```js
scope: config.scope === 'project' ? undefined : config.scope,
```

因为"项目级"恰好就是"跟随会话"那一档，而显式 `stateFile` / `root` 仍然优先，文档里的覆盖顺序不变。
回归测试是 `tests/host-plugin.test.js` 的 *the panel route follows the session directory through the
real wiring* 与 *an explicitly configured scope still pins the panel*：它们挂载真实插件、取到真实注册的
路由、用一个假 request/response 打进去，断言 `payload.path` 是会话的 state 文件（而不是进程目录），
以及 `scope: 'user'` 时面板仍然被钉住。把 `apply` 那一行改回旧写法，两条测试里必然红一条。

### 面板跟随的是"你看的那个会话"（v0.2.2）

上一节修好的是接线，但留下的语义仍然不够：宿主记住的是"**本进程最近一次解析过 store 的会话**"。用户
在 GUI 里切工作空间时，只要新工作空间还没跑过一轮对话，这个记忆就还是旧项目——面板于是停在旧空间，
看起来像"切工作空间没生效"。

根因是"浏览器请求不携带会话身份"这句话被用得太满：**请求**不带，**渲染面板的那个页面**带。
`conversation.view` 是 `scope: 'session'` 的 slot，`@deepseek-ai/dsh-client-ui-session` 把
`sessionId`、`useSession`、`useProjection` 合并进 `SessionStandardProps`，把 `useSessions` 等合并进
`GlobalStandardProps`；而 `SessionListState.byId[sessionId].cwd` 正是运行时自己记的那个会话的工作空间。
所以浏览器半边能拿到准确答案，缺的只是把它送上去的通道：

- `lib/client.js`：`useSessionWorkspace(props)` 用 `useSessions` 选择当前 `sessionId` 的 `cwd`，
  `fetchPanel(cwd)` 拼成 `?cwd=`（`encodeURIComponent`）；拿不到就不带这个参数，退回宿主自己的线索。
- `lib/panel-route.js`：`panelCwdFromRequest()` 把 `?cwd=` 当**页面输入**校验——去空白、限长 4096、
  拒绝 NUL、必须 `path.isAbsolute()`（即宿主本机拼法）。不合格就返回 `undefined`，请求照常按旧规则
  解析，而不是让页面指定任意目录。
- `lib/scope.js`：`resolveStatePath()` 多一档 `cwd`，`source` 记作 `panel-cwd`；位置在会话 cwd 之下、
  配置 `root` 之上。`panelRequest(explicit, cwd)` 在有上报值时不查 `sessionPaths`。

顺序为什么这样排：显式 `stateFile` 是操作者的决定，最强；会话自己的 cwd 是"这一轮属于谁"的权威；
面板上报值代表"用户正在看谁"，应当盖过 `root`——`Config.root` 的描述本来就是"会话没有工作目录时"
才用它。于是 `root` 从来就不是"钉住面板"的开关，README / `docs/usage.md` 里那句旧说法一并改掉了：
真要钉住就用 `stateFile`，代价是每个工具调用也一起被钉住。

测试分两层：`tests/client-plugin.test.js` 断言渲染在不同 `sessionId` 下发出的 URL 不同（对旧客户端必红），
`tests/panel-route.test.js` 断言校验规则、优先级、`source` 取值，以及"坏提示回落"这条路。

### 面板数据形状

`panelPayload()`（`lib/panel.js:25-77`）是浏览器半边的全部数据契约：

- 成功：`{ ok, generated_at, path, scope, source, profile, topic, difficulty, mastered_concepts,
  weak_concepts, due_reviews, priority_reviews, concept_progress, current_tasks, counts }`；
- `concept_progress` **最弱在前**排序（`:63-70`），并列时按概念名码点序——与内核 `priorityReviews`
  的第三级比较共用 `compareCodePoints()`，不是 `localeCompare`；因为面板的职责就是让"下一个该修什么"
  显而易见；
- 失败：`{ ok: false, error, path, scope, source, generated_at }`，绝不抛（`:27-36`）。

它是纯函数，所以能在没有 Cordis、没有 HTTP 的情况下单测（`tests/host-plugin.test.js:496-534`），
任何传输层都能渲染同一个值。

---

## 八、测试怎么摆

- **纯模块优先**：`lib/protocol.js`、`lib/learning-store.js`、`lib/scope.js` 都能脱离 Cordis 直接 import，
  于是它们的测试不需要任何 mock（`tests/protocol.test.js`、`tests/store-equivalence.test.js`）。
- **宿主测试只桩掉两个 harness 服务**：`ToolsMock`（`tests/host-plugin.test.js:49-63`）与
  `SystemPromptMock`（`:66-86`）。两个 mock 复刻的是**生命周期契约**——`register()` 通过 `ctx.effect`
  挂 disposer，`context()` 卸载时**原地 splice** 而不是重新赋值，否则"卸载后全部撤销"的测试会空过。
- **等可观察结果，不等时间**：`mountPlugin()` 轮询的是"五个工具是否已注册"，而不是某个 fiber 状态或
  sleep（`:104-107`）。代价是数字 5 被写死在这里，加工具时必须同步改（详见 `docs/extending.md`）。
- **浏览器半边用 vm + 模块表 sink**：`lib/client.js` 是 classic script，没法 import，所以测试手工搭出
  `window.__ModuleLoader__`、一个 `document`、一个`require` 桩和一套**带真实重渲染语义**的 React 替代品
  （`tests/client-plugin.test.js:192-250` 的 `loadBundle()`）。React 桩故意不偷懒：函数组件真的被调用、
  hook 状态按位置保存、effect 里调 setter 会再跑一遍——否则"组件从不重渲染"这种只会在真实 GUI 里暴露的
  缺陷会被测试放过（`:27-40`）。

---

## 九、唯一一处绕过内核方法的写入

`learning_record` 的 `mistake` 分支（`lib/tools/record.js` 的 `mistake` 分支）直接 `store.load()` → 改
`practice_state.last_code_errors` → `store.save(state)`，然后再逐概念调
`recordConcept()` / `addReview()` / `recordEvidence()`。

为什么特殊：上游没有 `record_mistake` 这个方法，而"一次调用完成诊断 + 标弱 + 排复习 + 记证据"是
README 承诺的语义。代价有两个，都是有意接受的：

- `last_code_errors` 的 id 用 `Date.now().toString(36)`（`:489`），依赖时钟，因此这条路径**不参与**
  逐字节等价测试（`SCENARIO` 里没有 `mistake`）；
- 这一分支每次 `mistake` 会产生多次 load/save（每个概念各一次），换来的是不需要在内核里新增一个
  Python 侧不存在的方法。

如果要让 `mistake` 也进入等价性覆盖，正确做法是在内核里新增一个方法并同步上游，而不是在工具层继续
堆 JSON 操作。
