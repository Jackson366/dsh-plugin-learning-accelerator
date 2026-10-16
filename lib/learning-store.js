/**
 * Pure-JavaScript port of Learning-Accelerator's `learning_accelerator/state.py`.
 *
 * Why a port and not a subprocess call: the DSH host side must work in the
 * packaged desktop app, where no Python interpreter and no repository checkout
 * are guaranteed. This module therefore carries the whole state kernel itself,
 * uses only Node builtins, and stays byte-compatible with the Python store
 * (`json.dumps(..., ensure_ascii=False, indent=2, sort_keys=True)`) so the same
 * `.learning/state.json` can be read and written by the bundled Python CLI.
 *
 * @see ../../Learning-Accelerator/learning_accelerator/state.py
 * @see ../../Learning-Accelerator/references/learning_os_protocol.md
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'

/** Persisted schema version; must equal the Python `SCHEMA_VERSION`. */
export const SCHEMA_VERSION = 1

/** Default project-relative state file, matching AGENTS.md / CLAUDE.md. */
export const PROJECT_STATE_RELATIVE = '.learning/state.json'

/** Default user-level state file, matching the Python CLI default. */
export function userStateFile(home = process.env.HOME ?? process.env.USERPROFILE ?? '.') {
  return join(home, '.learning-accelerator', 'state.json')
}

/** Raised when persisted learning-state data is malformed. */
export class LearningStateError extends Error {
  constructor(message) {
    super(message)
    this.name = 'LearningStateError'
  }
}

/** Spaced-repetition intervals in days, keyed by recall result. */
export const REVIEW_INTERVALS_BY_RESULT = Object.freeze({
  correct: 1,
  second_correct: 3,
  third_correct: 7,
  incorrect: 0,
  fuzzy: 0,
})

/** Result values accepted by {@link createReviewItem}. */
export const REVIEW_RESULTS = Object.freeze(Object.keys(REVIEW_INTERVALS_BY_RESULT))

/** Difficulty evidence signals that push the next task harder. */
export const POSITIVE_DIFFICULTY_SIGNALS = Object.freeze([
  'exercise_completed',
  'explain_correct',
  'recall_correct',
])

/** Difficulty evidence signals that push the next task easier. */
export const NEGATIVE_DIFFICULTY_SIGNALS = Object.freeze([
  'exercise_failed',
  'recall_incorrect',
  'explain_fuzzy',
  'setup_failed',
])

/** Exercise difficulty levels, in ascending order. */
export const EXERCISE_DIFFICULTIES = Object.freeze(['easy', 'normal', 'stretch'])

/** Attempt outcomes accepted by {@link LearningStore#recordAttempt}. */
export const ATTEMPT_RESULTS = Object.freeze(['pass', 'partial', 'fail'])

/** Concept statuses accepted by {@link LearningStore#recordConcept}. */
export const CONCEPT_STATUSES = Object.freeze(['mastered', 'weak'])

/** Topic levels accepted by the schema validator. */
export const TOPIC_LEVELS = Object.freeze(['beginner', 'intermediate', 'advanced'])

/** Experience levels accepted by {@link LearningStore#updateProfile}. */
export const EXPERIENCE_LEVELS = Object.freeze([
  'unknown',
  'no_programming',
  'beginner',
  'intermediate',
  'advanced',
])

