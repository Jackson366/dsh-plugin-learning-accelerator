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
import { LearningStore, todayIso } from '../lib/learning-store.js'
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
    return this.ctx.effect(() => () => this.registered.delete(definition.name), `tools.register(${definition.name})`)
  }
}

/**
 * A stand-in for `ctx.webServer` that records registered routes.
 *
 * Same lifecycle contract as the real carrier: `register` attaches its disposer
 * to the calling fiber, so the route must disappear when the plugin is disposed.
 */
class WebServerMock extends Service {
  constructor(ctx) {
    super(ctx, 'webServer')
    /** @type {object[]} */
    this.routes = []
  }

  register(route) {
    this.routes.push(route)
    return this.ctx.effect(
      () => () => {
        const at = this.routes.indexOf(route)
        if (at >= 0) this.routes.splice(at, 1)
      },
      `webServer.register(${route.path})`,
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
      // Also stubbed so the optional `webServer` dependency resolves and the
      // panel route mounts; without it that fiber stays PENDING, which is the
      // correct behaviour in a headless composition and the reason the route is
      // not in the wait condition below.
      inner.plugin(WebServerMock)
    },
  })
  const fiber = ctx.plugin(plugin, { root: dir, scope: 'project', ...config })
  // `ctx.plugin` activates asynchronously, and this plugin's registrations live
  // behind a nested `ctx.inject` fiber. Wait for the observable result (all five
  // tools) instead of guessing a state or a sleep duration. The stub services
  // themselves are not visible until their own plugin bodies have run, so every
  // access is guarded.
  for (let attempt = 0; attempt < 100 && (ctx.tools?.registered.size ?? 0) < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal(ctx.tools?.registered.size, 5, 'plugin did not register its tools in time')
  // The route mounts on its own fiber, so it can land a tick after the tools.
  for (let attempt = 0; attempt < 100 && (ctx.webServer?.routes.length ?? 0) < 1; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return {
    dir,
    ctx,
    fiber,
    tools: ctx.tools.registered,
    contexts: ctx.systemPrompt.contexts,
    routes: ctx.webServer?.routes ?? [],
    cleanup() {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/** A response recorder implementing the subset the panel route calls. */
function createResponse() {
  const record = { status: undefined, headers: undefined, body: '', ended: false }
  return {
    record,
    writeHead(status, headers) {
      record.status = status
      record.headers = headers
    },
    end(chunk) {
      record.body = chunk ?? ''
      record.ended = true
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
    assert.deepEqual([...harness.tools.keys()].sort(), [
      'learning_audit',
      'learning_domain',
      'learning_due',
      'learning_record',
      'learning_session',
      'learning_status',
    ])
    assert.equal(harness.contexts.length, 2)
    const byName = Object.fromEntries(harness.contexts.map((entry) => [entry.name, entry]))
    assert.deepEqual(Object.keys(byName).sort(), ['learning-accelerator/protocol', 'learning-accelerator/status'])
    // The protocol sits one order above the state block: method before queue.
    assert.equal(byName['learning-accelerator/protocol'].order, 149)
    assert.equal(byName['learning-accelerator/status'].order, 150)
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
      result: 'correct',
      notes: '能说清 short-circuit 与 next() 的区别',
    })
    assert.equal(completed.ok, true)
    assert.equal(completed.review.result, 'correct')
    // The first correct answer cannot promote to mastery and schedules one day out.
    assert.equal(completed.concept_progress.correct_streak, 1)
    assert.ok(completed.concept_progress.strength > 0.5)

    const after = await run(harness, 'learning_status', {})
    assert.equal(after.ok, true)
    assert.equal(after.summary.summary ? undefined : undefined, undefined)
    assert.ok(!completed.summary.summary.mastered_concepts.includes('Cordis waterfall'))
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
    assert.equal(partial.attempt.result, 'partial')
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
      () =>
        run(harness, 'learning_record', {
          action: 'review_complete',
          review_id: 'nope',
          result: 'correct',
        }),
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
    const [entry] = harness.contexts.filter((item) => item.name === 'learning-accelerator/status')
    assert.equal(entry.text({ agent: { session: { header: { cwd: harness.dir } } } }), '')
    await run(harness, 'learning_session', {
      domain: 'technology',
      learning_goal: '学 Cordis',
      current_topic: 'effect',
    })
    const injected = entry.text({ agent: { session: { header: { cwd: harness.dir } } } })
    assert.match(injected, /学习状态/)
    assert.match(injected, /学 Cordis/)
    assert.match(injected, /learning_record/)
  } finally {
    harness.cleanup()
  }
})

test('the teaching protocol is injected once a track exists, adapted to the profile', async () => {
  const harness = await mountPlugin()
  try {
    const entry = harness.contexts.find((item) => item.name === 'learning-accelerator/protocol')
    assert.ok(entry, 'the protocol context was not registered')
    const read = () => entry.text({ agent: { session: { header: { cwd: harness.dir } } } })

    // Same gate as the state block: a directory with no learner costs nothing.
    assert.equal(read(), '')

    await run(harness, 'learning_session', {
      domain: 'technology',
      known_skills: ['JavaScript', 'React'],
      experience_level: 'intermediate',
      learning_goal: '掌握 DSH 插件机制',
      current_topic: 'Cordis 插件',
    })
    const frontend = read()
    assert.match(frontend, /教学协议/)
    assert.match(frontend, /本轮模式（只选一个）/)
    assert.match(frontend, /`onboarding`/)
    // A stated frontend background selects the frontend mapping table…
    assert.match(frontend, /Python dict \| JavaScript object \/ Map/)
    assert.doesNotMatch(frontend, /一份菜谱/)

    // …and a stated no-programming background selects the everyday analogies.
    await run(harness, 'learning_session', { experience_level: 'no_programming', known_skills: [] })
    const none = read()
    assert.match(none, /一份菜谱/)
    assert.doesNotMatch(none, /Python dict \| JavaScript object \/ Map/)

    // Unknown background must not be handed frontend analogies by default.
    await run(harness, 'learning_session', { experience_level: 'unknown', known_skills: [] })
    assert.doesNotMatch(read(), /Python dict \| JavaScript object \/ Map/)
  } finally {
    harness.cleanup()
  }
})

test('onboarding carries the protocol, because the first turn has no state file yet', async () => {
  const harness = await mountPlugin()
  try {
    // A brand-new directory: the prompt block is silent, so these two tools are
    // the only way the method reaches the first learning turn.
    const domain = await run(harness, 'learning_domain', { domain: 'language' })
    assert.match(domain.teaching_protocol, /教学协议/)
    assert.match(domain.teaching_protocol, /发音、词汇、句型/)

    const session = await run(harness, 'learning_session', {
      domain: 'language',
      experience_level: 'no_programming',
      learning_goal: '通过日语 N5',
    })
    assert.match(session.teaching_protocol, /一份菜谱/)
    assert.match(session.teaching_protocol, /发音、词汇、句型/)

    const rendered = harness.tools.get('learning_session').output.render({}, session)
    assert.match(rendered[0].text, /教学协议/, 'the renderer dropped the protocol the model needs')
    const renderedDomain = harness.tools.get('learning_domain').output.render({}, domain)
    assert.match(renderedDomain[0].text, /教学协议/)
  } finally {
    harness.cleanup()
  }
})

test('the panel route follows the session directory through the real wiring', async () => {
  // The regression this guards is a *wiring* bug, not a logic bug: `panelRequest`
  // resolved the session path correctly when called with no arguments, but `apply`
  // always handed it the configured `scope`, whose default is `'project'`. Since
  // any explicit scope means "stop following sessions", the panel silently fell
  // back to the configured root or the process directory. Only a test that goes
  // through `apply` and the route handler can see that.
  const harness = await mountPlugin()
  try {
    await run(harness, 'learning_session', {
      learning_goal: '面板跟随会话',
      current_topic: 'wiring',
    })

    const route = harness.routes.find((entry) => entry.path === '/learning-accelerator/panel')
    assert.ok(route, 'the panel route was not registered')
    const res = createResponse()
    route.handler({ headers: { host: '127.0.0.1:3080' }, method: 'GET' }, res)

    assert.equal(res.record.status, 200)
    const payload = JSON.parse(res.record.body)
    assert.equal(payload.ok, true)
    assert.equal(payload.path, join(harness.dir, '.learning', 'state.json'))
    // `argument`, not `session-cwd`: the panel resolves the session path itself
    // and then hands it to the store as an explicit file, which is what makes the
    // browser request reproducible.
    assert.equal(payload.source, 'argument')
  } finally {
    harness.cleanup()
  }
})

test('an explicitly configured scope still pins the panel', async () => {
  // The other half of the same contract: an operator who chooses a user-level
  // store must get it, rather than the session's project file.
  const harness = await mountPlugin({ scope: 'user' })
  try {
    const route = harness.routes.find((entry) => entry.path === '/learning-accelerator/panel')
    assert.ok(route, 'the panel route was not registered')
    const res = createResponse()
    route.handler({ headers: { host: '127.0.0.1:3080' }, method: 'GET' }, res)
    const payload = JSON.parse(res.record.body)
    assert.equal(payload.scope, 'user')
    assert.match(payload.path, /\.learning-accelerator\/state\.json$/)
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
    await assert.rejects(() => definition.execute({ domain: 'not-a-domain' }, execFor(harness.dir)), /must be one of/)
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
    await run(harness, 'learning_session', {
      domain: 'language',
      learning_goal: '通过 N5',
      current_topic: '假名',
    })
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
      result: 'correct',
    })
    const payload = panelPayload(createService({ root: harness.dir }), {})
    assert.equal(payload.ok, true)
    assert.equal(payload.due_reviews.length, 0)
    assert.ok(payload.concept_progress.some((entry) => entry.concept === 'あ行'))
    assert.ok(!payload.mastered_concepts.includes('あ行'))
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
    resolveStatePath({
      stateFile: '/tmp/explicit.json',
      agent: { session: { header: { cwd: '/tmp/x' } } },
    }),
    { path: '/tmp/explicit.json', scope: 'project', source: 'argument' },
  )
  assert.deepEqual(resolveStatePath({ agent: { session: { header: { cwd: '/tmp/x' } } }, root: '/tmp/ignored' }), {
    path: '/tmp/x/.learning/state.json',
    scope: 'project',
    source: 'session-cwd',
  })
  assert.deepEqual(resolveStatePath({ root: '/tmp/root' }), {
    path: '/tmp/root/.learning/state.json',
    scope: 'project',
    source: 'config-root',
  })
  assert.deepEqual(resolveStatePath({ fallback: '/tmp/fallback' }), {
    path: '/tmp/fallback/.learning/state.json',
    scope: 'project',
    source: 'process-cwd',
  })
  const user = resolveStatePath({
    scope: 'user',
    agent: { session: { header: { cwd: '/tmp/x' } } },
  })
  assert.equal(user.scope, 'user')
  assert.equal(user.source, 'user-scope')
})

