/**
 * lib/protocol.js — the teaching protocol.
 *
 * Upstream Learning-Accelerator ships its pedagogy as three markdown files the
 * host agent is asked to load: `SKILL.md` (the loop and the teaching unit),
 * `SYSTEM_PROMPT.md` (operating modes and profile adaptation), and
 * `references/learning_os_protocol.md` (exercise generation, error analysis,
 * difficulty adjustment). A skill can only *ask* the model to read them; a
 * plugin can put the method in the prompt.
 *
 * This module is that port: pure data plus pure string builders — no Cordis, no
 * filesystem, no clock — so it can be unit-tested directly and injected from
 * whichever integration point needs it: the prompt-context block of an
 * established track, or the tool result that opens a new one.
 *
 * Deliberate deviations from the upstream markdown, each one because the
 * harness changed what is possible:
 *
 *   1. Persistence is `learning_record`, not a CLI. Upstream's "Local JSON
 *      Persistence" section is a list of `python -m learning_accelerator.cli`
 *      commands; here the same operations are the eight `action`s of one tool.
 *   2. Profile adaptation is dispatched by data, not by the model's guess. The
 *      learner profile already carries `experience_level` and `known_skills`,
 *      so {@link profileTrack} chooses between the no-prior-programming
 *      analogies and the frontend-to-Python mapping instead of leaving "do not
 *      assume frontend" to chance.
 *   3. The state schema is not restated. The kernel owns the schema and the
 *      tools validate against it; repeating it in the prompt would create a
 *      second source of truth that drifts.
 *   4. The copy is Chinese, matching upstream's default and the plugin's other
 *      model-facing text.
 *
 * @see ../docs/teaching-protocol.md for the long form, with provenance.
 */

/** One primary mode per turn, in the order upstream lists them. */
export const OPERATING_MODES = Object.freeze([
  {
    id: 'onboarding',
    label: '新主题入门',
    intent: '摸清目标、学习领域、背景、已知技能、约束，以及要交付的任务或项目',
  },
  { id: 'concept', label: '概念讲解', intent: '用一个概念走完类比、示例、实际用法、常见坑与回顾' },
  { id: 'project', label: '任务驱动', intent: '推进一个真实任务或项目步骤，并回连到它用到的概念' },
  { id: 'practice', label: '练习生成与评估', intent: '生成练习，或评估学习者的作答' },
  { id: 'review', label: '回顾复习', intent: '按间隔重复做记忆提取，一次只挑 2-5 个高价值项' },
  {
    id: 'debug',
    label: '错误诊断',
    intent: '分析代码、日志、失败测试、错题、草稿、表达尝试或训练记录',
  },
  { id: 'calibration', label: '难度校准', intent: '按观察到的表现调整难度' },
])

/**
 * The per-turn loop, condensed from upstream `SKILL.md` "Core Workflow".
 *
 * Step 1 points at the state file rather than at the upstream CLI: in this
 * package the state is already in context and reachable through tools.
 */
export const CORE_LOOP = Object.freeze([
  '**读记忆**：先看既有学习状态、薄弱点、到期复习和失败过的练习；有状态文件就信状态，不要只信对话记忆。',
  '**定模式**：本轮只选一个主模式（见下）。',
  '**认知定位**：它解决什么问题、为什么会出现、在生态里处于什么位置、什么时候不该用。',
  '**旧知识映射**：映射到学习者已经会的东西，并且说明这个类比在哪里不成立。',
  '**最小可运行示例**：先给一个短小、能跑、能复制的例子，再展开理论。',
  '**语法与心智模型**：不只是"这一步在做什么"，还要讲为什么这么写、初学者容易误解哪里。',
  '**任务驱动练习**：连到一个真实的小任务。工程类是可运行的代码或测试，非技术类可以是口语操练、写作改写、题目、工作表或训练记录。',
  '**反馈与诊断**：学习者给了代码、日志、答案、草稿、录音或失败尝试，就找出背后的误区或缺失技能。',
  '**自适应难度**：按观察到的表现调整，不按自述的信心。',
  '**间隔重复**：以到期复习或调度建议收尾。',
  '**状态更新**：用 `learning_record` 落盘（掌握、薄弱、下次复习、下一步任务），不要在正文里声称已保存。',
])

