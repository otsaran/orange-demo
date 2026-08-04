#!/usr/bin/env node
/* ==================================================================
   Založí (alebo zosúladí) client tools persóny na anam.ai a pripojí
   ich k nej. Zoznam nižšie musí sedieť s tabuľkou AVATAR_TOOLS v app.js
   – názvy sú zmluva medzi persónou a kioskom.

   Spustenie:
     ANAM_API_KEY=… node scripts/anam-tools.mjs           # vykoná zmeny
     ANAM_API_KEY=… node scripts/anam-tools.mjs --dry-run # len ukáže plán

   Kľúč sa berie z prostredia a nikam sa nevypisuje. Persóna sa dá
   prebiť cez ANAM_PERSONA_ID.

   Skript je idempotentný: nástroj s rovnakým názvom sa neduplikuje,
   len sa doňho zapíše aktuálny popis a schéma. Existujúce nástroje
   persóny (vrátane systémových) sa zachovajú – toolIds sa zlučujú,
   nie prepisujú.
   ================================================================== */

const API      = 'https://api.anam.ai/v1';
const KEY      = process.env.ANAM_API_KEY;
const PERSONA  = process.env.ANAM_PERSONA_ID || '5584933e-43bc-428c-9d9b-015922821e71';
const DRY      = process.argv.includes('--dry-run');

if (!KEY) {
  console.error('Chýba ANAM_API_KEY. Kľúč sa vytvára v kabinete anam.ai (Settings → API keys).');
  console.error('Spustenie: ANAM_API_KEY=… node scripts/anam-tools.mjs');
  process.exit(1);
}

/* --- Nástroje ------------------------------------------------------
   awaitResult: false – kiosk len prepne obrazovku, persóna nemá na čo
   čakať a nemá sa jej prerušiť reč.                                   */
const TOOLS = [
  {
    name: 'show_section',
    description:
      'Show one of the four kiosk sections on screen. Use it as soon as the visitor asks about ' +
      'mobile plans (Paušály), phones and in-store stands (Telefóny), television (Televízia) ' +
      'or home internet (Internet). Call it before you start describing the offer, so the ' +
      'visitor sees what you are talking about.',
    config: {
      parameters: {
        type: 'object',
        properties: {
          section: {
            type: 'string',
            enum: ['mobile', 'phones', 'tv', 'internet'],
            description: 'mobile = Paušály, phones = Telefóny, tv = Televízia, internet = Internet'
          }
        },
        required: ['section']
      },
      awaitResult: false,
      toolTimeoutSeconds: 10
    }
  },
  {
    name: 'show_devices',
    description:
      'Open the 3D showcase of self-service kiosk stands and rotate a specific model into view. ' +
      'Use it when the visitor asks to see the stands, their sizes or how they look.',
    config: {
      parameters: {
        type: 'object',
        properties: {
          model: {
            type: 'string',
            enum: ['totem1', 'totem2', 'totem3'],
            description: 'totem1 = small 21–24", totem2 = medium 24–28", totem3 = large 32–55"'
          }
        }
      },
      awaitResult: false,
      toolTimeoutSeconds: 10
    }
  },
  {
    name: 'check_coverage',
    description:
      'Open the address form that checks service availability (optical internet and mobile ' +
      'network) at the visitor address. Use it when the visitor asks whether a service is ' +
      'available where they live.',
    config: { parameters: { type: 'object', properties: {} }, awaitResult: false, toolTimeoutSeconds: 10 }
  },
  {
    name: 'capture_lead',
    description:
      'Open the form where the visitor leaves a phone number so a sales representative can call ' +
      'them back. Use it when the visitor wants an offer, a callback or to order a service.',
    config: { parameters: { type: 'object', properties: {} }, awaitResult: false, toolTimeoutSeconds: 10 }
  },
  {
    name: 'call_seller',
    description:
      'Hand the visitor over to a human seller in the store. Use it for questions you cannot ' +
      'answer, for complaints, contracts and anything about an existing account.',
    config: { parameters: { type: 'object', properties: {} }, awaitResult: false, toolTimeoutSeconds: 10 }
  },
  {
    name: 'end_conversation',
    description:
      'Close the conversation and show the rating screen. Use it when the visitor says goodbye ' +
      'or confirms they need nothing else.',
    config: { parameters: { type: 'object', properties: {} }, awaitResult: false, toolTimeoutSeconds: 10 }
  }
];

