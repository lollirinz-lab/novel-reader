// Novel Reader PWA - Frontend Application Logic with Dual-Audio Gapless Engine
class NovelReaderApp {
  constructor() {
    this.novels = [];
    this.currentNovel = null;
    this.currentChapter = null;
    this.currentParagraphIdx = 0;
    this.paragraphs = [];
    this.isPlaying = false;

    // Dual Audio Engine for Seamless Gapless Playback (Zero Gap between paragraphs)
    this.audioA = new Audio();
    this.audioB = new Audio();
    this.currentAudio = this.audioA;
    this.nextAudio = this.audioB;
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

    this.initElements();
    this.applyTheme(this.theme);
    this.applyFontSize(this.fontSize);
    this.setupAudioEvents();
    this.setupEventListeners();
    this.registerServiceWorker();
    this.fetchInfo();
    this.loadLibrary();
  }

  initElements() {
    // Views
    this.viewLibrary = document.getElementById('view-library');
    this.viewReader = document.getElementById('view-reader');

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

  async loadLibrary() {
    try {
      const res = await fetch('/api/novels');
      if (res.ok) {
        this.novels = await res.json();
        this.renderLibrary();
      }
    } catch (e) {
      console.error('Failed to load library', e);
    }
  }

  renderLibrary() {
    if (!this.novelGrid) return;
    this.novelGrid.innerHTML = '';

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

      let bookmarkText = '';
      if (novel.bookmark) {
        bookmarkText = `
          <div class="novel-bookmark-indicator">
            <span>🔖 อ่านค้างไว้: ตอนที่ ${novel.bookmark.chapter_id}</span>
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
        this.openNovel(novel.id, novel.bookmark ? novel.bookmark.chapter_id : 1, novel.bookmark ? novel.bookmark.paragraph_idx : 0);
      });

      this.novelGrid.appendChild(card);
    });
  }

  async openNovel(novelId, chapterId = 1, startParaIdx = 0) {
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

      this.readerChapterTitle.textContent = this.currentChapter.title;
      this.renderParagraphs();
      this.updatePlayerInfo();

      // Save bookmark
      this.saveCurrentBookmark();

      // Preload first and second paragraphs
      if (this.paragraphs.length > 0) {
        this.preloadFirstParagraphs(this.currentParagraphIdx);
      }
    } catch (e) {
      this.readerContentBox.innerHTML = `<p style="color:red; text-align:center;">เกิดข้อผิดพลาด: ${e.message}</p>`;
    }
  }

  renderParagraphs() {
    this.readerContentBox.innerHTML = '';
    if (this.paragraphs.length === 0) {
      this.readerContentBox.innerHTML = '<p style="text-align:center; color:var(--text-muted);">ไม่มีเนื้อหาในตอนนี้</p>';
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

  preloadFirstParagraphs(idx) {
    if (idx < this.paragraphs.length) {
      this.currentAudio.src = this.getAudioUrl(this.paragraphs[idx]);
      this.currentAudio.playbackRate = this.speed;
      this.currentAudio.preload = 'auto';
    }
    if (idx + 1 < this.paragraphs.length) {
      this.preloadNext(idx + 1);
    }
  }

  preloadNext(nextIdx) {
    if (nextIdx < this.paragraphs.length) {
      const url = this.getAudioUrl(this.paragraphs[nextIdx]);
      if (this.nextAudio.src !== url) {
        this.nextAudio.src = url;
        this.nextAudio.playbackRate = this.speed;
        this.nextAudio.preload = 'auto';
        this.nextAudio.load();
      }
    }
  }

  async playCurrentParagraph() {
    if (this.paragraphs.length === 0 || this.currentParagraphIdx >= this.paragraphs.length) {
      this.onChapterEnded();
      return;
    }

    const text = this.paragraphs[this.currentParagraphIdx];
    const audioUrl = this.getAudioUrl(text);

    // If currentAudio isn't pointed to this url yet, set it
    if (!this.currentAudio.src.includes(encodeURIComponent(text.substring(0, 20)))) {
      this.currentAudio.src = audioUrl;
    }
    this.currentAudio.playbackRate = this.speed;

    try {
      await this.currentAudio.play();
      this.isPlaying = true;
      this.updatePlayBtnState();
      this.highlightActiveParagraph();
      this.updateMediaSession();
      this.saveCurrentBookmark();

      // Seamless buffer: preload next paragraph in background immediately
      this.preloadNext(this.currentParagraphIdx + 1);

      // Server-side prefetch for subsequent 5 paragraphs
      this.prefetchNext();
    } catch (e) {
      console.warn('Playback error or browser autoplay policy:', e);
    }
  }

  handleAudioEnded() {
    if (!this.isPlaying) return;

    if (this.currentParagraphIdx + 1 < this.paragraphs.length) {
      this.currentParagraphIdx++;

      // Swap audio players for 0ms GAPLESS playback!
      const finished = this.currentAudio;
      this.currentAudio = this.nextAudio;
      this.nextAudio = finished;

      // Play preloaded audio immediately (instant transition)
      this.currentAudio.playbackRate = this.speed;
      this.currentAudio.play().then(() => {
        this.highlightActiveParagraph();
        this.updateMediaSession();
        this.saveCurrentBookmark();
        // Immediately load the upcoming paragraph on the other player
        this.preloadNext(this.currentParagraphIdx + 1);
      }).catch(err => {
        // Fallback reload if browser dropped preloaded buffer
        this.playCurrentParagraph();
      });

      this.prefetchNext();
    } else {
      this.onChapterEnded();
    }
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
      this.currentAudio.pause();
      this.isPlaying = false;
      this.updatePlayBtnState();
    } else {
      if (!this.currentAudio.src || this.currentAudio.src === '' || this.currentAudio.ended) {
        this.playCurrentParagraph();
      } else {
        this.currentAudio.play().then(() => {
          this.isPlaying = true;
          this.updatePlayBtnState();
          this.preloadNext(this.currentParagraphIdx + 1);
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
    // Bind listeners to BOTH players
    [this.audioA, this.audioB].forEach(player => {
      player.addEventListener('ended', () => {
        if (player === this.currentAudio) {
          this.handleAudioEnded();
        }
      });

      player.addEventListener('timeupdate', () => {
        if (player === this.currentAudio && player.duration && this.paragraphs.length > 0) {
          const paraBase = (this.currentParagraphIdx / this.paragraphs.length) * 100;
          const paraProgress = (player.currentTime / player.duration) * (100 / this.paragraphs.length);
          this.playerProgressBar.style.width = `${paraBase + paraProgress}%`;
        }
      });

      player.addEventListener('error', (e) => {
        if (player === this.currentAudio) {
          console.warn('Current audio stream error, advancing or retrying...', e);
        }
      });
    });
  }

  onChapterEnded() {
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
    if (this.currentAudio.currentTime > 5) {
      this.currentAudio.currentTime = Math.max(0, this.currentAudio.currentTime - 15);
    } else {
      this.prevParagraph();
    }
  }

  forward15() {
    if (this.currentAudio.duration && this.currentAudio.currentTime + 15 < this.currentAudio.duration) {
      this.currentAudio.currentTime += 15;
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
    this.currentAudio.playbackRate = speedVal;
    this.nextAudio.playbackRate = speedVal;
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
    this.currentAudio.pause();
    this.isPlaying = false;
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
    });

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