test('disposing the plugin unwinds tools and both prompt contexts', async () => {
  const harness = await mountPlugin()
  try {
    assert.equal(harness.tools.size, 5)
    assert.equal(harness.contexts.length, 2)
    await harness.fiber.dispose()
    assert.equal(harness.tools.size, 0)
    assert.equal(harness.contexts.length, 0)
  } finally {
    harness.cleanup()
  }
})

test('injectPromptContext and injectProtocol are independent switches', async () => {
  // Neither block: the tools survive, the prompt stays untouched.
  const off = await mountPlugin({ injectPromptContext: false, injectProtocol: false })
  try {
    assert.equal(off.tools.size, 5)
    assert.equal(off.contexts.length, 0)
  } finally {
    off.cleanup()
  }

  // State off, method on: a learner who wants the protocol but not the queue.
  const methodOnly = await mountPlugin({ injectPromptContext: false })
  try {
    assert.deepEqual(
      methodOnly.contexts.map((entry) => entry.name),
      ['learning-accelerator/protocol'],
    )
  } finally {
    methodOnly.cleanup()
  }
})

/** Seed `count` due-today review items directly through the kernel. */
function seedDueReviews(harness, count) {
  const store = new LearningStore(join(harness.dir, '.learning', 'state.json'))
  store.reset()
  store.setTopic('limit regression')
  for (let index = 0; index < count; index += 1) {
    // `incorrect` schedules at 0 days, so every item is due today.
    store.addReview(`concept-${index}`, `prompt ${index}`, 'incorrect')
  }
  return store
}

