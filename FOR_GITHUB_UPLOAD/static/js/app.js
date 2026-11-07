// Novel Reader PWA - Frontend Application Logic with In-Memory Blob Preloading & Auto-Recovery
class NovelReaderApp {
  constructor() {
    this.novels = [];
    this.currentNovel = null;
    this.currentChapter = null;
    this.currentParagraphIdx = 0;
    this.paragraphs = [];
    this.isPlaying = false;

    // Single persistent audio player (100% compliant with iOS Safari & Android background playback)
    this.audio = new Audio();
    this.audio.preload = 'auto';
    
    // In-memory audio Blob cache (pre-downloads next paragraphs in RAM for 0ms latency)
    this.blobCache = new Map();
    this.loadingBlobs = new Set();
    this.watchdogTimer = null;
    this.networkInfo = null;
    
    // User preferences
    this.voice = localStorage.getItem('novel_voice') || 'th-TH-PremwadeeNeural';
    this.speed = parseFloat(localStorage.getItem('novel_speed') || '1.0');
    this.fontSize = parseInt(localStorage.getItem('novel_font_size') || '18');
    this.theme = localStorage.getItem('novel_theme') || 'theme-sepia';
    this.sleepTimer = null;
    this.sleepRemaining = 0;
    this.sleepInterval = null;
    this.deferredPrompt = null;
    this.autoResume = localStorage.getItem('novel_auto_resume') === 'true';

    this.initElements();
    this.applyTheme(this.theme);
    this.applyFontSize(this.fontSize);
    this.setupAudioEvents();
    this.setupEventListeners();
    this.registerServiceWorker();
    this.fetchInfo();
    this.loadLibrary(true);
  }

  initElements() {
    // Views
    this.viewLibrary = document.getElementById('view-library');
    this.viewReader = document.getElementById('view-reader');

    // Continue Listening Card
    this.continueCard = document.getElementById('continue-listening-card');
    this.continueTitle = document.getElementById('continue-novel-title');
    this.continueInfo = document.getElementById('continue-chapter-info');
    this.btnContinuePlay = document.getElementById('btn-continue-play');
    this.toggleAutoResume = document.getElementById('toggle-auto-resume');

    // Header & Buttons
    this.btnBack = document.getElementById('btn-back');
    this.btnMobile = document.getElementById('btn-mobile');
    this.btnSettings = document.getElementById('btn-settings');
    this.btnChapters = document.getElementById('btn-chapters');
    this.fileUploadInput = document.getElementById('file-upload-input');
    this.uploadCard = document.getElementById('upload-card');
    this.novelGrid = document.getElementById('novel-grid');

    // Reader UI
    this.readerNovelTitle = document.getElementById('reader-novel-title');
    this.readerChapterTitle = document.getElementById('reader-chapter-title');
    this.readerContentBox = document.getElementById('reader-content-box');
    this.btnPrevChapter = document.getElementById('btn-prev-chapter');
    this.btnNextChapter = document.getElementById('btn-next-chapter');

    // Player Elements
    this.bottomPlayer = document.getElementById('bottom-player');
    this.playerTrackTitle = document.getElementById('player-track-title');
    this.playerTrackSubtitle = document.getElementById('player-track-subtitle');
    this.playerProgressBar = document.getElementById('player-progress-bar');
    this.playerProgressContainer = document.getElementById('player-progress-container');
    this.btnPlay = document.getElementById('btn-play');
    this.btnPlayIcon = document.getElementById('btn-play-icon');
    this.btnRewind = document.getElementById('btn-rewind');
    this.btnForward = document.getElementById('btn-forward');
    this.btnSpeed = document.getElementById('btn-speed');
    this.btnTimer = document.getElementById('btn-timer');

    // Modals
    this.modalOverlay = document.getElementById('modal-overlay');
    this.modalQr = document.getElementById('modal-qr');
    this.modalSettings = document.getElementById('modal-settings');
    this.modalChapters = document.getElementById('modal-chapters');
    this.modalTimer = document.getElementById('modal-timer');
    this.qrImage = document.getElementById('qr-image');
    this.qrLink = document.getElementById('qr-link');
    this.chapterListContainer = document.getElementById('chapter-list-container');
    this.selectVoice = document.getElementById('select-voice');
    this.pwaBanner = document.getElementById('install-banner');
    this.cacheSizeText = document.getElementById('cache-size-text');
    this.btnClearCache = document.getElementById('btn-clear-cache');
  }

