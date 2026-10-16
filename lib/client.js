/**
 * dsh-plugin-learning-accelerator — browser half.
 *
 * ## Why this file looks unusual
 *
 * A DSH client bundle is **not** an ES module. The host serves it as a classic
 * `<script>`, and the browser-side module table calls the registered factory to
 * get the plugin exports. So there is no top-level `import`/`export` here, and no
 * build step: `React` and the UI primitives come from the module table through
 * the `require` the factory receives, and rendering uses `React.createElement`
 * rather than JSX.
 *
 * `id` must equal the package name — the loader matches the registration against
 * the graph row it is loading, and throws when they differ.
 *
 * ## What it adds
 *
 * - a `conversation.view` tab ("学习") showing the learner's profile, priority
 *   review queue, and weakest concepts, read from the host route
 *   `/learning-accelerator/panel`;
 * - a `sidebar.footer.action` entry showing how many reviews are due.
 *
 * Both are honest about failure: a missing route, a malformed state file, or a
 * dead host renders an explanation in the panel instead of an empty frame.
 *
 * @see ../lib/panel-route.js for the host side of the route.
 */

/* eslint-disable no-undef -- browser globals; this file has no bundler or linter stage */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-learning-accelerator',
  factory: (require) => {
    const React = require('react')
    const Primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const { createElement: h } = React

    /** Locale namespace for this plugin's strings. */
    const NS = 'learning-accelerator'

    /** Panel snapshot route, mirroring `lib/panel-route.js#PANEL_ROUTE`. */
    const PANEL_ENDPOINT = '/learning-accelerator/panel'

    const STRINGS = {
      zh: {
        'view.learning': '学习',
        'panel.title': '学习加速器',
        'panel.refresh': '刷新',
        'panel.loading': '正在读取学习状态…',
        'panel.empty': '这个学习空间还没有状态文件。开始一次学习对话，或者让 agent 调用 learning_session 建档。',
        'panel.goal': '目标',
        'panel.topic': '当前主题',
        'panel.difficulty': '难度',
        'panel.priority': '优先复习',
        'panel.noReview': '现在没有到期复习项。',
        'panel.weak': '薄弱点',
        'panel.noWeak': '暂无薄弱点记录。',
        'panel.tasks': '下一步任务',
        'panel.progress': '概念进度',
        'panel.strength': '掌握度',
        'panel.failures': '失败',
        'panel.file': '状态文件',
        'panel.counts': '练习',
        'panel.attempts': '尝试',
        'panel.due': '到期',
        'sidebar.label': '学习',
        'sidebar.none': '学习：暂无到期复习',
        'error.route': '读不到面板数据：宿主路由未挂载或已被拒绝。',
        'error.state': '学习状态文件解析失败',
      },
      en: {
        'view.learning': 'Learning',
        'panel.title': 'Learning Accelerator',
        'panel.refresh': 'Refresh',
        'panel.loading': 'Reading learning state…',
        'panel.empty': 'No state file in this learning scope yet. Start a learning turn, or have the agent call learning_session.',
        'panel.goal': 'Goal',
        'panel.topic': 'Topic',
        'panel.difficulty': 'Difficulty',
        'panel.priority': 'Priority reviews',
        'panel.noReview': 'Nothing is due right now.',
        'panel.weak': 'Weak concepts',
        'panel.noWeak': 'No weak concepts recorded.',
        'panel.tasks': 'Next tasks',
        'panel.progress': 'Concept progress',
        'panel.strength': 'Strength',
        'panel.failures': 'Failures',
        'panel.file': 'State file',
        'panel.counts': 'Exercises',
        'panel.attempts': 'Attempts',
        'panel.due': 'Due',
        'sidebar.label': 'Learning',
        'sidebar.none': 'Learning: nothing due',
        'error.route': 'Panel data unavailable: the host route is missing or was refused.',
        'error.state': 'The learning state file could not be parsed',
      },
    }

    /* ------------------------------------------------------------------ *
     * Styles. Injected once, at factory materialization; the loader claims
     * untagged <style> tags for this plugin so HMR can remove them again.
     * Every colour comes from a --dsw-alias-* semantic token, so light and
     * dark themes need no branch here.
     * ------------------------------------------------------------------ */
    const STYLE_ID = 'dsh-learning-accelerator'
    if (typeof document !== 'undefined'
      && document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`) === null) {
      const style = document.createElement('style')
      style.setAttribute('data-plugin-css', STYLE_ID)
      style.textContent = [
        '.dla-root{display:flex;flex-direction:column;gap:16px;padding:16px;height:100%;overflow:auto;',
        'font-size:13px;line-height:18px;color:var(--dsw-alias-label-secondary)}',
        '.dla-head{display:flex;align-items:center;justify-content:space-between;gap:12px}',
        '.dla-title{font-size:15px;line-height:22px;font-weight:600;color:var(--dsw-alias-label-primary)}',
        '.dla-section{display:flex;flex-direction:column;gap:8px}',
        '.dla-section-title{font-size:12px;line-height:16px;font-weight:600;letter-spacing:.02em;',
        'text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
        '.dla-card{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:12px;',
        'display:flex;flex-direction:column;gap:6px}',
        '.dla-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
        '.dla-label{color:var(--dsw-alias-label-tertiary);min-width:64px}',
        '.dla-value{color:var(--dsw-alias-label-primary)}',
        '.dla-muted{color:var(--dsw-alias-label-tertiary)}',
        '.dla-review{display:flex;flex-direction:column;gap:2px;padding:8px 0;',
        'border-bottom:1px solid var(--dsw-alias-border-l2)}',
        '.dla-review:last-child{border-bottom:0;padding-bottom:0}',
        '.dla-review-head{display:flex;align-items:baseline;gap:8px;justify-content:space-between}',
        '.dla-review-prompt{color:var(--dsw-alias-label-tertiary)}',
        '.dla-meter{position:relative;height:6px;border-radius:3px;overflow:hidden;',
        'background:var(--dsw-alias-interactive-bg-hover);flex:1;min-width:80px}',
        '.dla-meter-fill{position:absolute;inset:0 auto 0 0;border-radius:3px;',
        'background:var(--dsw-alias-brand-primary)}',
        '.dla-meter-fill.low{background:var(--dsw-alias-state-warning,var(--dsw-alias-brand-primary))}',
        '.dla-concept{display:flex;align-items:center;gap:8px}',
        '.dla-concept-name{min-width:120px;color:var(--dsw-alias-label-primary)}',
        '.dla-note{color:var(--dsw-alias-label-tertiary);word-break:break-all}',
        '.dla-error{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:12px;',
        'color:var(--dsw-alias-state-error,var(--dsw-alias-label-primary))}',
        '.dla-empty{color:var(--dsw-alias-label-tertiary);padding:8px 0}',
        '.dla-action{display:flex;align-items:center;gap:6px;font:inherit;font-size:13px;line-height:18px;',
        'color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;border-radius:6px;',
        'padding:4px 8px}',
        '.dla-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
        '.dla-action.rail{justify-content:center;padding:6px;position:relative}',
        '.dla-badge{position:absolute;top:0;right:0;min-width:14px;height:14px;border-radius:7px;',
        'font-size:10px;line-height:14px;text-align:center;padding:0 3px;',
        'background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}',
      ].join('')
      document.head.appendChild(style)
    }

    /* ------------------------------------------------------------------ *
     * Data access
     * ------------------------------------------------------------------ */

    /** Fetch one panel snapshot. Never rejects: the UI renders the failure. */
    async function fetchPanel() {
      try {
        const response = await fetch(PANEL_ENDPOINT, {
          method: 'GET',
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
        })
        if (!response.ok) {
          return { ok: false, error: `HTTP ${response.status}`, status: response.status }
        }
        const payload = await response.json()
        if (!payload || typeof payload !== 'object') {
          return { ok: false, error: 'malformed panel response' }
        }
        return payload
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }

    /** Percentage of a 0..1 strength, clamped so a bad value cannot overflow. */
    function strengthPercent(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return 0
      return Math.max(0, Math.min(100, Math.round(number * 100)))
    }

    /* ------------------------------------------------------------------ *
     * Presentational pieces
     * ------------------------------------------------------------------ */

    function Row(label, value) {
      if (value === undefined || value === null || value === '') return null
      return h('div', { className: 'dla-row' },
        h('span', { className: 'dla-label' }, label),
        h('span', { className: 'dla-value' }, String(value)))
    }

    function Section(title, children) {
      return h('div', { className: 'dla-section' },
        h('div', { className: 'dla-section-title' }, title),
        children)
    }

    function Meter(value) {
      const percent = strengthPercent(value)
      return h('div', { className: 'dla-meter' },
        h('div', {
          className: percent < 40 ? 'dla-meter-fill low' : 'dla-meter-fill',
          style: { width: `${percent}%` },
        }))
    }

    function PriorityReview(item, index) {
      const key = item.id ?? `${item.concept ?? 'review'}-${index}`
      return h('div', { className: 'dla-review', key },
        h('div', { className: 'dla-review-head' },
          h('span', { className: 'dla-value' }, String(item.concept ?? '')),
          h('span', { className: 'dla-muted' }, `P${item.priority ?? 0} · ${strengthPercent(item.strength)}%`)),
        h('div', { className: 'dla-review-prompt' }, String(item.prompt ?? '')))
    }

    function ConceptProgress(entry, index) {
      return h('div', { className: 'dla-concept', key: entry.concept ?? index },
        h('span', { className: 'dla-concept-name' }, String(entry.concept ?? '')),
        Meter(entry.strength),
        h('span', { className: 'dla-muted' },
          `${strengthPercent(entry.strength)}% · ${entry.failures ?? entry.failure_count ?? 0}×`))
    }

    function PanelBody(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const state = React.useState({ phase: 'loading', data: null })
      const view = state[0]
      const setView = state[1]

      const load = React.useCallback(() => {
        let alive = true
        setView({ phase: 'loading', data: null })
        fetchPanel().then((data) => {
          if (alive) setView({ phase: data.ok ? 'ready' : 'failed', data })
        })
        return () => { alive = false }
      }, [])

      React.useEffect(load, [load])

      if (view.phase === 'loading') {
        return h('div', { className: 'dla-root' }, h('div', { className: 'dla-empty' }, t('panel.loading')))
      }

      const data = view.data

      if (!data || data.ok !== true) {
        const detail = data?.error ?? t('error.route')
        const isEmpty = data?.status === 404
        const message = isEmpty
          ? t('error.route')
          : `${t('error.state')}: ${detail}`
        // A transport-level failure carries no `path`, so only mention the file
        // when the host actually reported one.
        const status = data?.status ? `HTTP ${data.status}` : ''
        return h('div', { className: 'dla-root' },
          h('div', { className: 'dla-head' },
            h('div', { className: 'dla-title' }, t('panel.title')),
            h(Primitives.Button, { size: 'sm', variant: 'ghost', onClick: load }, t('panel.refresh'))),
          h('div', { className: 'dla-error' }, status ? `${message}（${status}）` : message),
          data?.path ? h('div', { className: 'dla-note' }, `${t('panel.file')}: ${data.path}`) : null)
      }

      const empty = !data.topic && !data.profile?.learning_goal
        && data.due_reviews.length === 0 && data.weak_concepts.length === 0
        && (data.current_tasks ?? []).length === 0

      if (empty) {
        return h('div', { className: 'dla-root' },
          h('div', { className: 'dla-head' },
            h('div', { className: 'dla-title' }, t('panel.title')),
            h(Primitives.Button, { size: 'sm', variant: 'ghost', onClick: load }, t('panel.refresh'))),
          h('div', { className: 'dla-empty' }, t('panel.empty')),
          h('div', { className: 'dla-note' }, `${t('panel.file')}: ${data.path}`))
      }

      return h('div', { className: 'dla-root' },
        h('div', { className: 'dla-head' },
          h('div', { className: 'dla-title' }, t('panel.title')),
          h(Primitives.Button, { size: 'sm', variant: 'ghost', onClick: load }, t('panel.refresh'))),

        h('div', { className: 'dla-row' },
          h(Primitives.Pill, null, String(data.profile?.learning_domain ?? 'general')),
          h(Primitives.Pill, null, String(data.profile?.level ?? 'beginner')),
          h(Primitives.Pill, null, `${t('panel.difficulty')} ${data.difficulty?.current ?? 1}/5 ${data.difficulty?.next_adjustment ?? 'same'}`),
          (data.counts?.due ?? 0) > 0
            ? h(Primitives.Pill, { active: true }, `${t('panel.due')} ${data.counts.due}`)
            : null),

        h('div', { className: 'dla-card' },
          Row(t('panel.goal'), data.profile?.learning_goal),
          Row(t('panel.topic'), data.topic),
          Row(t('panel.counts'), `${data.counts?.exercises ?? 0} · ${t('panel.attempts')} ${data.counts?.attempts ?? 0}`),
          h('div', { className: 'dla-note' }, `${t('panel.file')}: ${data.path}`)),

        Section(t('panel.priority'),
          data.priority_reviews.length === 0
            ? h('div', { className: 'dla-empty' }, t('panel.noReview'))
            : h('div', null, ...data.priority_reviews.map(PriorityReview))),

        Section(t('panel.weak'),
          data.weak_concepts.length === 0
            ? h('div', { className: 'dla-empty' }, t('panel.noWeak'))
            : h('div', { className: 'dla-row' }, ...data.weak_concepts.map((concept, index) => h(Primitives.Pill, { key: `${concept}-${index}` }, String(concept))))),

        (data.concept_progress ?? []).length === 0
          ? null
          : Section(t('panel.progress'),
            h('div', { className: 'dla-card' }, ...data.concept_progress.slice(0, 12).map(ConceptProgress))),

        (data.current_tasks ?? []).length === 0
          ? null
          : Section(t('panel.tasks'),
            h('div', { className: 'dla-card' },
              ...data.current_tasks.map((task, index) => h('div', {
                className: 'dla-value',
                key: task.id ?? `${task.name}-${index}`,
              }, `· ${String(task.name ?? '')}`)))))
    }

    /**
     * Sidebar foot entry.
     *
     * It stays honest about what a sidebar seat can do: it reports the due count
     * and its tooltip carries the priority concepts, but it does not pretend to
     * open a conversation tab — that ring is owned by the conversation package,
     * and a wrong guess there would silently do nothing.
     */
    function SidebarEntry(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const wide = props.wide === true
      const state = React.useState(null)
      const data = state[0]
      const setData = state[1]

      React.useEffect(() => {
        let alive = true
        fetchPanel().then((payload) => {
          if (alive) setData(payload && payload.ok === true ? payload : null)
        })
        return () => { alive = false }
      }, [])

      const due = data?.counts?.due ?? 0
      const concepts = (data?.priority_reviews ?? []).map(item => item.concept).filter(Boolean)
      const tooltip = data === null
        ? t('sidebar.none')
        : due === 0
          ? t('sidebar.none')
          : `${t('panel.priority')}: ${concepts.slice(0, 5).join(', ')}`

      return h('button', {
        type: 'button',
        className: wide ? 'dla-action' : 'dla-action rail',
        title: tooltip,
        'aria-label': tooltip,
      },
      h(Primitives.IconSkillOutline16, { size: 16 }),
      wide ? h('span', null, t('sidebar.label')) : null,
      due > 0 ? h('span', { className: 'dla-badge' }, due > 99 ? '99+' : String(due)) : null)
    }

    /**
     * `conversation.view` renders one tab body and passes no owner props, so the
     * component reads everything it needs from its own fetch and from `t`.
     */
    function LearningView(props) {
      return h(PanelBody, { t: props?.t })
    }

    return {
      name: 'learning-accelerator',
      // Service names, not package names: these must be live before apply runs.
      // `slots` gates every registration below; `locale` provides the `t` the
      // components receive.
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, STRINGS), 'learning-accelerator: dictionaries')
        const t = ctx.locale.bind(NS)

        // `conversation.view` is declared by the conversation package, so waiting
        // on its declaration is the only order-safe way to register.
        ctx.slots.inject('conversation.view', () => ctx.slots.register({
          name: 'conversation.view',
          id: 'learning',
          order: 30,
          locale: NS,
          // A thunk, so the tab label follows a locale change without re-registering.
          label: () => t('view.learning'),
        }, LearningView))

        // `sidebar.footer.action` carries `{ wide }` and renders in the sidebar
        // foot, above the settings seat.
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'learning',
          order: 100,
          locale: NS,
        }, SidebarEntry))
      },
    }
  },
})
