<!--
  SPDX-FileCopyrightText: 2026 Kubuno contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Kubuno Forms

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
![Rust](https://img.shields.io/badge/Rust-edition_2021-orange.svg)
![React](https://img.shields.io/badge/React-19-61dafb.svg)
![Module](https://img.shields.io/badge/Kubuno-module-4D38DB.svg)

**Kubuno Forms — formulaires et sondages**

A module for [Kubuno](https://github.com/kubuno/core), the self-hosted, libre (AGPLv3) cloud platform.

Build forms, surveys and quizzes in a visual editor, share them through a public link, and collect answers from anonymous respondents — all on your own server.

## Features

- **Rich question catalogue** — short/long text, single & multiple choice, dropdown, linear scale, rating (stars/hearts), date & time, file upload, hand-drawn signature, and single/multi-choice grids.
- **Content blocks** — beyond questions, a form can carry layout and media blocks: welcome and thank-you screens, information text, section breaks, **image blocks**, and **video blocks** (a Drive file, a Media library item, or an external link — YouTube, Dailymotion, Vimeo, PeerTube, or a direct video file).
- **Polished visual editor** — a floating action rail pinned next to the section being edited (add a question, a title, an image, a video, or a section break exactly where you are), full **undo/redo** history, insertion at any position, drag-to-reorder for questions *and* choice options, and per-block duplication.
- **Rich text everywhere it matters** — titles and descriptions support bold, italic, underline, links and lists through an inline contextual toolbar. Everything is **sanitised server-side** on save (allow-list of tags and URL schemes), so a shared public form can never carry scripts or event handlers.
- **Header banner & option images** — give the form a header image, and illustrate individual choice options with pictures. Images are stored with the form and served through its public token, so anonymous respondents always see them.
- **Sections** — group questions into numbered sections with their own navigation; duplicate, reorder, merge or delete a whole section in one action.
- **Question import** — copy questions from any of your other forms into the current one, keeping type, options, scoring and feedback.
- **Two public shells** — a classic scrolling page, or a one-question-at-a-time full-screen experience; both themable (colour, font, background).
- **Quiz mode** — points, correct answers and per-question feedback, with automatic scoring on submission.
- **Conditional logic** — visual "if … then …" rules to branch, show or hide questions based on previous answers.
- **Responses** — browse individual submissions, aggregate statistics, and file uploads collected from respondents.

## Architecture

A standalone Rust process that registers with the [core](https://github.com/kubuno/core) at startup; the core proxies its routes (`/api/v1/forms/*`) and serves its runtime-loaded React frontend bundle.

- **Backend** — `src/`: Axum + SQLx (PostgreSQL, schema `forms`); migrations in `migrations/`.
- **Frontend** — `frontend/`: a React bundle built to `entry.js`, consuming `@kubuno/sdk`, `@kubuno/ui` and `@kubuno/drive` from npm (provided by the host at runtime via the import map).

## Install

This module ships in the **all-in-one [Kubuno](https://github.com/kubuno/core) Docker image** (`ghcr.io/kubuno/kubuno`) — the easiest way to self-host a full Kubuno instance (core + every module). See **[kubuno/docker](https://github.com/kubuno/docker)** for `docker compose` instructions.

Native packages are also published on each [GitHub release](https://github.com/kubuno/forms/releases): a **Debian package** (`.deb`), an **RPM** (Fedora / RHEL / openSUSE), a **Windows installer** (`.exe`) and a **macOS package** (`.pkg`). They install the module into an existing Kubuno core installation, which discovers it automatically.

To build these packages from source, see below.

## Build

**Requirements:** Rust ≥ 1.82, Node.js ≥ 24, PostgreSQL 16.

```bash
cargo build --release                     # → target/release/kubuno-forms
cd frontend && npm ci && npm run build     # → dist/{entry.js, entry.css}
bash build_deb.sh                          # → dist/kubuno-forms_*.deb
```

Native packages for other platforms use the same auto-detecting scripts as every Kubuno module:

```bash
bash build_rpm.sh                          # → dist/kubuno-forms-*.rpm       (Linux, needs `rpm`)
bash build_windows.sh                      # → dist/kubuno-forms-setup-*.exe (NSIS; native or cargo-xwin cross-build)
bash build_macos.sh                        # → dist/kubuno-forms-*.pkg       (on a Mac; UNIVERSAL=1 for a fat binary)
```

CI builds all of them: `build.yml` produces the `.deb`, and `dist.yml` the RPM / Windows / macOS artifacts, attached to the GitHub release on every `v*` tag.

> Shared dependencies come from Kubuno — no `kubuno/core` checkout required:
> - **Rust** — shared crates via tagged git dependencies on `kubuno/core`.
> - **Frontend** — `@kubuno/sdk`, `@kubuno/ui`, `@kubuno/drive` from the `@kubuno` npm scope.

## License

[AGPL-3.0-or-later](LICENSE) © Kubuno contributors.
