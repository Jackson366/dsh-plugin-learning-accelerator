/**
 * The sidebar seat, and the workspace hint the tab needs.
 *
 * Two unrelated concerns share this file because they are the two places the
 * browser half talks to the rest of the app: the seat reports a count outward,
 * and the hint reads a workspace inward. Splitting them further would produce two
 * files of twenty lines each.
 */

/**
 * Sidebar foot entry.
 *
 * It stays honest about what a sidebar seat can do: it reports the due count and
 * its tooltip carries the priority concepts, but it does not pretend to open a
 * conversation tab — that ring is owned by the conversation package, and a wrong
 * guess there would silently do nothing.
 *
 * The collapsed rail cannot seat a glyph plus a two-digit badge, so the count is
 * wide-only and the rail carries a dot instead; the accessible name is the same
 * in both.
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
    return () => {
      alive = false
    }
  }, [])

  const due = countOf(data?.counts?.due)
  const concepts = (data?.priority_reviews ?? []).map((item) => item.concept).filter(Boolean)
  const tooltip =
    due === 0
      ? t('sidebar.none')
      : `${t('sidebar.due').replace('{n}', String(due))}${concepts.length > 0 ? `: ${concepts.slice(0, 5).join(', ')}` : ''}`

  return h(
    'button',
    {
      type: 'button',
      className: wide ? 'dla-action' : 'dla-action rail',
      title: tooltip,
      'aria-label': tooltip,
    },
    h(Primitives.IconSkillOutline16, { size: 16 }),
    wide ? h('span', null, t('sidebar.label')) : null,
    due > 0
      ? wide
        ? h('span', { className: 'dla-badge' }, due > 99 ? '99+' : String(due))
        : h('span', { className: 'dla-dot', 'aria-hidden': 'true' })
      : null,
  )
}

/**
 * Read one session row's workspace out of a Session-list snapshot.
 *
 * Defensive because the snapshot is another package's data: a missing list, a
 * session the list has not indexed yet, or a row without a `cwd` all mean "no
 * hint", which the host handles.
 */
function workspaceOf(list, sessionId) {
  if (!list || typeof list !== 'object' || typeof sessionId !== 'string') return undefined
  const row = list.byId?.[sessionId]
  const cwd = row?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

/**
 * The workspace of the conversation this component is rendered in.
 *
 * `sessionId` and `useSessions` arrive as standard props on every session-scoped
 * slot (`@deepseek-ai/dsh-client-ui-session` merges them into the slot framework's
 * `SessionStandardProps`/`GlobalStandardProps`), and
 * `SessionListState.byId[id].cwd` is the runtime's own record of that session's
 * workspace. That is the whole reason the panel can follow a workspace switch: the
 * browser request it makes carries no session identity, but the page it is
 * rendered in does.
 *
 * The `useSessions` guard is belt-and-braces for a composition that renders this
 * slot without the session standard kit; there the hook is simply absent for the
 * component's whole lifetime, and the host's session hint takes over.
 */
function useSessionWorkspace(props) {
  const sessionId = props?.sessionId
  const useSessions = props?.useSessions
  const select = React.useCallback((list) => workspaceOf(list, sessionId), [sessionId])
  return typeof useSessions === 'function' ? useSessions(select) : undefined
}

/**
 * `conversation.view` renders one tab body and passes no owner props, so the
 * component reads everything it needs from its own fetch, from the session
 * standard props, and from `t`.
 */
function LearningView(props) {
  const cwd = useSessionWorkspace(props)
  return h(PanelBody, { t: props?.t, cwd })
}