test('learning_due honours a limit above the kernel default of five', async () => {
  // The kernel's `summary()` hardcodes `priorityReviews(limit = 5)`, so a tool
  // that sliced that 5-item list could never return more. Regression guard: the
  // tools rank the full queue through the store instead.
  const harness = await mountPlugin()
  try {
    seedDueReviews(harness, 7)

    const defaulted = await run(harness, 'learning_due', {})
    assert.equal(defaulted.total_due, 7, 'total_due must count the whole queue')
    assert.equal(defaulted.items.length, 5, 'the default limit is five')

    const widened = await run(harness, 'learning_due', { limit: 20 })
    assert.equal(widened.items.length, 7, 'limit must be able to exceed five')

    const narrowed = await run(harness, 'learning_due', { limit: 2 })
    assert.equal(narrowed.items.length, 2, 'limit must still narrow')
  } finally {
    harness.cleanup()
  }
})

test('learning_status due_limit is not silently capped at five', async () => {
  const harness = await mountPlugin()
  try {
    seedDueReviews(harness, 7)

    const widened = await run(harness, 'learning_status', { due_limit: 20 })
    assert.equal(widened.summary.priority_reviews.length, 7)

    const defaulted = await run(harness, 'learning_status', {})
    assert.equal(defaulted.summary.priority_reviews.length, 5)

    const narrowed = await run(harness, 'learning_status', { due_limit: 1 })
    assert.equal(narrowed.summary.priority_reviews.length, 1)
  } finally {
    harness.cleanup()
  }
})

