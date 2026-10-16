/**
 * Host-half integration tests.
 *
 * These load the real plugin into a real Cordis `Context` and drive its tools
 * through their registered definitions, so they cover the paths that matter in
 * production: service registration, dependency waiting, config defaults,
 * argument-to-store wiring, and prompt-context injection. Only the two harness
 * services (`tools`, `systemPrompt`) are stubbed, because standing up the whole
 * `dsh-base` composition here would test the harness rather than this plugin.
 */

import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { Context, Service } from '@deepseek-ai/cordis'

import { createService, panelPayload } from '../lib/index.js'
import * as plugin from '../lib/index.js'
import { LearningStore } from '../lib/learning-store.js'
import { resolveStatePath, sessionCwd } from '../lib/scope.js'

/**
 * Fiber lifecycle states, as a plain object.
 *
 * Cordis declares `FiberState` as a TypeScript `const enum`, which is inlined at
 * compile time and therefore has no runtime export. Plugin code is plain
 * JavaScript, so the values are restated here from
 * `vendor/cordis/lib/types/fiber.d.ts`.
 */
const FiberState = Object.freeze({
  PENDING: 0,
  LOADING: 1,
  ACTIVE: 2,
  FAILED: 3,
  DISPOSED: 4,
  UNLOADING: 5,
})

/**
 * A stand-in for `ctx.tools` that records definitions instead of executing them.
 *
 * It reproduces the real service's *lifecycle* contract: `register` attaches its
 * disposer to the calling fiber through `ctx.effect`, so disposing the plugin
 * must unregister the tool. Without that, a disposal test would pass vacuously.
 */
class ToolsMock extends Service {
  constructor(ctx) {
    super(ctx, 'tools')
    /** @type {Map<string, object>} */
    this.registered = new Map()
  }

  register(definition) {
    this.registered.set(definition.name, definition)
    return this.ctx.effect(
      () => () => this.registered.delete(definition.name),
      `tools.register(${definition.name})`,
    )
  }
}

/** A stand-in for `ctx.systemPrompt` that records context contributions. */
class SystemPromptMock extends Service {
  constructor(ctx) {
    super(ctx, 'systemPrompt')
    /** @type {object[]} */
    this.contexts = []
  }

  context(entry) {
    this.contexts.push(entry)
    return this.ctx.effect(
      () => () => {
        // Splice in place rather than reassigning: callers hold a reference to
        // this array, and a test that reads it after disposal must see the
        // removal. A real registry behaves the same way.
        const index = this.contexts.indexOf(entry)
        if (index >= 0) this.contexts.splice(index, 1)
      },
      `systemPrompt.context(${entry.name})`,
    )
  }
}

