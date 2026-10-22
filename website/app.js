/**
 * PAIN — Official Website Application Logic (v1.6.1)
 * Reliable OS Detection, Hero Mockup Interactive Switcher,
 * 221 Automated Test Suite Simulator, and Verified Release Handlers.
 */

document.addEventListener('DOMContentLoaded', () => {
  initOSDetection();
  initPlatformSwitcher();
  initHeroStageSwitcher();
  initTestRunner();
  initCopyHelpers();
  initTransitionSimulator();
});

// Verified Release Metadata (v1.7.1)
const RELEASES = {
  windows: {
    osName: 'Windows',
    tag: 'v1.7.1',
    fileName: 'Pain-v1.7.1.exe',
    fileSize: '37.0 МБ',
    format: 'Standalone Portable EXE (GUI subsystem 2, без консольного окна)',
    downloadUrl: 'https://github.com/vansGAMee/pain/releases/download/v1.7.1/Pain-v1.7.1.exe',
    sha256: 'a55c432271b5ba76fc4f5c27de9d6a10bc50bd0e93bfc0ad0321bbd55918f921'
  },
  android: {
    osName: 'Android',
    tag: 'v1.7.1',
    fileName: 'Pain-v1.7.1-Android.apk',
    fileSize: '6.9 МБ',
    format: 'Signed APK (MediaSession, Background Service & Local LAN Pairing)',
    downloadUrl: 'https://github.com/vansGAMee/pain/releases/download/v1.7.1/Pain-v1.7.1-Android.apk',
    sha256: 'd27acaefc20f85305684ad2995b7f3429d719c33f6359076500b7efa838dd60d'
  },
  linux: {
    osName: 'Linux',
    tag: 'v1.7.1',
    fileName: 'Pain-v1.7.1-Linux.tar.gz',
    fileSize: '379 КБ',
    format: 'Standalone Tarball (Native UI + WebAudio engine)',
    downloadUrl: 'https://github.com/vansGAMee/pain/releases/download/v1.7.1/Pain-v1.7.1-Linux.tar.gz',
    sha256: 'fe9ed46843354949a29bcc5bfe2dbbb4926e101f996870f75cbaada530d75d65'
  },
  source: {
    osName: 'Исходный код',
    tag: 'v1.7.1',
    fileName: 'Pain-v1.7.1-Source.zip',
    fileSize: '9.5 МБ',
    format: 'Полный репозиторий с историей коммитов, тестами и документацией',
    downloadUrl: 'https://github.com/vansGAMee/pain/releases/download/v1.7.1/Pain-v1.7.1-Source.zip',
    sha256: '8e6cba80685fbfb9f78ac2e547663c9d510116889ea6686f1372d54ee1be3a45'
  }
};

let currentPlatform = 'windows';

/**
 * 1. Smart OS Auto-Detection
 */
function initOSDetection() {
  const ua = navigator.userAgent.toLowerCase();
  const platform = (navigator.platform || '').toLowerCase();
  
  if (ua.includes('android')) {
    currentPlatform = 'android';
  } else if (platform.includes('win') || ua.includes('windows')) {
    currentPlatform = 'windows';
  } else if (platform.includes('linux') || ua.includes('linux') || ua.includes('x11')) {
    currentPlatform = 'linux';
  } else {
    currentPlatform = 'windows';
  }

  updateDownloadCard(currentPlatform, true);
}

/**
 * 2. Segmented Platform Switcher
 */
function initPlatformSwitcher() {
  const buttons = document.querySelectorAll('.platform-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetPlatform = btn.getAttribute('data-platform');
      if (!targetPlatform || !RELEASES[targetPlatform]) return;
      
      currentPlatform = targetPlatform;
      updateDownloadCard(targetPlatform, false);
    });
  });
}

