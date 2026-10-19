/**
 * dsh-plugin-learning-accelerator — browser half (source template).
 *
 * ## This file is not what ships
 *
 * `lib/client.js` is **generated** from this template plus the fragments in this
 * directory, by `scripts/build-client.mjs`. Edit the fragments, then run
 * `node scripts/build-client.mjs`. `tests/client-build.test.js` fails if the
 * committed bundle is stale, so a forgotten rebuild cannot reach a release.
 *
 * ## Why the source is shaped this way
 *
 * A DSH client bundle is **not** an ES module. The host serves it as a classic
 * `<script>`, and the browser-side module table calls the registered factory to
 * get the plugin exports. So there are no top-level `import`/`export`
 * statements anywhere in this directory, and rendering uses
 * `React.createElement` rather than JSX.
 *
 * The host serves exactly **one** bundle file per package
 * (`exports["./client"]`, resolved by `clientExportOf` in
 * `@deepseek-ai/dsh-client-modules`), and the loader requires that URL to
 * register one module id. That is why the split lives in the source tree and is
 * flattened at build time instead of being resolved at runtime.
 *
 * `id` must equal the package name — the loader matches the registration against
 * the graph row it is loading, and throws when they differ.
 *
 * ## What it adds
 *
 * - a `conversation.view` tab ("学习"): the due review queue first (with its
 *   prompts), then the learner's file, the remaining concepts by strength, and
 *   the next tasks, read from the host route `/learning-accelerator/panel`;
 * - a `sidebar.footer.action` entry showing how many reviews are due.
 *
 * The tab follows the conversation it is rendered in: it reads that session's
 * workspace from the session standard props and puts it on the request as `?cwd=`,
 * so switching workspace switches the panel. A request without the hint (the
 * sidebar seat, or a composition that does not provide the session kit) leaves
 * the host's own session hint in charge.
 *
 * Both are honest about failure: a missing route, a malformed state file, or a
 * dead host renders an explanation in the panel instead of an empty frame.
 *
 * ## Fragment map
 *
 * | file | responsibility |
 * |---|---|
 * | `00-strings.js` | both locale dictionaries, nothing else |
 * | `10-styles.js` | the injected stylesheet (tokens + container query) |
 * | `20-format.js` | transport and pure value formatting |
 * | `30-presenters.js` | pure presenters: meter, rows, section, facts, skeleton, footer |
 * | `40-panel.js` | `PanelBody` — the only hook owner besides the sidebar |
 * | `50-sidebar.js` | the sidebar seat and the workspace hint |
 *
 * ## Three constraints from the host design system that shape the styles
 *
 * 1. **Light mode has no layer scale.** `--dsw-alias-bg-base` and
 *    `--dsw-alias-bg-layer-1/2/3` are *all* `#ffffff` in the light theme (they
 *    only diverge in dark), so a border is the only reliable static grouping
 *    device. `Primitives.Pill` has no border and a `bg-layer-2` fill, which is
 *    why its chips vanish on a light panel; this tab uses `Primitives.Tag`
 *    (`tone="outline"`/`"success"`), which carries its own edge/`color-mix` tint.
 *    `--dsw-alias-bg-module-platform` and `--dsw-alias-bg-skeleton` are the two
 *    tinted surfaces that *do* read in both themes.
 * 2. **Text must ride the host font axis.** `--dsh-content-font-size` (default
 *    14px, user-settable 10–22) and `--dsh-content-font-size-secondary` are
 *    published on `document.body` by `@deepseek-ai/dsh-client-ui-theme`. Hard
 *    pixels here would ignore the Settings → Font size control that every other
 *    surface honours.
 * 3. **`--dsw-alias-label-tertiary` is not readable text in light mode.**
 *    `#81858c` on `#ffffff` is 3.71:1, under the 4.5:1 that normal-size text
 *    needs (dark mode is 8.54:1). So body copy, prompts and section titles use
 *    `label-secondary` (5.80:1), and tertiary is reserved for marks that are not
 *    read. The state tokens are also spelled `state-warn-*` / `state-error-*`,
 *    not `state-warning` / `state-error`.
 *
 * @see ../../lib/panel-route.js for the host side of the route.
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

    /** How many remaining concepts the progress list shows before it stops. */
    const CONCEPT_LIMIT = 12

    /** Below this strength a row is marked as weak. */
    const WEAK_BELOW = 40

    /* ---- lib/client/00-strings.js ---- */
/**
 * Both locale dictionaries, and nothing else.
 *
 * Keys are grouped by the surface that reads them, in render order, so a missing
 * translation is visible next to its siblings rather than buried. `tests/*`
 * asserts that `zh` and `en` declare exactly the same keys.
 *
 * Two labels that used to collide now say different things on purpose:
 * `panel.profile` titles the section that holds the goal and the concept counts,
 * while `panel.file` labels the state-file path in the footer. Reusing one key
 * for both printed the same words twice on one screen, meaning two different
 * things.
 */