test('learning_due reports a local calendar date, not a UTC one', async () => {
  // The kernel decides due-ness with a local `todayIso()`; echoing a UTC
  // `toISOString()` slice here would name a different day only for part of the
  // day. Pin the wall clock to an instant on the other side of that boundary,
  // or the guard below passes by accident whenever the two dates coincide.
  const RealDate = Date
  const harness = await mountPlugin()
  try {
    seedDueReviews(harness, 1)

    // Half an hour past local midnight east of Greenwich, half an hour before
    // it west of Greenwich. Real zones are offset by at least an hour, so the
    // UTC calendar day always falls on the neighbouring one.
    const offset = new RealDate().getTimezoneOffset()
    const probe = new RealDate()
    if (offset < 0) probe.setHours(0, 30, 0, 0)
    else if (offset > 0) probe.setHours(23, 30, 0, 0)
    const fixed = probe.getTime()

    const local = [
      String(probe.getFullYear()).padStart(4, '0'),
      String(probe.getMonth() + 1).padStart(2, '0'),
      String(probe.getDate()).padStart(2, '0'),
    ].join('-')
    const utc = new RealDate(fixed).toISOString().slice(0, 10)

    globalThis.Date = class extends RealDate {
      constructor(...args) {
        super(...(args.length > 0 ? args : [fixed]))
      }
      static now() {
        return fixed
      }
    }
    let value
    try {
      value = await run(harness, 'learning_due', {})
    } finally {
      globalThis.Date = RealDate
    }

    assert.equal(value.on_date, local)
    if (offset !== 0) {
      // Guards the regression itself: with the clock pinned across the date
      // boundary, a UTC derivation names the other day.
      assert.notEqual(value.on_date, utc)
    }
  } finally {
    globalThis.Date = RealDate
    harness.cleanup()
  }
})

