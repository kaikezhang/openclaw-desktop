#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "google-genai>=1.0.0",
#     "pillow>=10.0.0",
#     "numpy>=1.24.0",
# ]
# ///
"""
Generate a complete outfit sprite set (idle, blink, speaking) from a text description.

Usage:
    uv run scripts/generate-outfit.py --outfit "red dress" [--name red-dress]

Workflow:
    1. Generate idle — Gemini edit on reference idle image
    2. Normalize idle — match reference bbox, apply alpha channel
    3. Generate blink — Gemini edit on new idle
    4. Normalize blink — match idle bbox + copy idle alpha
    5. Generate speaking — Gemini edit on new idle
    6. Normalize speaking — same as blink
    7. Save to wardrobe — assets/character/wanwan/outfits/<name>/
"""

import argparse
import json
import os
import sys
import time
from io import BytesIO
from pathlib import Path

# ── Paths ──────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
REF_DIR = PROJECT_ROOT / "assets" / "character" / "wanwan" / "layers" / "final"
OUTFITS_DIR = PROJECT_ROOT / "assets" / "character" / "wanwan" / "outfits"

REF_IDLE = REF_DIR / "char-idle.png"
SPRITE_SIZE = (553, 400)  # width x height

MAX_RETRIES = 3
BBOX_TOLERANCE = 0.10  # 10% tolerance for bbox alignment


# ── Helpers ────────────────────────────────────────────────────────────

def get_bbox(img):
    """Get bounding box of non-transparent pixels (x, y, x2, y2)."""
    import numpy as np
    arr = np.array(img)
    if arr.shape[2] == 4:
        # Use alpha channel
        mask = arr[:, :, 3] > 10
    else:
        # Use non-white pixels
        mask = ~((arr[:, :, 0] > 240) & (arr[:, :, 1] > 240) & (arr[:, :, 2] > 240))

    rows = mask.any(axis=1)
    cols = mask.any(axis=0)

    if not rows.any() or not cols.any():
        return (0, 0, img.width, img.height)

    y_min, y_max = int(rows.argmax()), int(img.height - rows[::-1].argmax())
    x_min, x_max = int(cols.argmax()), int(img.width - cols[::-1].argmax())

    return (x_min, y_min, x_max, y_max)


def get_ref_bbox():
    """Get the reference idle sprite's bounding box."""
    from PIL import Image
    ref = Image.open(REF_IDLE).convert("RGBA")
    return get_bbox(ref), ref


def normalize_sprite(img, ref_bbox, ref_img):
    """
    Normalize a generated sprite to match the reference:
    - Detect character bbox
    - Scale & position to match reference bbox (center-align H, bottom-align V)
    - Resize to SPRITE_SIZE
    - Apply reference alpha channel
    """
    from PIL import Image
    import numpy as np

    img = img.convert("RGBA")

    # 1. Detect generated sprite bbox
    gen_bbox = get_bbox(img)
    gen_w = gen_bbox[2] - gen_bbox[0]
    gen_h = gen_bbox[3] - gen_bbox[1]

    if gen_w <= 0 or gen_h <= 0:
        print("  [WARN] Empty bounding box in generated sprite, using as-is")
        img = img.resize(SPRITE_SIZE, Image.LANCZOS)
        return apply_ref_alpha(img, ref_img)

    # 2. Crop to character content
    cropped = img.crop(gen_bbox)

    # 3. Scale to match reference bbox dimensions
    ref_w = ref_bbox[2] - ref_bbox[0]
    ref_h = ref_bbox[3] - ref_bbox[1]

    scale = min(ref_w / gen_w, ref_h / gen_h)
    new_w = int(gen_w * scale)
    new_h = int(gen_h * scale)
    scaled = cropped.resize((new_w, new_h), Image.LANCZOS)

    # 4. Create output canvas and paste (center-align H, bottom-align V)
    out = Image.new("RGBA", SPRITE_SIZE, (0, 0, 0, 0))

    # Center horizontally relative to reference center
    ref_center_x = (ref_bbox[0] + ref_bbox[2]) // 2
    paste_x = ref_center_x - new_w // 2

    # Bottom-align vertically to reference bottom
    paste_y = ref_bbox[3] - new_h

    out.paste(scaled, (paste_x, paste_y))

    # 5. Apply reference alpha channel
    return apply_ref_alpha(out, ref_img)


