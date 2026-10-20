#!/usr/bin/env python3
"""
TTS Generator for Cartoon Maker AI
Generates high-quality Indonesian character dialogue using edge-tts.
"""

import argparse
import asyncio
import json
import os
import subprocess
import sys

# Preset character voice map for Indonesian characters
VOICE_MAP = {
    'sekar': 'id-ID-GadisNeural',
    'pitri': 'id-ID-GadisNeural',
    'mili': 'id-ID-GadisNeural',
    'riska': 'id-ID-GadisNeural',
    'ines': 'id-ID-GadisNeural',
    'meimei': 'id-ID-GadisNeural',
    'gadis': 'id-ID-GadisNeural',
    'perempuan': 'id-ID-GadisNeural',
    'female': 'id-ID-GadisNeural',

    'uki': 'id-ID-ArdiNeural',
    'kris': 'id-ID-ArdiNeural',
    'jajang': 'id-ID-ArdiNeural',
    'ono': 'id-ID-ArdiNeural',
    'pei': 'id-ID-ArdiNeural',
    'hilman': 'id-ID-ArdiNeural',
    'udin': 'id-ID-ArdiNeural',
    'obi': 'id-ID-ArdiNeural',
    'ardi': 'id-ID-ArdiNeural',
    'laki': 'id-ID-ArdiNeural',
    'male': 'id-ID-ArdiNeural',
}

DEFAULT_VOICE = 'id-ID-ArdiNeural'


def resolve_voice(who: str) -> str:
    if not who:
        return DEFAULT_VOICE
    w = who.strip().lower()
    if w in VOICE_MAP:
        return VOICE_MAP[w]
    # Check if ends with vocal or hints
    if any(k in w for k in ['putri', 'wati', 'siti', 'ani', 'rina', 'lisa', 'ibu', 'girl']):
        return 'id-ID-GadisNeural'
    return DEFAULT_VOICE


def get_audio_duration(file_path: str) -> float:
    """Uses ffprobe to obtain audio duration in seconds."""
    ffprobe_bin = os.environ.get('FFPROBE_BIN', 'ffprobe')
    try:
        cmd = [
            ffprobe_bin,
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            file_path
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        dur_str = res.stdout.strip()
        return round(float(dur_str), 3)
    except Exception as e:
        # Fallback approximation based on file size for 48kbps-128kbps mp3 if ffprobe fails
        try:
            sz = os.path.getsize(file_path)
            # Edge-TTS is approx 64kbps = 8000 bytes/sec
            return max(1.0, round(sz / 8000.0, 2))
        except Exception:
            return 2.5


async def synthesize_one(text: str, voice: str, out_path: str, rate: str = "+0%", pitch: str = "+0Hz"):
    import edge_tts
    communicate = edge_tts.Communicate(text=text, voice=voice, rate=rate, pitch=pitch)
    await communicate.save(out_path)


def process_item(item: dict) -> dict:
    text = item.get('text', '').strip()
    if not text:
        return {'error': 'Teks kosong'}
    who = item.get('who', '')
    voice = item.get('voice') or resolve_voice(who)
    out_path = item.get('out_path')
    if not out_path:
        return {'error': 'out_path wajib diisi'}
    
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    
    rate = item.get('rate', '+0%')
    pitch = item.get('pitch', '+0Hz')
    
    asyncio.run(synthesize_one(text, voice, out_path, rate=rate, pitch=pitch))
    duration = get_audio_duration(out_path)
    return {
        'who': who,
        'text': text,
        'voice': voice,
        'out_path': out_path,
        'duration': duration,
        'status': 'ok'
    }


def main():
    parser = argparse.ArgumentParser(description='Cartoon Maker TTS Generator')
    parser.add_argument('--text', help='Teks yang akan diucapkan')
    parser.add_argument('--who', default='', help='Nama karakter (mis. Sekar, Uki)')
    parser.add_argument('--voice', help='Voice ID (id-ID-GadisNeural, id-ID-ArdiNeural)')
    parser.add_argument('--out', help='Path file output (.mp3)')
    parser.add_argument('--batch', help='Path ke file JSON batch [{"text", "who", "out_path", ...}]')

    args = parser.parse_args()

    if args.batch:
        with open(args.batch, 'r', encoding='utf-8') as f:
            items = json.load(f)
        results = [process_item(it) for it in items]
        print(json.dumps(results, indent=2))
        return

    if not args.text or not args.out:
        parser.error('--text dan --out wajib diisi jika tidak menggunakan --batch')

    res = process_item({
        'text': args.text,
        'who': args.who,
        'voice': args.voice,
        'out_path': args.out,
    })
    print(json.dumps(res, indent=2))


if __name__ == '__main__':
    main()
