#!/usr/bin/env python3
"""Makes the recorded voice of the explainer videos: one clip per scene and language in assets/voice/.

The lines come from test/voice_lines.dart (run it first: it writes design/voice/lines.json). Each clip is made once with
OpenAI's speech service in a warm voice with a natural Indian accent (English, Telugu, Hindi), trimmed, levelled and
saved as a small AAC file (mono, 24 kHz, 32 kbps). Clips that are already there are kept; clips no line uses any more
are removed. durations.json (milliseconds per clip) is for the video recorder (test/record_videos.dart).

Needs: ffmpeg, and an OpenAI key that the request can use. In the cloud session the network proxy adds the saved key;
elsewhere set OPENAI_API_KEY. VOICE_MODEL must name the OpenAI speech model (see OpenAI's docs); VOICE picks the voice.
No key or model name is kept in this file.

    cd mobile && VOICE_MODEL=... python3 design/voice/make_voice.py
"""
import json
import os
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent.parent / 'assets' / 'voice'
LINES = HERE / 'lines.json'
DURATIONS = HERE / 'durations.json'

MODEL = os.environ.get('VOICE_MODEL')
VOICE = os.environ.get('VOICE', 'coral')
KEY = os.environ.get('OPENAI_API_KEY', 'proxy-injected')

HOW = {
    'en': 'Speak in a warm, natural Indian English accent, like a friendly business advisor from Hyderabad talking to '
          'small shop owners. Lively but clear, at a natural pace, with a smile in the voice.',
    'te': 'Speak natural, everyday Telugu as people in Hyderabad speak it, warm and friendly, clear pronunciation, at a '
          'natural pace. English words like WhatsApp, Instagram, AI and website are said the Indian way.',
    'hi': 'Speak natural, everyday Hindi as people speak it in India, warm and friendly, clear pronunciation, at a '
          'natural pace. English words like WhatsApp, Instagram, AI and website are said the Indian way.',
}


def fnv(text: str, lang: str) -> str:
    h = 0x811C9DC5
    for b in f'{lang}|{text}'.encode('utf-8'):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f'{lang}_{h:08x}'


def speak(line: dict) -> tuple[str, str]:
    name = line['name']
    target = ASSETS / f'{name}.m4a'
    if target.exists():
        return name, 'kept'
    body = json.dumps({'model': MODEL, 'voice': VOICE, 'input': line['text'], 'instructions': HOW[line['lang']], 'response_format': 'wav'}).encode()
    req = urllib.request.Request(
        'https://api.openai.com/v1/audio/speech',
        data=body,
        headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                wav = r.read()
            break
        except urllib.error.HTTPError as e:
            if attempt == 2 or e.code in (400, 401, 403):
                return name, f'failed {e.code}: {e.read()[:200]!r}'
        except Exception as e:  # network hiccup: try again
            if attempt == 2:
                return name, f'failed: {e}'
    with tempfile.NamedTemporaryFile(suffix='.wav') as tmp:
        tmp.write(wav)
        tmp.flush()
        # Trim the silence at both ends, level the loudness, then a small mono AAC file
        trim = 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse'
        subprocess.run(
            ['ffmpeg', '-y', '-loglevel', 'error', '-i', tmp.name, '-af', f'{trim},loudnorm=I=-16:TP=-1.5:LRA=11',
             '-ac', '1', '-ar', '24000', '-c:a', 'aac', '-b:a', '32k', '-movflags', '+faststart', str(target)],
            check=True,
        )
    return name, 'made'


def duration_ms(path: Path) -> int:
    out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(path)], capture_output=True, text=True, check=True)
    return round(float(out.stdout.strip()) * 1000)


def main() -> int:
    if not MODEL:
        print('Set VOICE_MODEL to the OpenAI speech model.', file=sys.stderr)
        return 2
    lines = json.loads(LINES.read_text())
    for line in lines:
        if fnv(line['text'], line['lang']) != line['name']:
            print(f"Clip name differs from the app's for {line['name']}", file=sys.stderr)
            return 1
    ASSETS.mkdir(parents=True, exist_ok=True)
    wanted = {line['name'] for line in lines}
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(speak, lines))
    failed = [(n, r) for n, r in results if r.startswith('failed')]
    made = sum(1 for _, r in results if r == 'made')
    removed = 0
    for clip in ASSETS.glob('*.m4a'):
        if clip.stem not in wanted:
            clip.unlink()
            removed += 1
    durations = {clip.stem: duration_ms(clip) for clip in sorted(ASSETS.glob('*.m4a'))}
    DURATIONS.write_text(json.dumps(durations, indent=1, sort_keys=True) + '\n')
    size = sum(c.stat().st_size for c in ASSETS.glob('*.m4a'))
    print(f'{len(lines)} lines: {made} made, {len(lines) - made - len(failed)} kept, {removed} removed, {len(failed)} failed; {size / 1e6:.1f} MB')
    for n, r in failed:
        print(f'  {n}: {r}')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
