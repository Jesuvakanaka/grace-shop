# VYRA garment image test (OpenAI GPT Image 2.5)

A standalone test that turns your own garment photos into model photos with
OpenAI's GPT Image 2.5, at medium and high quality, so you can compare them by
eye. It is **not part of the shop**: the website never loads it, it is not
deployed, and it does not touch the database or any stored product pictures.

## What it does

For each photo in `test-input/`, it makes three portrait pictures (1024x1536)
of the same fictional model wearing the garment:

1. **Front**, made from your photo.
2. **Angled** (three-quarter view), made from your photo plus the front result.
3. **Back or detail**, made from your photo plus the front result.

Sending the front result back in keeps the same model, face and background
across the three views. Each garment is done at **medium** and **high** quality.

Results go to `test-output/<garment-name>/<quality>/` (`front.png`,
`angled.png`, `back.png`, and `results.json` with the token usage and cost of
each picture). A copy of your photo is placed in `test-output/<garment-name>/`;
the file in `test-input/` is only ever read. At the end it builds
`test-output/index.html`, which shows your photo next to the medium and high
results with the cost of each.

## One-time setup

You need [Node.js](https://nodejs.org) 20 or newer and an OpenAI API key.
OpenAI may ask you to verify your organisation before it allows image models.

```sh
cd experiments/garment-image-test
npm install
```

Set the key in your terminal for the current session only. Never put it in a
file inside the repo.

```sh
export OPENAI_API_KEY="sk-..."        # macOS / Linux
$env:OPENAI_API_KEY = "sk-..."        # Windows PowerShell
```

## Running it

1. Put your garment photos (JPG, PNG or WebP) in `test-input/`. The file name
   becomes the garment name, e.g. `denim-pinafore-dress.jpg`. iPhone HEIC photos
   need exporting as JPG first.
2. Optional: add notes for a garment in a text file with the same name, e.g.
   `denim-pinafore-dress.txt` saying "knee-length". They are added to the prompt.
   Use this for things a flat photo can't show, like length or fit.
3. Check what will run and the rough cost, without spending anything:

   ```sh
   node run.mjs --dry-run
   ```

4. Try one garment first, then the rest:

   ```sh
   node run.mjs --limit 1
   node run.mjs
   ```

Garments that are already finished are skipped, so you can stop and rerun at
any time. A failed picture is retried on the next run.

### Options

| Option | What it does |
| --- | --- |
| `--limit 2` | Only process the next 2 unfinished garments. |
| `--model gpt-image-2.5-sunburst` | Use Sunburst instead of Flare (the default). You can also set `OPENAI_IMAGE_MODEL`. |
| `--output test-output-sunburst` | Save to another folder. Use this when switching model, otherwise the earlier results count as done. |
| `--quality medium,high` | Which qualities to make. The API accepts `low`, `medium`, `high`, `auto`; 2.5 models also accept `xhigh` and `max`. |
| `--model-look "..."` | Describe the fictional model, to replace the default description. |
| `--dry-run` | Show what would run and the estimate, call nothing. |
| `--page-only` | Rebuild `index.html` from saved results. |

## Cost

The cost of each picture comes from the token usage OpenAI returns, at the
standard prices for `gpt-image-2.5-flare` and `gpt-image-2.5-sunburst` (the same
for both): $5 per 1M text input tokens, $8 per 1M image input tokens, $30 per
1M image output tokens. Source: https://developers.openai.com/api/docs/pricing
(checked 2026-11-26).

OpenAI doesn't publish how many tokens a 2.5 picture uses, so `--dry-run` uses a
guess from older models: about $0.06 per medium and $0.20 per high picture,
plus a cent or two for the reference photos. That is about $0.80 per garment
and $8 for 10 garments. The real cost is printed after each picture and in the
final total.

## Prompt

The base prompt is in `run.mjs` (`BASE_PROMPT`), with the VYRA theme colours
from `src/app/globals.css`: cream `#EDE6D3` / `#F6F2E8` with olive `#5F7A1F`.
One line is added so that "no logos" doesn't remove labels or patches sewn
onto the garment itself.

## Settings used (from OpenAI's docs, 2026-11-26)

`POST /v1/images/edits` via the official `openai` Node library:
`model`, `image` (your photo, plus the front view for the other two),
`prompt`, `quality`, `size: "1024x1536"`, `output_format: "png"`, `n: 1`.
`input_fidelity` is left out because the docs don't list it for 2.5 models.

- https://developers.openai.com/api/reference/resources/images/methods/edit/
- https://developers.openai.com/api/docs/models/gpt-image-2.5-sunburst
