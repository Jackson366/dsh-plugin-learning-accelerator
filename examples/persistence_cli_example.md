# 示例：用 learning_record 持久化学习状态

## 场景

用户希望学习进度不只在回答里出现一段"状态更新"文字，还要真正落盘：学习画像、当前主题、薄弱点、复习计划、练习规格和作答记录都写进本地 JSON，下一次打开会话能接着学。

本插件里档案编辑走 `learning_session`，其余写入只有一条路径：`learning_record`。读取走 `learning_status` / `learning_due` / `learning_domain`。

下面的调用写成 `工具名({ 参数 })` 的形式；在 Code Mode 里同一调用是 `await tools.learning_record(args)`，其中 `args` 就是下面那份参数对象。示例省略了 `state_file` 与 `scope`：

- 默认 `scope: 'project'`，落盘到当前会话工作目录的 `./.learning/state.json`；
- `scope: 'user'` 落盘到 `~/.learning-accelerator/state.json`；
- 显式传 `state_file` 时它优先级最高。

状态文件不需要初始化：第一次成功的写调用就会创建它，父目录一起建。

## 写入路径速查

| 想做的事 | 工具 | action |
|---|---|---|
| 建档 / 改档案 / 设主题 / 设层级 | `learning_session` | — |
| 标记已掌握或薄弱 | `learning_record` | `concept` |
| 排一条复习 | `learning_record` | `review_add` |
| 完成一条复习 | `learning_record` | `review_complete` |
| 登记练习规格 | `learning_record` | `exercise_spec` |
| 记录一次作答 | `learning_record` | `attempt` |
| 记录一次错误诊断 | `learning_record` | `mistake` |
| 加一个下一步任务 | `learning_record` | `task` |
| 记录难度证据 | `learning_record` | `evidence` |
| 读全量状态 | `learning_status` | — |
| 读到期 / 优先复习队列 | `learning_due` | — |
| 读领域模板 | `learning_domain` | — |

## 1. 建档：learning_session

技术方向的档案：

```js
learning_session({
  domain: 'technology',
  known_skills: ['JavaScript', 'TypeScript', 'React'],
  experience_level: 'intermediate',
  learning_goal: '用 FastAPI 构建 AI 工具后端',
  target_outcome: 'RAG notebook API',
  constraint: '每天 30 分钟',
})
```

没有编程背景的档案，可以不带 `known_skills`：

```js
learning_session({
  domain: 'general',
  experience_level: 'no_programming',
  learning_goal: '从零开始学习 Python',
})
```

非技术方向的档案：

```js
learning_session({
  domain: 'language',
  known_skills: ['中文拼音'],
  experience_level: 'beginner',
  learning_goal: '通过日语 N5',
})
```

- 写入 `learner_profile.learning_domain`、`learner_profile.known_skills`、`learner_profile.known_stack`、`learner_profile.preferred_language`、`learner_profile.experience_level`、`learner_profile.learning_goal`、`learner_profile.target_outcome`、`learner_profile.target_project`。
- `domain` 只有 6 个合法取值：`general`、`technology`、`language`、`exam`、`writing`、`communication`。
- `experience_level` 只有 5 个合法取值：`unknown`、`no_programming`、`beginner`、`intermediate`、`advanced`。`no_programming` 是正常的、预期中的答案，不是错误值。
- `target_outcome` 会同时镜像到 `learner_profile.target_project`（schema 里两个字段并存）。
- `constraint` 是单个字符串，追加进 `learner_profile.constraints` 数组，重复值不会重复追加。要记多条约束就多调几次。
- `learning_session` 是增量更新：只传想改的字段，其余 profile 字段保持原值。

## 2. 设主题：learning_session

```js
learning_session({ current_topic: 'FastAPI dependency injection', level: 'beginner' })
```

- 写入 `topic_state.current_topic` 与 `topic_state.level`。
- `level` 只有 3 个合法取值：`beginner`、`intermediate`、`advanced`。
- 只传 `current_topic` 时，`topic_state.level` 保持上一次的值；要一起改就一起传。

## 3. 标概念：learning_record 的 concept action

```js
learning_record({ action: 'concept', concept: 'path operation', status: 'mastered' })
learning_record({ action: 'concept', concept: 'dependency injection', status: 'weak' })
```

