/**
 * Browser-half tests.
 *
 * The client bundle is a classic script that talks to browser globals, so it
 * cannot be imported. Instead this file builds the smallest browser stand-in the
 * bundle actually touches — `window.__ModuleLoader__`, a `document` that accepts a
 * style tag, and a React stub with a real recursive renderer — then loads the
 * bundle text through that sink and drives the returned plugin.
 *
 * The renderer is deliberately honest about the three behaviours these
 * components depend on: a function component is actually invoked, hook state
 * survives a re-render at the same position, and a setter called from an effect
 * schedules another pass. A lazier stub (rendering one level, or ignoring
 * setState) would let a component that never re-renders pass — which is exactly
 * the bug that would otherwise only appear in the running GUI.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const CLIENT_PATH = join(import.meta.dirname, '..', 'lib', 'client.js')
const PACKAGE_NAME = 'dsh-plugin-learning-accelerator'

/**
 * A React stand-in for single-component render tests.
 *
 * Design choice worth stating: it evaluates exactly one hook-owning component —
 * the one under test — and resolves any *nested* function component eagerly
 * inside `createElement`, so a child never consumes a hook slot. That mirrors
 * this plugin's actual structure (only `PanelBody` and `SidebarEntry` use hooks;
 * every helper below them is a pure presenter) and keeps hook indexing
 * unambiguous.
 *
 * Nested components are still *invoked*, so a throw inside one fails the test,
 * and a component that never re-renders still fails: state is positional per
 * root, and a setter called from an effect schedules another pass.
 */
function createRenderer() {
  const roots = new Map()
  const hooks = { root: null, cursor: 0, effects: [] }

  function rootFor(id) {
    if (!roots.has(id)) roots.set(id, { states: [], effects: new Map(), dirty: false })
    return roots.get(id)
  }

  /** Reduce an already-created element tree to plain, hook-free tree nodes. */
  function renderNode(node) {
    if (node === null || node === undefined || node === false || node === true) return null
    if (typeof node === 'string' || typeof node === 'number') return node
    if (Array.isArray(node)) return node.map(renderNode)
    if (typeof node === 'object' && 'props' in node) {
      return {
        type: typeof node.type === 'function' ? (node.type.displayName ?? 'Component') : node.type,
        props: { ...node.props, children: renderNode(node.props.children) },
      }
    }
    return null
  }

  const react = {
    createElement(type, props, ...children) {
      const resolved = children.length <= 1 ? children[0] : children
      // Resolve nested function components now: they are presenters, so they may
      // not use hooks, and the root keeps an unambiguous hook cursor.
      if (typeof type === 'function' && !type.__isPrimitiveStub) {
        return renderNode(type({ ...(props ?? {}), children: resolved }))
      }
      return { type, props: { ...(props ?? {}), children: resolved } }
    },
    useState(initial) {
      const root = hooks.root
      const index = hooks.cursor
      hooks.cursor += 1
      if (root.states[index] === undefined) {
        root.states[index] = typeof initial === 'function' ? initial() : initial
      }
      return [root.states[index], (next) => {
        const value = typeof next === 'function' ? next(root.states[index]) : next
        root.states[index] = value
        root.dirty = true
      }]
    },
    useEffect(effect, deps) {
      const root = hooks.root
      const index = hooks.cursor
      hooks.cursor += 1
      const previous = root.effects.get(index)
      // React's dependency comparison, and it is load-bearing here: without it a
      // data effect would re-run on every pass, and its own setState would
      // re-dirty the root forever instead of settling.
      const same = previous !== undefined
        && Array.isArray(deps)
        && Array.isArray(previous.deps)
        && deps.length === previous.deps.length
        && deps.every((value, position) => Object.is(value, previous.deps[position]))
      if (same) return
      // A re-running effect cleans up its previous run first — this is what stops
      // an in-flight fetch from being abandoned on a re-render.
      if (typeof previous?.cleanup === 'function') previous.cleanup()
      hooks.effects.push({ index, deps, effect })
    },
    useCallback(fn, _deps) {
      return fn
    },
  }

  /**
   * Render the hook-owning component once and run the effects that fired.
   *
   * Only one synchronous pass runs, so an effect that awaits a promise leaves it
   * in flight — exactly as React does. The caller yields to the event loop and
   * calls this again to observe the updated state.
   */
  function render(id, component, props) {
    const root = rootFor(id)
    root.dirty = false
    hooks.root = root
    hooks.cursor = 0
    hooks.effects = []
    const tree = renderNode(component(props))
    hooks.root = null
    for (const { index, deps, effect } of hooks.effects) {
      const cleanup = effect()
      root.effects.set(index, { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined })
    }
    return tree
  }

  return { react, render }
}

