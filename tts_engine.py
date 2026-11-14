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

# Standard minimal playable silent MP3 frame (~0.8s) for unpronounceable symbols / scene breaks
SILENT_FRAME = b'\xff\xfb\x90\x64' + b'\x00' * 413
SILENT_MP3 = SILENT_FRAME * 30

# Strict single-concurrency lock to prevent Microsoft Edge-TTS connection drops
TTS_SEMAPHORE = asyncio.Semaphore(1)
LAST_TTS_TIMESTAMP = 0.0

def prepare_text_for_speech(text: str) -> str:
    """
    Format text for natural Thai novel reading cadence:
    1. Strip unpronounceable characters or dividers.
    2. Replace spaces between Thai words with ', ' for natural breathing pauses.
    3. Strip trailing punctuation so narrator doesn't add trailing dead-air.
    """
    clean_str = text.strip()
    if not clean_str:
        return ""
        
    # Check if text contains any pronounceable letters or digits
    if not re.search(r'[\u0E00-\u0E7Fa-zA-Z0-9]', clean_str):
        return ""
        
    # Replace decorative symbols, scene breaks, and dividers with spaces
    t = re.sub(r'[*#_~\|\^=\+]+', ' ', clean_str)
    
    # Normalize Chinese/special punctuation
    t = t.replace('，', ', ').replace('。', '. ').replace('！', '! ').replace('？', '? ')
    t = t.replace('：', ': ').replace('；', '; ').replace('、', ', ').replace('～', ' ')
    t = re.sub(r'[「」『』【】《》〈〉\[\]\{\}]', ' ', t)
    
    # Replace spaces between Thai characters with comma for a natural clause breath pause
    t = re.sub(r'(?<=[\u0E00-\u0E7F])\s+(?=[\u0E00-\u0E7F])', ', ', t)
    
    # Normalize multiple dots or ellipsis
    t = re.sub(r'[\.]{2,}', ', ', t)
    t = re.sub(r'…+', ', ', t)
    
    # Remove trailing periods, commas, ellipses, dashes at paragraph end
    t = re.sub(r'[\.\,\…\—\-\s\?!]+$', '', t)
    t = re.sub(r'^[,\.\s\-]+', '', t)
    
    if not re.search(r'[\u0E00-\u0E7Fa-zA-Z0-9]', t):
        return ""
        
    return t.strip()

def get_cache_filename(text: str, voice: str = DEFAULT_VOICE, rate: Optional[str] = None) -> Path:
    spoken_text = prepare_text_for_speech(text)
    key = f"v4::{voice}::{rate or 'default'}::{spoken_text}"
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
    
    # If text has no pronounceable words (e.g. "...", "---", "***"), write silent MP3 pause
    if not spoken_text:
        output_path.write_bytes(SILENT_MP3)
        return True
        
    temp_path = output_path.with_suffix('.tmp.mp3')
    global LAST_TTS_TIMESTAMP
    
    async with TTS_SEMAPHORE:
        # Prevent rapid-fire burst requests that trigger Microsoft anti-abuse throttling
        try:
            loop = asyncio.get_running_loop()
            now = loop.time()
            elapsed = now - LAST_TTS_TIMESTAMP
            if elapsed < 0.4:
                await asyncio.sleep(0.4 - elapsed)
        except Exception:
            pass

        for attempt in range(1, 4):
            try:
                kwargs = {"voice": voice}
                if rate and rate not in ["+0%", "0%"]:
                    kwargs["rate"] = rate
                    
                communicate = edge_tts.Communicate(spoken_text, **kwargs)
                await communicate.save(str(temp_path))
                if temp_path.exists() and temp_path.stat().st_size > 0:
                    temp_path.replace(output_path)
                    try:
                        LAST_TTS_TIMESTAMP = asyncio.get_running_loop().time()
                    except Exception:
                        pass
                    return True
                raise RuntimeError("Empty audio output from Edge-TTS")
            except Exception as e:
                if temp_path.exists():
                    temp_path.unlink()
                if attempt < 3:
                    print(f"Edge-TTS attempt {attempt} failed for '{spoken_text[:30]}...': {e}. Retrying in {0.6 * attempt}s...")
                    await asyncio.sleep(0.6 * attempt)
                else:
                    print(f"Primary voice '{voice}' failed after 3 attempts: {e}. Trying fallback voice...")
                    # Seamless fallback: if primary voice hits safety filter or rate-limit, switch to other Thai voice
                    fallback_voice = "th-TH-NiwatNeural" if voice != "th-TH-NiwatNeural" else "th-TH-PremwadeeNeural"
                    try:
                        fb_kwargs = {"voice": fallback_voice}
                        if rate and rate not in ["+0%", "0%"]:
                            fb_kwargs["rate"] = rate
                        fb_comm = edge_tts.Communicate(spoken_text, **fb_kwargs)
                        await fb_comm.save(str(temp_path))
                        if temp_path.exists() and temp_path.stat().st_size > 0:
                            temp_path.replace(output_path)
                            print(f"Fallback voice '{fallback_voice}' successfully saved audio to prevent silence!")
                            try:
                                LAST_TTS_TIMESTAMP = asyncio.get_running_loop().time()
                            except Exception:
                                pass
                            return True
                    except Exception as fb_err:
                        print(f"Fallback voice '{fallback_voice}' also failed: {fb_err}")
                        if temp_path.exists():
                            temp_path.unlink()
                        return False

async def get_or_synthesize_audio(
    text: str,
    voice: str = DEFAULT_VOICE,
    rate: Optional[str] = None
) -> Optional[Path]:
    """Return cached audio path if available, or synthesize and cache it."""
    clean_str = text.strip()
    if not clean_str:
        cache_file = CACHE_DIR / "silence_empty.mp3"
        if not cache_file.exists():
            cache_file.write_bytes(SILENT_MP3)
        return cache_file
        
    cache_file = get_cache_filename(clean_str, voice, rate)
    if cache_file.exists() and cache_file.stat().st_size > 0:
        return cache_file
        
    success = await synthesize_text_to_file(clean_str, cache_file, voice, rate)
    if success:
        return cache_file
    return None
