/**
 * `PanelBody` — the conversation tab, and the only hook owner in the panel.
 *
 * Four shapes: skeleton (first load), error, empty, ready. Each is a pure
 * function of `view`, so a refresh can only ever move between them in a way the
 * render below makes explicit.
 */
function PanelBody(props) {
  const t = typeof props.t === 'function' ? props.t : (key) => key
  const cwd = typeof props.cwd === 'string' && props.cwd.length > 0 ? props.cwd : undefined
  const state = React.useState({ phase: 'loading', data: null, pending: false })
  const view = state[0]
  const setView = state[1]
  // A stable mutable box, because the test renderer has no `useRef`: it lets a
  // response from a superseded request be dropped instead of overwriting newer
  // data.
  const box = React.useState(() => ({ seq: 0 }))[0]

  const load = React.useCallback(() => {
    const seq = (box.seq += 1)
    // Keep whatever is on screen while refreshing; only a first load with nothing
    // to show uses the loading frame. Blanking the content here also threw away
    // the scroll position, because `.dla-root` is the scroller.
    setView((previous) => (previous.data
      ? { phase: previous.phase, data: previous.data, pending: true }
      : { phase: 'loading', data: null, pending: true }))
    fetchPanel(cwd).then((data) => {
      if (box.seq === seq) setView({ phase: data.ok ? 'ready' : 'failed', data, pending: false })
    })
  }, [cwd, box])

  React.useEffect(() => {
    load()
    return () => { box.seq += 1 }
  }, [load])

  if (view.phase === 'loading' && !view.data) return Skeleton(t)

  const data = view.data

  if (!data || data.ok !== true) return ErrorFrame(t, data, load)

  return ReadyFrame(t, data, load)
}

/**
 * The failure shape.
 *
 * A 404 means the route is absent, which is a different problem from a state file
 * the host could not parse, and the copy says so. The raw exception is demoted to
 * small tertiary text: it is useful when it is the file, and noise when it is not.
 */
function ErrorFrame(t, data, load) {
  const missingRoute = data?.status === 404
  const detail = data?.error ?? ''
  const status = data?.status ? `HTTP ${data.status}` : ''
  // A transport failure already reports itself as `HTTP 404`, so only append the
  // status when it is not already the whole message.
  const detailLine = detail === status
    ? detail
    : [detail, status ? `（${status}）` : ''].join('')

  return h('div', { className: 'dla-root' },
    h('div', { className: 'dla-body' },
      h('div', { className: 'dla-head' },
        h('div', { className: 'dla-titles' },
          h('h2', { className: 'dla-title' }, t('panel.title'))),
        h('div', { className: 'dla-head-side' },
          h(Primitives.Button, { size: 'sm', variant: 'ghost', onClick: load }, t('panel.refresh')))),
      h('div', { className: 'dla-error' },
        h('div', { className: 'dla-error-title' },
          missingRoute ? t('error.route') : t('error.state')),
        h('p', { className: 'dla-error-body' },
          missingRoute ? t('error.route.detail') : t('error.state.detail')),
        detailLine ? h('p', { className: 'dla-error-detail' }, detailLine) : null),
      Footer(t, data?.path)))
}

/**
 * The no-track shape.
 *
 * No refresh control: there is no file to re-read, so the button would only
 * suggest an action that changes nothing. What it offers instead is a sentence the
 * learner can paste into the chat, which is the one action that does work.
 */
function EmptyFrame(t, data) {
  return h('div', { className: 'dla-root' },
    h('div', { className: 'dla-body' },
      h('div', { className: 'dla-head' },
        h('div', { className: 'dla-titles' },
          h('h2', { className: 'dla-title' }, t('panel.title')))),
      h('div', { className: 'dla-empty' },
        h('h3', { className: 'dla-empty-title' }, t('panel.empty.title')),
        h('p', { className: 'dla-empty-body' }, t('panel.empty.body')),
        h('div', { className: 'dla-starter' }, t('panel.empty.starter'))),
      Footer(t, data.path)))
}

