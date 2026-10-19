/**
 * State-schema contract tests.
 *
 * `schemas/learning_state.schema.json` is a second, declarative description of
 * the very state that lib/learning-store.js owns in code, and nothing at
 * runtime reads it — so it can drift silently. These tests pin the schema to
 * the kernel instead of to a hand-written copy: the expectations are derived
 * from `SCHEMA_VERSION`, `defaultState()`, the exported enum constants, and
 * state the store actually wrote to a temporary file. A new kernel field or a
 * renamed record therefore fails here until the schema documents it.
 *
 * Usage:
 *   node --test tests/schema.test.js
 *   node tests/schema.test.js
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  ATTEMPT_RESULTS,
  EXERCISE_DIFFICULTIES,
  EXPERIENCE_LEVELS,
  REVIEW_RESULTS,
  SCHEMA_VERSION,
  TOPIC_LEVELS,
  LearningStore,
  createExerciseSpec,
  defaultState,
} from '../lib/learning-store.js'

const SCHEMA_PATH = join(import.meta.dirname, '..', 'schemas', 'learning_state.schema.json')
const SCHEMA_TEXT = readFileSync(SCHEMA_PATH, 'utf8')
/** Parsed once for the whole file; test 1 re-parses the raw text explicitly. */
const schema = JSON.parse(SCHEMA_TEXT)

/** The five object-valued sections of the state, in defaultState() order. */
const SECTION_NAMES = ['learner_profile', 'topic_state', 'practice_state', 'review_state', 'difficulty_state']

/** The four record definitions named in the plugin's public documentation. */
const RECORD_DEFS = ['ConceptProgress', 'ExerciseSpec', 'AttemptRecord', 'ReviewItem']

/** Collect every `$ref` string in a JSON document, at any depth. */
function collectRefs(node, found = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, found)
    return found
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') found.push(value)
      else collectRefs(value, found)
    }
  }
  return found
}

/**
 * Assert every `record` key is documented by `$defs[defName]` and every
 * required key is present on it. This is the direction that matters: extras on
 * the kernel side mean an undocumented state field.
 */
function assertRecordsCovered(defName, records) {
  const def = schema.$defs[defName]
  assert.ok(def, `$defs.${defName} is missing`)
  const declared = Object.keys(def.properties ?? {})
  for (const record of records) {
    for (const key of Object.keys(record)) {
      assert.ok(declared.includes(key), `$defs.${defName} does not document the written field ${key}`)
    }
    for (const key of def.required ?? []) {
      assert.ok(key in record, `$defs.${defName} requires ${key}, absent from ${JSON.stringify(record)}`)
    }
  }
}

test('schema file is valid JSON and describes an object', () => {
  assert.doesNotThrow(() => JSON.parse(SCHEMA_TEXT), `${SCHEMA_PATH} must be valid JSON`)
  assert.ok(schema !== null && typeof schema === 'object' && !Array.isArray(schema), 'schema root must be an object')
  assert.equal(schema.type, 'object')
  assert.equal(typeof schema.properties, 'object', 'schema.properties must be an object')
  assert.equal(typeof schema.$defs, 'object', 'schema.$defs must be an object')
})

test('schema_version const matches the kernel SCHEMA_VERSION', () => {
  assert.equal(schema.properties.schema_version.const, SCHEMA_VERSION)
  assert.equal(SCHEMA_VERSION, defaultState().schema_version, 'SCHEMA_VERSION drifted from defaultState()')
  assert.equal(SCHEMA_VERSION, 1, 'the persisted format is version 1')
})

test('every defaultState() top-level key is declared and required', () => {
  const declared = Object.keys(schema.properties)
  const defaults = Object.keys(defaultState())
  for (const key of defaults) {
    assert.ok(declared.includes(key), `schema.properties is missing the defaultState() key ${key}`)
  }
  assert.deepEqual(
    [...schema.required].sort(),
    [...defaults].sort(),
    'required must be exactly the defaultState() keys',
  )
  for (const key of schema.required) {
    assert.ok(declared.includes(key), `required lists ${key}, which is not declared in properties`)
  }
  assert.equal(schema.additionalProperties, true, 'the kernel deep-merge preserves unknown top-level keys')
})

