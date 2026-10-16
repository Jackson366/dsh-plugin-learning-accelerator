/**
 * The teaching protocol, tested as data.
 *
 * The protocol is the plugin's answer to upstream's `SKILL.md` +
 * `SYSTEM_PROMPT.md` + `references/learning_os_protocol.md`, so these tests are
 * mostly a *fidelity* check: every operating mode, the teaching unit order, the
 * error-analysis steps, the difficulty signals, and the "do not" list must all
 * survive the port. The rest guard the two things that are easy to get wrong in
 * prompt text — profile dispatch and the token budget, since this block is
 * injected on every turn of a live track.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CORE_LOOP,
  DIFFICULTY_SIGNALS,
  DO_NOT,
  DOMAIN_TEACHING_NOTES,
  ERROR_ANALYSIS_STEPS,
  EXERCISE_LEVELS,
  FRONTEND_ANALOGIES,
  NO_PROGRAMMING_ANALOGIES,
  OPERATING_MODES,
  PER_TURN_OUTPUTS,
  PROFILE_TRACKS,
  TEACHING_UNIT_SEQUENCE,
  composeTeachingProtocol,
  profileTrack,
  teachingProtocolBlock,
} from '../lib/protocol.js'

/** Upstream `references/learning_os_protocol.md` names exactly these modes. */
const UPSTREAM_MODES = ['onboarding', 'concept', 'project', 'practice', 'review', 'debug', 'calibration']

test('the seven operating modes survive the port, in upstream order', () => {
  assert.deepEqual(OPERATING_MODES.map(mode => mode.id), UPSTREAM_MODES)
  for (const mode of OPERATING_MODES) {
    assert.ok(mode.label.length > 0, `${mode.id} lost its label`)
    assert.ok(mode.intent.length > 10, `${mode.id} lost its intent`)
  }
})

test('the teaching unit keeps upstream order, end to end', () => {
  assert.deepEqual(TEACHING_UNIT_SEQUENCE, [
    '认知定位', '旧知识映射', '最小可运行示例', '语法与心智模型', '真实工程用法',
    '最佳实践', '反模式与常见坑', '生态位', '渐进式回顾', '下一步',
  ])
  // Every unit step has to be reachable from the composed text, or the model
  // never sees the step it is supposed to execute.
  const text = composeTeachingProtocol()
  for (const step of TEACHING_UNIT_SEQUENCE) {
    assert.match(text, new RegExp(step), `the composed protocol lost ${step}`)
  }
  // The loop mirrors upstream's own Core Workflow labels.
  const loop = CORE_LOOP.join('\n')
  for (const step of ['认知定位', '旧知识映射', '最小可运行示例', '语法与心智模型', '任务驱动练习', '间隔重复', '状态更新']) {
    assert.match(loop, new RegExp(step), `the loop lost ${step}`)
  }
})

test('exercise levels, per-turn outputs, and error analysis match upstream', () => {
  assert.deepEqual(EXERCISE_LEVELS.map(level => level.id), ['easy', 'normal', 'stretch'])
  assert.equal(PER_TURN_OUTPUTS.length, 4)
  assert.equal(ERROR_ANALYSIS_STEPS.length, 6)
  // Upstream's sixth step is the one that writes to the store.
  assert.match(ERROR_ANALYSIS_STEPS[5], /learning_record/)
})

test('difficulty is evidence-driven, with upstream signal names', () => {
  assert.deepEqual(DIFFICULTY_SIGNALS.positive, ['exercise_completed', 'recall_correct', 'explain_correct'])
  assert.deepEqual(DIFFICULTY_SIGNALS.negative, [
    'exercise_failed', 'recall_incorrect', 'explain_fuzzy', 'setup_failed',
  ])
  const text = composeTeachingProtocol()
  assert.match(text, /只看证据|只按证据|不按自述信心/)
  for (const signal of [...DIFFICULTY_SIGNALS.positive, ...DIFFICULTY_SIGNALS.negative]) {
    assert.match(text, new RegExp(signal), `signal ${signal} is not reachable from the protocol`)
  }
})