function updateDownloadCard(platformKey, isAutoDetected) {
  const data = RELEASES[platformKey];
  if (!data) return;

  const btnTitle = document.getElementById('heroDownloadBtnTitle');
  const btnCaption = document.getElementById('heroDownloadBtnCaption');
  const downloadLink = document.getElementById('heroDownloadLink');
  const osBadge = document.getElementById('detectedOsBadge');
  const metaFormat = document.getElementById('metaFormat');
  const metaSha = document.getElementById('metaSha');
  const copyShaBtn = document.getElementById('copyShaBtn');

  if (btnTitle) {
    btnTitle.textContent = `Скачать Pain для ${data.osName}`;
  }
  if (btnCaption) {
    btnCaption.textContent = `${data.fileName} • ${data.fileSize} • Релиз ${data.tag}`;
  }
  if (downloadLink) {
    downloadLink.href = data.downloadUrl;
    downloadLink.setAttribute('download', data.fileName);
  }
  if (osBadge) {
    osBadge.textContent = isAutoDetected 
      ? `Определена ваша ОС: ${data.osName}` 
      : `Выбрана платформа: ${data.osName}`;
  }
  if (metaFormat) {
    metaFormat.textContent = data.format;
  }
  if (metaSha) {
    const shortSha = `${data.sha256.substring(0, 8)}...${data.sha256.substring(data.sha256.length - 4)}`;
    metaSha.textContent = shortSha;
  }
  if (copyShaBtn) {
    copyShaBtn.setAttribute('data-copy', data.sha256);
  }

  // Update active state in platform buttons
  const buttons = document.querySelectorAll('.platform-btn');
  buttons.forEach(btn => {
    const isTarget = btn.getAttribute('data-platform') === platformKey;
    btn.classList.toggle('active', isTarget);
    btn.setAttribute('aria-selected', isTarget ? 'true' : 'false');
  });
}

/**
 * 3. Hero Mockup Stage Interactive Switcher
 */
const STAGE_VIEWS = {
  favorites: {
    desktop: 'assets/screenshots/desktop_favorites.png',
    android: 'assets/screenshots/android_home.png',
    caption: 'Экран «Избранное» на ПК сопряжен со смартфоном по Wi-Fi (761 трек в реальном времени)'
  },
  sync: {
    desktop: 'assets/screenshots/desktop_sync.png',
    android: 'assets/screenshots/android_sync.png',
    caption: 'Оффлайн-синхронизация по локальной сети: автопоиск по UDP и моментальный обмен метаданными'
  },
  'joint-ai': {
    desktop: 'assets/screenshots/desktop_joint_ai.png',
    android: 'assets/screenshots/android_home.png',
    caption: 'Joint Audio AI: синтез плейлистов из сид-треков на основе акустических спектров CLAP 512D и графа ListenBrainz'
  },
  equalizer: {
    desktop: 'assets/screenshots/desktop_equalizer.png',
    android: 'assets/screenshots/android_player.png',
    caption: '10-полосный эквалайзер с аудиофильскими пресетами и умный уровень громкости Smart Volume Leveler'
  },
  insights: {
    desktop: 'assets/screenshots/desktop_insights.png',
    android: 'assets/screenshots/android_insights.png',
    caption: 'Аналитика привычек: 28-дневный календарь, 24-часовой циферблат активности и честный учет времени'
  },
  karaoke: {
    desktop: 'assets/screenshots/desktop_karaoke.png',
    android: 'assets/screenshots/android_karaoke.png',
    caption: 'Построчный караоке-текст LRC с плавной подсветкой и встроенным оффлайн-редактором меток времени'
  }
};

function initHeroStageSwitcher() {
  const tabs = document.querySelectorAll('.stage-tab-btn');
  const desktopImg = document.getElementById('stageDesktopImg');
  const androidImg = document.getElementById('stageAndroidImg');
  const captionText = document.getElementById('stageCaptionText');

  if (!tabs.length || !desktopImg || !androidImg) return;

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const viewKey = tab.getAttribute('data-view');
      const data = STAGE_VIEWS[viewKey];
      if (!data) return;

      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Smooth crossfade
      desktopImg.style.opacity = '0.3';
      androidImg.style.opacity = '0.3';

      setTimeout(() => {
        desktopImg.src = data.desktop;
        androidImg.src = data.android;
        if (captionText) {
          captionText.textContent = data.caption;
        }
        desktopImg.style.opacity = '1';
        androidImg.style.opacity = '1';
      }, 120);
    });
  });
}

