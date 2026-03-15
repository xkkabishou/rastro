#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "google-genai>=1.0.0",
#     "pillow>=10.0.0",
# ]
# ///
"""
Generate.py - Image Generation CLI using Google Gemini Image API

Supports Gemini 3.1 Flash Image, Gemini 3 Pro Image, and Gemini 2.5 Flash Image
models with text-to-image, image editing, multi-image composition, and presets.

Usage:
    uv run Generate.py --prompt "..." --output ~/Downloads/image.png [OPTIONS]
"""

import argparse
import json
import os
import sys
from io import BytesIO
from pathlib import Path

# ============================================================================
# Constants
# ============================================================================

VALID_MODELS = [
    "gemini-3.1-flash-image-preview",
    "gemini-3-pro-image-preview",
    "gemini-2.5-flash-image",
]

VALID_RESOLUTIONS = ["512px", "1K", "2K", "4K"]

VALID_ASPECT_RATIOS = [
    "1:1", "1:4", "1:8", "2:3", "3:2", "3:4",
    "4:1", "4:3", "4:5", "5:4", "8:1", "9:16", "16:9", "21:9",
]

# Cost per image by model and resolution (output tokens * $rate/1M tokens)
# Token counts: 512px=747, 1K=1120, 2K=1680, 4K=2520
COST_TABLE: dict[str, dict[str, float]] = {
    "gemini-3.1-flash-image-preview": {
        # $60/1M output image tokens
        "512px": 0.045,
        "1K": 0.067,
        "2K": 0.101,
        "4K": 0.151,
    },
    "gemini-3-pro-image-preview": {
        # $120/1M output image tokens
        "1K": 0.134,
        "2K": 0.134,
        "4K": 0.240,
    },
    "gemini-2.5-flash-image": {
        # Flat rate
        "1K": 0.039,
    },
}

# Input image cost (560 tokens at input rate)
INPUT_IMAGE_COST: dict[str, float] = {
    "gemini-3.1-flash-image-preview": 0.0001,   # 560 * $0.25/1M
    "gemini-3-pro-image-preview": 0.0011,        # 560 * $2.00/1M
    "gemini-2.5-flash-image": 0.0002,            # 560 * $0.30/1M
}

DEFAULTS = {
    "model": "gemini-3.1-flash-image-preview",
    "resolution": "1K",
    "aspect_ratio": "1:1",
}

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent

# ============================================================================
# Environment
# ============================================================================


def load_dotenv(path: str) -> None:
    """Load key=value pairs from a file into os.environ."""
    env_path = Path(path).expanduser()
    if not env_path.is_file():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, value = line.partition("=")
            key, value = key.strip(), value.strip()
            # Strip surrounding quotes
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            os.environ.setdefault(key, value)


def get_api_key(provided_key: str | None) -> str | None:
    """Get API key from argument, environment, or ~/.claude/.env."""
    if provided_key:
        return provided_key
    load_dotenv("~/.claude/.env")
    return os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")


# ============================================================================
# JSON Output
# ============================================================================


def output_json(data: dict) -> None:
    """Print structured JSON output."""
    print(json.dumps(data, indent=2))


def output_error(message: str, code: str = "ERROR") -> None:
    """Print error as JSON and exit."""
    output_json({"status": "error", "code": code, "message": message})
    sys.exit(1)


# ============================================================================
# Cost Estimation
# ============================================================================


def get_cost_per_image(model: str, resolution: str) -> float:
    """Get the cost for generating one image."""
    model_costs = COST_TABLE.get(model, {})
    if resolution in model_costs:
        return model_costs[resolution]
    # Fall back to closest available resolution
    for res in VALID_RESOLUTIONS:
        if res in model_costs:
            return model_costs[res]
    return 0.0


def estimate_cost(model: str, resolution: str, input_count: int = 0) -> dict:
    """Estimate cost for a generation request."""
    image_cost = get_cost_per_image(model, resolution)
    input_cost = input_count * INPUT_IMAGE_COST.get(model, 0.0)
    total = image_cost + input_cost
    return {
        "outputCost": f"${image_cost:.4f}",
        "inputCost": f"${input_cost:.4f}" if input_count > 0 else "$0.0000",
        "totalCost": f"${total:.4f}",
        "model": model,
        "resolution": resolution,
        "inputImages": input_count,
    }


# ============================================================================
# Presets
# ============================================================================


