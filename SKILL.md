---
name: desktop-pet
description: "Give OpenClaw a body — a tiny fluid glass ball desktop pet with voice cloning, 15+ eye expressions, desktop lyrics overlay, and 7 mood colors. Electron-based, pure CSS/JS animation."
homepage: https://github.com/kk43994/claw-desktop-pet
metadata: {"clawdbot":{"emoji":"🦞","requires":{"bins":["node","npm"],"env":[]}}}
---

# 🦞 Claw Desktop Pet — Give OpenClaw a Body

A desktop AI companion that gives your OpenClaw agent a physical presence on your desktop.

## What is it?

A 67px fluid glass ball that lives on your desktop — it breathes, blinks, speaks, and reacts. Messages appear like floating desktop lyrics with white glow text. Your agent isn't invisible anymore.

## Features

- 🫧 **Fluid Glass Ball** — 67px sphere with 7 mood color systems
- 👀 **15+ Eye Expressions** — blink, curious, sleepy, surprised, follow mouse
- 🎵 **Desktop Lyrics** — typewriter text, white glow, mouse pass-through
- 🎤 **Voice Cloning** — MiniMax Speech with 7 emotions, auto detection
- 🎨 **Dual Window Architecture** — sprite + lyrics, fully transparent
- ⚫ **Offline/Online Animation** — gray sleep → colorful revival with particles
- 💬 **Feishu/Lark Sync** — bidirectional message sync
- 🛡️ **Enterprise Stability** — auto-restart, error handling, performance monitoring

## Quick Start

```bash
# Clone the project
git clone https://github.com/kk43994/claw-desktop-pet.git
cd claw-desktop-pet

# Install dependencies
npm install

# Start (basic mode)
npm start

# Full AI mode — requires OpenClaw gateway running
openclaw gateway start
npm start
```

## Voice Setup (Optional)

### MiniMax Speech (Recommended — voice cloning + emotions)
Set your MiniMax API key in `pet-config.json`:
```json
{
  "minimax": {
    "apiKey": "your-api-key",
    "voiceId": "your-cloned-voice-id"
  }
}
```

### Fallback: Edge TTS (Free, no setup)
Works out of the box — uses Microsoft Edge TTS as fallback.

## Architecture

```
┌── Sprite Window (200×220) ──┐  ┌── Lyrics Window (400×100) ──┐
│  67px fluid glass ball       │  │  Desktop lyrics overlay      │
│  15+ eye expressions         │  │  Typewriter + white glow     │
│  SVG icon toolbar            │  │  Mouse pass-through          │
│  7 mood color systems        │  │  Auto-fade after voice done  │
└──────────────────────────────┘  └──────────────────────────────┘
```

## Tech Stack

- **Electron** — Desktop framework (dual transparent windows)
- **OpenClaw** — AI dialogue engine
- **MiniMax Speech** — Voice cloning + emotion TTS
- **Pure CSS/JS** — All animations, no sprite sheets

## Design Philosophy

- **Air-feel UI** — Like desktop lyrics, doesn't interfere with work
- **iOS minimalism** — Simple, elegant, icon-only buttons
- **Lobster identity** — Expressed through red-orange fluid color, not literal appendages
- **References** — Nomi robot, AIBI robot, Bunny Hole

## Outfit Generation (AI Selfies)

The pet can display AI-generated character images — "outfit changes" triggered by conversation.

### How It Works

1. **User asks for outfit change** → Agent includes `__OUTFIT:description__` tag in reply
2. **APP detects the tag** → Strips it from display, triggers image generation
3. **Agent calls image API** → Generates character image matching the description
4. **Image delivered to APP** → Displayed as the pet's current look

### Setup

Set your image generation API key as an environment variable:

```bash
# fal.ai (recommended — fast, cheap, good quality)
export FAL_KEY="your-fal-ai-key"
```

Get a key at https://fal.ai/dashboard

### Generation Workflow

When the `__OUTFIT:描述__` tag is detected, generate an image like this:

```bash
curl -s -X POST "https://queue.fal.run/fal-ai/flux/dev" \
  -H "Authorization: Key $FAL_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "anime style, single character, [your character description], wearing [outfit description], clean background, full body shot, high quality",
    "image_size": "portrait_4_3",
    "num_images": 1
  }'
```

The response contains `images[0].url` — download it and send to the APP or post to your channel.

### Outfit Tag Protocol

- **Tag format**: `__OUTFIT:短描述__` (e.g. `__OUTFIT:红色旗袍__`, `__OUTFIT:cyberpunk hoodie__`)
- **When to use**: Only when the user explicitly asks for outfit/clothing change
- **When NOT to use**: Regular selfies, photos, or non-clothing requests
- **Description**: Keep it short and specific — clothing item or style, not a full sentence

### Character Consistency

Maintain a base character prompt in your memory (hair color, eye color, style) so every generation looks like the same character. Only the outfit portion changes.

### Cost

~$0.04 per image with fal.ai Flux Dev. Budget ~$1-2/month for casual use.

## Links

- 🔗 GitHub: https://github.com/kk43994/claw-desktop-pet
- 📖 Full documentation in README
- 📄 MIT License

---

Made with ❤️ and 🦞 by zhouk (kk43994)
