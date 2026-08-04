/* ==================================================================
   Zámok na celé demo (Vercel Routing Middleware).

   Beží pred CDN a na KAŽDEJ ceste. Bez platnej pečiatky sa von
   nedostane ani jeden súbor projektu – ani `index.html`, ani `app.js`,
   ani `config.js`, ani videá. Návštevník bez kódu vidí iba klávesnicu.

   Prečo nie kontrola v prehliadači: demo je statické, súbory ležia na
   CDN a dajú sa stiahnuť priamo. Kontrola v JavaScripte by pustila
   ku všetkému každého, kto otvorí `view-source:` – a samotný kód by
   ležal v tom istom skripte.

   Dve pečiatky, každá s vlastnou životnosťou:
     k_doc  – právo na jedno otvorenie stránky, platí len DOC_TTL sekúnd.
              Preto obnovenie stránky pýta kód znova.
     k_ast  – právo na súbory (skripty, štýly, videá, fonty). Musí prežiť
              celý čas ukážky, inak by sa v polovici prestali dogrúžať.

   Obe sú podpísané HMAC-om, takže sa nedajú vyrobiť bez SECRET.
   ================================================================== */

/* Kód a podpisový kľúč sú tu naschvál – tak si to objednávateľ vybral,
   aby nebolo treba nič nastavovať v kabinete Vercelu. Cena: kto vidí
   repozitár, vidí aj kód, a zostáva v histórii gitu navždy. Presun do
   premennej prostredia je jednoriadková zmena: process.env.KIOSK_PIN. */
const PIN    = '050505';
const SECRET = 'k9Qm2Xr7vT4pLz8wYd3NbHs6Jc1FgA5e';

const DOC_TTL   = 20;             // s – akurát na preklik po zadaní kódu
const ASSET_TTL = 60 * 60 * 12;   // 12 h – na celý deň ukážky

const DOC_COOKIE   = 'k_doc';
const ASSET_COOKIE = 'k_ast';

/* ── podpis ──────────────────────────────────────────────────────── */

const enc = new TextEncoder();

