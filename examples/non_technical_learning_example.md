# 示例：通用非技术学习

## 用户输入

```text
调用 learning-accelerator。我想提升公开演讲能力，平时不写代码，也没有技术背景。
```

## 学习状态

- 学习领域：communication
- 当前目标：提升公开演讲能力
- 已知技能：日常表达
- 薄弱点：结构化表达、临场紧张
- 本轮模式：onboarding / practice

先取领域模板，确认这一类学习该用什么形式的练习：

```js
learning_domain({ domain: 'communication' })
```

它返回的 `practice_types` 是"60 秒表达、录音复盘、演讲提纲、问答模拟"，`focus_areas` 是"结构化表达、听众意识、临场反应、语速、反馈"——所以本轮不写代码，直接做一次 60 秒口头练习。

## 先定位

公开演讲不是"天生会不会说话"的问题，而是把想法组织成听众能跟上的结构，并在紧张时仍能稳定表达。

## 最小练习

今天只练一个结构：`观点 - 理由 - 例子 - 收尾`。

题目：

```text
用 60 秒介绍一本你最近看过的书。
```

要求：

- 先说你的观点。
- 给一个理由。
- 举一个具体例子。
- 最后用一句话收尾。

## 评价标准

- 是否在 60 秒内讲完。
- 听众是否能听出你的核心观点。
- 例子是否具体。
- 收尾是否干净。

## 状态更新

非技术学习同样有可结构化的产出：练习规格、作答记录、薄弱概念和复习项，一个都不少。

1. 建档 + 设主题 —— `learning_session`

```js
learning_session({
  domain: 'communication',
  known_skills: ['日常表达'],
  experience_level: 'beginner',
  learning_goal: '提升公开演讲能力',
  target_outcome: '能用「观点-理由-例子-收尾」结构做一次 60 秒表达',
  current_topic: '结构化表达：观点-理由-例子-收尾',
  level: 'beginner',
  constraint: '每次只练一个结构',
})
```

- 写入 `learner_profile.learning_domain`（`communication`）、`learner_profile.known_skills`、`learner_profile.experience_level`、`learner_profile.learning_goal`、`learner_profile.target_outcome`、`learner_profile.target_project`、`learner_profile.constraints`。
- `current_topic` 与 `level` 写入 `topic_state.current_topic`、`topic_state.level`。

2. 标记薄弱点 —— `learning_record` 的 `concept` action

```js
learning_record({ action: 'concept', concept: '结构化表达', status: 'weak' })
```

- 写入 `topic_state.weak_concepts`。`status: 'weak'` 会让这个概念在 `learning_due` 的排序里拿到 30 分加成，优先被问。

3. 把这次口头练习登记成结构化练习 —— `learning_record` 的 `exercise_spec` action

```js
learning_record({
  action: 'exercise_spec',
  topic: '公开演讲',
  concepts: ['结构化表达', '观点-理由-例子-收尾'],
  difficulty: 'easy',
  task: '用 60 秒介绍一本你最近看过的书，按「观点-理由-例子-收尾」四段说',
  goal: '让听众一句话听出核心观点',
  expected_output: '一段 60 秒的口头表达，可录音',
  constraints: ['先说观点', '只给一个理由', '例子必须具体', '结尾一句话收束'],
  evaluation_criteria: ['60 秒内讲完', '核心观点可被复述', '例子具体', '收尾干净'],
  hint: '开口前先写下四行提纲，每行不超过 8 个字。',
})
```

- 写入 `practice_state.exercise_specs`，`difficulty` 用 `easy`（第一次练这个结构）；`evaluation_criteria` 就是上面那份评价标准，被写进了状态里，下一轮复盘时不用重新口述。
- 返回的 `exercise.id` 留给作答时用。

4. 用户说完后记录作答 —— `learning_record` 的 `attempt` action

```js
learning_record({
  action: 'attempt',
  exercise_id: '<exercise_spec 返回的 exercise.id>',
  answer: '观点和例子都说到了，但理由只说了半句，结尾超时 10 秒',
  attempt_result: 'partial',
  score: 60,
  mistake_type: 'structure_incomplete',
  feedback: '四段结构缺了完整的理由，收尾拖长。',
  concepts: ['结构化表达'],
})
```

- 写入 `practice_state.attempt_records`，字段包含 `id`、`exercise_id`、`user_answer`、`result`、`score`、`mistake_type`、`feedback`、`concepts_to_review`、`created_at`。
- `attempt_result: 'partial'` 在返回里保留为 `outcome: 'partial'`，但落盘时 `result` 记成 `fail` —— 存储层的取值只有 `pass` / `fail`，`partial` 在排复习时按"没通过"处理。
- `score` 必须是 0–100 的整数，否则工具直接报错。
- `concepts` 里的每个概念都会被排进 `review_state.next_review_items`（`source` 为 `attempt`），同时更新 `topic_state.concept_progress` 里的 `strength`、`attempts`、`correct_streak`、`failure_count`、`last_reviewed_at`、`next_due_at`，并往 `difficulty_state.evidence` 追加一条 `exercise_failed`。

5. 留一个下一步任务 —— `learning_record` 的 `task` action

```js
learning_record({ action: 'task', task: '录音一次并复盘卡顿点', notes: '只记卡顿发生在第几段' })
```

- 写入 `practice_state.current_tasks`（`{id, name, notes, status: 'pending', created_at}`），并在 `practice_state.current_project_tasks` 里留一份名字镜像。
- 只留一个任务：项目式学习的收尾原则是"下一步只给一件事"。