- 写入 `topic_state.mastered_concepts` 与 `topic_state.weak_concepts`。
- `status` 只有两个合法取值：`mastered`、`weak`。
- 两个列表互斥：标成 `mastered` 会同时把它从 `weak_concepts` 移除，反之亦然；同一个概念不会同时出现在两边。
- 这一步不写 `topic_state.concept_progress`——里面那套 `strength` / `correct_streak` / `next_due_at` 由复习和作答驱动（见第 5、7 步）。

## 4. 排复习：learning_record 的 review_add action

```js
learning_record({
  action: 'review_add',
  concept: 'dependency injection',
  prompt: '用一句话解释 Depends 解决了什么问题',
  result: 'incorrect',
})
```

- 写入 `review_state.next_review_items`，新增一条 `{id, concept, prompt, source: 'manual', result, created_at, due_at}`。
- `result` 的合法取值与间隔：`correct` → 1 天、`second_correct` → 3 天、`third_correct` → 7 天、`incorrect` / `fuzzy` → 0 天（当天或本轮就再来一次）。
- `review_add` 只写 `review_state.next_review_items`，不动概念列表。`result` 用 `incorrect` / `fuzzy` 只是把这条复习排到当天，想让它同时进薄弱点要另调一次 `concept` action（第 3 步）；真正的"答错 → 进薄弱点"联动发生在第 5、7 步的 `review_complete` 和 `attempt` 里。
- `prompt` 省略时默认是 `Review <concept>`；`result` 省略时默认 `correct`。真要排一条复习，建议两个都显式写。
- `id` 由 `concept` + `prompt` 推导，稳定且可复现；同一个 concept/prompt 组合重复调用是更新同一条，不会堆出重复项。

## 5. 完成复习：learning_due → learning_record 的 review_complete action

先取队列：

```js
learning_due({ limit: 5 })
```

返回的每个 `items[]` 都带 `id`、`concept`、`prompt`、`priority`、`strength`、`due_at`（渲染成文本时只显示优先级、strength、到期日和回述题，`id` 在结构化返回值里）。排序规则是：到期 +20、薄弱概念 +30、`(1 − strength) × 20`、每个历史失败 +3。

用户答完后用 `id` 归档：

```js
learning_record({
  action: 'review_complete',
  review_id: '<learning_due 返回的 items[0].id>',
  result: 'correct',
  notes: '能说出 Depends 是按请求解析的',
})
```

这一次调用会改写这几处：

- `review_state.review_history`：这次尝试被归档，带上 `completed_result`、`completed_at`，有 `notes` 就一起写；同时它从 `due_items` / `next_review_items` 里移除。
- `review_state.next_review_items`：按 `result` 排下一次复习（1 / 3 / 7 天，或 0 天）。
- `topic_state.concept_progress[concept]`：`strength`（答对 +0.1，`second_correct` / `third_correct` +0.2，答错 −0.2，上下限 0–1）、`attempts`、`correct_streak`、`failure_count`、`last_reviewed_at`、`next_due_at`。
- `topic_state.mastered_concepts` / `topic_state.weak_concepts` 与 `difficulty_state.evidence`：`incorrect` / `fuzzy` 移进薄弱点并追加 `recall_incorrect`；`second_correct` / `third_correct` 移进已掌握并追加 `recall_correct`；单独的 `correct` 只追加 `recall_correct` 并增加 `correct_streak`，要连续答对到第二次才会归入已掌握。
- 没有"只归档、不重排"的开关：这个 action 一定会安排下一次复习。如果某条复习项暂时不想再出现，正确做法是不要在它到期时用 `review_complete` 归档，而不是指望它被静默丢弃。

## 6. 生成练习：learning_record 的 exercise_spec action

```js
learning_record({
  action: 'exercise_spec',
  topic: 'FastAPI dependency injection',
  concepts: ['dependency injection', 'FastAPI route'],
  difficulty: 'normal',
  task: '把 /ask mock 接口里的 service 改成用 Depends 注入',
  goal: '分清依赖注入和中间件的职责边界',
  expected_output: 'POST /ask 返回 {answer, sources}，service 由 Depends 提供',
  constraints: ['route 里不直接实例化 service', '不接真实 LLM'],
  evaluation_criteria: ['route 不 import 具体 service 实例', '替换实现只改依赖于声明的提供者'],
  hint: 'Depends 的参数是"提供者函数"，不是中间件。',
})
```