test('exercise_spec persists the input field the schema declares', async () => {
  const harness = await mountPlugin()
  try {
    await run(harness, 'learning_session', { current_topic: 'DSH 插件' })
    const recorded = await run(harness, 'learning_record', {
      action: 'exercise_spec',
      topic: 'DSH 插件',
      concepts: ['defineTool'],
      difficulty: 'normal',
      task: '给 greet 工具加一个参数',
      input: 'ctx.tools.register(defineTool({ name: "greet" }))',
    })
    assert.equal(recorded.exercise.input, 'ctx.tools.register(defineTool({ name: "greet" }))')
    // `defineTool` normalizes the shorthand parameter map into JSON Schema, so
    // the declared field lives under `properties`.
    assert.ok(
      'input' in harness.tools.get('learning_record').parameters.properties,
      'learning_record must expose `input`',
    )
  } finally {
    harness.cleanup()
  }
})

test('the exercise action reaches recordExercise and emits a difficulty signal', async () => {
  // `recordExercise` is the only writer of `completed_exercises` /
  // `failed_exercises`, and it is what turns a finished practice into an
  // `exercise_completed` / `exercise_failed` signal. Before v0.2.1 no action
  // reached it, so both lists stayed empty for a tool-only learner.
  const harness = await mountPlugin()
  try {
    const done = await run(harness, 'learning_record', {
      action: 'exercise',
      task: '注册一个最小工具',
      exercise_status: 'completed',
      concepts: ['defineTool'],
      notes: '跑通了',
    })
    assert.equal(done.exercise_status, 'completed')
    assert.equal(done.exercise_record.completed_exercises.length, 1)
    assert.equal(done.exercise_record.failed_exercises.length, 0)
    assert.equal(done.exercise_record.completed_exercises[0].name, '注册一个最小工具')
    assert.equal(done.exercise_record.completed_exercises[0].status, 'completed')

    const failed = await run(harness, 'learning_record', {
      action: 'exercise',
      task: '卸载 cleanup 不生效',
      exercise_status: 'failed',
    })
    assert.equal(failed.exercise_record.completed_exercises.length, 1)
    assert.equal(failed.exercise_record.failed_exercises.length, 1)

    // Both practice logs are upserts by name: re-logging must not pile up.
    await run(harness, 'learning_record', {
      action: 'exercise',
      task: '注册一个最小工具',
      exercise_status: 'completed',
    })
    const state = new LearningStore(join(harness.dir, '.learning', 'state.json')).load()
    assert.equal(state.practice_state.completed_exercises.length, 1)

    // One completed + one failed is a mixed window, so difficulty holds.
    assert.equal(state.difficulty_state.next_adjustment, 'same')
    // The signal really was appended.
    assert.deepEqual(
      state.difficulty_state.evidence.map((entry) => entry.signal),
      ['exercise_completed', 'exercise_failed', 'exercise_completed'],
    )
  } finally {
    harness.cleanup()
  }
})

test('exercise requires a name and a legal status', async () => {
  const harness = await mountPlugin()
  try {
    await assert.rejects(() => run(harness, 'learning_record', { action: 'exercise' }), /exercise requires task/)
    // The harness validates declared parameters before `execute` runs, so an
    // illegal status never reaches the store's own guard. That is the stronger
    // guarantee, and it is what the model actually experiences.
    await assert.rejects(
      () =>
        run(harness, 'learning_record', {
          action: 'exercise',
          task: 'x',
          exercise_status: 'maybe',
        }),
      /"exercise_status" must be one of \["completed","failed"\]/,
    )
    const properties = harness.tools.get('learning_record').parameters.properties
    assert.deepEqual(properties.exercise_status.enum, ['completed', 'failed'])
    assert.ok(properties.action.enum.includes('exercise'))
  } finally {
    harness.cleanup()
  }
})