def apply_ref_alpha(img, ref_img):
    """Copy the reference image's alpha channel onto img."""
    from PIL import Image

    img = img.convert("RGBA")
    ref = ref_img.convert("RGBA")

    # Extract channels
    r, g, b, _ = img.split()
    _, _, _, ref_a = ref.split()

    # Merge with reference alpha
    return Image.merge("RGBA", (r, g, b, ref_a))


def check_bbox_alignment(img, ref_bbox):
    """Check if the sprite's bbox is reasonably aligned with reference."""
    gen_bbox = get_bbox(img)
    ref_w = ref_bbox[2] - ref_bbox[0]
    ref_h = ref_bbox[3] - ref_bbox[1]

    gen_w = gen_bbox[2] - gen_bbox[0]
    gen_h = gen_bbox[3] - gen_bbox[1]

    if ref_w == 0 or ref_h == 0:
        return True

    w_diff = abs(gen_w - ref_w) / ref_w
    h_diff = abs(gen_h - ref_h) / ref_h

    # Check center alignment
    ref_cx = (ref_bbox[0] + ref_bbox[2]) / 2
    gen_cx = (gen_bbox[0] + gen_bbox[2]) / 2
    cx_diff = abs(gen_cx - ref_cx) / ref_w

    aligned = w_diff < BBOX_TOLERANCE and h_diff < BBOX_TOLERANCE and cx_diff < BBOX_TOLERANCE
    if not aligned:
        print(f"  [BBOX] w_diff={w_diff:.2%}, h_diff={h_diff:.2%}, cx_diff={cx_diff:.2%}")
    return aligned


def gemini_edit(client, input_img, prompt):
    """
    Call Gemini Image Edit API. Returns a PIL Image (RGBA).
    input_img must be a PIL Image.
    """
    from google.genai import types
    from PIL import Image

    # Gemini needs RGB input (converts RGBA to RGB with white background)
    if input_img.mode == "RGBA":
        rgb = Image.new("RGB", input_img.size, (255, 255, 255))
        rgb.paste(input_img, mask=input_img.split()[3])
        send_img = rgb
    else:
        send_img = input_img.convert("RGB")

    response = client.models.generate_content(
        model="gemini-3-pro-image-preview",
        contents=[send_img, prompt],
        config=types.GenerateContentConfig(
            response_modalities=["TEXT", "IMAGE"],
            image_config=types.ImageConfig(image_size="1K"),
        ),
    )

    for part in response.parts:
        if part.text is not None:
            print(f"  [Gemini] {part.text}")
        elif part.inline_data is not None:
            import base64

            image_data = part.inline_data.data
            if isinstance(image_data, str):
                image_data = base64.b64decode(image_data)
            return Image.open(BytesIO(image_data)).convert("RGBA")

    return None


def generate_with_retry(client, input_img, prompt, ref_bbox, ref_img, label):
    """Generate a sprite with auto-retry if bbox alignment is off."""
    for attempt in range(1, MAX_RETRIES + 1):
        print(f"  [{label}] Attempt {attempt}/{MAX_RETRIES}...")
        result = gemini_edit(client, input_img, prompt)
        if result is None:
            print(f"  [{label}] No image returned, retrying...")
            time.sleep(2)
            continue

        normalized = normalize_sprite(result, ref_bbox, ref_img)

        if check_bbox_alignment(normalized, ref_bbox):
            print(f"  [{label}] OK — bbox aligned")
            return normalized
        else:
            print(f"  [{label}] Bbox misaligned, retrying...")
            time.sleep(1)

    # Return last attempt even if misaligned
    print(f"  [{label}] Using last attempt despite alignment issues")
    return normalized