/** Learner domains accepted by the bundled CLI, mapped to onboarding templates. */
export const DOMAIN_TEMPLATES = Object.freeze({
  general: {
    domain: 'general',
    focus_areas: ['核心概念', '薄弱点', '练习', '复习'],
    practice_types: ['解释复述', '小练习', '真实任务', '回顾问题'],
    review_strategy: 'Select 2-5 weak or recently learned items for spaced repetition.',
    onboarding_questions: [
      '你想学习什么主题？',
      '你现在熟悉哪些技能、工具或相关经验？',
      '你希望达到什么具体结果？',
      '你每天或每周能投入多少时间？',
    ],
  },
  technology: {
    domain: 'technology',
    focus_areas: ['概念', '语法/API', '工程实践', '调试', '测试'],
    practice_types: ['代码', '小项目', '调试练习', '架构解释'],
    review_strategy: 'Review concepts, common mistakes, and project decisions.',
    onboarding_questions: [
      '你想学哪门语言、框架、工具或架构？',
      '你现在熟悉哪些技术栈？',
      '你想做出什么可运行成果？',
      '你更想概念入门、项目实战还是错误诊断？',
    ],
  },
  language: {
    domain: 'language',
    focus_areas: ['发音', '词汇', '句型', '听说读写', '文化语境'],
    practice_types: ['跟读', '听写', '造句', '翻译', '小测'],
    review_strategy: 'Review weak vocabulary, sentence patterns, pronunciation, and recent mistakes.',
    onboarding_questions: [
      '你想学习什么主题或哪门语言？',
      '你的目标是日常交流、考试、阅读还是写作？',
      '你现在熟悉哪些语言或发音体系？',
      '你每天能练多久？',
    ],
  },
  exam: {
    domain: 'exam',
    focus_areas: ['考纲', '题型', '错题', '薄弱章节', '时间管理'],
    practice_types: ['专项题', '模拟题', '错题复盘', '限时练习'],
    review_strategy: 'Review wrong answers, repeated weak chapters, and high-frequency exam patterns.',
    onboarding_questions: [
      '你准备什么考试？',
      '考试日期或目标分数是什么？',
      '你目前最薄弱的题型或章节是什么？',
      '你每周能安排几次练习？',
    ],
  },
  writing: {
    domain: 'writing',
    focus_areas: ['结构', '观点', '语言', '修改', '读者反馈'],
    practice_types: ['短文', '改写', '提纲', '段落练习', '复盘'],
    review_strategy: 'Review repeated writing issues, structure patterns, and revised drafts.',
    onboarding_questions: [
      '你想提升哪类写作？',
      '你现在常遇到的问题是什么？',
      '有没有目标读者或发表场景？',
      '你愿意每次写多少字？',
    ],
  },
  communication: {
    domain: 'communication',
    focus_areas: ['结构化表达', '听众意识', '临场反应', '语速', '反馈'],
    practice_types: ['60 秒表达', '录音复盘', '演讲提纲', '问答模拟'],
    review_strategy: 'Review structure, repeated hesitations, unclear points, and feedback notes.',
    onboarding_questions: [
      '你想提升公开演讲、汇报、面试还是日常沟通？',
      '你最容易卡在哪一步？',
      '你是否愿意录音或写提纲复盘？',
      '你希望达到什么具体场景结果？',
    ],
  },
})

/** The forward-compatible empty state, mirroring the Python `DEFAULT_STATE`. */
export function defaultState() {
  return {
    schema_version: SCHEMA_VERSION,
    learner_profile: {
      learning_domain: 'general',
      known_stack: [],
      known_skills: [],
      preferred_language: 'zh-CN',
      experience_level: 'unknown',
      learning_goal: '',
      target_outcome: '',
      target_project: '',
      constraints: [],
    },
    topic_state: {
      current_topic: '',
      level: 'beginner',
      mastered_concepts: [],
      weak_concepts: [],
      concept_progress: {},
      misconceptions: [],
      open_questions: [],
    },
    practice_state: {
      exercise_specs: [],
      attempt_records: [],
      completed_exercises: [],
      failed_exercises: [],
      current_tasks: [],
      current_project_tasks: [],
      last_code_errors: [],
    },
    review_state: {
      due_items: [],
      next_review_items: [],
      review_history: [],
    },
    difficulty_state: {
      current_difficulty: 1,
      evidence: [],
      next_adjustment: 'same',
    },
  }
}

/* ------------------------------------------------------------------ *
 * Pure helpers — kept module-private so the exported surface stays the
 * store's public API, exactly as the Python module keeps them private.
 * ------------------------------------------------------------------ */

/** Today in local time as `YYYY-MM-DD`, matching Python `date.today()`. */
export function todayIso(now = new Date()) {
  const year = String(now.getFullYear()).padStart(4, '0')
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Add whole days to an ISO calendar date, matching Python `timedelta`. */
function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split('-').map(Number)
  // Date.UTC keeps the arithmetic DST-free; the value is read back in UTC.
  const base = Date.UTC(year, month - 1, day) + days * 86_400_000
  const next = new Date(base)
  return todayIso({
    getFullYear: () => next.getUTCFullYear(),
    getMonth: () => next.getUTCMonth(),
    getDate: () => next.getUTCDate(),
  })
}

/** Structural clone for plain JSON data. */
function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

/** Python's `_deep_merge`: loaded scalars and lists win, objects merge. */
function deepMerge(base, loaded) {
  const merged = clone(base)
  if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) return merged
  for (const [key, value] of Object.entries(loaded)) {
    const current = merged[key]
    if (value && typeof value === 'object' && !Array.isArray(value)
      && current && typeof current === 'object' && !Array.isArray(current)) {
      merged[key] = deepMerge(current, value)
    } else {
      merged[key] = clone(value)
    }
  }
  return merged
}

/** Python's `_ensure_list`: absent becomes empty, non-list is malformed. */
function ensureList(value, fieldName) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new LearningStateError(`${fieldName} must be a list`)
  return value
}

/** Stable 12-hex-char id, byte-identical to Python's `_stable_id`. */
export function stableId(...parts) {
  const normalized = parts.map(part => String(part).trim().toLowerCase()).join('\n')
  return createHash('sha1').update(normalized, 'utf8').digest('hex').slice(0, 12)
}

