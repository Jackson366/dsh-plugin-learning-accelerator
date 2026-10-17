# dsh-plugin-learning-accelerator

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that turns
[Learning-Accelerator](https://github.com/Maolipeng/Learning-Accelerator)'s *General Learning OS* from
"a prompt the agent may follow" into harness-native capability: the teaching protocol in the prompt,
durable learner state, deterministic spaced repetition, model-callable tools, and a Web panel.

It is written in **plain JavaScript**. The host half is an ESM Cordis plugin with no build step. The
browser half is a classic script the module table loads directly, assembled from `lib/client/` by
`scripts/build-client.mjs` — the host serves exactly one bundle file per package, so that
concatenation is the most the platform allows.

---

## Why a plugin instead of a skill

The upstream project is a skill: a markdown protocol plus a Python CLI the agent is *told* to call.
That works, but it has three structural weaknesses a plugin removes:

| Weakness of a skill | What this plugin does instead |
|---|---|
| The agent must remember to call the CLI before it can know the learner's weak points. | A `systemPrompt` runtime context injects the profile, weak concepts, and due reviews into every turn of a session that has a state file. Zero tool calls, zero tokens for sessions that do not. |
| The *method* lives in three markdown files the agent is asked to load, so "how to teach" competes with the actual task for attention. | The same protocol is a second runtime context — modes, teaching unit, exercise generation, error analysis, difficulty rules — adapted to the stored profile. See [Teaching protocol](#teaching-protocol). |
| The Python CLI must exist on the host and be reachable. | The state kernel is ported to JavaScript, so it runs inside the packaged desktop app with no Python and no repository checkout. |
| "Did it save?" is a claim the agent makes in prose. | `learning_record` is the only write path, and it returns what changed — the touched review item, the new concept strength, the difficulty step. |

The JavaScript port is not a reimplementation in spirit only: `tests/store-equivalence.test.js` runs one
identical operation sequence through both implementations and requires the resulting
`.learning/state.json` to be **byte-identical** to Python's `json.dumps(..., ensure_ascii=False, indent=2,
sort_keys=True)`. Either implementation can read and write the other's file.

## Install

```sh
dsh plugin --profile desktop add ./dsh-plugin-learning-accelerator
```

Then restart the app. Verify the composed layer before restarting:

```sh
dsh --profile desktop --dump-config | grep -A1 learning-accelerator
```

Remove it the same way:

```sh
dsh plugin --profile desktop remove dsh-plugin-learning-accelerator
```

## Documentation

| Topic | Where |
|---|---|
| Why the plugin exists, and the design decisions behind it | [docs/analysis.md](./docs/analysis.md) |
| The teaching protocol, long form, with a provenance table for every upstream file | [docs/teaching-protocol.md](./docs/teaching-protocol.md) |
| Install, configuration, all five tools and nine actions, the panel, troubleshooting | [docs/usage.md](./docs/usage.md) |
| Module map, the injection points, the equivalence guarantee, the trust boundary | [docs/architecture.md](./docs/architecture.md) |
| Adding a domain, an action, a tool, a prompt block, or the browser half | [docs/extending.md](./docs/extending.md) |
| Worked examples, from "no prior programming" to project-driven learning | [examples/](./examples) |
| The machine-readable state contract | [schemas/learning_state.schema.json](./schemas/learning_state.schema.json) |

## Tools

| Tool | Purpose |
|---|---|
| `learning_status` | Read the whole picture: profile, topic, mastered/weak concepts, due and priority reviews, tasks, difficulty. The entry point for any learning turn. |
| `learning_due` | The ranked spaced-repetition queue. Ranked by weak-concept status (+30), low strength (`(1-strength)×20`), and repeated failures (+3 each), ties broken by code point like the Python store. `limit` defaults to 5 and can be raised. |
| `learning_session` | Onboarding and profile edits: domain, known skills, experience level, goal, target outcome, topic, constraints, next task. Returns the domain's onboarding questions **and the teaching protocol adapted to the profile it just saved**. |
| `learning_record` | The single write path. Actions: `review_complete`, `review_add`, `concept`, `exercise`, `exercise_spec`, `attempt`, `mistake`, `task`, `evidence`. |
| `learning_domain` | The static domain template (focus areas, practice types, review strategy, onboarding questions) plus that domain's teaching protocol, with no state required. |

All five return a canonical JSON value, so [Code Mode](https://github.com/deepseek-ai/deepseek-harness)
can call them as `await tools.learning_status({})` and program against fields rather than parsing prose.

## How a turn actually runs

1. The session opens in a directory that has a `.learning/state.json`. The prompt context now carries
   both the teaching protocol and the learner's weak concepts and today's due reviews, so the model
   already knows how to run a turn and where to start.
2. The model calls `learning_due` to get the ranked queue and asks the learner the top item's recall
   prompt — without leaking the answer.
3. The learner answers. The model calls `learning_record` with `action: 'review_complete'` and
   `result: 'correct' | 'second_correct' | 'third_correct' | 'incorrect' | 'fuzzy'`.
4. That one call archives the review, moves the concept's strength and streak, promotes it to mastered
   (or back to weak), schedules the next interval, appends difficulty evidence, and may step the
   difficulty up or down. It returns that whole delta, which is the state update the model reports.
5. If the learner struggled, `action: 'mistake'` marks the concepts weak, queues a review for each, and
   logs the diagnosed error — one call instead of four.

## Teaching protocol

Upstream keeps its pedagogy in `SKILL.md`, `SYSTEM_PROMPT.md`, and
`references/learning_os_protocol.md`. A skill can only ask the model to read them; this plugin puts
them in the prompt:

| Block | Order | Carries |
|---|---|---|
| `learning-accelerator/protocol` | `promptContextOrder - 1` (149) | The method: seven operating modes, the per-turn loop, the ten-step teaching unit, exercise generation with `easy`/`normal`/`stretch`, six-step error analysis, difficulty signals, the "do not" list, and the learner's adaptation block. |
| `learning-accelerator/status` | `promptContextOrder` (150) | The state: domain, goal, weak concepts, due reviews, ranked queue, next tasks, difficulty. |

Both are gated by the same rule — **only a scope that already has a real learning track hears from
this plugin** — so an unrelated session still pays zero tokens. That leaves one hole: the first turn
of a brand-new track has no state file yet, so `learning_session` and `learning_domain` return
`teaching_protocol` in their result instead. Method on turn one, method plus state afterwards.

Profile adaptation is dispatched from data, not from the model's guess. A declared
`experience_level: 'no_programming'` always selects the everyday-analogy table; a declared
frontend / JS / TS / React / Node background selects the frontend-to-Python mapping; an unknown
background gets neither, because "do not assume frontend" is upstream's own anti-pattern.

The long form, with a table mapping every upstream file and section to the artifact that carries it,
is in [`docs/teaching-protocol.md`](./docs/teaching-protocol.md).

## Spaced repetition

The intervals are the upstream protocol's, unchanged:

| Result | Interval | Side effects |
|---|---|---|
| `correct` | 1 day | strength +0.1, streak +1 |
| `second_correct` | 3 days | strength +0.2, streak +1, concept → mastered |
| `third_correct` | 7 days | strength +0.2, streak +1, concept → mastered |
| `fuzzy` / `incorrect` | now (0 days) | strength −0.2, streak reset, failures +1, concept → weak |

Difficulty moves one step on **two consecutive same-polarity signals** (`recall_correct`,
`exercise_completed`, `explain_correct` vs `recall_incorrect`, `exercise_failed`, `explain_fuzzy`,
`setup_failed`), bounded to 1–5.

## Web panel

The browser half adds:

- a **`conversation.view` tab** ("学习" / "Learning") showing the domain, level, difficulty, goal,
  topic, state file path, the priority review queue, weak concepts, a per-concept strength meter, and
  the queued next tasks;
- a **`sidebar.footer.action`** entry showing how many reviews are due, with the priority concepts in
  its tooltip.

Both read `GET /learning-accelerator/panel` from the host. The tab **follows the conversation it is
rendered in**: it reads that session's workspace from the session standard props and passes it as
`?cwd=`, so switching workspace switches the panel. A request without that hint — the sidebar seat, or a
composition that does not provide the session kit — leaves the host's own session rule in charge. Both
are honest about failure: a missing route, a malformed state file, or a dead host renders an
explanation instead of an empty frame.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `stateFile` | — | Explicit state file; overrides every other scope rule. |
| `root` | process cwd | Project root used when the session has no working directory. |
| `scope` | `project` | `project` keeps `./.learning/state.json`; `user` keeps `~/.learning-accelerator/state.json`. |
| `injectPromptContext` | `true` | Contribute the state block (profile, weak concepts, due reviews). |
| `injectProtocol` | `true` | Contribute the teaching-protocol block. Independent of `injectPromptContext`, so the method and the queue can be enabled separately. |
| `promptContextOrder` | `150` | Order of the state block; the protocol block sits one order above it, so the method is read before the queue. The tool-guidance band is 100–199. |
| `panelRoute` | `true` | Serve the panel snapshot on the local HTTP carrier. |

```yaml
- id: learning-accelerator
  name: dsh-plugin-learning-accelerator
  config:
    scope: user
    promptContextOrder: 140
```

A patch row **replaces the whole `config` object** rather than merging into it, so restate every key you
still want. The Web panel follows the workspace of the conversation it is rendered in, so a multi-project
app needs no configuration for it. To pin the panel (and every tool call) to one project instead, set an
explicit `stateFile`:

```yaml
- id: learning-accelerator
  name: dsh-plugin-learning-accelerator
  config:
    stateFile: /absolute/path/to/your/project/.learning/state.json
```

`root` is **not** a pin: it only answers "which project?" when nothing more specific is known — no
session, no panel hint — so a session in another workspace still wins over it.

## State resolution

One explicit precedence chain decides which `.learning/state.json` a turn belongs to; getting it wrong
would silently strand a learner's progress, so it lives in one function
([`lib/scope.js`](./lib/scope.js)) and is unit-tested on its own:

1. an explicit `state_file` argument,
2. the calling session's working directory (`session.header.cwd`),
3. the workspace the Web panel reported for the conversation it is rendered in (`?cwd=`),
4. the configured `root`,
5. the process working directory.

`scope: user` deliberately short-circuits steps 2–5, because a user-level store is machine-global by
definition.

## Layout

```
lib/learning-store.js   state kernel + spaced repetition, a faithful port of state.py
lib/protocol.js         the teaching protocol (pure data + pure builders, ported from the three upstream markdown files)
lib/scope.js            scope resolution + the caching host service, and both injection texts
lib/tools/              one file per tool (status, due, session, record, domain); index.js registers them
lib/panel.js            the pure panel payload builder (panel follows the learner)
lib/panel-route.js      the panel HTTP route and its request guard
lib/index.js            the Cordis plugin entry: service, tools, two prompt contexts, route
lib/client.js           the browser half — GENERATED from lib/client/, do not edit
lib/client/             its source fragments: strings, styles, format, presenters, panel, sidebar
scripts/build-client.mjs  concatenates lib/client/ into the single bundle the host serves
cordis.patch.yml        the bundle layer
docs/                   analysis (why the design is what it is), teaching protocol, usage, architecture, extending
schemas/                JSON Schema for .learning/state.json, aligned with the JS kernel
examples/               the eight upstream examples, rewritten around this plugin's tools
tests/                  106 tests across 8 files
```

## Tests

```sh
node --test tests/*.test.js
```

`tests/client-build.test.js` fails when `lib/client.js` is stale relative to
`lib/client/*.js`. After editing a fragment, regenerate the bundle:

```sh
node scripts/build-client.mjs   # or: npm run build
```

No test framework is installed: everything uses `node:test`. The suite covers

- **store equivalence** — the JS kernel must produce byte-identical state to the Python store, and
  must rank the review queue the same way;
- **teaching protocol** — the seven modes, the teaching-unit order, the error-analysis steps, and
  every difficulty signal must survive into the injected text; profile dispatch must never hand the
  frontend mapping to an unknown learner; and the injected block is length-bounded so a live track is
  not silently taxed every turn;
- **state schema** — the JSON Schema must cover every field the kernel actually writes, driven by
  real store operations rather than a hand-written list;
- **host plugin** — loading into a real Cordis `Context`, all five tools end to end, both
  prompt-context contracts (gating, profile adaptation, independent switches), scope precedence, and
  disposal unwinding every registration;
- **panel route** — the request guard (including the DNS-rebinding case), status codes, and the
  malformed-state path;
- **browser half** — the bundle loaded through a `window.__ModuleLoader__` sink, with a React stand-in
  that has positional hook state and real re-render semantics, asserting the rendered copy in both
  locales;
- **package structure** — upstream's `test_skill_structure.py` equivalent: every relative markdown
  link resolves, every `package.json` export and `files` entry exists, the bundle patch row names this
  package, and no lib file writes state outside the store.

The store-equivalence test **skips** when `python3` or the Learning-Accelerator checkout is absent, so
the package stays independently testable. CI clones the upstream repo next to this package precisely
so that skip cannot happen there; see [`.github/workflows/ci.yml`](./.github/workflows/ci.yml).

## Known limits

- **The `conversation.view` tab is the panel's home.** The sidebar seat reports the due count but does
  not open the tab: the view ring is owned by `@deepseek-ai/dsh-client-ui-conversation`, and guessing at
  a "activate this view" API would silently do nothing. The sidebar entry stays useful without it.
- **The panel follows the conversation, then the learner.** The `conversation.view` tab asks the page it
  is rendered in for that session's workspace and sends it as `?cwd=`, so it tracks a workspace switch
  immediately. A request *without* that hint — the sidebar seat, whose slot has no session identity —
  falls back to the most recent session working directory this process resolved, then the configured
  `root`, then the process directory, and the winner is always reported in `payload.path` and
  `payload.source`. Only an explicit `stateFile` or a non-default `scope` overrides the reported
  workspace: pin those when you want one project's panel regardless of which conversation is open.
- **The route is loopback-only and Host-checked.** It exposes one learner's profile and progress, so it
  accepts only requests whose `Host` is loopback, plus a local `Origin` when one is present. It is not
  covered by the carrier's authenticated `/api` gateway, and deliberately not under that prefix.
- **Difficulty and review state are per-file, not per-session.** Two sessions on one project share one
  learner. That is the point, but it also means a second user on the same checkout would share it too.
- **The injected protocol text is Chinese**, like the tools' model-facing copy, even when the state
  records a different `preferred_language`. That field steers the *teaching*, not the plugin's own
  fixed strings; translating `lib/protocol.js` is a data change, not a code change.

## License

MIT — see [LICENSE](./LICENSE).