async function api(path, options = {}) {
  const res = await fetch(API + path, {
    ...options,
    headers: {
      'Authorization': `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
  if (!res.ok) {
    const msg = body && body.message ? JSON.stringify(body.message) : text.slice(0, 300);
    throw new Error(`${options.method || 'GET'} ${path} → ${res.status} ${msg}`);
  }
  return body;
}

/* Zoznam nástrojov je stránkovaný – prejdeme všetky strany. */
async function listTools() {
  const all = [];
  for (let page = 1; ; page++) {
    const r = await api(`/tools?page=${page}&perPage=100`);
    all.push(...(r.data || []));
    if (!r.meta || !r.meta.next) break;
  }
  return all;
}

function sameConfig(a = {}, b = {}) {
  return JSON.stringify(a.parameters ?? {}) === JSON.stringify(b.parameters ?? {}) &&
         (a.awaitResult ?? false) === (b.awaitResult ?? false) &&
         (a.toolTimeoutSeconds ?? 10) === (b.toolTimeoutSeconds ?? 10);
}

async function main() {
  const persona = await api(`/personas/${PERSONA}`);
  console.log(`Persóna: ${persona.name || PERSONA}`);

  /* toolIds sa v odpovedi volajú rôzne podľa verzie – vezmeme, čo je. */
  const attached = persona.toolIds
    || (Array.isArray(persona.tools) ? persona.tools.map(t => t.id || t) : []);

  const existing = await listTools();
  const byName = new Map(existing.map(t => [t.name, t]));
  const wanted = [];

  for (const def of TOOLS) {
    const found = byName.get(def.name);
    if (!found) {
      if (DRY) { console.log(`+ vytvoriť  ${def.name}`); wanted.push('(nový)'); continue; }
      const made = await api('/tools', {
        method: 'POST',
        body: JSON.stringify({ name: def.name, description: def.description, type: 'CLIENT', config: def.config })
      });
      console.log(`+ vytvorený ${def.name}  ${made.id}`);
      wanted.push(made.id);
      continue;
    }
    if (found.type !== 'CLIENT') {
      throw new Error(`Nástroj ${def.name} už existuje s typom ${found.type} – premenujte ho v kabinete.`);
    }
    const stale = found.description !== def.description || !sameConfig(found.config, def.config);
    if (stale && !DRY) {
      await api(`/tools/${found.id}`, {
        method: 'PUT',
        body: JSON.stringify({ description: def.description, config: def.config })
      });
      console.log(`~ upravený  ${def.name}  ${found.id}`);
    } else {
      console.log(`${stale ? '~ upraviť  ' : '= bez zmeny'} ${def.name}  ${found.id}`);
    }
    wanted.push(found.id);
  }

  const merged = [...new Set([...attached, ...wanted.filter(id => id !== '(nový)')])];
  const changed = merged.length !== attached.length;

  if (DRY) {
    console.log(`\nPersóna má teraz ${attached.length} nástrojov, po zmene by mala ${merged.length}.`);
    console.log('Skúšobný beh – nič sa nezapísalo.');
    return;
  }

  if (changed) {
    await api(`/personas/${PERSONA}`, { method: 'PUT', body: JSON.stringify({ toolIds: merged }) });
    console.log(`\nPripojené k persóne: ${merged.length} nástrojov (predtým ${attached.length}).`);
  } else {
    console.log('\nPersóna už mala všetky nástroje pripojené.');
  }
}

main().catch(err => { console.error('Zlyhalo:', err.message); process.exit(1); });
