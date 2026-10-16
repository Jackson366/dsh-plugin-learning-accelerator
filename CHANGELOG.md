# Changelog

All notable changes to `dsh-plugin-learning-accelerator` are documented here.

This package is a DeepSeek Harness port of
[Learning-Accelerator](https://github.com/Maolipeng/Learning-Accelerator). Its state
kernel is required to stay **byte-identical** to the upstream Python store, so the
"Changed" entries below never describe a state-format change that upstream does not
also have.

## v0.2.2

Makes the Web panel follow the workspace the learner is actually looking at. This
was the last place where the plugin's *wiring* disagreed with its documented
intent: the panel claimed to follow the learner, but the only signal a browser
request could carry was "whichever session happened to resolve a store last inside
this process", so switching workspace in the app left the panel on the previous
project until a turn ran somewhere else.

### Fixed

- **The panel stayed on the previous workspace after a workspace switch.** A
  browser request carries no session identity, but the page rendering the panel
  does: `conversation.view` is a session-scoped slot, so its component receives
  `sessionId` and `useSessions` as standard props, and
  `SessionListState.byId[sessionId].cwd` is the runtime's own record of that
  conversation's workspace. `lib/client.js` now reads it and sends
  `GET /learning-accelerator/panel?cwd=<workspace>`, and the host resolves that
  workspace as a new precedence step — below an explicit `stateFile` and a
  session's own `cwd`, above the configured `root` and the process directory —
  reported to the UI as `source: "panel-cwd"` (`lib/scope.js`, `lib/panel.js`).
  `lib/panel-route.js` treats the value as page input: it accepts a trimmed
  absolute path only, and drops a relative, empty, NUL-bearing, over-long, or
  undecodable one, so the request falls back to the host's own session hint
  instead of naming an arbitrary directory.
- **`root` was documented as pinning the panel, and never did.** `apply` forwards
  `config.stateFile` to the panel route, not `config.root`, and `panelRequest`
  only stops following sessions for an explicit `stateFile` or a non-default
  `scope`. README and `docs/usage.md` now say what is true: the panel follows the
  open conversation, `root` is a fallback rather than a pin, and pinning means an
  explicit `stateFile` — which pins every tool call too.

### Tests

- `tests/client-plugin.test.js` gains three cases: the tab sends the open
  conversation's workspace, switching session switches the requested workspace
  (the regression, which fails against the pre-fix client), and an unknown
  workspace sends no hint rather than inventing one.
- `tests/panel-route.test.js` gains six: `panelCwdFromRequest` accepts the
  absolute spellings the client can emit and rejects the rest; a reported
  workspace wins over the host's remembered session and lands as
  `source: "panel-cwd"`; an explicit `stateFile`, a configured `scope`, or a bad
  hint still decides normally; and the route renders a reported workspace end to
  end while a rejected hint falls back to the session path.
- Suite: 91 tests, 91 pass, 0 skipped (up from 82).

## v0.2.1

Fixes four places where the plugin diverged from upstream even though the *state
files* stayed byte-identical. The divergence was never in the data — it was in
what the model was told: which review to drill first, how many were due, and what
day it was. A byte-equality test cannot see any of that, which is why all four
survived v0.2.0.

### Fixed

- **`priority_reviews` broke ties with a locale collation instead of code points.**
  `lib/learning-store.js` used `String.prototype.localeCompare`, which is
  case-insensitive at its primary level and orders by alphabet; Python compares
  `str` by code point. For tied items — same priority *and* same `due_at`, the
  normal case once a learner has several weak concepts — the queue came out in a
  different order than the Python store's, so "what to review first" depended on
  which implementation ran. Ranking now uses `compareCodePoints()`, which iterates
  whole code points and so matches Python above the BMP too. `lib/panel.js` used
  the same collation for its concept-progress tie-break and now shares the helper.
- **`learning_due`'s `limit` and `learning_status`'s `due_limit` were caps of five,
  not limits.** Both sliced `priorityReviews()`'s default 5-item result, so any
  value above 5 was silently ignored while the parameter descriptions promised
  "Maximum items to return". `priorityReviews(onDate, limit)` now accepts
  `Infinity` for the whole ranked queue, and both tools rank through the store
  before slicing, so the parameters work in both directions. `learning_due`'s
  `total_due` now counts the whole queue rather than a 5-item slice of it.
- **`learning_due` reported a UTC date while the kernel schedules by local date.**
  The kernel decides due-ness with `todayIso()` (local, matching Python's
  `date.today()`), but the tool echoed `new Date().toISOString().slice(0, 10)`.
  In any non-UTC zone those disagree for part of the day, so for the first hours
  of a UTC+ offset's day the tool named yesterday and judged today's items not yet
  due. The `mistake` action's `recorded_at` had the same bug and could date a
  `last_code_errors` row differently from the evidence rows written beside it.
  Both now use `todayIso()`.
- **`learning_record`'s `exercise_spec` action could not set `input`.** The field
  is in the state schema and `validateExerciseSpec` normalizes it, but the tool
  neither declared the parameter nor passed it through, so
  `exercise_specs[].input` could only ever be `""` — upstream's
  `exercise-generate --input` had no equivalent here.

### Added

- **`learning_record` action `exercise`.** Upstream's `exercise complete|fail` CLI
  command writes `record_exercise`, which is the only writer of
  `practice_state.completed_exercises` / `failed_exercises` and the only automatic
  source of the `exercise_completed` / `exercise_failed` difficulty signals. The
  ported `LearningStore.recordExercise` existed and was unit-tested, but **no tool
  action reached it**, so both lists stayed empty and those two signals were
  unreachable for any learner who worked through the tools. The new action
  (`{ action: 'exercise', task, exercise_status?, concepts?, notes? }`) closes
  that; `exercise_status` defaults to `completed` and is validated by the tool
  schema before `execute` runs. The action count is nine.

### Tests

- `tests/store-equivalence.test.js` gains the scenario the byte-equality check was
  blind to: several concepts that share one priority *and* one `due_at`, so the
  tie-break is the only thing that can order them. One test pins the JS order to
  code-point order and asserts it is *not* the collation order; a second runs the
  same fixture through the Python store and compares the two orders. Both fail if
  `compareCodePoints` is reverted.
- `tests/host-plugin.test.js` gains three tool-surface guards (limit above five,
  `due_limit` above five, `on_date` equals the local day), one for the
  `exercise_spec` `input` round-trip, and two for the `exercise` action (it
  reaches the kernel and emits the signal; missing name and illegal status are
  rejected). Each was confirmed to fail against the pre-fix code.
- Suite: 82 tests, 82 pass, 0 skipped (up from 74). The byte-equality guarantee is
  unchanged and still runs against the upstream checkout.

## v0.2.0

Closes the largest gap against upstream: the plugin used to carry the *state* of a
learning track but not the *method*. It now ships the teaching protocol upstream
keeps in `SKILL.md`, `SYSTEM_PROMPT.md`, and `references/learning_os_protocol.md`,
and delivers it natively instead of asking the model to load a file.

### Added

- `lib/protocol.js` — the teaching protocol as data and pure builders: the seven
  operating modes, the per-turn loop, the ten-step teaching unit, per-turn outputs,
  `easy` / `normal` / `stretch` exercise generation, the six-step error analysis,
  difficulty signals, example selection, the "do not" list, and the two analogy
  tables (everyday mental models, frontend-to-Python mapping).
- `profileTrack()` — profile adaptation dispatched from the stored
  `experience_level` and `known_skills` rather than left to the model's guess. A
  declared frontend background selects the mapping table, a declared
  `no_programming` background always wins, and an unknown background is never handed
  frontend analogies.
- A second prompt-context block, `learning-accelerator/protocol`, injected one order
  above the state block (`promptContextOrder - 1`, default 149) and gated by the same
  rule: a scope only hears from this plugin once it has a real learning track.
- `injectProtocol` config (default `true`), independent of `injectPromptContext`, so
  the protocol and the review queue can be enabled separately.
- `LearningAcceleratorService#protocolContext()` and the matching
  `ctx.learningAccelerator.protocolContext()`.
- `learning_session` and `learning_domain` now return `teaching_protocol`, rendered
  into the model-facing text. This is what covers the first turn of a new track,
  where no state file exists yet and the prompt-context blocks are still silent.
- `docs/teaching-protocol.md` — the long form of the protocol with a provenance
  table mapping every upstream section to the artifact that carries it.
- `docs/usage.md`, `docs/architecture.md`, `docs/extending.md`.
- `schemas/learning_state.schema.json` — the machine-readable contract for the
  state file, aligned field by field with `lib/learning-store.js` rather than
  copied blindly from upstream.
- `examples/` — the eight upstream examples, rewritten around this plugin's tools.
- CI (`.github/workflows/ci.yml`): Node 20 / 22 / 24, upstream cloned alongside so
  the byte-equivalence test actually runs, peer packages installed from npm.
- `LICENSE` (MIT) and a `CHANGELOG.md`.

### Changed

- README: documents the two prompt-context blocks, the new config key, and the
  protocol/doc/example/schema layout.
- `package.json` gains `repository` / `homepage` / `bugs`, and `files` now ships
  `docs`, `schemas`, `examples`, `CHANGELOG.md`, and `LICENSE`.

### Fixed

- **The Web panel never actually followed the learner.** `panelRequest()` resolved the session
  directory correctly, and `panelRequest`'s unit tests passed, but `apply` always forwarded the
  configured `scope` — whose Cordis-applied default is `'project'` — and any explicit scope means
  "stop following sessions". The panel therefore fell back to the configured root or the process
  working directory (for the packaged app, the profile directory) on every default install. `apply`
  now forwards `scope` only when it differs from the project default. Regression tests mount the real
  plugin, take the really-registered route, and drive it with a fake request: revert that one line and
  *the panel route follows the session directory through the real wiring* fails.
- `exports["."].types` pointed at `lib/index.d.ts`, which has never existed in this
  package. The condition is removed, so a TypeScript consumer resolves `main`
  instead of a broken path.

### Tests

- `tests/docs.test.js` — the package-structure gate
  (`test_skill_structure.py`'s equivalent): markdown links, `exports` targets, `files` entries, the
  bundle patch row, the documented test count, and "no state writes outside the store". It fails on a
  link to a document that does not exist, which is exactly how the missing `docs/` files were caught
  while they were still being written.

### Compatibility

- State format unchanged: `schema_version` stays `1`, and
  `tests/store-equivalence.test.js` still requires byte-identical output against
  the Python store.
- Existing installs need no config change: both new behaviours default to on.

## v0.1.0

Initial release.

### Added

- `LearningStore` in JavaScript — a faithful port of upstream `state.py`: schema
  migration and validation, review scheduling, concept progress, exercise specs,
  attempt records, evidence-driven difficulty adjustment, summary and prompt
  context.
- Five model-facing tools: `learning_status`, `learning_due`, `learning_session`,
  `learning_record` (single write path, eight actions at the time; the `exercise`
  action joined in v0.2.1), `learning_domain`.
- Scope resolution chain (`state_file` → session cwd → configured root → process
  cwd) with a user-scope short circuit.
- Prompt-context injection for scopes that already carry a learning track.
- A read-only Web panel: a `conversation.view` tab and a `sidebar.footer.action`
  due counter, served from a loopback-only, Host-checked route.
- Byte-equivalence, host-plugin, panel-route, and browser-half test suites.