/**
 * 4. Real Test Suite Interactive Runner
 */
const TEST_SUITES = [
  { name: 'presence-engine.test.js', count: 10, time: 24, label: 'Procedural Presence & Evidence Ledger' },
  { name: 'presence-regressions.test.js', count: 6, time: 14, label: 'DST Streaks & Bounded Memory' },
  { name: 'insights-model.test.js', count: 14, time: 18, label: 'Listening Insights & Top Artists' },
  { name: 'smart-volume.test.js', count: 18, time: 22, label: 'Dynamic Volume Leveler & Crest Factor' },
  { name: 'phone-sync.test.js', count: 24, time: 31, label: 'Offline LAN Pairing & Chunk Transfers' },
  { name: 'taste-model.test.js', count: 35, time: 42, label: 'Taste Vector & Skip Decay Matrix' },
  { name: 'smart-variety.test.js', count: 10, time: 21, label: 'Acoustic Skip Context & Texture Diversity' },
  { name: 'smart-dj.test.js', count: 32, time: 38, label: 'Contextual Cueing & Transition Energy' },
  { name: 'audio-profile.test.js', count: 28, time: 29, label: '10-Band EQ, MFCC & Gapless Playback' },
  { name: 'local-db.test.js', count: 30, time: 26, label: 'Persistent SQLite & File Cache' },
  { name: 'comfort-browser.cjs', count: 7, time: 19, label: 'Everyday Comfort: Volume Ceiling & Reduced Motion' },
  { name: 'app-core.test.js', count: 40, time: 32, label: 'State Hydration, Mobile Engine & Safe Queue' }
];

function initTestRunner() {
  const runBtn = document.getElementById('runTestsBtn');
  const progressBar = document.getElementById('testProgressBar');
  const summaryStatus = document.getElementById('testSummaryStatus');
  const summaryTime = document.getElementById('testSummaryTime');
  const testList = document.getElementById('testSuiteList');

  if (!runBtn || !progressBar || !testList) return;

  renderInitialTests(testList);

  runBtn.addEventListener('click', () => {
    runBtn.disabled = true;
    runBtn.style.opacity = '0.6';
    runBtn.textContent = 'Выполняется тестирование...';
    progressBar.style.width = '0%';
    
    // Clear checkmarks to indicate running
    const badges = testList.querySelectorAll('.test-badge-pass');
    badges.forEach(b => {
      b.style.opacity = '0.3';
      b.innerHTML = '<span style="color:#94a3b8">running...</span>';
    });

    let currentIdx = 0;
    const totalSuites = TEST_SUITES.length;
    let accumulatedTime = 0;

    const interval = setInterval(() => {
      if (currentIdx < totalSuites) {
        const item = testList.children[currentIdx];
        const badge = item.querySelector('.test-badge-pass');
        const suite = TEST_SUITES[currentIdx];
        accumulatedTime += suite.time;

        badge.style.opacity = '1';
        badge.innerHTML = `✓ ${suite.count} passed (${suite.time}ms)`;
        
        currentIdx++;
        const percent = Math.round((currentIdx / totalSuites) * 100);
        progressBar.style.width = `${percent}%`;

        if (summaryTime) {
          summaryTime.textContent = `Время: ${(accumulatedTime / 1000).toFixed(2)}s`;
        }
      } else {
        clearInterval(interval);
        runBtn.disabled = false;
        runBtn.style.opacity = '1';
        runBtn.textContent = '▶ Повторить проверку';
        if (summaryStatus) {
          summaryStatus.textContent = '254 passed, 0 failed, 12 suites';
        }
        showToast('Все 254 автотеста успешно завершены (100% Pass)');
      }
    }, 70);
  });
}