/** The UI primitives the bundle requires, stubbed to leaf elements. */
function createPrimitivesStub() {
  const stub = (name) => {
    const component = function Stub(props) {
      return { type: component, props: props ?? {} }
    }
    component.__isPrimitiveStub = true
    component.displayName = `Primitives.${name}`
    return component
  }
  return new Proxy({}, {
    get(_target, key) {
      if (typeof key !== 'string') return undefined
      // Anything the bundle reaches for (buttons, pills, icons) becomes a leaf.
      return stub(key)
    },
  })
}

/** The locale dictionaries the bundle registers, captured for assertions. */
function createLocaleStub(captured, locale = 'zh') {
  return {
    register(namespace, dictionaries) {
      captured.push({ namespace, dictionaries })
      return () => {}
    },
    bind(namespace) {
      return (key) => {
        const entry = captured.find(candidate => candidate.namespace === namespace)
        return entry?.dictionaries?.[locale]?.[key] ?? key
      }
    },
  }
}

/** Slots stub: captures registrations and runs `inject` callbacks synchronously. */
function createSlotsStub(captured) {
  return {
    inject(key, callback) {
      assert.equal(typeof callback, 'function', 'slots.inject requires a callback')
      // A real registry runs the callback once the declaration is live; here the
      // declaration is already live, so run it immediately.
      const disposer = callback()
      captured.injected.push({ key, disposer })
      return () => {
        if (typeof disposer === 'function') disposer()
      }
    },
    register(options, component) {
      captured.registered.push({ options, component })
      return () => {}
    },
  }
}

/** Build one isolated module-table load of the bundle. */
function loadBundle({ fetchImpl, locale = 'zh' } = {}) {
  const captured = { registered: [], injected: [], locales: [] }
  const renderer = createRenderer()

  const handoffs = []
  const sink = { load: (handoff) => handoffs.push(handoff) }
  const styleTags = []
  const document = {
    head: { appendChild: (node) => styleTags.push(node) },
    createElement: (tag) => ({
      tag,
      attributes: {},
      textContent: '',
      setAttribute(key, value) { this.attributes[key] = value },
    }),
    querySelector: () => null,
  }

  const sandbox = {
    window: { __ModuleLoader__: sink },
    document,
    fetch: fetchImpl ?? (async () => { throw new Error('unexpected fetch') }),
    console,
  }
  sandbox.globalThis = sandbox

  vm.runInNewContext(readFileSync(CLIENT_PATH, 'utf8'), sandbox, { filename: 'client.js' })
  assert.equal(handoffs.length, 1, 'bundle must register exactly one handoff')
  const [handoff] = handoffs

  const modules = {
    react: renderer.react,
    '@deepseek-ai/dsh-client-ui-primitives': createPrimitivesStub(),
  }
  const exports = handoff.factory((specifier) => {
    if (!(specifier in modules)) throw new Error(`unexpected require: ${specifier}`)
    return modules[specifier]
  })

  const ctx = {
    effect: (fn) => fn(),
    locale: createLocaleStub(captured.locales, locale),
    slots: createSlotsStub(captured),
  }

  /** Apply the plugin, then reach the component registered for one slot. */
  function mount() {
    exports.apply(ctx)
    return {
      componentFor(slot) {
        const entry = captured.registered.find(candidate => candidate.options.name === slot)
        assert.ok(entry, `${slot} was not registered`)
        return entry.component
      },
    }
  }

  return { handoff, exports, ctx, captured, renderer, styleTags, mount }
}

/** Collect every string in a rendered tree, for content assertions. */
function textOf(node, out = []) {
  if (node === null || node === undefined || node === false || node === true) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) textOf(child, out)
    return out
  }
  if (typeof node === 'object' && 'props' in node) textOf(node.props.children, out)
  return out
}

/** A realistic successful panel payload. */
function samplePayload() {
  return {
    ok: true,
    generated_at: '2026-10-16T12:00:00.000Z',
    path: '/tmp/project/.learning/state.json',
    scope: 'project',
    source: 'config-root',
    profile: {
      learning_domain: 'technology',
      learning_goal: '掌握 DSH 插件机制',
      target_outcome: '写出可安装的 DSH 插件',
      known_skills: ['JavaScript'],
      level: 'beginner',
    },
    topic: 'Cordis 插件',
    difficulty: { current: 2, next_adjustment: 'harder' },
    mastered_concepts: ['effect'],
    weak_concepts: ['waterfall 语义'],
    due_reviews: [{ id: 'r1', concept: 'waterfall 语义', prompt: '不调用 next() 会怎样', due_at: '2026-10-16' }],
    priority_reviews: [{ id: 'r1', concept: 'waterfall 语义', prompt: '不调用 next() 会怎样', priority: 70, strength: 0.3 }],
    concept_progress: [{ concept: 'waterfall 语义', strength: 0.3, failure_count: 2 }],
    current_tasks: [{ id: 't1', name: '读完 cordis-tutorial 第七章' }],
    counts: { exercises: 1, attempts: 2, mastered: 1, weak: 1, due: 1 },
  }
}

