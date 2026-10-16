# 教学协议（长文与出处）

本文是 [`lib/protocol.js`](../lib/protocol.js) 注入的短版协议的长文版本，也是这份协议与上游三个 markdown 文件之间的对照表。

上游 Learning-Accelerator 把自己的教学法放在三份文件里，靠 skill 机制请宿主 agent 加载：

| 上游文件 | 内容 |
|---|---|
| `SKILL.md` | 每轮循环（Core Workflow）、教学单元序列、用户画像适配、示例选择、Do Not |
| `SYSTEM_PROMPT.md` | 核心目标、用户画像适配、六步标准运行循环、输出风格、禁止事项 |
| `references/learning_os_protocol.md` | 七种运行模式、状态 schema、间隔重复、练习生成、错误分析、难度校准、任务驱动 |

skill 只能"请求"模型去读；插件可以把方法直接放进上下文。本插件的做法是：

| 上游 | 本插件 |
|---|---|
| `SKILL.md` 的循环与教学单元 | `lib/protocol.js` 的 `CORE_LOOP` / `TEACHING_UNIT_SEQUENCE`，注入进系统提示 |
| `SYSTEM_PROMPT.md` 的画像适配 | `profileTrack()` 按档案里的 `experience_level` 与 `known_skills` 分派，不再依赖模型猜测 |
| `SYSTEM_PROMPT.md` 的禁止事项 | `DO_NOT`，多一条：不要在正文里声称状态已保存 |
| `learning_os_protocol.md` 的七种模式 | `OPERATING_MODES` |
| `learning_os_protocol.md` 的练习生成 | `EXERCISE_LEVELS` + `EXERCISE_SPEC_FIELDS`，落盘走 `learning_record` 的 `exercise_spec` / `attempt` |
| `learning_os_protocol.md` 的错误分析 | `ERROR_ANALYSIS_STEPS`，落盘走 `mistake` |
| `learning_os_protocol.md` 的难度校准 | `DIFFICULTY_SIGNALS` + 内核的"连续两个同向信号移动一档"规则 |
| `learning_os_protocol.md` 的状态 schema | **不重复**：内核（`lib/learning-store.js`）与 [`schemas/learning_state.schema.json`](../schemas/learning_state.schema.json) 是唯一真源 |
| `learning_os_protocol.md` 的 CLI 命令 | `learning_record` 的八个 action，见 [`docs/usage.md`](./usage.md) |

## 协议什么时候出现在上下文里

两个注入块，顺序是"先方法，后状态"：

| 块 | order | 内容 |
|---|---|---|
| `learning-accelerator/protocol` | `promptContextOrder - 1`（默认 149） | 本文描述的短版协议 |
| `learning-accelerator/status` | `promptContextOrder`（默认 150） | 学习领域、目标、薄弱点、到期复习、优先队列、下一步任务、难度 |

两块共用同一个门禁：**只有目标 scope 已经有一条真实的学习线**（存在 state 文件，且有主题、目标、到期项或任务之一）才注入。一个与学习无关的会话，这块插件一个 token 都不花。

代价是：一条全新学习线的第一轮没有 state 文件，因此两个块都还是静默的。第一轮的方法由工具带回——`learning_domain` 与 `learning_session` 的返回值里都带 `teaching_protocol`，并且渲染进模型可见的文案。第二轮起改由注入块承担。

关掉任意一块：

```yaml
- id: learning-accelerator
  name: dsh-plugin-learning-accelerator
  config:
    injectProtocol: false        # 只留状态块
    # injectPromptContext: false # 只留协议块
```

## 短版协议（注入的原文）

注入的正文由 `composeTeachingProtocol()` 生成，结构固定为：每轮循环 → 本轮模式 → 概念讲解的内部单元 → 每轮收尾 → 练习生成 → 错误诊断 → 难度校准 → 复习选择 → 状态写入 → 示例选择 → 输出风格 → 不要做 → 画像适配 → 领域适配。各段原文见 [`lib/protocol.js`](../lib/protocol.js) 的导出常量；此处只补充长文里才有、注入版为了 token 预算省略的部分。

### 每轮结束时的输出结构（来自 `SKILL.md` 的 Output Shape）

````markdown
## 学习状态