const STRINGS = {
  zh: {
    'view.learning': '学习',
    'panel.title': '学习加速器',
    'panel.refresh': '刷新',
    'panel.loading': '正在读取学习状态…',
    'panel.updated': '更新于',

    'panel.due': '现在复习',
    'panel.noReview': '现在没有到期复习项。',
    'panel.dueRatio': '当前显示 / 到期总数',
    'panel.copy': '复制复习清单',
    'panel.copyHint': '把待复习的概念和问题复制到剪贴板',

    'panel.profile': '学习档案',
    'panel.goal': '目标',
    'panel.topic': '当前主题',
    'panel.outcome': '目标产出',
    'panel.counts': '进度',
    'panel.attempts': '尝试',
    'panel.mastered': '已掌握',

    'panel.progress': '其他概念',
    'panel.progressMore': '还有 {n} 个未显示',
    'panel.tasks': '下一步任务',

    'panel.failures': '失败',
    'panel.streak': '连对',
    'panel.overdue': '逾期',
    'panel.dayShort': '天',
    'panel.weak': '偏弱',

    'panel.empty.title': '还没有学习档案',
    'panel.empty.body': '这个学习空间没有状态文件。在对话框里直接开始一次学习，或者贴下面这句让 agent 建档：',
    'panel.empty.starter': '帮我用 learning_session 建一份学习档案，我想学 <主题>',

    'sidebar.label': '学习',
    'sidebar.none': '学习：暂无到期复习',
    'sidebar.due': '学习：{n} 项待复习',

    'error.route': '读不到面板数据：宿主路由未挂载或已被拒绝。',
    'error.state': '读不到学习状态',
    'error.state.detail': '状态文件存在但无法解析，进度不会显示。修好后点“刷新”。',
    'error.route.detail': '宿主路由没有挂载，面板拿不到数据。',

    'panel.file': '状态文件',
    'panel.difficulty': '难度',
    'domain.general': '通用',
    'domain.technology': '技术',
    'domain.language': '语言',
    'domain.exam': '应试',
    'domain.writing': '写作',
    'domain.communication': '沟通',
    'level.unknown': '未定',
    'level.no_programming': '无编程基础',
    'level.beginner': '入门',
    'level.intermediate': '中级',
    'level.advanced': '进阶',
    'adjust.easier': '下调',
    'adjust.same': '不变',
    'adjust.harder': '上调',
  },
  en: {
    'view.learning': 'Learning',
    'panel.title': 'Learning Accelerator',
    'panel.refresh': 'Refresh',
    'panel.loading': 'Reading learning state…',
    'panel.updated': 'Updated',

    'panel.due': 'Due now',
    'panel.noReview': 'Nothing is due right now.',
    'panel.dueRatio': 'shown / total due',
    'panel.copy': 'Copy review list',
    'panel.copyHint': 'Copy the due concepts and questions to the clipboard',

    'panel.profile': 'Learning file',
    'panel.goal': 'Goal',
    'panel.topic': 'Topic',
    'panel.outcome': 'Target outcome',
    'panel.counts': 'Progress',
    'panel.attempts': 'attempts',
    'panel.mastered': 'Mastered',

    'panel.progress': 'Other concepts',
    'panel.progressMore': '{n} more not shown',
    'panel.tasks': 'Next tasks',

    'panel.failures': 'fails',
    'panel.streak': 'streak',
    'panel.overdue': 'overdue',
    'panel.dayShort': 'd',
    'panel.weak': 'weak',

    'panel.empty.title': 'No learning file yet',
    'panel.empty.body':
      'There is no state file in this learning scope. Start a learning turn in the chat, or paste this to have the agent create one:',
    'panel.empty.starter': 'Use learning_session to create a learning file; I want to learn <topic>',

    'sidebar.label': 'Learning',
    'sidebar.none': 'Learning: nothing due',
    'sidebar.due': 'Learning: {n} due',

    'error.route': 'Panel data unavailable: the host route is missing or was refused.',
    'error.state': 'The learning state file could not be read',
    'error.state.detail': 'The file exists but does not parse, so progress is hidden. Fix it and press Refresh.',
    'error.route.detail': 'The host route is not mounted, so the panel has no data to show.',

    'panel.file': 'State file',
    'panel.difficulty': 'Difficulty',
    'domain.general': 'General',
    'domain.technology': 'Technology',
    'domain.language': 'Language',
    'domain.exam': 'Exam',
    'domain.writing': 'Writing',
    'domain.communication': 'Communication',
    'level.unknown': 'Unset',
    'level.no_programming': 'No programming',
    'level.beginner': 'Beginner',
    'level.intermediate': 'Intermediate',
    'level.advanced': 'Advanced',
    'adjust.easier': 'easier',
    'adjust.same': 'steady',
    'adjust.harder': 'harder',
  },
}