test('section schemas cover exactly the defaultState() keys', () => {
  for (const name of SECTION_NAMES) {
    const section = schema.properties[name]
    assert.equal(section.type, 'object', `${name} must be typed as an object`)
    assert.deepEqual(
      Object.keys(section.properties).sort(),
      Object.keys(defaultState()[name]).sort(),
      `${name} keys drifted from defaultState()`,
    )
  }
})

test('enums and bounds mirror the kernel constants', () => {
  assert.deepEqual(schema.properties.learner_profile.properties.experience_level.enum, [...EXPERIENCE_LEVELS])
  assert.deepEqual(schema.properties.topic_state.properties.level.enum, [...TOPIC_LEVELS])
  assert.deepEqual(schema.$defs.ExerciseSpec.properties.difficulty.enum, [...EXERCISE_DIFFICULTIES])
  assert.deepEqual(schema.$defs.AttemptRecord.properties.result.enum, [...ATTEMPT_RESULTS])
  assert.deepEqual(
    [...schema.$defs.ReviewItem.properties.result.enum].sort(),
    [...REVIEW_RESULTS].sort(),
    'ReviewItem.result must accept every REVIEW_INTERVALS_BY_RESULT key',
  )
  assert.deepEqual(schema.properties.difficulty_state.properties.next_adjustment.enum, ['easier', 'same', 'harder'])

  const difficulty = schema.properties.difficulty_state.properties.current_difficulty
  assert.equal(difficulty.type, 'integer')
  assert.equal(difficulty.minimum, 1)
  assert.equal(difficulty.maximum, 5)
})

test('record definitions are complete and every $ref resolves', () => {
  for (const name of RECORD_DEFS) {
    assert.ok(schema.$defs[name], `$defs.${name} is missing`)
  }
  for (const [name, def] of Object.entries(schema.$defs)) {
    const declared = Object.keys(def.properties ?? {})
    for (const key of def.required ?? []) {
      assert.ok(declared.includes(key), `$defs.${name}.required lists undeclared ${key}`)
    }
  }
  const refs = collectRefs(schema)
  assert.ok(refs.length >= 8, `expected the schema to use $ref for its record types, found ${refs.length}`)
  for (const ref of refs) {
    const name = ref.replace('#/$defs/', '')
    assert.ok(schema.$defs[name], `dangling reference ${ref}`)
  }
  assert.equal(schema.$defs.concept_progress.$ref, '#/$defs/ConceptProgress')
  assert.equal(schema.$defs.exercise_spec.$ref, '#/$defs/ExerciseSpec')
  assert.equal(schema.$defs.attempt_record.$ref, '#/$defs/AttemptRecord')
  assert.equal(schema.$defs.review_item.$ref, '#/$defs/ReviewItem')
})

test('defaultState() values satisfy the declared types and enums', () => {
  const defaults = defaultState()
  const enums = {
    experience_level: schema.properties.learner_profile.properties.experience_level.enum,
    level: schema.properties.topic_state.properties.level.enum,
    next_adjustment: schema.properties.difficulty_state.properties.next_adjustment.enum,
  }
  assert.ok(enums.experience_level.includes(defaults.learner_profile.experience_level))
  assert.ok(enums.level.includes(defaults.topic_state.level))
  assert.ok(enums.next_adjustment.includes(defaults.difficulty_state.next_adjustment))

  const bounds = schema.properties.difficulty_state.properties.current_difficulty
  const difficulty = defaults.difficulty_state.current_difficulty
  assert.ok(
    Number.isInteger(difficulty) && difficulty >= bounds.minimum && difficulty <= bounds.maximum,
    `current_difficulty default ${difficulty} is outside the schema bounds`,
  )
  for (const name of SECTION_NAMES) {
    assert.equal(typeof defaults[name], 'object', `defaultState().${name} must be an object`)
  }
})