/** Python's `_upsert_by_id`: merge by `id`, else append. */
function upsertById(items, item) {
  const index = items.findIndex(existing => existing?.id === item.id)
  if (index >= 0) {
    items[index] = { ...items[index], ...item }
    return items
  }
  items.push(item)
  return items
}

/** Deterministic key order for byte-compatible `sort_keys=True` output. */
function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = sortKeysDeep(value[key])
    return out
  }
  return value
}

/* ------------------------------------------------------------------ *
 * Review / exercise constructors — the free-function half of the port.
 * ------------------------------------------------------------------ */

/**
 * Create a review item using the default spaced-repetition intervals.
 * @param {string} concept - the concept under review.
 * @param {string} prompt - the recall prompt shown to the learner.
 * @param {keyof typeof REVIEW_INTERVALS_BY_RESULT} [result] - recall outcome.
 * @param {string} [source] - where the item came from (`manual`, `attempt`, …).
 * @param {string} [today] - ISO date override, for deterministic tests.
 */
export function createReviewItem(concept, prompt, result = 'correct', source = 'manual', today) {
  if (!Object.hasOwn(REVIEW_INTERVALS_BY_RESULT, result)) {
    throw new LearningStateError(`result must be one of: ${REVIEW_RESULTS.slice().sort().join(', ')}`)
  }
  const baseDay = today ?? todayIso()
  return {
    id: stableId('review', concept, prompt),
    concept,
    prompt,
    source,
    result,
    created_at: baseDay,
    due_at: addDays(baseDay, REVIEW_INTERVALS_BY_RESULT[result]),
  }
}

/**
 * Create a structured exercise specification for agent-generated practice.
 * The model drafts the task, hint, and criteria; the store owns the stable id.
 */
export function createExerciseSpec({
  topic,
  concepts,
  difficulty,
  task,
  goal,
  input = '',
  expected_output = '',
  constraints = [],
  evaluation_criteria = [],
  hint = '',
  created_at,
}) {
  if (!EXERCISE_DIFFICULTIES.includes(difficulty)) {
    throw new LearningStateError(`difficulty must be one of: ${EXERCISE_DIFFICULTIES.slice().sort().join(', ')}`)
  }
  if (!String(task ?? '').trim()) throw new LearningStateError('task must not be empty')
  const cleanConcepts = (concepts ?? []).map(concept => String(concept).trim()).filter(Boolean)
  if (cleanConcepts.length === 0) throw new LearningStateError('concepts must contain at least one concept')
  const cleanTask = String(task).trim()
  return {
    id: stableId('exercise-spec', topic, cleanConcepts.join(','), difficulty, cleanTask),
    topic: String(topic ?? '').trim(),
    concepts: cleanConcepts,
    difficulty,
    goal: (goal ? String(goal).trim() : `Practice ${cleanConcepts.join(', ')}`),
    task: cleanTask,
    input,
    expected_output,
    constraints,
    evaluation_criteria,
    hint,
    created_at: created_at ?? todayIso(),
  }
}

/* ------------------------------------------------------------------ *
 * The store
 * ------------------------------------------------------------------ */

/**
 * Read and write Learning-Accelerator state in a local JSON file.
 *
 * Mirrors `JsonStateStore` from the Python package method for method, including
 * its error messages and its `sort_keys=True, indent=2` on-disk format.
 */
export class LearningStore {
  /** @param {string} path - absolute or `~`-relative path to `state.json`. */
  constructor(path) {
    if (typeof path !== 'string' || path.length === 0) {
      throw new LearningStateError('state file path must be a non-empty string')
    }
    this.path = expandHome(path)
  }

  /**
   * Resolve the state file for one learning scope.
   * @param {{ scope?: 'project' | 'user', cwd?: string, home?: string }} [options]
   * @returns {LearningStore} a store bound to the resolved path.
   */
  static resolve({ scope = 'project', cwd, home } = {}) {
    if (scope === 'user') return new LearningStore(userStateFile(home))
    const root = cwd ? resolve(expandHome(cwd)) : process.cwd()
    return new LearningStore(join(root, PROJECT_STATE_RELATIVE))
  }

  /** Whether the state file already exists on disk. */
  get exists() {
    return existsSync(this.path)
  }

  /** Load state from disk, returning the default schema if absent. */
  load() {
    if (!existsSync(this.path)) return defaultState()
    let raw
    try {
      raw = JSON.parse(readFileSync(this.path, 'utf8'))
    } catch (error) {
      throw new LearningStateError(`Invalid JSON in ${this.path}: ${error.message}`)
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new LearningStateError('Learning state root must be an object')
    }
    return LearningStore.validate(LearningStore.migrate(deepMerge(defaultState(), raw)))
  }

