/**
 * The shape of a learning state file: version, paths, enums, domain templates,
 * and the empty state.
 *
 * This is the data half of the port. It holds no behaviour beyond constructing
 * the default state, so it can be read against `state.py`'s constants block
 * without the store's machinery in the way.
 *
 * @see ../../../Learning-Accelerator/learning_accelerator/state.py
 */
import { join } from 'node:path'

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
export const POSITIVE_DIFFICULTY_SIGNALS = Object.freeze(['exercise_completed', 'explain_correct', 'recall_correct'])

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
export const EXPERIENCE_LEVELS = Object.freeze(['unknown', 'no_programming', 'beginner', 'intermediate', 'advanced'])

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
