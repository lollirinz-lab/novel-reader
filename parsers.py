import os
import re
import json
import chardet
from typing import List, Dict, Any
from pathlib import Path
from bs4 import BeautifulSoup

def clean_text(text: str) -> str:
    """Clean redundant spaces, excess dots, and normalize line breaks."""
    text = re.sub(r'\r\n|\r', '\n', text)
    text = re.sub(r'[ \t]+', ' ', text)
    # Normalize excessive periods or dashes that cause edge-tts to pause too long
    text = re.sub(r'[\.]{3,}', '…', text)
    text = re.sub(r'[—\-]{2,}', ' ', text)
    
    # Remove lines that are just symbols or page numbers or images
    lines = []
    for line in text.split('\n'):
        s = line.strip()
        if re.match(r'^(page\s*\d+|-\s*\d+\s*-|\d+\s*/\s*\d+)$', s, re.IGNORECASE):
            continue
        if re.match(r'^!\[.*?\]\(.*?\)$', s):
            continue
        lines.append(s)
    return '\n'.join([l for l in lines if l])

def split_into_paragraphs(content: str, min_len: int = 80) -> List[str]:
    """Group lines into natural, flowing narrative paragraphs so audio doesn't pause after every short sentence."""
    raw_paras = [p.strip() for p in content.split('\n') if p.strip()]
    grouped = []
    curr = ''
    for line in raw_paras:
        # Clean excessive dots that trigger artificial long pauses
        line = re.sub(r'[\.]{3,}', '…', line)
        line = re.sub(r'[—\-]{2,}', ' ', line)
        
        if not curr:
            curr = line
        else:
            # If current sentence is short, or is an open dialogue quote, or ends with incomplete clause, merge
            is_dialogue_open = (curr.count('“') > curr.count('”')) or (curr.count('"') % 2 == 1)
            ends_with_ellipsis = curr.endswith(('…', '...', '—', '-', '’'))
            
            if len(curr) < min_len or is_dialogue_open or ends_with_ellipsis:
                curr += ' ' + line
            else:
                grouped.append(curr)
                curr = line
    if curr:
        grouped.append(curr)
    return grouped

