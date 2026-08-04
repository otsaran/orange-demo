/* ==================================================================
   Digital Assistant – kiosk demo
   Bez frameworkov, bez buildu, bez externých služieb.
   Kamera sa nikdy nevyžaduje.
   ================================================================== */
'use strict';

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const el = (tag, cls, txt) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

const stage    = $('#stage');
const screens  = $$('.screen');
const devPanel = $('#devPanel');   // deklarované skôr – používa ho aj kontrola spojenia

/* ------------------------------------------------------------------
   1. Škálovanie holstu 1080 × 1920
   ------------------------------------------------------------------ */
let SCALE = 1;
function fit() {
  SCALE = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
  stage.style.transform = `translate(-50%, -50%) scale(${SCALE})`;
}
window.addEventListener('resize', fit);
window.addEventListener('orientationchange', fit);
if (window.ResizeObserver) new ResizeObserver(fit).observe(document.documentElement);
fit();

/* ------------------------------------------------------------------
   2. Téma (akcentná farba) – uložená v localStorage
   ------------------------------------------------------------------ */
const THEME_KEY = 'da_theme';
function setTheme(name) {
  const t = name === 'black' ? 'black' : 'orange';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
  const sw = $('#themeSwitch');
  if (sw) sw.setAttribute('aria-checked', String(t === 'black'));
}
setTheme((() => { try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; } })());

/* ------------------------------------------------------------------
   3. Počítadlá (dev-panel) – bez osobných údajov
   ------------------------------------------------------------------ */
const STATS_KEY = 'da_stats';
const stats = Object.assign(
  { sessions: 0, leads: 0, up: 0, down: 0 },
  (() => { try { return JSON.parse(localStorage.getItem(STATS_KEY)) || {}; } catch (e) { return {}; } })()
);
function saveStats() {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (e) {}
  renderDevStats();
}

/* ------------------------------------------------------------------
   4. Vrstva avatara – jeden iframe, ktorý sa medzi stavmi len presúva
      (nikdy sa neprenáša v DOM, aby sa nereloadoval)
   ------------------------------------------------------------------ */
const avatarLayer = $('#avatarLayer');
const avatarFrame = $('#avatarFrame');
const avatarStub  = $('#avatarStub');

/* Zacyklená ukážka na IDLE: obrázok 5 s → video_m 20 s → obrázok 5 s →
   video_w 20 s → dokola. Slúži len na to, aby v pokoji nemusel bežať
   živý avatar. Mimo IDLE sa cyklus zastaví a vráti sa orb (tam bude
   neskôr skutočný avatar). */
const stubMediaEls = $$('.stub-media', avatarStub);
const STUB_CYCLE = [
  { el: stubMediaEls.find(m => m.dataset.media === 'bg'),       ms: 5000  },
  { el: stubMediaEls.find(m => m.dataset.media === 'video_m'),  ms: 20000 },
  { el: stubMediaEls.find(m => m.dataset.media === 'bg'),       ms: 5000  },
  { el: stubMediaEls.find(m => m.dataset.media === 'video_w'),  ms: 20000 },
];
let stubTimer = null;

function showStubStep(ix) {
  const step = STUB_CYCLE[ix];
  stubMediaEls.forEach(m => {
    const on = m === step.el;
    m.classList.toggle('is-on', on);
    if (m.tagName === 'VIDEO' && !on) m.pause();
  });
  if (step.el.tagName === 'VIDEO') {
    step.el.currentTime = 0;
    step.el.play().catch(() => {});
  }
  clearTimeout(stubTimer);
  stubTimer = setTimeout(() => showStubStep((ix + 1) % STUB_CYCLE.length), step.ms);
}

function startStubCycle() {
  if (stubTimer) return;                 // už beží
  showStubStep(0);
}
function stopStubCycle() {
  clearTimeout(stubTimer);
  stubTimer = null;
  stubMediaEls.forEach(m => {
    m.classList.remove('is-on');
    if (m.tagName === 'VIDEO') m.pause();
  });
}

const AVATAR_SLOT = {
  IDLE:           { r: 44 },
  CONVERSATION:   { r: 40 },
  DEVICE_3D:      { r: 32, band: true },
  PLANS:          { r: 32, band: true }
  /* COVERAGE_CHECK avatara nemá – vrstva sa tam skryje */
};

/* poloha prvku voči #stage – cez offset reťaz, aby ju neovplyvnili transformy */
function offsetRect(node) {
  let x = 0, y = 0, n = node;
  while (n && n !== stage) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
  return { x, y, w: node.offsetWidth, h: node.offsetHeight };
}

function placeAvatar(state) {
  const cfg  = AVATAR_SLOT[state];
  const slot = $(`.screen[data-screen="${state}"] .avatar-slot`);
  if (!cfg || !slot) { avatarLayer.classList.add('is-hidden'); return; }

  const r = offsetRect(slot);
  avatarLayer.classList.remove('is-hidden');
  avatarLayer.classList.toggle('is-band', !!cfg.band);
  avatarLayer.style.left   = r.x + 'px';
  avatarLayer.style.top    = r.y + 'px';
  avatarLayer.style.width  = r.w + 'px';
  avatarLayer.style.height = r.h + 'px';
  avatarLayer.style.borderRadius = (cfg.r >= 999 ? '50%' : cfg.r + 'px');
}

/* voľba pohlavia (používateľská) → engine (technický). Väzba je len v konfigurácii. */
let current = { gender: null, engine: null, url: '', agentId: '' };
let iframeWatchdog = null;
let avatarOn = false;          // beží relácia? v IDLE nikdy

function avatarConfigFor(gender) {
  return [CONFIG.avatarA, CONFIG.avatarB].find(a => a.gender === gender) || CONFIG.avatarA;
}

