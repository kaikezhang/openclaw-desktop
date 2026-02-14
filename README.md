# OpenClaw Desktop

AI voice assistant with Live2D avatar, built on Electron + OpenClaw.

![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron) ![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript) ![License](https://img.shields.io/badge/License-MIT-green)

## Features

- **Voice conversation** — Deepgram Nova-2 STT with VAD and keep-alive
- **Streaming TTS** — MiniMax Speech-02-HD with sentence splitting and queued playback
- **Live2D avatar** — PixiJS + pixi-live2d-display (Cubism 2/3/4), Hiyori bundled as default
- **OpenClaw gateway** — WebSocket client with ed25519 device identity auth, tick keepalive, auto-reconnect
- **AI selfie generation** — fal.ai Flux integration for character image generation
- **State machine** — `idle → listening → thinking → speaking → followup`
- **Mini-orb mode** — Collapse to floating orb, still accepts voice input
- **System tray** — Show/hide, mini mode, quit
- **Global hotkeys** — `Ctrl+Shift+O` toggle recording, `Ctrl+Shift+M` toggle mini
- **Settings panel** — Dark-themed UI for all configuration
- **Cross-platform packaging** — electron-builder for macOS, Windows, Linux

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
│   ├── ipc-handlers.ts        # All IPC handlers (chat, STT, TTS, settings)
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
│   ├── app.js                 # UI state machine & logic
│   ├── live2d-manager.js      # Live2D model loading & animation
│   ├── audio-player.js        # Audio playback queue
│   ├── audio-processor.js     # AudioWorklet for mic capture
│   └── orb.js                 # Aura/particle canvas effects
└── preload/
    └── preload.ts             # contextBridge API
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

## Live2D Model

**Hiyori** (by Live2D Inc.) is bundled as the default character.

To use a custom model:
1. Place model files in `assets/models/your-model/`
2. Update the model path in Settings or `src/renderer/app.js`

### Motion Mapping

| App State | Motion Group |
|---|---|
| idle | `Idle` |
| listening | `TapBody` |
| thinking | `Idle` |
| speaking | `TapBody` |

## Global Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+O` / `Cmd+Shift+O` | Toggle recording |
| `Ctrl+Shift+M` / `Cmd+Shift+M` | Toggle mini mode |

## Licenses

- App: MIT
- Hiyori model: [Live2D Free Material License](https://www.live2d.com/eula/live2d-sample-model-terms_en.html)