  async fetchInfo() {
    try {
      const res = await fetch('/api/info');
      if (res.ok) {
        this.networkInfo = await res.json();
        this.updateQrModal();
      }
    } catch (e) {
      console.warn('Could not fetch server network info', e);
    }
  }

  async loadLibrary(isInitial = false) {
    try {
      const res = await fetch('/api/novels');
      if (res.ok) {
        this.novels = await res.json();
        this.renderLibrary();

        // If auto-resume enabled on initial app open, jump straight to reading
        if (isInitial && this.autoResume) {
          this.triggerAutoResume();
        }
      }
    } catch (e) {
      console.error('Failed to load library', e);
    }
  }

  triggerAutoResume() {
    try {
      const raw = localStorage.getItem('novel_last_read');
      if (!raw) return;
      const lastRead = JSON.parse(raw);
      if (lastRead && lastRead.novel_id) {
        this.openNovel(lastRead.novel_id, lastRead.chapter_id || 1, lastRead.paragraph_idx || 0, true);
      }
    } catch (e) {
      console.warn('Auto-resume failed:', e);
    }
  }

  renderLibrary() {
    if (!this.novelGrid) return;
    this.novelGrid.innerHTML = '';

    // Check localStorage bookmarks
    let localBookmarks = {};
    try {
      localBookmarks = JSON.parse(localStorage.getItem('novel_bookmarks') || '{}');
    } catch (e) {}

    // Update Continue Listening Hero Card
    try {
      const lastRead = JSON.parse(localStorage.getItem('novel_last_read') || 'null');
      if (lastRead && lastRead.novel_id && this.continueCard) {
        this.continueCard.style.display = 'flex';
        this.continueTitle.textContent = lastRead.novel_title || 'นิยายที่อ่านค้างไว้';
        const pText = (lastRead.paragraph_idx !== undefined && lastRead.paragraph_idx > 0)
          ? ` • ย่อหน้าที่ ${lastRead.paragraph_idx + 1}`
          : '';
        this.continueInfo.textContent = `${lastRead.chapter_title || ('ตอนที่ ' + lastRead.chapter_id)}${pText}`;
        this.btnContinuePlay.onclick = () => {
          this.openNovel(lastRead.novel_id, lastRead.chapter_id, lastRead.paragraph_idx || 0, true);
        };
      } else if (this.continueCard) {
        this.continueCard.style.display = 'none';
      }
    } catch (e) {
      if (this.continueCard) this.continueCard.style.display = 'none';
    }

    if (this.novels.length === 0) {
      this.novelGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
          <div style="font-size: 3rem; margin-bottom: 8px;">📚</div>
          <p style="font-family: var(--font-title); font-size: 1.1rem; font-weight: 600;">ยังไม่มีนิยายในคลัง</p>
          <p style="font-size: 0.85rem;">อัปโหลดไฟล์ PDF, EPUB, TXT, DOCX เพื่อเริ่มฟังเสียงอ่านสุดละมุนได้เลยค่ะ</p>
        </div>
      `;
      return;
    }

    this.novels.forEach(novel => {
      const card = document.createElement('div');
      card.className = 'novel-card';

      const typeBadge = novel.type === 'harvested'
        ? `<span class="novel-badge-type" style="background:#e0f2fe; color:#0369a1;">คลังในเครื่อง</span>`
        : `<span class="novel-badge-type">${novel.file_ext ? novel.file_ext.toUpperCase() : 'UPLOAD'}</span>`;

      const effectiveBookmark = novel.bookmark || localBookmarks[novel.id];
      let bookmarkText = '';
      if (effectiveBookmark) {
        const pText = (effectiveBookmark.paragraph_idx !== undefined && effectiveBookmark.paragraph_idx > 0)
          ? ` (ย่อหน้าที่ ${effectiveBookmark.paragraph_idx + 1})`
          : '';
        bookmarkText = `
          <div class="novel-bookmark-indicator">
            <span>🔖 อ่านค้างไว้: ตอนที่ ${effectiveBookmark.chapter_id}${pText}</span>
          </div>
        `;
      }

      card.innerHTML = `
        <div class="novel-card-header">
          <div class="novel-cover-icon">📖</div>
          <div class="novel-info">
            ${typeBadge}
            <h3 title="${novel.title}">${novel.title}</h3>
            <p class="novel-meta">รวม ${novel.total_chapters || 0} ตอน</p>
          </div>
        </div>
        ${bookmarkText}
      `;

      card.addEventListener('click', () => {
        const bm = effectiveBookmark;
        this.openNovel(novel.id, bm ? bm.chapter_id : 1, bm ? (bm.paragraph_idx || 0) : 0, false);
      });

      this.novelGrid.appendChild(card);
    });
  }

  async openNovel(novelId, chapterId = 1, startParaIdx = 0, autoPlay = false) {
    try {
      const res = await fetch(`/api/novels/${novelId}`);
      if (!res.ok) throw new Error('Failed to load novel');
      this.currentNovel = await res.json();

      // Show Reader View
      this.viewLibrary.classList.remove('active');
      this.viewReader.classList.add('active');
      this.btnBack.style.display = 'flex';
      this.btnChapters.style.display = 'flex';

      this.readerNovelTitle.textContent = this.currentNovel.title;

      await this.loadChapter(chapterId, startParaIdx);

      if (autoPlay && this.paragraphs && this.paragraphs.length > 0) {
        setTimeout(() => {
          this.playCurrent();
        }, 300);
      }
    } catch (e) {
      alert('ไม่สามารถเปิดนิยายได้: ' + e.message);
    }
  }

  async loadChapter(chapterId, startParaIdx = 0) {
    try {
      this.readerContentBox.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          <div class="spinner" style="border-top-color: var(--primary);"></div>
          <p style="margin-top: 10px;">กำลังโหลดเนื้อหาบทที่ ${chapterId}...</p>
        </div>
      `;

      const res = await fetch(`/api/novels/${this.currentNovel.id}/chapter/${chapterId}`);
      if (!res.ok) throw new Error('Chapter not found');
      this.currentChapter = await res.json();
      this.paragraphs = this.currentChapter.paragraphs || [];
      this.currentParagraphIdx = startParaIdx;

      // Clear memory blob cache for new chapter
      this.clearBlobCache();

      this.readerChapterTitle.textContent = this.currentChapter.title;
      this.renderParagraphs();
      this.updatePlayerInfo();

      // Save bookmark
      this.saveCurrentBookmark();

      // Preload first batch into memory blobs
      if (this.paragraphs.length > 0) {
        this.preloadBlob(this.currentParagraphIdx);
        this.preloadBlob(this.currentParagraphIdx + 1);
        this.preloadBlob(this.currentParagraphIdx + 2);
      }
    } catch (e) {
      this.readerContentBox.innerHTML = `<p style="color:red; text-align:center;">เกิดข้อผิดพลาด: ${e.message}</p>`;
    }
  }