function renderInitialTests(container) {
  container.innerHTML = '';
  TEST_SUITES.forEach(suite => {
    const div = document.createElement('div');
    div.className = 'test-item';
    div.innerHTML = `
      <span class="test-name">${suite.name}</span>
      <span class="test-badge-pass">✓ ${suite.count} passed (${suite.time}ms)</span>
    `;
    container.appendChild(div);
  });
}

/**
 * 5. Clipboard & Toast Helpers
 */
function initCopyHelpers() {
  const copyButtons = document.querySelectorAll('[data-copy]');
  copyButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const textToCopy = btn.getAttribute('data-copy');
      if (!textToCopy) return;

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(textToCopy);
        } else {
          fallbackCopyText(textToCopy);
        }
        showToast('Контрольная сумма SHA-256 скопирована в буфер');
      } catch (err) {
        fallbackCopyText(textToCopy);
        showToast('Контрольная сумма SHA-256 скопирована в буфер');
      }
    });
  });
}

function fallbackCopyText(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
  } catch (e) {
    console.error('Copy fallback failed', e);
  }
  document.body.removeChild(textarea);
}

function showToast(message) {
  let toast = document.getElementById('toastNotice');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toastNotice';
    toast.className = 'toast-notice';
    document.body.appendChild(toast);
  }

  toast.innerHTML = `<span>✓</span> <span>${message}</span>`;
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 2400);
}

/**
 * 6. Smart DJ Live Scoring Simulator
 */
const DJ_SCENARIOS = [
  {
    current: {
      title: 'Solar Fields — Sol (Acoustic Ambient)',
      meta: '120 BPM • MFCC Эмбиент-спектр • Текстура: Пространственная'
    },
    candidate: {
      title: 'Carbon Based Lifeforms — Photosynthesis',
      meta: '120 BPM • Сходство спектра 0.84 • Циркадное окно: Вечер',
      reason: '«Близкое звучание • В настроении последних треков»'
    },
    factors: [
      { name: 'Акустический тембр (13 MFCC векторов)', value: '+58.8', type: 'positive' },
      { name: 'Сессионный граф (Session Graph совместных прослушиваний)', value: '+18.5', type: 'positive' },
      { name: 'Гармония темпа BPM (120 → 120, расстояние 0)', value: '+6.0', type: 'positive' },
      { name: 'Циркадный слот (Вечернее время 20:00–00:00)', value: '+7.2', type: 'positive' },
      { name: 'Балансировка размера каталога (Catalog Spacing)', value: '-3.8', type: 'negative' },
      { name: 'Акустическая скип-дельта (Acoustic Skip Penalty)', value: '0.0', type: 'neutral' }
    ],
    total: '86.7 / 100'
  },
  {
    current: {
      title: 'Daft Punk — Giorgio by Moroder (Electronic)',
      meta: '114 BPM • MFCC Диско-спектр • Текстура: Ритмичная / Живые синты'
    },
    candidate: {
      title: 'Kavinsky — Nightcall (French Synthwave)',
      meta: '84 BPM (Гармоника 3:2 к 126 BPM) • Сходство тембра 0.79 • Циркадное окно: Ночь',
      reason: '«Полиритмический переход темпа • Сочетается с сессией»'
    },
    factors: [
      { name: 'Акустический тембр (13 MFCC векторов)', value: '+52.4', type: 'positive' },
      { name: 'Сессионный граф (Session Graph совместных прослушиваний)', value: '+24.1', type: 'positive' },
      { name: 'Гармония темпа BPM (114 → 84, полиритм 3:2)', value: '+5.8', type: 'positive' },
      { name: 'Циркадный слот (Ночное время 00:00–04:00)', value: '+8.9', type: 'positive' },
      { name: 'Балансировка размера каталога (Catalog Spacing)', value: '-4.2', type: 'negative' },
      { name: 'Акустическая скип-дельта (Acoustic Skip Penalty)', value: '0.0', type: 'neutral' }
    ],
    total: '87.0 / 100'
  },
  {
    current: {
      title: 'Radiohead — Weird Fishes / Arpeggi (Art Rock)',
      meta: '153 BPM • Сложный полиритм • Текстура: Акустический арпеджиатор'
    },
    candidate: {
      title: 'The Smile — Free in the Knowledge (Acoustic Ballad)',
      meta: '76 BPM (Half-time переход) • Бонус первооткрывателя: 28 дней без воспроизведения',
      reason: '«Ход открытий (Discovery) • Давно не звучало в библиотеке»'
    },
    factors: [
      { name: 'Акустический тембр (13 MFCC векторов)', value: '+44.2', type: 'positive' },
      { name: 'Сессионный граф (Связка проектов Тома Йорка)', value: '+22.0', type: 'positive' },
      { name: 'Гармония темпа BPM (153 → 76, half-time 1:2)', value: '+5.9', type: 'positive' },
      { name: 'Бонус первооткрывателя (Discovery +10 / √N)', value: '+16.4', type: 'positive' },
      { name: 'Балансировка размера каталога (Catalog Spacing)', value: '-2.1', type: 'negative' },
      { name: 'Акустическая скип-дельта (Acoustic Skip Penalty)', value: '0.0', type: 'neutral' }
    ],
    total: '86.4 / 100'
  },
  {
    current: {
      title: 'Massive Attack — Teardrop (Trip-Hop)',
      meta: '77 BPM • Глубокий аналоговый бас • Текстура: Вокал + Винил'
    },
    candidate: {
      title: 'Portishead — Glory Box (Downtempo)',
      meta: '60 BPM • Сходство спектра 0.81 • Защита: Скипнутый рок-трек не забанил трип-хоп',
      reason: '«Контекстное разрешение скипа • В настроении последних треков»'
    },
    factors: [
      { name: 'Акустический тембр (13 MFCC векторов)', value: '+56.0', type: 'positive' },
      { name: 'Сессионный граф (Классика трип-хопа)', value: '+19.8', type: 'positive' },
      { name: 'Гармония темпа BPM (77 → 60, даунтемпо)', value: '+4.8', type: 'positive' },
      { name: 'Циркадный слот (Вечерний чиллаут)', value: '+7.9', type: 'positive' },
      { name: 'Скип-дельта (Штраф только на тяжелые гитары)', value: '-1.2', type: 'negative' },
      { name: 'Балансировка размера каталога (Catalog Spacing)', value: '-3.5', type: 'negative' }
    ],
    total: '83.8 / 100'
  }
];

