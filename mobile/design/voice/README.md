# The videos' recorded voice

Every scene of the explainer videos (`lib/screens/explainers/explainer_content.dart`) is read aloud: its title, then its
line, in English, Telugu and Hindi, in a warm voice with a natural Indian accent. The clips live in `assets/voice/`
(one per scene and language, about 3.4 MB in all) and the player plays them (`RecordedNarrator` in `narrator.dart`).
A line with no clip is read by the phone's own text-to-speech, so changing words never breaks a video, but please make
the voice again after changing any words (a test fails until you do):

```bash
cd mobile
VOICE_LINES=design/voice/lines.json flutter test test/voice_lines.dart
VOICE_MODEL=<OpenAI speech model> python3 design/voice/make_voice.py
```

`make_voice.py` makes only the missing clips, removes clips no line uses any more, and writes `durations.json`. It
needs ffmpeg and an OpenAI key: in the cloud session the network proxy adds the saved key; on a computer set
`OPENAI_API_KEY`. `VOICE` picks the voice (default `coral`). The way each language should sound is in `HOW` in the
script. Clip names are `<lang>_<FNV-1a of "lang|text">`, the same in the app and the script.

To watch the videos with the voice outside the app:

```bash
VIDEOS_DIR=/tmp/videos VIDEOS=grow:en,website:te FPS=12 flutter test test/record_videos.dart
python3 design/voice/mux_videos.py /tmp/videos
```
