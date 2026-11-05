#!/usr/bin/env node
// Stáhne z otevřených dat ČSÚ bazický index spotřebitelských cen (úhrn, měsíčně)
// a uloží data/cpi.json ve tvaru { "RRRR-MM": index }, základ průměr 2015 = 100.
//
// Použití:
//   node scripts/update-cpi.mjs                    # najde CSV na stránce produktu ISC a stáhne je
//   node scripts/update-cpi.mjs --url <csv> ...    # konkrétní CSV (lze opakovat)
//   node scripts/update-cpi.mjs --file <csv> ...   # ručně stažený soubor (lze opakovat)
//   node scripts/update-cpi.mjs --dry-run          # nic nezapisuje, jen vypíše souhrn

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  parseCsv, selectBaseIndex, chainSeries, rebaseToYearAverage, validateSeries, findCsvLinks, sortMap,
} from './cpi-parse.mjs';

export const PRODUCT_PAGE = 'https://csu.gov.cz/produkty/isc_cr';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'inflacni-kalkulacka/1.0 (aktualizace dat)';

function decode(buf) {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return utf8.includes('�') ? new TextDecoder('windows-1250').decode(buf) : utf8;
}

async function fetchWithRetry(url, tries = 4) {
  let delay = 2000;
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      if (i >= tries) throw new Error(`Stažení ${url} selhalo: ${err.message}${err.cause ? ` (${err.cause.code || err.cause.message})` : ''}`);
      await new Promise((r) => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

/** Z jednoho CSV zkusí vytáhnout řadu; vrací null, pokud soubor bazický úhrn neobsahuje. */
function trySeries(label, text, log) {
  try {
    const rows = parseCsv(text);
    const { base, values } = selectBaseIndex(rows);
    const months = Object.keys(values).sort();
    log(`  ✓ ${label}: základ ${base ?? '?'} = 100, ${months[0]} … ${months.at(-1)} (${months.length} měsíců)`);
    log(`    sloupce: ${Object.keys(rows[0]).join(', ')}`);
    return { label, base, values };
  } catch (err) {
    log(`  – ${label}: ${err.message}`);
    return null;
  }
}

/** Spojí nalezené řady do jedné se základem 2015 = 100. */
export function combine(series, log = () => {}) {
  if (series.length === 0) throw new Error('Žádný zdroj neobsahoval bazický index za úhrn spotřebního koše');
  const sorted = [...series].sort((a, b) => {
    const fa = Object.keys(a.values).sort()[0], fb = Object.keys(b.values).sort()[0];
    return fa < fb ? -1 : fa > fb ? 1 : (a.base === '2015' ? -1 : 1);
  });
  let acc = sortMap(sorted[0].values);
  let base = sorted[0].base;
  for (const s of sorted.slice(1)) {
    const lastAcc = Object.keys(acc).at(-1);
    if (!Object.keys(s.values).some((m) => m > lastAcc)) continue; // nic nového nepřináší
    const r = chainSeries(acc, s.values);
    log(`  navázáno ${s.label}: koeficient ${r.factor.toFixed(5)} přes ${r.overlap} společných měsíců`);
    acc = r.values;
  }
  if (base !== '2015') {
    log(`  přepočet základu ${base ?? '?'} → průměr 2015 = 100`);
    acc = rebaseToYearAverage(acc, 2015);
    base = '2015';
  }
  return acc;
}

async function main() {
  const { values: args } = parseArgs({
    options: {
      file: { type: 'string', multiple: true, default: [] },
      url: { type: 'string', multiple: true, default: [] },
      out: { type: 'string', default: resolve(ROOT, 'data/cpi.json') },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const log = (s) => console.log(s);
  const found = [];

  for (const f of args.file) {
    found.push(trySeries(f, decode(await readFile(f)), log));
  }
  let urls = args.url;
  if (args.file.length === 0 && urls.length === 0) {
    log(`Hledám CSV na ${PRODUCT_PAGE} …`);
    const html = decode(await fetchWithRetry(PRODUCT_PAGE));
    urls = findCsvLinks(html, PRODUCT_PAGE);
    if (urls.length === 0) throw new Error(`Na ${PRODUCT_PAGE} jsem nenašel žádný odkaz na CSV`);
    log(`Nalezeno ${urls.length} CSV.`);
  }
  for (const u of urls) {
    found.push(trySeries(u, decode(await fetchWithRetry(u)), log));
  }

  const values = combine(found.filter(Boolean), log);
  const errors = validateSeries(values);
  if (errors.length) throw new Error(`Řada neprošla kontrolou:\n  ${errors.join('\n  ')}`);

  const months = Object.keys(values);
  const last = months.at(-1);
  const [ly, lm] = last.split('-');
  const prevYear = `${Number(ly) - 1}-${lm}`;
  const avg2015 = months.filter((m) => m.startsWith('2015-')).reduce((s, m) => s + values[m], 0) / 12;
  log(`\nŘada: ${months[0]} … ${last}, ${months.length} měsíců, bez děr.`);
  log(`Kontrola: průměr 2015 = ${avg2015.toFixed(2)}; meziročně ${last}: ${((values[last] / values[prevYear] - 1) * 100).toFixed(1)} %`);

  if (args['dry-run']) return;
  const json = '{\n' + months.map((m) => `  "${m}": ${values[m]}`).join(',\n') + '\n}\n';
  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, json);
  log(`Uloženo ${args.out}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`Chyba: ${err.message}`);
    process.exit(1);
  });
}
