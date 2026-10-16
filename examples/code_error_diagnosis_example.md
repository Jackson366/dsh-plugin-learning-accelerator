# 示例：代码错误诊断 + 难度调整

## 用户输入

```text
调用 learning-accelerator，帮我分析这个 FastAPI 报错，并更新我的薄弱点：

@app.get("/items/{item_id}")
def read_item(item_id: int):
    return {"item_id": item_id, "upper": item_id.upper()}

报错：AttributeError: 'int' object has no attribute 'upper'
```

## 学习状态

- 当前目标：理解 FastAPI 路径参数和 Python 类型
- 薄弱点：类型标注不等于任意对象都拥有字符串方法
- 本轮模式：debug

先读一次状态，确认这轮要接在哪个主题上、难度现在停在哪一级：

```js
learning_status({})
```

返回里的 `summary.current_topic`、`summary.weak_concepts`、`summary.current_difficulty`（1–5）和 `summary.next_adjustment` 决定了下面的诊断语气和练习难度。

## 失败路径

FastAPI 会根据 `item_id: int` 把路径参数转换成整数。进入函数后，`item_id` 是 `int`，而 `.upper()` 是字符串方法，所以运行时报错。

## 根因

你把"HTTP 路径里收到的是字符串"和"FastAPI 传给函数的是类型转换后的值"混在一起了。

## 最小修复

如果你想保留整数 ID：

```python
@app.get("/items/{item_id}")
def read_item(item_id: int):
    return {"item_id": item_id, "double": item_id * 2}
```

如果你真的需要字符串方法：

```python
@app.get("/items/{item_id}")
def read_item(item_id: str):
    return {"item_id": item_id, "upper": item_id.upper()}
```

## 针对性练习

写两个接口：

1. `/square/{n}`：`n` 是 `int`，返回平方。
2. `/shout/{word}`：`word` 是 `str`，返回大写。

## 状态更新

诊断类轮次的核心是把"错在哪"翻译成状态里的薄弱点和复习项。这里用两次 `learning_record`：

1. 记录错误诊断 —— `learning_record` 的 `mistake` action（一次调用等于四件事）

```js
learning_record({
  action: 'mistake',
  concept: 'FastAPI 路径参数类型转换',
  mistake_type: 'type_confusion',
  feedback: '把 HTTP 路径里的字符串和 FastAPI 转换后的 int 混在一起了。',
})
```

这一次调用会：

- 在 `practice_state.last_code_errors` 追加一条 `{id, concept, concepts, mistake_type, detail, recorded_at}`，只保留最近 20 条；
- 把概念写进 `topic_state.weak_concepts`；
- 为概念在 `review_state.next_review_items` 排一条复习，`source` 是 `diagnosis`、`result` 是 `incorrect`，所以 `due_at` 是今天，本轮就能再问；
- 往 `difficulty_state.evidence` 追加一条 `explain_fuzzy` 信号。

> 注意 `mistake` 是**按概念逐条**写证据的：传 `concepts: [A, B]` 会追加两条 `explain_fuzzy`。两条连续同向信号就够让 `difficulty_state.current_difficulty` 降一级了，所以"只想标记薄弱点、暂时不想降难度"时，先一次只传一个概念（这里就是这么做的）。

2. 登记针对性练习 —— `learning_record` 的 `exercise_spec` action

```js
learning_record({
  action: 'exercise_spec',
  topic: 'FastAPI 路径参数类型转换',
  concepts: ['FastAPI 路径参数类型转换', 'Python 类型标注'],
  difficulty: 'easy',
  task: '写两个接口：/square/{n} 的 n 是 int 并返回平方；/shout/{word} 的 word 是 str 并返回大写',
  goal: '分清"路径里是字符串"和"函数里是转换后的类型"',
  expected_output: '/square/3 返回 9；/shout/hi 返回 HI',
  constraints: ['两个接口的路径参数类型标注必须不同'],
  evaluation_criteria: ['两个接口都能独立跑通', '能解释为什么 /square 不能调用 .upper()'],
  hint: '先看函数签名里的类型标注，再想这个类型有没有你想调用的方法。',
})
```

- 写入 `practice_state.exercise_specs`，`difficulty` 这里是 `easy`（合法取值只有 `easy` / `normal` / `stretch`），因为当前证据只支持先巩固类型转换。
- 返回的 `exercise.id` 在下一轮用 `attempt` action 记录作答。

3. 难度为什么"保持同级"

- `mistake` 写入的 `explain_fuzzy` 是一条负向信号。难度调整的规则是**两条连续同向信号**才动一级：单条负向信号只让 `difficulty_state.next_adjustment` 回到 `same`、`difficulty_state.current_difficulty` 不变。
- 如果下一轮用户又栽在同一个类型问题上（再写入一条 `explain_fuzzy` 或 `exercise_failed`），`current_difficulty` 才会降一级，最低到 1。
- 反过来，用户能准确解释并能独立写出练习，连续两条 `explain_correct` / `exercise_completed` 才会升一级，最高到 5。

如果这轮还想单独留一条校准证据，可以显式再调一次：

```js
learning_record({
  action: 'evidence',
  signal: 'explain_fuzzy',
  detail: '复述时仍然把类型标注说成"运行时自动转字符串"',
})
```

- `signal` 的合法取值只有 7 个：`exercise_completed`、`exercise_failed`、`recall_correct`、`recall_incorrect`、`explain_correct`、`explain_fuzzy`、`setup_failed`。
- 这一条只写 `difficulty_state.evidence`（保留最近 20 条）并重算 `current_difficulty` / `next_adjustment`，不碰复习计划；上面 `mistake` 已经写过一条 `explain_fuzzy`，所以再加这一条就是第二条连续负向信号：`next_adjustment` 变成 `easier`，`current_difficulty` 降一级（已经是最低 1 时保持 1）。加之前先想清楚是不是同一件事，别为了"看起来记录得全"把难度推下去。
