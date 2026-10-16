# dsh-plugin-learning-accelerator

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that turns
[Learning-Accelerator](https://github.com/jackson/Learning-Accelerator)'s *General Learning OS* from
"a prompt the agent may follow" into harness-native capability: durable learner state, deterministic
spaced repetition, model-callable tools, an automatic prompt-context block, and a Web panel.

It is written in **plain JavaScript with no build step** — on both halves. The host half is an ESM
Cordis plugin; the browser half is a classic script the module table loads directly.

---

## Why a plugin instead of a skill

The upstream project is a skill: a markdown protocol plus a Python CLI the agent is *told* to call.
That works, but it has three structural weaknesses a plugin removes:

| Weakness of a skill | What this plugin does instead |
|---|---|
| The agent must remember to call the CLI before it can know the learner's weak points. | A `systemPrompt` runtime context injects the profile, weak concepts, and due reviews into every turn of a session that has a state file. Zero tool calls, zero tokens for sessions that do not. |
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

## Tools

| Tool | Purpose |
|---|---|
| `learning_status` | Read the whole picture: profile, topic, mastered/weak concepts, due and priority reviews, tasks, difficulty. The entry point for any learning turn. |
| `learning_due` | The ranked spaced-repetition queue. Ranked by weak-concept status (+30), low strength (`(1-strength)×20`), and repeated failures (+3 each). |
| `learning_session` | Onboarding and profile edits: domain, known skills, experience level, goal, target outcome, topic, constraints, next task. Returns the domain's onboarding questions. |
| `learning_record` | The single write path. Actions: `review_complete`, `review_add`, `concept`, `exercise_spec`, `attempt`, `mistake`, `task`, `evidence`. |
| `learning_domain` | The static domain template (focus areas, practice types, review strategy, onboarding questions) with no state required. |

All five return a canonical JSON value, so [Code Mode](https://github.com/deepseek-ai/deepseek-harness)
can call them as `await tools.learning_status({})` and program against fields rather than parsing prose.

## How a turn actually runs

1. The session opens in a directory that has a `.learning/state.json`. The prompt context now carries
   the learner's weak concepts and today's due reviews, so the model already knows where to start.
2. The model calls `learning_due` to get the ranked queue and asks the learner the top item's recall
   prompt — without leaking the answer.
3. The learner answers. The model calls `learning_record` with `action: 'review_complete'` and
   `result: 'correct' | 'second_correct' | 'third_correct' | 'incorrect' | 'fuzzy'`.
4. That one call archives the review, moves the concept's strength and streak, promotes it to mastered
   (or back to weak), schedules the next interval, appends difficulty evidence, and may step the
   difficulty up or down. It returns that whole delta, which is the state update the model reports.
5. If the learner struggled, `action: 'mistake'` marks the concepts weak, queues a review for each, and
   logs the diagnosed error — one call instead of four.

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

Both read `GET /learning-accelerator/panel` from the host. They are honest about failure: a missing
route, a malformed state file, or a dead host renders an explanation instead of an empty frame.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `stateFile` | — | Explicit state file; overrides every other scope rule. |
| `root` | process cwd | Project root used when the session has no working directory. |
| `scope` | `project` | `project` keeps `./.learning/state.json`; `user` keeps `~/.learning-accelerator/state.json`. |
| `injectPromptContext` | `true` | Contribute the prompt-context block. |
| `promptContextOrder` | `150` | Order of that block; the tool-guidance band is 100–199. |
| `panelRoute` | `true` | Serve the panel snapshot on the local HTTP carrier. |

```yaml
- id: learning-accelerator
  name: dsh-plugin-learning-accelerator
  config:
    scope: user
    promptContextOrder: 140
```

A patch row **replaces the whole `config` object** rather than merging into it, so restate every key you
still want. To pin the Web panel to one project — the reliable choice when you run several projects from
one app — add a row to `$DSH_HOME/profiles/<profile>/cordis.patch.yml`:

```yaml
- id: learning-accelerator
  name: dsh-plugin-learning-accelerator
  config:
    root: /absolute/path/to/your/project
```

## State resolution

One explicit precedence chain decides which `.learning/state.json` a turn belongs to; getting it wrong
would silently strand a learner's progress, so it lives in one function
([`lib/scope.js`](./lib/scope.js)) and is unit-tested on its own:

1. an explicit `state_file` argument,
2. the calling session's working directory (`session.header.cwd`),
3. the configured `root`,
4. the process working directory.

`scope: user` deliberately short-circuits steps 2–4, because a user-level store is machine-global by
definition.

## Layout

```
lib/learning-store.js   state kernel + spaced repetition, a faithful port of state.py
lib/scope.js            scope resolution + the caching host service
lib/tools.js            the five model-facing tools
lib/panel.js            the pure panel payload builder (panel follows the learner)
lib/panel-route.js      the panel HTTP route and its request guard
lib/index.js            the Cordis plugin entry: service, tools, prompt context, route
lib/client.js           the browser half (classic script, no build)
cordis.patch.yml        the bundle layer
tests/                  45 tests: store equivalence, host plugin, panel route, browser half
```

## Tests

```sh
node --test tests/
```

No test framework is installed: everything uses `node:test`. The suite covers

- **store equivalence** — the JS kernel must produce byte-identical state to the Python store;
- **host plugin** — loading into a real Cordis `Context`, all five tools end to end, the prompt-context
  contract, scope precedence, and disposal unwinding every registration;
- **panel route** — the request guard (including the DNS-rebinding case), status codes, and the
  malformed-state path;
- **browser half** — the bundle loaded through a `window.__ModuleLoader__` sink, with a React stand-in
  that has positional hook state and real re-render semantics, asserting the rendered copy in both
  locales.

The store-equivalence test **skips** when `python3` or the Learning-Accelerator checkout is absent, so
the package stays independently testable.

## Known limits

- **The `conversation.view` tab is the panel's home.** The sidebar seat reports the due count but does
  not open the tab: the view ring is owned by `@deepseek-ai/dsh-client-ui-conversation`, and guessing at
  a "activate this view" API would silently do nothing. The sidebar entry stays useful without it.
- **The panel follows the learner, not the browser.** A browser request carries no session identity, so
  the panel cannot ask "which file does this conversation belong to". It uses the most recent session
  working directory this process resolved, then the configured `root`, then the process directory — and
  reports the winner in `payload.path`. Pin it explicitly with `root` if you want deterministic
  behaviour regardless of which session ran last.
- **The route is loopback-only and Host-checked.** It exposes one learner's profile and progress, so it
  accepts only requests whose `Host` is loopback, plus a local `Origin` when one is present. It is not
  covered by the carrier's authenticated `/api` gateway, and deliberately not under that prefix.
- **Difficulty and review state are per-file, not per-session.** Two sessions on one project share one
  learner. That is the point, but it also means a second user on the same checkout would share it too.

## License

MIT.
