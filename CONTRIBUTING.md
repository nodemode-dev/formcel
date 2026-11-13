# Contributing to FormCel

Thank you for helping. FormCel is an open workbook editor for the Form family:
formulas, charts, PivotTables, tables and Excel and CSV files in one window, with no
account and nothing uploaded. It gets better through real use and real contributions.

## Where to start

- **Use it and report what goes wrong.** A clear bug report, with steps, the version
  and your platform, is one of the most useful things you can give. When a file does
  not open or save the way you expect, say which format it was and what FormCel said
  it left out.
- **Look at the open issues.** Comment on one before starting larger work, so nobody
  builds the same thing twice.

## Setting up

Clone the repository, run `./formcel_oc_install` once, then run `./formcel` (on
Windows, `formcel_oc_install.bat` and `formcel.bat`). The installer sets up the
engine's Python environment, the Rust engine for Python, the npm packages and the Rust
engine for the window; `./formcel` starts the engine on 127.0.0.1:8199 and the window
at http://localhost:5199. You need Python 3.12+, Node 20.19+ and Rust. The README's
"Run it from source" section has the details, and `./build_app` builds the desktop app.

The code lives in:

| Folder | What is there |
| --- | --- |
| `engine/crates/formcel-core` | the calculation engine (Rust): every calculation rule lives here |
| `engine/crates/formcel-wasm` | the window's WebAssembly build of the engine |
| `engine/crates/formcel-py` | the engine process's Python build of the engine |
| `backend/app` | the engine process (Python, FastAPI): files, scripts, sharing, agents, the REST API |
| `backend/tests` | the Python test suite |
| `frontend/src` | the window (vanilla TypeScript, Vite) |
| `frontend/tests/window` | the window smoke test (pytest and Playwright) |
| `src-tauri` | the desktop shell (Rust, Tauri 2) |
| `setup` | build and packaging scripts and the agent kit (MCP, agents, Claude Desktop extension) |
| `scripts` | the scripts that build and record the demo workbooks |
| `demo`, `demos` | the offline browser demos |
| `docs` | `functions.json` (every function and its arguments) and README images |
| `.claude/skills` | the agent skills, mirrored to `.agents/skills` by `./formcel agents sync` |

## Before you open a pull request

Run the same checks CI runs. From `frontend/`:

```sh
npm ci
npm audit
npm run typecheck
npm run build
```

From `backend/`, with the engine's environment active:

```sh
pip install -r requirements.txt -r requirements-test.txt
pip install --force-reinstall --no-deps ../engine/crates/formcel-py
python -m compileall -q app
python -m pytest tests -q -p no:cacheprovider
```

CI also boots the engine (`python -m uvicorn app.main:app --host 127.0.0.1 --port 8199`)
and checks that `http://127.0.0.1:8199/api/health` answers.

The window smoke test, from the repository root:

```sh
(cd engine && ./build_wasm)
(cd frontend && npm ci && npm run build)
pip install pytest==9.1.1 playwright==1.63.0
python -m playwright install chromium
python -m pytest frontend/tests/window -q -p no:cacheprovider
```

And the repository checks, from the root:

```sh
./formcel agents check
./formcel mcpb check
```

CI also runs `bash -n` over the shell scripts, fails on any em dash or emoji in tracked
Markdown, and fails on the sparkle icon anywhere in the interface.

- Keep each pull request to one change, with tests for what it adds or fixes.
- Write commit subjects the way the history does: `feat(engine): ...`,
  `fix(home): ...`, `docs(readme): ...`, `test(...)`.
- Every calculation rule goes in `engine/crates/formcel-core`. The WebAssembly and
  Python builds only translate calls; a rule written anywhere else is a bug.
- No emoji, no icon libraries (inline `currentColor` SVG in `frontend/src/ui/icons.ts`),
  no em dashes in Markdown, and every z-index is a token from
  `frontend/src/styles/z-layers.css`.
- Edit agent skills only in `.claude/skills`, then run `./formcel agents sync`.
- Leave version numbers to the maintainers.

## How changes land

Only the maintainers push to `main`. Everyone else forks the repository and opens a pull request into `main`. A pull request merges when all five CI jobs (frontend, backend, test, window and scripts) pass on an up-to-date branch and a maintainer has approved it after its last push.

## Releases

A release is a version, and only the maintainers make one. FormCel builds are compiled
and released from [FormCompiler](https://github.com/nodemode-dev/formcompiler); this
repository holds the source. FormCompiler releases a commit only when this repository's
CI passed on that exact commit. No pull request here starts a release.

## Licensing

FormCel is licensed under the Apache License 2.0. By contributing, you agree that
your contribution is licensed under the same terms. Only add code you have the right
to contribute, and name any third-party code and its licence in the pull request.

## Patents and other people's IP

Some features are deliberately not built, or were taken out, because they come too close to someone else's patent, trademark, copyright or design. The maintainers hold that line with counsel; contributors do not decide it, and nobody here redesigns a feature on their own reading of a patent. This is engineering diligence, not legal advice.

### Features this project will not implement

- Linked records (such as stocks and currencies) kept inside the cell. They live in the workbook's record store, and a cell keeps only the record's id and its label.
- Per-field show or hide properties on linked records.
- Editing or ungrouping a sparkline group in the app.
- Data Model relationships inferred from a formula or from names. Relationships are always explicit, created by the person.
- A Flash Fill that makes a relaxed second pass or loops over the examples. It stays a single synthesis pass.
- An action that collapses a range into one cell as an array.
- Blur, sharpen or glow image functions driven by cell values.
- Moving part of a ribbon group into an overflow pane. Ribbon groups collapse whole.

A pull request that adds one of these, under any name, through any dependency, plug-in, model, template, agent tool or plain code, is closed with a link to this section. Lifting a decline needs the maintainers' written decision after a review, recorded here first.

### Rules for every contribution

- Patents: do not add a feature, or a dependency that provides one, that reproduces a method you know to be patented. If you are unsure, open an issue that describes what the feature does, not which patent it resembles. Patent numbers stay out of code, commits, comments, logs and changelogs.
- Trademarks: other vendors' product and feature names appear only to name a file format or compatibility ("Excel Workbook (.xlsx)", "opens files from"). No command, menu, panel, tool, ribbon group, preset, template, theme or agent tool takes another product's feature name, and no text says "like X" or "the way X does it". No vendor brand colours. Describe what the feature does.
- Copyright: never copy another product's help, tooltip, dialog or documentation text (link to it instead); function summaries in `docs/functions.json` and every template stay in FormCel's own words. Never trace or import vendor icons; never bundle vendor templates, themes, fonts, sample files or stock images. Compatibility layers carry names and signatures only. Test fixtures come from this repository's own scripts.
- Licences: every new dependency, binary, model, font or data file gets a row in `NOTICE.md` before it is used. GPL stays outside the distributed bundle, AGPL nowhere, LGPL dynamically linked and replaceable, MPL files unedited. CC BY credited, CC BY-SA only unmodified, CC NC and ND never.

## Conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). Security
problems go through [SECURITY.md](SECURITY.md), never a public issue.