- 写入 `practice_state.exercise_specs`，字段为 `{id, topic, concepts, difficulty, goal, task, input, expected_output, constraints, evaluation_criteria, hint, created_at}`。
- `id` 由 `topic` + `concepts` + `difficulty` + `task` 推导，稳定可复现；同样的四元组重复调用是更新同一条规格。
- `difficulty` 只有 3 个合法取值：`easy`、`normal`、`stretch`。
- `concepts` 至少要有一个、`task` 不能为空，否则工具直接报错而不是写入半条记录。
- `topic` 省略时用 `topic_state.current_topic`；`goal` 省略时由概念自动生成。
- 返回里的 `exercise.id` 是下一步记录作答时要用的键。

## 7. 记录尝试：learning_record 的 attempt action

```js
learning_record({
  action: 'attempt',
  exercise_id: '<exercise_spec 返回的 exercise.id>',
  answer: 'Depends 就像中间件，每个请求都会包一层。',
  attempt_result: 'partial',
  score: 45,
  mistake_type: 'concept_confusion',
  feedback: '把依赖解析和 middleware 混在一起了。',
  concepts: ['dependency injection'],
})
```

- 写入 `practice_state.attempt_records`：`{id, exercise_id, user_answer, result, score, mistake_type, feedback, concepts_to_review, created_at}`。
- `attempt_result` 只有 3 个合法取值：`pass`、`partial`、`fail`。`partial` 在返回里保留为 `outcome: 'partial'`，但落盘的 `result` 是 `fail` ——存储层的取值只有 `pass` / `fail`，排复习时 `partial` 和 `fail` 一样按"没通过"处理。
- `score` 必须是 0–100 的整数，否则工具直接报错。
- `concepts` 就是这次的 `concepts_to_review`；省略时默认用该练习规格里声明的 `concepts`。每个概念都会被排进 `review_state.next_review_items`（`source` 为 `attempt`）、更新 `topic_state.concept_progress`，并可能改写 `topic_state.weak_concepts` / `mastered_concepts`。
- `practice_state` 之外还会追加一条难度证据：`pass` → `exercise_completed`，其余 → `exercise_failed`，写进 `difficulty_state.evidence`。

## 8. 加任务：learning_record 的 task action

```js
learning_record({ action: 'task', task: '每天复习 5 个假名', notes: '睡前 5 分钟' })
```

- 写入 `practice_state.current_tasks`，新增一条 `{id, name, notes, status: 'pending', created_at}`。
- 同时在 `practice_state.current_project_tasks` 里留一份只含名字的镜像（这个字段是给旧格式兼容用的）。
- `id` 由任务名推导，同名任务重复调用是更新同一条；`notes` 省略时是空字符串。

## 其余两个 action

错误诊断一次到位：

```js
learning_record({
  action: 'mistake',
  concepts: ['FastAPI 路径参数类型转换', 'Python 类型标注'],
  mistake_type: 'type_confusion',
  feedback: '把 HTTP 路径里的字符串和 FastAPI 转换后的 int 混在一起了。',
})
```

- 一次调用写四件事：`practice_state.last_code_errors` 追加诊断记录（保留最近 20 条）、每个概念进 `topic_state.weak_concepts`、每个概念排一条复习（`source` 为 `diagnosis`、`result` 为 `incorrect`，当天到期）、`difficulty_state.evidence` 追加 `explain_fuzzy`。
- `concepts` 也可以用单个 `concept` 传；两个都没传时工具报错。

单独记一条难度证据：

```js
learning_record({
  action: 'evidence',
  signal: 'explain_correct',
  detail: '能清楚解释 route 和 service 的边界',
})
```

- 写入 `difficulty_state.evidence`（保留最近 20 条），并重算 `difficulty_state.current_difficulty` 与 `difficulty_state.next_adjustment`。
- `signal` 只有 7 个合法取值：`exercise_completed`、`exercise_failed`、`recall_correct`、`recall_incorrect`、`explain_correct`、`explain_fuzzy`、`setup_failed`。
- 规则是**两条连续同向信号**才动一级：两条正向 → `next_adjustment: 'harder'`、难度 +1；两条负向 → `'easier'`、难度 −1；否则是 `'same'`。难度的上下限是 1 和 5。

