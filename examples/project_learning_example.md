# 示例：项目驱动学习 RAG API

## 用户输入

```text
调用 learning-accelerator，用一个小项目带我学 RAG API 后端。我熟悉 React 和 Node.js，不熟 FastAPI。
```

## 学习状态

- 学习领域：technology
- 当前目标：用一个小项目入门 RAG API 后端
- 已知技能：React、Node.js、Express
- 薄弱点：FastAPI、Pydantic、Python 工程分层
- 本轮模式：project

先读状态，再决定这轮是讲概念还是推项目：

```js
learning_status({})
```

`summary.current_tasks` 里如果已经有上一个项目步骤，就接着它做；`summary.current_difficulty`（1–5）决定项目步骤的粒度——难度低时一次只推一个可运行的小接口。

## 先定位

RAG API 后端可以理解成"React 前端和向量检索/LLM 之间的稳定服务层"。它负责接收问题、检索相关文档、拼接上下文、调用模型，并把结果返回给前端。

## 用 Node/Express 类比

- FastAPI route ≈ Express route handler。
- Pydantic schema ≈ TypeScript interface + 运行时校验。
- service 层 ≈ Express 项目里的业务模块。

类比边界：TypeScript 类型主要在编译期保护你；Pydantic 会在请求进入服务时做运行时校验。

## 本轮项目任务

先实现一个不接真实模型的 `/ask` mock API，目标是把目录结构、schema、route、service 分层跑通。

```text
app/
  main.py
  api/routes.py
  models/schemas.py
  services/rag_service.py
```

## 验收标准

- `POST /ask` 接收 `{ "question": "..." }`。
- 返回 `{ "answer": "mock: ...", "sources": [] }`。
- route 不直接拼业务答案，而是调用 service。
- schema 文件只放请求/响应结构。

## 回顾一下

1. 为什么 route 不应该塞满业务逻辑？
2. Pydantic schema 和 TypeScript interface 最大区别是什么？
3. 如果下一步接真实 LLM，错误处理应该放在哪一层？

## 下一步

把 mock service 替换成"检索函数 + 生成函数"两个小函数，但先不要接真实数据库，避免一次引入太多概念。

## 状态更新

项目驱动学习的状态更新要能支撑"下次接着做"，所以重点是任务、练习规格和验收标准的落盘。

1. 建档 + 设主题 —— `learning_session`

```js
learning_session({
  domain: 'technology',
  known_skills: ['React', 'Node.js', 'Express'],
  experience_level: 'intermediate',
  learning_goal: '用一个小项目学 RAG API 后端',
  target_outcome: 'RAG notebook API：跑通分层清晰的 /ask 接口',
  current_topic: 'RAG API 分层：route / schema / service',
  level: 'beginner',
  next_task: '实现不接真实模型的 /ask mock API',
})
```

- 写入 `learner_profile.learning_domain / known_skills / known_stack / experience_level / learning_goal / target_outcome / target_project`。
- `current_topic` 与 `level` 写入 `topic_state.current_topic`、`topic_state.level`。
- `next_task` 写入 `practice_state.current_tasks`，并在 `practice_state.current_project_tasks` 里留一份名字镜像——这样"下一步做什么"不会只留在对话里。

2. 把验收标准写进练习规格 —— `learning_record` 的 `exercise_spec` action

```js
learning_record({
  action: 'exercise_spec',
  topic: 'RAG API 分层',
  concepts: ['FastAPI route', 'Pydantic schema', 'service 分层'],
  difficulty: 'normal',
  task: '实现 POST /ask mock 接口：接收 {"question": "..."}，返回 {"answer": "mock: ...", "sources": []}',
  goal: '跑通 route / schema / service 三层，而不是把逻辑塞进 main.py',
  expected_output: 'POST /ask 返回 mock 答案；route 只做参数校验和转发',
  constraints: ['route 里不允许拼业务答案', '不接真实 LLM 和数据库', 'schema 文件只放请求/响应结构'],
  evaluation_criteria: ['接口能独立跑通', 'route 通过 service 拿答案', 'schema 与业务代码分文件'],
  hint: '先在 services/rag_service.py 写一个返回固定 mock 字符串的函数，route 只调用它。',
})
```

- 写入 `practice_state.exercise_specs`，`id` 由 `topic` + `concepts` + `difficulty` + `task` 推导；`difficulty: 'normal'` 表示"把刚学的概念和一个熟悉的东西组合起来"，这里是"用 Express 分层习惯套 FastAPI"。
- 上游的验收标准被拆进了 `expected_output`、`constraints`、`evaluation_criteria` 三个字段，下一轮复盘直接对着这些字段判分。
- 返回的 `exercise.id` 在用户交作业时用 `attempt` action 记录。

3. 把类比中暴露的薄弱点排进复习 —— `learning_record` 的 `review_add` action

```js
learning_record({
  action: 'review_add',
  concept: 'Pydantic schema 与 TypeScript interface 的区别',
  prompt: 'Pydantic 的校验发生在编译期还是运行时？举一个 TS interface 拦不住的例子。',
  result: 'fuzzy',
})
```

- 写入 `review_state.next_review_items`，`result: 'fuzzy'` 的 `due_at` 是今天，可以在同一次对话里追问。
- 这条复习项来自类比的"边界"部分——类比讲得越顺，越容易漏掉边界，边界正好是复习题。

4. 用户交作业后记录尝试 —— `learning_record` 的 `attempt` action

```js
learning_record({
  action: 'attempt',
  exercise_id: '<exercise_spec 返回的 exercise.id>',
  answer: 'mock 接口跑通了，但 route 里直接 return 了固定字符串，没有走 service',
  attempt_result: 'partial',
  score: 55,
  mistake_type: 'layering_missed',
  feedback: '分层没落地：service 层被跳过，route 承担了业务。',
  concepts: ['service 分层'],
})
```

- 写入 `practice_state.attempt_records`；`attempt_result: 'partial'` 在排复习和难度证据里按失败处理（落盘的 `result` 是 `fail`，返回里保留 `outcome: 'partial'`）。
- `concepts` 里的 `service 分层` 会被写进 `topic_state.weak_concepts` 和 `review_state.next_review_items`（`source` 为 `attempt`），并更新 `topic_state.concept_progress`。
- 难度证据里追加一条 `exercise_failed`；两条连续的负向证据才会让 `difficulty_state.current_difficulty` 降一级。

5. 明确下一步任务 —— `learning_record` 的 `task` action

```js
learning_record({
  action: 'task',
  task: '把 mock service 拆成「检索函数 + 生成函数」两个小函数',
  notes: '先不接真实数据库和真实 LLM',
})
```

- 写入 `practice_state.current_tasks`，`id` 由任务名推导；同名任务重复调用只更新，不追加。
- 项目还没结束，所以任务只给一步，避免一次引入太多概念。