  /** Validate and persist state, creating parent directories as needed. */
  save(state) {
    const validated = LearningStore.validate(state)
    mkdirSync(dirname(this.path), { recursive: true })
    const text = `${JSON.stringify(sortKeysDeep(validated), null, 2)}\n`
    // Write-then-rename keeps a concurrent reader from seeing a half-written file.
    const temporary = `${this.path}.tmp-${process.pid}`
    writeFileSync(temporary, text, 'utf8')
    renameSync(temporary, this.path)
    return validated
  }

  /** Overwrite the store with a fresh default state. */
  reset() {
    return this.save(defaultState())
  }

  /** Seed the learner profile; only the supplied fields change. */
  updateProfile({
    learning_domain,
    known_stack,
    known_skills,
    preferred_language,
    experience_level,
    learning_goal,
    target_outcome,
    target_project,
    constraint,
  } = {}) {
    const state = this.load()
    const profile = state.learner_profile
    if (learning_domain) profile.learning_domain = learning_domain
    if (known_stack !== undefined) {
      profile.known_stack = known_stack
      if (known_skills === undefined) profile.known_skills = known_stack
    }
    if (known_skills !== undefined) profile.known_skills = known_skills
    if (preferred_language) profile.preferred_language = preferred_language
    if (experience_level) {
      if (!EXPERIENCE_LEVELS.includes(experience_level)) {
        throw new LearningStateError(`experience_level must be ${EXPERIENCE_LEVELS.join(', ')}`)
      }
      profile.experience_level = experience_level
    }
    if (learning_goal !== undefined) profile.learning_goal = learning_goal
    if (target_outcome !== undefined) {
      profile.target_outcome = target_outcome
      profile.target_project = target_outcome
    }
    if (target_project !== undefined) {
      profile.target_project = target_project
      if (target_outcome === undefined) profile.target_outcome = target_project
    }
    if (constraint) {
      const constraints = ensureList(profile.constraints, 'constraints')
      if (!constraints.includes(constraint)) constraints.push(constraint)
      profile.constraints = constraints
    }
    return this.save(state)
  }

  /** Add a current learning task, keeping legacy project-task compatibility. */
  addTask(name, notes = '') {
    const state = this.load()
    const practice = state.practice_state
    const tasks = ensureList(practice.current_tasks, 'current_tasks')
    const item = {
      id: stableId('task', name),
      name,
      notes,
      status: 'pending',
      created_at: todayIso(),
    }
    const index = tasks.findIndex(task => task.id === item.id)
    if (index >= 0) tasks[index] = { ...tasks[index], ...item }
    else tasks.push(item)
    practice.current_tasks = tasks
    practice.current_project_tasks = tasks.map(task => task.name)
    return this.save(state)
  }

  /** Set the current topic, optionally with its level. */
  setTopic(topic, level) {
    const state = this.load()
    state.topic_state.current_topic = topic
    if (level) state.topic_state.level = level
    return this.save(state)
  }

  /** Record a concept as mastered or weak, keeping both lists de-duplicated. */
  recordConcept(concept, status) {
    if (!CONCEPT_STATUSES.includes(status)) {
      throw new LearningStateError("status must be 'mastered' or 'weak'")
    }
    const state = this.load()
    const topic = state.topic_state
    const targetKey = status === 'mastered' ? 'mastered_concepts' : 'weak_concepts'
    const otherKey = status === 'mastered' ? 'weak_concepts' : 'mastered_concepts'
    const target = ensureList(topic[targetKey], targetKey)
    const other = ensureList(topic[otherKey], otherKey)
    if (!target.includes(concept)) target.push(concept)
    topic[targetKey] = target
    topic[otherKey] = other.filter(item => item !== concept)
    return this.save(state)
  }

  /** Add a scheduled review item and persist the state. */
  addReview(concept, prompt, result = 'correct', source = 'manual') {
    const state = this.load()
    const item = createReviewItem(concept, prompt, result, source)
    const nextItems = ensureList(state.review_state.next_review_items, 'next_review_items')
    state.review_state.next_review_items = upsertById(nextItems, item)
    return this.save(state)
  }