# ── Main ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Generate outfit sprite set for wanwan"
    )
    parser.add_argument(
        "--outfit", "-o",
        required=True,
        help="Outfit description (e.g. 'red dress', 'school uniform')",
    )
    parser.add_argument(
        "--name", "-n",
        help="Outfit folder name (default: derived from description)",
    )
    parser.add_argument(
        "--api-key", "-k",
        help="Gemini API key (overrides GEMINI_API_KEY env var)",
    )

    args = parser.parse_args()

    # API key
    api_key = args.api_key or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Error: No Gemini API key. Set GEMINI_API_KEY or pass --api-key.", file=sys.stderr)
        sys.exit(1)

    # Outfit name
    outfit_name = args.name or args.outfit.lower().replace(" ", "-").replace("'", "").replace('"', '')
    outfit_dir = OUTFITS_DIR / outfit_name
    outfit_dir.mkdir(parents=True, exist_ok=True)

    print(f"=== Generating outfit: {args.outfit} ===")
    print(f"  Output: {outfit_dir}")

    # Verify reference exists
    if not REF_IDLE.exists():
        print(f"Error: Reference idle sprite not found: {REF_IDLE}", file=sys.stderr)
        sys.exit(1)

    # Import and init Gemini
    from google import genai
    from PIL import Image

    client = genai.Client(api_key=api_key)

    # Load reference
    ref_bbox, ref_img = get_ref_bbox()
    print(f"  Reference bbox: {ref_bbox}")

    # ── Step 1: Generate idle ──
    print("\n[1/6] Generating idle sprite...")
    idle_prompt = (
        f"Change this character's outfit to {args.outfit}. "
        "Keep the EXACT same character, face, hair, pose, position, "
        "composition, background. Only change the clothing."
    )
    idle_img = generate_with_retry(
        client, ref_img, idle_prompt, ref_bbox, ref_img, "idle"
    )
    if idle_img is None:
        print("Error: Failed to generate idle sprite", file=sys.stderr)
        sys.exit(1)

    idle_path = outfit_dir / "char-idle.png"
    idle_img.save(str(idle_path), "PNG")
    print(f"  Saved: {idle_path}")

    # Use the new idle as the base for blink and speaking
    # Also get its bbox for alignment checks
    idle_bbox = get_bbox(idle_img)

    # ── Step 3: Generate blink ──
    print("\n[2/6] Generating blink sprite...")
    blink_prompt = (
        "Close the eyes gently as if blinking. "
        "Keep EVERYTHING else exactly the same."
    )
    blink_img = generate_with_retry(
        client, idle_img, blink_prompt, ref_bbox, ref_img, "blink"
    )
    if blink_img is None:
        print("Error: Failed to generate blink sprite", file=sys.stderr)
        sys.exit(1)

    blink_path = outfit_dir / "char-blink.png"
    blink_img.save(str(blink_path), "PNG")
    print(f"  Saved: {blink_path}")

    # ── Step 5: Generate speaking ──
    print("\n[3/6] Generating speaking sprite...")
    speaking_prompt = (
        "Open the mouth slightly as if speaking. "
        "Keep EVERYTHING else exactly the same."
    )
    speaking_img = generate_with_retry(
        client, idle_img, speaking_prompt, ref_bbox, ref_img, "speaking"
    )
    if speaking_img is None:
        print("Error: Failed to generate speaking sprite", file=sys.stderr)
        sys.exit(1)

    speaking_path = outfit_dir / "char-speaking.png"
    speaking_img.save(str(speaking_path), "PNG")
    print(f"  Saved: {speaking_path}")

    # ── Quality gate: verify all alpha channels match ──
    print("\n[Quality] Verifying alpha channel consistency...")
    import numpy as np

    idle_a = np.array(idle_img.split()[3])
    blink_a = np.array(blink_img.split()[3])
    speaking_a = np.array(speaking_img.split()[3])

    if np.array_equal(idle_a, blink_a) and np.array_equal(idle_a, speaking_a):
        print("  All 3 sprites have identical alpha channels ✓")
    else:
        print("  [WARN] Alpha channels differ — this may cause flicker")

    # ── Save metadata ──
    metadata = {
        "name": outfit_name,
        "description": args.outfit,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sprites": {
            "idle": "char-idle.png",
            "blink": "char-blink.png",
            "speaking": "char-speaking.png",
        },
    }
    meta_path = outfit_dir / "metadata.json"
    meta_path.write_text(json.dumps(metadata, indent=2))
    print(f"\n  Saved metadata: {meta_path}")

    print(f"\n=== Done! Outfit '{outfit_name}' saved to {outfit_dir} ===")


if __name__ == "__main__":
    main()
