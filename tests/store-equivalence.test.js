/**
 * Cross-implementation equivalence check.
 *
 * The DSH plugin re-implements Learning-Accelerator's state kernel in
 * JavaScript. If the two ever disagree, a learner's `.learning/state.json`
 * silently forks into two mutually incompatible shapes. This script runs one
 * identical operation sequence through both implementations and requires the
 * resulting files to be byte-identical.
 *
 * Usage:
 *   node --test tests/store-equivalence.test.js
 *   node tests/store-equivalence.test.js
 *
 * Skips (does not fail) when `python3` or the Learning-Accelerator checkout is
 * unavailable, so the plugin package stays independently testable.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { LearningStore, SCHEMA_VERSION } from '../lib/learning-store.js'

const REPO = resolve(import.meta.dirname, '..', '..', 'Learning-Accelerator')

function pythonAvailable() {
  if (!existsSync(join(REPO, 'learning_accelerator', 'state.py'))) return false
  try {
    execFileSync('python3', ['-c', 'import sys; sys.exit(0)'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * The shared scenario. Every step is expressed as a label plus a mutation that
 * each language's driver applies identically. Kept declarative so the Node and
 * Python drivers cannot drift in what they exercise.
 */
const SCENARIO = [
  ['reset', {}],
  ['profile', {
    learning_domain: 'technology',
    known_stack: ['JavaScript', 'TypeScript', 'React'],
    known_skills: ['JavaScript', 'TypeScript', 'React'],
    experience_level: 'intermediate',
    learning_goal: '掌握 DSH 插件机制',
    target_outcome: '写出一个可安装的 DSH 插件',
    preferred_language: 'zh-CN',
    constraint: '每天 30 分钟',
  }],
  ['topic', { topic: 'DSH Cordis 插件', level: 'beginner' }],
  ['task', { name: '读完 cordis-tutorial 第七章' }],
  ['task', { name: '把 greet 工具注册进 tools 服务' }],
  ['conceptWeak', { concept: 'Cordis waterfall 语义' }],
  ['conceptMastered', { concept: '插件 apply 函数' }],
  ['review', { concept: 'Cordis waterfall 语义', prompt: '解释 waterfall 里不调用 next() 会发生什么', result: 'correct' }],
  ['review', { concept: 'inject 与 PENDING', prompt: '注入的服务不存在时插件处于什么状态', result: 'fuzzy' }],
  ['evidence', { signal: 'recall_correct', detail: 'waterfall 解释正确' }],
  ['evidence', { signal: 'recall_correct', detail: 'inject 解释正确' }],
  ['spec', {
    topic: 'DSH Cordis 插件',
    concepts: ['defineTool', 'tools.register'],
    difficulty: 'normal',
    task: '注册一个最小工具并在 Web UI 中调用',
    goal: '理解工具注册即 effect',
    input: '',
    expected_output: '工具卡片出现在对话流中',
    constraints: [],
    evaluation_criteria: ['注册是 effect', '卸载后工具消失'],
    hint: '从 ctx.tools.register 开始',
  }],
]

/** Node driver: applies the scenario through the JavaScript store. */
function runNode(file) {
  const store = new LearningStore(file)
  const specIds = []
  for (const [step, payload] of SCENARIO) {
    switch (step) {
      case 'reset': store.reset(); break
      case 'profile': store.updateProfile(payload); break
      case 'topic': store.setTopic(payload.topic, payload.level); break
      case 'task': store.addTask(payload.name); break
      case 'conceptWeak': store.recordConcept(payload.concept, 'weak'); break
      case 'conceptMastered': store.recordConcept(payload.concept, 'mastered'); break
      case 'review': store.addReview(payload.concept, payload.prompt, payload.result); break
      case 'evidence': store.recordEvidence(payload.signal, payload.detail); break
      case 'spec': {
        const saved = store.addExerciseSpec(payload)
        specIds.push(saved.practice_state.exercise_specs.at(-1).id)
        break
      }
      default: throw new Error(`unknown step ${step}`)
    }
  }
  // Exercise the attempt path too: it touches review scheduling, concept
  // progress, and difficulty evidence in one call.
  const [specId] = specIds
  store.recordAttempt(specId, {
    user_answer: 'ctx.tools.register(defineTool({...}))',
    result: 'partial',
    score: 60,
    mistake_type: 'concept_confusion',
    feedback: '把注册 effect 说成了全局单例',
    concepts_to_review: ['defineTool', 'tools.register'],
  })
  // Finally complete one due review, which closes the spaced-repetition loop.
  const due = store.priorityReviews(undefined, 1)
  if (due.length > 0) store.completeReview(due[0].id, { result: 'second_correct', notes: '第二次答对' })
  return store.load()
}