## 一轮真实学习如何落盘

```js
// 1. 开场先读上下文（只读）：画像、薄弱点、到期复习、难度
learning_status({})                 // summary.current_topic / weak_concepts / due_reviews / current_difficulty

// 2. 取今天的复习队列（只读）
learning_due({ limit: 5 })          // items[].id / concept / prompt / priority / strength / due_at

// 3. 顺带确认这个领域该练什么（只读，不依赖状态文件）
learning_domain({ domain: 'technology' })

// 4. 建档 / 设主题（写 learner_profile 与 topic_state）
learning_session({
  domain: 'technology',
  known_skills: ['JavaScript'],
  experience_level: 'intermediate',
  learning_goal: '用 FastAPI 构建 AI 工具后端',
  target_outcome: 'RAG notebook API',
  current_topic: 'FastAPI dependency injection',
  level: 'beginner',
})

// 5. 用户答完复习题，归档并按结果排下一次（写 review_history / concept_progress / difficulty_state）
learning_record({
  action: 'review_complete',
  review_id: '<上一步 items[0].id>',
  result: 'correct',
})

// 6. 登记一个针对性练习（写 practice_state.exercise_specs）
learning_record({
  action: 'exercise_spec',
  topic: 'FastAPI dependency injection',
  concepts: ['dependency injection'],
  difficulty: 'normal',
  task: '把 /ask mock 接口的 service 改成用 Depends 注入',
})

// 7. 用户交作业后记录结果（写 attempt_records，并顺手排复习、动难度证据）
learning_record({
  action: 'attempt',
  exercise_id: '<上一步 exercise.id>',
  answer: 'service 通过 Depends 注入，route 只做转发。',
  attempt_result: 'pass',
  score: 100,
  concepts: ['dependency injection'],
})

// 8. 收尾只留一个下一步任务（写 current_tasks）
learning_record({ action: 'task', task: '给 /ask 加一个 400 错误分支' })
```

## 字段对照表

| 调用 | 必填参数 | 落盘字段 |
|---|---|---|
| `learning_session` | 无（全可选，但至少要传一个想改的字段） | `learner_profile.*`、`topic_state.current_topic`、`topic_state.level`、`practice_state.current_tasks`（`next_task`） |
| `learning_record` · `concept` | `concept`、`status` | `topic_state.mastered_concepts` / `topic_state.weak_concepts` |
| `learning_record` · `review_add` | `concept` | `review_state.next_review_items` |
| `learning_record` · `review_complete` | `review_id` | `review_state.review_history`、`review_state.next_review_items`、`topic_state.concept_progress`、`topic_state.mastered_concepts` / `weak_concepts`、`difficulty_state.*` |
| `learning_record` · `exercise_spec` | `task`、至少一个 `concepts` | `practice_state.exercise_specs` |
| `learning_record` · `attempt` | `exercise_id`、`attempt_result`、整数 `score` | `practice_state.attempt_records`、`review_state.next_review_items`、`topic_state.concept_progress`、`difficulty_state.*` |
| `learning_record` · `mistake` | `concept` 或 `concepts` | `practice_state.last_code_errors`、`topic_state.weak_concepts`、`review_state.next_review_items`、`difficulty_state.*` |
| `learning_record` · `task` | `task` | `practice_state.current_tasks`、`practice_state.current_project_tasks` |
| `learning_record` · `evidence` | `signal` | `difficulty_state.evidence`、`difficulty_state.current_difficulty`、`difficulty_state.next_adjustment` |
| `learning_status` / `learning_due` / `learning_domain` | 无 | 不写文件 |

`topic_state.misconceptions`、`topic_state.open_questions`、`practice_state.completed_exercises`、`practice_state.failed_exercises` 保留在 schema 里，但本插件没有工具写它们；练习结果统一落在 `practice_state.attempt_records`。

> 等价关系：上游的 `python -m learning_accelerator.cli` 命令族与本插件的工具一一对应（`init` / `profile` / `topic` / `concept` / `review` / `review-complete` / `exercise-generate` / `attempt record` / `task add` / `evidence` / `summary` ↔ `learning_session`、`learning_record`、`learning_status`、`learning_due`、`learning_domain`），两者读写同一份 `.learning/state.json`。
