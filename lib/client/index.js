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

/* @body */

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