/** Python driver: the same scenario, emitted as a script for the CLI store. */
function pythonDriver() {
  return `
import json, sys
sys.path.insert(0, ${JSON.stringify(REPO)})
from learning_accelerator.state import JsonStateStore

store = JsonStateStore(sys.argv[1])
scenario = json.loads(sys.argv[2])
spec_ids = []
for step, payload in scenario:
    if step == 'reset':
        store.reset()
    elif step == 'profile':
        store.update_profile(**payload)
    elif step == 'topic':
        store.set_topic(payload['topic'], payload.get('level'))
    elif step == 'task':
        store.add_task(payload['name'])
    elif step == 'conceptWeak':
        store.record_concept(payload['concept'], 'weak')
    elif step == 'conceptMastered':
        store.record_concept(payload['concept'], 'mastered')
    elif step == 'review':
        store.add_review(payload['concept'], payload['prompt'], result=payload['result'])
    elif step == 'evidence':
        store.record_evidence(payload['signal'], payload['detail'])
    elif step == 'spec':
        saved = store.add_exercise_spec(payload)
        spec_ids.append(saved['practice_state']['exercise_specs'][-1]['id'])
    else:
        raise SystemExit('unknown step ' + step)

store.record_attempt(
    spec_ids[0],
    user_answer='ctx.tools.register(defineTool({...}))',
    result='partial',
    score=60,
    mistake_type='concept_confusion',
    feedback='把注册 effect 说成了全局单例',
    concepts_to_review=['defineTool', 'tools.register'],
)
due = store.priority_reviews(limit=1)
if due:
    store.complete_review(due[0]['id'], result='second_correct', notes='第二次答对')
print(json.dumps(store.load(), ensure_ascii=False, sort_keys=True))
`
}

const skip = pythonAvailable() ? false : 'python3 or the Learning-Accelerator checkout is unavailable'

