import os
import re
import json
import uuid
import socket
import asyncio
from pathlib import Path
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from parsers import parse_file, split_into_paragraphs, clean_text
from tts_engine import get_or_synthesize_audio, DEFAULT_VOICE

APP_DIR = Path(__file__).parent.resolve()
BASE_WORKSPACE = APP_DIR.parent.resolve()
UPLOADS_DIR = APP_DIR / "uploads"
AUDIO_CACHE_DIR = APP_DIR / "audio_cache"
STATIC_DIR = APP_DIR / "static"

UPLOADS_DIR.mkdir(exist_ok=True, parents=True)
AUDIO_CACHE_DIR.mkdir(exist_ok=True, parents=True)
STATIC_DIR.mkdir(exist_ok=True, parents=True)

LIBRARY_FILE = UPLOADS_DIR / "library.json"
BOOKMARKS_FILE = UPLOADS_DIR / "bookmarks.json"

if not LIBRARY_FILE.exists():
    with open(LIBRARY_FILE, "w", encoding="utf-8") as f:
        json.dump([], f, ensure_ascii=False, indent=2)

if not BOOKMARKS_FILE.exists():
    with open(BOOKMARKS_FILE, "w", encoding="utf-8") as f:
        json.dump({}, f, ensure_ascii=False, indent=2)

