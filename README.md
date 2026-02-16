# OpenClaw Desktop

AI desktop companion with animated avatar, powered by [OpenClaw](https://github.com/openclaw/openclaw).

![Electron](https://img.shields.io/badge/Electron-28-47848F?logo=electron) ![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178C6?logo=typescript) ![License](https://img.shields.io/badge/License-MIT-green)

## What is this?

A desktop pet / AI assistant that sits on your screen. It connects to an [OpenClaw](https://github.com/openclaw/openclaw) gateway running on your machine and gives your AI agent a face, voice, and personality.

**Features:**
- 🎨 **Animated sprite character** — breathing, blinking, expressions, lip sync
- 🗣️ **Text-to-Speech** — Edge TTS (free, default) or MiniMax Speech-02-HD
- 💬 **Chat** — text input with streaming responses
- 👗 **Wardrobe system** — AI-generated outfit changes via `__OUTFIT:描述__` tags
- 🖼️ **AI selfie generation** — fal.ai Flux integration
- 🔌 **WebSocket connection** — Ed25519 device identity auth, auto-reconnect
- 📦 **Mini mode** — collapse to floating orb
- 🎨 **Themes** — Dark, Light, Purple Night
- ⌨️ **Global hotkeys** — `Ctrl+Shift+M` toggle mini mode
- 🖥️ **Cross-platform** — macOS, Windows, Linux

## Prerequisites

### 1. Install OpenClaw (Backend)

This app is a **frontend** for OpenClaw. You need an OpenClaw gateway running locally.

```bash
# Install OpenClaw
npm install -g openclaw

# Set up your agent (follow the interactive setup)
openclaw init

# Start the gateway
openclaw gateway start
```

The gateway runs on `localhost:18789` by default. See [OpenClaw docs](https://docs.openclaw.ai) for full setup guide.

### 2. Pair this app as a device

OpenClaw Desktop connects as a **device** using Ed25519 key pairs (auto-generated on first launch). After launching the app, approve the device pairing in your OpenClaw gateway.

## Install & Run

```bash
# Clone
git clone https://github.com/kaikezhang/openclaw-desktop.git
cd openclaw-desktop

# Install dependencies
npm install

# Configure (optional — see Configuration below)
cp .env.example .env

# Build & run
npm run build
npm start
```

### Development mode

```bash
npm run dev
# Or with DevTools:
npm start -- --dev
```

## Configuration

Copy `.env.example` to `.env` and edit as needed:

```env
# OpenClaw Gateway (required)
OPENCLAW_PORT=18789          # Gateway port (default: 18789)
OPENCLAW_TOKEN=              # Optional: gateway auth token

# TTS - MiniMax (optional, Edge TTS is used by default for free)
MINIMAX_API_KEY=             # Get from https://www.minimaxi.com/
MINIMAX_GROUP_ID=            # Your MiniMax group ID
MINIMAX_MODEL=speech-02-hd
MINIMAX_VOICE_ID=Chinese (Mandarin)_Warm_Girl

# Image Generation (optional, for AI selfies/outfits)
FAL_KEY=                     # Get from https://fal.ai/dashboard/keys
```

**TTS note:** Edge TTS (free, no API key) is the default. MiniMax is used as fallback if configured. You don't need any API keys for basic voice.

## Architecture

```
┌─────────────────────────┐     WebSocket      ┌──────────────────┐
│   OpenClaw Desktop      │◄──────────────────►│  OpenClaw Gateway │
│   (Electron)            │    localhost:18789   │  (Node.js)       │
│                         │                      │                  │
│  ┌─────────────────┐    │                      │  ┌────────────┐  │
│  │ Sprite Engine    │    │   chat.send/events   │  │ AI Agent   │  │
│  │ (PNGTuber-style) │    │◄────────────────────►│  │ (Claude,   │  │
│  └─────────────────┘    │                      │  │  GPT, etc) │  │
│  ┌─────────────────┐    │                      │  └────────────┘  │
│  │ TTS Engine       │    │                      │  ┌────────────┐  │
│  │ (Edge/MiniMax)   │    │                      │  │ Channels   │  │
│  └─────────────────┘    │                      │  │ (Discord,  │  │
│  ┌─────────────────┐    │                      │  │  Telegram…)│  │
│  │ Image Gen        │    │                      │  └────────────┘  │
│  │ (fal.ai)         │    │                      └──────────────────┘
│  └─────────────────┘    │
└─────────────────────────┘
```

The desktop app is one of many possible frontends for OpenClaw. Your AI agent can simultaneously be connected to Discord, Telegram, and this desktop app.

## Custom Character

The default character sprites are in `assets/character/wanwan/layers/final/`. To use your own:

1. Create PNG sprites: `char-idle.png`, `char-blink.png`, `char-speaking.png`
2. Place them in `assets/character/yourchar/layers/final/`
3. Update the path in `src/renderer/app.js` → `loadLayers()`

## Outfit System

The AI can change outfits by including `__OUTFIT:description__` in its response. The app detects this tag, generates new sprites via fal.ai, and hot-swaps them. Outfits are saved to the wardrobe for reuse.

Requires `FAL_KEY` in `.env`.

## Building for Distribution

```bash
# macOS
npm run dist:mac

# Windows
npm run dist:win

# Linux
npm run dist:linux
```

## License

MIT