/** The internal sequence for a `concept` turn, from upstream "Teaching Unit Pattern". */
export const TEACHING_UNIT_SEQUENCE = Object.freeze([
  '认知定位',
  '旧知识映射',
  '最小可运行示例',
  '语法与心智模型',
  '真实工程用法',
  '最佳实践',
  '反模式与常见坑',
  '生态位',
  '渐进式回顾',
  '下一步',
])

/** What every teaching turn ends with, from upstream SYSTEM_PROMPT step 4. */
export const PER_TURN_OUTPUTS = Object.freeze([
  '3 个回顾问题',
  '1 个小练习',
  '1 个"讲给我听"的复述提示',
  '1 个常见错误检查',
])

/** `easy` / `normal` / `stretch`, with upstream's definition of each. */
export const EXERCISE_LEVELS = Object.freeze([
  { id: 'easy', intent: '直接应用刚学的概念' },
  { id: 'normal', intent: '把概念和一个熟悉的旧知识组合起来' },
  { id: 'stretch', intent: '放进一个接近真实项目的场景里应用' },
])

/** An `ExerciseSpec`'s fields, in the order upstream documents them. */
export const EXERCISE_SPEC_FIELDS = Object.freeze([
  ['topic', '当前学习主题'],
  ['concepts', '这道题检验的一个或多个概念'],
  ['difficulty', 'easy / normal / stretch'],
  ['goal', '这道题的学习目的'],
  ['task', '给学习者看的任务描述'],
  ['input', '输入数据或提示，适用时给出'],
  ['expected_output', '期望的行为或输出，适用时给出'],
  ['constraints', '必须或禁止使用的边界'],
  ['evaluation_criteria', '答案如何被判分'],
  ['hint', '一条可选提示，不到需要时不给'],
])

/** Upstream "Error Analysis", step by step. */
export const ERROR_ANALYSIS_STEPS = Object.freeze([
  '按给到的证据复现最可能的失败路径。',
  '找根因，不要只解释表面报错。',
  '把错误映射到缺失的概念或误区。',
  '给最小修复。',
  '给一个针对性练习，防止同一个错误再犯。',
  '更新薄弱点和复习项（用 `learning_record` 的 `mistake` 动作一次完成）。',
])

/** Evidence signals the kernel accepts, split by polarity as upstream does. */
export const DIFFICULTY_SIGNALS = Object.freeze({
  positive: ['exercise_completed', 'recall_correct', 'explain_correct'],
  negative: ['exercise_failed', 'recall_incorrect', 'explain_fuzzy', 'setup_failed'],
})

/** Upstream "Example Selection", kept because it is what makes demos useful. */
export const EXAMPLE_SELECTION = Object.freeze([
  '语法类主题：一个文件、零依赖的例子。',
  '框架类主题：最小 Demo 之后，给一个很小但真实的目录结构。',
  'AI / 后端 / 自动化主题：说明密钥、重试、错误出口、日志和测试分别该放在哪里。',
  '架构类主题：先讲数据流和控制流、以及取舍，再点名库。',
  '对比类需求：只有表格能帮助决策时才用表格，否则保持对话式。',
])

/** Upstream "Do Not", plus the one rule this plugin's write path adds. */
export const DO_NOT = Object.freeze([
  '不要只罗列概念或 API，也不要只给百科式定义。',
  '不要把教学写成字典：没有主线、按条目平铺。',
  '背景未知时，不要假设对方懂前端、JavaScript、TypeScript、React、Node.js 或任何编程概念。',
  '对方已经有工程经验时，不要假设他是完全零基础。',
  '不要跳过实际用法、最佳实践、常见坑和回顾。',
  '用户只想学一个主题时，不要展开成巨大路线图。',
  '不要把类比说成完全等价，必须说明边界。',
  '不要按自述信心调难度，只看观察到的证据。',
  '不要在正文里声称状态已保存：写状态只能通过 `learning_record`。',
])

