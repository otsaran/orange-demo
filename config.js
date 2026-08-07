/* ------------------------------------------------------------------
   Konfigurácia dema. Všetko, čo sa mení pred ukážkou, je tu.
   V kóde sa nič z týchto hodnôt nesmie duplikovať.
   ------------------------------------------------------------------ */

const CONFIG = {

  /* --- Avatary -------------------------------------------------------
     gender  = používateľská voľba (Žena / Muž)
     engine  = technické riešenie za ňou:
               'anam'  => widget <anam-agent>, potrebuje `agentId`
               čokoľvek iné => iframe na adrese `url` (napr. pixel streaming)
     Prepojenie je definované výhradne tu, nie v kóde.
     Prázdne `agentId` aj `url` => zobrazí sa vizuálna náhrada (ukážkový režim). */
  avatarA: { engine: 'anam', gender: 'female', agentId: 'efdf52f2-b01b-475f-b503-3ddf5b6dfe57', url: '' },
  avatarB: { engine: 'anam', gender: 'male',   agentId: '5584933e-43bc-428c-9d9b-015922821e71', url: '' },

  /* --- Widget anam.ai -------------------------------------------------
     script          = zabalený balík vo `vendor/` (verzia je zmrazená)
     scriptFallback  = záloha z CDN, ak by súbor vo vendore chýbal
     autostart       = po výbere avatara sa relácia spustí sama
                       (inak čaká na tlačidlo `call-to-action` vo widgete)
     attrs           = atribúty prvku <anam-agent>; kioskové ovládanie
                       máme vlastné, preto je chróm widgetu vypnutý
     probeUrl        = cieľ heartbeatu, keď avatar nemá vlastnú URL
     textBridge      = widget zatiaľ nemá verejné `talk()`; ak je zapnuté,
                       otázka sa vloží do jeho textového poľa (vyžaduje
                       attrs['ui-text-input'] = 'true'). Obchádzka na skúšky.
     ask             = čo sa avatara opýta dlaždica (kľúč = data-quick)    */
  anam: {
    script: 'vendor/anam-agent.js',
    scriptFallback: 'https://unpkg.com/@anam-ai/agent-widget@0.5.0',
    autostart: true,
    probeUrl: 'https://api.anam.ai/favicon.ico',
    attrs: {
      'layout':         'inline',
      'ui-transcript':  'false',
      'ui-captions':    'false',
      'ui-mute-button': 'false',
      'ui-text-input':  'true'      // pole je skryté štýlom, slúži mostu nižšie
    },
    textBridge: true,

    /* Tieto vety idú do avatara kanálom pre repliku návštevníka – iný widget
       zatiaľ neponúka. Preto začínajú značkou [KIOSK] a sú po anglicky: sú to
       udalosti obrazovky, nie reč. Prompt má pravidlo, že sa kvôli nim nemá
       prepínať jazyk.

       Predtým tu boli slovenské vety („Povedz mi o paušáloch.“) a model ich
       čítal ako návštevníka, ktorý prehovoril po slovensky – rozhovor vedený
       po ukrajinsky sa pri každom dotyku obrazovky prepol späť do slovenčiny. */
    ask: {
      mobile:   '[KIOSK] The visitor opened the mobile plans on screen. Introduce them in the language you are currently speaking.',
      phones:   '[KIOSK] The visitor opened the showcase of touchscreen stands. Introduce them in the language you are currently speaking.',
      tv:       '[KIOSK] The visitor opened the television packages on screen. Introduce them in the language you are currently speaking.',
      internet: '[KIOSK] The visitor opened the home internet plans on screen. Introduce them in the language you are currently speaking.'
    },

    /* Čo dostane avatar, keď návštevník stlačí „Vybrať“ na karte ponuky.

       Dávame FAKTY, nie scenár. Predchádzajúca verzia predpisovala tvar
       odpovede („povedz v dvoch vetách a spýtaj sa, čo ďalej“), model ju
       plnil doslova a znelo to ako naučený text. Zároveň išli do modelu len
       tri polia z ôsmich, takže o karte nemal čo povedať.

       Ceny zámerne neposielame: návštevník ich má na obrazovke a model si
       ich nemá kde vymyslieť.

       Zástupné znaky: {name} {headline} {sub} {note} {benefits} {commitment} */
    askPlan: '[KIOSK] The visitor selected {name} on screen. ' +
             'Headline: {headline}. Detail: {sub}. {note} ' +
             'Included: {benefits}. {commitment}. ' +
             'Talk about it in your own words, in the language you are currently speaking: ' +
             'who it suits and why. The exact price is printed on the screen in front of ' +
             'them, so do not read it out loud.'
  },

  /* --- Správanie ----------------------------------------------------- */
  idleTimeoutSec: 45,          // nečinnosť => späť do IDLE (cez FEEDBACK)
  feedbackTimeoutSec: 15,      // ak návštevník neohodnotí, obrazovka sa sama vráti
  phonePrefix: '+421',

  /* Logo: jediný riadok na odstránenie/výmenu pred ukážkou.
     src   = cesta k súboru (napr. 'logo.svg'); ak je prázdna, vykreslí sa štvorec
     text  = slovo v štvorci. Zámerne neutrálne – v deme sa značkové slovo nepoužíva. */
  logo: { show: true, src: '', text: 'logo' },

  /* --- Text pri výpadku spojenia: 'technical' | 'customer' ------------ */
  offlineMode: 'technical',

  /* --- Kontrola spojenia ---------------------------------------------
     url: ľahký, vždy dostupný zdroj. Prázdne => odvodí sa z URL avatara. */
  heartbeat: {
    url: '',
    intervalMs: 5000,
    timeoutMs: 3000,
    failuresToOffline: 2,     // dva neúspechy za sebou => offline
    iframeLoadTimeoutMs: 15000,
    /* Kým sa relácia dvíha, nejde o výpadok – kiosk ukáže len krúžok, a to
       až po tomto odklade. Keď avatar nabehne skôr, neblikne vôbec.       */
    loaderDelayMs: 400
  },

  /* --- Kiosky z ponuky (3D) -------------------------------------------
     page = samostatná stránka s modelom, vkladá sa cez iframe.
     Každá stránka si nesie vlastný skript aj štýly.                     */
  devices: [
    { id: 'totem1', name: 'Malé dotykové obrazovky',    size: '21–24″', page: 'totem-1.html' },
    { id: 'totem2', name: 'Stredné dotykové obrazovky', size: '24–28″', page: 'totem-2.html' },
    { id: 'totem3', name: 'Veľké dotykové obrazovky',   size: '32–55″', page: 'totem-3.html' }
  ],

  /* --- Ponuky v karuseli (sekcie Internet a Televízia) -----------------
     Kľúč = data-quick dlaždice, takže pridať ďalšiu sekciu znamená pridať
     sem ďalší blok a dlaždicu do index.html – v kóde sa nič nemení.
     headline = veľký akcentný údaj, sub = riadok pod ním (nepovinný),
     next     = obrazovka, na ktorú vedie hlavné tlačidlo.
     Ceny a texty sú z verejnej ponuky – pred ukážkou skontrolovať.        */
  plans: {

    mobile: {
      title: 'Vyberte si paušál',
      cta:   'Chcem paušál',
      next:  'LEAD_CAPTURE',
      items: [
        {
          id: 'xl', name: 'Paušál XL',
          headline: '∞ GB', sub: '400 GB dát plnou rýchlosťou, potom 5 Mbit/s',
          note: 'Získate nekonečné volania aj SMS a zľavu až do 240 € na zariadenie.',
          priceOld: '49 €/mes.', price: '47', unit: '€/mes.',
          commitment: 'Viazanosť 24 mesiacov',
          benefits: ['2 extra benefity na výber', 'Zľava na zariadenie', '2 GB navyše pri nákupe online']
        },
        {
          id: 'l', name: 'Paušál L', recommended: true,
          headline: '∞ GB', sub: '32 GB dát plnou rýchlosťou, potom 5 Mbit/s',
          note: 'Získate nekonečné volania aj SMS a zľavu až do 150 € na zariadenie.',
          priceOld: '39 €/mes.', price: '37', unit: '€/mes.',
          commitment: 'Viazanosť 24 mesiacov',
          benefits: ['1 extra benefit na výber', 'Zľava na zariadenie', '2 GB navyše pri nákupe online']
        },
        {
          id: 'm', name: 'Paušál M',
          headline: '11 GB', sub: '11 GB dát plnou rýchlosťou, potom 1 Mbit/s',
          note: 'Získate nekonečné volania aj SMS a zľavu až do 60 € na zariadenie.',
          priceOld: '28,01 €/mes.', price: '26', unit: '€/mes.',
          commitment: 'Viazanosť 24 mesiacov',
          benefits: ['1 extra benefit na výber', 'Zľava na zariadenie', '2 GB navyše pri nákupe online']
        },
        {
          id: 's', name: 'Paušál S',
          headline: '6 GB', sub: '6 GB dát plnou rýchlosťou, potom 512 kbit/s',
          note: 'Získate 240 min. volaní, nekonečné SMS a zľavu až do 30 € na zariadenie.',
          priceOld: '23 €/mes.', price: '21', unit: '€/mes.',
          commitment: 'Viazanosť 24 mesiacov',
          benefits: ['1 extra benefit na výber', 'Zľava na zariadenie', '2 GB navyše pri nákupe online']
        },
        {
          id: 'yoxo', name: 'Yoxo paušál',
          headline: '∞ GB', sub: '100 GB dát plnou rýchlosťou, potom 1 Mbit/s',
          note: 'Získate nekonečné volania aj SMS a zľavu do 10 € na zariadenie.',
          price: '20', unit: '€/mes.',
          commitment: 'Viazanosť 24 mesiacov',
          benefits: ['Zľava na zariadenie', 'Yoxo Market', 'Online ochrana']
        },
        {
          id: 'mini', name: 'Mini paušál',
          headline: '1 GB',
          note: 'Získate volania za 0,1230 €/min. a SMS za 0,0615 € za správu.',
          priceOld: '6 €/mes.', price: '4', unit: '€/mes.',
          commitment: 'Viazanosť 24 mesiacov',
          benefits: ['Online ochrana']
        }
      ]
    },

    internet: {
      title: 'Vyberte si rýchlosť',
      cta:   'Chcem internet',
      next:  'COVERAGE_CHECK',
      items: [
        {
          id: 'xl-extra', name: 'Internet XL Extra',
          headline: '2 500 Mbit/s', sub: '1 000 Mbit/s odosielanie',
          note: 'Najrýchlejší internet pre 4K video, gaming aj smart domácnosť.',
          priceOld: '32 €/mes.', price: '23', unit: '€/mes.',
          commitment: 'Viazanosť 24 mesiacov',
          benefits: ['3 mesiace za zvýhodnenú cenu', 'Kupón na zariadenie', 'Zriadenie pripojenia zadarmo']
        },
        {
          id: 'xl', name: 'Internet XL',
          headline: '1 000 Mbit/s', sub: '500 Mbit/s odosielanie',
          note: 'Extra rýchly internet pre celú domácnosť pripojenú v jednom čase.',
          priceOld: '25,01 €/mes.', price: '19,17', unit: '€/mes.',
          commitment: 'Viazanosť 24 mesiacov',
          benefits: ['Zľava z mesačného poplatku', 'Kupón na zariadenie', 'TV balík na mesiac zadarmo']
        },
        {
          id: 'l', name: 'Internet L', recommended: true,
          headline: '600 Mbit/s', sub: '150 Mbit/s odosielanie',
          note: 'Najobľúbenejší internet pre videá, hovory aj prácu online.',
          priceOld: '20 €/mes.', price: '15,01', unit: '€/mes.',
          commitment: 'Viazanosť 24 mesiacov',
          benefits: ['Zľava z mesačného poplatku', 'Kupón na zariadenie', 'TV balík na mesiac zadarmo']
        },
        {
          id: 'm', name: 'Internet M',
          headline: '100 Mbit/s', sub: '40 Mbit/s odosielanie',
          note: 'Spoľahlivý internet na základné surfovanie a bežné používanie.',
          priceOld: '15,01 €/mes.', price: '13', unit: '€/mes.',
          commitment: 'Viazanosť 24 mesiacov',
          benefits: ['TV balík na mesiac zadarmo', 'Online ochrana Doma']
        }
      ]
    },

    tv: {
      title: 'Vyberte si balík',
      cta:   'Chcem televíziu',
      next:  'COVERAGE_CHECK',
      items: [
        {
          id: 'tv-xl', name: 'TV XL',
          headline: '176 kanálov',
          note: 'To najlepšie z TV sveta – filmy, šport aj exkluzívny obsah, s až 31-dňovým archívom v cene.',
          priceOld: '25,01 €/mes.', price: '17,25', unit: '€/mes.',
          commitment: 'Viazanosť 24 mesiacov',
          benefits: ['Zľava z mesačného poplatku', '3 tematické balíky v cene', 'Prémiový filmový balík na 1 mesiac']
        },
        {
          id: 'tv-l', name: 'TV L', recommended: true,
          headline: 'od 141 kanálov',
          note: 'Bohatá ponuka programov pre každého diváka s 31-dňovým archívom.',
          priceOld: '20 €/mes.', price: '13,51', unit: '€/mes.',
          commitment: 'Viazanosť 24 mesiacov',
          benefits: ['Zľava z mesačného poplatku', '2 tematické balíky v cene', 'Prémiový filmový balík na 1 mesiac']
        },
        {
          id: 'tv-m', name: 'TV M',
          headline: 'od 119 kanálov',
          note: 'Vyvážený balík TV kanálov pre rodinu doplnený o 31-dňový archív.',
          priceOld: '15,01 €/mes.', price: '9,75', unit: '€/mes.',
          commitment: 'Viazanosť 24 mesiacov',
          benefits: ['Zľava z mesačného poplatku', '1 tematický balík v cene', 'Prémiový filmový balík na 1 mesiac']
        }
      ]
    }
  },

  /* --- Dostupnosť služieb na adrese (mock) ---------------------------- */
  addresses: [
    { q: 'Pribinova 8, Bratislava',    optika: true,  mobil: true },
    { q: 'Metodova 8, Bratislava',     optika: true,  mobil: true },
    { q: 'Vajnorská 100, Bratislava',  optika: false, mobil: true },   // TODO: potvrdiť adresu bez optiky
    { q: 'Einsteinova 24, Bratislava', optika: true,  mobil: true }
  ]
};
