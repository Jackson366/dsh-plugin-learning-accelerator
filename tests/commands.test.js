import assert from 'node:assert/strict'
import test from 'node:test'

import { executeLearnCommand, registerLearnCommand } from '../lib/commands.js'

function fixture() {
  const calls = []
  const summary = {
    learning_domain: 'technology',
    current_topic: 'TypeScript',
    learning_goal: '写一个 Agent',
    current_difficulty: 2,
    mastered_concepts: ['变量'],
    weak_concepts: ['泛型'],
    due_reviews: [{ id: 'r1', concept: '泛型', due_at: '2026-10-19', prompt: '解释 T 的作用', priority: 65 }],
    exercise_specs: [{ id: 'e1', task: '写泛型函数', difficulty: 'normal' }],
    current_tasks: [{ name: '完成第一节' }],
  }
  let topic = summary.current_topic
  const store = {
    setTopic(next) {
      topic = next
      calls.push(['setTopic', next])
    },
    priorityReviews() {
      return summary.due_reviews
    },
    load() {
      return {
        practice_state: {
          last_code_errors: [{ concept: '泛型', recorded_at: '2026-10-19', detail: '类型参数理解错误' }],
        },
      }
    },
  }
  const service = {
    storeFor(request) {
      calls.push(['storeFor', request])
      return { store, path: '/proj/.learning/state.json' }
    },
    summarize(request) {
      calls.push(['summarize', request])
      return { ok: true, path: '/proj/.learning/state.json', summary: { ...summary, current_topic: topic } }
    },
  }
  const agent = { session: { header: { cwd: '/proj' } } }
  const run = (rawInput, extra = {}) => executeLearnCommand(service, {}, { agent, rawInput, ...extra })
  return { calls, agent, service, run }
}

test('registers one human-only command with the actual DSH descriptor shape', () => {
  const { service } = fixture()
  let definition
  registerLearnCommand(
    {
      commands: {
        register(next) {
          definition = next
          return () => {}
        },
      },
    },
    service,
  )
  assert.equal(definition.name, 'learn')
  assert.equal(typeof definition.handler, 'function')
  assert.equal(definition.handler({ rawInput: ' help' }).kind, 'success')
})

test('start persists topic in the invoking agent scope without deleting progress', () => {
  const { run, calls, agent } = fixture()
  const result = run(' start TypeScript 泛型')
  assert.equal(result.kind, 'success')
  assert.match(result.text, /已设置当前学习主题：TypeScript 泛型/)
  assert.deepEqual(calls[0], ['storeFor', { stateFile: undefined, scope: undefined, agent }])
  assert.deepEqual(calls[1], ['setTopic', 'TypeScript 泛型'])
  assert.match(run(' status').text, /TypeScript 泛型/)
})

test('status, review, practice, mistakes use the same persisted summary', () => {
  const { run } = fixture()
  for (const command of ['status', 'review', 'practice', 'mistakes']) {
    const result = run(` ${command}`)
    assert.equal(result.kind, 'success', command)
    assert.match(result.text, /泛型/, command)
    assert.match(result.text, /\.learning\/state\.json/, command)
  }
  assert.match(run(' review').text, /解释 T 的作用/)
  assert.match(run(' practice').text, /写泛型函数/)
  assert.match(run(' mistakes').text, /类型参数理解错误/)
})

test('rejects invalid subcommands and arguments without touching the state', () => {
  const { run, calls } = fixture()
  for (const text of [' start', ' start ' + 'x'.repeat(161), ' start topic\nother', ' status extra', ' nope']) {
    assert.equal(run(text).kind, 'error', text)
  }
  assert.equal(calls.length, 0)
  assert.match(run('').text, /\/learn start/)
})

test('cancellation stops a start command before mutation', () => {
  const { run, calls } = fixture()
  assert.equal(run(' start unsafe', { signal: { aborted: true } }).kind, 'error')
  assert.equal(calls.length, 0)
})

test('respects explicit stateFile configuration and handles corrupt files', () => {
  const { service, agent, calls } = fixture()
  const configured = executeLearnCommand(service, { stateFile: '/fixed/state.json', scope: 'user' }, { agent, rawInput: ' status' })
  assert.equal(configured.kind, 'success')
  assert.deepEqual(calls[0][1], { stateFile: '/fixed/state.json', scope: 'user', agent })
  const malformed = { summarize: () => ({ ok: false, error: 'Invalid JSON', path: '/broken' }) }
  assert.match(executeLearnCommand(malformed, {}, { rawInput: ' status' }).text, /Invalid JSON/)
})
