/**
 * The model-facing tools.
 *
 * Design rules that come straight out of the harness tool contract
 * (`docs/cookbook/adding-a-tool.md`):
 *
 * - **One canonical JSON value per call.** `output.schema` is the programmatic
 *   API, so it returns the structured summary — not prose a caller would have to
 *   parse. Code Mode reaches the same value via `tools.learning_status(...)`.
 * - **`output.render` owns the model-facing prose.** Explanations live in the
 *   renderer, so the canonical value stays clean.
 * - **Write tools report what changed, not just "ok".** `learning_record`
 *   returns the touched review item, concept progress, and difficulty adjustment,
 *   because that delta is what the agent needs to phrase its state update.
 * - **Read paths never throw on malformed state.** A hand-edited state file must
 *   produce a repairable error payload, not a failed turn.
 *
 * @see ../../../Learning-Accelerator/references/learning_os_protocol.md
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

import { EXERCISE_DIFFICULTIES, SCHEMA_VERSION, stableId } from './learning-store.js'
import { teachingProtocolBlock } from './protocol.js'

/** Shared parameter node: where the state lives, when it is not the default. */
const STATE_FILE_PARAM = {
  type: 'string',
  description: 'Path to the learning state JSON file. Omit to use the session working directory\'s .learning/state.json.',
}

const SCOPE_PARAM = {
  type: 'string',
  enum: ['project', 'user'],
  description: "Which store to use: 'project' (default, ./.learning/state.json) or 'user' (~/.learning-accelerator/state.json).",
}

/**
 * Register every tool on `ctx`.
 *
 * `ctx.tools.register()` attaches its disposer to the calling plugin, so
 * unloading or hot-reloading this plugin unregisters all of them with no manual
 * bookkeeping.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @param {object} service - the `LearningAcceleratorService` instance.
 */
