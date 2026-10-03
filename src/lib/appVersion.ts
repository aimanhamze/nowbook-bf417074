// The build's identity, e.g. "2026-10-03 · 9b2bb4e" (UTC build date + short
// commit). Injected by vite.config.ts at build time. Shown, small and muted, in
// provider Settings so an owner can read it aloud: before an admin gives an
// owner a second branch, this proves their installed PWA runs current code
// rather than a stale cached build.
//
// Falls back to "dev" where the define is absent (Vitest's own config).
export const APP_VERSION: string = typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "dev";
