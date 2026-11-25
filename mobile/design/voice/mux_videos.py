#!/usr/bin/env python3
"""Turns the frames from test/record_videos.dart into MP4 videos with the recorded voice (assets/voice/) placed where
each scene starts (timeline.json in each folder). For a look at the videos outside the app.

    python3 design/voice/mux_videos.py /tmp/videos
"""
import json
import subprocess
import sys
from pathlib import Path

VOICE = Path(__file__).resolve().parent.parent.parent / 'assets' / 'voice'


def mux(folder: Path) -> Path:
    info = json.loads((folder / 'timeline.json').read_text())
    fps = info['fps']
    clips = [c for c in info['clips'] if (VOICE / f"{c['clip']}.m4a").exists()]
    out = folder.with_suffix('.mp4')
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(fps), '-i', str(folder / '%05d.png')]
    for c in clips:
        cmd += ['-i', str(VOICE / f"{c['clip']}.m4a")]
    if clips:
        parts = [f"[{i + 1}:a]adelay={c['start_ms']}|{c['start_ms']},aresample=48000[a{i}]" for i, c in enumerate(clips)]
        mix = ''.join(f'[a{i}]' for i in range(len(clips))) + f'amix=inputs={len(clips)}:normalize=0[voice]'
        cmd += ['-filter_complex', ';'.join(parts + [mix]), '-map', '0:v', '-map', '[voice]', '-c:a', 'aac', '-b:a', '96k']
    cmd += ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '24', '-movflags', '+faststart', str(out)]
    subprocess.run(cmd, check=True)
    return out


if __name__ == '__main__':
    root = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/videos')
    for folder in sorted(p for p in root.iterdir() if p.is_dir() and (p / 'timeline.json').exists()):
        print(mux(folder))