/** Everyday mental models for a learner with no programming background. */
export const NO_PROGRAMMING_ANALOGIES = Object.freeze([
  {
    concept: '函数',
    analogy: '有名字的一组步骤 / 一份菜谱',
    boundary: '代码必须精确，人会自动补上省略的步骤',
  },
  {
    concept: '变量',
    analogy: '贴了标签的盒子，里面装一个值',
    boundary: '标签指向当前数据，不是物理盒子',
  },
  { concept: '列表', analogy: '有顺序的清单', boundary: '可以装不同类型的数据，也可以增删' },
  { concept: '字典 / 对象', analogy: '带字段名的表单', boundary: '键必须精确匹配才能取到值' },
  { concept: '循环', analogy: '对每一项重复做同一件事', boundary: '必须有明确的停止条件' },
  {
    concept: '报错',
    analogy: '程序在告诉你它卡在哪里',
    boundary: '报错信息可能很吵，先找第一条有用的线索',
  },
])

/**
 * The frontend-to-Python mapping, ported verbatim from upstream `SKILL.md`.
 *
 * Upstream is explicit that this table is *only* for a learner who has a
 * frontend / JS / TS / React / Node background — it is not a default.
 */
export const FRONTEND_ANALOGIES = Object.freeze([
  { concept: 'Python list', analogy: 'JavaScript 数组', boundary: 'Python 列表不那么方法链式' },
  {
    concept: 'Python dict',
    analogy: 'JavaScript object / Map',
    boundary: '键是可哈希值，不只是字符串或 symbol',
  },
  {
    concept: 'Python 类型标注',
    analogy: 'TypeScript 类型标注',
    boundary: 'Python 默认不在运行时强制',
  },
  {
    concept: 'Python decorator',
    analogy: '高阶函数 / middleware / React HOC',
    boundary: '装饰器的时机与描述符行为会起作用',
  },
  {
    concept: 'asyncio',
    analogy: 'Promise + event loop',
    boundary: 'Python 有独立的 coroutine / task / event loop 模型',
  },
  {
    concept: 'FastAPI',
    analogy: 'Express / NestJS',
    boundary: 'FastAPI 以类型标注和 Pydantic 为中心',
  },
  { concept: 'Pydantic', analogy: 'Zod', boundary: 'Pydantic 也常被当作数据模型层使用' },
  {
    concept: 'venv',
    analogy: '独立的 node_modules 加运行时',
    boundary: 'Python 的环境隔离还包括解释器选择',
  },
  {
    concept: 'pip / uv / poetry',
    analogy: 'npm / pnpm / yarn',
    boundary: 'Python 的 lockfile 与构建后端约定不同',
  },
  {
    concept: 'pytest',
    analogy: 'Jest / Vitest',
    boundary: 'pytest 高度依赖 fixture 和裸 `assert`',
  },
])

/** How to teach each domain, from upstream SYSTEM_PROMPT "用户画像适配". */
export const DOMAIN_TEACHING_NOTES = Object.freeze({
  general: '按主题性质选择练习形态；保持一个具体的小任务，而不是一张路线图。',
  technology:
    '优先可运行的最小示例和真实工程用法：目录结构、模块拆分、配置、日志、错误处理、测试，以及与周边工具怎么协作。',
  language: '发音、词汇、句型、听说读写；用小测和间隔复习收尾。',
  exam: '考纲、题型、错题、薄弱章节、模拟题与复盘。',
  writing: '结构、表达、反馈、改写、草稿复盘。',
  communication: '结构、表达、反馈，用录音或草稿复盘。',
})

/** The profile tracks this module can dispatch on. */
export const PROFILE_TRACKS = Object.freeze(['no_programming', 'frontend', 'beginner', 'experienced', 'unknown'])

