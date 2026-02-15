# AGENTS.md — Outfit Change Feature

## Task

Implement the **outfit change** feature for openclaw-desktop. This is a PNGTuber-style Electron app where an anime character (wanwan) displays on screen with idle/blink/speaking sprites.

## What to Build

### 1. Sprite Generation Script (`scripts/generate-outfit.py`)

A Python script that generates a complete outfit sprite set (idle, blink, speaking) from a text description.

**Workflow (each step is critical — based on real battle-tested experience):**

1. **Generate idle** — Use Gemini Image Edit API to change the outfit on the reference idle image
   - Input: `assets/character/wanwan/layers/final/char-idle.png` (553x400, RGBA with transparent background)
   - API: Gemini via the generate_image.py helper at `/usr/lib/node_modules/openclaw/skills/nano-banana-pro/scripts/generate_image.py`
   - Prompt template: "Change this character's outfit to [DESCRIPTION]. Keep the EXACT same character, face, hair, pose, position, composition, background. Only change the clothing."

2. **Normalize idle** — Critical post-processing:
   - Detect character bounding box (non-white, non-transparent pixels)
   - Scale + position to match reference idle's bounding box (center-align horizontal, bottom-align vertical)
   - Resize to exactly 553x400
   - Apply reference idle's alpha channel (transparent background)

3. **Generate blink** — Gemini edit on the NEW idle:
   - Prompt: "Close the eyes gently as if blinking. Keep EVERYTHING else exactly the same."
   
4. **Normalize blink** — Same as step 2, plus:
   - Copy idle's alpha channel onto blink (CRITICAL — prevents white background flicker)
   - Verify bounding box alignment with idle (tolerance: 5%)

5. **Generate speaking** — Gemini edit on the NEW idle:
   - Prompt: "Open the mouth slightly as if speaking. Keep EVERYTHING else exactly the same."

6. **Normalize speaking** — Same as step 4

7. **Save to wardrobe** — Output to `assets/character/wanwan/outfits/<outfit-name>/`
   - `char-idle.png`, `char-blink.png`, `char-speaking.png`
   - `metadata.json` with name, prompt, timestamp

**Quality gates:**
- Auto-retry each generation step up to 3 times if bbox alignment is off by >10%
- All 3 sprites must have identical alpha channels (copied from idle)

### 2. Wardrobe Manager (TypeScript, `src/main/wardrobe.ts`)

Server-side outfit management:
- `listOutfits()` — scan outfits directory, return available outfits
- `getOutfit(name)` — load sprites as base64
- `getCurrentOutfit()` / `setCurrentOutfit(name)` — track active outfit
- `saveOutfit(name, sprites, metadata)` — save new outfit

### 3. WebSocket Protocol Extension (`src/main/openclaw-client.ts`)

Add `outfit_change` message type:
- Server sends: `{ type: "outfit_change", status: "loading"|"ready"|"error", outfit: "name", sprites: { idle, blink, speaking } }`
- Desktop app listens and triggers sprite swap

### 4. Desktop Sprite Hot-Swap (`src/renderer/layered-sprite-engine.js`)

New method `swapOutfit(sprites)`:
- Receives base64 sprites object
- Creates new Image objects, waits for `.decode()` to complete
- Swaps all sprite img sources atomically
- Transition: ✨ particle burst effect during swap

### 5. Speaking Mouth Animation (CSS)

Enhance speaking state:
- Clip the lower face area of speaking sprite
- Apply `scaleY` pulsation (1.0 to 1.15) synced to TTS volume
- Use the existing `speakBounce` spring value

## Key Files

- `assets/character/wanwan/layers/final/` — reference sprites (DO NOT MODIFY)
- `assets/character/wanwan/outfits/` — wardrobe directory (create if missing)
- `src/main/openclaw-client.ts` — WebSocket client
- `src/renderer/layered-sprite-engine.js` — sprite rendering engine
- `src/renderer/app.js` — main renderer logic
- `docs/plans/2025-02-15-outfit-change-design.md` — full design doc

## Environment

- Gemini API available via: `uv run /usr/lib/node_modules/openclaw/skills/nano-banana-pro/scripts/generate_image.py`
- GEMINI_API_KEY is set in environment
- Python 3 + PIL/numpy available
- Node.js + TypeScript project, build with `npm run build`

## Implementation Order

Start with scripts/generate-outfit.py — this is the hardest part and needs to work before anything else.
Then wardrobe.ts → WebSocket protocol → sprite hot-swap → mouth animation.
