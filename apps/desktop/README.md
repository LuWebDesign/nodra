# Kond Design desktop

This package is the Tauri desktop shell for the existing Kond Design editor. It reuses the React composition from `apps/web` and keeps the editor packages independent of Tauri.

## Prerequisites

- Node.js >= 24
- pnpm 10.15.1 (use `corepack pnpm` when needed)
- Rust stable and the Windows WebView2/build tools for Tauri

## Development

From the repository root:

```bash
corepack pnpm install
corepack pnpm desktop:dev
```

## Build the Windows installer

```bash
corepack pnpm desktop:build
```

The NSIS installer is generated under `apps/desktop/src-tauri/target/release/bundle/nsis/`.

The current scaffold intentionally reuses browser persistence. Native file open/save will be added behind a storage adapter before production distribution.
