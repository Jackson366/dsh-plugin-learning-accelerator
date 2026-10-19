/**
 * Pure presenters: no hooks, no state, no fetching.
 *
 * Only `PanelBody` and `SidebarEntry` own hooks. That is a hard constraint, not a
 * style preference: `tests/client-plugin.test.js` resolves nested function
 * components eagerly and keeps one hook cursor per root, so a nested component
 * that called `useState` would corrupt the indexing. Everything here is a plain
 * function returning an element tree.
 */

/**
 * The decorative strength bar.
 *
 * Monochrome on purpose. It encodes magnitude and nothing else: the value is the
 * length, the number beside it carries the reading, and "this is weak" is a
 * separate channel (`NameCell`'s dot, plus the failure count). Tinting the bar by
 * status made one element answer two questions and left the amber below the 3:1
 * non-text contrast threshold on a light surface.
 */
function Meter(value) {
  const percent = strengthPercent(value)
  return h(
    'div',
    { className: 'dla-meter', 'aria-hidden': 'true' },
    h('div', { className: 'dla-meter-fill', style: { width: `${percent}%` } }),
  )
}

/**
 * A concept name with an optional weak mark.
 *
 * `tag` is `h4` inside a review and `span` inside the progress list, so the
 * document outline matches the visual hierarchy without duplicating markup.
 * The dot is a separate flex item rather than a `::before`, because a
 * pseudo-element inside an `overflow:hidden` line is clipped along with the text.
 * It is `aria-hidden`: the failure count already says this in words.
 */
function NameCell(tag, t, concept, percent) {
  const weak = percent < WEAK_BELOW
  return h(
    tag,
    { className: 'dla-name' },
    weak ? h('span', { className: 'dla-weak', 'aria-hidden': 'true', title: t('panel.weak') }) : null,
    h('span', { className: 'dla-concept-name' }, String(concept ?? '')),
  )
}

/** `62% · 连对 3 · 失败 2×`, with the optional parts omitted when zero. */
function strengthMeta(t, entry) {
  const parts = [`${strengthPercent(entry.strength)}%`]
  const streak = countOf(entry.correct_streak)
  const failures = countOf(entry.failures ?? entry.failure_count)
  if (streak > 0) parts.push(`${t('panel.streak')} ${streak}`)
  if (failures > 0) parts.push(`${t('panel.failures')} ${failures}×`)
  return parts.join(' · ')
}

function ConceptRow(t, entry, index) {
  return h(
    'li',
    { className: 'dla-concept', key: entry.concept ?? index },
    NameCell('span', t, entry.concept, strengthPercent(entry.strength)),
    Meter(entry.strength),
    h('span', { className: 'dla-concept-meta' }, strengthMeta(t, entry)),
  )
}

/**
 * One due review: what it is, how weak it is, and the question to answer.
 *
 * The question comes first in the body row and the gauge trails it, so the
 * question starts at the same left edge as the concept name instead of being
 * indented by the gauge for no structural reason.
 */
function ReviewRow(t, item, index) {
  const percent = strengthPercent(item.strength)
  const meta = [`${percent}%`]
  const overdue = overdueDays(item.due_at)
  if (overdue !== null) meta.push(`${t('panel.overdue')} ${overdue}${t('panel.dayShort')}`)
  const failures = countOf(item.failure_count)
  if (failures > 0) meta.push(`${t('panel.failures')} ${failures}×`)

  return h(
    'li',
    { className: 'dla-review', key: item.id ?? `${item.concept ?? 'review'}-${index}` },
    h(
      'div',
      { className: 'dla-review-head' },
      NameCell('h4', t, item.concept, percent),
      h('span', { className: 'dla-meta' }, meta.join(' · ')),
    ),
    h(
      'div',
      { className: 'dla-review-body' },
      h('span', { className: 'dla-review-prompt' }, String(item.prompt ?? '')),
      Meter(item.strength),
    ),
  )
}

/**
 * One titled section.
 *
 * `count` is either a string or `{ text, title }`; the object form is what
 * explains a reconciled count such as `3 / 20` on hover.
 */
function Section(title, count, children, action) {
  const text = count && typeof count === 'object' ? count.text : count
  const hint = count && typeof count === 'object' ? count.title : undefined
  return h(
    'section',
    { className: 'dla-section' },
    h(
      'div',
      { className: 'dla-section-head' },
      h(
        'h3',
        { className: 'dla-section-title' },
        title,
        text ? h('span', { className: 'dla-count', title: hint }, text) : null,
      ),
      action ?? null,
    ),
    children,
  )
}

/** One `dt`/`dd` pair, or nothing when the value is absent. */
function Fact(term, value) {
  if (value === undefined || value === null || value === '') return null
  return [h('dt', { key: `t-${term}` }, term), h('dd', { key: `d-${term}` }, String(value))]
}

/**
 * The first-load frame: block placeholders in the shape of the real content, plus
 * a hidden live region, so a screen reader hears the status while a sighted reader
 * sees structure rather than one line of grey text.
 */
function Skeleton(t) {
  return h(
    'div',
    { className: 'dla-root' },
    h(
      'div',
      { className: 'dla-body', 'aria-busy': 'true' },
      h(
        'div',
        { className: 'dla-head' },
        h(
          'div',
          { className: 'dla-titles' },
          h('div', { className: 'dla-skel dla-skel-title' }),
          h('div', { className: 'dla-skel dla-skel-sub' }),
        ),
      ),
      h(
        'div',
        { className: 'dla-card' },
        ...[0, 1, 2, 3].map((index) =>
          h(
            'div',
            { className: 'dla-skel-row', key: index },
            h('div', { className: 'dla-skel dla-skel-line' }),
            h('div', { className: 'dla-skel dla-skel-bar' }),
          ),
        ),
      ),
      h('div', { className: 'dla-visually-hidden', role: 'status' }, t('panel.loading')),
    ),
  )
}

/**
 * The state-file path: quiet, one line, full value in `title`.
 *
 * It is labelled `panel.file` ("状态文件"), not the section's title
 * ("学习档案"). One key used for both printed the same words twice on one screen
 * while meaning two different things.
 */
function Footer(t, path) {
  if (typeof path !== 'string' || path.length === 0) return null
  return h(
    'div',
    { className: 'dla-foot' },
    h('span', null, t('panel.file')),
    h('span', { className: 'dla-path', title: path }, path),
  )
}