test('JS store is byte-identical to the Python store', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'la-equiv-'))
  try {
    const jsFile = join(dir, 'js', 'state.json')
    const pyFile = join(dir, 'py', 'state.json')

    runNode(jsFile)
    const jsText = readFileSync(jsFile, 'utf8')

    const pyText = execFileSync(
      'python3',
      ['-c', pythonDriver(), pyFile, JSON.stringify(SCENARIO)],
      { encoding: 'utf8' },
    )
    void pyText

    const pythonSide = JSON.parse(readFileSync(pyFile, 'utf8'))
    const jsSide = JSON.parse(jsText)

    // Byte equality is the real contract; the structured diff below only makes
    // a failure readable instead of printing two large JSON blobs.
    const normalize = value => JSON.stringify(value, Object.keys(value).sort(), 2)
    assert.deepEqual(jsSide, pythonSide, 'JS and Python state diverged')
    assert.equal(jsSide.schema_version, SCHEMA_VERSION)
    assert.equal(
      readFileSync(pyFile, 'utf8'),
      jsText,
      `on-disk bytes differ:\n--- python ---\n${readFileSync(pyFile, 'utf8')}\n--- javascript ---\n${jsText}`,
    )
    void normalize
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('priority ranking prefers weak concepts and low strength', () => {
  const dir = mkdtempSync(join(tmpdir(), 'la-rank-'))
  try {
    const store = new LearningStore(join(dir, 'state.json'))
    store.reset()
    store.setTopic('ranking')
    store.recordConcept('weak-one', 'weak')
    // Both results schedule at 0 days, so both are due today: the comparison is
    // about ranking, not about which items exist.
    store.addReview('weak-one', 'prompt a', 'incorrect')
    store.addReview('strong-one', 'prompt b', 'fuzzy')
    const ranked = store.priorityReviews(undefined, 5)
    assert.equal(ranked.length, 2)
    assert.equal(ranked[0].concept, 'weak-one')
    assert.ok(
      ranked[0].priority > ranked[1].priority,
      `expected weak-one to outrank strong-one, got ${ranked[0].priority} vs ${ranked[1].priority}`,
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('priority ranking breaks ties by code point, like the Python store', () => {
  // Ordering in `priorityReviews` when a graded list has no rule to order by. Python
  // compares `str` by code point; `localeCompare` compares by locale collation,
  // which is case-insensitive at the primary level and therefore returns a
  // different order for exactly this input (`B` sorts before `aaa` in Python, and
  // after it in a locale collation). Every concept here fails an `incorrect`
  // review, so every item shares one priority and one `due_at`: the tie-break is
  // the only thing under test.
  const concepts = ['B', 'ZZZ', 'aaa', 'z1', 'm', 'n']
  const dir = mkdtempSync(join(tmpdir(), 'la-tiebreak-'))
  try {
    const store = new LearningStore(join(dir, 'state.json'))
    store.reset()
    store.setTopic('tie-break')
    for (const concept of concepts) store.addReview(concept, `prompt ${concept}`, 'incorrect')

    const ranked = store.priorityReviews(undefined, concepts.length)
    assert.equal(ranked.length, concepts.length, 'every concept must survive ranking')

    // Precondition: the fixture only exercises the tie-break if everything ties.
    const priorities = new Set(ranked.map(item => item.priority))
    const dueDates = new Set(ranked.map(item => item.due_at))
    assert.equal(priorities.size, 1, `expected one shared priority, got ${[...priorities]}`)
    assert.equal(dueDates.size, 1, `expected one shared due date, got ${[...dueDates]}`)

    const jsOrder = ranked.map(item => item.concept)
    assert.deepEqual(jsOrder, [...concepts].sort())
    // `localeCompare` would produce this instead — assert the regression directly
    // so the test still fails loudly if the comparator is ever reverted.
    assert.notDeepEqual(jsOrder, [...concepts].sort((left, right) => left.localeCompare(right)))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('ranking order is identical to the Python store for tied items', { skip }, () => {
  // Same fixture, driven through both kernels. This is the check that would have
  // caught the `localeCompare` divergence: the byte-equality scenario above never
  // produces two items with the same priority *and* the same due date, so it
  // could not observe the tie-break at all.
  const concepts = ['B', 'ZZZ', 'aaa', 'z1', 'm', 'n']
  const dir = mkdtempSync(join(tmpdir(), 'la-tiebreak-py-'))
  try {
    const store = new LearningStore(join(dir, 'js', 'state.json'))
    store.reset()
    store.setTopic('tie-break')
    for (const concept of concepts) store.addReview(concept, `prompt ${concept}`, 'incorrect')
    const jsOrder = store.priorityReviews(undefined, concepts.length).map(item => item.concept)

    const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(REPO)})
from learning_accelerator.state import JsonStateStore

store = JsonStateStore(sys.argv[1])
store.reset()
store.set_topic('tie-break')
for concept in json.loads(sys.argv[2]):
    store.add_review(concept, 'prompt ' + concept, result='incorrect')
print(json.dumps([item['concept'] for item in store.priority_reviews(limit=99)], ensure_ascii=False))
`
    const pyOrder = JSON.parse(execFileSync(
      'python3',
      ['-c', script, join(dir, 'py', 'state.json'), JSON.stringify(concepts)],
      { encoding: 'utf8' },
    ).trim())

    assert.deepEqual(jsOrder, pyOrder, 'tie-break order diverged from the Python store')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
