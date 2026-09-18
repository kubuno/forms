# Changelog

All notable changes to **kubuno-forms** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this
project adheres to [Semantic Versioning](https://semver.org/). Entries are added under
`[Unreleased]` **as the change is made**; `_tools/release.sh` stamps them under the version
number at release time, and CI publishes that section as the GitHub Release notes.

## [Unreleased]

### Security

- **HTML sanitiser updated to a patched release.** `ammonia` moves from 4.1.3
  to 4.2.0, closing two cross-site scripting holes in the sanitiser itself,
  one through MathML and one through SVG animation tags (RUSTSEC-2026-0193,
  RUSTSEC-2026-0213).
- **HTTP/2 layer updated to a patched release.** `h2` moves from 0.4.15 to
  0.4.19, closing a denial of service through unbounded empty DATA frames
  (RUSTSEC-2026-0258).
- **Error library updated to a patched release.** `anyhow` moves from 1.0.102
  to 1.0.104, closing an unsoundness in `Error::downcast_mut()`
  (RUSTSEC-2026-0190).
- **TLS library updated to a patched release.** The pinned `rustls` carried
  RUSTSEC-2026-0285 (medium). Every outbound HTTPS connection goes through it.

## [0.1.7] - 2026-09-18

### Changed



- **This module now installs as a Kubuno package (`.kbpkg`) only.** Its system
  packages (Debian/RPM and the Windows and macOS installers) are no longer
  built: the module is distributed as one `.kbpkg` per platform (Linux, Windows,
  macOS) that the Kubuno server installs itself — from the admin console, or
  offline with `kubuno modules:install <file>.kbpkg`.
- **Dates are formatted by the platform now, not by a library.** `date-fns` is
  gone from this module: the shared SDK exposes helpers built on `Intl`, which is
  localised for every language we ship and needs no locale bundle loaded. Call
  sites say what a date is FOR — `formatDate(d, 'date')` — and the platform
  decides how to write it, so a reader in Japanese no longer gets a French
  layout. Machine formats (keys, `<input type="date">` values) go through
  `toISODate` and friends, built from local calendar fields so the day cannot
  shift near midnight.
- **The README now opens with the module's logo.** The public README on
  GitHub now shows the module's designer logo (the same PNG shown as the
  browser tab icon and in the applications menu) at the top of the page — the
  repository landing now matches the icon a signed-in user sees inside the
  platform. The image ships in-repo, under `.github/logo.png`, so it renders
  even when the repo is browsed offline.

- **New Forms logo** — a green hexagon with a light form/checklist, used as
  the browser-tab icon and in the applications menu. It replaces the generic
  clipboard icon and is raster (PNG) designer artwork; the Forms tab now has
  an icon of its own.
- **Forms is called "Forms" in every language**, not "Formulaires" in French.
  Module names are product names and are no longer translated.




### Fixed


- **A withdrawn dependency is no longer used.** A crate deep in the tree
  (`spin` 0.9.8, pulled in through the HTTP stack) was yanked by its authors.
  No vulnerability was announced, but a withdrawn crate has no business in a
  release; the lockfile now takes the version that replaced it.
- **The package could not be built where `zip` is absent.** The Windows job of
  the continuous integration has no `zip`, so the Windows package was simply lost
  the first time it was attempted — a script failure, not a build failure. The
  builder now falls back to 7-Zip, then to PowerShell.
### Added

- **This module now ships a `.kbpkg`** — the single package format a Kubuno
  server installs by itself, the same file on Linux, Windows and macOS. It
  carries the same binary, interface and manifest as the system packages,
  arranged the way the server expects to find a module on disk, plus a
  `SHA256SUMS` so a copy carried offline can be checked without the catalogue.
  Nothing changes for existing installations: the `.deb`, `.rpm`, `.exe` and
  `.pkg` are still published, and a catalogue that sees both simply prefers the
  new one. It is also the only format the server can unpack without an external
  tool, which is what makes one-click installation possible away from
  Debian-like systems.
### Fixed