/* --- Widget anam.ai -------------------------------------------------
   Vlastný element <anam-agent> so shadow DOM. Skript sa načíta až pri
   prvom použití (v pokoji nesmie odísť žiadna požiadavka von) a prvok sa
   pri odchode do IDLE odstráni – tým sa relácia ukončí a kiosk stíchne. */
const anamWidget = (() => {
  const host = $('#avatarWidget');
  let node = null, scriptP = null, watchdog = null, lastError = null;

  function loadScript() {
    if (scriptP) return scriptP;
    const srcs = [CONFIG.anam.script, CONFIG.anam.scriptFallback].filter(Boolean);
    scriptP = new Promise((resolve, reject) => {
      (function next(i) {
        if (i >= srcs.length) { reject(new Error('anam widget')); return; }
        const s = document.createElement('script');
        s.src = srcs[i];
        s.async = true;
        s.onload  = () => resolve();
        s.onerror = () => { s.remove(); next(i + 1); };
        document.head.appendChild(s);
      })(0);
    });
    return scriptP;
  }

  /* Widget si drží pomer 16:9 a v zóne avatara by nechal pás prázdna.
     Shadow DOM je otvorený, takže mu doplníme štýl: video vyplní celú zónu
     (samotný <video> má object-fit: cover, orezanie rieši widget sám). */
  const SHADOW_CSS =
    '.anam-widget,.anam-sheet,.anam-video-region{' +
    'width:100%!important;height:100%!important;aspect-ratio:auto!important;' +
    'max-width:none!important;max-height:none!important;' +
    'border-radius:0!important;box-shadow:none!important}';

  /* Widget čaká na vlastné tlačidlo „call to action“. Na kiosku ho stlačíme
     sami – voľba pohlavia je používateľské gesto, mikrofón sa teda smie pýtať. */
  function prepare(n) {
    const t0 = Date.now();
    let styled = false;
    (function tick() {
      if (n !== node) return;
      const root = n.shadowRoot;
      if (root && !styled) {
        const s = document.createElement('style');
        s.textContent = SHADOW_CSS;
        root.appendChild(s);
        styled = true;
      }
      const btn = root && root.querySelector('.anam-cta-pill');
      if (btn) { if (CONFIG.anam.autostart) btn.click(); return; }
      if (Date.now() - t0 < 8000) setTimeout(tick, 120);
    })();
  }

  async function mount(cfg) {
    unmount();
    host.classList.add('is-on');
    net.setIframeOk(false);
    watchdog = setTimeout(() => net.iframeTimedOut(), CONFIG.heartbeat.iframeLoadTimeoutMs);

    try { await loadScript(); }
    catch (e) { clearTimeout(watchdog); net.iframeTimedOut(); return; }
    if (!host.classList.contains('is-on')) return;      // medzitým sme odišli do IDLE

    const n = document.createElement('anam-agent');
    n.setAttribute('agent-id', cfg.agentId);
    Object.entries(CONFIG.anam.attrs || {}).forEach(([k, v]) => n.setAttribute(k, String(v)));

    n.addEventListener('anam-agent:session-started', () => {
      clearTimeout(watchdog);
      net.setSessionLive(true);
      net.setIframeOk(true);
    });
    n.addEventListener('anam-agent:session-ended', (e) => {
      lastError = (e.detail && e.detail.reason) || 'session-ended';
      net.setSessionLive(false);
    });
    n.addEventListener('anam-agent:error', (e) => {
      lastError = (e.detail && (e.detail.message || e.detail.code)) || 'error';
      console.warn('anam:', lastError);
      clearTimeout(watchdog);
      net.setSessionLive(false);
      net.iframeTimedOut();
    });
    n.addEventListener('anam-agent:message-received', (e) => {
      const d = e.detail || {};
      if (d.role && d.role !== 'user' && d.content) subtitles.say(d.content);
    });
    n.addEventListener('anam-agent:tool-call-started', onToolCall);

    host.replaceChildren(n);
    node = n;
    prepare(n);
  }

  function unmount() {
    clearTimeout(watchdog);
    node = null;
    host.replaceChildren();
    host.classList.remove('is-on');
    net.setSessionLive(false);
  }

  /* Widget zatiaľ neponúka verejné `talk()`. Kým ho anam.ai nesprístupní,
     vieme otázku vložiť do jeho textového poľa – shadow DOM je otvorený.
     Obchádzka, preto vypnutá v konfigurácii (`anam.textBridge`).          */
  function ask(text) {
    if (!node || !text || !CONFIG.anam.textBridge) return false;
    const root = node.shadowRoot;
    const input = root && root.querySelector('.anam-ctl-input');
    if (!input) return false;
    const proto = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const send = root.querySelector('.anam-ctl-send');
    if (send) send.click();
    else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
  }

  return { mount, unmount, ask, isOn: () => !!node, lastError: () => lastError };
})();

function loadAvatar(cfg) {
  current = {
    gender: cfg.gender, engine: cfg.engine,
    url: cfg.url || '', agentId: cfg.agentId || ''
  };
  avatarOn = true;
  clearTimeout(iframeWatchdog);
  avatarFrame.classList.remove('is-on');
  avatarFrame.removeAttribute('src');
  anamWidget.unmount();

  if (cfg.engine === 'anam' && cfg.agentId) {
    avatarStub.hidden = true;
    anamWidget.mount(cfg);                // stav spojenia si riadi widget sám
  } else if (cfg.url) {
    avatarStub.hidden = true;
    avatarFrame.classList.add('is-on');
    avatarFrame.src = cfg.url;
    net.setIframeOk(false);
    iframeWatchdog = setTimeout(() => net.iframeTimedOut(), CONFIG.heartbeat.iframeLoadTimeoutMs);
  } else {                                // ukážkový režim – bez zdroja
    avatarStub.hidden = false;
    net.setIframeOk(true);
  }
  renderDevStats();
}

