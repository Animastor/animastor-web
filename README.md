<p align="center">
  <img src="frontends/app/public/logo.png" alt="Animastor" width="128" />
</p>

<h1 align="center">Animastor Web</h1>

<p align="center">
  <strong>Responsive web client for the Animastor platform</strong><br/>
  Read and edit multimedia books, chat with the AI assistant, and manage generation — in the browser.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/Preact-10-673AB8?logo=preact&logoColor=white" alt="Preact" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white" alt="Vite" />
</p>

---

## About

This repository is the **web frontend** of Animastor — a responsive app (Preact + Vite)
with mobile and desktop shells, the book editor/player, the AI chat, and the client-side
generation UI. It talks to the backend API and (through it) to the GPU worker pool.

## Repository layout

```
animastor-web/
├── frontends/
│   ├── app/           # Responsive web app (Preact + Vite) — @animastor/app
│   └── website/       # Public marketing website (animastor.org)
├── packages/          # 13 npm packages (@animastor/web-*)
├── ANDROID_WEB_PARITY.md
└── app-web-rebuild.sh
```

`tools/` (desktop/mobile WebView test harnesses) and `docs/` have moved to their
own repositories — see below.

## Related repositories

Animastor is split into separate repositories:

- [animastor-backend](https://github.com/Animastor/animastor-backend) — API server + orchestration
- [animastor-android](https://github.com/Animastor/animastor-android) — native Android client
- [animastor-gpu-hub](https://github.com/Animastor/animastor-gpu-hub) — GPU task dispatcher
- [animastor-worker](https://github.com/Animastor/animastor-worker) — GPU workers (ComfyUI)
- [animastor-docs](https://github.com/Animastor/animastor-docs) — project documentation (was `docs/` here)
- [animastor-tools](https://github.com/Animastor/animastor-tools) — desktop/mobile web testers (was `tools/` here)

## Quick start

```bash
cd frontends/app
npm ci
npm run dev        # dev server (Vite)
```

Build and test:

```bash
npm run build:packages   # build the @animastor/web-* packages
npm run build            # production build
npm test                 # vitest
npm run typecheck        # tsc --noEmit
```

## Documentation

Documentation now lives in [animastor-docs](https://github.com/Animastor/animastor-docs)
(was `docs/` in this repository; production portal: `https://animastor.org/docs/`).

## License

This project is licensed under the [MIT License](LICENSE).