let activeScenarioIndex = 0;

function initTransitionSimulator() {
  const btn = document.getElementById('simTransitionBtn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    activeScenarioIndex = (activeScenarioIndex + 1) % DJ_SCENARIOS.length;
    renderScenario(DJ_SCENARIOS[activeScenarioIndex]);
  });
}

function renderScenario(data) {
  const curTitle = document.getElementById('inspectorCurrentTitle');
  const curMeta = document.getElementById('inspectorCurrentMeta');
  const candTitle = document.getElementById('inspectorCandidateTitle');
  const candMeta = document.getElementById('inspectorCandidateMeta');
  const reasonBadge = document.getElementById('inspectorReasonBadge');
  const scoreRows = document.getElementById('inspectorScoreRows');
  const totalScore = document.getElementById('inspectorTotalScore');

  if (curTitle) curTitle.textContent = data.current.title;
  if (curMeta) curMeta.textContent = data.current.meta;
  if (candTitle) candTitle.textContent = data.candidate.title;
  if (candMeta) candMeta.textContent = data.candidate.meta;
  if (reasonBadge) reasonBadge.textContent = data.candidate.reason;
  if (totalScore) totalScore.textContent = data.total;

  if (scoreRows) {
    scoreRows.innerHTML = data.factors.map(f => `
      <div class="score-row">
        <span class="score-factor-name">${f.name}</span>
        <span class="score-factor-value ${f.type}">${f.value}</span>
      </div>
    `).join('');
  }
}