- **A built package could be thrown away instead of published.** The job that
  attaches a package to the release waited ten minutes for another workflow to
  create that release, then gave up with "release never appeared — build.yml
  likely failed". The diagnosis was wrong: on a repository whose `.deb` takes
  longer than ten minutes to build, the release simply did not exist yet, and a
  package that had built perfectly was discarded. Four modules reached v0.1.6
  with packages missing for some systems because of it. The job now creates the
  release itself when it is missing, so it no longer depends on another workflow
  finishing first.
### Added

- **Security policy and CI quality gate.** A `SECURITY.md` documents how to
  report vulnerabilities, and a CI workflow enforces `clippy -D warnings`, a
  dependency-vulnerability audit (`cargo audit`) and the frontend typecheck/tests.

### Security

- **Forms now authenticates proxied requests from a signed token instead of trusting plain headers.** Requests must carry a valid `X-Kubuno-Auth` token minted by the core with this module's internal secret (see `kubuno-modauth`), rather than reading `X-Kubuno-User-*` headers at face value.

### Added

- **Postal-address question** ("Adresse postale"): street / postal code / city /
  country (searchable) with expandable extra lines, from the shared `@ui` AddressField.

- **Date-of-birth question** ("Date de naissance"): separate Day / Month / Year
  fields (year optional), rendered by the shared `@ui` DateField.

- **Phone answers** now use the shared international phone field: country
  dial-code selector (searchable, with flags) + number, plus an optional label.

- **Field group answers.** A new "Groupe de champs" question stacks several
  labelled text sub-fields under one shared icon, with a Plus/Moins chevron that
  reveals advanced sub-fields — e.g. a full "Name" block (prefix/first/middle/
  last/suffix/phonetic…) or an "Organisation" block. Text fields and the group
  now come from the shared `@ui` primitives (`OutlinedField`, `FieldGroup`).

- **Material-Design "outlined" text fields.** Short-answer, paragraph, e-mail,
  number, phone and URL answers now render as outlined fields whose label starts
  inside the box and animates up onto the border on focus or once filled, the
  border opening a notch around it and turning the form's accent colour. E-mail,
  number, phone and URL carry a matching leading icon. In the compact layout the
  question title becomes that floating label (its asterisk moves into the label),
  so it is no longer repeated above the field; the one-question-per-screen layout
  keeps its large title.

## [0.1.6] - 2026-08-19

### Changed

- **Pill-shaped buttons are gone from the interface.** Filter chips, view
  segments, tab selectors and action buttons that were drawn as pills now use the
  same 4 px corner radius as every other button — the shape set them apart for no
  reason other than habit. Round buttons that hold a lone icon, avatars, status
  dots and non-clickable badges keep their shape: a circle around a single glyph
  is not a pill.

- **Plus Jakarta Sans is offered in the font pickers**, alongside Outfit.

- **Outfit replaces Google Sans** in the theme panel's font list and in the
  default typography of new forms. A migration updates the column default and
  the themes already stored — including the per-block header/question/body
  styles — so existing forms follow instead of falling back to Arial.

- Theme tokens: two colours for navigation labels (`--color-text-nav`,
  `--color-text-nav-active`). Every module carries the same token sheet, so the
  values must match across them — whichever bundle loads last would otherwise
  win. No visible change inside this module.

### Changed

- Default form typography follows the platform's new font stack: headers in
  **Google Sans**, questions and body text in **Google Sans Text** (both self-hosted
  by the drive module); the font list offers Google Sans Text, Google Sans and Roboto
  in place of Google Sans Flex, DM Sans and Inter.
- Default application background token aligned with the core (`--body-bg` `#f8fafd`). Only
  visible when the module runs standalone: inside the shell the active theme sets it.

[Unreleased]: https://github.com/kubuno/forms/compare/v0.1.7...HEAD
[0.1.7]: https://github.com/kubuno/forms/releases/tag/v0.1.7
[0.1.6]: https://github.com/kubuno/forms/releases/tag/v0.1.6
