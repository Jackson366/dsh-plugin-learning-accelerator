# 示例：用 learning-accelerator 学日语

## 用户输入

```text
调用 learning-accelerator。我想学日语，目标是通过 N5。我会中文拼音，但没有系统学过外语语法。
```

## 学习状态

- 学习领域：language
- 当前目标：通过日语 N5
- 已知技能：中文拼音
- 薄弱点：外语语法体系
- 本轮模式：onboarding / concept

先取该领域的模板，再建档。模板是静态数据，不需要状态文件：

```js
learning_domain({ domain: 'language' })
```

它返回 `focus_areas`（发音、词汇、句型、听说读写、文化语境）、`practice_types`（跟读、听写、造句、翻译、小测）、`review_strategy` 和 onboarding 问题。下面只挑最关键的两个问题问用户，不一次问完。

## 先定位

日语 N5 的重点不是"背很多难词"，而是建立最基础的句子结构、常见助词、简单动词变化和日常词汇。

## 用你熟悉的东西类比

你熟悉中文拼音，所以可以先把日语假名理解成"发音符号 + 文字"的组合。但这个类比有边界：拼音通常辅助汉字发音，假名本身就是正式文字。

## 本轮最小任务

先学 5 个平假名：

```text
あ い う え お
```

练习目标：

- 能读出这 5 个音。
- 能手写或打出这 5 个字符。
- 能区分 `あ` 和 `お`。

## 回顾一下

1. 假名和拼音最大的相似点是什么？
2. 为什么说假名不是"辅助读音"，而是正式文字？
3. `あ`、`い`、`う`、`え`、`お` 分别怎么读？

## 状态更新

语言类学习最怕"学过就忘"，所以这轮的重点不只是建档，而是把 5 个假名当天就排进复习队列。

1. 建档 —— `learning_session`

```js
learning_session({
  domain: 'language',
  known_skills: ['中文拼音'],
  experience_level: 'beginner',
  learning_goal: '通过日语 N5',
  target_outcome: 'N5 模拟卷达到及格线',
  preferred_language: 'zh-CN',
})
```

- 写入 `learner_profile.learning_domain`（取值 `language`）、`learner_profile.known_skills`、`learner_profile.known_stack`、`learner_profile.experience_level`、`learner_profile.learning_goal`、`learner_profile.target_outcome`、`learner_profile.target_project`。
- `experience_level` 的合法取值是 `unknown` / `no_programming` / `beginner` / `intermediate` / `advanced`；这里有拼音基础但没系统学过外语语法，用 `beginner` 最贴切（`no_programming` 是给"没有编程背景"这一种情况准备的）。

2. 设当前主题 —— `learning_session`（也可以和上一步合并成一次调用）

```js
learning_session({
  current_topic: '五十音图：あ行',
  level: 'beginner',
})
```

- 写入 `topic_state.current_topic`、`topic_state.level`（合法取值 `beginner` / `intermediate` / `advanced`）。
- 只带 `current_topic` 时不会清空上一次调用写好的 profile 字段，`learning_session` 是增量更新。

3. 标记薄弱点 —— `learning_record` 的 `concept` action

```js
learning_record({ action: 'concept', concept: '外语语法体系', status: 'weak' })
```

- 写入 `topic_state.weak_concepts`；`status` 只能是 `mastered` 或 `weak`。
- 薄弱概念会影响复习排序：`learning_due` 给薄弱概念的优先级加成是 30 分，所以这类概念会先被问。

4. 把 5 个假名排进复习 —— `learning_record` 的 `review_add` action

```js
learning_record({
  action: 'review_add',
  concept: '五个基础平假名（あ い う え お）',
  prompt: '读出并写出：あ、い、う、え、お',
  result: 'incorrect',
})
```

- 写入 `review_state.next_review_items`，字段为 `{id, concept, prompt, source: 'manual', result, created_at, due_at}`。
- `result: 'incorrect'` 表示"刚学、还没形成记忆"，间隔 0 天，当天就会到期；等用户第一次准确回忆出来，再用 `review_complete` 配 `correct` 把它推后 1 天，连续答对依次变成 3 天、7 天。

5. 留一个下一步任务 —— `learning_record` 的 `task` action

```js
learning_record({ action: 'task', task: '学习 か き く け こ', notes: '先跟读，再默写' })
```

- 写入 `practice_state.current_tasks`（`{id, name, notes, status: 'pending', created_at}`），并在 `practice_state.current_project_tasks` 里留一份名字镜像。
- 任务名相同时只更新同一条，不会重复堆积。

下一轮开场先调 `learning_due`，把今天的到期项排出来再决定是先复习假名还是先学 `か行`。
