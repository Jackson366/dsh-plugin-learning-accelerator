/**
 * The injected stylesheet.
 *
 * Injected once, at factory materialization; the loader claims untagged `<style>`
 * tags for this plugin so HMR can remove them again.
 *
 * Every colour is a `--dsw-alias-*` semantic token — no literal hex/rgb/hsl, which
 * `tests/client-plugin.test.js` asserts — so both themes work with no branch.
 * Sizes ride the host font axis; spacing snaps to 4/8/12/16/24.
 *
 * Three decisions are load-bearing and easy to undo by accident:
 *
 * - **A border, not a layer background, groups the one cards-shaped section.**
 *   Light mode maps `bg-base` and `bg-layer-1/2/3` to the same `#ffffff`.
 * - **The meter is monochrome.** It encodes magnitude, and only magnitude.
 *   Status lives on the `dla-weak` dot and on `Tag tone="success"`, so each
 *   visual device means exactly one thing.
 * - **A container query, not a media query, handles narrow widths.** The panel is
 *   a conversation tab: its width is the tab's, not the viewport's.
 */
const STYLE_ID = 'dsh-learning-accelerator'

const STYLE_TEXT = [
  /* Layout. `.dla-root` is only the scroll container, so the content can be
   * capped with a max-width instead of stretching across a wide window. It is
   * also the query container the narrow rules below key off. */
  '.dla-root{box-sizing:border-box;height:100%;overflow:auto;padding:16px;',
  'container-type:inline-size;',
  'font-size:var(--dsh-content-font-size-secondary,13px);line-height:1.5;',
  'color:var(--dsw-alias-label-secondary)}',
  '.dla-body{display:flex;flex-direction:column;gap:24px;max-width:760px}',
  '.dla-root *{box-sizing:border-box}',

  /* Header */
  '.dla-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}',
  '.dla-titles{min-width:0}',
  '.dla-title{margin:0;font-size:calc(var(--dsh-content-font-size,14px) + 2px);line-height:1.25;',
  'font-weight:600;color:var(--dsw-alias-label-primary)}',
  '.dla-sub{margin-top:4px;font-size:calc(var(--dsh-content-font-size-secondary,13px) * .92);',
  'color:var(--dsw-alias-label-secondary)}',
  '.dla-head-side{display:flex;align-items:center;gap:8px;flex:none}',
  '.dla-stamp{font-size:calc(var(--dsh-content-font-size-secondary,13px) * .92);',
  'color:var(--dsw-alias-label-tertiary);white-space:nowrap}',

  /* Sections. A section title is a label, so it stays small and quiet; the
   * hierarchy above it comes from the page title and the spacing.
   *
   * No `text-transform:uppercase` and no tracking: uppercase does nothing to
   * Chinese, so it gave the two locales different hierarchy strength, and
   * `letter-spacing` inserts gaps *between* CJK glyphs, which reads as broken
   * spacing. Weight and colour carry the level instead. */
  '.dla-section{display:flex;flex-direction:column;gap:8px}',
  '.dla-section-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px}',
  '.dla-section-title{margin:0;display:flex;align-items:baseline;gap:6px;',
  'font-size:calc(var(--dsh-content-font-size-secondary,13px) * .92);line-height:1.4;',
  'font-weight:600;color:var(--dsw-alias-label-secondary)}',
  '.dla-count{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}',

  /* One card for the one group that needs an edge. */
  '.dla-card{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:12px}',
  '.dla-plain{display:flex;flex-direction:column;gap:8px}',

  /* Due reviews: identity, then the question. Item spacing (6+6) stays under the
   * 24px section gap, so the grouping is never ambiguous. */
  '.dla-reviews{list-style:none;margin:0;padding:0}',
  '.dla-review{display:flex;flex-direction:column;gap:6px;padding:6px 0;',
  'border-bottom:1px solid var(--dsw-alias-border-l2)}',
  '.dla-review:first-child{padding-top:0}',
  '.dla-review:last-child{border-bottom:0;padding-bottom:0}',
  '.dla-review-head{display:flex;align-items:baseline;justify-content:space-between;',
  'gap:12px;min-width:0}',

  /* The question spans the whole row, so it starts at the concept's left edge and
   * the gauge trails it instead of indenting it. */
  '.dla-review-body{display:flex;align-items:center;gap:10px;min-width:0}',
  '.dla-review-prompt{flex:1;min-width:0;color:var(--dsw-alias-label-secondary);',
  'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

  /* A name plus an optional weak mark, as one cell. The mark is a separate flex
   * item rather than a `::before`, because a pseudo-element inside an
   * `overflow:hidden` line is clipped together with the text. */
  '.dla-name{display:flex;align-items:baseline;gap:6px;min-width:0;margin:0;',
  'font-weight:500;color:var(--dsw-alias-label-primary)}',
  '.dla-concept-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.dla-weak{flex:none;width:6px;height:6px;border-radius:50%;',
  'background:var(--dsw-alias-state-warn-primary)}',

  '.dla-meta{flex:none;white-space:nowrap;font-variant-numeric:tabular-nums;',
  'font-size:calc(var(--dsh-content-font-size-secondary,13px) * .92);',
  'color:var(--dsw-alias-label-secondary)}',

  /* Meter. Decorative and monochrome: length is the value, the numbers beside it
   * carry the reading, and status is a separate channel. `aria-hidden` because a
   * screen reader already gets the number. */
  '.dla-meter{position:relative;flex:none;width:56px;height:6px;border-radius:3px;',
  'overflow:hidden;background:var(--dsw-alias-interactive-bg-hover)}',
  '.dla-meter-fill{position:absolute;inset:0 auto 0 0;border-radius:3px;',
  'background:var(--dsw-alias-brand-primary)}',

  /* Concept rows: a capped name column keeps the gauge near the name on wide
   * screens, while the fixed meter and content-sized meta columns keep every bar's
   * start and every number's right edge aligned. */
  '.dla-concepts{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}',
  '.dla-concept{display:grid;grid-template-columns:minmax(0,28ch) 88px max-content;',
  'align-items:center;gap:12px}',
  '.dla-concept .dla-meter{width:88px}',
  '.dla-concept-meta{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;',
  'font-size:calc(var(--dsh-content-font-size-secondary,13px) * .92);',
  'color:var(--dsw-alias-label-secondary)}',

  /* Facts as a definition list: no label column guessing, no magic width. */
  '.dla-facts{margin:0;display:grid;grid-template-columns:max-content minmax(0,1fr);gap:6px 12px}',
  '.dla-facts dt{font-size:calc(var(--dsh-content-font-size-secondary,13px) * .92);',
  'color:var(--dsw-alias-label-secondary)}',
  '.dla-facts dd{margin:0;min-width:0;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}',
  '.dla-tags{display:flex;flex-wrap:wrap;align-items:center;gap:6px}',
  '.dla-more{color:var(--dsw-alias-label-secondary);',
  'font-size:calc(var(--dsh-content-font-size-secondary,13px) * .92)}',

  /* Tasks: the marker is drawn, not typed, so it cannot be mistaken for content
   * and it follows the text baseline. */
  '.dla-tasks{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}',
  '.dla-task{display:flex;gap:8px;align-items:baseline;color:var(--dsw-alias-label-primary)}',
  '.dla-task::before{content:"";flex:none;width:5px;height:5px;border-radius:50%;',
  'background:var(--dsw-alias-brand-primary)}',

  /* The state path is developer chrome: last, quiet, one line, with the full value
   * in `title`. Not `direction:rtl` — that moves a leading "/" to the end. */
  '.dla-foot{margin-top:auto;padding-top:16px;display:flex;align-items:baseline;gap:6px;',
  'min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) * .92);',
  'color:var(--dsw-alias-label-tertiary)}',
  '.dla-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',

  /* Empty / error */
  '.dla-empty{display:flex;flex-direction:column;gap:12px;align-items:flex-start;padding:16px 0}',
  '.dla-empty-title{margin:0;font-size:calc(var(--dsh-content-font-size,14px) + 2px);',
  'line-height:1.25;font-weight:600;color:var(--dsw-alias-label-primary)}',
  '.dla-empty-body{margin:0;max-width:56ch;color:var(--dsw-alias-label-secondary)}',
  '.dla-starter{padding:8px 10px;border-radius:8px;overflow-wrap:anywhere;',
  'background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-primary)}',
  '.dla-error{display:flex;flex-direction:column;gap:6px;padding:12px;border-radius:8px;',
  'box-shadow:inset 0 0 0 1px var(--dsw-alias-state-error-primary)}',
  '.dla-error-title{font-weight:600;color:var(--dsw-alias-state-error-primary)}',
  '.dla-error-body{margin:0;color:var(--dsw-alias-label-secondary)}',
  '.dla-error-detail{margin:0;overflow-wrap:anywhere;color:var(--dsw-alias-label-tertiary);',
  'font-size:calc(var(--dsh-content-font-size-secondary,13px) * .92)}',

  /* Skeleton: the shape of the content, so the panel does not jump when the data
   * lands. The blocks are decorative; the status line is announced. */
  '.dla-skel{background:var(--dsw-alias-bg-skeleton);border-radius:4px}',
  '.dla-skel-title{height:20px;width:150px}',
  '.dla-skel-sub{height:12px;width:230px;margin-top:8px}',
  '.dla-skel-row{display:flex;align-items:center;gap:10px;padding:6px 0}',
  '.dla-skel-line{height:12px;width:38%}',
  '.dla-skel-bar{height:6px;width:56px;border-radius:3px}',
  '.dla-visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;',
  'overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}',

  /* Sidebar seat */
  '.dla-action{display:flex;align-items:center;gap:6px;font:inherit;',
  'font-size:var(--dsh-content-font-size-secondary,13px);',
  'color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;',
  'border-radius:6px;padding:4px 8px}',
  '.dla-action:hover{background:var(--dsw-alias-interactive-bg-hover);',
  'color:var(--dsw-alias-label-primary)}',
  '.dla-action.rail{justify-content:center;padding:6px;position:relative}',
  /* The dot is a decorative reminder; the accessible name carries the count. It
   * sits clear of the glyph instead of on top of it. */
  '.dla-dot{position:absolute;top:3px;right:3px;width:7px;height:7px;border-radius:50%;',
  'background:var(--dsw-alias-state-warn-primary)}',
  /* A bordered chip: readable on any surface in either theme, unlike the primary
   * fill, which is near-black in light and near-white in dark. */
  '.dla-badge{flex:none;min-width:18px;height:18px;padding:0 4px;border-radius:9px;',
  'font-size:11px;line-height:18px;font-weight:600;text-align:center;',
  'font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);',
  'background:var(--dsw-alias-bg-module-platform);',
  'box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}',

  /* Narrow layout. Measured with a clipping probe: the question starts to lose
   * characters at a ~480px panel and the concept name at ~380px, so this switches
   * before either happens. The rule is that decoration yields first — the question
   * wraps, the gauge goes full width, the label column stacks, and the timestamp
   * (the least important thing on the screen) steps out. */
  '@container (max-width: 520px){',
  '.dla-review-prompt{white-space:normal;overflow:visible;text-overflow:clip}',
  '.dla-review-head{flex-wrap:wrap;gap:2px 10px}',
  /* The percentage is already in the meta line, so the gauge is redundant here —
   * and a short bar trailing a wrapped sentence reads as punctuation. Drop it and
   * give the question the full width. */
  '.dla-review-body .dla-meter{display:none}',
  '.dla-concept{grid-template-columns:1fr;row-gap:4px}',
  '.dla-concept .dla-meter{width:100%}',
  '.dla-concept-meta{text-align:left}',
  '.dla-facts{grid-template-columns:1fr;gap:2px}',
  '.dla-facts dt{margin-top:8px;color:var(--dsw-alias-label-tertiary)}',
  '.dla-stamp{display:none}',
  '.dla-head{gap:8px}',
  '}',
].join('')

if (
  typeof document !== 'undefined' &&
  document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_ID)}]`) === null
) {
  const style = document.createElement('style')
  style.setAttribute('data-plugin-css', STYLE_ID)
  style.textContent = STYLE_TEXT
  document.head.appendChild(style)
}