  /**
   * Archive a review attempt and optionally schedule its next interval.
   * @param {string} reviewId - `id` from `due_reviews` / `priority_reviews`.
   * @param {{ result: string, reschedule?: boolean, notes?: string }} options
   */
  completeReview(reviewId, { result, reschedule = true, notes = '' } = {}) {
    if (!Object.hasOwn(REVIEW_INTERVALS_BY_RESULT, result)) {
      throw new LearningStateError(`result must be one of: ${REVIEW_RESULTS.slice().sort().join(', ')}`)
    }
    const state = this.load()
    const reviewState = state.review_state
    const dueItems = ensureList(reviewState.due_items, 'due_items')
    const nextItems = ensureList(reviewState.next_review_items, 'next_review_items')
    const matched = [...dueItems, ...nextItems].find(item => item?.id === reviewId)
    if (!matched) throw new LearningStateError(`review item not found: ${reviewId}`)

    reviewState.due_items = dueItems.filter(item => item?.id !== reviewId)
    reviewState.next_review_items = nextItems.filter(item => item?.id !== reviewId)

    const completed = { ...matched, completed_result: result, completed_at: todayIso() }
    if (notes) completed.notes = notes
    const history = ensureList(reviewState.review_history, 'review_history')
    history.push(completed)
    reviewState.review_history = history

    if (reschedule) {
      this._scheduleReviewInState(state, String(matched.concept ?? ''), String(matched.prompt ?? ''), result, String(matched.source ?? 'manual'))
    }
    const concept = String(matched.concept ?? '')
    this._applyReviewResultToConcepts(state, concept, result)
    this._updateConceptProgressInState(state, concept, result)
    this._recordEvidenceInState(
      state,
      result.startsWith('correct') ? 'recall_correct' : 'recall_incorrect',
      matched.prompt ?? '',
    )
    return this.save(state)
  }

  /** Return review items whose due date is on or before `onDate`. */
  dueReviews(onDate) {
    const target = onDate ?? todayIso()
    const reviewState = this.load().review_state
    const candidates = [
      ...ensureList(reviewState.due_items, 'due_items'),
      ...ensureList(reviewState.next_review_items, 'next_review_items'),
    ]
    return candidates.filter(item => String(item?.due_at ?? '') <= target)
  }

  /**
   * Return due review items ranked by weak status and concept strength.
   *
   * Ranking signals, applied in addition to being due: weak-concept bonus 30,
   * low-strength bonus `(1 - strength) * 20`, failure-count bonus 3 each.
   */
  priorityReviews(onDate, limit = 5) {
    const state = this.load()
    const target = onDate ?? todayIso()
    const weak = new Set(ensureList(state.topic_state.weak_concepts, 'weak_concepts'))
    const progress = state.topic_state.concept_progress ?? {}
    const ranked = []
    for (const item of this.dueReviews(target)) {
      const concept = String(item?.concept ?? '')
      const conceptProgress = progress[concept] ?? {}
      const strength = Number(conceptProgress.strength ?? 0.3)
      const dueBonus = String(item?.due_at ?? '') <= target ? 20 : 0
      const weakBonus = weak.has(concept) ? 30 : 0
      const lowStrengthBonus = Math.trunc((1 - strength) * 20)
      const failureBonus = Math.trunc(Number(conceptProgress.failure_count ?? 0)) * 3
      ranked.push({ ...item, priority: dueBonus + weakBonus + lowStrengthBonus + failureBonus, strength })
    }
    ranked.sort((left, right) => (
      Number(right.priority ?? 0) - Number(left.priority ?? 0)
      || String(left.due_at ?? '').localeCompare(String(right.due_at ?? ''))
      || String(left.concept ?? '').localeCompare(String(right.concept ?? ''))
    ))
    return ranked.slice(0, limit)
  }

  /** Record a completed or failed exercise and update difficulty evidence. */
  recordExercise(name, { status, concepts = [], notes = '' } = {}) {
    if (!['completed', 'failed'].includes(status)) {
      throw new LearningStateError("status must be 'completed' or 'failed'")
    }
    const state = this.load()
    const { dateOnly, timeOnly } = clockParts()
    const item = {
      id: stableId('exercise', name),
      name,
      concepts,
      notes,
      status,
      completed_at: status === 'completed' ? todayIso() : '',
      failed_at: status === 'failed' ? todayIso() : '',
      created_at: `${dateOnly}T${timeOnly}`,
    }
    const practice = state.practice_state
    const completed = ensureList(practice.completed_exercises, 'completed_exercises')
    const failed = ensureList(practice.failed_exercises, 'failed_exercises')
    if (status === 'completed') upsertById(completed, item)
    else upsertById(failed, item)
    practice.completed_exercises = completed
    practice.failed_exercises = failed
    this._recordEvidenceInState(state, status === 'completed' ? 'exercise_completed' : 'exercise_failed', name)
    return this.save(state)
  }

  /**
   * Register an exercise specification.
   *
   * Returns the whole saved state, matching the Python `add_exercise_spec`, so
   * a caller can hand the same value to the model regardless of which
   * implementation is behind it. Use {@link LearningStore#exerciseSpec} to read
   * one spec back by id.
   */
  addExerciseSpec(spec) {
    const state = this.load()
    const normalized = LearningStore.validateExerciseSpec(spec)
    const specs = ensureList(state.practice_state.exercise_specs, 'exercise_specs')
    state.practice_state.exercise_specs = upsertById(specs, normalized)
    return this.save(state)
  }