avatarFrame.addEventListener('load', () => { clearTimeout(iframeWatchdog); net.setIframeOk(true); });
avatarFrame.addEventListener('error', () => { clearTimeout(iframeWatchdog); net.iframeTimedOut(); });

/* Obnovenie po výpadku. V pokoji sa nesmie spustiť nič – inak by sa avatar
   sám prebudil na IDLE (a s ním aj zvuk). */
function reloadAvatarOnce() {
  if (!avatarOn) return;
  if (current.engine === 'anam' && current.agentId) { anamWidget.mount(current); return; }
  if (!current.url) return;
  avatarFrame.src = current.url;
}

/* V pokoji (IDLE) musí byť kiosk úplne bez zvuku. Cudzí iframe ani widget sa
   zvonku stlmiť nedajú, preto ich odpojíme úplne – to je jediná spoľahlivá
   záruka ticha. Znova sa načítajú až po výbere v GENDER_SELECT.             */
function unloadAvatar() {
  avatarOn = false;
  clearTimeout(iframeWatchdog);
  avatarFrame.classList.remove('is-on');
  avatarFrame.removeAttribute('src');
  anamWidget.unmount();
  avatarStub.hidden = false;
  net.setIframeOk(true);
}

/* ------------------------------------------------------------------
   5. Stavový automat
   ------------------------------------------------------------------ */
let state = null;
const onEnter = {};

function go(next) {
  if (state === next) return;
  const prev = state;
  state = next;
  stage.dataset.state = next;
  screens.forEach(s => s.classList.toggle('is-active', s.dataset.screen === next));
  placeAvatar(next);
  if (next === 'IDLE') startStubCycle(); else stopStubCycle();
  setGenderVideos(next === 'GENDER_SELECT');
  resetIdleTimer();
  if (onEnter[next]) onEnter[next](prev);
}

/* --- nečinnosť --------------------------------------------------- */
let idleTimer = null;
const SESSION_STATES = ['CONVERSATION', 'DEVICE_3D', 'PLANS',
                        'COVERAGE_CHECK', 'LEAD_CAPTURE', 'SELLER'];

function resetIdleTimer() {
  clearTimeout(idleTimer);
  if (state === 'IDLE') return;
  const ms = (state === 'FEEDBACK' ? (CONFIG.feedbackTimeoutSec || 15) : CONFIG.idleTimeoutSec) * 1000;
  idleTimer = setTimeout(() => {
    if (SESSION_STATES.includes(state)) go('FEEDBACK');
    else go('IDLE');
  }, ms);
}
['pointerdown', 'keydown', 'wheel'].forEach(ev =>
  window.addEventListener(ev, resetIdleTimer, { passive: true })
);

/* ------------------------------------------------------------------
   6. IDLE – bez zvuku, len vizuál
   ------------------------------------------------------------------ */
const IDLE_MESSAGES = [
  'Opýtajte sa ma na čokoľvek o službách Orange',
  'Skontrolujem dostupnosť služieb na Vašej adrese',
  'Ukážem Vám zariadenia z ponuky'
];
const ticker = $('#idleTicker');
const dots   = $('#idleDots');
let tickerIx = 0, tickerTimer = null;

IDLE_MESSAGES.forEach(() => dots.appendChild(el('i')));

function paintTicker() {
  ticker.replaceChildren(el('span', null, IDLE_MESSAGES[tickerIx]));
  $$('i', dots).forEach((d, i) => d.classList.toggle('on', i === tickerIx));
}
function startTicker() {
  stopTicker();
  paintTicker();
  tickerTimer = setInterval(() => {
    tickerIx = (tickerIx + 1) % IDLE_MESSAGES.length;
    paintTicker();
  }, 4500);
}
function stopTicker() { clearInterval(tickerTimer); }

onEnter.IDLE = () => {
  startTicker();
  mic.stop();                        // v pokoji je zariadenie úplne bez zvuku
  unloadAvatar();
  $$('.quick').forEach(b => b.classList.remove('is-active'));
  plans.reset();
  subtitles.clear();
  leadFlow.reset();
  coverage.reset();
};

/* prebudenie – dotyk kdekoľvek na obrazovke */
$('.screen[data-screen="IDLE"]').addEventListener('pointerdown', () => {
  if (state === 'IDLE') { stopTicker(); go('GENDER_SELECT'); }
});

/* ------------------------------------------------------------------
   7. GENDER_SELECT
   ------------------------------------------------------------------ */

/* Videá na kartách bežia len na tejto obrazovke – inde sa pauzujú,
   aby na pozadí nič nedekódovalo. Sú bez zvuku, takže pokoj ostáva tichý. */
function setGenderVideos(on) {
  $$('.gender-art').forEach(v => {
    if (on) { v.currentTime = 0; v.play().catch(() => {}); }
    else v.pause();
  });
}

$$('.gender-card').forEach(card => {
  card.addEventListener('click', () => {
    $$('.gender-card').forEach(c => c.classList.remove('is-picked'));
    card.classList.add('is-picked');
    const cfg = avatarConfigFor(card.dataset.gender);
    setTimeout(() => {
      loadAvatar(cfg);
      stats.sessions++; saveStats();
      go('CONVERSATION');
      card.classList.remove('is-picked');
    }, 260);
  });
});

/* ------------------------------------------------------------------
   8. Titulky – text repliky asistenta
   ------------------------------------------------------------------ */
