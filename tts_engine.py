import os
import hashlib
import asyncio
from pathlib import Path
from typing import Optional
import edge_tts

CACHE_DIR = Path(__file__).parent / "audio_cache"
CACHE_DIR.mkdir(exist_ok=True, parents=True)

DEFAULT_VOICE = "th-TH-PremwadeeNeural"

def get_cache_filename(text: str, voice: str = DEFAULT_VOICE, rate: Optional[str] = None) -> Path:
    key = f"{voice}::{rate or 'default'}::{text}"
    h = hashlib.sha256(key.encode('utf-8')).hexdigest()
    return CACHE_DIR / f"{h}.mp3"

async def synthesize_text_to_file(
    text: str,
    output_path: Path,
    voice: str = DEFAULT_VOICE,
    rate: Optional[str] = None
) -> bool:
    """Generate audio for a text snippet using Edge-TTS and save to output_path."""
    clean_str = text.strip()
    if not clean_str:
        return False
        
    temp_path = output_path.with_suffix('.tmp.mp3')
    try:
        kwargs = {"voice": voice}
        if rate and rate not in ["+0%", "0%"]:
            kwargs["rate"] = rate
            
        communicate = edge_tts.Communicate(clean_str, **kwargs)
        await communicate.save(str(temp_path))
        if temp_path.exists() and temp_path.stat().st_size > 0:
            temp_path.replace(output_path)
            return True
        return False
    except Exception as e:
        if temp_path.exists():
            temp_path.unlink()
        print(f"TTS synthesis error: {e}")
        raise e

async def get_or_synthesize_audio(
    text: str,
    voice: str = DEFAULT_VOICE,
    rate: Optional[str] = None
) -> Optional[Path]:
    """Return cached audio path if available, or synthesize and cache it."""
    clean_str = text.strip()
    if not clean_str:
        return None
        
    cache_file = get_cache_filename(clean_str, voice, rate)
    if cache_file.exists() and cache_file.stat().st_size > 0:
        return cache_file
        
    success = await synthesize_text_to_file(clean_str, cache_file, voice, rate)
    if success:
        return cache_file
    return None