app = FastAPI(title="PWA Novel Reader - เสียงหวานอ่านเพลิน")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_lan_ip() -> str:
    """Find primary local LAN IP address for phone connection."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        # Doesn't need to actually be reachable
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"

def load_library() -> List[Dict[str, Any]]:
    if LIBRARY_FILE.exists():
        try:
            with open(LIBRARY_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []

def save_library(data: List[Dict[str, Any]]):
    with open(LIBRARY_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def load_bookmarks() -> Dict[str, Any]:
    if BOOKMARKS_FILE.exists():
        try:
            with open(BOOKMARKS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_bookmark(novel_id: str, chapter_id: int, paragraph_idx: int):
    bm = load_bookmarks()
    bm[novel_id] = {
        "chapter_id": chapter_id,
        "paragraph_idx": paragraph_idx
    }
    with open(BOOKMARKS_FILE, "w", encoding="utf-8") as f:
        json.dump(bm, f, ensure_ascii=False, indent=2)

def scan_harvested_novels() -> List[Dict[str, Any]]:
    """Automatically discover downloaded novel folders in workspace directory."""
    novels = []
    try:
        for entry in os.scandir(BASE_WORKSPACE):
            if entry.is_dir() and not entry.name.startswith(('.', '_')) and entry.name != 'novel_reader_app':
                # Check if it has harvested_index.json or chapter folders
                index_path = Path(entry.path) / "harvested_index.json"
                total_chapters = 0
                if index_path.exists():
                    try:
                        with open(index_path, "r", encoding="utf-8") as f:
                            data = json.load(f)
                            total_chapters = len(data)
                    except Exception:
                        pass
                
                # Count folders starting with 'บทที่'
                if total_chapters == 0:
                    ch_dirs = [d for d in os.scandir(entry.path) if d.is_dir() and d.name.startswith("บทที่")]
                    total_chapters = len(ch_dirs)
                    
                if total_chapters > 0:
                    novels.append({
                        "id": f"harvested_{entry.name}",
                        "title": entry.name,
                        "type": "harvested",
                        "total_chapters": total_chapters,
                        "folder_path": entry.path
                    })
    except Exception as e:
        print(f"Error scanning harvested novels: {e}")
    return novels

@app.get("/api/info")
async def get_info():
    lan_ip = get_lan_ip()
    port = 8000
    return {
        "local_url": f"http://localhost:{port}",
        "network_url": f"http://{lan_ip}:{port}",
        "ip": lan_ip,
        "port": port,
        "default_voice": DEFAULT_VOICE,
        "available_voices": [
            {"id": "th-TH-PremwadeeNeural", "name": "เปรมวดี (เสียงผู้หญิง - นุ่มนวล ลื่นหู)", "gender": "Female"},
            {"id": "th-TH-NiwatNeural", "name": "นิวัฒน์ (เสียงผู้ชาย - อบอุ่น ทรงพลัง)", "gender": "Male"}
        ]
    }

@app.get("/api/novels")
async def list_novels():
    uploaded = load_library()
    harvested = scan_harvested_novels()
    bookmarks = load_bookmarks()
    
    # Merge bookmark status
    all_novels = []
    for n in uploaded:
        item = dict(n)
        item["bookmark"] = bookmarks.get(n["id"], None)
        all_novels.append(item)
        
    for h in harvested:
        item = dict(h)
        item["bookmark"] = bookmarks.get(h["id"], None)
        all_novels.append(item)
        
    return all_novels

@app.post("/api/upload")
async def upload_novel(file: UploadFile = File(...)):
    filename = file.filename
    ext = Path(filename).suffix.lower()
    if ext not in ['.txt', '.epub', '.pdf', '.docx', '.doc', '.md']:
        raise HTTPException(status_code=400, detail=f"ไม่รองรับไฟล์สกุล {ext} (รองรับ: .txt, .epub, .pdf, .docx, .doc)")
        
    novel_id = f"novel_{uuid.uuid4().hex[:10]}"
    saved_file = UPLOADS_DIR / f"{novel_id}_{filename}"
    
    with open(saved_file, "wb") as f:
        content = await file.read()
        f.write(content)
        
    try:
        parsed_data = parse_file(str(saved_file))
    except Exception as e:
        if saved_file.exists():
            saved_file.unlink()
        raise HTTPException(status_code=500, detail=f"เกิดข้อผิดพลาดในการแยกเนื้อหา: {str(e)}")
        
    # Save parsed novel data to JSON
    novel_data_file = UPLOADS_DIR / f"{novel_id}.json"
    with open(novel_data_file, "w", encoding="utf-8") as f:
        json.dump(parsed_data, f, ensure_ascii=False, indent=2)
        
    # Update library
    lib = load_library()
    entry = {
        "id": novel_id,
        "title": parsed_data.get("title", Path(filename).stem),
        "filename": filename,
        "type": "uploaded",
        "file_ext": ext,
        "total_chapters": parsed_data.get("total_chapters", len(parsed_data.get("chapters", []))),
        "data_file": str(novel_data_file.name)
    }
    lib.insert(0, entry)
    save_library(lib)
    
    return entry

@app.delete("/api/novels/{novel_id}")
async def delete_novel(novel_id: str):
    lib = load_library()
    updated = [n for n in lib if n["id"] != novel_id]
    if len(updated) != len(lib):
        save_library(updated)
        data_file = UPLOADS_DIR / f"{novel_id}.json"
        if data_file.exists():
            data_file.unlink()
        return {"status": "deleted"}
    raise HTTPException(status_code=404, detail="Novel not found")

@app.get("/api/novels/{novel_id}")
async def get_novel_details(novel_id: str):
    if novel_id.startswith("harvested_"):
        folder_name = novel_id.replace("harvested_", "")
        folder_path = BASE_WORKSPACE / folder_name
        if not folder_path.exists():
            raise HTTPException(status_code=404, detail="Novel folder not found")
            
        # Discover all chapter folders starting with บทที่
        chapter_entries = []
        for d in os.scandir(folder_path):
            if d.is_dir() and d.name.startswith("บทที่"):
                m = re.search(r'บทที่\s*(\d+)', d.name)
                num = int(m.group(1)) if m else 999999
                chapter_entries.append((num, d.name))
                
        chapter_entries.sort(key=lambda x: x[0])
        chapters_list = [{"id": num, "title": name} for num, name in chapter_entries]
                
        return {
            "id": novel_id,
            "title": folder_name,
            "type": "harvested",
            "total_chapters": len(chapters_list),
            "chapters": chapters_list
        }
    else:
        novel_data_file = UPLOADS_DIR / f"{novel_id}.json"
        if not novel_data_file.exists():
            raise HTTPException(status_code=404, detail="Novel data not found")
        with open(novel_data_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        chapters_summary = [
            {"id": ch["id"], "title": ch["title"]}
            for ch in data.get("chapters", [])
        ]
        return {
            "id": novel_id,
            "title": data.get("title", "นิยาย"),
            "type": "uploaded",
            "total_chapters": len(chapters_summary),
            "chapters": chapters_summary
        }

@app.get("/api/novels/{novel_id}/chapter/{chapter_id}")
async def get_chapter(novel_id: str, chapter_id: str):
    if novel_id.startswith("harvested_"):
        folder_name = novel_id.replace("harvested_", "")
        folder_path = BASE_WORKSPACE / folder_name
        
        target_folder = None
        target_title = None
        
        # Match by integer chapter number or folder name
        try:
            target_num = int(chapter_id)
        except ValueError:
            target_num = None
            
        for d in os.scandir(folder_path):
            if d.is_dir() and d.name.startswith("บทที่"):
                m = re.search(r'บทที่\s*(\d+)', d.name)
                num = int(m.group(1)) if m else None
                if target_num is not None and num == target_num:
                    target_folder = Path(d.path)
                    target_title = d.name
                    break
                elif d.name == chapter_id or str(num) == str(chapter_id):
                    target_folder = Path(d.path)
                    target_title = d.name
                    break
                    
        if not target_folder or not target_folder.exists():
            raise HTTPException(status_code=404, detail=f"Chapter {chapter_id} not found")
            
        content_md = target_folder / "content.md"
        if not content_md.exists():
            raise HTTPException(status_code=404, detail="Chapter content.md not found")
            
        with open(content_md, "r", encoding="utf-8") as f:
            raw_text = f.read()
            
        # Clean markdown headers, images, and extra dashes
        raw_lines = []
        for line in raw_text.split('\n'):
            s = line.strip()
            if s.startswith('#') or s in ['- - -', '---', '***']:
                continue
            # Filter markdown images like ![Page 1](images/page_01.png)
            if re.match(r'^!\[.*?\]\(.*?\)$', s):
                continue
            # Filter title repetition like "01 :  ฝันร้ายกลายเป็นจริง" if at top
            if re.match(r'^\d+\s*:\s*.*$', s) and not raw_lines:
                continue
            if s:
                raw_lines.append(s)
                
        paras = split_into_paragraphs('\n'.join(raw_lines), min_len=80)
        return {
            "novel_id": novel_id,
            "chapter_id": chapter_id,
            "title": target_title or f"บทที่ {chapter_id}",
            "paragraphs": paras
        }
    else:
        novel_data_file = UPLOADS_DIR / f"{novel_id}.json"
        if not novel_data_file.exists():
            raise HTTPException(status_code=404, detail="Novel data not found")
        with open(novel_data_file, "r", encoding="utf-8") as f:
            data = json.load(f)
            
        for ch in data.get("chapters", []):
            if str(ch["id"]) == str(chapter_id):
                return {
                    "novel_id": novel_id,
                    "chapter_id": chapter_id,
                    "title": ch.get("title", f"บทที่ {chapter_id}"),
                    "paragraphs": ch.get("paragraphs", [])
                }
        raise HTTPException(status_code=404, detail="Chapter not found")

class BookmarkRequest(BaseModel):
    novel_id: str
    chapter_id: Any
    paragraph_idx: int

@app.post("/api/bookmark")
async def set_bookmark(req: BookmarkRequest):
    save_bookmark(req.novel_id, req.chapter_id, req.paragraph_idx)
    return {"status": "saved"}

@app.get("/api/tts")
async def tts_endpoint(text: str, voice: Optional[str] = DEFAULT_VOICE, rate: Optional[str] = None):
    """Synthesize or fetch cached audio for paragraph."""
    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="Text is required")
        
    try:
        audio_file = await get_or_synthesize_audio(text, voice=voice or DEFAULT_VOICE, rate=rate)
        if not audio_file or not audio_file.exists():
            raise HTTPException(status_code=500, detail="Failed to synthesize audio")
        return FileResponse(
            path=str(audio_file),
            media_type="audio/mpeg",
            headers={
                "Cache-Control": "public, max-age=31536000, immutable",
                "Accept-Ranges": "bytes"
            }
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class PrefetchRequest(BaseModel):
    paragraphs: List[str]
    voice: Optional[str] = DEFAULT_VOICE
    rate: Optional[str] = None

@app.post("/api/tts/prefetch")
async def prefetch_tts(req: PrefetchRequest, background_tasks: BackgroundTasks):
    """Background task to pre-generate audio for next upcoming paragraphs."""
    async def run_prefetch():
        for p in req.paragraphs[:5]:  # prefetch next 5 paragraphs
            if p and p.strip():
                try:
                    await get_or_synthesize_audio(p, voice=req.voice or DEFAULT_VOICE, rate=req.rate)
                except Exception as e:
                    print(f"Prefetch failed for paragraph: {e}")
                    
    background_tasks.add_task(run_prefetch)
    return {"status": "prefetching", "count": min(len(req.paragraphs), 5)}

@app.get("/api/cache/stats")
async def get_cache_stats():
    total_files = 0
    total_bytes = 0
    if AUDIO_CACHE_DIR.exists():
        for p in AUDIO_CACHE_DIR.glob("*.mp3"):
            try:
                total_bytes += p.stat().st_size
                total_files += 1
            except Exception:
                pass
    size_mb = round(total_bytes / (1024 * 1024), 2)
    return {"files": total_files, "bytes": total_bytes, "size_mb": size_mb}

@app.post("/api/cache/clear")
async def clear_cache():
    deleted = 0
    freed_bytes = 0
    if AUDIO_CACHE_DIR.exists():
        for p in AUDIO_CACHE_DIR.glob("*.mp3"):
            try:
                freed_bytes += p.stat().st_size
                p.unlink()
                deleted += 1
            except Exception:
                pass
    return {
        "status": "cleared",
        "deleted_files": deleted,
        "freed_mb": round(freed_bytes / (1024 * 1024), 2)
    }

# Mount static folder
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/")
async def root():
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return HTMLResponse("<h1>Novel Reader PWA Loading...</h1>")