const subtitles = (() => {
  const box = $('#subText');
  let timer = null, full = '', i = 0;

  function clear() { clearInterval(timer); box.replaceChildren(); full = ''; }

  function say(text) {
    clearInterval(timer);
    full = text; i = 0;
    const span = el('span');
    const cur  = el('span', 'cursor');
    box.replaceChildren(span, cur);
    timer = setInterval(() => {
      i += 2;
      span.textContent = full.slice(0, i);
      if (i >= full.length) { clearInterval(timer); setTimeout(() => cur.remove(), 500); }
    }, 26);
  }
  return { say, clear };
})();

const LINES = {
  hello:    'Dobrý deň. Som digitálny asistent Orange. S čím Vám môžem pomôcť?',
  mobile:   'Ponúkame paušály s neobmedzeným volaním v rámci Slovenska. Vyberte si, koľko dát potrebujete.',
  phones:   'Ukážem Vám telefóny z našej ponuky. Model si môžete otočiť prstom.',
  tv:       'K Orange TV máte vyše 150 programov a archív sedem dní. Mám Vám ukázať balíky?',
  internet: 'Optický internet máme do rýchlosti 1 Gb/s. Napíšte prosím adresu, overím dostupnosť.',
  seller:   'Na túto otázku Vám lepšie odpovie môj kolega. Zavolám Vám predajcu.',
  lead:     'Rád zariadim, aby sa Vám ozval náš predajca.'
};

/* ------------------------------------------------------------------
   9. CONVERSATION
   ------------------------------------------------------------------ */
onEnter.CONVERSATION = (prev) => {
  mic.start();
  if (prev === 'GENDER_SELECT') subtitles.say(LINES.hello);
};

/* Kam vedie ktorá dlaždica. Ak má kľúč blok v CONFIG.plans, otvorí sa karusel;
   inak sa použije táto tabuľka. Rozloženie sekcií sa ešte ladí – meniť sa má
   iba konfigurácia a táto tabuľka, nie kód nižšie.                          */
const QUICK_TARGET = {
  phones: 'DEVICE_3D'          // ukážka zariadení v 3D
};

/* Jedna cesta pre dotyk aj pre nástroj avatara. Keď obrazovku otvára avatar,
   titulky nechávame na ňom (`say = false`) – inak by sme prepísali jeho vetu. */
function openQuick(k, say = true) {
  const btn = $$('.quick').find(x => x.dataset.quick === k) || null;
  $$('.quick').forEach(x => x.classList.toggle('is-active', x === btn));
  if (say && LINES[k]) subtitles.say(LINES[k]);
  if (CONFIG.plans[k]) { plans.open(k); return true; }
  const target = QUICK_TARGET[k];
  if (target) { go(target); return true; }
  return false;
}

$$('.quick').forEach(b => b.addEventListener('click', () => {
  const k = b.dataset.quick;
  openQuick(k);
  anamWidget.ask(CONFIG.anam.ask && CONFIG.anam.ask[k]);   // ticho, ak je most vypnutý
}));

/* --- Nástroje avatara (client tools) ---------------------------------
   Názov nástroja v persóne na anam.ai = kľúč v tejto tabuľke. Argumenty
   prichádzajú tak, ako ich popisuje jej JSON Schema. Nič iné z widgetu
   obrazovky neovláda – toto je celý zoznam toho, čo avatar smie spraviť. */
const AVATAR_TOOLS = {
  show_section:     a => openQuick(String(a.section || '').toLowerCase(), false),
  show_devices:     a => { go('DEVICE_3D'); if (a.model) devices3d.selectById(String(a.model)); },
  check_coverage:   () => go('COVERAGE_CHECK'),
  capture_lead:     () => leadFlow.open(),
  call_seller:      () => go('SELLER'),
  end_conversation: () => go('FEEDBACK')
};

function onToolCall(e) {
  const d = e.detail || {};
  if (d.toolType && d.toolType !== 'client') return;      // serverové rieši engine sám
  const fn = AVATAR_TOOLS[d.toolName];
  if (!fn) { console.warn('anam: neznámy nástroj', d.toolName); return; }
  resetIdleTimer();
  try { fn(d.arguments || {}); }
  catch (err) { console.error('anam: nástroj zlyhal', d.toolName, err); }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-action]');
  if (!t) return;
  switch (t.dataset.action) {
    case 'wake':       stopTicker(); go('GENDER_SELECT'); break;
    case 'seller':     toSeller(); break;
    case 'back-conv':  go('CONVERSATION'); break;
    case 'lead':       leadFlow.open(); break;
    case 'plans-cta':  plans.next(); break;
    case 'end':        go('FEEDBACK'); break;
  }
});

function toSeller() {
  subtitles.say(LINES.seller);
  go('SELLER');
}

/* ------------------------------------------------------------------
   10. Indikátor mikrofónu – len úroveň zvuku, nič sa nenahráva
   ------------------------------------------------------------------ */
