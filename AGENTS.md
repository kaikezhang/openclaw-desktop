# OpenClaw Desktop Assistant - Rebuild Task

## Goal
Rebuild this Electron desktop assistant from scratch with modern architecture. Reference files from the old MVP are in the root (app.js, index.html, styles.css, electron/, orb.js, audio-processor.js).

## What to Build

### Architecture
```
openclaw-desktop/
├── src/
│   ├── main/                 # Electron main process
│   │   ├── main.ts           # App entry, window management
│   │   ├── ipc-handlers.ts   # All IPC handlers
│   │   ├── openclaw-client.ts # OpenClaw WebSocket client
│   │   ├── tts-engine.ts     # MiniMax TTS with sentence queue
│   │   └── stt-engine.ts     # Deepgram STT
│   ├── renderer/             # Frontend (vanilla HTML/CSS/JS for now)
│   │   ├── index.html
│   │   ├── styles.css
│   │   ├── app.js
│   │   ├── live2d-manager.js # Live2D Cubism integration
│   │   ├── audio-player.js   # Audio playback queue
│   │   └── orb.js            # Aura/particle effects
│   └── preload/
│       └── preload.ts
├── assets/
│   └── models/               # Live2D model files go here
├── package.json
├── tsconfig.json
├── .env.example
├── .gitignore
└── README.md
```

### Key Requirements

1. **TypeScript for main process** - Better type safety
2. **OpenClaw WebSocket Client** - Connect to OpenClaw gateway (port from env), authenticate, send/receive chat messages with streaming support
3. **Live2D Ready** - Set up pixi-live2d-display integration (CDN or npm). Create a Live2D manager that can:
   - Load .model3.json files
   - Switch between idle/speaking/listening/thinking animations
   - Lip sync based on audio amplitude
4. **TTS Engine** - MiniMax Speech-02-HD with sentence splitting and queued playback
5. **STT Engine** - Deepgram Nova-2 with VAD, keep-alive connection
6. **Modern UI** - Frameless transparent window, drag support, mini-orb mode, text input + voice input
7. **State Machine** - Clear states: idle → listening → thinking → speaking → idle

### Live2D Integration Notes
- Use `pixi-live2d-display` npm package (works with Cubism 2/3/4)
- Renderer needs PixiJS + pixi-live2d-display
- Placeholder: if no model loaded, show the video-based character (lobster) from old MVP
- Model files not included - user will add their own .model3.json

### What to Keep from Old MVP
- The OpenClaw WebSocket protocol (connect challenge → auth → chat.send/chat events)
- MiniMax TTS hex→audio conversion logic
- Deepgram STT configuration (nova-2, zh-CN, VAD, keep-alive)
- Sentence splitting for streaming TTS
- Mini-orb mode concept
- Aura/particle canvas effects (orb.js)

### What to Improve
- Proper TypeScript main process (compile with tsc)
- Clean IPC channel naming conventions
- Proper error handling and reconnection logic
- Modular file structure (not everything in one giant main.js)
- README with setup instructions

### Build Setup
- Use `tsc` to compile TypeScript → dist/
- Electron loads from dist/
- npm scripts: `build` (tsc), `start` (build + electron), `dev` (watch mode)

## Important
- Keep the `.env.example` with all needed env vars
- Don't include any API keys
- Make sure .gitignore covers node_modules, dist, .env, *.mp4
- Write a good README.md explaining the project, setup, and how to add Live2D models
