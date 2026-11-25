#!/usr/bin/env python3
"""Makes the recorded voice of the explainer videos: one clip per scene and language in assets/voice/.

The lines come from test/voice_lines.dart (run it first: it writes design/voice/lines.json). Each clip is made once with
OpenAI's speech service in a warm voice with a natural Indian accent (English, Telugu, Hindi), trimmed, levelled and
saved as a small AAC file (mono, 24 kHz, 32 kbps). Clips that are already there are kept; clips no line uses any more
are removed. durations.json (milliseconds per clip) is for the video recorder (test/record_videos.dart).

Needs: ffmpeg, and an OpenAI key that the request can use. In the cloud session the network proxy adds the saved key;
elsewhere set OPENAI_API_KEY. VOICE_MODEL must name the OpenAI speech model (see OpenAI's docs). No key or model name
is kept in this file. --all makes every clip again (after changing VOICES or HOW).
ENGINE=sarvam uses Sarvam AI instead (SARVAM_API_KEY, SARVAM_SPEAKER, SARVAM_PACE; VOICE_MODEL = Sarvam's model).

    cd mobile && VOICE_MODEL=... python3 design/voice/make_voice.py [--all]
    cd mobile && ENGINE=sarvam SARVAM_API_KEY=... VOICE_MODEL=... SARVAM_SPEAKER=kavitha python3 design/voice/make_voice.py --all
"""
import base64
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
KEY = os.environ.get('OPENAI_API_KEY', 'proxy-injected')
# ENGINE=sarvam uses Sarvam AI (voices made for Indian languages; owner, 25 Nov 2026: "please try sarvam"):
# SARVAM_API_KEY from the environment, VOICE_MODEL = Sarvam's model, SARVAM_SPEAKER = one of its speakers.
ENGINE = os.environ.get('ENGINE', 'openai')
SARVAM_KEY = os.environ.get('SARVAM_API_KEY', '')
SARVAM_SPEAKER = os.environ.get('SARVAM_SPEAKER', 'kavitha')
# A little quicker than Sarvam's normal pace (owner: "voice slow ga undi kuncham")
SARVAM_PACE = float(os.environ.get('SARVAM_PACE', '1.15'))
SARVAM_LANG = {'en': 'en-IN', 'te': 'te-IN', 'hi': 'hi-IN'}

# The voice and the way of speaking for each language, as ChatGPT advised for a natural Indian sound (owner, 25 Nov
# 2026: "not a natural accent, ask ChatGPT the correct prompt"). VOICE_EN / VOICE_TE / VOICE_HI change the voice.
VOICES = {
    'en': os.environ.get('VOICE_EN', 'sage'),
    'te': os.environ.get('VOICE_TE', 'coral'),
    'hi': os.environ.get('VOICE_HI', 'alloy'),
}
HOW = {
    'en': "Speak Indian English with a natural Hyderabad/urban sound. Keep a syllable-timed rhythm and a medium, "
          "conversational pace. Warm, friendly advisor tone; sound confident but not salesy. Keep vowels Indian (no "
          "American drawl or strong r-colouring), and don't over-reduce unstressed vowels. Use a light tap for t/d "
          "between vowels, and keep final consonants crisp. Intonation: small rise on the first clause, clean fall at "
          "sentence ends; avoid sing-song or dramatic swoops. Pronounce brand and tech words in Indian English: "
          "WhatsApp as whats-app with a clear t and s, Instagram with a short a, A I as the letters A and I. Short "
          "pause at commas. Avoid a breathy voice, exaggerated smiles, or any US or UK accent cues.",
    'te': "Speak everyday Hyderabad/Telangana Telugu, like a native Telugu speaker. Syllable-timed rhythm, medium "
          "pace. Warm, friendly, helpful tone, like guiding a shop owner. Use natural code-mixing: English brand and "
          "tech words written in English letters (WhatsApp, Instagram, A I, website) are said in Indian English. "
          "'24 by 7' is said as twenty-four by seven. Avoid any American or UK accent on English words (no "
          "r-colouring, no drawn-out vowels). Intonation simple and clear: slight rise on the first clause, firm fall "
          "at full stops. Keep retroflex ట and డ sounds crisp and word endings clear. Short pause at commas and "
          "between clauses.",
    'hi': "Speak neutral urban Hindi (light Hinglish, Delhi-Mumbai style), like a native Hindi speaker. "
          "Syllable-timed rhythm, medium pace. Warm, friendly business-advisor tone. Natural code-mixing: English "
          "brand and tech words written in English letters (WhatsApp, Instagram, A I, website) are said in Indian "
          "English. '24 by 7' is said as twenty-four by seven. Avoid American or UK accent features on English words "
          "(no r-colouring, no heavy vowel reduction). Intonation: gentle emphasis on benefits, clean fall at "
          "sentence ends; avoid overly dramatic pitch. Keep dental and retroflex contrasts clear (त/ट, द/ड). Short "
          "pause at commas.",
}
# Every clip made again (after changing the voices or HOW): python3 make_voice.py --all
REDO = '--all' in sys.argv


def fnv(text: str, lang: str) -> str:
    h = 0x811C9DC5
    for b in f'{lang}|{text}'.encode('utf-8'):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f'{lang}_{h:08x}'


def speak(line: dict) -> tuple[str, str]:
    name = line['name']
    target = ASSETS / f'{name}.m4a'
    if target.exists() and not REDO:
        return name, 'kept'
    if ENGINE == 'sarvam':
        body = json.dumps({
            'text': line['text'], 'target_language_code': SARVAM_LANG[line['lang']], 'speaker': SARVAM_SPEAKER,
            'model': MODEL, 'pace': SARVAM_PACE, 'speech_sample_rate': 24000, 'enable_preprocessing': True,
        }).encode()
        req = urllib.request.Request('https://api.sarvam.ai/text-to-speech', data=body, headers={'api-subscription-key': SARVAM_KEY, 'Content-Type': 'application/json'})
    else:
        body = json.dumps({'model': MODEL, 'voice': VOICES[line['lang']], 'input': line['text'], 'instructions': HOW[line['lang']], 'response_format': 'wav'}).encode()
        req = urllib.request.Request(
            'https://api.openai.com/v1/audio/speech',
            data=body,
            headers={'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'},
        )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = r.read()
            wav = base64.b64decode(json.loads(raw)['audios'][0]) if ENGINE == 'sarvam' else raw
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
        print('Set VOICE_MODEL to the speech model (OpenAI, or Sarvam with ENGINE=sarvam).', file=sys.stderr)
        return 2
    if ENGINE == 'sarvam' and not SARVAM_KEY:
        print('Set SARVAM_API_KEY for ENGINE=sarvam.', file=sys.stderr)
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
    # The app reads the lengths too: each scene lasts as long as its words
    (ASSETS / 'durations.json').write_text(json.dumps(durations, separators=(',', ':'), sort_keys=True) + '\n')
    size = sum(c.stat().st_size for c in ASSETS.glob('*.m4a'))
    print(f'{len(lines)} lines: {made} made, {len(lines) - made - len(failed)} kept, {removed} removed, {len(failed)} failed; {size / 1e6:.1f} MB')
    for n, r in failed:
        print(f'  {n}: {r}')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