async function key() {
  return crypto.subtle.importKey(
    'raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
}

async function sign(scope, exp) {
  const mac = await crypto.subtle.sign('HMAC', await key(), enc.encode(scope + ':' + exp));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  return exp + '.' + hex;
}

/* Porovnanie v konštantnom čase – aby sa podpis nedal uhádnuť po znakoch. */
function same(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function valid(scope, token) {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot < 1) return false;
  const exp = Number(token.slice(0, dot));
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return false;
  return same(token, await sign(scope, exp));
}

function cookies(header) {
  const out = {};
  (header || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}

function stamp(name, value, ttl) {
  return `${name}=${value}; Path=/; Max-Age=${ttl}; HttpOnly; Secure; SameSite=Lax`;
}

/* ── stránka s klávesnicou ───────────────────────────────────────── */
/* Zámerne neprezrádza nič o tom, čo je za ňou: bez názvu, bez loga,
   bez odkazov. Je vložená celá tu, aby si nepýtala žiadny ďalší súbor
   – tie sú predsa zamknuté.                                          */
function gate() {
  const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>—</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{min-height:100vh;display:grid;place-items:center;background:#141414;
       color:#fff;font:400 16px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .box{width:min(92vw,460px);text-align:center}
  .dots{display:flex;justify-content:center;gap:18px;margin-bottom:44px;min-height:26px}
  .dots i{width:22px;height:22px;border-radius:50%;border:2px solid #666;transition:.15s}
  .dots i.on{background:#FF7900;border-color:#FF7900}
  .pad{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
  button{height:88px;font-size:34px;font-weight:500;color:#fff;background:#333;
         border:2px solid #666;border-radius:14px;cursor:pointer}
  button:active{background:#FF7900;border-color:#FF7900;color:#000}
  button.blank{background:transparent;border-color:transparent;cursor:default}
  .err{margin-top:28px;min-height:26px;font-size:20px;color:#FF7900;opacity:0;transition:.2s}
  .err.on{opacity:1}
  .shake{animation:s .4s}
  @keyframes s{25%{transform:translateX(-9px)}75%{transform:translateX(9px)}}
</style>
<div class="box">
  <div class="dots" id="d"><i></i><i></i><i></i><i></i><i></i><i></i></div>
  <div class="pad" id="p">
    <button>1</button><button>2</button><button>3</button>
    <button>4</button><button>5</button><button>6</button>
    <button>7</button><button>8</button><button>9</button>
    <button class="blank" disabled></button><button>0</button><button data-del>⌫</button>
  </div>
  <div class="err" id="e">Nesprávny kód</div>
</div>
<script>
  var pin = '', busy = false;
  var dots = document.getElementById('d'), err = document.getElementById('e');
  function paint(){
    [].forEach.call(dots.children, function(el,i){ el.className = i < pin.length ? 'on' : ''; });
  }
  function fail(){
    err.classList.add('on'); dots.classList.add('shake');
    setTimeout(function(){ dots.classList.remove('shake'); }, 400);
    pin = ''; paint();
  }
  function submit(){
    busy = true;
    fetch('/__unlock', {
      method:'POST', headers:{'content-type':'application/json'},
      body: JSON.stringify({ pin: pin })
    }).then(function(r){
      if (r.ok) { location.replace('/'); return; }
      busy = false; fail();
    }).catch(function(){ busy = false; fail(); });
  }
  document.getElementById('p').addEventListener('click', function(ev){
    var b = ev.target.closest('button'); if (!b || busy) return;
    err.classList.remove('on');
    if (b.hasAttribute('data-del')) { pin = pin.slice(0,-1); paint(); return; }
    if (pin.length >= 6) return;
    pin += b.textContent.trim(); paint();
    if (pin.length === 6) submit();
  });
  document.addEventListener('keydown', function(ev){
    if (busy) return;
    if (ev.key === 'Backspace') { pin = pin.slice(0,-1); paint(); return; }
    if (!/^[0-9]$/.test(ev.key) || pin.length >= 6) return;
    err.classList.remove('on');
    pin += ev.key; paint();
    if (pin.length === 6) submit();
  });
</script>`;
  return new Response(html, {
    status: 401,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      'x-robots-tag': 'noindex, nofollow'
    }
  });
}

/* ── samotný filter ──────────────────────────────────────────────── */

export default async function middleware(request) {
  const url = new URL(request.url);

  /* Overenie kódu. Odpoveď nesie obe pečiatky naraz. */
  if (url.pathname === '/__unlock') {
    if (request.method !== 'POST') return new Response(null, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const given = String((body && body.pin) || '');

    if (!same(given, PIN)) {
      /* Malé zdržanie proti hádaniu naslepo. Nie je to plnohodnotné
         obmedzovanie pokusov – to by si vyžiadalo úložisko. */
      await new Promise(r => setTimeout(r, 600));
      return new Response('{"ok":false}', {
        status: 401,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
      });
    }

    const now = Math.floor(Date.now() / 1000);
    const headers = new Headers({
      'content-type': 'application/json',
      'cache-control': 'no-store'
    });
    headers.append('set-cookie', stamp(DOC_COOKIE,   await sign('doc', now + DOC_TTL),   DOC_TTL));
    headers.append('set-cookie', stamp(ASSET_COOKIE, await sign('ast', now + ASSET_TTL), ASSET_TTL));
    return new Response('{"ok":true}', { status: 200, headers });
  }

  const jar  = cookies(request.headers.get('cookie'));
  const dest = request.headers.get('sec-fetch-dest');

  /* Otvorenie stránky vs. dotiahnutie súboru. Prehliadač to povie sám;
     keď hlavičku neposiela (curl, robot), rozhodne prípona – a taká
     požiadavka aj tak nemá pečiatku, takže sa nič neprezradí.
     Stránky stojanov idú do <iframe>, ten má dest = 'iframe', a preto
     spadá pod súbory – inak by si po 20 sekundách pýtal kód. */
  const isPage = dest
    ? dest === 'document'
    : (url.pathname === '/' || url.pathname.endsWith('.html'));

  if (isPage) {
    if (await valid('doc', jar[DOC_COOKIE])) return;    // ďalej na statiku
    return gate();
  }

  if (await valid('ast', jar[ASSET_COOKIE])) return;

  /* Nepotvrdzujeme ani existenciu súboru. */
  return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
}