/* ---- lib/client/10-styles.js ---- */
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

/* ---- lib/client/20-format.js ---- */
/**
 * Transport and pure value formatting.
 *
 * Nothing here touches React or the DOM. Keeping it separate is what lets the
 * presenters below stay trivially testable and hook-free.
 */

/** Fetch one panel snapshot for one workspace. Never rejects: the UI renders the failure. */
async function fetchPanel(cwd) {
  try {
    // The host has no way to know which conversation this panel is rendered in,
    // so the workspace travels with the request. Omitted when unknown, which
    // leaves the host's own session hint in charge.
    const url =
      typeof cwd === 'string' && cwd.length > 0 ? `${PANEL_ENDPOINT}?cwd=${encodeURIComponent(cwd)}` : PANEL_ENDPOINT
    const response = await fetch(url, {
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

/** A whole number, or 0 for anything that is not one. */
function countOf(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0
}

/**
 * Localize an enum value such as `technology` or `harder`.
 *
 * A key the dictionary does not define comes back as itself, so an unmapped enum
 * renders the raw value instead of `domain.technology`.
 */
function enumLabel(t, prefix, value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const key = `${prefix}.${String(value)}`
  const label = t(key)
  return label === key ? String(value) : label
}

/** How many whole days past its due date one review is, or null. */
function overdueDays(dueAt) {
  if (typeof dueAt !== 'string' || dueAt.length < 10) return null
  const due = new Date(`${dueAt.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(due.getTime())) return null
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((today.getTime() - due.getTime()) / 86400000)
  return days > 0 ? days : null
}

/**
 * `HH:MM` for a snapshot timestamp.
 *
 * The panel fetches once and then sits there, so the reader needs to know how old
 * what they are looking at is; `generated_at` was already in the payload and
 * previously unused.
 */
function clockOf(iso) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Copy the due concepts and their questions, for pasting back into the chat. */
function copyReviewList(items) {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return
  const text = items.map((item) => `${String(item.concept ?? '')}: ${String(item.prompt ?? '')}`).join('\n')
  const writing = navigator.clipboard.writeText(text)
  if (writing && typeof writing.catch === 'function') writing.catch(() => {})
}

/* ---- lib/client/30-presenters.js ---- */
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

/* ---- lib/client/40-panel.js ---- */
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
    setView((previous) =>
      previous.data
        ? { phase: previous.phase, data: previous.data, pending: true }
        : { phase: 'loading', data: null, pending: true },
    )
    fetchPanel(cwd).then((data) => {
      if (box.seq === seq) setView({ phase: data.ok ? 'ready' : 'failed', data, pending: false })
    })
  }, [cwd, box])

  React.useEffect(() => {
    load()
    return () => {
      box.seq += 1
    }
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
  const detailLine = detail === status ? detail : [detail, status ? `（${status}）` : ''].join('')

  return h(
    'div',
    { className: 'dla-root' },
    h(
      'div',
      { className: 'dla-body' },
      h(
        'div',
        { className: 'dla-head' },
        h('div', { className: 'dla-titles' }, h('h2', { className: 'dla-title' }, t('panel.title'))),
        h(
          'div',
          { className: 'dla-head-side' },
          h(Primitives.Button, { size: 'sm', variant: 'ghost', onClick: load }, t('panel.refresh')),
        ),
      ),
      h(
        'div',
        { className: 'dla-error' },
        h('div', { className: 'dla-error-title' }, missingRoute ? t('error.route') : t('error.state')),
        h('p', { className: 'dla-error-body' }, missingRoute ? t('error.route.detail') : t('error.state.detail')),
        detailLine ? h('p', { className: 'dla-error-detail' }, detailLine) : null,
      ),
      Footer(t, data?.path),
    ),
  )
}

/**
 * The no-track shape.
 *
 * No refresh control: there is no file to re-read, so the button would only
 * suggest an action that changes nothing. What it offers instead is a sentence the
 * learner can paste into the chat, which is the one action that does work.
 */
function EmptyFrame(t, data) {
  return h(
    'div',
    { className: 'dla-root' },
    h(
      'div',
      { className: 'dla-body' },
      h(
        'div',
        { className: 'dla-head' },
        h('div', { className: 'dla-titles' }, h('h2', { className: 'dla-title' }, t('panel.title'))),
      ),
      h(
        'div',
        { className: 'dla-empty' },
        h('h3', { className: 'dla-empty-title' }, t('panel.empty.title')),
        h('p', { className: 'dla-empty-body' }, t('panel.empty.body')),
        h('div', { className: 'dla-starter' }, t('panel.empty.starter')),
      ),
      Footer(t, data.path),
    ),
  )
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

  const head = h(
    'div',
    { className: 'dla-head' },
    h(
      'div',
      { className: 'dla-titles' },
      h('h2', { className: 'dla-title' }, t('panel.title')),
      h('div', { className: 'dla-sub' }, subtitle),
    ),
    h(
      'div',
      { className: 'dla-head-side' },
      stamp
        ? h('span', { className: 'dla-stamp', title: String(data.generated_at) }, `${t('panel.updated')} ${stamp}`)
        : null,
      h(Primitives.Button, { size: 'sm', variant: 'ghost', onClick: load }, t('panel.refresh')),
    ),
  )

  // The host caps `priority_reviews` at five while `counts.due` counts every due
  // item, so when they differ the heading says "shown / total" and the tooltip
  // spells it out, rather than showing two numbers that disagree.
  const dueSection = Section(
    t('panel.due'),
    due > reviews.length ? { text: `${reviews.length} / ${due}`, title: t('panel.dueRatio') } : String(reviews.length),
    reviews.length === 0
      ? h('p', { className: 'dla-empty-body' }, t('panel.noReview'))
      : h(
          'div',
          { className: 'dla-card' },
          h('ul', { className: 'dla-reviews' }, ...reviews.map((item, index) => ReviewRow(t, item, index))),
        ),
    reviews.length === 0
      ? null
      : h(
          Primitives.Button,
          {
            size: 'sm',
            variant: 'ghost',
            title: t('panel.copyHint'),
            onClick: () => copyReviewList(reviews),
          },
          t('panel.copy'),
        ),
  )

  // Mastered concepts are the one positive signal the payload carries, and nothing
  // else in the panel repeats them.
  const masteredCell =
    mastered.length === 0
      ? null
      : [
          h('dt', { key: 't-mastered' }, t('panel.mastered')),
          h(
            'dd',
            { key: 'd-mastered' },
            h(
              'div',
              { className: 'dla-tags' },
              ...mastered.slice(0, 12).map((concept, index) =>
                h(
                  Primitives.Tag,
                  {
                    key: `${concept}-${index}`,
                    tone: 'success',
                  },
                  String(concept),
                ),
              ),
            ),
          ),
        ]

  const profileSection = Section(
    t('panel.profile'),
    null,
    h(
      'dl',
      { className: 'dla-facts' },
      Fact(t('panel.goal'), goal),
      Fact(t('panel.topic'), topic),
      Fact(t('panel.outcome'), data.profile?.target_outcome),
      Fact(
        t('panel.counts'),
        `${countOf(data.counts?.exercises)} · ${countOf(data.counts?.attempts)} ${t('panel.attempts')}`,
      ),
      masteredCell,
    ),
  )

  const progressSection =
    rest.length === 0
      ? null
      : Section(
          t('panel.progress'),
          String(rest.length),
          h(
            'div',
            { className: 'dla-plain' },
            h('ul', { className: 'dla-concepts' }, ...visible.map((entry, index) => ConceptRow(t, entry, index))),
            hidden > 0
              ? h('div', { className: 'dla-more' }, t('panel.progressMore').replace('{n}', String(hidden)))
              : null,
          ),
        )

  const tasksSection =
    tasks.length === 0
      ? null
      : Section(
          t('panel.tasks'),
          null,
          h(
            'ul',
            { className: 'dla-tasks' },
            ...tasks.map((task, index) =>
              h(
                'li',
                {
                  className: 'dla-task',
                  key: task.id ?? `${task.name}-${index}`,
                },
                String(task.name ?? ''),
              ),
            ),
          ),
        )

  return h(
    'div',
    { className: 'dla-root' },
    h(
      'div',
      { className: 'dla-body' },
      head,
      dueSection,
      profileSection,
      progressSection,
      tasksSection,
      Footer(t, data.path),
    ),
  )
}

/* ---- lib/client/50-sidebar.js ---- */
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
        ctx.slots.inject('conversation.view', () =>
          ctx.slots.register(
            {
              name: 'conversation.view',
              id: 'learning',
              order: 30,
              locale: NS,
              // A thunk, so the tab label follows a locale change without re-registering.
              label: () => t('view.learning'),
            },
            LearningView,
          ),
        )

        // `sidebar.footer.action` carries `{ wide }` and renders in the sidebar
        // foot, above the settings seat.
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            {
              name: 'sidebar.footer.action',
              id: 'learning',
              order: 100,
              locale: NS,
            },
            SidebarEntry,
          ),
        )
      },
    }
  },
})
