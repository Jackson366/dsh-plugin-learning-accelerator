# 使用指南

面向"把插件装进桌面端、然后拿它学东西"的人。本文里出现的每个默认值、参数名和枚举都取自代码：
`lib/index.js:50-70` 的 `Config`、`lib/tools/` 的工具定义、`lib/scope.js:72-89` 的解析函数。
不在代码里存在的东西，这里不写。

---

## 安装

```sh
dsh plugin --profile desktop add ./dsh-plugin-learning-accelerator
```

装完**重启应用**。重启之前先确认组合层里已经有了这一行：

```sh
dsh --profile desktop --dump-config | grep -A1 learning-accelerator
```

健康的输出形如：

```
# == dsh-plugin-learning-accelerator
- id: learning-accelerator
```

这一行不是 profile 写的，而是包自带的 bundle 层 `cordis.patch.yml` 插入的：它是一个 `- insert:`
块，只声明 `id` 与 `name`，**不带 `config`**（`cordis.patch.yml:4-6`）。因此首次安装后所有配置都是
`Config` 的默认值。

移除：

```sh
dsh plugin --profile desktop remove dsh-plugin-learning-accelerator
```

命令形状不完全对称：`add` 收本地路径，`remove` 收包名（`README.md` 的写法即是如此）。在组合层里，
一行 patch 的两个身份是分开的：`name` 指向包，`id` 是 Loader 用来做 diff 的稳定身份
（`cordis.patch.yml:4-6` 里 `name: dsh-plugin-learning-accelerator` 与 `id: learning-accelerator`
就是同一个包的两个名字）。

---

## 配置

七个键，全部定义在 `lib/index.js:50-70`，逐个列出：

| 键 | 类型 | 默认值 | 作用 |
|---|---|---|---|
| `stateFile` | string | 未设置 | 显式状态文件路径，覆盖下面所有 scope 规则（`lib/index.js:51-52`）。 |
| `root` | string | 未设置 | 会话没有工作目录时使用的项目根；未设置则落到进程工作目录（`lib/index.js:53-54`，`lib/scope.js:88`）。 |
| `scope` | `'project'` \| `'user'` | `'project'` | 存储族：`project` 用 `./.learning/state.json`，`user` 用 `~/.learning-accelerator/state.json`（`lib/index.js:55-57`，`lib/learning-store.js:23,26-28`）。 |
| `injectPromptContext` | boolean | `true` | 是否注入状态块（档案、薄弱点、到期复习）（`lib/index.js:58-60`）。 |
| `injectProtocol` | boolean | `true` | 是否注入教学协议块（模式、教学单元、练习生成、错误分析、难度规则）（`lib/index.js:61-63`）。 |
| `promptContextOrder` | number | `150` | 状态块的 order；协议块取它的 `-1`（`lib/index.js:64-66,168,183`）。 |
| `panelRoute` | boolean | `true` | 是否在本地 HTTP carrier 上提供面板快照（`lib/index.js:67-69`）。 |

两个开关互相独立，四种组合都合法：`tests/host-plugin.test.js:577-593` 分别验证了"都关掉时工具照常、
提示词零注入"和"只关状态块时只剩协议块"。

> 现行 `README.md` 的配置表漏了 `injectProtocol` 这一行，代码里它是存在的，且默认开启。

### patch 行是整块替换，不是深合并

层叠顺序是 bundle 层 → profile 自己的 `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → 命令行
`--patch`；后者按行覆盖前者，且**整块替换 `config` 对象**（`docs/analysis.md` 第一部分 1.1）。
所以：

- 后出现的行里没有重述的键，回到 `Config` 的默认值，**不会**继承上一行写过的值；
- 想保留的键必须在这一行里全部重述。

### 把面板钉在一个项目上

默认不需要配置：`conversation.view` 那个 tab 会跟随**它所在会话的工作空间**，切工作空间就切面板
（见下面"Web 面板"一节）。只有当你想让面板和所有工具调用都固定在一个项目上时，才在
`$DSH_HOME/profiles/<profile>/cordis.patch.yml` 里加一行，用 `stateFile` 而不是 `root`：

```yaml
- id: learning-accelerator
  name: dsh-plugin-learning-accelerator
  config:
    stateFile: /absolute/path/to/your/project/.learning/state.json
