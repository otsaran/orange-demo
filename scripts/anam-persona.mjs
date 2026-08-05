#!/usr/bin/env node
/* ==================================================================
   Nastaví persóne systémový prompt, jazyk a úvodnú vetu.
   Prompt sa edituje v scripts/persona-prompt.md, nie tu.

   Spustenie:
     ANAM_API_KEY=… node scripts/anam-persona.mjs --dry-run
     ANAM_API_KEY=… node scripts/anam-persona.mjs

   Nástroje sa tu neriešia – tie zakladá scripts/anam-tools.mjs.
   ================================================================== */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API     = 'https://api.anam.ai/v1';
const KEY     = process.env.ANAM_API_KEY;
const PERSONA = process.env.ANAM_PERSONA_ID || '5584933e-43bc-428c-9d9b-015922821e71';
const DRY     = process.argv.includes('--dry-run');

/* Úvodná veta – prvé, čo návštevník počuje. Bez názvu operátora.

   Musí znieť doslova rovnako ako `LINES.hello` v app.js: kiosk ju vypíše do
   titulkov hneď po výbere avatara a persóna ju o pár sekúnd povie nahlas.
   Keby sa líšili, návštevník dostane dva rôzne pozdravy za sebou.

   Krátka je zámerne. Dlhšia verzia s vymenovaním sekcií zaberala v titulkoch
   presne štyri riadky, teda celý priestor bez rezervy – a sekcie má aj tak
   pred sebou na dlaždiciach. Kratší pozdrav navyše skôr začne (odporúčanie
   Anamu k latencii).                                                        */
const GREETING = 'Dobrý deň. Som digitálny prezentér Humion. S čím Vám môžem pomôcť?';

const LANGUAGE = 'sk';

/* Nastavenie hlasu podľa odporúčania Anamu pre živé retailové demo
   (Hannah Tier, 5. 8. 2026). Patrí do `voiceGenerationOptions`, nie do
   `directorNotes` – tie riadia hranie avatara a `content` medzi ich
   štýlmi nie je. Rozsahy pre Cartesia sonic-3: speed 0,6–1,5,
   emotion neutral | calm | angry | content | sad | scared.
   Pozor: pri zmene `voiceId` sa tieto voľby na strane Anamu vynulujú. */
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

async function main() {
  const prompt  = (await readFile(join(here, 'persona-prompt.md'), 'utf8')).trim();
  const persona = await api(`/personas/${PERSONA}`);
  const now = {
    systemPrompt:   (persona.brain && persona.brain.systemPrompt) || '',
    languageCode:   persona.languageCode || '',
    initialMessage: persona.initialMessage || '',
    voice:          persona.voiceGenerationOptions || {}
  };

  const diff = [];
  if (trim(now.systemPrompt) !== trim(prompt)) diff.push('systemPrompt');
  if (now.languageCode !== LANGUAGE)           diff.push(`languageCode ${now.languageCode} → ${LANGUAGE}`);
  if (trim(now.initialMessage) !== trim(GREETING)) diff.push('initialMessage');
  if (now.voice.speed !== VOICE.speed || now.voice.emotion !== VOICE.emotion) {
    diff.push(`voiceGenerationOptions ${JSON.stringify(now.voice)} → ${JSON.stringify(VOICE)}`);
  }

  console.log(`Persóna: ${persona.name || PERSONA}`);
  console.log(`Prompt má ${prompt.length} znakov, úvodná veta ${GREETING.length}.`);

  if (!diff.length) { console.log('Bez zmeny – všetko už sedí.'); return; }
  console.log('Zmení sa: ' + diff.join(', '));

  if (DRY) { console.log('Skúšobný beh – nič sa nezapísalo.'); return; }

  await api(`/personas/${PERSONA}`, {
    method: 'PUT',
    body: JSON.stringify({
      systemPrompt: prompt,
      languageCode: LANGUAGE,
      initialMessage: GREETING,
      voiceGenerationOptions: VOICE
    })
  });
  console.log('Zapísané.');
}

main().catch(err => { console.error('Zlyhalo:', err.message); process.exit(1); });