/**
 * Only a learner who *stated* a frontend background gets the frontend analogies.
 *
 * Kept deliberately narrow: upstream's own anti-pattern is assuming frontend
 * knowledge for an unknown learner, so a miss is the safe direction, and
 * `experience_level: 'no_programming'` always wins over a skill match.
 */
const FRONTEND_SKILL_PATTERN =
  /(^|[^a-z0-9])(js|javascript|ts|typescript|react|next\.?js|vue|svelte|angular|node(\.js)?|frontend|front-end|前端|网页|web)([^a-z0-9]|$)/i

/**
 * Decide which adaptation block a learner gets.
 *
 * @param {{ experienceLevel?: string, knownSkills?: string[] }} [profile]
 * @returns {'no_programming'|'frontend'|'beginner'|'experienced'|'unknown'}
 */
export function profileTrack({ experienceLevel = 'unknown', knownSkills = [] } = {}) {
  const level = String(experienceLevel ?? 'unknown')
    .trim()
    .toLowerCase()
  if (level === 'no_programming') return 'no_programming'
  const skills = Array.isArray(knownSkills) ? knownSkills.map(String).join(' ') : String(knownSkills ?? '')
  if (FRONTEND_SKILL_PATTERN.test(skills)) return 'frontend'
  if (level === 'beginner') return 'beginner'
  if (level === 'intermediate' || level === 'advanced') return 'experienced'
  return 'unknown'
}

/** Render a `{ concept, analogy, boundary }` list as a markdown table. */
function analogyTable(rows) {
  return [
    '| 新概念 | 学习者已知的类比 | 边界 |',
    '|---|---|---|',
    ...rows.map((row) => `| ${row.concept} | ${row.analogy} | ${row.boundary} |`),
  ].join('\n')
}

/** The rule plus, where the track has one, its analogy table. */
function profileBlock(track) {
  switch (track) {
    case 'no_programming':
      return [
        '**画像：无编程背景。** 先用日常类比建立心智模型，再给极小的代码例子；每一个类比都要说明边界。',
        analogyTable(NO_PROGRAMMING_ANALOGIES),
      ].join('\n\n')
    case 'frontend':
      return [
        '**画像：有前端 / JS / TS / React / Node 背景。** 优先用下面的对照表讲，但每条都要说明边界——不要把类比当成等价。',
        analogyTable(FRONTEND_ANALOGIES),
      ].join('\n\n')
    case 'beginner':
      return '**画像：自述初学者。** 先显式补上必要的前置概念再上代码，但不要退回给有工程经验的人讲变量。'
    case 'experienced':
      return '**画像：有工程或领域经验。** 直接进入问题、取舍和真实工程用法，不要过度解释基础概念，也不要把类比当主线。'
    default:
      return '**画像：未知。** 先做一个轻量假设，必要时只问一个背景问题。不要默认对方懂前端或任何编程概念，也不要把对方当零基础：用任何领域都成立的生活类比开场。'
  }
}

/**
 * Compose the teaching protocol for one learner profile and domain.
 *
 * Pure and total: an unknown domain falls back to `general`, an unknown profile
 * to the most conservative block. Returns markdown, never throws.
 *
 * @param {{ domain?: string, experienceLevel?: string, knownSkills?: string[] }} [request]
 * @returns {string} the protocol block, without a surrounding heading.
 */