test('P0.1 rejects missing results, raw mastery, and contradictory attempts without altering state', async () => {
  const harness = await mountPlugin()
  try {
    const added = await run(harness, 'learning_record', {
      action: 'review_add', concept: 'TS generics', prompt: 'What is T?', result: 'incorrect',
    })
    const store = new LearningStore(join(harness.dir, '.learning', 'state.json'))
    const before = store.load()
    await assert.rejects(() => run(harness, 'learning_record', {
      action: 'review_complete', review_id: added.review.id,
    }), /requires result/)
    await assert.rejects(() => run(harness, 'learning_record', {
      action: 'review_complete', review_id: added.review.id, result: 'third_correct',
    }), /requires result/)
    await assert.rejects(() => run(harness, 'learning_record', {
      action: 'exercise', task: 'unfinished',
    }), /requires exercise_status/)
    await assert.rejects(() => run(harness, 'learning_record', {
      action: 'concept', concept: 'TS generics', status: 'mastered',
    }), /direct mastery promotion/)
    assert.deepEqual(store.load(), before)
    const audit = await run(harness, 'learning_audit', {})
    assert.ok(audit.items.filter(x => x.status === 'rejected').length >= 4)
  } finally { harness.cleanup() }
})

test('P0.1 derives second correct only after a completed first correct', async () => {
  const harness = await mountPlugin()
  try {
    const added = await run(harness, 'learning_record', {
      action: 'review_add', concept: 'TS generics', prompt: 'Explain extends', result: 'incorrect',
    })
    const first = await run(harness, 'learning_record', {
      action: 'review_complete', review_id: added.review.id, result: 'correct',
    })
    assert.equal(first.review.result, 'correct')
    assert.equal(first.concept_progress.correct_streak, 1)
    await assert.rejects(() => run(harness, 'learning_record', {
      action: 'review_complete', review_id: added.review.id, result: 'correct',
    }), /not due/)
    const store = new LearningStore(join(harness.dir, '.learning', 'state.json'))
    const snapshot = store.load()
    snapshot.review_state.next_review_items.find(x => x.id === added.review.id).due_at = todayIso()
    store.save(snapshot)
    const second = await run(harness, 'learning_record', {
      action: 'review_complete', review_id: added.review.id, result: 'correct',
    })
    assert.equal(second.review.result, 'second_correct')
    assert.equal(second.concept_progress.correct_streak, 2)
    assert.ok(second.summary.summary.mastered_concepts.includes('TS generics'))
  } finally { harness.cleanup() }
})

test('P0.2 audit logs evidence references and before/after deltas but never raw answers', async () => {
  const harness = await mountPlugin()
  try {
    const spec = await run(harness, 'learning_record', {
      action: 'exercise_spec', topic: 'TS', concepts: ['generics'],
      difficulty: 'normal', task: 'Write generic',
    })
    const result = await run(harness, 'learning_record', {
      action: 'attempt', exercise_id: spec.exercise.id,
      answer: 'PRIVATE ANSWER MUST NOT APPEAR IN AUDIT',
      attempt_result: 'partial', score: 58, concepts: ['generics'],
      evidence_ref: 'test-run-112', evaluation_reason: 'Partial understanding',
      request_id: 'model-run-42',
    })
    assert.equal(result.attempt.result, 'partial')
    assert.equal(result.audit.status, 'committed')
    const audit = await run(harness, 'learning_audit', { limit: 20 })
    const entry = audit.items.find(x => x.event_id === result.audit.event_id && x.status === 'committed')
    assert.ok(entry)
    assert.equal(entry.evidence_ref, 'test-run-112')
    assert.equal(entry.request_id, 'model-run-42')
    assert.equal(entry.evidence_kind, 'model_reference_unverified')
    assert.equal(entry.validated_result, 'partial')
    assert.equal(entry.changes.after.attempts, entry.changes.before.attempts + 1)
    assert.ok(!readFileSync(audit.path, 'utf8').includes('PRIVATE ANSWER MUST NOT APPEAR IN AUDIT'))
    assert.equal(JSON.parse(readFileSync(result.path, 'utf8')).schema_version, 1)
  } finally { harness.cleanup() }
})
