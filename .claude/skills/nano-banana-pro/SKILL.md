---
name: nano-banana-pro
description: "This skill should be used when the user asks to generate an image, create a picture, edit a photo, compose multiple images, or work with Google Gemini Image. Supports Gemini 3.1 Flash Image, Gemini 3 Pro Image, and Gemini 2.5 Flash Image models. Trigger phrases: generate an image, create a picture, make an image, edit this image, compose images, /nano-banana-pro."
argument-hint: "[prompt] [--resolution 1K|2K|4K] [--aspect-ratio 1:1|16:9|9:16] [--preset name]"
---

# Image Generation with Nano Banana Pro (Gemini Image)

Generate and edit high-quality images using Google's Gemini Image API with text-to-image, image editing, multi-image composition, presets, and cost controls.

## Tool Location

The generation CLI is at: `${SKILL_DIR}/scripts/generate_image.py`

Run with: `uv run "${SKILL_DIR}/scripts/generate_image.py" [OPTIONS]`

## Prerequisites

- **uv** installed (`brew install uv`)
- **GOOGLE_API_KEY** set in `~/.claude/.env`

## Interactive Flow

### 1. Parse Arguments

Check what the user provided via `$ARGUMENTS`:
- Prompt text
- `--resolution` (512px, 1K, 2K, 4K)
- `--aspect-ratio` (1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9)
- `--model` (gemini-3.1-flash-image-preview, gemini-3-pro-image-preview, gemini-2.5-flash-image; default: gemini-3.1-flash-image-preview)
- `--preset` (photorealistic, social-media, social-story, product, banner, thumbnail, illustration, cinematic)
- `--output` (file path for the .png)
- `--input-image` / `-i` (image path(s) for editing/composition)

### 2. Gather Missing Information

If **prompt** is missing, ask:
> What image would you like to generate? Describe the scene, subject, and style.

If **output** is missing, generate a default:
```
~/Downloads/yyyy-mm-dd-hh-mm-ss-description.png
```

### 3. Optional Enhancements

Optionally ask about:
- **Model**: gemini-3.1-flash-image-preview (default, fast & cheap), gemini-3-pro-image-preview (pro quality), or gemini-2.5-flash-image (budget)
- **Preset**: photorealistic, social-media, social-story, product, banner, thumbnail, illustration, cinematic
- **Resolution**: 1K (default), 2K, 4K
- **Aspect ratio**: 1:1 (default), 16:9, 9:16, 3:2, 4:3, 21:9, etc.

### 4. Cost Estimation

Before generating, run a dry-run to show cost:
```bash
uv run "${SKILL_DIR}/scripts/generate_image.py" \
  --prompt "..." --resolution 2K --model gemini-3.1-flash-image-preview --dry-run
```

Show the estimated cost and confirm with the user before proceeding if the cost is above $0.10.

### 5. Generate

Run the generation:
```bash
uv run "${SKILL_DIR}/scripts/generate_image.py" \
  --prompt "USER_PROMPT" \
  --output OUTPUT_PATH \
  [--model MODEL] \
  [--resolution RESOLUTION] \
  [--aspect-ratio ASPECT_RATIO] \
  [--preset PRESET] \
  [-i INPUT_IMAGE ...] \
  [--api-key KEY]
```

### 6. Report Results

After completion, report:
- Output file path
- Actual cost
- Resolution and aspect ratio used
- Model response text (if any)
- Do NOT read the generated image back — just report the path

## Image Editing

Edit a single image with text instructions:
```bash
uv run "${SKILL_DIR}/scripts/generate_image.py" \
  --prompt "Make the sky purple and add stars" \
  -i /path/to/photo.png \
  --output /path/to/edited.png
```

## Multi-Image Composition

Combine up to 14 reference images:
```bash
uv run "${SKILL_DIR}/scripts/generate_image.py" \
  --prompt "Combine these into a cohesive scene" \
  -i img1.png -i img2.png -i img3.png \
  --output /path/to/composed.png
```

For edits, the script auto-detects output resolution from input image dimensions.

## Models

| Model | Speed | Quality | Best For | Max Resolution |
|-------|-------|---------|----------|---------------|
| gemini-3.1-flash-image-preview | Fast | High | General use (recommended) | 4K |
| gemini-3-pro-image-preview | Slower | Highest | Pro assets, text rendering | 4K |
| gemini-2.5-flash-image | Fastest | Good | Budget, quick drafts | 1K |

## Presets

| Preset | Resolution | Aspect | Style |
|--------|-----------|--------|-------|
| photorealistic | 2K | 3:2 | DSLR photo quality |
| social-media | 1K | 1:1 | Instagram/Facebook posts |
| social-story | 1K | 9:16 | Stories/Reels/TikTok |
| product | 2K | 1:1 | Studio product shots |
| banner | 2K | 21:9 | Website hero/banner |
| thumbnail | 1K | 16:9 | YouTube thumbnails |
| illustration | 2K | 1:1 | Digital art/illustration |
| cinematic | 4K | 21:9 | Film stills |

## Cost Reference

### Gemini 3.1 Flash Image (default)

| Resolution | Cost/Image | Tokens |
|-----------|-----------|--------|
| 512px | $0.045 | 747 |
| 1K | $0.067 | 1,120 |
| 2K | $0.101 | 1,680 |
| 4K | $0.151 | 2,520 |

### Gemini 3 Pro Image

| Resolution | Cost/Image | Tokens |
|-----------|-----------|--------|
| 1K/2K | $0.134 | 1,120 |
| 4K | $0.240 | 2,000 |

### Gemini 2.5 Flash Image

| Resolution | Cost/Image | Tokens |
|-----------|-----------|--------|
| 1K | $0.039 | 1,290 |

Input images cost ~$0.0001–$0.0011 each depending on model.

## Aspect Ratios

| Ratio | Use Case |
|-------|----------|
| 1:1 | Social media, avatars, icons |
| 3:2, 2:3 | Photography, prints |
| 4:3, 3:4 | Presentations, tablets |
| 16:9, 9:16 | Widescreen, stories/reels |
| 21:9 | Ultrawide, banners, hero images |
| 4:5, 5:4 | Instagram portrait/landscape |

## Query Operations

```bash
# List available presets
uv run "${SKILL_DIR}/scripts/generate_image.py" --list-presets

# Show preset details
uv run "${SKILL_DIR}/scripts/generate_image.py" --show-preset cinematic

# Cost estimate
uv run "${SKILL_DIR}/scripts/generate_image.py" --prompt "test" --resolution 4K --dry-run
```

## Prompting Tips

- Be specific about subject, style, lighting, and composition
- Front-load the most important details
- Mention camera/lens for photorealistic results (e.g., "shot on Canon EOS R5, 85mm f/1.4")
- Specify art style for illustrations (e.g., "watercolor", "vector", "oil painting")
- Use presets to auto-enhance prompts with style cues
- For text in images, use 2K or 4K resolution for legibility
