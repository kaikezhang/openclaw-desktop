# OpenClaw Desktop

AI voice assistant with animated avatar, built on Electron + OpenClaw.

![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron) ![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript) ![License](https://img.shields.io/badge/License-MIT-green)

## Features

- **Three character modes** — Glass Orb 🫧 / Sprite portrait 🎨 / Live2D 🎭
- **Voice conversation** — Deepgram Nova-2 STT with VAD and keep-alive
- **Streaming TTS** — MiniMax Speech-02-HD with sentence splitting and queued playback
- **Glass Orb character** — 67px fluid glass ball with 15+ eye expressions, 7 mood colors, mouse tracking, idle micro-expressions, and particle effects
- **Wanwan sprite** — AI-generated character with breathing, blinking, and expression switching
- **Live2D avatar** — PixiJS + pixi-live2d-display (Cubism 2/3/4), Hiyori bundled as default
- **OpenClaw gateway** — WebSocket client with ed25519 device identity auth, tick keepalive, auto-reconnect
- **Connection status** — Offline/online detection with revival animation
- **AI selfie generation** — fal.ai Flux integration for character image generation
- **State machine** — `idle → listening → thinking → speaking → followup`
- **Mini-orb mode** — Collapse to floating orb, still accepts voice input
- **Theme system** — Dark, Light, Purple Night
- **System tray** — Show/hide, mini mode, settings, quit
- **Global hotkeys** — `Ctrl+Shift+O` toggle recording, `Ctrl+Shift+M` toggle mini
- **Settings panel** — Dark-themed UI for all configuration (character mode, theme, API keys)
- **Start with system** — Auto-launch on login
- **Cross-platform packaging** — electron-builder for macOS, Windows, Linux

## Character Modes

| Mode | Description |
|---|---|
| 🫧 **Glass Orb** | Fluid glass ball with expressive CSS eyes. 7 mood colors, natural blinking, mouse tracking, idle micro-expressions, click particles. Zero sprites — pure CSS/JS. |
| 🎨 **Sprite** | Wanwan portrait with CSS breathing animation, random blinking, head sway. Supports portrait + pixel GIF sub-modes. |
| 🎭 **Live2D** | Hiyori model (Cubism 4). Full body animation with motion mapping. |

Switch modes with the gamepad button in the UI or via Settings.

## Quick Setup (npx)

```bash
npx openclaw-desktop
```

Interactive wizard that checks OpenClaw, configures gateway + API keys, builds, and launches.

## Architecture

```
src/
├── main/                      # Electron main process (TypeScript)
│   ├── main.ts                # App entry, window, tray, hotkeys
│   ├── ipc-handlers.ts        # All IPC handlers (chat, STT, TTS, status, settings)
│   ├── openclaw-client.ts     # OpenClaw WebSocket gateway client
│   ├── tts-engine.ts          # MiniMax TTS with sentence queue
│   ├── stt-engine.ts          # Deepgram STT engine
│   ├── settings-store.ts      # JSON-based settings persistence
│   ├── device-identity.ts     # ed25519 device key + signing
│   └── image-gen.ts           # fal.ai selfie generation
├── renderer/                  # Frontend (vanilla HTML/CSS/JS)
│   ├── index.html             # Main window
│   ├── settings.html          # Settings panel
│   ├── styles.css
│   ├── app.js                 # UI state machine, character mode manager
│   ├── glass-orb.js           # Glass orb character (fluid ball + eyes)
│   ├── character-animator.js  # Sprite-based character animation
│   ├── live2d-manager.js      # Live2D model loading & animation
│   ├── audio-player.js        # Audio playback queue
│   ├── audio-processor.js     # AudioWorklet for mic capture
│   ├── orb.js                 # Aura/particle canvas effects
│   └── vendor/                # Bundled libs (PixiJS, Cubism4, Iconify)
├── preload/
│   └── preload.ts             # contextBridge API
└── assets/
    ├── character/wanwan/      # Wanwan sprite images (idle, speaking, blink)
    └── models/Hiyori/         # Live2D Hiyori model
```

## Quick Start

```bash
# Install dependencies
npm install

# Copy and fill in your API keys
cp .env.example .env

# Build TypeScript and start the app
npm start
```

## Development

```bash
# Watch mode (recompiles on change)
npm run dev:build

# In another terminal, start Electron with DevTools
npm run dev:electron

# Lint & format
npm run lint
npm run format
```

## Packaging

```bash
# Build for current platform
npm run dist

# Platform-specific
npm run dist:mac     # → release/*.dmg, *.zip
npm run dist:win     # → release/*.exe
npm run dist:linux   # → release/*.AppImage, *.deb
```

## Environment Variables

| Variable | Description |
|---|---|
| `OPENCLAW_PORT` | Gateway port (default: `18789`) |
| `OPENCLAW_TOKEN` | Auth token for the gateway |
| `FAL_KEY` | fal.ai API key (selfie generation) |
| `DEEPGRAM_API_KEY` | Deepgram API key (STT) |
| `MINIMAX_API_KEY` | MiniMax API key (TTS) |
| `MINIMAX_GROUP_ID` | MiniMax Group ID |
| `MINIMAX_MODEL` | TTS model (default: `speech-02-hd`) |
| `MINIMAX_VOICE_ID` | Voice ID (default: `Lovely_Girl`) |

Settings can also be configured via the in-app settings panel (persisted in userData).

## Device Identity

The app auto-detects your OpenClaw device identity from `~/.openclaw/identity/device.json`. No manual configuration needed — if OpenClaw is installed and configured, authentication is automatic.

If no system identity is found, the app generates its own ed25519 keypair (stored in Electron userData).

## Global Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+O` / `Cmd+Shift+O` | Toggle recording |
| `Ctrl+Shift+M` / `Cmd+Shift+M` | Toggle mini mode |

## Licenses

- App: MIT
- Hiyori model: [Live2D Free Material License](https://www.live2d.com/eula/live2d-sample-model-terms_en.html)