  renderParagraphs() {
    this.readerContentBox.innerHTML = '';
    if (this.paragraphs.length === 0) {
      this.readerContentBox.innerHTML = `
        <div style="text-align: center; padding: 40px; color: var(--text-muted);">
          <div style="font-size: 2.5rem; margin-bottom: 8px;">⚠️</div>
          <p style="font-family: var(--font-title); font-size: 1.1rem; font-weight: 600;">ไม่พบเนื้อหาข้อความในตอนนี้</p>
          <p style="font-size: 0.85rem; margin-top: 4px;">ไฟล์นี้อาจเป็นรูปภาพสแกน ไม่มีตัวหนังสือให้อ่านค่ะ</p>
          <button class="btn-pill" onclick="window.app.btnBack.click()" style="margin-top: 16px;">‹ กลับหน้ารายการ</button>
        </div>
      `;
      return;
    }

    this.paragraphs.forEach((para, idx) => {
      const pElem = document.createElement('p');
      pElem.className = 'paragraph-item' + (idx === this.currentParagraphIdx ? ' active' : '');
      pElem.id = `para-${idx}`;
      pElem.textContent = para;

      pElem.addEventListener('click', () => {
        this.jumpToParagraph(idx);
      });

      this.readerContentBox.appendChild(pElem);
    });
  }

  jumpToParagraph(idx) {
    if (idx < 0 || idx >= this.paragraphs.length) return;
    this.currentParagraphIdx = idx;
    this.highlightActiveParagraph();
    this.playCurrentParagraph();
  }