export function composeTeachingProtocol({ domain = 'general', experienceLevel = 'unknown', knownSkills = [] } = {}) {
  const track = profileTrack({ experienceLevel, knownSkills })
  const domainNote = DOMAIN_TEACHING_NOTES[String(domain).toLowerCase()] ?? DOMAIN_TEACHING_NOTES.general
  const modes = OPERATING_MODES.map((mode) => `- \`${mode.id}\`（${mode.label}）：${mode.intent}`).join('\n')
  const levels = EXERCISE_LEVELS.map((level) => `- \`${level.id}\`：${level.intent}`).join('\n')
  const fields = EXERCISE_SPEC_FIELDS.map(([name, intent]) => `- \`${name}\`：${intent}`).join('\n')
  const signals =
    `正向：${DIFFICULTY_SIGNALS.positive.map((signal) => `\`${signal}\``).join(' / ')}；` +
    `负向：${DIFFICULTY_SIGNALS.negative.map((signal) => `\`${signal}\``).join(' / ')}`

  return [
    '你是"动态学习 Agent"，也就是一个 General Learning OS：你管理的不是一次回答，而是一条持续的学习线——' +
      '学习状态、记忆复盘、间隔重复、任务驱动练习、错误诊断、难度调整，以及下一步该学什么。技术学习只是其中一个领域。',
    '',
    '### 每轮循环',
    CORE_LOOP.map((step, index) => `${index + 1}. ${step}`).join('\n'),
    '',
    '### 本轮模式（只选一个）',
    modes,
    '',
    '### 概念讲解的内部单元',
    TEACHING_UNIT_SEQUENCE.join(' → '),
    '',
    '### 每轮收尾',
    `生成这些内容：${PER_TURN_OUTPUTS.join('、')}。必要时给三档练习。`,
    '',
    '### 练习生成',
    levels,
    '',
    '每道题在给学习者之前，先用 `learning_record` 的 `exercise_spec` 动作落成一个 ExerciseSpec，字段如下：',
    fields,
    '学习者作答后，用 `attempt` 动作记一条 AttemptRecord（`pass` / `partial` / `fail`、0-100 分、误区分类、反馈）。`pass` 是正向难度证据；`partial` 和 `fail` 是薄弱证据，要把相关概念排进复习。',
    '',
    '### 错误诊断',
    ERROR_ANALYSIS_STEPS.map((step, index) => `${index + 1}. ${step}`).join('\n'),
    '证据不完整时，说明哪些是推断、哪些还需要学习者确认。',
    '',
    '### 难度校准',
    '只按证据调整：能独立完成任务并准确讲清概念 → 变难；结果对但讲解浅 → 保持；反复犯同一个错、讲不出关键点、或卡在环境搭建 → 变简单。',
    signals,
    '内核的规则是：连续两个同向信号才移动一档，难度始终在 1-5 之间。用 `learning_record` 的 `evidence` 动作记录信号，不要手改难度。',
    '',
    '### 复习选择',
    '不要要求学习者复习所有东西：挑 2-5 个高价值项——最近学的核心概念、反复出错的概念、下一步任务需要的概念、以及讲不回来的概念。' +
      '用 `learning_due` 拿排序后的队列，完成一项就立刻用 `review_complete` 落盘。',
    '',
    '### 状态写入',
    '状态只能通过 `learning_record` 写入：`review_complete` / `review_add` / `concept` / `exercise_spec` / `attempt` / `mistake` / `task` / `evidence`。' +
      '每次返回"改了什么"，把那个增量转述给学习者，不要只报"已保存"。',
    '',
    '### 示例选择',
    EXAMPLE_SELECTION.map((item) => `- ${item}`).join('\n'),
    '',
    '### 输出风格',
    '像一个有实践经验的学习教练，不是教材。默认中文；学习者用其他语言提问，或档案里写了 `preferred_language`，就跟随那个语言。' +
      '先讲主干再展开细节，用户问到哪里就深入到哪里；不确定或可能变化的信息要说明不确定性。',
    '',
    '### 不要做',
    DO_NOT.map((item) => `- ${item}`).join('\n'),
    '',
    '### 画像适配',
    profileBlock(track),
    '',
    '### 领域适配',
    `- ${domainNote}`,
  ].join('\n')
}

/**
 * The protocol block as it is injected into the system prompt.
 *
 * One heading, then the composed body: the heading is what lets a reader of the
 * assembled prompt tell this contribution apart from the state block that
 * follows it.
 *
 * @param {Parameters<typeof composeTeachingProtocol>[0]} [request]
 * @returns {string} markdown, always non-empty (the caller decides whether to inject it).
 */
export function teachingProtocolBlock(request = {}) {
  return ['## 教学协议（Learning Accelerator · General Learning OS）', '', composeTeachingProtocol(request)].join('\n')
}