const mic = (() => {
  const wrap  = $('#micIndicator');
  const barsW = $('#micBars');
  const label = $('#micLabel');
  const BARS  = 14;
  const bars  = [];
  for (let i = 0; i < BARS; i++) { const b = el('i'); barsW.appendChild(b); bars.push(b); }

  let ctx = null, analyser = null, stream = null, raf = null, data = null, denied = false;

  function paintIdleBars() { bars.forEach(b => (b.style.height = '8px')); }

  function loop() {
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i];
    const avg = sum / data.length / 255;
    bars.forEach((b, i) => {
      const w = 0.45 + 0.55 * Math.sin((i / BARS) * Math.PI);
      const h = 8 + Math.min(1, avg * 3.4) * 38 * w * (0.75 + Math.random() * 0.5);
      b.style.height = h.toFixed(1) + 'px';
    });
    avatarStub.style.setProperty('--lvl', (1 + Math.min(0.18, avg * 0.7)).toFixed(3));
    raf = requestAnimationFrame(loop);
  }

  async function start() {
    if (ctx || denied) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { off('Mikrofón nie je k dispozícii'); return; }
    try {
      stream   = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      ctx      = new (window.AudioContext || window.webkitAudioContext)();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      data = new Uint8Array(analyser.frequencyBinCount);
      ctx.createMediaStreamSource(stream).connect(analyser);   // nikam sa nenahráva
      wrap.classList.remove('is-off');
      label.textContent = 'Počúvam…';
      loop();
    } catch (e) {
      denied = true;
      off('Mikrofón nie je k dispozícii');
    }
  }

  function off(text) {
    wrap.classList.add('is-off');
    label.textContent = text;
  }

  function stop() {
    cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach(t => t.stop());
    if (ctx) ctx.close();
    ctx = null; analyser = null; stream = null;
    paintIdleBars();
    avatarStub.style.setProperty('--lvl', 1);
  }

  paintIdleBars();
  return { start, stop };
})();

/* ------------------------------------------------------------------
   11. LEAD_CAPTURE – súhlas pred zadaním čísla, číslo sa nikam neukladá
   ------------------------------------------------------------------ */

/* Zástupná integrácia. V produkcii sem ide zašifrovaný API kľúč
   a zápis do priečinka „Leady z avatara“ (CB24). V deme sa nič neodosiela. */
function submitLead(phone) {
  void phone;                       // číslo sa zámerne nikam nepredáva ani neloguje
  console.log('lead created');      // v logoch maskované – bez čísla
  return Promise.resolve({ ok: true });
}

const leadFlow = (() => {
  const steps   = $$('.lead-step');
  const check   = $('#consentCheck');
  const nextBtn = $('#btnConsentNext');
  const digitsEl = $('#phoneDigits');
  const hint    = $('#phoneHint');
  let digits = '', consent = false, doneTimer = null;

  function show(name) {
    steps.forEach(s => (s.hidden = s.dataset.step !== name));
  }

  function reset() {
    clearTimeout(doneTimer);
    digits = ''; consent = false;
    check.setAttribute('aria-pressed', 'false');
    nextBtn.disabled = true;
    paintPhone();
    show('offer');
  }

  function open() {
    reset();
    subtitles.say(LINES.lead);
    go('LEAD_CAPTURE');
  }

  function paintPhone() {
    digitsEl.textContent = digits.replace(/(\d{3})(?=\d)/g, '$1 ');
    const ok = digits.length === 9;
    hint.textContent = ok ? 'Číslo je pripravené na odoslanie' : `Zadajte 9 číslic (${digits.length}/9)`;
    hint.classList.toggle('is-ok', ok);
    $('#btnSubmitLead').disabled = !ok;
  }

  check.addEventListener('click', () => {
    consent = !consent;
    check.setAttribute('aria-pressed', String(consent));
    nextBtn.disabled = !consent;
  });

  nextBtn.addEventListener('click', () => { if (consent) show('phone'); });

  $$('[data-lead]').forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.lead;
    if (a === 'accept')  show('privacy');
    if (a === 'decline' || a === 'cancel') go('CONVERSATION');
  }));

  /* číselná klávesnica – prsty, nie myš */
  const pad = $('#numpad');
  const keys = ['1','2','3','4','5','6','7','8','9','Zmazať','0','Odoslať'];
  keys.forEach(k => {
    const isFn = k === 'Zmazať' || k === 'Odoslať';
    const b = el('button', 'key' + (isFn ? ' k-fn' : ''), k);
    if (k === 'Odoslať') { b.id = 'btnSubmitLead'; b.classList.add('key-send'); b.disabled = true; }
    b.addEventListener('click', () => {
      if (k === 'Zmazať')      digits = digits.slice(0, -1);
      else if (k === 'Odoslať') return send();
      else if (digits.length < 9) digits += k;
      paintPhone();
    });
    pad.appendChild(b);
  });

  async function send() {
    if (digits.length !== 9) return;
    await submitLead(CONFIG.phonePrefix + digits);
    digits = '';                    // číslo hneď zabúdame
    paintPhone();
    stats.leads++; saveStats();
    show('done');
    doneTimer = setTimeout(() => go('CONVERSATION'), 5000);
  }

  paintPhone();
  return { open, reset, show };
})();

$('#phonePrefix').textContent = CONFIG.phonePrefix;

/* ------------------------------------------------------------------
   12. DEVICE_3D
   ------------------------------------------------------------------ */
const devices3d = (() => {
  const strip  = $('#deviceStrip');
  const host   = $('#viewerHost');
  let active = null;

  CONFIG.devices.forEach((d, i) => {
    const c = el('button', 'dev-card');
    c.dataset.id = d.id;
    c.appendChild(el('div', 'dc-name', d.name));
    if (d.size) c.appendChild(el('div', 'dc-size', d.size));
    c.addEventListener('click', () => select(i));
    strip.appendChild(c);
  });

  function markActive(i) {
    $$('.dev-card', strip).forEach((c, ix) => c.classList.toggle('is-active', ix === i));
  }

  /* Jeden iframe, ktorý medzi kioskami len prepína src – stránky majú
     vlastné skripty a rovnaké id, priamo do DOM sa vložiť nedajú. */
  function ensureFrame() {
    let f = host.querySelector('iframe');
    if (!f) {
      f = document.createElement('iframe');
      f.className = 'totem-frame';
      f.title = '3D model kiosku';
      f.setAttribute('loading', 'lazy');
      host.replaceChildren(f);
    }
    return f;
  }

  function select(i) {
    const d = CONFIG.devices[i];
    if (!d) return;
    active = i;
    markActive(i);
    subtitles.say(`${d.name} – otáčajte ho prstom. Rád Vám poviem viac.`);

    if (!d.page) { host.replaceChildren(); return; }
    const f = ensureFrame();
    if (f.getAttribute('src') !== d.page) f.setAttribute('src', d.page);
  }

  /* pre nástroj avatara: id z konfigurácie (totem1…) alebo názov stránky */
  function selectById(id) {
    const i = CONFIG.devices.findIndex(d => d.id === id || d.page === id);
    if (i < 0) return false;
    select(i);
    return true;
  }

  return { first: () => select(active == null ? 0 : active), selectById };
})();

