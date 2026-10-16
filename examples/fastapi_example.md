# 示例：用 learning-accelerator 学 FastAPI

## 用户输入

```text
调用 learning-accelerator，类比 Express 带我快速上手 FastAPI。
```

## 学习状态

- 学习领域：technology
- 当前目标：用已有的 Express 经验快速上手 FastAPI
- 已知技能：JavaScript、TypeScript、React、Express 路由
- 薄弱点：Python 类型提示、Pydantic 校验、依赖注入
- 本轮模式：concept

这块状态不是猜的。轮次一开始先读文件，再决定拿什么当类比锚点：

```js
learning_status({})   // 只读，不写文件
```

`summary.known_skills` 里有 Express，所以下面用 Express 类比；`summary.weak_concepts` 里的 Pydantic 校验会在这轮结束时被排进复习。

## 先定位

FastAPI 是 Python 生态里非常流行的 Web API 框架，特别适合 AI 服务、内部工具、RAG 服务、Agent 网关和后端接口。

## 用你熟悉的东西类比：Express

Express:

```js
app.get("/hello", (req, res) => {
  res.json({ message: "hello" })
})
```

FastAPI:

```python
from fastapi import FastAPI

app = FastAPI()

@app.get("/hello")
def hello():
    return {"message": "hello"}
```

相似点：

- 都是声明路由。
- 都能返回 JSON。
- 都适合写 API 服务。

不同点：

- FastAPI 强依赖 Python 类型提示。
- FastAPI 常和 Pydantic 一起做请求/响应校验。
- FastAPI 天然支持 OpenAPI 文档。

## 最小可运行 Demo

安装：

```bash
pip install fastapi uvicorn
```

创建 `main.py`：

```python
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

class ChatRequest(BaseModel):
    message: str

@app.post("/chat")
def chat(req: ChatRequest):
    return {"reply": f"你说的是：{req.message}"}
```

启动：

```bash
uvicorn main:app --reload
```

访问文档：

```text
http://127.0.0.1:8000/docs
```

## 代码怎么读

- `@app.get("/hello")`：装饰器把下面的函数注册成路由，等价于 Express 的 `app.get("/hello", handler)`。
- `class ChatRequest(BaseModel)`：声明请求体结构，同时做运行时校验，等价于 TypeScript interface + zod。
- `req: ChatRequest`：类型提示在这里不只是注释，FastAPI 靠它决定怎么解析请求体。
- `return {"message": ...}`：返回 dict 会被自动序列化成 JSON，不需要手动 `res.json()`。

## 实际项目里怎么用

常见结构：

```text
app/
  main.py
  api/
    routes.py
  services/
    chat_service.py
  models/
    schemas.py
  core/
    config.py
```

## 最佳实践

- 请求体用 Pydantic model。
- 业务逻辑不要全写在路由函数里。
- 配置放到 config/env。
- AI 请求建议封装到 service 层。
- 需要并发 IO 时再使用 async。

## 常见坑

- 把所有逻辑写进 `main.py`。
- 在 async 路由里调用阻塞请求。
- 不做异常处理。
- 不区分 schema 和业务模型。

## 回顾一下

1. FastAPI 和 Express 最大相似点是什么？
2. Pydantic 在 FastAPI 里承担什么作用？
3. 为什么业务逻辑不建议全写在路由函数里？

小练习：写一个 `/summarize` 接口，接收 `{ "text": "..." }`，返回文本长度和一句模拟摘要。

## 状态更新

这一轮三次工具调用，全部落在 `.learning/state.json`（默认当前会话工作目录下的 `./.learning/state.json`，示例里省略了 `state_file` / `scope` 参数）：

1. 建档 + 设主题 —— `learning_session`

```js
learning_session({
  domain: 'technology',
  known_skills: ['JavaScript', 'TypeScript', 'React', 'Express'],
  experience_level: 'intermediate',
  learning_goal: '用 FastAPI 构建 AI 工具后端',
  target_outcome: '跑通一个带 Pydantic 校验的 /chat 接口',
  current_topic: 'FastAPI 路由与 Pydantic 请求校验',
  level: 'beginner',
  constraint: '每天 30 分钟',
  preferred_language: 'zh-CN',
})
```

- 写入 `learner_profile.learning_domain`、`learner_profile.known_skills`、`learner_profile.known_stack`、`learner_profile.experience_level`、`learner_profile.learning_goal`、`learner_profile.target_outcome`、`learner_profile.target_project`、`learner_profile.constraints`。
- `current_topic` 与 `level` 写入 `topic_state.current_topic`、`topic_state.level`。
- 第一次调用就会创建状态文件，不需要单独的初始化步骤。

2. 把已经讲透的概念标成掌握 —— `learning_record`

```js
learning_record({ action: 'concept', concept: 'FastAPI 路由声明', status: 'mastered' })
```

- 写入 `topic_state.mastered_concepts`；同一个概念会同时从 `topic_state.weak_concepts` 里移除。
- `status` 只有两个合法取值：`mastered`、`weak`。

3. 把还没讲透的部分排进复习 —— `learning_record`

```js
learning_record({
  action: 'review_add',
  concept: 'Pydantic 请求校验',
  prompt: 'Pydantic 在 FastAPI 里承担什么作用？',
  result: 'fuzzy',
})
```

- 写入 `review_state.next_review_items`，新增一条 `{id, concept, prompt, source, result, created_at, due_at}`（`source` 为 `manual`）。
- `result: 'fuzzy'` 的间隔是 0 天，`due_at` 就是今天，下一轮 `learning_due` 会立刻把它排到前面；`correct` / `second_correct` / `third_correct` 分别是 1 / 3 / 7 天。
- `id` 由 `concept` + `prompt` 推导，重复调用是更新同一条，不会堆出重复项。

想确认落盘结果，用 `learning_status` 或 `learning_due` 读回即可，两者都不写文件。
