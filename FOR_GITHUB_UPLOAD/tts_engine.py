import os
import re
import hashlib
import asyncio
from pathlib import Path
from typing import Optional
import edge_tts

CACHE_DIR = Path(__file__).parent / "audio_cache"
CACHE_DIR.mkdir(exist_ok=True, parents=True)

DEFAULT_VOICE = "th-TH-PremwadeeNeural"

def prepare_text_for_speech(text: str) -> str:
    """
    Format text for natural Thai novel reading cadence:
    1. Replace spaces between Thai words with ', ' so the narrator takes a natural brief pause.
    2. Strip trailing dots, commas, or dashes at the end of paragraphs to eliminate trailing silence.
    """
    clean_str = text.strip()
    if not clean_str:
        return ""
        
    # Replace spaces between Thai characters with comma for a natural clause breath pause
    t = re.sub(r'(?<=[\u0E00-\u0E7F])\s+(?=[\u0E00-\u0E7F])', ', ', clean_str)
    
    # Normalize multiple dots or ellipsis to a short comma pause if followed by text
    t = re.sub(r'[\.]{2,}', ', ', t)
    t = re.sub(r'…+', ', ', t)
    
    # Remove trailing periods, commas, ellipses, dashes at the very end of the paragraph
    # so Edge-TTS doesn't generate 500ms trailing dead-air silence before the next paragraph!
    t = re.sub(r'[\.\,\…\—\-\s]+$', '', t)
    
    return t

def get_cache_filename(text: str, voice: str = DEFAULT_VOICE, rate: Optional[str] = None) -> Path:
    # Use formatted text for the cache key so new natural cadence is recognized
    spoken_text = prepare_text_for_speech(text)
    key = f"v3::{voice}::{rate or 'default'}::{spoken_text}"
    h = hashlib.sha256(key.encode('utf-8')).hexdigest()
    return CACHE_DIR / f"{h}.mp3"

async def synthesize_text_to_file(
    text: str,
    output_path: Path,
    voice: str = DEFAULT_VOICE,
    rate: Optional[str] = None
) -> bool:
    """Generate audio for a text snippet using Edge-TTS and save to output_path."""
    spoken_text = prepare_text_for_speech(text)
    if not spoken_text:
        return False
        
    temp_path = output_path.with_suffix('.tmp.mp3')
    try:
        kwargs = {"voice": voice}
        if rate and rate not in ["+0%", "0%"]:
            kwargs["rate"] = rate
            
        communicate = edge_tts.Communicate(spoken_text, **kwargs)
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