test('profileTrack dispatches on declared data, never on a guess', () => {
  assert.deepEqual(PROFILE_TRACKS, ['no_programming', 'frontend', 'beginner', 'experienced', 'unknown'])
  const cases = [
    [{ experienceLevel: 'no_programming' }, 'no_programming'],
    // A declared no-programming background outranks any skill string.
    [{ experienceLevel: 'no_programming', knownSkills: ['JavaScript', 'React'] }, 'no_programming'],
    [{ experienceLevel: 'intermediate', knownSkills: ['JavaScript'] }, 'frontend'],
    [{ experienceLevel: 'unknown', knownSkills: ['TypeScript', 'Node.js'] }, 'frontend'],
    [{ experienceLevel: 'advanced', knownSkills: ['Vue'] }, 'frontend'],
    [{ experienceLevel: 'beginner', knownSkills: ['SQL'] }, 'beginner'],
    [{ experienceLevel: 'intermediate', knownSkills: ['Go', 'Kubernetes'] }, 'experienced'],
    [{ experienceLevel: 'advanced' }, 'experienced'],
    [{}, 'unknown'],
    [{ experienceLevel: 'unknown' }, 'unknown'],
    [{ experienceLevel: 'not-a-level' }, 'unknown'],
    [{ experienceLevel: null, knownSkills: null }, 'unknown'],
    // "Java" is not "JavaScript": a substring match must not fire here.
    [{ experienceLevel: 'beginner', knownSkills: ['Java'] }, 'beginner'],
  ]
  for (const [profile, expected] of cases) {
    assert.equal(profileTrack(profile), expected, `${JSON.stringify(profile)} → ${expected}`)
  }
})

test('the frontend mapping table is never handed to an unknown learner', () => {
  const base = composeTeachingProtocol()
  assert.doesNotMatch(base, /Python dict/)
  assert.doesNotMatch(base, /一份菜谱/)
  assert.match(base, /不要默认对方懂前端/)

  const frontend = composeTeachingProtocol({ experienceLevel: 'intermediate', knownSkills: ['React'] })
  for (const row of FRONTEND_ANALOGIES) {
    assert.match(frontend, new RegExp(row.concept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(frontend, new RegExp(row.boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }

  const none = composeTeachingProtocol({ experienceLevel: 'no_programming' })
  for (const row of NO_PROGRAMMING_ANALOGIES) {
    assert.match(none, new RegExp(row.boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  // Everyday analogies must not leak into the frontend track either.
  assert.doesNotMatch(frontend, /一份菜谱/)
})

test('the domain note follows the state domain, and unknown domains fall back', () => {
  for (const [domain, note] of Object.entries(DOMAIN_TEACHING_NOTES)) {
    assert.match(composeTeachingProtocol({ domain }), new RegExp(note.slice(0, 6)))
  }
  assert.match(composeTeachingProtocol({ domain: 'not-a-domain' }), new RegExp(DOMAIN_TEACHING_NOTES.general.slice(0, 6)))
  assert.match(composeTeachingProtocol({}), new RegExp(DOMAIN_TEACHING_NOTES.general.slice(0, 6)))
})

test('the write path is named, and every action is reachable from the text', () => {
  const text = composeTeachingProtocol({ domain: 'technology' })
  for (const action of ['review_complete', 'review_add', 'concept', 'exercise_spec', 'attempt', 'mistake', 'task', 'evidence']) {
    assert.match(text, new RegExp(`\`${action}\``), `action ${action} is not mentioned`)
  }
  assert.match(text, /不要在正文里声称状态已保存/)
  // The upstream CLI must not survive the port: the tool is the only write path.
  assert.doesNotMatch(text, /python -m learning_accelerator/)
  assert.equal(DO_NOT.length, 9)
})

test('composeTeachingProtocol is total and never leaks undefined', () => {
  const inputs = [
    undefined, {}, { domain: null }, { experienceLevel: 42, knownSkills: 'React' },
    { domain: 'TECHNOLOGY' }, { experienceLevel: 'no_programming', knownSkills: [] },
  ]
  for (const input of inputs) {
    const text = composeTeachingProtocol(input)
    assert.equal(typeof text, 'string')
    assert.ok(text.length > 500, 'the protocol came back suspiciously short')
    assert.doesNotMatch(text, /undefined|NaN|\[object Object\]/)
  }
  // Case-insensitive domains are a convenience, not a second source of truth.
  assert.equal(composeTeachingProtocol({ domain: 'technology' }), composeTeachingProtocol({ domain: 'TECHNOLOGY' }))
})

test('the injected block is bounded, so a live track is not taxed per turn', () => {
  const worst = teachingProtocolBlock({ domain: 'technology', experienceLevel: 'intermediate', knownSkills: ['React'] })
  assert.match(worst, /^## 教学协议/)
  assert.ok(worst.length < 6000, `the protocol block grew to ${worst.length} characters`)
  // The state block is what tells the model *what* to do; this one tells it how.
  assert.ok(worst.includes(composeTeachingProtocol({ domain: 'technology', experienceLevel: 'intermediate', knownSkills: ['React'] })))
})