```

`root` **钉不住面板**：它只在"没有更具体的线索"时回答"哪个项目"——面板上报了工作空间、或者会话自带
cwd 时，都会盖过它。而 `stateFile` 是优先级链的第 1 档，会同时钉住面板和每一个工具调用，这正是
"固定在一个项目上"的语义，用之前要知道这个代价。

---

## 状态文件解析优先级

一个显式优先级链决定一轮对话属于哪个 `.learning/state.json`，实现集中在
`lib/scope.js` 的 `resolveStatePath()`：

| 顺序 | 来源 | `source` 返回值 | 说明 |
|---|---|---|---|
| 1 | 工具参数 `state_file` / 配置 `stateFile` | `argument` | 模型、人或操作者显式指定；一次性选择，不会被记成"这个学习者住哪"。 |
| 2 | 会话工作目录 `session.header.cwd` | `session-cwd` | 只接受绝对路径，相对路径按"没有提示"处理（`lib/scope.js` 的 `absolutePath()`）。 |
| 3 | 面板上报的工作空间 `?cwd=` | `panel-cwd` | 浏览器半边从会话列表里读出当前 tab 所属会话的 cwd 传上来，所以切工作空间面板立刻跟着切。 |
| 4 | 配置 `root` | `config-root` | 前三条都没有答案时使用。 |
| 5 | 进程工作目录 | `process-cwd` | 兜底。 |

两个例外：

- **`scope: 'user'` 短路 2–5**（`source: 'user-scope'`）。用户级存储按定义就是
  机器全局的，跟任何会话无关。
- **`scope` 只允许 `project` / `user`**，其它值在 `storeFor()` 里直接抛
  `learning scope must be one of: project, user`（`lib/scope.js`）。

路径形状：项目级是 `<root>/.learning/state.json`，用户级是 `~/.learning-accelerator/state.json`
（`lib/learning-store.js:23,26-28`；`~` 会展开，`lib/learning-store.js:971-979`）。

每个读工具的返回值里都带 `path` 与 `source`，所以"这轮到底写到了哪个文件"永远可以在结果里看到，
不需要猜。

---

## 五个工具

| 工具 | 用途 |
|---|---|
| `learning_status` | 读全貌：档案、主题、已掌握/薄弱概念、到期与优先复习、待做练习、近期尝试、任务、难度。任何学习轮次的入口。 |
| `learning_due` | 排序后的间隔重复队列。 |
| `learning_session` | Onboarding 与档案修改；返回该领域的 onboarding 问题。 |
| `learning_record` | 唯一写入路径，九个 action。 |
| `learning_domain` | 静态领域模板（重点、练习形式、复习策略、onboarding 问题）加该领域的教学协议，不需要任何状态。 |

所有工具都接受两个共同参数（`lib/tools/shared.js`）：

- `state_file`：状态文件路径；省略则用会话工作目录下的 `.learning/state.json`。
- `scope`：`project`（默认）或 `user`。

其它参数逐个如下（都从 `lib/tools/` 抄写）：

| 工具 | 参数 |
|---|---|
| `learning_status` | `due_limit`（number，默认 5；裁剪 `summary.priority_reviews` 的长度，可大于 5，`lib/tools/status.js`） |
| `learning_due` | `on_date`（`YYYY-MM-DD`，默认**本地**今天）、`limit`（number，默认 5，可大于 5，`lib/tools/due.js`） |
| `learning_session` | `domain`、`known_skills`（string[]）、`experience_level`、`learning_goal`、`target_outcome`、`current_topic`、`level`、`constraint`、`next_task`、`preferred_language`（`lib/tools/session.js`） |
| `learning_domain` | 只有 `domain`（`lib/tools/domain.js`） |

枚举也照抄，别凭记忆：

- `learning_session.domain` / `learning_domain.domain`：`general`、`technology`、`language`、`exam`、
  `writing`、`communication`（`lib/tools/session.js` 与 `lib/tools/domain.js`）。
- `learning_session.experience_level`：`unknown`、`no_programming`、`beginner`、`intermediate`、
  `advanced`（`lib/tools/session.js`）。
- `learning_session.level`：`beginner`、`intermediate`、`advanced`（`lib/tools/session.js`）。
- `learning_record.difficulty`：`easy`、`normal`、`stretch`（直接展开内核常量
  `EXERCISE_DIFFICULTIES`，`lib/tools/record.js`）。

### `learning_record` 的九个 action

`action` 是必填参数（`lib/tools/record.js`）。每个 action 的最小调用如下，参数名逐字对齐代码：

```jsonc
// review_complete：完成一条到期项。review_id 必填，result 默认 correct
{ "action": "review_complete", "review_id": "3f7c1a9b2d40", "result": "second_correct", "notes": "能说清 next() 的语义" }