export function registerLearningTools(ctx, service) {
  /* ------------------------------------------------------------------ *
   * learning_status — the turn's entry point.
   * ------------------------------------------------------------------ */
  ctx.tools.register(defineTool({
    name: 'learning_status',
    description:
      'Read the learner profile, current topic, mastered and weak concepts, due and priority reviews, '
      + 'open exercise specs, recent attempts, current tasks, and difficulty. Call this first in any '
      + 'learning, review, practice, or calibration turn.',
    parameters: {
      state_file: STATE_FILE_PARAM,
      scope: SCOPE_PARAM,
      due_limit: { type: 'number', description: 'How many priority review items to include (default 5).' },
    },
    output: {
      schema: { type: 'json' },
      render(_args, value) {
        if (value.ok === false) {
          return [{
            type: 'text',
            text: `学习状态读取失败：${value.error}\n状态文件：\`${value.path || '未解析'}\`\n`
              + '如果文件是手工改坏的，先用 write 修回合法 JSON 再继续。',
          }]
        }
        const s = value.summary
        const line = (label, items) => `- ${label}：${items.length ? items.join('、') : '无'}`
        const lines = [
          `**状态文件**：\`${value.path}\`（来源：${value.source}）`,
          `**学习领域**：${s.learning_domain}　**难度**：${s.current_difficulty}/5（下一步 ${s.next_adjustment}）`,
          `**当前主题**：${s.current_topic || '未设置'}　**层级**：${s.level}`,
          `**学习目标**：${s.learning_goal || '未设置'}`,
          `**目标结果**：${s.target_outcome || '未设置'}`,
          '',
          line('已掌握', s.mastered_concepts),
          line('薄弱点', s.weak_concepts),
          line('到期复习', s.due_reviews.map(item => item.concept).filter(Boolean)),
          line('下一步任务', s.current_tasks.map(task => task.name)),
          '',
          s.priority_reviews.length
            ? `**优先复习**（${s.priority_reviews.length} 项）\n${s.priority_reviews.map(item => `- [${item.priority}] ${item.concept}（strength ${item.strength}）→ ${item.prompt}`).join('\n')}`
            : '**优先复习**：暂无',
          '',
          `**待做练习**：${s.exercise_specs.length} 个　**历史尝试**：${s.attempt_records.length} 条`,
        ]
        if (s.weak_concepts.length === 0 && s.mastered_concepts.length === 0 && !s.current_topic) {
          lines.push('', '状态几乎为空：如果用户还没有说明背景，先走 onboarding，用 `learning_session` 建档。')
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
      presentationMeta(_args, value) {
        return {
          title: 'learning_status',
          status: value?.ok === false ? 'error' : 'ok',
          path: value?.path ?? '',
          due: value?.summary?.due_reviews?.length ?? 0,
          weak: value?.summary?.weak_concepts?.length ?? 0,
        }
      },
    },
    async execute(args, exec) {
      const state = service.summarize({ stateFile: args.state_file, scope: args.scope, agent: exec.agent })
      if (state.ok === false) return { ...state, schema_version: SCHEMA_VERSION }
      const limit = Number.isFinite(args.due_limit) && args.due_limit >= 0 ? Math.trunc(args.due_limit) : 5
      return {
        ...state,
        schema_version: SCHEMA_VERSION,
        summary: {
          ...state.summary,
          priority_reviews: state.summary.priority_reviews.slice(0, limit),
        },
      }
    },
    presentCall() {
      return { card: 'generic', title: 'learning_status', kind: 'read' }
    },
    presentResult(args, result) {
      const text = result.content.map(block => (block.type === 'text' ? block.text : '')).join('')
      return { card: 'generic', title: 'learning_status', content: text, locations: args.state_file ? [{ path: args.state_file }] : undefined }
    },
  }))

  /* ------------------------------------------------------------------ *
   * learning_due — the review queue, ranked.
   * ------------------------------------------------------------------ */
  ctx.tools.register(defineTool({
    name: 'learning_due',
    description:
      'List spaced-repetition items that are due, ranked by weak-concept status, low strength, and repeated '
      + 'failures. Use it before teaching new material, or when the learner asks what to review.',
    parameters: {
      state_file: STATE_FILE_PARAM,
      scope: SCOPE_PARAM,
      on_date: { type: 'string', description: 'ISO date (YYYY-MM-DD) to treat as today. Defaults to the real today.' },
      limit: { type: 'number', description: 'Maximum items to return (default 5).' },
    },
    output: {
      schema: { type: 'json' },
      render(_args, value) {
        if (value.ok === false) {
          return [{ type: 'text', text: `无法读取学习状态：${value.error}\n状态文件：\`${value.path || '未解析'}\`` }]
        }
        if (value.items.length === 0) {
          return [{ type: 'text', text: `没有到期复习项（检查日期 ${value.on_date}，共 ${value.total_due} 项待复习）。` }]
        }
        const rows = value.items.map((item, index) => (
          `${index + 1}. **${item.concept}**（优先级 ${item.priority}，strength ${item.strength}，到期 ${item.due_at}）\n`
          + `   回述题：${item.prompt}`
        ))
        return [{
          type: 'text',
          text: `到期复习项（共 ${value.total_due} 项，返回前 ${value.items.length} 项）：\n\n${rows.join('\n')}\n\n`
            + '给用户出题时不要泄露答案；用户答完用 `learning_record` 记下 recall 结果。',
        }]
      },
      presentationMeta(_args, value) {
        return { title: 'learning_due', status: value?.ok === false ? 'error' : 'ok', count: value?.items?.length ?? 0 }
      },
    },
    async execute(args, exec) {
      const binding = service.storeFor({ stateFile: args.state_file, scope: args.scope, agent: exec.agent })
      const onDate = typeof args.on_date === 'string' && args.on_date.length > 0 ? args.on_date : undefined
      const limit = Number.isFinite(args.limit) && args.limit >= 0 ? Math.trunc(args.limit) : 5
      const all = binding.store.priorityReviews(onDate)
      return {
        ok: true,
        path: binding.path,
        source: binding.source,
        on_date: onDate ?? new Date().toISOString().slice(0, 10),
        total_due: binding.store.dueReviews(onDate).length,
        items: all.slice(0, limit),
      }
    },
    presentCall() {
      return { card: 'generic', title: 'learning_due', kind: 'search' }
    },
    presentResult(args, result) {
      const text = result.content.map(block => (block.type === 'text' ? block.text : '')).join('')
      return {
        card: 'generic',
        title: 'learning_due',
        content: text,
        locations: args.state_file ? [{ path: args.state_file }] : undefined,
      }
    },
  }))

  /* ------------------------------------------------------------------ *
   * learning_session — onboarding and profile edits.
   * ------------------------------------------------------------------ */
  ctx.tools.register(defineTool({
    name: 'learning_session',
    description:
      'Start or update a learning track: set the domain, known skills, experience level, goal, target outcome, '
      + 'current topic, constraints, and the next task. Returns the matching onboarding questions from the '
      + 'Learning-Accelerator domain template, plus the teaching protocol adapted to the profile it just saved. '
      + 'Use this for onboarding, or whenever the learner changes goals.',
    parameters: {
      state_file: STATE_FILE_PARAM,
      scope: SCOPE_PARAM,
      domain: {
        type: 'string',
        enum: ['general', 'technology', 'language', 'exam', 'writing', 'communication'],
        description: 'Learning domain, which selects the onboarding question set.',
      },
      known_skills: { type: 'array', items: { type: 'string' }, description: 'Skills, tools, or prior experience the learner already has.' },
      experience_level: {
        type: 'string',
        enum: ['unknown', 'no_programming', 'beginner', 'intermediate', 'advanced'],
        description: 'Declared or inferred experience level. "no_programming" is a valid, expected answer.',
      },
      learning_goal: { type: 'string', description: 'What the learner wants to achieve, in their own words.' },
      target_outcome: { type: 'string', description: 'The concrete artifact or result that would prove success.' },
      current_topic: { type: 'string', description: 'The single topic this track is on right now.' },
      level: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'], description: 'Difficulty level of the current topic.' },
      constraint: { type: 'string', description: 'One constraint to record, such as time budget or forbidden tools.' },
      next_task: { type: 'string', description: 'One concrete next task to queue for the learner.' },
      preferred_language: { type: 'string', description: 'Language to teach in, such as zh-CN or en.' },
    },
    output: {
      schema: { type: 'json' },
      render(_args, value) {
        const changed = value.changed.length ? value.changed.join('、') : '无'
        const questions = value.onboarding_questions.onboarding_questions.map((question, index) => `${index + 1}. ${question}`).join('\n')
        return [{
          type: 'text',
          text: `已更新学习档案（\`${value.path}\`）：${changed}\n\n`
            + `当前主题：${value.summary.current_topic || '未设置'}　目标：${value.summary.learning_goal || '未设置'}\n\n`
            + `**${value.onboarding_questions.domain} 领域 onboarding 问题**\n${questions}\n\n`
            + '不要一次问完所有问题：从中挑最关键的 1-2 个，先确认背景再开始教。\n\n'
            // The first turn of a track has no state file yet, so the prompt
            // context is still silent; onboarding is where the method has to
            // arrive instead. Later turns get it injected and can ignore this.
            + (value.teaching_protocol ?? ''),
        }]
      },
      presentationMeta(_args, value) {
        return { title: 'learning_session', status: 'ok', path: value?.path ?? '', domain: value?.onboarding_questions?.domain ?? '' }
      },
    },
    async execute(args, exec) {
      const binding = service.storeFor({ stateFile: args.state_file, scope: args.scope, agent: exec.agent })
      const store = binding.store
      const changed = []

      const profile = {}
      if (args.domain) { profile.learning_domain = args.domain; changed.push('domain') }
      if (args.known_skills) { profile.known_stack = args.known_skills; profile.known_skills = args.known_skills; changed.push('known_skills') }
      if (args.experience_level) { profile.experience_level = args.experience_level; changed.push('experience_level') }
      if (args.learning_goal !== undefined) { profile.learning_goal = args.learning_goal; changed.push('learning_goal') }
      if (args.target_outcome !== undefined) { profile.target_outcome = args.target_outcome; changed.push('target_outcome') }
      if (args.preferred_language) { profile.preferred_language = args.preferred_language; changed.push('preferred_language') }
      if (args.constraint) { profile.constraint = args.constraint; changed.push('constraint') }
      if (Object.keys(profile).length > 0) store.updateProfile(profile)

      if (args.current_topic) {
        store.setTopic(args.current_topic, args.level)
        changed.push('current_topic')
      } else if (args.level) {
        store.setTopic(store.load().topic_state.current_topic, args.level)
        changed.push('level')
      }
      if (args.next_task) { store.addTask(args.next_task); changed.push('next_task') }

      const domain = args.domain ?? store.load().learner_profile.learning_domain ?? 'general'
      // Compose from what is now on disk, not from the arguments: a partial
      // update must still produce a protocol that matches the saved profile.
      const saved = store.load().learner_profile ?? {}
      return {
        ok: true,
        path: binding.path,
        source: binding.source,
        changed,
        summary: store.summary(),
        onboarding_questions: store.onboardingQuestions(domain),
        teaching_protocol: teachingProtocolBlock({
          domain,
          experienceLevel: saved.experience_level ?? 'unknown',
          knownSkills: saved.known_skills ?? saved.known_stack ?? [],
        }),
      }
    },
    presentCall() {
      return { card: 'generic', title: 'learning_session', kind: 'write' }
    },
    presentResult(args, result) {
      const text = result.content.map(block => (block.type === 'text' ? block.text : '')).join('')
      return { card: 'generic', title: 'learning_session', content: text, locations: args.state_file ? [{ path: args.state_file }] : undefined }
    },
  }))

  /* ------------------------------------------------------------------ *
   * learning_record — the single write path.
   * ------------------------------------------------------------------ */
  ctx.tools.register(defineTool({
    name: 'learning_record',
    description:
      'Record one learning event and persist it: complete a spaced-repetition review, create a review item, '
      + 'mark a concept mastered or weak, register an exercise spec, record an exercise attempt, log a mistake '
      + 'or code error, queue a next task, or record a raw difficulty signal. Always use this instead of claiming '
      + 'in prose that state was saved.',
    parameters: {
      state_file: STATE_FILE_PARAM,
      scope: SCOPE_PARAM,
      action: {
        type: 'string',
        enum: [
          'review_complete',
          'review_add',
          'concept',
          'exercise_spec',
          'attempt',
          'mistake',
          'task',
          'evidence',
        ],
        required: true,
        description:
          'review_complete: finish a due item by id. review_add: schedule a new item. concept: set mastered/weak. '
          + 'exercise_spec: store a generated exercise. attempt: record an answer to a stored exercise. '
          + 'mistake: log a diagnosed error and queue its concepts. task: queue a next task. evidence: record a raw signal.',
      },
      review_id: { type: 'string', description: 'review_complete: the item id from learning_due.' },
      result: {
        type: 'string',
        enum: ['correct', 'second_correct', 'third_correct', 'incorrect', 'fuzzy'],
        description: 'review_complete / review_add: recall outcome. correct=1d, second_correct=3d, third_correct=7d, fuzzy/incorrect=re-queue now.',
      },
      attempt_result: {
        type: 'string',
        enum: ['pass', 'partial', 'fail'],
        description: 'attempt: how the learner did. pass=100% clean, partial=mixed, fail=did not work.',
      },
      concept: { type: 'string', description: 'review_add / concept / mistake: the concept name.' },
      prompt: { type: 'string', description: 'review_add: the recall question.' },
      status: { type: 'string', enum: ['mastered', 'weak'], description: 'concept: which list the concept belongs in.' },
      notes: { type: 'string', description: 'review_complete / task / mistake: free-form notes.' },
      topic: { type: 'string', description: 'exercise_spec: the topic of the exercise.' },
      concepts: { type: 'array', items: { type: 'string' }, description: 'exercise_spec / mistake: concepts this event covers.' },
      difficulty: { type: 'string', enum: [...EXERCISE_DIFFICULTIES], description: 'exercise_spec: easy, normal, or stretch.' },
      task: { type: 'string', description: 'exercise_spec: the learner-facing task. task: the task to queue.' },
      goal: { type: 'string', description: 'exercise_spec: what the exercise tests.' },
      expected_output: { type: 'string', description: 'exercise_spec: expected behavior.' },
      constraints: { type: 'array', items: { type: 'string' }, description: 'exercise_spec: required boundaries.' },
      evaluation_criteria: { type: 'array', items: { type: 'string' }, description: 'exercise_spec: how the answer is judged.' },
      hint: { type: 'string', description: 'exercise_spec: one optional hint, hidden until needed.' },
      exercise_id: { type: 'string', description: 'attempt: the id returned by exercise_spec.' },
      answer: { type: 'string', description: 'attempt: the learner answer, or a faithful summary of it.' },
      score: { type: 'number', description: 'attempt: 0-100.' },
      mistake_type: { type: 'string', description: 'attempt / mistake: misconception category.' },
      feedback: { type: 'string', description: 'attempt / mistake: concise evaluator feedback.' },
      signal: {
        type: 'string',
        enum: ['exercise_completed', 'exercise_failed', 'recall_correct', 'recall_incorrect', 'explain_correct', 'explain_fuzzy', 'setup_failed'],
        description: 'evidence: raw difficulty signal. Two same-polarity signals in a row move difficulty one step.',
      },
      detail: { type: 'string', description: 'evidence: what the signal refers to.' },
    },
    output: {
      schema: { type: 'json' },
      render(_args, value) {
        if (value.ok === false) {
          return [{ type: 'text', text: `记录失败：${value.error}` }]
        }
        const lines = [`已写入 \`${value.path}\`：${value.action}`]
        if (value.review) {
          lines.push(`- 复习项：${value.review.concept} → ${value.review.due_at}（${value.review.result}）`)
        }
        if (value.exercise) {
          lines.push(`- 练习 id：\`${value.exercise.id}\`（${value.exercise.difficulty}）${value.exercise.task}`)
        }
        if (value.attempt) {
          lines.push(`- 尝试：${value.attempt.result}（${value.attempt.score}）${value.attempt.feedback || ''}`)
        }
        if (value.concept_progress) {
          lines.push(`- 概念进度 ${value.concept}：strength=${value.concept_progress.strength} streak=${value.concept_progress.correct_streak} failures=${value.concept_progress.failure_count} 下次 ${value.concept_progress.next_due_at}`)
        }
        if (value.difficulty) {
          lines.push(`- 难度：${value.difficulty.current_difficulty}/5（下一步 ${value.difficulty.next_adjustment}）`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
      presentationMeta(_args, value) {
        return { title: 'learning_record', status: value?.ok === false ? 'error' : 'ok', action: value?.action ?? '', path: value?.path ?? '' }
      },
    },
    async execute(args, exec) {
      const binding = service.storeFor({ stateFile: args.state_file, scope: args.scope, agent: exec.agent })
      const store = binding.store
      const payload = { ok: true, path: binding.path, source: binding.source, action: args.action }

      switch (args.action) {
        case 'review_complete': {
          if (!args.review_id) throw new Error('review_complete requires review_id')
          const result = args.result ?? 'correct'
          const state = store.completeReview(args.review_id, { result, notes: args.notes ?? '' })
          const history = state.review_state.review_history.at(-1)
          payload.review = { id: history.id, concept: history.concept, prompt: history.prompt, result, due_at: history.due_at }
          payload.concept = history.concept
          payload.concept_progress = state.topic_state.concept_progress?.[history.concept]
          payload.difficulty = state.difficulty_state
          break
        }
        case 'review_add': {
          if (!args.concept) throw new Error('review_add requires concept')
          const result = args.result ?? 'correct'
          const prompt = args.prompt ?? `Review ${args.concept}`
          const state = store.addReview(args.concept, prompt, result, 'manual')
          // The store derives the id deterministically, so recomputing it here
          // reads back exactly the row just written rather than guessing.
          const reviewId = stableId('review', args.concept, prompt)
          payload.review = state.review_state.next_review_items.find(entry => entry.id === reviewId)
            ?? state.review_state.next_review_items.at(-1)
          payload.concept = args.concept
          payload.concept_progress = state.topic_state.concept_progress?.[args.concept]
          payload.difficulty = state.difficulty_state
          break
        }
        case 'concept': {
          if (!args.concept) throw new Error('concept requires concept')
          if (!args.status) throw new Error('concept requires status')
          const state = store.recordConcept(args.concept, args.status)
          payload.concept = args.concept
          payload.concept_progress = state.topic_state.concept_progress?.[args.concept]
          payload.mastered_concepts = state.topic_state.mastered_concepts
          payload.weak_concepts = state.topic_state.weak_concepts
          break
        }
        case 'exercise_spec': {
          const topic = args.topic ?? store.load().topic_state.current_topic
          const concepts = args.concepts ?? []
          const difficulty = args.difficulty ?? 'normal'
          const task = args.task ?? ''
          store.addExerciseSpec({
            topic,
            concepts,
            difficulty,
            task,
            goal: args.goal,
            expected_output: args.expected_output ?? '',
            constraints: args.constraints ?? [],
            evaluation_criteria: args.evaluation_criteria ?? [],
            hint: args.hint ?? '',
          })
          // Mirror the store's deterministic id derivation to read the row back.
          const specId = stableId('exercise-spec', String(topic ?? '').trim(), concepts.map(String).join(','), difficulty, task.trim())
          payload.exercise = store.exerciseSpec(specId)
          break
        }
        case 'attempt': {
          if (!args.exercise_id) throw new Error('attempt requires exercise_id')
          if (!args.attempt_result) throw new Error('attempt requires attempt_result (pass, partial, or fail)')
          if (!Number.isInteger(args.score)) throw new Error('attempt requires an integer score from 0 to 100')
          // The store's attempt vocabulary is pass/fail only; `partial` is a
          // model-facing nuance that still counts as a failure for scheduling.
          const attemptResult = args.attempt_result === 'pass' ? 'pass' : 'fail'
          const state = store.recordAttempt(args.exercise_id, {
            user_answer: args.answer ?? '',
            result: attemptResult,
            score: args.score,
            mistake_type: args.mistake_type ?? '',
            feedback: args.feedback ?? '',
            concepts_to_review: args.concepts,
          })
          payload.attempt = { ...state.practice_state.attempt_records.at(-1), outcome: args.attempt_result }
          const firstConcept = (args.concepts ?? [])[0]
          if (firstConcept) {
            payload.concept = firstConcept
            payload.concept_progress = state.topic_state.concept_progress?.[firstConcept]
          }
          payload.difficulty = state.difficulty_state
          break
        }
        case 'mistake': {
          const concepts = (args.concepts ?? (args.concept ? [args.concept] : [])).filter(Boolean)
          if (concepts.length === 0) throw new Error('mistake requires concept or concepts')
          const detail = args.feedback || args.notes || args.mistake_type || ''
          const state = store.load()
          state.practice_state.last_code_errors = [
            ...(state.practice_state.last_code_errors ?? []),
            {
              id: `${Date.now().toString(36)}-${concepts.join('-')}`,
              concept: concepts[0],
              concepts,
              mistake_type: args.mistake_type ?? '',
              detail,
              recorded_at: new Date().toISOString().slice(0, 10),
            },
          ].slice(-20)
          store.save(state)
          for (const concept of concepts) {
            store.recordConcept(concept, 'weak')
            store.addReview(concept, `复盘错误：${concept}${detail ? ` — ${detail}` : ''}`, 'incorrect', 'diagnosis')
            store.recordEvidence('explain_fuzzy', `${concept}: ${detail}`)
          }
          payload.concepts = concepts
          payload.difficulty = store.load().difficulty_state
          break
        }
        case 'task': {
          if (!args.task) throw new Error('task requires task')
          const state = store.addTask(args.task, args.notes ?? '')
          payload.task = state.practice_state.current_tasks.at(-1)
          break
        }
        case 'evidence': {
          if (!args.signal) throw new Error('evidence requires signal')
          const state = store.recordEvidence(args.signal, args.detail ?? args.feedback ?? '')
          payload.difficulty = state.difficulty_state
          payload.evidence = state.difficulty_state.evidence.at(-1)
          break
        }
        default:
          throw new Error(`unknown action: ${args.action}`)
      }

      payload.summary = service.summarize({ stateFile: binding.path, scope: binding.scope })
      return payload
    },
    presentCall(args) {
      return { card: 'generic', title: `learning_record · ${args.action}`, kind: 'write' }
    },
    presentResult(args, result) {
      const text = result.content.map(block => (block.type === 'text' ? block.text : '')).join('')
      return { card: 'generic', title: `learning_record · ${args.action}`, content: text, locations: args.state_file ? [{ path: args.state_file }] : undefined }
    },
  }))

  /* ------------------------------------------------------------------ *
   * learning_domain — static templates, no state required.
   * ------------------------------------------------------------------ */
  ctx.tools.register(defineTool({
    name: 'learning_domain',
    description:
      'Return the Learning-Accelerator template for a learning domain: focus areas, practice types, review '
      + 'strategy, and the onboarding questions to ask, together with the teaching protocol for that domain. '
      + 'Use it when starting a new track in a domain you have not onboarded into yet.',
    parameters: {
      domain: {
        type: 'string',
        enum: ['general', 'technology', 'language', 'exam', 'writing', 'communication'],
        description: 'The domain to describe. Omit for general.',
      },
    },
    output: {
      schema: { type: 'json' },
      render(_args, value) {
        return [{
          type: 'text',
          text: `**领域**：${value.domain}\n`
            + `**重点**：${value.focus_areas.join('、')}\n`
            + `**练习形式**：${value.practice_types.join('、')}\n`
            + `**复习策略**：${value.review_strategy}\n\n`
            + `**Onboarding 问题**\n${value.onboarding_questions.map((question, index) => `${index + 1}. ${question}`).join('\n')}\n\n`
            // This tool works with no state file at all, which is exactly when
            // the prompt-context block is silent. Carrying the method here is
            // what makes "teach me X" in a fresh directory arrive protocol-first.
            + (value.teaching_protocol ?? ''),
        }]
      },
      presentationMeta(_args, value) {
        return { title: 'learning_domain', status: 'ok', domain: value?.domain ?? '' }
      },
    },
    async execute(args) {
      const { LearningStore } = await import('./learning-store.js')
      const template = LearningStore.domainTemplate(args.domain ?? 'general')
      // No state is read here on purpose: this tool must answer in a directory
      // that has never had a learner, so the protocol is composed for the
      // domain with the conservative unknown-profile adaptation.
      return {
        domain: template.domain,
        ...template,
        teaching_protocol: teachingProtocolBlock({ domain: template.domain }),
      }
    },
    presentCall() {
      return { card: 'generic', title: 'learning_domain', kind: 'read' }
    },
    presentResult(_args, result) {
      const text = result.content.map(block => (block.type === 'text' ? block.text : '')).join('')
      return { card: 'generic', title: 'learning_domain', content: text }
    },
  }))
}
