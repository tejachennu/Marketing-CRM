# The videos' recorded voice

Every scene of the explainer videos is read aloud from a spoken script (`lib/screens/explainers/explainer_narration.dart`:
natural Tenglish, Hinglish and Indian English, not the captions), in a warm voice with a natural Indian accent made by
Sarvam AI (speaker kavitha). Each scene lasts as long as its words (`assets/voice/durations.json`). The words are written the way they
are spoken (`spokenWords`: "24 by 7", "A I"). The clips live in `assets/voice/`
(one per scene and language, about 3.4 MB in all) and the player plays them (`RecordedNarrator` in `narrator.dart`).
A line with no clip is read by the phone's own text-to-speech, so changing words never breaks a video, but please make
the voice again after changing any words (a test fails until you do):

```bash
cd mobile
VOICE_LINES=design/voice/lines.json flutter test test/voice_lines.dart
ENGINE=sarvam SARVAM_API_KEY=<your key> VOICE_MODEL=<Sarvam model> SARVAM_SPEAKER=kavitha python3 design/voice/make_voice.py
```

(OpenAI instead: leave out `ENGINE`, set `VOICE_MODEL` to OpenAI's speech model.) Never commit a key.

`make_voice.py` makes only the missing clips, removes clips no line uses any more, and writes `durations.json`. It
needs ffmpeg and an OpenAI key: in the cloud session the network proxy adds the saved key; on a computer set
`OPENAI_API_KEY`. Each language has its own voice (`VOICES`: sage for English, coral for Telugu, alloy for Hindi) and
its own way of speaking (`HOW`), both as ChatGPT advised for a natural Indian sound; after changing either, run the
script with `--all` to make every clip again. Clip names are `<lang>_<FNV-1a of "lang|text">`, the same in the app and the script.

To watch the videos with the voice outside the app:

```bash
VIDEOS_DIR=/tmp/videos VIDEOS=grow:en,website:te FPS=12 flutter test test/record_videos.dart
python3 design/voice/mux_videos.py /tmp/videos
```