/** Wait one macrotask so a resolved fetch can settle. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

/**
 * The copy the components should render, read back out of the bundle's own
 * registration rather than duplicated here. A key the bundle forgot to define
 * surfaces as the raw key, which is what the assertions then fail on.
 */
function stringsFor(locale) {
  const { captured, mount } = loadBundle()
  mount()
  return captured.locales[0].dictionaries[locale]
}

const ZH = stringsFor('zh')
const EN = stringsFor('en')

test('the bundle registers under its package name and exports a cordis object plugin', () => {
  const { handoff, exports } = loadBundle()
  assert.equal(handoff.id, PACKAGE_NAME, 'handoff id must equal the package name')
  assert.equal(typeof handoff.factory, 'function')
  assert.equal(exports.name, 'learning-accelerator')
  // Spread first: the bundle's array comes from the VM realm.
  assert.deepEqual([...exports.inject], ['slots', 'locale'])
  assert.equal(typeof exports.apply, 'function')
})

test('apply registers both slots with the declared options and a locale thunk', () => {
  const { mount, captured } = loadBundle()
  mount()

  const view = captured.registered.find(entry => entry.options.name === 'conversation.view')
  assert.ok(view, 'conversation.view was not registered')
  assert.equal(view.options.id, 'learning')
  assert.equal(view.options.order, 30)
  assert.equal(view.options.locale, 'learning-accelerator')
  // The label must be a thunk, so it follows a locale change.
  assert.equal(typeof view.options.label, 'function')
  assert.equal(view.options.label(), '学习')

  const sidebar = captured.registered.find(entry => entry.options.name === 'sidebar.footer.action')
  assert.ok(sidebar, 'sidebar.footer.action was not registered')
  assert.equal(sidebar.options.id, 'learning')
  assert.equal(sidebar.options.order, 100)

  // Both registrations must wait for their slot declaration.
  assert.deepEqual(captured.injected.map(entry => entry.key).sort(), ['conversation.view', 'sidebar.footer.action'])

  // Both built-in locales must be registered, or the `locale: NS` registration
  // would throw at assembly time.
  assert.equal(captured.locales.length, 1)
  assert.deepEqual(Object.keys(captured.locales[0].dictionaries).sort(), ['en', 'zh'])
})

test('the panel requests exactly the path the host route serves', async () => {
  const seen = []
  const { mount, renderer } = loadBundle({
    fetchImpl: async (url) => {
      seen.push(url)
      return { ok: true, json: async () => samplePayload() }
    },
  })
  const { componentFor } = mount()
  renderer.render('view', componentFor('conversation.view'), { t: (key) => key })
  await settle()
  assert.deepEqual(seen, ['/learning-accelerator/panel'])
})

test('the panel renders the learner state once the fetch resolves', async () => {
  const { mount, renderer } = loadBundle({
    fetchImpl: async () => ({ ok: true, json: async () => samplePayload() }),
  })
  const { componentFor } = mount()
  const slot = componentFor('conversation.view')
  const t = (key) => ZH[key] ?? key

  // The first pass is the loading frame: no fetch has resolved yet.
  const loading = textOf(renderer.render('view', slot, { t })).join(' ')
  assert.match(loading, /正在读取学习状态/)

  await settle()
  const ready = textOf(renderer.render('view', slot, { t })).join(' ')

  assert.match(ready, /掌握 DSH 插件机制/, 'goal missing')
  assert.match(ready, /Cordis 插件/, 'topic missing')
  assert.match(ready, /waterfall 语义/, 'weak concept missing')
  assert.match(ready, /不调用 next\(\) 会怎样/, 'review prompt missing')
  assert.match(ready, /读完 cordis-tutorial 第七章/, 'next task missing')
  assert.match(ready, /\/tmp\/project\/\.learning\/state\.json/, 'state path missing')
  assert.match(ready, /学习加速器/, 'panel title missing')
  assert.notEqual(ready, loading)
})

test('an empty scope explains itself instead of rendering a blank frame', async () => {
  const { mount, renderer } = loadBundle({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        ok: true,
        path: '/tmp/empty/.learning/state.json',
        profile: { learning_domain: 'general', level: 'beginner' },
        topic: '',
        difficulty: { current: 1, next_adjustment: 'same' },
        mastered_concepts: [],
        weak_concepts: [],
        due_reviews: [],
        priority_reviews: [],
        concept_progress: [],
        current_tasks: [],
        counts: {},
      }),
    }),
  })
  const { componentFor } = mount()
  const slot = componentFor('conversation.view')
  renderer.render('view', slot, { t: (key) => key })
  await settle()
  const text = textOf(renderer.render('view', slot, { t: (key) => key })).join(' ')
  assert.match(text, /panel\.empty/)
  assert.match(text, /\/tmp\/empty\/\.learning\/state\.json/)
})