  /** Look up one persisted exercise specification by id. */
  exerciseSpec(exerciseId) {
    const specs = ensureList(this.load().practice_state.exercise_specs, 'exercise_specs')
    const spec = specs.find(item => item?.id === exerciseId)
    if (!spec) throw new LearningStateError(`exercise spec not found: ${exerciseId}`)
    return spec
  }

  /** Record an exercise attempt and update review/difficulty signals. */
  recordAttempt(exerciseId, {
    user_answer,
    result,
    score,
    mistake_type = '',
    feedback = '',
    concepts_to_review,
  } = {}) {
    if (!ATTEMPT_RESULTS.includes(result)) {
      throw new LearningStateError(`result must be one of: ${ATTEMPT_RESULTS.slice().sort().join(', ')}`)
    }
    if (!Number.isInteger(score) || score < 0 || score > 100) {
      throw new LearningStateError('score must be an integer from 0 to 100')
    }
    const state = this.load()
    const specs = ensureList(state.practice_state.exercise_specs, 'exercise_specs')
    const spec = specs.find(item => item?.id === exerciseId)
    if (!spec) throw new LearningStateError(`exercise spec not found: ${exerciseId}`)

    const reviewConcepts = concepts_to_review ?? [...(spec.concepts ?? [])]
    const attempts = ensureList(state.practice_state.attempt_records, 'attempt_records')
    const attempt = {
      id: stableId('attempt', exerciseId, todayIso(), String(attempts.length)),
      exercise_id: exerciseId,
      user_answer,
      result,
      score,
      mistake_type,
      feedback,
      concepts_to_review: reviewConcepts,
      created_at: todayIso(),
    }
    attempts.push(attempt)
    state.practice_state.attempt_records = attempts

    const reviewResult = result === 'pass' ? 'correct' : 'incorrect'
    for (const concept of reviewConcepts) {
      const prompt = feedback || `Review ${concept} from exercise: ${spec.task ?? ''}`
      this._scheduleReviewInState(state, concept, prompt, reviewResult, 'attempt')
      this._applyReviewResultToConcepts(state, concept, reviewResult)
      this._updateConceptProgressInState(state, concept, result)
    }
    this._recordEvidenceInState(state, result === 'pass' ? 'exercise_completed' : 'exercise_failed', feedback || mistake_type || spec.task || '')
    return this.save(state)
  }

  /** Record difficulty evidence and apply the current adjustment. */
  recordEvidence(signal, detail = '', source = 'manual') {
    const state = this.load()
    this._recordEvidenceInState(state, signal, detail, source)
    return this.save(state)
  }

  /** Return a compact, agent-friendly learning-state summary. */
  summary(onDate) {
    const state = this.load()
    const profile = state.learner_profile
    const topic = state.topic_state
    const practice = state.practice_state
    const difficulty = state.difficulty_state
    return {
      learning_domain: profile.learning_domain ?? 'general',
      known_skills: profile.known_skills ?? profile.known_stack ?? [],
      learning_goal: profile.learning_goal ?? '',
      target_outcome: profile.target_outcome ?? profile.target_project ?? '',
      target_project: profile.target_project ?? '',
      current_topic: topic.current_topic ?? '',
      level: topic.level ?? 'beginner',
      mastered_concepts: topic.mastered_concepts ?? [],
      weak_concepts: topic.weak_concepts ?? [],
      concept_progress: topic.concept_progress ?? {},
      due_reviews: this.dueReviews(onDate),
      priority_reviews: this.priorityReviews(onDate),
      exercise_specs: practice.exercise_specs ?? [],
      attempt_records: practice.attempt_records ?? [],
      current_tasks: practice.current_tasks ?? [],
      current_project_tasks: practice.current_project_tasks ?? [],
      current_difficulty: difficulty.current_difficulty ?? 1,
      next_adjustment: difficulty.next_adjustment ?? 'same',
    }
  }

  /** Render summary data as concise prompt context for another agent. */
  promptContext(onDate) {
    const summary = this.summary(onDate)
    const dueConcepts = summary.due_reviews.filter(item => item?.concept).map(item => String(item.concept))
    const lines = [
      `学习领域：${summary.learning_domain || 'general'}`,
      `已知技能：${summary.known_skills.length ? summary.known_skills.join(', ') : '未设置'}`,
      `当前学习目标：${summary.learning_goal || '未设置'}`,
      `当前主题：${summary.current_topic || '未设置'}`,
      `目标结果：${summary.target_outcome || '未设置'}`,
      `薄弱点：${summary.weak_concepts.length ? summary.weak_concepts.join(', ') : '无'}`,
      `今天需要复习：${dueConcepts.length ? dueConcepts.join(', ') : '无'}`,
      `优先复习：${summary.priority_reviews.length ? summary.priority_reviews.map(item => String(item.concept ?? '')).join(', ') : '无'}`,
      `下一步任务：${summary.current_tasks.length ? summary.current_tasks.map(task => task.name).join(', ') : '未设置'}`,
      `当前难度：${summary.current_difficulty}，下一步调整：${summary.next_adjustment}`,
    ]
    return lines.join('\n')
  }

