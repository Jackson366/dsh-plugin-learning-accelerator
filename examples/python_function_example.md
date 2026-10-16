# 示例：用 learning-accelerator 学 Python 函数

## 用户输入

```text
调用 learning-accelerator，带我学习 Python 函数，类比 JS 函数讲。
```

## 学习状态

- 学习领域：technology
- 当前目标：理解并写出 Python 函数
- 已知技能：JavaScript 函数、箭头函数、默认参数
- 薄弱点：缩进作用域、可变默认参数
- 本轮模式：concept

轮次开始时先读状态：

```js
learning_status({})
```

`summary.known_skills` 里有 JavaScript，这轮就用 JS 函数做类比；`summary.weak_concepts` 里的「可变默认参数」会在下面重点展开，并在结束时排进复习。

## 先定位

Python 函数和 JS 函数一样，都是把一段可复用逻辑封装起来。但 Python 更强调可读性、显式参数和简单的调用方式。

## 用 JS 类比

JS:

```js
function add(a, b) {
  return a + b
}
```

Python:

```python
def add(a, b):
    return a + b
```

你可以把 `def` 理解成 JS 的 `function`，但 Python 用缩进表示函数体，不用 `{}`。

## 最小可运行 Demo

```python
def greet(name: str) -> str:
    return f"hello, {name}"

print(greet("Mao"))
```

运行：

```bash
python3 demo.py
```

输出：

```text
hello, Mao
```

## 代码怎么读

- `def greet(name: str) -> str:`：`def` 声明函数，`name: str` 是参数的类型提示，`-> str` 是返回值类型提示。
- `return f"hello, {name}"`：f-string 把变量插进字符串，等价于 JS 的模板字符串。
- 缩进的两行属于函数体；Python 没有 `{}`，靠缩进划边界。
- `greet("Mao")`：调用函数。只写定义不调用，什么都不会发生。

## 最佳实践

- 现代 Python 推荐写类型提示。
- 函数尽量只做一件事。
- 不要用可变对象作为默认参数。
- 复杂返回值可以用 dict、dataclass 或 Pydantic model 表达。

## 常见坑

```python
def add_item(items=[]):
    items.append("x")
    return items
```

这个 `[]` 只会在函数定义时创建一次，后续调用会复用同一个列表。

推荐写法：

```python
def add_item(items=None):
    if items is None:
        items = []
    items.append("x")
    return items
```

## 回顾一下

1. `def` 和 JS 的 `function` 有什么相似点？
2. Python 为什么靠缩进表示作用域？
3. 为什么默认参数不要随便写 `[]`？

小练习：写一个函数，接收一个字符串列表，返回每个字符串的长度。

## 状态更新

这一轮三次工具调用：

1. 建档 + 设主题 —— `learning_session`

```js
learning_session({
  domain: 'technology',
  known_skills: ['JavaScript', 'Node.js'],
  experience_level: 'intermediate',
  learning_goal: '能自己写 Python 函数并读懂别人写的函数',
  target_outcome: '完成 3 个函数小练习并解释每一步',
  current_topic: 'Python 函数定义与默认参数',
  level: 'beginner',
  next_task: '写一个函数，接收字符串列表，返回每个字符串的长度',
})
```

- 写入 `learner_profile.learning_domain / known_skills / experience_level / learning_goal / target_outcome`。
- `current_topic` 与 `level` 写入 `topic_state.current_topic`、`topic_state.level`。
- `next_task` 写入 `practice_state.current_tasks`，并在 `practice_state.current_project_tasks` 里留一份名字镜像。

2. 标记已掌握的概念 —— `learning_record`

```js
learning_record({ action: 'concept', concept: 'Python 函数定义（def）', status: 'mastered' })
```

- 写入 `topic_state.mastered_concepts`。用户能跟上 JS 类比，说明定义语法这点已经过关。

3. 把最容易翻车的点排进当天复习 —— `learning_record`

```js
learning_record({
  action: 'review_add',
  concept: '可变默认参数',
  prompt: '为什么 def add_item(items=[]) 是坑？正确的写法是什么？',
  result: 'incorrect',
})
```

- 写入 `review_state.next_review_items`，`result: 'incorrect'` 让 `due_at` 落在今天，本轮对话内就能再问一次。
- 同一个 `concept` + `prompt` 重复调用只会更新同一条记录，`id` 稳定。

4. 把回顾里的小练习登记成结构化练习 —— `learning_record`

```js
learning_record({
  action: 'exercise_spec',
  topic: 'Python 函数',
  concepts: ['函数定义（def）', '列表遍历'],
  difficulty: 'normal',
  task: '写一个函数，接收一个字符串列表，返回每个字符串的长度',
  goal: '确认能自己定义函数并返回值',
  expected_output: '返回 [3, 5] 这类长度列表',
  constraints: ['函数内部不要直接 print'],
  evaluation_criteria: ['能独立写出 def', '返回值类型正确'],
  hint: '可以在一个列表推导式里同时拿到元素和长度。',
})
```

- 写入 `practice_state.exercise_specs`，`id` 由 `topic` + `concepts` + `difficulty` + `task` 推导。
- `concepts` 至少要有一个、`task` 不能为空，否则工具会直接报错；`difficulty` 只有 `easy` / `normal` / `stretch`。
- 把返回的 `exercise.id` 留到下一轮，用 `learning_record` 的 `attempt` action 记录作答结果。
