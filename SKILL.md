---
name: desktop-pet
description: "Give OpenClaw a body — an AI desktop companion with animated sprite avatar, voice (TTS), AI outfit generation, and chat. Electron-based, cross-platform."
homepage: https://github.com/kaikezhang/openclaw-desktop
metadata: {"openclaw":{"emoji":"🐱","requires":{"bins":["node","npm"],"env":[]}}}
---

# 🐱 OpenClaw Desktop — Give Your Agent a Body

A desktop AI companion that connects to your OpenClaw gateway and gives your agent a face, voice, and personality.

## What is it?

An Electron app that sits on your desktop as a PNGTuber-style animated character. It connects to your OpenClaw gateway via WebSocket — your agent can talk, emote, change outfits, and take AI selfies.

## Features

- 🎨 **Animated sprite character** — breathing, blinking, expressions, lip sync
- 🗣️ **Text-to-Speech** — Edge TTS (free, default) or MiniMax Speech-02-HD
- 💬 **Chat** — text input with streaming responses
- 👗 **Wardrobe system** — AI-generated outfit changes
- 🖼️ **AI selfie generation** — fal.ai Flux integration
- 📦 **Mini mode** — collapse to floating orb
- 🎨 **Themes** — Dark, Light, Purple Night
- 🖥️ **Cross-platform** — macOS, Windows, Linux

## Prerequisites

1. **OpenClaw gateway running** (`openclaw gateway start`)
2. **Node.js + npm**

## Quick Start

```bash
git clone https://github.com/kaikezhang/openclaw-desktop.git
cd openclaw-desktop
npm install
cp .env.example .env   # Edit with your keys
npm run build && npm start
```

On first launch, approve the device pairing in your OpenClaw gateway.

## Configuration (.env)

```env
# Required — OpenClaw gateway
OPENCLAW_PORT=18789

# Optional — MiniMax TTS (Edge TTS is free default)
MINIMAX_API_KEY=your-key
MINIMAX_VOICE_ID=Chinese (Mandarin)_Warm_Girl

# Optional — AI image generation (for outfits/selfies)
FAL_KEY=your-fal-ai-key
```

## Outfit Generation (AI Selfies & Wardrobe)

The agent can change the character's outfit by including a special tag in its response.

### Protocol

When the user asks for an outfit change, include this tag in your reply:

```
__OUTFIT:短描述__
```

Examples:
- `好的主人～换上了！__OUTFIT:红色旗袍__`
- `New look! __OUTFIT:cyberpunk hoodie__`

The APP detects the tag (hidden from display), calls fal.ai to generate new sprites, and hot-swaps them. Outfits are saved to the wardrobe for reuse.

### When to use

- ✅ User explicitly asks to change clothes/outfit
- ❌ Regular selfies, photos, or non-clothing requests

### How it works (under the hood)

1. Agent reply contains `__OUTFIT:description__`
2. APP extracts the description, strips the tag from display
3. APP calls fal.ai Flux to generate character sprites matching the description
4. New sprites are hot-swapped into the character layer
5. Outfit saved to wardrobe for future reuse

### Cost

~$0.04 per outfit change with fal.ai Flux Dev.

## Custom Character

Default sprites: `assets/character/wanwan/layers/final/`

To use your own:
1. Create PNGs: `char-idle.png`, `char-blink.png`, `char-speaking.png`
2. Place in `assets/character/yourchar/layers/final/`
3. Update path in `src/renderer/app.js` → `loadLayers()`

## Architecture

```
OpenClaw Desktop (Electron)  ◄─── WebSocket ───►  OpenClaw Gateway
├── Sprite Engine (PNGTuber)                       ├── AI Agent
├── TTS (Edge / MiniMax)                           ├── Channels
└── Image Gen (fal.ai)                             └── (Discord, Telegram…)
```

The desktop app is one of many frontends for OpenClaw. Your agent can simultaneously be on Discord, Telegram, and this desktop app.

## Links

- 🔗 GitHub: https://github.com/kaikezhang/openclaw-desktop
- 📖 [OpenClaw docs](https://docs.openclaw.ai)
- 📄 MIT License
