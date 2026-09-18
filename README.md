<!--
  SPDX-FileCopyrightText: 2026 Kubuno contributors
  SPDX-License-Identifier: AGPL-3.0-or-later
-->

<div align="center">

<img src=".github/logo.png" alt="Kubuno Forms logo" width="120">

# Kubuno — Forms

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](LICENSE)
![Rust](https://img.shields.io/badge/Rust-edition_2021-orange.svg)
![React](https://img.shields.io/badge/React-19-61dafb.svg)
![Status](https://img.shields.io/badge/status-alpha-yellow.svg)
![Module](https://img.shields.io/badge/Kubuno-module-4D38DB.svg)

**Forms, surveys and quizzes for [Kubuno](https://github.com/kubuno/core) — the self-hosted, libre (AGPLv3) cloud platform, a sovereign alternative to Google Workspace and Microsoft 365.**

Build forms, surveys and quizzes in a visual editor, share them through a public link, and collect answers from anonymous respondents — all on your own server.

</div>

---

## ✨ Features

- 🧩 **Rich question catalogue** — short and long text, single and multiple choice, dropdown, linear scale, rating (stars/hearts), date and time, file upload, hand-drawn signature, single and multi-choice grids, plus structured fields: postal address, date of birth, international phone (searchable dial-code selector), and grouped multi-field blocks (a full name or organization block).
- 🖼️ **Content blocks** — beyond questions, a form can carry layout and media: welcome and thank-you screens, information text, section breaks, image blocks, and video blocks (a Drive file, a Media library item, or an external link).
- ✒️ **Polished visual editor** — a floating action rail pinned next to the section being edited, full undo/redo history, insertion at any position, drag-to-reorder for questions *and* choice options, and per-block duplication. Text answers render as Material-Design "outlined" fields with animated floating labels.
- 🔤 **Rich text everywhere it matters** — titles and descriptions support bold, italic, underline, links and lists through an inline toolbar. Everything is **sanitised server-side** on save (allow-list of tags and URL schemes), so a shared public form can never carry scripts or event handlers.
- 🎨 **Header banner & option images** — give the form a header image and illustrate individual choice options with pictures; images are stored with the form and served through its public token, so anonymous respondents always see them. Themable color, font and background.
- 🔢 **Sections** — group questions into numbered sections with their own navigation; duplicate, reorder, merge or delete a whole section in one action.
- 📥 **Question import** — copy questions from any of your other forms into the current one, keeping type, options, scoring and feedback.
- 🖥️ **Two public shells** — a classic scrolling page, or a one-question-at-a-time full-screen experience.
- 🏆 **Quiz mode** — points, correct answers and per-question feedback, with automatic scoring on submission.
- 🔀 **Conditional logic** — visual "if … then …" rules to branch, show or hide questions based on previous answers.
- 📊 **Responses** — browse individual submissions, aggregate statistics, and file uploads collected from respondents; instance-wide anti-spam cooldown, response retention and upload-size limits from the admin console.

## 🏗️ Architecture

Kubuno is **modular**: a **core** (the platform's "operating system") plus independent **modules**. Each module — Forms included — is a **separate process** that connects to the core at startup on its own dedicated port (**3108** for Forms); the core proxies its routes (`/api/v1/forms/*`), distributes events and serves its runtime-loaded React frontend bundle.

- **Backend** — `src/`: Axum + SQLx (PostgreSQL, schema `forms`); migrations in `migrations/`.
- **Frontend** — `frontend/`: a React bundle built to `entry.js`, consuming `@kubuno/sdk`, `@ui` and `@kubuno/drive` from the host at runtime via its import map.

## 📦 Install

The easiest way to self-host a full Kubuno instance (core + every module, Forms included) is the **all-in-one Docker image** (`ghcr.io/kubuno/kubuno`). See **[kubuno/docker](https://github.com/kubuno/docker)** for `docker compose` instructions.

To add this module to an existing instance, install its **Kubuno package** (`.kbpkg`) — the single format the core installs by itself, the same file on Linux, Windows and macOS. Grab it from the admin console's marketplace, or install it offline from the command line:

```bash
sudo kubuno modules:install dist/forms-<version>-<os>-<arch>.kbpkg
sudo systemctl restart kubuno         # the core loads the module on (re)start
```

The `.kbpkg` is a ZIP archive rooted at the module folder; the core unpacks it in pure Rust, so installation is identical on every platform. It is the **only** distribution format for a module — a module is not a system service, so there are no `.deb`/`.rpm`/`.exe`/`.pkg` packages.

## 🛠️ Build & development

**Requirements:** Rust ≥ 1.82, Node.js ≥ 24, PostgreSQL 16.

```bash
cargo build --release                     # → target/release/kubuno-forms (shared crates from git tags)
cd frontend && npm ci && npm run build    # → dist/{entry.js, entry.css} (@kubuno/* from npm)
bash build_kbpkg.sh                       # → dist/forms-<version>-<os>-<arch>.kbpkg
bash build_kbpkg.sh --install             # build, install into the local module store, and restart
```

> Shared dependencies come from Kubuno — no `kubuno/core` checkout required:
> - **Rust** — shared crates via tagged git dependencies on `kubuno/core`.
> - **Frontend** — `@kubuno/sdk`, `@kubuno/ui` and `@kubuno/drive` from the `@kubuno` npm scope, resolved at runtime to the host's singletons through its import map.

## 📦 Tech stack

Rust 2021 · Axum 0.7 · Tokio · SQLx 0.8 (PostgreSQL 16, schema `forms`) — React 19 · TypeScript · Vite · Tailwind CSS v4 · Zustand · React Query.

## 🤝 Contributing

Contributions are welcome. Please open an issue to discuss any significant change before submitting a pull request.

## 📄 License

[AGPL-3.0-or-later](LICENSE) © Kubuno contributors.