onEnter.DEVICE_3D = () => devices3d.first();

/* ------------------------------------------------------------------
   13. PLANS – karusel ponuky (Internet, Televízia, …)
        Jedna obrazovka pre všetky sekcie, obsah berie z CONFIG.plans.
   ------------------------------------------------------------------ */
const plans = (() => {
  const strip = $('#planStrip');
  const thumb = $('#planThumb');
  const title = $('#plansTitle');
  const cta   = $('#plansCta');
  let group = null, picked = null;

  const CHECK = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" ' +
                'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
                '<path d="m4 12.6 5 5L20 6.5"/></svg>';

  function card(p) {
    const c = el('article', 'plan' + (p.recommended ? ' is-recommended' : ''));
    c.dataset.id = p.id;

    c.appendChild(el('div', 'plan-flag', p.recommended ? 'Odporúčame' : ''));
    c.appendChild(el('div', 'plan-name', p.name));
    const top = el('div', 'plan-top');
    top.appendChild(el('div', 'plan-head', p.headline));
    if (p.sub) top.appendChild(el('div', 'plan-sub', p.sub));
    c.appendChild(top);
    if (p.note) c.appendChild(el('p',  'plan-note', p.note));

    const price = el('div', 'plan-price');
    price.appendChild(el('div', 'plan-old', p.priceOld || ''));   // prázdny riadok drží zarovnanie
    const now = el('div', 'plan-now');
    now.append(el('b', null, p.price), el('span', null, p.unit || '€/mes.'));
    price.appendChild(now);
    if (p.commitment) price.appendChild(el('div', 'plan-term', p.commitment));
    c.appendChild(price);

    const pick = el('button', 'btn btn-primary', 'Vybrať');
    pick.addEventListener('click', () => select(p, c));
    c.appendChild(pick);

    if (p.benefits && p.benefits.length) {
      const ul = el('ul', 'plan-benefits');
      p.benefits.forEach(b => {
        const li = el('li');
        const ico = el('span', 'bx');
        ico.innerHTML = CHECK;
        li.append(ico, el('span', null, b));
        ul.appendChild(li);
      });
      c.appendChild(ul);
    }
    return c;
  }

  function select(p, node) {
    picked = p.id;
    $$('.plan', strip).forEach(n => n.classList.toggle('is-picked', n === node));
    subtitles.say(`${p.name} za ${p.price} ${p.unit || '€/mes.'} Skontrolujem, či je na Vašej adrese dostupná.`);
    node.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  function open(key) {
    const g = CONFIG.plans[key];
    if (!g) return;
    group = g; picked = null;
    title.textContent = g.title || '';
    cta.textContent   = g.cta || '';
    strip.replaceChildren(...g.items.map(card));
    strip.scrollLeft = 0;
    paintBar();
    go('PLANS');
  }

  function next() { go((group && group.next) || 'COVERAGE_CHECK'); }

  /* ukazovateľ posunu */
  function paintBar() {
    const ratio = strip.clientWidth / (strip.scrollWidth || 1);
    const max = strip.scrollWidth - strip.clientWidth;
    thumb.style.width = Math.min(100, ratio * 100).toFixed(1) + '%';
    const pos = max > 0 ? strip.scrollLeft / max : 0;
    thumb.style.transform = `translateX(${(pos * (100 / ratio - 100)).toFixed(2)}%)`;
  }
  strip.addEventListener('scroll', paintBar, { passive: true });

  /* ťahanie myšou – aby sa karusel dal ukázať aj na notebooku */
  let dragging = false, startX = 0, startLeft = 0, moved = 0;
  strip.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch') return;          // dotyk rieši prehliadač sám
    dragging = true; moved = 0;
    startX = e.clientX; startLeft = strip.scrollLeft;
    strip.classList.add('is-dragging');
  });
  strip.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = (e.clientX - startX) / SCALE;
    moved = Math.max(moved, Math.abs(dx));
    strip.scrollLeft = startLeft - dx;
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
    strip.addEventListener(ev, () => {
      if (!dragging) return;
      dragging = false;
      strip.classList.remove('is-dragging');
    })
  );
  /* ťahanie nesmie zároveň stlačiť tlačidlo na karte */
  strip.addEventListener('click', e => { if (moved > 8) { e.stopPropagation(); e.preventDefault(); } }, true);

  function reset() {
    picked = null;
    $$('.plan', strip).forEach(n => n.classList.remove('is-picked'));
    strip.scrollLeft = 0;
    paintBar();
  }

  return { open, next, reset, picked: () => picked };
})();

/* ------------------------------------------------------------------
   14. COVERAGE_CHECK
   ------------------------------------------------------------------ */