/** The populated shape. */
function ReadyFrame(t, data, load) {
  const due = countOf(data.counts?.due)
  const reviews = data.priority_reviews ?? []
  const progress = data.concept_progress ?? []
  const tasks = data.current_tasks ?? []
  const mastered = data.mastered_concepts ?? []
  const goal = data.profile?.learning_goal
  const topic = data.topic

  const empty = !topic && !goal && reviews.length === 0 && progress.length === 0 && tasks.length === 0
  if (empty) return EmptyFrame(t, data)

  const domain = enumLabel(t, 'domain', data.profile?.learning_domain, t('domain.general'))
  const level = enumLabel(t, 'level', data.profile?.level, t('level.unknown'))
  const adjustment = enumLabel(t, 'adjust', data.difficulty?.next_adjustment, t('adjust.same'))
  const subtitle = `${domain} · ${level} · ${t('panel.difficulty')} ${countOf(data.difficulty?.current) || 1}/5 ${adjustment}`

  const stamp = clockOf(data.generated_at)
  // The review queue above already carries the weakest concepts, so this list
  // holds only what is *not* already on screen.
  const shown = new Set(reviews.map((item) => String(item.concept ?? '')))
  const rest = progress.filter((entry) => !shown.has(String(entry.concept ?? '')))
  const visible = rest.slice(0, CONCEPT_LIMIT)
  const hidden = rest.length - visible.length

  const head = h('div', { className: 'dla-head' },
    h('div', { className: 'dla-titles' },
      h('h2', { className: 'dla-title' }, t('panel.title')),
      h('div', { className: 'dla-sub' }, subtitle)),
    h('div', { className: 'dla-head-side' },
      stamp
        ? h('span', { className: 'dla-stamp', title: String(data.generated_at) },
          `${t('panel.updated')} ${stamp}`)
        : null,
      h(Primitives.Button, { size: 'sm', variant: 'ghost', onClick: load }, t('panel.refresh'))))

  // The host caps `priority_reviews` at five while `counts.due` counts every due
  // item, so when they differ the heading says "shown / total" and the tooltip
  // spells it out, rather than showing two numbers that disagree.
  const dueSection = Section(t('panel.due'),
    due > reviews.length
      ? { text: `${reviews.length} / ${due}`, title: t('panel.dueRatio') }
      : String(reviews.length),
    reviews.length === 0
      ? h('p', { className: 'dla-empty-body' }, t('panel.noReview'))
      : h('div', { className: 'dla-card' },
        h('ul', { className: 'dla-reviews' },
          ...reviews.map((item, index) => ReviewRow(t, item, index)))),
    reviews.length === 0
      ? null
      : h(Primitives.Button, {
        size: 'sm',
        variant: 'ghost',
        title: t('panel.copyHint'),
        onClick: () => copyReviewList(reviews),
      }, t('panel.copy')))

  // Mastered concepts are the one positive signal the payload carries, and nothing
  // else in the panel repeats them.
  const masteredCell = mastered.length === 0
    ? null
    : [
      h('dt', { key: 't-mastered' }, t('panel.mastered')),
      h('dd', { key: 'd-mastered' },
        h('div', { className: 'dla-tags' },
          ...mastered.slice(0, 12).map((concept, index) => h(Primitives.Tag, {
            key: `${concept}-${index}`,
            tone: 'success',
          }, String(concept))))),
    ]

  const profileSection = Section(t('panel.profile'), null,
    h('dl', { className: 'dla-facts' },
      Fact(t('panel.goal'), goal),
      Fact(t('panel.topic'), topic),
      Fact(t('panel.outcome'), data.profile?.target_outcome),
      Fact(t('panel.counts'),
        `${countOf(data.counts?.exercises)} · ${countOf(data.counts?.attempts)} ${t('panel.attempts')}`),
      masteredCell))

  const progressSection = rest.length === 0
    ? null
    : Section(t('panel.progress'), String(rest.length),
      h('div', { className: 'dla-plain' },
        h('ul', { className: 'dla-concepts' },
          ...visible.map((entry, index) => ConceptRow(t, entry, index))),
        hidden > 0
          ? h('div', { className: 'dla-more' },
            t('panel.progressMore').replace('{n}', String(hidden)))
          : null))

  const tasksSection = tasks.length === 0
    ? null
    : Section(t('panel.tasks'), null,
      h('ul', { className: 'dla-tasks' },
        ...tasks.map((task, index) => h('li', {
          className: 'dla-task',
          key: task.id ?? `${task.name}-${index}`,
        }, String(task.name ?? '')))))

  return h('div', { className: 'dla-root' },
    h('div', { className: 'dla-body' },
      head, dueSection, profileSection, progressSection, tasksSection,
      Footer(t, data.path)))
}