def detect_chapters_from_text(full_text: str, default_title: str = "นิยาย") -> List[Dict[str, Any]]:
    """Detect chapters by headings like บทที่ 1, ตอนที่ 1, Chapter 1, or split by chunks."""
    lines = full_text.split('\n')
    chapter_pattern = re.compile(
        r'^\s*(บทที่\s*\d+.*|ตอนที่\s*\d+.*|ตอน\s*\d+.*|บท\s*\d+.*|Chapter\s*\d+.*|第[0-9一二三四五六七八九十百千万]+[章回节].*|\d+[\.\s\-]+[\u0E00-\u0E7F\w]{2,30})',
        re.IGNORECASE
    )
    
    chapters = []
    current_title = "บทนำ"
    current_lines = []
    
    for line in lines:
        stripped = line.strip()
        if chapter_pattern.match(stripped) and len(stripped) < 80:
            if current_lines:
                ch_text = '\n'.join(current_lines).strip()
                if ch_text:
                    ch_id = len(chapters) + 1
                    chapters.append({
                        "id": ch_id,
                        "chapter_id": ch_id,
                        "title": current_title,
                        "content": ch_text,
                        "paragraphs": split_into_paragraphs(ch_text)
                    })
                current_lines = []
            current_title = stripped
        else:
            current_lines.append(line)
            
    if current_lines:
        ch_text = '\n'.join(current_lines).strip()
        if ch_text:
            ch_id = len(chapters) + 1
            chapters.append({
                "id": ch_id,
                "chapter_id": ch_id,
                "title": current_title if chapters else (default_title or "เนื้อเรื่อง"),
                "content": ch_text,
                "paragraphs": split_into_paragraphs(ch_text)
            })
            
    # If no chapters or only 1 chapter detected, and text is long enough, split into readable chapters
    all_paras = []
    if chapters:
        for ch in chapters:
            all_paras.extend(ch.get("paragraphs", []))
    else:
        all_paras = split_into_paragraphs(full_text)

    if (len(chapters) <= 1) and len(all_paras) > 20:
        chunk_size = 25  # ~25 paragraphs per chapter (around 5-8 minutes per chapter)
        new_chapters = []
        for i in range(0, len(all_paras), chunk_size):
            chunk = all_paras[i:i+chunk_size]
            part_num = (i // chunk_size) + 1
            new_chapters.append({
                "id": part_num,
                "chapter_id": part_num,
                "title": f"ตอนที่ {part_num}",
                "content": '\n'.join(chunk),
                "paragraphs": chunk
            })
        return new_chapters
        
    return chapters if chapters else [{
        "id": 1,
        "chapter_id": 1,
        "title": default_title,
        "content": full_text,
        "paragraphs": split_into_paragraphs(full_text)
    }]

def parse_txt(file_path: str) -> Dict[str, Any]:
    with open(file_path, 'rb') as f:
        raw_bytes = f.read()
    
    # Try encodings: utf-8, utf-8-sig, cp874 / tis-620
    text = None
    for enc in ['utf-8', 'utf-8-sig', 'cp874', 'tis-620', 'utf-16']:
        try:
            text = raw_bytes.decode(enc)
            break
        except UnicodeDecodeError:
            continue
            
    if text is None:
        detected = chardet.detect(raw_bytes[:10000])
        enc = detected.get('encoding', 'utf-8') or 'utf-8'
        text = raw_bytes.decode(enc, errors='replace')
        
    text = clean_text(text)
    title = Path(file_path).stem
    chapters = detect_chapters_from_text(text, default_title=title)
    return {
        "title": title,
        "total_chapters": len(chapters),
        "chapters": chapters
    }

def parse_epub(file_path: str) -> Dict[str, Any]:
    import ebooklib
    from ebooklib import epub
    
    book = epub.read_epub(file_path)
    title = book.get_metadata('DC', 'title')
    title_str = title[0][0] if title else Path(file_path).stem
    
    chapters = []
    ch_id = 1
    
    for item in book.get_items():
        if item.get_type() == ebooklib.ITEM_DOCUMENT:
            content_html = item.get_content().decode('utf-8', errors='ignore')
            soup = BeautifulSoup(content_html, 'html.parser')
            
            # Extract header if present
            h_tag = soup.find(['h1', 'h2', 'h3'])
            ch_title = h_tag.get_text().strip() if h_tag else f"บทที่ {ch_id}"
            
            # Extract text
            text_parts = []
            for elem in soup.find_all(['p', 'div', 'h1', 'h2', 'h3', 'h4']):
                t = elem.get_text().strip()
                if t and t not in text_parts:
                    text_parts.append(t)
            
            cleaned = '\n'.join(text_parts).strip()
            paras = split_into_paragraphs(cleaned)
            
            # Only consider document items that have substantial text (> 50 chars)
            if len(cleaned) > 50:
                chapters.append({
                    "id": ch_id,
                    "chapter_id": ch_id,
                    "title": ch_title if len(ch_title) < 80 else f"บทที่ {ch_id}",
                    "content": cleaned,
                    "paragraphs": paras
                })
                ch_id += 1
                
    if not chapters:
        # Fallback to single chapter
        chapters = [{
            "id": 1,
            "chapter_id": 1,
            "title": title_str,
            "content": "ไม่พบเนื้อหาในไฟล์ EPUB",
            "paragraphs": ["ไม่พบเนื้อหาในไฟล์ EPUB"]
        }]
        
    return {
        "title": title_str,
        "total_chapters": len(chapters),
        "chapters": chapters
    }

def parse_pdf(file_path: str) -> Dict[str, Any]:
    from pypdf import PdfReader
    
    reader = PdfReader(file_path)
    title = Path(file_path).stem
    pages_text = []
    
    for idx, page in enumerate(reader.pages):
        t = page.extract_text()
        if t:
            pages_text.append(clean_text(t))
            
    full_text = '\n\n'.join(pages_text).strip()
    if len(full_text) < 50:
        raise ValueError("ไฟล์ PDF นี้เป็นรูปภาพสแกน (ไม่มีข้อความตัวอักษรให้อ่าน) กรุณาใช้ไฟล์ PDF ที่เป็นตัวอักษร, .EPUB, .TXT หรือ .DOCX ค่ะ")
        
    chapters = detect_chapters_from_text(full_text, default_title=title)
    
    return {
        "title": title,
        "total_chapters": len(chapters),
        "chapters": chapters
    }

def parse_docx(file_path: str) -> Dict[str, Any]:
    from docx import Document
    
    doc = Document(file_path)
    title = Path(file_path).stem
    
    chapters = []
    current_title = "บทนำ"
    current_paras = []
    
    for p in doc.paragraphs:
        txt = p.text.strip()
        if not txt:
            continue
            
        is_heading = p.style.name.startswith('Heading') or re.match(r'^(บทที่|ตอนที่|Chapter)\s*\d+', txt, re.IGNORECASE)
        if is_heading:
            if current_paras:
                ch_text = '\n'.join(current_paras)
                ch_id = len(chapters) + 1
                chapters.append({
                    "id": ch_id,
                    "chapter_id": ch_id,
                    "title": current_title,
                    "content": ch_text,
                    "paragraphs": current_paras
                })
                current_paras = []
            current_title = txt
        else:
            current_paras.append(txt)
            
    if current_paras:
        ch_text = '\n'.join(current_paras)
        ch_id = len(chapters) + 1
        chapters.append({
            "id": ch_id,
            "chapter_id": ch_id,
            "title": current_title if chapters else title,
            "content": ch_text,
            "paragraphs": current_paras
        })
        
    all_paras = []
    for ch in chapters:
        all_paras.extend(ch.get("paragraphs", []))

    if (len(chapters) <= 1) and len(all_paras) > 20:
        chunk_size = 25
        new_chapters = []
        for i in range(0, len(all_paras), chunk_size):
            chunk = all_paras[i:i+chunk_size]
            part_num = (i // chunk_size) + 1
            new_chapters.append({
                "id": part_num,
                "chapter_id": part_num,
                "title": f"ตอนที่ {part_num}",
                "content": '\n'.join(chunk),
                "paragraphs": chunk
            })
        return {
            "title": title,
            "total_chapters": len(new_chapters),
            "chapters": new_chapters
        }

    if not chapters:
        chapters = [{
            "id": 1,
            "chapter_id": 1,
            "title": title,
            "content": "",
            "paragraphs": []
        }]
        
    return {
        "title": title,
        "total_chapters": len(chapters),
        "chapters": chapters
    }

def parse_file(file_path: str) -> Dict[str, Any]:
    """Dispatcher for any supported file format."""
    ext = Path(file_path).suffix.lower()
    if ext == '.txt':
        return parse_txt(file_path)
    elif ext == '.epub':
        return parse_epub(file_path)
    elif ext == '.pdf':
        return parse_pdf(file_path)
    elif ext in ['.docx', '.doc']:
        try:
            return parse_docx(file_path)
        except Exception:
            # Fallback to plain text or raw extract
            return parse_txt(file_path)
    elif ext == '.md':
        return parse_txt(file_path)
    else:
        raise ValueError(f"ไม่รองรับไฟล์นามสกุล: {ext}")