test('a malformed state file renders the host error, not a crash', async () => {
  const { mount, renderer } = loadBundle({
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ ok: false, error: 'Invalid JSON in /tmp/x: Unexpected token', path: '/tmp/x' }),
    }),
  })
  const { componentFor } = mount()
  const slot = componentFor('conversation.view')
  renderer.render('view', slot, { t: (key) => key })
  await settle()
  const text = textOf(renderer.render('view', slot, { t: (key) => key })).join(' ')
  assert.match(text, /error\.state/)
  assert.match(text, /Invalid JSON/)
  assert.match(text, /\/tmp\/x/)
})

test('a missing route is reported as a route problem, not a state problem', async () => {
  const { mount, renderer } = loadBundle({
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) }),
  })
  const { componentFor } = mount()
  const slot = componentFor('conversation.view')
  renderer.render('view', slot, { t: (key) => key })
  await settle()
  const text = textOf(renderer.render('view', slot, { t: (key) => key })).join(' ')
  assert.match(text, /error\.route/)
  assert.match(text, /404/)
})

test('the sidebar entry survives an unreachable route and stays accessible', async () => {
  const { mount, renderer } = loadBundle({
    fetchImpl: async () => { throw new Error('ECONNREFUSED') },
  })
  const { componentFor } = mount()
  const slot = componentFor('sidebar.footer.action')

  renderer.render('sidebar', slot, { t: (key) => key, wide: true })
  await settle()
  const wide = renderer.render('sidebar', slot, { t: (key) => key, wide: true })
  const rail = renderer.render('sidebar', slot, { t: (key) => key, wide: false })

  const wideText = textOf(wide).join(' ')
  assert.match(wideText, /sidebar\.label/)
  assert.equal(wideText.includes('ECONNREFUSED'), false, 'a transport error is not panel copy')
  // The collapsed rail hides the visible label but keeps the accessible name.
  assert.equal(textOf(rail).join(" ").includes("sidebar.label"), false)
  assert.match(String(rail.props.title), /sidebar\.none/)
})

test('the sidebar entry shows the due count as a badge', async () => {
  const { mount, renderer } = loadBundle({
    fetchImpl: async () => ({ ok: true, json: async () => samplePayload() }),
  })
  const { componentFor } = mount()
  const slot = componentFor('sidebar.footer.action')
  const t = (key) => ZH[key] ?? key
  renderer.render('sidebar', slot, { t, wide: true })
  await settle()
  const tree = renderer.render('sidebar', slot, { t, wide: true })
  // Label plus badge, with the badge contributing no separator of its own.
  assert.equal(textOf(tree).join(' '), '学习 1', 'expected the label followed by the due badge')
  assert.match(String(tree.props.title), /waterfall 语义/, 'tooltip should name the priority concepts')
})

test('the style tag is claimed with a data-plugin-css id for HMR cleanup', () => {
  const { styleTags } = loadBundle()
  assert.equal(styleTags.length, 1)
  assert.equal(styleTags[0].attributes['data-plugin-css'], 'dsh-learning-accelerator')
  // Every colour must come from a semantic token, so both themes work unchanged.
  const css = styleTags[0].textContent
  assert.ok(css.includes('var(--dsw-alias-label-primary)'))
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false, 'literal hex colours are not themeable')
  assert.equal(/\brgb\(|\bhsl\(/.test(css), false, 'literal colour functions are not themeable')
})

test('the English locale renders when English is active', async () => {
  const { mount, renderer } = loadBundle({
    fetchImpl: async () => ({ ok: true, json: async () => samplePayload() }),
    locale: 'en',
  })
  const { componentFor } = mount()
  const slot = componentFor('conversation.view')
  const t = (key) => EN[key] ?? key
  renderer.render('view', slot, { t })
  await settle()
  const text = textOf(renderer.render('view', slot, { t })).join(' ')
  assert.match(text, /Learning Accelerator/)
  assert.match(text, /Priority reviews/)
})

test('a component without a t prop still renders (defensive default)', async () => {
  const { mount, renderer } = loadBundle({
    fetchImpl: async () => ({ ok: true, json: async () => samplePayload() }),
  })
  const { componentFor } = mount()
  const slot = componentFor('conversation.view')
  renderer.render('view', slot, {})
  await settle()
  const text = textOf(renderer.render('view', slot, {})).join(' ')
  assert.match(text, /panel\.title/)
})
