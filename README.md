# OpenClaw Desktop

AI voice assistant with Live2D avatar support, built on Electron.

## Features

- **Voice conversation** — Deepgram Nova-2 STT with VAD and keep-alive connection
- **Streaming TTS** — MiniMax Speech-02-HD with sentence splitting and queued playback
- **Live2D avatar** — PixiJS + pixi-live2d-display for Cubism 2/3/4 models
- **OpenClaw gateway** — WebSocket client with streaming chat responses
- **State machine** — `idle → listening → thinking → speaking → followup` cycle
- **Mini-orb mode** — Collapse to a floating orb that still accepts voice input
- **Aura effects** — Canvas particle/ripple animations synced to state
- **Frameless window** — Transparent, always-on-top, draggable

## Architecture

```
src/
├── main/                    # Electron main process (TypeScript)
│   ├── main.ts              # App entry, window management
│   ├── ipc-handlers.ts      # All IPC handlers
│   ├── openclaw-client.ts   # OpenClaw WebSocket gateway client
│   ├── tts-engine.ts        # MiniMax TTS with sentence queue
│   └── stt-engine.ts        # Deepgram STT engine
├── renderer/                # Frontend (vanilla HTML/CSS/JS)
│   ├── index.html
│   ├── styles.css
│   ├── app.js               # UI state machine & logic
│   ├── live2d-manager.js    # Live2D model loading & animation
│   ├── audio-player.js      # Audio playback queue
│   ├── audio-processor.js   # AudioWorklet for mic capture
│   └── orb.js               # Aura/particle canvas effects
└── preload/
    └── preload.ts           # contextBridge API
```

TypeScript files in `src/main/` and `src/preload/` compile to `dist/`.
Renderer files are served directly from `src/renderer/`.

## Prerequisites

- Node.js 18+
- An [OpenClaw](https://github.com/anthropics/openclaw) gateway running locally
- A [Deepgram](https://console.deepgram.com/) API key (for STT)
- A [MiniMax](https://www.minimaxi.com/) API key + Group ID (for TTS)

## Setup

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
```

## Scripts

| Command | Description |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Build + launch Electron |
| `npm run dev` | Watch + launch (parallel) |
| `npm run dev:build` | TypeScript watch mode only |
| `npm run dev:electron` | Launch Electron with `--dev` flag |
| `npm run clean` | Remove `dist/` |

## Environment Variables

| Variable | Description |
|---|---|
| `OPENCLAW_PORT` | OpenClaw gateway port (default: `18789`) |
| `OPENCLAW_TOKEN` | Auth token for the gateway |
| `DEEPGRAM_API_KEY` | Deepgram API key for speech-to-text |
| `MINIMAX_API_KEY` | MiniMax API key for text-to-speech |
| `MINIMAX_GROUP_ID` | MiniMax Group ID |
| `MINIMAX_MODEL` | TTS model name (default: `speech-02-hd`) |
| `MINIMAX_VOICE_ID` | Voice ID (default: `Lovely_Girl`) |

## Adding a Live2D Model

1. Place your model files in `assets/models/your-model/`
   - Typically includes: `.model3.json`, `.moc3`, textures, motions
2. In `src/renderer/app.js`, uncomment and update the `loadModel` line:
   ```js
   live2dManager.loadModel('../../assets/models/your-model/your-model.model3.json');
   ```
3. Restart the app

### Motion groups

The Live2D manager maps app states to motion group names:

| State | Motion Group |
|---|---|
| idle | `Idle` |
| listening | `Listening` |
| thinking | `Thinking` |
| speaking | `Speaking` |

If your model uses different motion group names, update `live2d-manager.js`'s `motionMap`.

When no Live2D model is loaded, the app shows the aura orb animation as a fallback.

## OpenClaw WebSocket Protocol

The client follows this flow:

1. **Connect** to `ws://localhost:{port}`
2. Receive `connect.challenge` event
3. Send `connect` request with auth token
4. Send `chat.send` requests with `sessionKey` and `idempotencyKey`
5. Receive streamed `chat` events with `{ text }` payloads
6. Stream ends with `{ state: 'final' }` or `{ done: true }`

## License

MIT