  highlightActiveParagraph() {
    const all = this.readerContentBox.querySelectorAll('.paragraph-item');
    all.forEach(el => el.classList.remove('active'));

    const currentElem = document.getElementById(`para-${this.currentParagraphIdx}`);
    if (currentElem) {
      currentElem.classList.add('active');
      currentElem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Update progress bar
    if (this.paragraphs.length > 0) {
      const pct = ((this.currentParagraphIdx + 1) / this.paragraphs.length) * 100;
      this.playerProgressBar.style.width = `${pct}%`;
    }
  }

  getAudioUrl(text) {
    const params = new URLSearchParams({
      text: text,
      voice: this.voice
    });
    return `/api/tts?${params.toString()}`;
  }

  // Preload audio directly into in-memory Blob URL for instantaneous playback
  async preloadBlob(idx) {
    if (idx < 0 || idx >= this.paragraphs.length) return;
    const text = this.paragraphs[idx];
    const rawUrl = this.getAudioUrl(text);

    if (this.blobCache.has(rawUrl) || this.loadingBlobs.has(rawUrl)) return;
    this.loadingBlobs.add(rawUrl);

    try {
      const res = await fetch(rawUrl);
      if (res.ok) {
        const blob = await res.blob();
        const blobUrl = URL.createObjectURL(blob);
        this.blobCache.set(rawUrl, blobUrl);

        // Keep blob cache bounded (max 25 blobs to save mobile memory)
        if (this.blobCache.size > 25) {
          const oldestKey = this.blobCache.keys().next().value;
          URL.revokeObjectURL(this.blobCache.get(oldestKey));
          this.blobCache.delete(oldestKey);
        }
      }
    } catch (e) {
      console.warn('Blob preload failed, will stream directly', e);
    } finally {
      this.loadingBlobs.delete(rawUrl);
    }
  }

  clearBlobCache() {
    for (const bUrl of this.blobCache.values()) {
      URL.revokeObjectURL(bUrl);
    }
    this.blobCache.clear();
    this.loadingBlobs.clear();
  }

  async playCurrentParagraph() {
    if (this.paragraphs.length === 0 || this.currentParagraphIdx >= this.paragraphs.length) {
      this.onChapterEnded();
      return;
    }

    const text = this.paragraphs[this.currentParagraphIdx];
    const rawUrl = this.getAudioUrl(text);
    const audioSrc = this.blobCache.get(rawUrl) || rawUrl;

    // Reset stall watchdog
    this.resetWatchdog();

    this.audio.src = audioSrc;
    this.audio.playbackRate = this.speed;

    try {
      await this.audio.play();
      this.isPlaying = true;
      this.updatePlayBtnState();
      this.highlightActiveParagraph();
      this.updateMediaSession();
      this.saveCurrentBookmark();

      // Preload next paragraph into memory blob
      this.preloadBlob(this.currentParagraphIdx + 1);

      // Server-side prefetch
      this.prefetchNext();
    } catch (e) {
      console.warn('Playback error or autoplay blocked:', e);
      // If error, trigger recovery watchdog
      this.scheduleRecovery(1500);
    }
  }

  handleAudioEnded() {
    this.clearWatchdog();
    if (!this.isPlaying) return;

    if (this.currentParagraphIdx + 1 < this.paragraphs.length) {
      this.currentParagraphIdx++;
      this.playCurrentParagraph();
    } else {
      this.onChapterEnded();
    }
  }

  // Anti-Freeze Watchdog: if audio stalls or goes silent for too long, automatically recover
  resetWatchdog() {
    this.clearWatchdog();
    this.watchdogTimer = setTimeout(() => {
      if (this.isPlaying && (this.audio.paused || this.audio.readyState < 2)) {
        console.warn('Stall detected by watchdog! Auto-recovering playback...');
        this.handleAudioEnded();
      }
    }, 4500);
  }

  clearWatchdog() {
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  scheduleRecovery(ms = 2000) {
    setTimeout(() => {
      if (this.isPlaying && this.audio.paused) {
        console.warn('Auto-recovering stalled audio...');
        this.handleAudioEnded();
      }
    }, ms);
  }

  prefetchNext() {
    const upcoming = [];
    for (let i = 1; i <= 5; i++) {
      const nextIdx = this.currentParagraphIdx + i;
      if (nextIdx < this.paragraphs.length) {
        upcoming.push(this.paragraphs[nextIdx]);
      }
    }
    if (upcoming.length > 0) {
      fetch('/api/tts/prefetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paragraphs: upcoming,
          voice: this.voice
        })
      }).catch(() => {});
    }
  }

  togglePlay() {
    if (this.isPlaying) {
      this.audio.pause();
      this.isPlaying = false;
      this.clearWatchdog();
      this.updatePlayBtnState();
    } else {
      if (!this.audio.src || this.audio.src === '' || this.audio.ended) {
        this.playCurrentParagraph();
      } else {
        this.audio.play().then(() => {
          this.isPlaying = true;
          this.updatePlayBtnState();
          this.preloadBlob(this.currentParagraphIdx + 1);
        }).catch(err => {
          this.playCurrentParagraph();
        });
      }
    }
  }

  updatePlayBtnState() {
    if (this.isPlaying) {
      this.btnPlayIcon.textContent = '⏸';
    } else {
      this.btnPlayIcon.textContent = '▶';
    }
  }

  setupAudioEvents() {
    this.audio.addEventListener('ended', () => {
      this.handleAudioEnded();
    });

    this.audio.addEventListener('playing', () => {
      this.clearWatchdog();
    });

    this.audio.addEventListener('waiting', () => {
      this.resetWatchdog();
    });

    this.audio.addEventListener('stalled', () => {
      this.resetWatchdog();
    });

    this.audio.addEventListener('error', (e) => {
      console.warn('Audio element error detected, skipping to next paragraph in 500ms...', e);
      this.scheduleRecovery(500);
    });

    this.audio.addEventListener('timeupdate', () => {
      if (this.audio.duration && this.paragraphs.length > 0) {
        const paraBase = (this.currentParagraphIdx / this.paragraphs.length) * 100;
        const paraProgress = (this.audio.currentTime / this.audio.duration) * (100 / this.paragraphs.length);
        this.playerProgressBar.style.width = `${paraBase + paraProgress}%`;
      }
    });
  }

  onChapterEnded() {
    this.clearWatchdog();
    if (this.sleepTimer === 'chapter') {
      this.stopPlayback('ครบตามเวลาที่ตั้งไว้ (จบตอน)');
      return;
    }

    // Auto next chapter
    const currentId = parseInt(this.currentChapter.chapter_id);
    const nextChapter = this.findNextChapter(currentId);
    if (nextChapter) {
      this.loadChapter(nextChapter.id, 0).then(() => {
        this.playCurrentParagraph();
      });
    } else {
      this.isPlaying = false;
      this.updatePlayBtnState();
    }
  }

  findNextChapter(currentId) {
    if (!this.currentNovel || !this.currentNovel.chapters) return null;
    const chapters = this.currentNovel.chapters;
    for (let i = 0; i < chapters.length; i++) {
      if (parseInt(chapters[i].id) === currentId && i + 1 < chapters.length) {
        return chapters[i + 1];
      }
    }
    return null;
  }

  findPrevChapter(currentId) {
    if (!this.currentNovel || !this.currentNovel.chapters) return null;
    const chapters = this.currentNovel.chapters;
    for (let i = 0; i < chapters.length; i++) {
      if (parseInt(chapters[i].id) === currentId && i > 0) {
        return chapters[i - 1];
      }
    }
    return null;
  }

  updatePlayerInfo() {
    if (!this.currentNovel || !this.currentChapter) return;
    this.playerTrackTitle.textContent = this.currentChapter.title || 'นิยายเสียง';
    this.playerTrackSubtitle.textContent = this.currentNovel.title;
  }

  updateMediaSession() {
    if ('mediaSession' in navigator && this.currentNovel && this.currentChapter) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.currentChapter.title || 'ตอนที่ ' + this.currentChapter.chapter_id,
        artist: 'เปรมวดี (เสียงอ่านนุ่มละมุน)',
        album: this.currentNovel.title,
        artwork: [
          { src: '/static/icons/icon.svg', sizes: '512x512', type: 'image/svg+xml' }
        ]
      });

      navigator.mediaSession.setActionHandler('play', () => this.togglePlay());
      navigator.mediaSession.setActionHandler('pause', () => this.togglePlay());
      navigator.mediaSession.setActionHandler('seekbackward', () => this.rewind15());
      navigator.mediaSession.setActionHandler('seekforward', () => this.forward15());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.prevParagraph());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.nextParagraph());
    }
  }

  rewind15() {
    if (this.audio.currentTime > 5) {
      this.audio.currentTime = Math.max(0, this.audio.currentTime - 15);
    } else {
      this.prevParagraph();
    }
  }

  forward15() {
    if (this.audio.duration && this.audio.currentTime + 15 < this.audio.duration) {
      this.audio.currentTime += 15;
    } else {
      this.nextParagraph();
    }
  }

  prevParagraph() {
    if (this.currentParagraphIdx > 0) {
      this.jumpToParagraph(this.currentParagraphIdx - 1);
    }
  }

  nextParagraph() {
    if (this.currentParagraphIdx + 1 < this.paragraphs.length) {
      this.jumpToParagraph(this.currentParagraphIdx + 1);
    }
  }

  saveCurrentBookmark() {
    if (!this.currentNovel || !this.currentChapter) return;

    // 1. LocalStorage - instant & persistent across restarts/phone sleep
    try {
      const bookmarks = JSON.parse(localStorage.getItem('novel_bookmarks') || '{}');
      bookmarks[this.currentNovel.id] = {
        chapter_id: this.currentChapter.chapter_id,
        paragraph_idx: this.currentParagraphIdx,
        timestamp: Date.now()
      };
      localStorage.setItem('novel_bookmarks', JSON.stringify(bookmarks));

      const lastRead = {
        novel_id: this.currentNovel.id,
        novel_title: this.currentNovel.title,
        chapter_id: this.currentChapter.chapter_id,
        chapter_title: this.currentChapter.title || `ตอนที่ ${this.currentChapter.chapter_id}`,
        paragraph_idx: this.currentParagraphIdx,
        timestamp: Date.now()
      };
      localStorage.setItem('novel_last_read', JSON.stringify(lastRead));
    } catch (e) {
      console.warn('Failed to save bookmark locally:', e);
    }

    // 2. Server API
    fetch('/api/bookmark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        novel_id: this.currentNovel.id,
        chapter_id: this.currentChapter.chapter_id,
        paragraph_idx: this.currentParagraphIdx
      })
    }).catch(() => {});
  }

  setSpeed(speedVal) {
    this.speed = speedVal;
    localStorage.setItem('novel_speed', speedVal);
    this.audio.playbackRate = speedVal;
    this.btnSpeed.textContent = `${speedVal}x`;
  }

  cycleSpeed() {
    const speeds = [0.8, 1.0, 1.25, 1.5, 1.75, 2.0];
    const currentIdx = speeds.indexOf(this.speed);
    const nextSpeed = speeds[(currentIdx + 1) % speeds.length];
    this.setSpeed(nextSpeed);
  }

  startSleepTimer(minutes) {
    this.clearSleepTimer();
    if (minutes === 'chapter') {
      this.sleepTimer = 'chapter';
      this.btnTimer.textContent = '⏱ จบตอน';
      return;
    }

    const mins = parseInt(minutes);
    if (isNaN(mins) || mins <= 0) return;

    this.sleepRemaining = mins * 60;
    this.sleepTimer = 'time';

    this.sleepInterval = setInterval(() => {
      this.sleepRemaining--;
      const m = Math.floor(this.sleepRemaining / 60);
      const s = this.sleepRemaining % 60;
      this.btnTimer.textContent = `⏱ ${m}:${s < 10 ? '0' : ''}${s}`;

      if (this.sleepRemaining <= 0) {
        this.clearSleepTimer();
        this.stopPlayback('ครบกำหนดเวลาพักสายตาแล้วค่ะ');
      }
    }, 1000);
  }

  clearSleepTimer() {
    if (this.sleepInterval) clearInterval(this.sleepInterval);
    this.sleepTimer = null;
    this.sleepRemaining = 0;
    this.btnTimer.textContent = '⏱ ตั้งเวลา';
  }

  stopPlayback(msg) {
    this.audio.pause();
    this.isPlaying = false;
    this.clearWatchdog();
    this.updatePlayBtnState();
    if (msg) alert(msg);
  }

  applyTheme(themeName) {
    document.body.className = '';
    document.body.classList.add(themeName);
    this.theme = themeName;
    localStorage.setItem('novel_theme', themeName);

    // Update active state in settings modal
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === themeName);
    });
  }

  applyFontSize(size) {
    this.fontSize = size;
    localStorage.setItem('novel_font_size', size);
    document.documentElement.style.setProperty('--reader-font-size', `${size}px`);
    const styleElem = document.getElementById('dynamic-font-style') || document.createElement('style');
    styleElem.id = 'dynamic-font-style';
    styleElem.innerHTML = `.paragraph-item { font-size: ${size}px !important; }`;
    document.head.appendChild(styleElem);
  }

  updateQrModal() {
    if (!this.networkInfo) return;
    const url = this.networkInfo.network_url;
    this.qrLink.textContent = url;
    this.qrLink.href = url;

    // Use QuickChart QR API for fast clean SVG QR rendering
    this.qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(url)}`;
  }

  openChaptersModal() {
    if (!this.currentNovel || !this.currentNovel.chapters) return;
    this.chapterListContainer.innerHTML = '';
    const currentId = parseInt(this.currentChapter ? this.currentChapter.chapter_id : 1);

    this.currentNovel.chapters.forEach(ch => {
      const item = document.createElement('div');
      item.className = 'chapter-list-item' + (parseInt(ch.id) === currentId ? ' active' : '');
      item.innerHTML = `
        <span>${ch.title}</span>
        ${parseInt(ch.id) === currentId ? '<span>🎧 กำลังฟัง</span>' : ''}
      `;
      item.addEventListener('click', () => {
        this.closeAllModals();
        this.loadChapter(ch.id, 0).then(() => {
          this.playCurrentParagraph();
        });
      });
      this.chapterListContainer.appendChild(item);
    });

    this.showModal(this.modalChapters);
  }

  showModal(modalElem) {
    this.modalOverlay.classList.add('active');
    document.querySelectorAll('.modal-dialog').forEach(d => d.style.display = 'none');
    modalElem.style.display = 'block';
  }

  closeAllModals() {
    this.modalOverlay.classList.remove('active');
  }

  registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/static/sw.js').catch(err => {
        console.warn('SW registration failed:', err);
      });
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPrompt = e;
      if (this.pwaBanner) this.pwaBanner.style.display = 'flex';
    });
  }

  async updateCacheStats() {
    if (!this.cacheSizeText) return;
    try {
      const res = await fetch('/api/cache/stats');
      if (res.ok) {
        const data = await res.json();
        this.cacheSizeText.textContent = `${data.size_mb} MB (${data.files} ไฟล์)`;
      }
    } catch (e) {
      this.cacheSizeText.textContent = 'ไม่สามารถดึงข้อมูลได้';
    }
  }

  async clearServerCache() {
    if (!confirm('ต้องการล้างไฟล์เสียงแคชทั้งหมดหรือไม่? (เพื่อคืนพื้นที่ความจำให้เครื่อง)')) {
      return;
    }
    try {
      this.cacheSizeText.textContent = 'กำลังล้างแคช...';
      const res = await fetch('/api/cache/clear', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        this.clearBlobCache();
        alert(`ล้างแคชเรียบร้อยแล้วค่ะ! คืนพื้นที่ได้ ${data.freed_mb} MB (${data.deleted_files} ไฟล์)`);
        this.updateCacheStats();
      }
    } catch (e) {
      alert('เกิดข้อผิดพลาดในการล้างแคช: ' + e.message);
      this.updateCacheStats();
    }
  }

  setupEventListeners() {
    // Navigation
    this.btnBack.addEventListener('click', () => {
      this.viewReader.classList.remove('active');
      this.viewLibrary.classList.add('active');
      this.btnBack.style.display = 'none';
      this.btnChapters.style.display = 'none';
      this.loadLibrary(); // refresh bookmarks
    });

    // Modals
    this.btnMobile.addEventListener('click', () => {
      this.showModal(this.modalQr);
    });

    this.btnSettings.addEventListener('click', () => {
      this.showModal(this.modalSettings);
      this.updateCacheStats();
    });

    if (this.toggleAutoResume) {
      this.toggleAutoResume.checked = this.autoResume;
      this.toggleAutoResume.addEventListener('change', (e) => {
        this.autoResume = e.target.checked;
        localStorage.setItem('novel_auto_resume', this.autoResume ? 'true' : 'false');
      });
    }

    if (this.btnClearCache) {
      this.btnClearCache.addEventListener('click', () => this.clearServerCache());
    }

    this.btnChapters.addEventListener('click', () => {
      this.openChaptersModal();
    });

    this.btnTimer.addEventListener('click', () => {
      this.showModal(this.modalTimer);
    });

    this.modalOverlay.addEventListener('click', (e) => {
      if (e.target === this.modalOverlay) this.closeAllModals();
    });

    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => this.closeAllModals());
    });

    // Player Controls
    this.btnPlay.addEventListener('click', () => this.togglePlay());
    this.btnRewind.addEventListener('click', () => this.rewind15());
    this.btnForward.addEventListener('click', () => this.forward15());
    this.btnSpeed.addEventListener('click', () => this.cycleSpeed());

    // Progress Bar scrub / seek
    this.playerProgressContainer.addEventListener('click', (e) => {
      const rect = this.playerProgressContainer.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = clickX / rect.width;
      const targetIdx = Math.floor(pct * this.paragraphs.length);
      this.jumpToParagraph(Math.min(targetIdx, this.paragraphs.length - 1));
    });

    // Chapter Prev/Next buttons
    this.btnPrevChapter.addEventListener('click', () => {
      const currentId = parseInt(this.currentChapter.chapter_id);
      const prev = this.findPrevChapter(currentId);
      if (prev) this.loadChapter(prev.id, 0);
    });

    this.btnNextChapter.addEventListener('click', () => {
      const currentId = parseInt(this.currentChapter.chapter_id);
      const next = this.findNextChapter(currentId);
      if (next) this.loadChapter(next.id, 0);
    });

    // Theme selector buttons
    document.querySelectorAll('.theme-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.applyTheme(btn.dataset.theme);
      });
    });

    // Font size controls
    document.getElementById('btn-font-decrease').addEventListener('click', () => {
      this.applyFontSize(Math.max(14, this.fontSize - 2));
    });

    document.getElementById('btn-font-increase').addEventListener('click', () => {
      this.applyFontSize(Math.min(30, this.fontSize + 2));
    });

    // Voice selector
    this.selectVoice.value = this.voice;
    this.selectVoice.addEventListener('change', (e) => {
      this.voice = e.target.value;
      localStorage.setItem('novel_voice', this.voice);
      this.clearBlobCache();
      if (this.isPlaying) {
        this.playCurrentParagraph(); // re-generate with new voice
      }
    });

    // Sleep Timer presets
    document.querySelectorAll('.timer-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.dataset.time;
        if (val === '0') {
          this.clearSleepTimer();
        } else {
          this.startSleepTimer(val);
        }
        this.closeAllModals();
      });
    });

    // File Upload (Drag and Drop + Click)
    this.uploadCard.addEventListener('click', () => {
      this.fileUploadInput.click();
    });

    this.uploadCard.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.uploadCard.classList.add('dragover');
    });

    this.uploadCard.addEventListener('dragleave', () => {
      this.uploadCard.classList.remove('dragover');
    });

    this.uploadCard.addEventListener('drop', (e) => {
      e.preventDefault();
      this.uploadCard.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        this.handleFileUpload(e.dataTransfer.files[0]);
      }
    });

    this.fileUploadInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.handleFileUpload(e.target.files[0]);
      }
    });

    // Install PWA
    const btnInstall = document.getElementById('btn-install-pwa');
    if (btnInstall) {
      btnInstall.addEventListener('click', async () => {
        if (this.deferredPrompt) {
          this.deferredPrompt.prompt();
          const { outcome } = await this.deferredPrompt.userChoice;
          if (outcome === 'accepted') {
            this.pwaBanner.style.display = 'none';
          }
          this.deferredPrompt = null;
        } else {
          alert('สำหรับการติดตั้งบน iOS (Safari):\nกดปุ่ม Share (แชร์ด้านล่าง) -> เลือก "Add to Home Screen" (เพิ่มไปยังหน้าจอโฮม) ได้เลยค่ะ');
        }
      });
    }
  }

  async handleFileUpload(file) {
    const formData = new FormData();
    formData.append('file', file);

    const titleElem = this.uploadCard.querySelector('.upload-title');
    const origTitle = titleElem.textContent;
    titleElem.innerHTML = `<span class="spinner" style="border-top-color: var(--primary);"></span> กำลังวิเคราะห์และแยกบทนิยาย...`;

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'อัปโหลดล้มเหลว');
      }

      const novel = await res.json();
      await this.loadLibrary();
      // Immediately open novel
      this.openNovel(novel.id, 1, 0);
    } catch (e) {
      alert('เกิดข้อผิดพลาดในการอัปโหลด: ' + e.message);
    } finally {
      titleElem.textContent = origTitle;
      this.fileUploadInput.value = '';
    }
  }
}

// Initialize on DOM load
window.addEventListener('DOMContentLoaded', () => {
  window.app = new NovelReaderApp();
});