- 当前目标：...
- 已掌握：...
- 薄弱点：...
- 本轮模式：...

## 先定位
## 用你熟悉的东西类比
## 最小可运行 Demo
## 代码怎么读
## 实际项目里怎么用
## 最佳实践
## 常见坑
## 回顾一下

1. ...
2. ...
3. ...

小练习：...
讲给我听：...
容易踩坑检查：...
下一步：...

## 状态更新

- 新增掌握：...
- 待复习：...
- 下一次复习建议：...
````

非技术领域把 `最小可运行 Demo` / `代码怎么读` 换成对应形态（发音操练、题目、改写草稿、动作示范），其余结构不变。

### 间隔重复（间隔由内核执行，协议只负责选择与落盘）

| 结果 | 下次间隔 | 副作用 |
|---|---|---|
| `correct` | 1 天 | strength +0.1，streak +1 |
| `second_correct` | 3 天 | strength +0.2，streak +1，概念 → 已掌握 |
| `third_correct` | 7 天 | strength +0.2，streak +1，概念 → 已掌握 |
| `fuzzy` / `incorrect` | 立即（0 天） | strength −0.2，streak 归零，failures +1，概念 → 薄弱 |

优先级排序（`learning_due` 返回的顺序）：

```
priority = (到期 ? 20 : 0) + (薄弱概念 ? 30 : 0) + (1 - strength) × 20 + failure_count × 3
```

协议只要求一件事：**不要要求学习者复习所有东西，挑 2-5 个高价值项**——最近学的核心概念、反复出错的概念、下一步任务需要的概念、讲不回来的概念。

### 难度校准

```
evidence 追加 signal（内核保留最近 20 条）
  → 看最近 2 条：两个正向 → 难度 +1；两个负向 → 难度 −1；否则不变（钳在 1..5）
```

正向：`exercise_completed` / `recall_correct` / `explain_correct`
负向：`exercise_failed` / `recall_incorrect` / `explain_fuzzy` / `setup_failed`

明确的反模式：**不看用户自述的信心**。三个档位的语义是"能独立完成并讲清 → 变难；结果对但讲解浅 → 保持；重复犯错、讲不出关键点、卡在环境搭建 → 变简单"。

### 任务驱动

一个好的任务：可运行、可检视、可作答或可观察；一次只碰一到两个新概念；有明确验收标准；产出一个能继续扩展的成果物；带一个与所用概念挂钩的回顾问题。收尾只给**一个**下一步任务，而不是一张路线图，除非用户明确要求。

## 与上游的三处有意偏离

1. **持久化是工具，不是 CLI。** 上游的 "Local JSON Persistence" 是一串 `python -m learning_accelerator.cli` 命令；这里同样的操作是 `learning_record` 的八个 action。协议文本里不出现任何 CLI 命令，`tests/protocol.test.js` 有一条断言守着这一点。
2. **画像适配按数据分派，不靠模型猜。** 档案里本来就有 `experience_level` 与 `known_skills`，所以 `profileTrack()` 在"零基础日常类比"、"前端对照表"、"初学者补前置"、"有经验直接上工程"、"未知保持保守"之间做选择。上游反复强调的反模式是"对未知背景的人默认他懂前端"，把这件事交给数据比交给概率可靠。判定规则刻意保守：只有明确写出前端 / JS / TS / React / Node 之类技能才给前端对照表，`Java` 不会误判成 `JavaScript`，而 `experience_level: 'no_programming'` 永远优先。
3. **不复述状态 schema。** 内核拥有 schema，工具按它校验，[`schemas/learning_state.schema.json`](../schemas/learning_state.schema.json) 是给人和 CI 的机器契约。在提示里再抄一份只会多一个会漂移的真源。

## 改这份协议

改 `lib/protocol.js` 之后：

```sh
node --test tests/protocol.test.js      # 保真度、画像分派、token 预算
node --test tests/host-plugin.test.js   # 注入门禁与开关
node --test tests/                      # 全套
```

`tests/protocol.test.js` 里的两条守卫值得保留：**上游的七种模式、教学单元顺序、六步错误分析、八个难度信号必须都能在生成的文本里找到**；以及**注入块长度必须小于 6000 字符**，否则每一轮都在悄悄加税。
