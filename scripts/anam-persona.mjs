#!/usr/bin/env node
/* ==================================================================
   Nastaví persóne systémový prompt a úvodnú vetu.
   Prompt sa edituje v scripts/persona-prompt.md, nie tu.

   KTO ČO VLASTNÍ
   Skript prepisuje výhradne to, čo v repozitári leží ako súbor:
     systemPrompt    ← scripts/persona-prompt.md
     initialMessage  ← konštanta GREETING nižšie; jediný zdroj pozdravu,
                       kiosk už vlastný nemá

   Jazyk, hlas a jeho nastavenia patria kabinetu. Skript ich sám od seba
   NEPREPISUJE – nech sa dajú ladiť na počúvanie bez toho, aby ich ďalší
   beh vrátil späť. Poslať sa dajú len na výslovné želanie:

     --language   pošle languageCode (LANGUAGE nižšie)
     --voice      pošle voiceGenerationOptions (VOICE nižšie)

   Rozdiel oproti kabinetu sa vypíše vždy, aj bez tých prepínačov – ale
   ako správa, nie ako niečo, čo sa ide opraviť.

   Spustenie:
     ANAM_API_KEY=… node scripts/anam-persona.mjs --dry-run
     ANAM_API_KEY=… node scripts/anam-persona.mjs
     ANAM_API_KEY=… node scripts/anam-persona.mjs --language --voice

   Nástroje sa tu neriešia – tie zakladá scripts/anam-tools.mjs.
   ================================================================== */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API     = 'https://api.anam.ai/v1';
const KEY     = process.env.ANAM_API_KEY;
const PERSONA = process.env.ANAM_PERSONA_ID || '5584933e-43bc-428c-9d9b-015922821e71';
const DRY      = process.argv.includes('--dry-run');
const PUSH_LANG  = process.argv.includes('--language');
const PUSH_VOICE = process.argv.includes('--voice');

/* Úvodná veta – prvé, čo návštevník počuje aj uvidí. Bez názvu operátora.

   Jediný zdroj pozdravu. Kiosk mal kedysi vlastný v `LINES.hello` a vypisoval
   ho do titulkov hneď po výbere avatara; texty sa rozišli a návštevník dostal
   dva pozdravy za sebou. Teraz titulky píše iba avatar, keď vetu naozaj
   povie – kým sa relácia dvíha, je pruh titulkov prázdny.

   Krátka je zámerne. Dlhšia verzia s vymenovaním sekcií zaberala v titulkoch
   presne štyri riadky, teda celý priestor bez rezervy – a sekcie má aj tak
   pred sebou na dlaždiciach. Kratší pozdrav navyše skôr začne (odporúčanie
   Anamu k latencii).                                                        */
const GREETING = 'Dobrý deň. Som digitálny prezentér Humion. S čím Vám môžem pomôcť?';

/* Východiskový jazyk rozpoznávania reči. Posiela sa len s `--language`:
   na persóne sa skúšajú aj iné jazyky a beh skriptu ich nemá zhadzovať.
   `languageCode` riadi IBA to, čo avatar počuje. Čím odpovedá, určuje
   prompt; ako znie, určuje zvolený hlas. Tie tri sa musia zhodovať.     */
const LANGUAGE = 'sk';

/* Nastavenie hlasu podľa odporúčania Anamu pre živé retailové demo
   (Hannah Tier, 5. 8. 2026). Patrí do `voiceGenerationOptions`, nie do
   `directorNotes` – tie riadia hranie avatara a `content` medzi ich
   štýlmi nie je. Rozsahy pre Cartesia sonic-3: speed 0,6–1,5,
   emotion neutral | calm | angry | content | sad | scared.
   Pozor: pri zmene `voiceId` sa tieto voľby na strane Anamu vynulujú.

   Posiela sa len s `--voice`. Platí pre Cartesiu; hlasy ElevenLabs majú
   iné polia (stability, similarityBoost, speed 0,7–1,2) a `emotion`
   nepoznajú – preto sa to nesmie posielať naslepo každej persóne.       */
const VOICE = { speed: 1.05, emotion: 'content' };

if (!KEY) {
  console.error('Chýba ANAM_API_KEY. Spustenie: ANAM_API_KEY=… node scripts/anam-persona.mjs');
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' }
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return body;
}

const trim = s => (s || '').replace(/\s+/g, ' ').trim();

