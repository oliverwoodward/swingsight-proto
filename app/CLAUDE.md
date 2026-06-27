# app/ — Expo SDK 56 dev-client (capture + report)

The iPhone app: onboarding → capture a swing (vision-camera) → upload → live processing
→ report with a Skia skeleton overlay → history/trends. Read the root
[`../CLAUDE.md`](../CLAUDE.md) and [`../PRD.md`](../PRD.md) first; this covers app-only
conventions.

> **Expo has changed.** Read the EXACT versioned docs at
> https://docs.expo.dev/versions/v56.0.0/ before writing any Expo code — API shapes
> differ between SDKs. (This is the whole content of `AGENTS.md`.)

## Stack

Expo SDK 56 **development build** (custom dev client, NOT Expo Go), React Native 0.85,
React 19, expo-router (file-based), TypeScript strict. Key native deps:
react-native-vision-camera **v5 (Nitro)**, @shopify/react-native-skia,
react-native-reanimated + worklets, expo-video, expo-secure-store, @supabase/supabase-js.

## Layout (`src/`, imported via the `@/*` path alias → `src/*`)

```
src/app/          expo-router routes. index.tsx = gate (onboarding vs Home);
                  (onboarding)/ group; capture.tsx; processing.tsx; report/[id].tsx;
                  history.tsx; privacy.tsx
src/domain/       THE shared contract (TS source of truth). See src/domain/CLAUDE.md.
src/components/   ui/ (Screen, Button, OptionCard) + capture/ + report/ + history/ +
                  onboarding/ + themed-text/view
src/contexts/     auth.tsx (Supabase anon session), profile.tsx (UserProfile),
                  onboarding-draft.tsx (in-flow selections)
src/services/     analysis.ts (insert→upload→queue→Realtime + report reads),
                  supabase.ts (client + chunked secure-store adapter),
                  profile-store.ts (ProfileStore iface; secure-store + Supabase impls),
                  media-library.ts (import an existing clip into the same pipeline),
                  privacy.ts (export/delete)
src/hooks/        use-analysis-runner, use-report, use-history, use-theme
src/constants/    theme.ts (Colors/Spacing/Fonts), brand.ts, capture.ts (fps/res/limits)
src/utils/        id.ts (crypto UUID v4), recheck-copy.ts, history.ts
```

## Conventions (follow the existing code)

- **No NativeWind / Tailwind.** Style with RN `StyleSheet` + the theme system
  (`@/constants/theme` `Colors`/`Spacing`/`Fonts`) + `@/constants/brand`. Don't add a
  styling framework.
- **Path alias `@/*` → `src/*`** (and `@/assets/*`). Resolved by Metro via tsconfig
  paths — there is **no `babel.config.js` / `metro.config.js`**; the stack runs on Expo
  SDK 56 defaults. Don't add them without a reason (re-verify reanimated/worklets if you do).
- **expo-file-system has two APIs.** Use the **class API** (`new File(uri).size` /
  `.exists`) for file metadata — `getInfoAsync` is deprecated. For the presigned
  *upload* use `expo-file-system/legacy` (`createUploadTask`, `BINARY_CONTENT`, PUT) —
  the new `File` class has no upload method. Both coexist on purpose.
- **The domain layer is pure + framework-free.** No React/Expo imports in `src/domain/`.
  The worker mirrors it in Python — see `src/domain/CLAUDE.md` before editing it.
- **Graceful degradation pre-provisioning:** if `EXPO_PUBLIC_SUPABASE_*` env vars are
  unset, auth/profile fall back to a device-local store + local UUID; the UI is identical.
  Don't hardcode Supabase as required.
- **The app reads the worker's results; it does not re-measure.** It reads
  `primary_fault_id`, `faults`, metrics, score, coordinates straight from the row. It
  must **never** compute or fabricate an analysis value (governing law + DB column guard).

## vision-camera v5 (Nitro) — the recording API differs from v4 (PRD §7 has the detail)

- **No Expo config plugin** for v5 — do NOT add `react-native-vision-camera` to
  `app.json` plugins (it crashes `expo config`). Camera/mic permissions live in
  `ios.infoPlist` + `android.permissions`.
- View: `<Camera device={useCameraDevice('back')} isActive constraints={[{fps:60}]}
  outputs={[videoOutput]} resizeMode="cover" />` — **fps is a `constraints` entry**, no
  `format` prop; resolution is the video output's `targetResolution`.
- Record: `useVideoOutput({ targetResolution: CommonResolutions.FHD_16_9, enableAudio })`
  → `createRecorder({ maxDuration })` → `startRecording(onFinished, onError)`. A
  `Recorder` records **once** (make a fresh one per take). `onFinished(filePath)` gives a
  **filesystem path, not a `file://` URL** — prefix `file://` for expo-video / `new File()`.

## Verify

```bash
cd app && npx tsc --noEmit -p tsconfig.json     # typecheck (strict)
cd app && npx expo lint                          # eslint (expo flat config)
cd app && node node_modules/expo/bin/cli config --json --full >/dev/null   # config sanity
```

- **TS 6 quirk:** typechecking files passed on the CLI needs `--ignoreConfig`; prefer
  `-p tsconfig.json`. `declarations.d.ts` shims `*.css` imports.
- **Don't run the device build** to verify — that's the user's interactive step
  (`npx expo run:ios --device`). JS changes hot-reload.

## Native build notes (rarely needed; full detail in PRD §7)

- `ios/` and `android/` are **gitignored prebuilt projects**. After any native config
  change (app.json plugins/permissions, a new native dep) re-run
  `npx expo prebuild -p ios --clean`.
- **Xcode 26 / Swift 6.2 incompatibilities are patched durably via patch-package**
  (`patches/expo-modules-{jsi,core}+*.patch`, applied by the `postinstall` hook on
  `npm install`). Don't hand-edit those modules in `node_modules` — edit the patch.
- Bundle id is `com.swingsight.proto` (the `.app` one was taken). EAS → TestFlight is in
  `eas.json` + `EAS_DEPLOY.md`; that build is the user's to run.