// review_add：新建一条复习项。concept 必填；prompt 默认 "Review <concept>"，result 默认 correct
{ "action": "review_add", "concept": "Cordis waterfall", "prompt": "不调用 next() 会发生什么", "result": "incorrect" }

// concept：把概念放进 mastered / weak。concept 与 status 都必填
{ "action": "concept", "concept": "effect 作用域", "status": "mastered" }

// exercise：记一次"做完/没做出来"的练习，不建 ExerciseSpec。task 是练习名（必填），
// exercise_status 默认 completed；它会写 completed_exercises / failed_exercises 并发难度信号
{ "action": "exercise", "task": "注册一个最小工具", "exercise_status": "completed",
  "concepts": ["defineTool"], "notes": "跑通了" }

// exercise_spec：落一道练习。工具层不设必填，但内核要求 concepts 非空、task 非空、difficulty 合法
{ "action": "exercise_spec", "topic": "Cordis 插件", "concepts": ["defineTool"], "difficulty": "normal",
  "task": "注册一个最小工具", "goal": "理解注册即 effect", "input": "const { defineTool } = require('...')",
  "evaluation_criteria": ["注册是 effect"] }

// attempt：记录作答。exercise_id、attempt_result、整数 score 三者必填
{ "action": "attempt", "exercise_id": "ab12cd34ef56", "answer": "ctx.tools.register(defineTool({...}))",
  "attempt_result": "pass", "score": 90, "concepts": ["defineTool"], "feedback": "正确" }

// mistake：诊断一次错误。concept 或 concepts 至少要有一个
{ "action": "mistake", "concepts": ["scope isolation"], "mistake_type": "concept_confusion",
  "feedback": "把 isolate 当成了全局开关" }

// task：排一个下一步任务。task 必填
{ "action": "task", "task": "读完 cordis-tutorial 第七章", "notes": "重点看 inject" }

