# EAS build → TestFlight (SwingSight)

> PRD Phase 7 (C). The measurement/coaching/report loop is built and live; this ships the
> app to TestFlight for an external tester. The cloud build + the App Store Connect
> submission need **interactive Apple Developer auth**, so the final two steps are yours to
> run — everything up to them is configured and verified.

## What's already set up

- **EAS project:** `@swingsight/swingsight` (projectId `d19293ab-2782-47de-9934-d7f0f775d6b6`),
  wired into `app.json` → `extra.eas.projectId`, owner `swingsight`.
- **`eas.json`** with four profiles:
  - `development` — dev client, internal distribution (cloud dev-client builds for a device).
  - `development-simulator` — dev client for the iOS Simulator.
  - `preview` — internal distribution (ad-hoc `.ipa` for registered UDIDs; quick testing).
  - `production` — store distribution → the TestFlight build. `autoIncrement` bumps the
    build number; `appVersionSource: remote` means EAS owns the build number (initialised to 1).
- **`submit.production.ios`** pre-filled with `appleId` (owoodward21@gmail.com) and
  `appleTeamId` (`J2TZ34TYLC`). **`ascAppId` is a placeholder** — fill it after the app
  exists in App Store Connect (or let `eas submit` create the app the first time).
- **Export compliance:** `ios.infoPlist.ITSAppUsesNonExemptEncryption = false` (the app uses
  only standard HTTPS/TLS — exempt), so App Store Connect won't block the build on the
  manual encryption question.

A non-interactive `eas build -p ios --profile production` was run to validate all of the
above; it proceeds correctly through versioning + credential resolution and stops exactly at
*"Distribution Certificate is not validated for non-interactive builds — run in interactive
mode"*. That is the Apple-auth handoff below.

## KEY RISK — the Xcode-26 patch must apply in the cloud (verify it)

The Xcode-26/Swift-6.2 fix (PRD §7) lives in `app/patches/` and is applied by the
`postinstall: "patch-package"` hook. EAS installs with **`npm ci`** (because
`app/package-lock.json` exists), which **runs `postinstall`**, and `patch-package` is a
`devDependency` that EAS installs during the build — so the patches apply automatically.

**Verify it on the first build:** in the EAS build logs, the "Install dependencies" phase
must show `patch-package` applying **2 patches** (`expo-modules-core+56.0.17`,
`expo-modules-jsi+56.0.10`). If the native Swift compile fails with `'weak' must be a mutable
variable` or a `Sendable` stored-property error, postinstall did not run — that is the thing
to fix first (it is the exact failure §7 documents).

## No git repo yet

The repo isn't under version control, and EAS prefers git. Two options:

- **Quick:** prefix every EAS command with `EAS_NO_VCS=1` (archives the project dir,
  respecting `app/.gitignore` — `node_modules/` and `/ios` are excluded, which is correct:
  EAS runs a clean `expo prebuild` in the cloud). This is what the validation run used.
- **Cleaner (recommended):** `git init` at the repo root and commit, so EAS uploads exactly
  the tracked files. `app/.gitignore` + the root `.gitignore` already exclude
  `node_modules/`, `app/ios/`, `app/android/`, `setup.env`, and the vault SQL.

## The handoff steps (interactive — run these yourself)

From `app/` (drop `EAS_NO_VCS=1` if you've `git init`'d):

```bash
cd app

# 1. Production build. Prompts you to log in to Apple, then auto-generates the iOS
#    Distribution Certificate + provisioning profile and runs the cloud build.
EAS_NO_VCS=1 eas build --platform ios --profile production

# 2. First time only: create the app in App Store Connect if it doesn't exist
#    (eas submit can do it for you), then copy its numeric App ID into
#    eas.json → submit.production.ios.ascAppId.

# 3. Upload the finished build to TestFlight.
EAS_NO_VCS=1 eas submit --platform ios --profile production --latest

# 4. In App Store Connect → TestFlight: add an external test group, add the tester's
#    email, attach the build, and submit for Beta App Review (required for EXTERNAL
#    testers; internal testers on your team need no review). The tester installs from
#    the TestFlight app.
```

Tip: in this Claude Code session you can run an interactive command inline by typing it
with a leading `!` (e.g. `! cd app && eas build --platform ios --profile production`), so the
Apple-login prompt lands directly in the conversation.

### Quick ad-hoc testing without TestFlight (optional)

```bash
EAS_NO_VCS=1 eas build --platform ios --profile preview   # registers your device UDID, builds an ad-hoc .ipa
```

Installs directly on registered devices — faster than TestFlight for your own testing, but
not for arbitrary external testers (those need the TestFlight/store path above).

## Latency / progress UX (PRD §22, <30s target)

Server-side measurement is comfortably inside budget after on-device trim; **raw-upload time
dominates** perceived latency for the untrimmed sample. The app already does a **background
binary upload** and a staged progress screen ("uploading → finding your swing → measuring →
writing feedback"). The remaining upgrade is **resumable TUS/multipart** on the same R2 S3
endpoint (PRD §4 / spec §6.2) for flaky connections + large clips — layer it on when upload
reliability bites at scale; it is not a TestFlight blocker.