test('every field the kernel writes is documented by its definition', () => {
  const dir = mkdtempSync(join(tmpdir(), 'la-schema-'))
  try {
    const store = new LearningStore(join(dir, 'state.json'))
    store.reset()
    store.updateProfile({
      learning_domain: 'technology',
      known_stack: ['JavaScript', 'TypeScript'],
      experience_level: 'intermediate',
      learning_goal: '掌握 DSH 插件机制',
      target_outcome: '写出一个可安装的 DSH 插件',
      preferred_language: 'zh-CN',
      constraint: '每天 30 分钟',
    })
    store.setTopic('DSH Cordis 插件', 'beginner')
    store.recordConcept('Cordis waterfall 语义', 'weak')
    store.addTask('读完 cordis-tutorial 第七章', 'jump to chapter 7')

    const spec = store
      .addExerciseSpec(
        createExerciseSpec({
          topic: 'DSH Cordis 插件',
          concepts: ['defineTool', 'tools.register'],
          difficulty: 'normal',
          task: '注册一个最小工具并在 Web UI 中调用',
          goal: '理解工具注册即 effect',
          expected_output: '工具卡片出现在对话流中',
          evaluation_criteria: ['注册是 effect'],
          hint: '从 ctx.tools.register 开始',
        }),
      )
      .practice_state.exercise_specs.at(-1)

    store.recordAttempt(spec.id, {
      user_answer: 'ctx.tools.register(defineTool({...}))',
      result: 'partial',
      score: 60,
      mistake_type: 'concept_confusion',
      feedback: '把注册 effect 说成了全局单例',
      concepts_to_review: ['defineTool'],
    })

    // Completing a review is what produces concept_progress and review_history.
    const due = store.priorityReviews(undefined, 1)
    assert.equal(due.length, 1, 'the scheduled attempt review should be due today')
    store.completeReview(due[0].id, { result: 'second_correct', notes: '第二次答对' })

    store.recordExercise('注册 defineTool', {
      status: 'completed',
      concepts: ['defineTool'],
      notes: '跑通',
    })
    store.recordExercise('卸载 effect', { status: 'failed', concepts: ['defineTool'] })
    store.recordEvidence('explain_fuzzy', '把 effect 说成单例')

    const state = store.load()
    assertRecordsCovered('ExerciseSpec', state.practice_state.exercise_specs)
    assertRecordsCovered('AttemptRecord', state.practice_state.attempt_records)
    assertRecordsCovered('ConceptProgress', Object.values(state.topic_state.concept_progress))
    assertRecordsCovered('ReviewItem', [
      ...state.review_state.due_items,
      ...state.review_state.next_review_items,
      ...state.review_state.review_history,
    ])
    assertRecordsCovered('DifficultyEvidence', state.difficulty_state.evidence)
    assertRecordsCovered('CurrentTask', state.practice_state.current_tasks)
    assertRecordsCovered('ExerciseRecord', [
      ...state.practice_state.completed_exercises,
      ...state.practice_state.failed_exercises,
    ])

    // The concept-progress fields the docs call out, spelled out by name so a
    // rename shows up as a readable failure rather than an empty record set.
    const progress = Object.values(state.topic_state.concept_progress)[0]
    assert.ok(progress, 'completing a review should have written concept_progress')
    for (const field of [
      'strength',
      'attempts',
      'correct_streak',
      'failure_count',
      'next_due_at',
      'last_reviewed_at',
    ]) {
      assert.ok(field in progress, `written concept_progress lost ${field}`)
      assert.ok(field in schema.$defs.ConceptProgress.properties, `ConceptProgress does not declare ${field}`)
    }

    // The archived review carries the completion stamp completeReview() adds.
    const archived = state.review_state.review_history.at(-1)
    assert.equal(archived.completed_result, 'second_correct')
    assert.ok('completed_at' in archived)
    assert.ok('completed_at' in schema.$defs.ReviewItem.properties)
    assert.ok('completed_result' in schema.$defs.ReviewItem.properties)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
