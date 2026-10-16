# Changelog

All notable changes to `dsh-plugin-learning-accelerator` are documented here.

This package is a DeepSeek Harness port of
[Learning-Accelerator](https://github.com/Maolipeng/Learning-Accelerator). Its state
kernel is required to stay **byte-identical** to the upstream Python store, so the
"Changed" entries below never describe a state-format change that upstream does not
also have.

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
  `learning_record` (single write path, eight actions), `learning_domain`.
- Scope resolution chain (`state_file` → session cwd → configured root → process
  cwd) with a user-scope short circuit.
- Prompt-context injection for scopes that already carry a learning track.
- A read-only Web panel: a `conversation.view` tab and a `sidebar.footer.action`
  due counter, served from a loopback-only, Host-checked route.
- Byte-equivalence, host-plugin, panel-route, and browser-half test suites.