// evidence：记一条原始难度信号。signal 必填
{ "action": "evidence", "signal": "explain_correct", "detail": "能讲清 PENDING 的成因" }
```

每个 action 的作用与边界：

| action | 做了什么 | 关键细节 |
|---|---|---|
| `review_complete` | 归档到 `review_history`、按 `result` 重新调度、移动概念强弱、更新 `concept_progress`、追加难度证据（`lib/learning-store.js:528-560`）。返回被触碰的复习项、概念进度、难度。 | `review_id` 不存在时抛 `review item not found`，不静默成功（`tests/host-plugin.test.js:335-345`）。 |
| `review_add` | 排一条新复习项，`source` 记为 `manual`（`lib/tools/record.js`）。 | 返回的 `review` 是按确定性 id 读回的同一行，不是猜的（`lib/tools/record.js`）。 |
| `concept` | 只调 `recordConcept()`：进目标列表、从另一个列表移除（`lib/learning-store.js:498-512`）。 | 不动 strength，也不排复习。 |
| `exercise` | 调 `recordExercise()`：按名字 upsert 进 `completed_exercises` / `failed_exercises`，并发一条 `exercise_completed` / `exercise_failed` 难度信号（`lib/learning-store.js:636-662`）。 | 这是这两个列表**唯一**的写入口，也是这两个信号唯一的自动来源；不需要先建 ExerciseSpec。同名练习是更新，不是新增。 |
| `exercise_spec` | 落一条 ExerciseSpec，id 由 `topic+concepts+difficulty+task` 决定（`lib/tools/record.js`）。 | `topic` 省略时取当前主题；`input` 是给学习者的起始材料（v0.2.1 起可写）；同样的参数重复提交是 upsert，不会堆积。 |
| `attempt` | 写 AttemptRecord，并把相关概念排进复习、更新进度与难度证据（`lib/learning-store.js:656-700`）。 | `attempt_result` 是三值枚举，但落盘时 `partial` 折算成 `fail`，原始判断保留在返回值的 `attempt.outcome` 上（`lib/tools/record.js`）。 |
| `mistake` | 一次调用完成：记 `last_code_errors`、把概念标 weak、每个概念排一条复习、各追加一条 `explain_fuzzy` 证据（`lib/tools/record.js`）。 | 等价于四次独立写入，这是它存在的全部理由。 |
| `task` | 往 `practice_state.current_tasks` 里 upsert，并同步 legacy 的 `current_project_tasks`（`lib/learning-store.js:470-487`）。 | 同名任务是更新，不是新增。 |
| `evidence` | 追加一条难度证据（只保留最近 20 条）并按"连续两个同向信号移动一档"重算难度（`lib/learning-store.js:942-968`）。 | 信号只有七种，见下。 |

`signal` 的七种取值，分极性（`lib/tools/record.js`，`lib/learning-store.js:51-63`）：

- 正向：`exercise_completed`、`recall_correct`、`explain_correct`
- 负向：`exercise_failed`、`recall_incorrect`、`explain_fuzzy`、`setup_failed`

难度钳在 1–5，且**只看观察到的证据，不看用户自述的信心**——这条在协议里是显式反模式
（`lib/protocol.js:144-145,298`）。

间隔（`lib/learning-store.js:39-45`）：

| `result` | 间隔 | 副作用 |
|---|---|---|
| `correct` | 1 天 | strength +0.1，streak +1 |
| `second_correct` | 3 天 | strength +0.2，streak +1，概念 → mastered |
| `third_correct` | 7 天 | strength +0.2，streak +1，概念 → mastered |
| `incorrect` / `fuzzy` | 0 天 | strength −0.2，streak 归零，failure_count +1，概念 → weak |

读路径的排序权重是"到期 +20、薄弱 +30、`(1-strength)×20`、失败次数 ×3"，再按到期日与概念名**码点序**
稳定排序（`lib/learning-store.js:612-634`）。`limit` / `due_limit` 默认 5 但可调大。

---

## 两个注入块

插件往系统提示里放两个动态上下文块（`lib/index.js:165-192`）：

| name | order | 内容 |
|---|---|---|
| `learning-accelerator/protocol` | `promptContextOrder - 1`（默认 149） | 教学协议：每轮循环、七个主模式、教学单元顺序、练习生成与 AttemptRecord 规则、错误诊断步骤、难度校准、复习选择、示例选择、画像适配、领域适配（`lib/protocol.js:338-344`）。 |
| `learning-accelerator/status` | `promptContextOrder`（默认 150） | 学习状态：状态文件路径、领域、已知技能、目标、主题、薄弱点、今天要复习什么、优先复习、下一步任务、难度（`lib/scope.js:314-336`）。 |

顺序不是随手写的：**先方法、后队列**，读提示词的人先知道一轮怎么跑，再知道这一轮要复习什么
（`lib/index.js:163-164`）。默认值 150 落在工具指导带 100–199 内——该带内官方占用的 order 是
100/110/115/120/125，200 与 210 属于 harness 源码与 Web surface（
`node_modules/@deepseek-ai/dsh-system-prompt/src/index.ts:170-179`）。

### 只有已经有一条学习线时才出现

两个块共用同一个门禁 `_injectableSummary()`（`lib/scope.js:257-265`）：

1. 目标 scope 的状态文件必须**已存在**；
2. 并且 `current_topic`、`learning_goal`、`priority_reviews`、`current_tasks` 至少有一个非空。

不满足就返回空字符串。空文本在 harness 侧会被直接过滤掉，不占一个 token
（`node_modules/@deepseek-ai/dsh-system-prompt/src/index.ts:326-338`：`renderContextSections()` 过滤
`text.length > 0`，全空时 `joinContextSections()` 返回 `''`）。所以在一个无关的代码仓库里开会话，
这个插件一个 token 都不花；反过来说，只调 `learning_session({ domain: 'technology' })` 建了文件但没
写主题/目标/任务时，注入仍然是静默的。

### 第一条学习线：协议靠工具返回值带回

第一次在一个新目录里说"教我 X"时，状态文件还不存在，两个注入块都是空的。为了让方法仍然到场，
`learning_domain` 与 `learning_session` 在返回值里各带一份 `teaching_protocol`
（`lib/tools/session.js` 与 `lib/tools/domain.js`），并且 `output.render` 会把它渲染进给模型看的正文
（`lib/tools/session.js` 与 `lib/tools/domain.js`）。这条链路有单独的测试守着（`tests/host-plugin.test.js:421-445`）。

换句话说：**协议永远到得了，状态只在有状态时才到。**

---

## Web 面板

浏览器半边加两个 seat（`lib/client.js:385-401`）：

| seat | id | order | 内容 |
|---|---|---|---|
| `conversation.view` | `learning` | 30 | 会话区的"学习"tab，渲染档案、优先复习队列、薄弱点、概念强度条、下一步任务。 |
| `sidebar.footer.action` | `learning` | 100 | 侧边栏底部入口，显示到期数量角标，tooltip 里是优先概念。它拿到 owner props `{ wide }`，宽窄两种形态都渲染。 |

两个 seat 都从 `GET /learning-accelerator/panel` 取数（路由常量在 `lib/panel-route.js`，客户端镜像在
`lib/client.js`）。`conversation.view` 的请求会带一个 `?cwd=`，值就是**当前会话的工作空间**：它从
slot 的标准 props 里拿 `sessionId`，再用 `useSessions` 在会话列表里查 `byId[sessionId].cwd`
（`@deepseek-ai/dsh-client-ui-session` 把这两个成员合并进 `SessionStandardProps` /
`GlobalStandardProps`，每个会话级 slot 都能拿到）。这是"切工作空间面板就跟着切"的全部机制：
浏览器请求本身不带会话身份，页面知道。`sidebar.footer.action` 这个 seat 没有会话身份，所以不带
`?cwd=`，走宿主的"最近解析过的会话"兜底。

服务端把 `?cwd=` 当**页面输入**校验（`panelCwdFromRequest()`）：必须是宿主本机拼法的绝对路径，空的、
相对的、含 NUL 的、超长的、解不出来的全部丢弃并回落到宿主自己的会话线索，而不是让请求随便指一个
目录。这个路由：

- 只接受 GET 与 HEAD，其它方法 `405` 并带 `Allow: GET, HEAD`（`lib/panel-route.js:149-153`）；
- 成功时 `200` + `cache-control: no-store`（面板是实时状态，缓存会看到过期队列，`lib/panel-route.js:92-101`）；
- 状态文件坏掉时仍然 `200`，body 是 `{ ok: false, error, path }`，面板把它渲染成解释而不是空框
  （`lib/panel-route.js:163-172`，`lib/panel.js:25-34`）。

面板的渲染是诚实的：路由缺失（404）、状态文件解析失败、宿主不可达，都会在面板里写出原因
（`lib/client.js:249-264`），而不是渲染一个空白帧。

---

## 常见问题

### `--dump-config` 里有这一行，但插件没反应，fiber 停在 PENDING

PENDING 的意思是"依赖的服务还没到"，不是报错，Cordis 会静默等待（`docs/analysis.md` 1.2）。
本插件在 `lib/index.js:47` 声明 `inject = ['tools', 'systemPrompt']`，这两个服务由
`@deepseek-ai/dsh-base` 挂载，任何 shipped profile 都满足。所以如果主插件停在 PENDING，说明组合里
缺的是这两个服务之一。排查顺序：先确认组合里真的有提供 `tools` 与 `systemPrompt` 的包
（例如 `@deepseek-ai/dsh-base`），再看有没有后出现的 patch 行把这一行覆盖成了别的 `name` 或
`disabled: true`——层叠时后出现的行赢。

**注意区分**：面板路由用的是一个**嵌套** `ctx.inject(['webServer'])` fiber（`lib/panel-route.js:136`）。
在没有 HTTP carrier 的组合里（headless、ACP），这个嵌套 fiber 会一直停在 PENDING，这是**预期行为**：
工具和提示词照常工作，只是没有面板路由（`lib/index.js:202-204`）。不要因为它 PENDING 就以为插件坏了。

### npm 上装 peerDependencies 要选对 tag

`package.json:32-37` 声明的 peer 是：

```json
"@deepseek-ai/cordis": "^4.0.4",
"@deepseek-ai/dsh-tools": ">=0.1.0-rc.5",
"@deepseek-ai/dsh-system-prompt": ">=0.1.0-rc.5",
"@deepseek-ai/schemastery": "^3.18.2"
```

其中两个 `dsh-*` 包的 npm `latest` 标签仍是 `0.0.1-rc.1`，**不满足** `>=0.1.0-rc.5`：

| 包 | `latest` | `next` | `alpha` |
|---|---|---|---|
| `@deepseek-ai/dsh-tools` | `0.0.1-rc.1` | `0.2.0-rc.2` | `0.2.1-alpha.5` |
| `@deepseek-ai/dsh-system-prompt` | `0.0.1-rc.1` | `0.2.0-rc.2` | `0.2.1-alpha.5` |

所以要显式指定 `next` 或 `alpha` 标签（例如
`npm i -D @deepseek-ai/dsh-tools@alpha @deepseek-ai/dsh-system-prompt@alpha`），而不是直接装
`latest`。`@deepseek-ai/cordis`（`latest` 4.0.5）与 `@deepseek-ai/schemastery`（`latest` 3.18.5）的
`latest` 满足范围，不受影响。

### 为什么面板路径不在 `/api` 下

carrier 的 `/api` 前缀是它自己的鉴权网关，自带浏览器信任栅和 token；自定义路由不在其内。蹭那个前缀
会变成"过了一道鉴权又绕过另一道"，所以面板故意用自己的路径 `PANEL_ROUTE`
（`lib/panel-route.js:109-116`，`docs/analysis.md` 1.5）。代价是它必须自己守门：`Host` 必须是 loopback，
`Origin` 存在时必须是本地来源（`lib/panel-route.js:32-33,61-89`）。用伪造的 Host 请求会拿到
`403 forbidden`（真机验证记录见 `docs/analysis.md` 第四部分）。

### 面板显示的不是我当前项目

面板跟随的是**学习者**，不是浏览器：浏览器请求不携带会话身份，路由只能按"本进程最近解析过的会话工作
目录 → 配置 `root` → 进程目录"来选（`lib/scope.js:168-202`）。返回的 `path` 字段会告诉你它最终选了
哪个文件（`lib/panel.js:39-44`）。

一个例外：如果你显式配置了 `scope: user`，面板会固定在用户级状态文件上，不再跟随会话——这是有意的，
用户级存储本来就是机器全局的。

要让它在多个项目之间保持确定性，就把 `root` 钉死（见上面"把面板钉在一个项目上"）。
`docs/architecture.md` 里有一节记录了这条链路曾经"单测全绿但真实挂载不可达"的接线 bug，以及现在的
回归测试长什么样。

### 状态文件被手改坏了会怎样

读工具不会毁掉一整轮：`summarize()` 捕获解析错误并返回 `{ ok: false, error, path }`
（`lib/scope.js:215-245`），`learning_status` 的渲染器会提示"先用 write 修回合法 JSON 再继续"
（`lib/tools/status.js`），面板同样渲染这条错误。内核的 `validate()` 还会补齐缺失字段并强制
`schema_version`（`lib/learning-store.js:816-841`），所以手工加字段是安全的，写坏 JSON 语法才会报错。

### 同一份状态文件被两个会话共享，正常吗

正常。状态是 per-file 而不是 per-session 的：同一个项目里的两个会话就是同一个学习者，这正是设计
意图；代价是同一份 checkout 上的第二个真人也会共享它。要分开就用 `scope: 'user'`（全局）或显式的
`state_file`。