  /** Return onboarding questions for a learning domain. */
  onboardingQuestions(domain) {
    return LearningStore.domainTemplate(domain ?? 'general')
  }

  /** Return a domain template, falling back to the general template. */
  static domainTemplate(domain) {
    return clone(DOMAIN_TEMPLATES[domain] ?? DOMAIN_TEMPLATES.general)
  }

  /* -------------------------- internals -------------------------- */

  /** Apply lightweight in-memory migrations for older state files. */
  static migrate(state) {
    state.schema_version = SCHEMA_VERSION
    const profile = state.learner_profile ?? {}
    if (!('known_skills' in profile)) profile.known_skills = [...(profile.known_stack ?? [])]
    if (!('learning_domain' in profile)) {
      profile.learning_domain = (profile.known_stack ?? []).length ? 'technology' : 'general'
    }
    if (!profile.target_outcome) profile.target_outcome = profile.target_project ?? ''
    if (!profile.target_project) profile.target_project = profile.target_outcome ?? ''
    state.learner_profile = profile

    const topic = state.topic_state ?? {}
    if (!('concept_progress' in topic)) topic.concept_progress = {}
    state.topic_state = topic

    const practice = state.practice_state ?? {}
    if (!(practice.current_tasks ?? []).length) {
      practice.current_tasks = ensureList(practice.current_project_tasks, 'current_project_tasks')
        .map(task => ({
          id: stableId('task', String(task)),
          name: String(task),
          notes: '',
          status: 'pending',
          created_at: todayIso(),
        }))
    }
    if (!(practice.current_project_tasks ?? []).length) {
      practice.current_project_tasks = ensureList(practice.current_tasks, 'current_tasks')
        .map(task => String(task?.name ?? ''))
    }
    state.practice_state = practice

    const review = state.review_state ?? {}
    for (const key of ['due_items', 'next_review_items', 'review_history']) {
      const items = ensureList(review[key], key)
      for (const item of items) {
        if (item && typeof item === 'object' && !item.id) {
          item.id = stableId('review', String(item.concept ?? ''), String(item.prompt ?? ''))
        }
      }
      review[key] = items
    }
    state.review_state = review
    return state
  }