/* --- Prehľad ponuky ------------------------------------------------
   Nepíše sa ručne, ale sa poskladá z config.js. Ručne písaný by sa pri
   prvej zmene cenníka rozišiel s tým, čo má návštevník na obrazovke, a
   model by tvrdil jedno, kým karta ukazuje druhé.

   Ceny sa zámerne vynechávajú: má ich na obrazovke a nahlas ich čítať
   nemá. Sumy zliav v `note` idú s ním – tie sú súčasťou opisu ponuky.

   Vkladá sa na miesto značky <!-- OFFER --> v persona-prompt.md.      */
async function offerSection() {
  const src = await readFile(join(here, '..', 'config.js'), 'utf8');
  const body = src.slice(src.indexOf('{'), src.lastIndexOf('}') + 1);
  const CONFIG = new Function('return (' + body + ')')();

  const L = ['# THE OFFER', '',
    'This is everything the kiosk shows right now. These are the only product',
    'facts you have — answer and compare from this list, and never invent',
    'anything beyond it. Prices are printed on the screen, so do not read them',
    'out loud; talk about what each option gives instead.', ''];

  const SECTION = { mobile: 'Mobile plans', internet: 'Home internet', tv: 'Television' };
  for (const [key, label] of Object.entries(SECTION)) {
    const g = CONFIG.plans && CONFIG.plans[key];
    if (!g) continue;
    L.push(`## ${label} — ${g.title}`, '');
    for (const p of g.items) {
      const bits = [p.headline, p.sub, p.note, (p.benefits || []).join('; '), p.commitment]
        .map(trim).filter(Boolean);
      L.push(`- ${p.name}${p.recommended ? ' (recommended on screen)' : ''}: ${bits.join(' · ')}`);
    }
    L.push('');
  }

  if (CONFIG.devices && CONFIG.devices.length) {
    L.push('## Touchscreen stands', '');
    for (const d of CONFIG.devices) L.push(`- ${d.name}: ${d.size}`);
    L.push('');
  }
  return L.join('\n').trim();
}

async function main() {
  const raw    = (await readFile(join(here, 'persona-prompt.md'), 'utf8')).trim();
  if (!raw.includes('<!-- OFFER -->')) {
    console.error('V persona-prompt.md chýba značka <!-- OFFER --> – kam vložiť prehľad ponuky.');
    process.exit(1);
  }
  const offer  = await offerSection();
  const prompt = raw.replace('<!-- OFFER -->', offer);
  const persona = await api(`/personas/${PERSONA}`);
  const now = {
    systemPrompt:   (persona.brain && persona.brain.systemPrompt) || '',
    languageCode:   persona.languageCode || '',
    initialMessage: persona.initialMessage || '',
    voice:          persona.voiceGenerationOptions || {}
  };

  console.log(`Persóna: ${persona.name || PERSONA}`);
  console.log(`Prompt má ${prompt.length} znakov, úvodná veta ${GREETING.length}.`);

  /* Čo skript vlastní – to sa zapíše vždy. */
  const body = {};
  const diff = [];
  if (trim(now.systemPrompt) !== trim(prompt)) { body.systemPrompt = prompt; diff.push('systemPrompt'); }
  if (trim(now.initialMessage) !== trim(GREETING)) { body.initialMessage = GREETING; diff.push('initialMessage'); }

  /* Čo patrí kabinetu – len sa hlási, zapíše sa na výslovné želanie. */
  const notes = [];
  if (now.languageCode !== LANGUAGE) {
    if (PUSH_LANG) { body.languageCode = LANGUAGE; diff.push(`languageCode ${now.languageCode} → ${LANGUAGE}`); }
    else notes.push(`languageCode je '${now.languageCode}', v skripte '${LANGUAGE}' – nechávam tak (--language prepíše)`);
  }
  if (now.voice.speed !== VOICE.speed || now.voice.emotion !== VOICE.emotion) {
    if (PUSH_VOICE) { body.voiceGenerationOptions = VOICE; diff.push('voiceGenerationOptions'); }
    else notes.push(`voiceGenerationOptions ${JSON.stringify(now.voice)}, v skripte ${JSON.stringify(VOICE)} – nechávam tak (--voice prepíše)`);
  }

  notes.forEach(n => console.log('  · ' + n));

  if (!diff.length) { console.log('Bez zmeny – čo skript vlastní, už sedí.'); return; }
  console.log('Zmení sa: ' + diff.join(', '));

  if (DRY) { console.log('Skúšobný beh – nič sa nezapísalo.'); return; }

  await api(`/personas/${PERSONA}`, { method: 'PUT', body: JSON.stringify(body) });
  console.log('Zapísané.');
}

main().catch(err => { console.error('Zlyhalo:', err.message); process.exit(1); });