const coverage = (() => {
  const valueEl = $('#addrValue');
  const sugEl   = $('#addrSuggests');
  const resEl   = $('#coverageResult');
  const kb      = $('#skKeyboard');
  const order   = $('#btnOrder');
  let text = '', layout = 'abc';

  const LAYOUTS = {
    abc: [
      ['1','2','3','4','5','6','7','8','9','0'],
      ['q','w','e','r','t','z','u','i','o','p'],
      ['a','s','d','f','g','h','j','k','l','ô'],
      ['y','x','c','v','b','n','m','á','í','é']
    ],
    dia: [
      ['á','ä','č','ď','é','í','ĺ','ľ','ň','ó'],
      ['ô','ŕ','š','ť','ú','ý','ž','.',',','-'],
      ['q','w','e','r','t','z','u','i','o','p'],
      ['a','s','d','f','g','h','j','k','l','m']
    ]
  };

  function buildKb() {
    kb.replaceChildren();
    LAYOUTS[layout].forEach(row => {
      const r = el('div', 'kb-row');
      row.forEach(ch => {
        const b = el('button', 'key', ch);
        b.addEventListener('click', () => type(ch));
        r.appendChild(b);
      });
      kb.appendChild(r);
    });

    const last = el('div', 'kb-row');
    const tgl  = el('button', 'key k-fn', layout === 'abc' ? 'áäč' : 'abc');
    tgl.addEventListener('click', () => { layout = layout === 'abc' ? 'dia' : 'abc'; buildKb(); });
    const space = el('button', 'key k-space', 'medzera');
    space.addEventListener('click', () => type(' '));
    const del = el('button', 'key k-fn', 'Zmazať');
    del.addEventListener('click', () => { text = text.slice(0, -1); paint(); });
    last.append(tgl, space, del);
    kb.appendChild(last);
  }

  function type(ch) { if (text.length < 40) { text += ch; paint(); } }

  function norm(s) {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function paint() {
    valueEl.textContent = text;
    resEl.hidden = true;
    order.disabled = true;
    const q = norm(text.trim());
    sugEl.replaceChildren();
    if (q.length < 2) return;
    CONFIG.addresses
      .filter(a => norm(a.q).includes(q))
      .slice(0, 3)
      .forEach((a, i) => {
        const b = el('button', 'suggest');
        b.style.animationDelay = (i * 50) + 'ms';
        const ico = el('span', 's-ico');
        ico.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 21.5s7-6.3 7-11.4A7 7 0 0 0 5 10.1c0 5.1 7 11.4 7 11.4Z"/><circle cx="12" cy="10" r="2.6"/></svg>';
        b.append(ico, el('span', null, a.q));
        b.addEventListener('click', () => result(a));
        sugEl.appendChild(b);
      });
  }

  function result(a) {
    text = a.q;
    valueEl.textContent = text;
    sugEl.replaceChildren();
    resEl.replaceChildren();
    resEl.appendChild(el('div', 'res-addr', a.q));

    const rows = [
      { ok: a.optika, label: a.optika ? 'Optika – dostupná' : 'Optika – nedostupná' },
      { ok: a.mobil,  label: a.mobil  ? '4G/5G – dostupné'  : '4G/5G – nedostupné' }
    ];
    rows.forEach(r => {
      const row = el('div', 'res-row ' + (r.ok ? 'ok' : 'no'));
      row.append(el('span', 'dot'), el('span', null, r.label));
      resEl.appendChild(row);
    });
    resEl.hidden = false;
    order.disabled = false;

    subtitles.say(a.optika
      ? 'Na tejto adrese je dostupná optika aj mobilná sieť. Mám Vám pripraviť ponuku?'
      : 'Na tejto adrese zatiaľ optiku nemáme. Dostupný je mobilný internet 4G a 5G.');
  }

  function reset() { text = ''; layout = 'abc'; buildKb(); paint(); }

  order.addEventListener('click', () => leadFlow.open());
  buildKb(); paint();
  return { reset };
})();

/* ------------------------------------------------------------------
   15. FEEDBACK
   ------------------------------------------------------------------ */
onEnter.FEEDBACK = () => {
  $('.fb-ask').hidden = false;
  $('.fb-thanks').hidden = true;
  $$('.fb-btn').forEach(b => b.classList.remove('is-picked'));
  mic.stop();
};

$$('.fb-btn').forEach(b => b.addEventListener('click', () => {
  b.classList.add('is-picked');
  if (b.dataset.fb === 'up') stats.up++; else stats.down++;
  saveStats();
  setTimeout(() => {
    $('.fb-ask').hidden = true;
    $('.fb-thanks').hidden = false;
    setTimeout(() => go('IDLE'), 1800);
  }, 300);
}));

/* ------------------------------------------------------------------
   16. Kontrola pripojenia k internetu
       tri zdroje: udalosti prehliadača, heartbeat, zlyhanie iframu
   ------------------------------------------------------------------ */
const net = (() => {
  const overlay = $('#offlineOverlay');
  const title   = $('#offlineTitle');
  const text    = $('#offlineText');

  const TEXTS = {
    technical: { t: 'Žiadne pripojenie k internetu', p: 'Skontrolujte pripojenie k internetu.' },
    customer:  { t: 'Momentálne prebieha aktualizácia', p: 'Obráťte sa prosím na predajcu.' }
  };

  let fails = 0, online = true, forced = false, iframeOk = true, lastOk = null, timer = null;
  let hbActive = false, sessionLive = false;

  function probeUrl() {
    if (CONFIG.heartbeat.url) return CONFIG.heartbeat.url;
    const src = CONFIG.avatarA.url || CONFIG.avatarB.url || current.url;
    if (src) { try { return new URL(src).origin + '/favicon.ico'; } catch (e) {} }
    /* widget nemá vlastnú URL – kontrolujeme dostupnosť rozhrania anam.ai */
    const anamOn = [CONFIG.avatarA, CONFIG.avatarB].some(a => a.engine === 'anam' && a.agentId);
    if (anamOn && CONFIG.anam.probeUrl) return CONFIG.anam.probeUrl;
    return null;                              // bez URL beží len detekcia z prehliadača
  }

  /* Živá relácia avatara je lepší dôkaz spojenia než sonda: keď beží WebRTC
     stream, heartbeat ani zlyhanie sondy prekrytie nezapnú. Bez relácie
     (IDLE, iframe, ukážkový režim) sa rozhoduje po starom.                 */
  function render() {
    const bad = forced || (!sessionLive && (!online || !iframeOk));
    const cfg = TEXTS[CONFIG.offlineMode] || TEXTS.technical;
    title.textContent = cfg.t;
    text.textContent  = cfg.p;
    if (bad === !overlay.hidden) { renderDevStats(); return; }
    overlay.hidden = !bad;
    if (!bad) reloadAvatarOnce();             // po obnove spojenia jeden reload, stav ostáva
    renderDevStats();
  }

  async function beat() {
    const url = probeUrl();
    if (!url) { hbActive = false; render(); return; }
    hbActive = true;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), CONFIG.heartbeat.timeoutMs);
    try {
      await fetch(url + (url.includes('?') ? '&' : '?') + '_=' + Date.now(),
        { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
      clearTimeout(to);
      fails = 0; lastOk = new Date();          // jeden úspech => späť online
      if (!online) { online = true; render(); } else renderDevStats();
    } catch (e) {
      clearTimeout(to);
      fails++;
      if (fails >= CONFIG.heartbeat.failuresToOffline && online) { online = false; render(); }
      else renderDevStats();
    }
  }

  window.addEventListener('offline', () => { online = false; fails = CONFIG.heartbeat.failuresToOffline; render(); });
  window.addEventListener('online',  () => { fails = 0; online = true; lastOk = new Date(); render(); beat(); });

  timer = setInterval(beat, CONFIG.heartbeat.intervalMs);
  beat();

  return {
    force(v) { forced = v; render(); },
    isForced: () => forced,
    setIframeOk(v) { if (iframeOk !== v) { iframeOk = v; render(); } },
    iframeTimedOut() { iframeOk = false; render(); },
    setSessionLive(v) { if (sessionLive !== v) { sessionLive = v; render(); } },
    status: () => ({
      ok: !(forced || (!sessionLive && (!online || !iframeOk))),
      lastOk, forced, hbActive, sessionLive, iframeOk,
      probe: online, probeUrl: probeUrl(),
      onLine: navigator.onLine
    })
  };
})();

/* ------------------------------------------------------------------
   17. Dev-panel – trojitý dotyk vpravo hore
   ------------------------------------------------------------------ */
let taps = [], fps = 0;

$('#devHotspot').addEventListener('pointerdown', () => {
  const now = Date.now();
  taps = taps.filter(t => now - t < 1600);
  taps.push(now);
  if (taps.length >= 3) { taps = []; devPanel.hidden = !devPanel.hidden; renderDevStats(); }
});
$('#devClose').addEventListener('click', () => (devPanel.hidden = true));

$('#themeSwitch').addEventListener('click', (e) => {
  const toBlack = e.currentTarget.getAttribute('aria-checked') !== 'true';
  setTheme(toBlack ? 'black' : 'orange');
});

$('#devOffline').addEventListener('click', (e) => {
  const on = !net.isForced();
  net.force(on);
  e.currentTarget.classList.toggle('on', on);
});
$('#devReset').addEventListener('click', () => { devPanel.hidden = true; go('IDLE'); });

function renderDevStats() {
  if (!devPanel || devPanel.hidden) return;
  const s = net.status();
  const rows = [
    ['Stav',        state],
    ['Pohlavie',    current.gender || '—'],
    ['Avatar',      current.engine ? current.engine + (anamWidget.isOn() ? ' · vložený' : '') : '—'],
    ['Relácia',     `<span class="${s.sessionLive ? 'st-on' : 'st-off'}">${s.sessionLive ? 'beží' : (anamWidget.lastError() || '—')}</span>`],
    ['Spojenie',    `<span class="${s.ok ? 'st-on' : 'st-off'}">${s.ok ? 'online' : 'offline'}</span>`],
    ['Sonda',       `<span class="${s.probe ? 'st-on' : 'st-off'}">${s.probe ? 'ok' : 'zlyháva'}</span>` +
                    (s.lastOk ? ' · ' + s.lastOk.toLocaleTimeString('sk-SK') : '')],
    ['Relácie',     stats.sessions],
    ['Leady',       stats.leads],
    ['Palec hore',  stats.up],
    ['Palec dole',  stats.down],
    ['FPS',         fps]
  ];
  $('#devStats').innerHTML = rows.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
}

(function fpsLoop() {
  let last = performance.now(), frames = 0;
  function tick(now) {
    frames++;
    if (now - last >= 1000) { fps = frames; frames = 0; last = now; renderDevStats(); }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();

/* ------------------------------------------------------------------
   18. Logo a štart
   ------------------------------------------------------------------ */
(function initLogo() {
  const box = $('#logo');
  if (!CONFIG.logo || !CONFIG.logo.show) { box.style.display = 'none'; return; }
  if (CONFIG.logo.src) {
    const img = document.createElement('img');
    img.src = CONFIG.logo.src;
    img.alt = '';
    box.replaceChildren(img);
    return;
  }
  /* Vykreslený štvorec so slovom v ľavom dolnom rohu – tvar značky
     bez značkového slova (viď config.logo.text). */
  const tile = el('div', 'logo-tile');
  const word = el('span', 'logo-word', CONFIG.logo.text || '');
  word.appendChild(el('sup', 'logo-tm', '™'));
  tile.appendChild(word);
  box.replaceChildren(tile);
})();

go('IDLE');