  /** Validate the top-level schema and normalize missing keys. */
  static validate(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new LearningStateError('Learning state must be a dictionary')
    }
    let normalized = deepMerge(defaultState(), state)
    normalized = LearningStore.migrate(normalized)
    if (normalized.schema_version !== SCHEMA_VERSION) {
      throw new LearningStateError(`schema_version must be ${SCHEMA_VERSION}`)
    }
    for (const section of Object.keys(defaultState())) {
      if (section === 'schema_version') continue
      const value = normalized[section]
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new LearningStateError(`${section} must be an object`)
      }
    }
    if (!TOPIC_LEVELS.includes(normalized.topic_state.level)) {
      throw new LearningStateError('topic_state.level must be beginner, intermediate, or advanced')
    }
    const difficulty = normalized.difficulty_state.current_difficulty
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
      throw new LearningStateError('difficulty_state.current_difficulty must be an integer from 1 to 5')
    }
    return normalized
  }

  /** Normalize one exercise spec and enforce its domain constraints. */
  static validateExerciseSpec(spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
      throw new LearningStateError('exercise spec must be an object')
    }
    const concepts = ensureList(spec.concepts, 'exercise_spec.concepts')
    const normalized = {
      id: spec.id || stableId(
        'exercise-spec',
        String(spec.topic ?? ''),
        concepts.map(concept => String(concept)).join(','),
        String(spec.difficulty ?? ''),
        String(spec.task ?? ''),
      ),
      topic: String(spec.topic ?? ''),
      concepts,
      difficulty: String(spec.difficulty ?? ''),
      goal: String(spec.goal ?? ''),
      task: String(spec.task ?? ''),
      input: String(spec.input ?? ''),
      expected_output: String(spec.expected_output ?? ''),
      constraints: ensureList(spec.constraints, 'exercise_spec.constraints'),
      evaluation_criteria: ensureList(spec.evaluation_criteria, 'exercise_spec.evaluation_criteria'),
      hint: String(spec.hint ?? ''),
      created_at: String(spec.created_at ?? todayIso()),
    }
    if (!EXERCISE_DIFFICULTIES.includes(normalized.difficulty)) {
      throw new LearningStateError(`exercise_spec.difficulty must be one of: ${EXERCISE_DIFFICULTIES.slice().sort().join(', ')}`)
    }
    if (normalized.concepts.length === 0) {
      throw new LearningStateError('exercise_spec.concepts must contain at least one concept')
    }
    if (!normalized.task.trim()) throw new LearningStateError('exercise_spec.task must not be empty')
    return normalized
  }

  /** Schedule (or reschedule) one review item inside an already-loaded state. */
  _scheduleReviewInState(state, concept, prompt, result, source) {
    const nextItems = ensureList(state.review_state.next_review_items, 'next_review_items')
    state.review_state.next_review_items = upsertById(nextItems, createReviewItem(concept, prompt, result, source))
  }

  /** Move one concept's strength, streak, and due date by recall outcome. */
  _updateConceptProgressInState(state, concept, result) {
    if (!concept) return
    const topic = state.topic_state
    const progress = (topic.concept_progress ??= {})
    const existing = progress[concept] ?? {}
    const currentStrength = Number(existing.strength ?? 0.5)
    const attempts = Number(existing.attempts ?? 0) + 1
    const baseDay = todayIso()

    let correctStreak
    let failureCount
    let strength
    let interval
    if (['pass', 'correct', 'second_correct', 'third_correct'].includes(result)) {
      correctStreak = Number(existing.correct_streak ?? 0) + 1
      failureCount = 0
      const delta = ['second_correct', 'third_correct'].includes(result) ? 0.2 : 0.1
      strength = Math.min(1, currentStrength + delta)
      interval = correctStreak === 1 ? 1 : correctStreak === 2 ? 3 : 7
    } else {
      correctStreak = 0
      failureCount = Number(existing.failure_count ?? 0) + 1
      strength = Math.max(0, currentStrength - 0.2)
      interval = 0
    }

    progress[concept] = {
      concept,
      strength: Math.round(strength * 100) / 100,
      attempts,
      correct_streak: correctStreak,
      last_reviewed_at: baseDay,
      next_due_at: addDays(baseDay, interval),
      failure_count: failureCount,
    }
    topic.concept_progress = progress
  }

  /** Move a concept between the weak and mastered lists by recall outcome. */
  _applyReviewResultToConcepts(state, concept, result) {
    if (!concept) return
    const topic = state.topic_state
    let weak = ensureList(topic.weak_concepts, 'weak_concepts')
    let mastered = ensureList(topic.mastered_concepts, 'mastered_concepts')
    if (['incorrect', 'fuzzy'].includes(result)) {
      if (!weak.includes(concept)) weak.push(concept)
      mastered = mastered.filter(item => item !== concept)
    } else if (['second_correct', 'third_correct'].includes(result)) {
      if (!mastered.includes(concept)) mastered.push(concept)
      weak = weak.filter(item => item !== concept)
    }
    topic.weak_concepts = weak
    topic.mastered_concepts = mastered
  }

  /** Append one difficulty-evidence record (bounded to the last 20) and re-rank. */
  _recordEvidenceInState(state, signal, detail = '', source = 'manual') {
    const difficulty = state.difficulty_state
    const evidence = ensureList(difficulty.evidence, 'difficulty_state.evidence')
    evidence.push({ signal, detail: String(detail), source, recorded_at: todayIso() })
    difficulty.evidence = evidence.slice(-20)
    LearningStore._adjustDifficultyInState(state)
  }

  /** Two consecutive same-polarity signals move difficulty by one step. */
  static _adjustDifficultyInState(state) {
    const difficulty = state.difficulty_state
    const evidence = ensureList(difficulty.evidence, 'difficulty_state.evidence')
    const recent = evidence.slice(-2)
    const positive = recent.filter(item => POSITIVE_DIFFICULTY_SIGNALS.includes(item?.signal)).length
    const negative = recent.filter(item => NEGATIVE_DIFFICULTY_SIGNALS.includes(item?.signal)).length
    const current = difficulty.current_difficulty ?? 1
    if (positive >= 2) {
      difficulty.next_adjustment = 'harder'
      difficulty.current_difficulty = Math.min(5, current + 1)
    } else if (negative >= 2) {
      difficulty.next_adjustment = 'easier'
      difficulty.current_difficulty = Math.max(1, current - 1)
    } else {
      difficulty.next_adjustment = 'same'
      difficulty.current_difficulty = current
    }
  }
}

/** Expand a leading `~` the way Python's `Path.expanduser()` does. */
function expandHome(path) {
  if (path === '~') return process.env.HOME ?? process.env.USERPROFILE ?? path
  if (path.startsWith('~/') || path.startsWith('~\\')) {
    const home = process.env.HOME ?? process.env.USERPROFILE
    if (home) return join(home, path.slice(2))
  }
  return isAbsolute(path) ? path : resolve(path)
}

/** Local date/time parts for exercise receipts. */
function clockParts(now = new Date()) {
  const pad = value => String(value).padStart(2, '0')
  return {
    dateOnly: todayIso(now),
    timeOnly: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
  }
}
