# 示例：零编程基础学习 Python 函数

## 用户输入

```text
调用 learning-accelerator。我完全没有编程基础，带我学习 Python 函数。
```

## 学习状态

- 学习领域：technology
- 当前目标：理解函数是什么
- 已知技能：暂未记录
- 薄弱点：编程基本概念
- 本轮模式：concept

第一位要做的不是讲语法，而是确认起点。先读状态，确认这个学习者是不是全新的：

```js
learning_status({})
```

如果 `summary.mastered_concepts`、`summary.weak_concepts` 都是空、`summary.current_topic` 也是空，说明状态文件里还没有这个人，需要先建档；建档时 `experience_level` 明确写 `no_programming`，之后所有解释都不假设读者会写代码。

## 先定位

函数可以理解成"有名字的一组步骤"。以后你想重复做这组步骤时，不需要重新写一遍，只要调用这个名字。

比如你每天泡茶，大概有这些步骤：

1. 烧水。
2. 放茶叶。
3. 倒水。
4. 等几分钟。

如果把这组步骤叫做"泡茶"，下次你只要说"泡茶"，就代表执行整套步骤。编程里的函数也是这个思路。

## 最小可运行 Demo

创建 `demo.py`：

```python
def greet(name):
    return "你好，" + name

message = greet("小明")
print(message)
```

运行：

```bash
python demo.py
```

输出：

```text
你好，小明
```

## 代码怎么读

- `def greet(name):`：定义一个叫 `greet` 的函数。
- `name`：函数需要你给它的一个信息。
- `return`：把结果交回去。
- `greet("小明")`：真正使用这个函数。
- 缩进的那一行是函数的"身体"：`def` 这一行加上缩进的部分，才是完整的一步。

## 常见坑

- 只写了函数定义，不代表函数已经运行。
- 缩进不能乱改，缩进表示哪些代码属于函数。
- `return` 和 `print` 不一样：`return` 是把结果交回程序，`print` 是显示在屏幕上。

## 回顾一下

1. 函数解决了什么问题？
2. `name` 在这个例子里是什么？
3. `return` 和 `print` 有什么不同？

小练习：写一个 `double(n)` 函数，传入数字 `3` 时返回 `6`。

## 状态更新

1. 建档 —— `learning_session`

```js
learning_session({
  domain: 'technology',
  experience_level: 'no_programming',
  learning_goal: '理解函数是什么，能自己写一个最简单的函数',
  target_outcome: '独立写出 double(n) 并说出 return 的作用',
  current_topic: 'Python 函数',
  level: 'beginner',
  constraint: '每次只引入一个新概念',
  preferred_language: 'zh-CN',
})
```

- 写入 `learner_profile.learning_domain`、`learner_profile.experience_level`（这里是 `no_programming`）、`learner_profile.learning_goal`、`learner_profile.target_outcome`、`learner_profile.target_project`、`learner_profile.constraints`。
- `current_topic` 与 `level` 写入 `topic_state.current_topic`、`topic_state.level`。
- 不传 `known_skills`，`learner_profile.known_skills` / `known_stack` 保持空数组 —— 对零基础学习者，"没记录"本身就是有用的信息。
- 不传 `next_task` 是对的：下面用更结构化的 `exercise_spec` 记录小练习，避免同一个练习在 `current_tasks` 和 `exercise_specs` 里重复。

2. 记录已经掌握的那一句 —— `learning_record` 的 `concept` action

```js
learning_record({ action: 'concept', concept: '函数是可复用的一组步骤', status: 'mastered' })
```

- 写入 `topic_state.mastered_concepts`。这是"能用自己的话说出来"级别的掌握，不是"会写代码"级别的掌握，所以下面的复习仍然必要。

3. 排一条当天复习 —— `learning_record` 的 `review_add` action

```js
learning_record({
  action: 'review_add',
  concept: '函数定义和函数调用的区别',
  prompt: '只写了 def greet(name): 但没写 greet("小明")，屏幕上会出现什么？为什么？',
  result: 'incorrect',
})
```

- 写入 `review_state.next_review_items`，`result: 'incorrect'` 让 `due_at` 落在今天，本轮结束前就能再问一次。
- 零基础学习者的复习项要挑"概念边界"而不是"记忆点"，所以问的是定义与调用的区别，而不是 `def` 怎么拼。

4. 把小练习登记成结构化练习 —— `learning_record` 的 `exercise_spec` action

```js
learning_record({
  action: 'exercise_spec',
  topic: 'Python 函数',
  concepts: ['函数定义（def）', '函数调用', 'return'],
  difficulty: 'easy',
  task: '写一个 double(n) 函数，传入 3 时返回 6',
  goal: '把"定义"和"调用"两件事连起来',
  expected_output: '调用 double(3) 得到 6，并且能解释 6 是从哪里来的',
  constraints: ['只能用 def 和 return', '不允许直接 print(6)'],
  evaluation_criteria: ['能独立写出函数定义', '能说出 return 把结果交给了谁'],
  hint: '函数体里写一个乘法，再用 return 把它送出去。',
})
```

- 写入 `practice_state.exercise_specs`，`difficulty: 'easy'` 表示"刚学完概念的第一次直接应用"，符合上游的三级定义；`concepts` 至少要有一个，`task` 不能为空。
- 返回里的 `exercise.id` 是稳定的，下一轮用它调 `learning_record` 的 `attempt` action，配 `attempt_result`（`pass` / `partial` / `fail`）和整数 `score`（0–100）记录作答。