def load_presets() -> dict:
    """Load presets from Presets.json."""
    presets_path = SKILL_DIR / "scripts" / "Presets.json"
    try:
        return json.loads(presets_path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def apply_preset(args: argparse.Namespace) -> argparse.Namespace:
    """Apply preset defaults to args (CLI args take precedence)."""
    if not args.preset:
        return args

    presets = load_presets()
    preset = presets.get(args.preset)
    if not preset:
        names = ", ".join(presets.keys()) if presets else "none"
        output_error(
            f"Unknown preset: {args.preset}. Available: {names}",
            "UNKNOWN_PRESET",
        )

    if preset.get("resolution") and args.resolution == DEFAULTS["resolution"]:
        args.resolution = preset["resolution"]
    if preset.get("aspect_ratio") and args.aspect_ratio == DEFAULTS["aspect_ratio"]:
        args.aspect_ratio = preset["aspect_ratio"]
    if preset.get("promptPrefix") or preset.get("promptSuffix"):
        prefix = preset.get("promptPrefix", "")
        suffix = preset.get("promptSuffix", "")
        args.prompt = f"{prefix}{args.prompt}{suffix}"

    return args


# ============================================================================
# Image Loading
# ============================================================================


def load_input_images(paths: list[str]) -> tuple[list, int]:
    """Load input images and return (PIL images, max_dimension)."""
    from PIL import Image as PILImage

    images = []
    max_dim = 0

    for img_path in paths:
        try:
            img = PILImage.open(img_path)
            images.append(img)
            w, h = img.size
            max_dim = max(max_dim, w, h)
            sys.stderr.write(f"Loaded: {img_path} ({w}x{h})\n")
        except Exception as e:
            output_error(f"Failed to load image '{img_path}': {e}", "IMAGE_LOAD_FAILED")

    return images, max_dim


def auto_detect_resolution(max_dim: int, explicit_resolution: str) -> str:
    """Auto-detect resolution from input image dimensions."""
    if explicit_resolution != DEFAULTS["resolution"]:
        return explicit_resolution
    if max_dim >= 3000:
        return "4K"
    elif max_dim >= 1500:
        return "2K"
    return "1K"


# ============================================================================
# Image Saving
# ============================================================================


def save_image(part, output_path: Path) -> bool:
    """Save an image part from the API response. Returns True if saved."""
    from PIL import Image as PILImage
    import base64

    if part.inline_data is None:
        return False

    image_data = part.inline_data.data
    if isinstance(image_data, str):
        image_data = base64.b64decode(image_data)

    image = PILImage.open(BytesIO(image_data))

    # Keep alpha when the model returns transparent pixels.
    if image.mode == "RGBA":
        image.save(str(output_path), "PNG")
    elif image.mode == "RGB":
        image.save(str(output_path), "PNG")
    else:
        image.convert("RGB").save(str(output_path), "PNG")

    return True


# ============================================================================
# Main Generation
# ============================================================================


def generate(args: argparse.Namespace) -> None:
    """Run image generation or editing."""
    from google import genai
    from google.genai import types

    api_key = get_api_key(args.api_key)
    if not api_key:
        output_error(
            "Missing API key. Set GOOGLE_API_KEY in ~/.claude/.env or pass --api-key",
            "MISSING_API_KEY",
        )

    client = genai.Client(api_key=api_key)

    # Set up output
    output_path = Path(args.output).expanduser()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    resolution = args.resolution

    # Load input images
    input_images = []
    if args.input_images:
        if len(args.input_images) > 14:
            output_error(
                f"Too many input images ({len(args.input_images)}). Maximum is 14.",
                "TOO_MANY_IMAGES",
            )
        input_images, max_dim = load_input_images(args.input_images)
        resolution = auto_detect_resolution(max_dim, args.resolution)

    # Build contents
    if input_images:
        contents = [*input_images, args.prompt]
        mode = "edit"
        sys.stderr.write(
            f"Editing {len(input_images)} image(s) with {args.model} at {resolution}...\n"
        )
    else:
        contents = args.prompt
        mode = "generate"
        sys.stderr.write(f"Generating with {args.model} at {resolution}...\n")

    # Build config
    image_config_kwargs: dict = {"image_size": resolution}
    if args.aspect_ratio != DEFAULTS["aspect_ratio"]:
        image_config_kwargs["aspect_ratio"] = args.aspect_ratio

    config = types.GenerateContentConfig(
        response_modalities=["TEXT", "IMAGE"],
        image_config=types.ImageConfig(**image_config_kwargs),
    )

    try:
        response = client.models.generate_content(
            model=args.model,
            contents=contents,
            config=config,
        )

        # Process response
        image_saved = False
        model_text = None
        for part in response.parts:
            if part.text is not None:
                model_text = part.text
                sys.stderr.write(f"Model: {part.text}\n")
            elif save_image(part, output_path):
                image_saved = True

        if not image_saved:
            output_error("No image was generated in the response.", "NO_IMAGE_RETURNED")

        full_path = str(output_path.resolve())
        cost = estimate_cost(args.model, resolution, len(input_images))

        output_json({
            "status": "complete",
            "mode": mode,
            "outputPath": full_path,
            "resolution": resolution,
            "aspectRatio": args.aspect_ratio,
            "model": args.model,
            "cost": cost["totalCost"],
            "modelResponse": model_text,
        })

        # MEDIA line for tool integration
        print(f"MEDIA: {full_path}", file=sys.stderr)

    except Exception as e:
        output_error(f"Generation failed: {e}", "GENERATION_FAILED")


# ============================================================================
# CLI
# ============================================================================


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate images using Google Gemini Image API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
MODELS:
  gemini-3.1-flash-image-preview   Fast, efficient (recommended)
  gemini-3-pro-image-preview       Pro quality, higher cost
  gemini-2.5-flash-image           Budget option (1K only)

RESOLUTIONS:
  512px   Thumbnail ($0.045)
  1K      Standard  ($0.067)  ← default
  2K      High      ($0.101)
  4K      Maximum   ($0.151)

ASPECT RATIOS:
  1:1, 2:3, 3:2, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9, 1:4, 4:1, 1:8, 8:1

EXAMPLES:
  # Basic generation
  uv run Generate.py --prompt "A sunset over mountains" --output ~/Downloads/sunset.png

  # High-res with aspect ratio
  uv run Generate.py --prompt "Product photo" --resolution 4K --aspect-ratio 16:9 --output photo.png

  # Edit an image
  uv run Generate.py --prompt "Make the sky purple" -i input.png --output edited.png

  # Multi-image composition
  uv run Generate.py --prompt "Combine into a collage" -i a.png -i b.png -i c.png --output collage.png

  # Cost estimate
  uv run Generate.py --prompt "test" --resolution 4K --dry-run

ENVIRONMENT:
  GOOGLE_API_KEY    Required - set in ~/.claude/.env
""",
    )

    # Required
    parser.add_argument("--prompt", "-p", required=False, help="Image prompt")
    parser.add_argument("--output", "-o", required=False, help="Output file path (.png)")

    # Model & quality
    parser.add_argument(
        "--model", "-m",
        choices=VALID_MODELS,
        default=DEFAULTS["model"],
        help=f"Model (default: {DEFAULTS['model']})",
    )
    parser.add_argument(
        "--resolution", "-r",
        choices=VALID_RESOLUTIONS,
        default=DEFAULTS["resolution"],
        help=f"Output resolution (default: {DEFAULTS['resolution']})",
    )
    parser.add_argument(
        "--aspect-ratio", "-a",
        choices=VALID_ASPECT_RATIOS,
        default=DEFAULTS["aspect_ratio"],
        help=f"Aspect ratio (default: {DEFAULTS['aspect_ratio']})",
    )

    # Input images
    parser.add_argument(
        "--input-image", "-i",
        action="append",
        dest="input_images",
        metavar="IMAGE",
        help="Input image(s) for editing/composition (up to 14, repeatable)",
    )

    # Presets
    parser.add_argument("--preset", help="Apply preset from Presets.json")

    # API key
    parser.add_argument("--api-key", "-k", help="API key (overrides env)")

    # Query modes
    parser.add_argument("--dry-run", action="store_true", help="Show cost estimate only")
    parser.add_argument("--list-presets", action="store_true", help="List available presets")
    parser.add_argument("--show-preset", metavar="NAME", help="Show preset details")

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    # Query: list presets
    if args.list_presets:
        presets = load_presets()
        output_json({
            "status": "complete",
            "presets": [
                {"name": k, **v} for k, v in presets.items()
            ],
        })
        return

    # Query: show preset
    if args.show_preset:
        presets = load_presets()
        preset = presets.get(args.show_preset)
        if not preset:
            output_error(f"Unknown preset: {args.show_preset}", "UNKNOWN_PRESET")
        output_json({"status": "complete", "name": args.show_preset, "preset": preset})
        return

    # Dry run
    if args.dry_run:
        if not args.prompt:
            args.prompt = "test"
        input_count = len(args.input_images) if args.input_images else 0
        cost = estimate_cost(args.model, args.resolution, input_count)
        output_json({"status": "dry-run", **cost})
        return

    # Generation requires prompt and output
    if not args.prompt:
        output_error("Missing required: --prompt", "MISSING_PROMPT")
    if not args.output:
        output_error("Missing required: --output", "MISSING_OUTPUT")

    # Apply preset
    args = apply_preset(args)

    # Run generation
    generate(args)


if __name__ == "__main__":
    main()