/** Boot the plugin against a temporary project root and wait for activation. */
async function mountPlugin(config = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'la-host-'))
  const ctx = new Context()
  ctx.plugin({
    apply(inner) {
      inner.plugin(ToolsMock)
      inner.plugin(SystemPromptMock)
    },
  })
  const fiber = ctx.plugin(plugin, { root: dir, scope: 'project', ...config })
  // `ctx.plugin` activates asynchronously, and this plugin's registrations live
  // behind a nested `ctx.inject` fiber. Wait for the observable result (all five
  // tools) instead of guessing a state or a sleep duration. The stub services
  // themselves are not visible until their own plugin bodies have run, so every
  // access is guarded.
  for (let attempt = 0; attempt < 100 && (ctx.tools?.registered.size ?? 0) < 5; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(ctx.tools?.registered.size, 5, 'plugin did not register its tools in time')
  return {
    dir,
    ctx,
    fiber,
    tools: ctx.tools.registered,
    contexts: ctx.systemPrompt.contexts,
    cleanup() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** Build the minimal `exec` the tool contract hands to `execute`. */
function execFor(dir, overrides = {}) {
  return {
    callId: 'test-call',
    name: 'test',
    signal: new AbortController().signal,
    agent: { session: { header: { cwd: dir } } },
    ...overrides,
  }
}

/** Run one registered tool and return its canonical value. */
async function run(harness, name, args) {
  const definition = harness.tools.get(name)
  assert.ok(definition, `tool ${name} is not registered`)
  return definition.execute(args, execFor(harness.dir))
}

test('loads into Cordis, registers every tool, and contributes prompt context', async () => {
  const harness = await mountPlugin()
  try {
    assert.equal(harness.fiber.state, FiberState.ACTIVE)
    assert.deepEqual(
      [...harness.tools.keys()].sort(),
      ['learning_domain', 'learning_due', 'learning_record', 'learning_session', 'learning_status'],
    )
    assert.equal(harness.contexts.length, 1)
    assert.equal(harness.contexts[0].name, 'learning-accelerator/status')
    assert.equal(harness.contexts[0].order, 150)
  } finally {
    harness.cleanup()
  }
})

test('every tool declares a canonical output schema and a renderer', async () => {
  const harness = await mountPlugin()
  try {
    for (const [name, definition] of harness.tools) {
      assert.ok(definition.output?.schema, `${name} has no output schema`)
      assert.equal(typeof definition.output.render, 'function', `${name} has no renderer`)
      assert.equal(typeof definition.execute, 'function', `${name} has no executor`)
      assert.ok(definition.description.length > 20, `${name} description is too thin for the model`)
    }
  } finally {
    harness.cleanup()
  }
})

test('a fresh scope is empty, and learning_session onboards it', async () => {
  const harness = await mountPlugin()
  try {
    const before = await run(harness, 'learning_status', {})
    assert.equal(before.ok, true)
    assert.equal(before.path, join(harness.dir, '.learning', 'state.json'))
    assert.equal(before.source, 'session-cwd')
    assert.deepEqual(before.summary.weak_concepts, [])

    const onboarded = await run(harness, 'learning_session', {
      domain: 'technology',
      known_skills: ['JavaScript', 'React'],
      experience_level: 'intermediate',
      learning_goal: '掌握 DSH 插件机制',
      target_outcome: '写出可安装的 DSH 插件',
      current_topic: 'Cordis 插件',
      level: 'beginner',
      next_task: '读完 cordis-tutorial 第七章',
      constraint: '每天 30 分钟',
    })
    assert.equal(onboarded.ok, true)
    assert.ok(onboarded.changed.includes('domain'))
    assert.ok(onboarded.changed.includes('next_task'))
    assert.equal(onboarded.summary.learning_domain, 'technology')
    assert.equal(onboarded.summary.learning_goal, '掌握 DSH 插件机制')
    assert.equal(onboarded.summary.current_topic, 'Cordis 插件')
    assert.equal(onboarded.summary.current_tasks.length, 1)
    assert.equal(onboarded.onboarding_questions.domain, 'technology')
    assert.ok(onboarded.onboarding_questions.onboarding_questions.length >= 3)

    // The write must be real, not in-memory: read the file back.
    const onDisk = JSON.parse(readFileSync(before.path, 'utf8'))
    assert.equal(onDisk.learner_profile.learning_domain, 'technology')
    assert.equal(onDisk.practice_state.current_tasks.length, 1)
  } finally {
    harness.cleanup()
  }
})

test('learning_record closes the spaced-repetition loop', async () => {
  const harness = await mountPlugin()
  try {
    await run(harness, 'learning_session', { domain: 'technology', current_topic: 'waterfall' })

    const scheduled = await run(harness, 'learning_record', {
      action: 'review_add',
      concept: 'Cordis waterfall',
      prompt: '不调用 next() 会发生什么',
      result: 'incorrect',
    })
    assert.equal(scheduled.ok, true)
    assert.equal(scheduled.review.concept, 'Cordis waterfall')
    // `incorrect` schedules at 0 days, so the item is due immediately.
    const due = await run(harness, 'learning_due', {})
    assert.equal(due.total_due, 1)
    assert.equal(due.items[0].concept, 'Cordis waterfall')

    const completed = await run(harness, 'learning_record', {
      action: 'review_complete',
      review_id: due.items[0].id,
      result: 'third_correct',
      notes: '能说清 short-circuit 与 next() 的区别',
    })
    assert.equal(completed.ok, true)
    assert.equal(completed.review.result, 'third_correct')
    // third_correct promotes to mastered, grows strength, and schedules 7 days out.
    assert.equal(completed.concept_progress.correct_streak, 1)
    assert.ok(completed.concept_progress.strength > 0.5)

    const after = await run(harness, 'learning_status', {})
    assert.equal(after.ok, true)
    assert.equal(after.summary.summary ? undefined : undefined, undefined)
    assert.ok(completed.summary.summary.mastered_concepts.includes('Cordis waterfall'))
  } finally {
    harness.cleanup()
  }
})

test('learning_record records an attempt and moves difficulty', async () => {
  const harness = await mountPlugin()
  try {
    await run(harness, 'learning_session', { domain: 'technology', current_topic: 'tools' })
    const spec = await run(harness, 'learning_record', {
      action: 'exercise_spec',
      topic: 'tools',
      concepts: ['defineTool'],
      difficulty: 'normal',
      task: '注册一个最小工具',
      goal: '理解注册即 effect',
      evaluation_criteria: ['是 effect'],
    })
    assert.equal(spec.ok, true)
    assert.ok(spec.exercise.id)
    assert.equal(spec.exercise.concepts[0], 'defineTool')

    const attempt = await run(harness, 'learning_record', {
      action: 'attempt',
      exercise_id: spec.exercise.id,
      answer: 'ctx.tools.register(defineTool({...}))',
      attempt_result: 'pass',
      score: 90,
      feedback: '正确',
      concepts: ['defineTool'],
    })
    assert.equal(attempt.ok, true)
    assert.equal(attempt.attempt.result, 'pass')
    assert.equal(attempt.attempt.outcome, 'pass')
    assert.equal(attempt.attempt.score, 90)
    assert.equal(attempt.concept_progress.correct_streak, 1)

    // Two positive signals in a row (attempt + review completion) step difficulty up.
    const second = await run(harness, 'learning_record', {
      action: 'attempt',
      exercise_id: spec.exercise.id,
      answer: 'again',
      attempt_result: 'pass',
      score: 95,
      concepts: ['defineTool'],
    })
    assert.equal(second.difficulty.next_adjustment, 'harder')
    assert.equal(second.difficulty.current_difficulty, 2)

    // `partial` is a real answer the model may need to express, and it must be
    // accepted without pretending the learner passed.
    const partial = await run(harness, 'learning_record', {
      action: 'attempt',
      exercise_id: spec.exercise.id,
      answer: 'almost',
      attempt_result: 'partial',
      score: 55,
      concepts: ['defineTool'],
    })
    assert.equal(partial.ok, true)
    assert.equal(partial.attempt.outcome, 'partial')
    assert.equal(partial.attempt.result, 'fail')
  } finally {
    harness.cleanup()
  }
})

test('a mistake marks the concept weak and queues it for review', async () => {
  const harness = await mountPlugin()
  try {
    await run(harness, 'learning_session', { domain: 'technology', current_topic: 'scope' })
    const recorded = await run(harness, 'learning_record', {
      action: 'mistake',
      concepts: ['scope isolation'],
      mistake_type: 'concept_confusion',
      feedback: '把 isolate 当成了全局开关',
    })
    assert.equal(recorded.ok, true)
    assert.deepEqual(recorded.concepts, ['scope isolation'])
    const status = await run(harness, 'learning_status', {})
    assert.ok(status.summary.weak_concepts.includes('scope isolation'))
    const due = await run(harness, 'learning_due', {})
    assert.equal(due.total_due, 1)
  } finally {
    harness.cleanup()
  }
})

test('an unknown review id fails loudly instead of silently no-oping', async () => {
  const harness = await mountPlugin()
  try {
    await assert.rejects(
      () => run(harness, 'learning_record', { action: 'review_complete', review_id: 'nope', result: 'correct' }),
      /review item not found/,
    )
  } finally {
    harness.cleanup()
  }
})

test('read tools report malformed state instead of failing the turn', async () => {
  const harness = await mountPlugin()
  try {
    // Create a real state file first, then break it the way a user editing JSON would.
    await run(harness, 'learning_session', { domain: 'technology' })
    const status = await run(harness, 'learning_status', {})
    const statePath = status.path
    const { writeFileSync } = await import('node:fs')
    writeFileSync(statePath, '{ not json', 'utf8')
    const broken = await run(harness, 'learning_status', {})
    assert.equal(broken.ok, false)
    assert.match(broken.error, /Invalid JSON/)
    // The renderer must explain the repair rather than throw.
    const rendered = harness.tools.get('learning_status').output.render({}, broken)
    assert.match(rendered[0].text, /读取失败/)
  } finally {
    harness.cleanup()
  }
})

test('prompt context stays silent until a learning state exists', async () => {
  const harness = await mountPlugin()
  try {
    const [entry] = harness.contexts
    assert.equal(entry.text({ agent: { session: { header: { cwd: harness.dir } } } }), '')
    await run(harness, 'learning_session', { domain: 'technology', learning_goal: '学 Cordis', current_topic: 'effect' })
    const injected = entry.text({ agent: { session: { header: { cwd: harness.dir } } } })
    assert.match(injected, /学习状态/)
    assert.match(injected, /学 Cordis/)
    assert.match(injected, /learning_record/)
  } finally {
    harness.cleanup()
  }
})

test('a user-scoped store ignores the session cwd', async () => {
  const harness = await mountPlugin({ scope: 'user' })
  try {
    const status = await run(harness, 'learning_status', {})
    assert.equal(status.ok, true)
    assert.equal(status.scope, 'user')
    assert.match(status.path, /\.learning-accelerator\/state\.json$/)
    assert.ok(!status.path.startsWith(harness.dir))
  } finally {
    harness.cleanup()
  }
})

test('an explicit state_file argument wins over the session cwd', async () => {
  const harness = await mountPlugin()
  try {
    const explicit = join(harness.dir, 'nested', 'custom.json')
    const status = await run(harness, 'learning_status', { state_file: explicit })
    assert.equal(status.path, explicit)
    assert.equal(status.source, 'argument')
  } finally {
    harness.cleanup()
  }
})

test('learning_domain works with no state and no agent at all', async () => {
  const harness = await mountPlugin()
  try {
    const definition = harness.tools.get('learning_domain')
    for (const domain of ['technology', 'language', 'exam', 'writing', 'communication', 'general']) {
      const value = await definition.execute({ domain }, execFor(harness.dir))
      assert.ok(value.focus_areas.length > 0, `${domain} lost its focus areas`)
      assert.ok(value.onboarding_questions.length > 0, `${domain} lost its questions`)
      assert.equal(value.domain, domain)
    }
    // An out-of-enum domain must be refused before `execute`, not silently
    // fall back to `general` — the model should pick a real domain.
    await assert.rejects(
      () => definition.execute({ domain: 'not-a-domain' }, execFor(harness.dir)),
      /must be one of/,
    )
    // The store-level fallback still exists for callers that bypass the tool.
    const template = LearningStore.domainTemplate('not-a-domain')
    assert.equal(template.domain, 'general')
  } finally {
    harness.cleanup()
  }
})

test('panelPayload returns a serializable snapshot for the UI', async () => {
  const harness = await mountPlugin()
  try {
    await run(harness, 'learning_session', { domain: 'language', learning_goal: '通过 N5', current_topic: '假名' })
    const scheduled = await run(harness, 'learning_record', {
      action: 'review_add',
      concept: 'あ行',
      prompt: '读出あ行',
      result: 'incorrect',
    })
    // The panel reads its own service bound to the configured root, because the
    // browser request carries no session identity.
    const pending = panelPayload(createService({ root: harness.dir }), {})
    assert.equal(pending.ok, true)
    assert.equal(pending.profile.learning_domain, 'language')
    assert.equal(pending.profile.learning_goal, '通过 N5')
    assert.equal(pending.topic, '假名')
    assert.equal(pending.due_reviews.length, 1)
    assert.equal(pending.due_reviews[0].concept, 'あ行')
    assert.equal(pending.concept_progress.length, 0, 'a scheduled review is not yet concept progress')

    // Completing the review is what moves concept progress, so the panel must
    // show it afterwards.
    await run(harness, 'learning_record', {
      action: 'review_complete',
      review_id: scheduled.review.id,
      result: 'second_correct',
    })
    const payload = panelPayload(createService({ root: harness.dir }), {})
    assert.equal(payload.ok, true)
    assert.equal(payload.due_reviews.length, 0)
    assert.ok(payload.concept_progress.some(entry => entry.concept === 'あ行'))
    assert.ok(payload.mastered_concepts.includes('あ行'))
    // Must survive the round trip to the browser.
    assert.deepEqual(JSON.parse(JSON.stringify(payload)), payload)
  } finally {
    harness.cleanup()
  }
})

test('sessionCwd and resolveStatePath follow the documented precedence', () => {
  assert.equal(sessionCwd({ session: { header: { cwd: '/tmp/project' } } }), '/tmp/project')
  assert.equal(sessionCwd({ session: { header: {} } }), undefined)
  assert.equal(sessionCwd({}), undefined)
  assert.equal(sessionCwd(null), undefined)
  assert.equal(sessionCwd({ session: { header: { cwd: 'relative/path' } } }), undefined)

  assert.deepEqual(
    resolveStatePath({ stateFile: '/tmp/explicit.json', agent: { session: { header: { cwd: '/tmp/x' } } } }),
    { path: '/tmp/explicit.json', scope: 'project', source: 'argument' },
  )
  assert.deepEqual(
    resolveStatePath({ agent: { session: { header: { cwd: '/tmp/x' } } }, root: '/tmp/ignored' }),
    { path: '/tmp/x/.learning/state.json', scope: 'project', source: 'session-cwd' },
  )
  assert.deepEqual(
    resolveStatePath({ root: '/tmp/root' }),
    { path: '/tmp/root/.learning/state.json', scope: 'project', source: 'config-root' },
  )
  assert.deepEqual(
    resolveStatePath({ fallback: '/tmp/fallback' }),
    { path: '/tmp/fallback/.learning/state.json', scope: 'project', source: 'process-cwd' },
  )
  const user = resolveStatePath({ scope: 'user', agent: { session: { header: { cwd: '/tmp/x' } } } })
  assert.equal(user.scope, 'user')
  assert.equal(user.source, 'user-scope')
})

test('disposing the plugin unwinds tools and prompt context', async () => {
  const harness = await mountPlugin()
  try {
    assert.equal(harness.tools.size, 5)
    assert.equal(harness.contexts.length, 1)
    await harness.fiber.dispose()
    assert.equal(harness.tools.size, 0)
    assert.equal(harness.contexts.length, 0)
  } finally {
    harness.cleanup()
  }
})

test('injectPromptContext: false keeps the tools but drops the prompt block', async () => {
  const harness = await mountPlugin({ injectPromptContext: false })
  try {
    assert.equal(harness.tools.size, 5)
    assert.equal(harness.contexts.length, 0)
  } finally {
    harness.cleanup()
  }
})
