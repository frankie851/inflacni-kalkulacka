// Čisté funkce pro zpracování CSV s indexy spotřebitelských cen ČSÚ.
// Sloupce se hledají podle názvu v hlavičce (dokumentace datové sady 010022:
// hodnota, casz_kod, ecoicop_kod/_txt, uzemi_kod, rok, mesic …), takže drobné
// změny pořadí nebo přidané sloupce nevadí. Nejasný výsledek = chyba, ne odhad.

import { monthToOrdinal, ordinalToMonth } from '../inflation.js';

/** Rozparsuje CSV (RFC 4180: uvozovky, "" uvnitř, CRLF, BOM). Oddělovač , nebo ; se zjistí z hlavičky. */
export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (rows.length === 0) throw new Error('CSV je prázdné');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

/** Číslo z CSV: "104,25" i "104.25". */
export function parseNumber(s) {
  if (s === undefined || s === null || String(s).trim() === '') return NaN;
  return Number(String(s).replace(/\s/g, '').replace(',', '.'));
}

const pick = (cols, names) => names.find((n) => cols.includes(n));
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Měsíc řádku jako "RRRR-MM" (sloupce rok + mesic, nebo období typu 2025M09 / 2025-09). */
function rowMonth(row, cols) {
  const rokCol = pick(cols, ['rok']);
  const mesCol = pick(cols, ['mesic', 'měsíc']);
  if (rokCol && mesCol && row[rokCol] && row[mesCol]) {
    return `${row[rokCol]}-${String(Number(row[mesCol])).padStart(2, '0')}`;
  }
  for (const c of ['obdobi', 'casref_do', 'obdobi_kod', 'obdobido', 'obdobi_txt']) {
    const v = row[c];
    if (!v) continue;
    let m = /^(\d{4})[-M]?(\d{2})$/i.exec(v) || /^(\d{4})-(\d{2})-\d{2}$/.exec(v);
    if (m) return `${m[1]}-${m[2]}`;
  }
  return null;
}

/** Text řádku pro rozpoznání základu a skupiny (spojení všech *_txt sloupců). */
function rowText(row, cols) {
  return norm(cols.filter((c) => c.endsWith('_txt') || c === 'ukazatel').map((c) => row[c]).join(' | '));
}

/**
 * Vybere z řádků bazický index za úhrn spotřebního koše v ČR.
 * @returns {{ base: string|null, values: Record<string, number> }}
 */
export function selectBaseIndex(rows, { preferBase = '2015' } = {}) {
  if (rows.length === 0) throw new Error('CSV nemá žádné datové řádky');
  const cols = Object.keys(rows[0]);
  if (cols.includes('typudaje4a')) return selectBaseIndexDataStat(rows, cols, preferBase);
  const valCol = pick(cols, ['hodnota', 'value']);
  if (!valCol) throw new Error(`Chybí sloupec "hodnota" (sloupce: ${cols.join(', ')})`);
  const typeCol = pick(cols, ['casz_kod']);
  const stapro = pick(cols, ['stapro_kod']);
  // skupina spotřebního koše; v 010022-25 je to ucel_kod (prázdný = souhrnný index za všechny oddíly)
  const basketKod = pick(cols, ['ucel_kod', 'ecoicop_kod', 'coicop_kod', 'coicop2018_kod', 'ecoicop2_kod']);
  const basketTxt = pick(cols, ['ucel_txt', 'ecoicop_txt', 'coicop_txt', 'coicop2018_txt', 'ecoicop2_txt']);
  const bazOd = pick(cols, ['bazobdobiod']);
  const bazDo = pick(cols, ['bazobdobido']);
  const uzemiKod = pick(cols, ['uzemi_kod']);
  const uzemiTxt = pick(cols, ['uzemi_txt']);

  const candidates = rows.filter((r) => {
    // 1) bazický index: casz_kod = Z, jinak podle textu
    if (typeCol) { if (r[typeCol].toUpperCase() !== 'Z') return false; }
    else if (!/bazick/.test(rowText(r, cols))) return false;
    // 2) ukazatel ISC (6134), pokud sloupec existuje
    if (stapro && r[stapro] && r[stapro] !== '6134') return false;
    // 3) úhrn spotřebního koše: prázdný kód skupiny nebo text „úhrn / celkem“
    if (basketKod || basketTxt) {
      const kod = basketKod ? r[basketKod] : '';
      const txt = norm(basketTxt ? r[basketTxt] : '');
      const total = kod === '' || /^(uhrn|celkem|spotrebni kos celkem|uhrn celkem)$/.test(txt) || /^(00|cp00|total)$/i.test(kod);
      if (!total) return false;
    }
    return true;
  });

  // 4) území ČR, pokud je jich v datech víc
  let rowsCz = candidates;
  if (uzemiKod) {
    const territories = new Set(candidates.map((r) => r[uzemiKod]));
    if (territories.size > 1) {
      rowsCz = candidates.filter((r) => /cesk|ceska republika|^cr$/.test(norm(uzemiTxt ? r[uzemiTxt] : '')) || r[uzemiKod] === '19');
    }
  }

  // 5) základ (průměr RRRR = 100): ze sloupců bazobdobiod/do (celý kalendářní rok), jinak z textu
  const byBase = new Map();
  for (const r of rowsCz) {
    let base = null;
    const od = bazOd ? /^(\d{4})-01-01/.exec(r[bazOd]) : null;
    const dO = bazDo ? /^(\d{4})-12-31/.exec(r[bazDo]) : null;
    if (od && dO && od[1] === dO[1]) base = od[1];
    else if (bazOd && r[bazOd]) base = `${r[bazOd]}…${r[bazDo] ?? ''}`; // jiný základ (např. prosinec 2017)
    else {
      const t = rowText(r, cols);
      const m = /(?:prumer|prum\.?)\s*(?:roku\s*)?(\d{4})\s*=\s*100/.exec(t) || /(\d{4})\s*=\s*100/.exec(t);
      base = m ? m[1] : null;
    }
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(r);
  }
  if (byBase.size === 0) throw new Error('V CSV jsem nenašel bazický index za úhrn spotřebního koše');
  let base = byBase.has(preferBase) ? preferBase : [...byBase.keys()].sort().at(-1);
  if (byBase.size > 1 && !byBase.has(preferBase) && byBase.has(null)) {
    throw new Error(`Nejednoznačný základ indexu: ${[...byBase.keys()].join(', ')}`);
  }
  const chosen = byBase.get(base);

  const values = {};
  for (const r of chosen) {
    const month = rowMonth(r, cols);
    if (!month) continue; // roční průměry apod.
    const v = parseNumber(r[valCol]);
    if (!Number.isFinite(v)) continue; // nezveřejněná hodnota
    if (month in values && values[month] !== v) {
      throw new Error(`Pro ${month} vyšlo víc různých hodnot (${values[month]}, ${v}) – filtr není jednoznačný`);
    }
    values[month] = v;
  }
  if (Object.keys(values).length === 0) throw new Error('Bazický index nemá žádné měsíční hodnoty');
  return { base, values };
}

/**
 * Formát DataStat (sada CEN0101E na data.csu.gov.cz, od 2026). Sloupce s kódy:
 *   TYPUDAJE4A = IZ2015 (bazický index 2015 = 100), IZ2025, IV202512, IR (meziroční) …
 *   CZCOICOP2.CZCOP1 = "0" a CZCOICOP2.CZCOP23 = "" → úhrn spotřebního koše
 *   EKAKTIOCDS = "0" (domácnosti celkem), UZ02P = "CZ" (Česko), IndicatorType = 6134
 *   CASMKMQRM12 = "RRRR-MM" pro měsíc (RRRR-MMK = kumulace, RRRR-Qn, RRRR se přeskočí)
 */
function selectBaseIndexDataStat(rows, cols, preferBase) {
  const need = ['hodnota', 'casmkmqrm12', 'czcoicop2.czcop1'];
  const missing = need.filter((c) => !cols.includes(c));
  if (missing.length) throw new Error(`Formát DataStat: chybí sloupce ${missing.join(', ')}`);
  const has = (c) => cols.includes(c);
  const byBase = new Map();
  for (const r of rows) {
    const m = /^IZ(\d{4})$/.exec(r.typudaje4a);
    if (!m) continue; // jen bazické indexy s průměrem roku = 100
    if (has('indicatortype') && r.indicatortype !== '6134') continue;
    if (r['czcoicop2.czcop1'] !== '0') continue;
    if (has('czcoicop2.czcop23') && r['czcoicop2.czcop23'] !== '') continue;
    if (has('ekaktiocds') && r.ekaktiocds !== '0') continue;
    if (has('uz02p') && r.uz02p !== 'CZ') continue;
    if (!/^\d{4}-\d{2}$/.test(r.casmkmqrm12)) continue;
    const v = parseNumber(r.hodnota);
    if (!Number.isFinite(v)) continue;
    if (!byBase.has(m[1])) byBase.set(m[1], {});
    const values = byBase.get(m[1]);
    if (r.casmkmqrm12 in values && values[r.casmkmqrm12] !== v) {
      throw new Error(`Pro ${r.casmkmqrm12} vyšlo víc různých hodnot – filtr není jednoznačný`);
    }
    values[r.casmkmqrm12] = v;
  }
  if (byBase.size === 0) throw new Error('V CSV (DataStat) jsem nenašel bazický index za úhrn spotřebního koše');
  const base = byBase.has(preferBase) ? preferBase : [...byBase.keys()].sort().at(-1);
  return { base, values: sortMap(byBase.get(base)) };
}

/**
 * Naváže novější řadu (jiný základ) na starší přes společné měsíce.
 * Starší hodnoty zůstávají, novější se přepočtou koeficientem a doplní jen měsíce navíc.
 */
export function chainSeries(older, newer, { tolerance = 0.0005 } = {}) {
  const overlap = Object.keys(newer).filter((m) => m in older).sort();
  if (overlap.length === 0) throw new Error('Řady se nepřekrývají, nelze je navázat');
  const ratios = overlap.map((m) => older[m] / newer[m]);
  const factor = ratios.reduce((a, b) => a + b, 0) / ratios.length;
  const worst = Math.max(...ratios.map((r) => Math.abs(r / factor - 1)));
  if (worst > tolerance) {
    throw new Error(`Řady se v překryvu liší o ${(worst * 100).toFixed(3)} % (> ${tolerance * 100} %)`);
  }
  const out = { ...older };
  for (const m of Object.keys(newer)) if (!(m in out)) out[m] = Math.round(newer[m] * factor * 100) / 100;
  return { values: sortMap(out), factor, overlap: overlap.length };
}

/** Přepočet na základ „průměr roku = 100“ (např. 2015). */
export function rebaseToYearAverage(values, year) {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  if (!months.every((m) => m in values)) throw new Error(`Chybí měsíce roku ${year} pro přepočet základu`);
  const avg = months.reduce((s, m) => s + values[m], 0) / 12;
  return sortMap(Object.fromEntries(Object.entries(values).map(([m, v]) => [m, Math.round((v / avg) * 10000) / 100])));
}

/**
 * Ověří řadu: začátek, souvislost, kladné hodnoty, žádná budoucnost.
 * S maxAgeMonths navíc hlídá, že poslední měsíc není starší než tolik měsíců. Vrací seznam chyb.
 */
export function validateSeries(values, { start = '1995-01', today = new Date(), maxAgeMonths = null } = {}) {
  const errors = [];
  const months = Object.keys(values).sort();
  if (months.length === 0) return ['Řada je prázdná'];
  if (months[0] !== start) errors.push(`Řada začíná ${months[0]}, očekávám ${start}`);
  for (let i = 1; i < months.length; i++) {
    const gap = monthToOrdinal(months[i]) - monthToOrdinal(months[i - 1]);
    if (gap !== 1) errors.push(`Díra v řadě: ${months[i - 1]} → ${months[i]}`);
  }
  for (const m of months) {
    if (!(Number.isFinite(values[m]) && values[m] > 0)) errors.push(`Neplatná hodnota ${m}: ${values[m]}`);
  }
  const now = ordinalToMonth(today.getFullYear() * 12 + today.getMonth());
  if (months.at(-1) > now) errors.push(`Poslední měsíc ${months.at(-1)} je v budoucnosti`);
  if (maxAgeMonths !== null && monthToOrdinal(now) - monthToOrdinal(months.at(-1)) > maxAgeMonths) {
    errors.push(`Data končí ${months.at(-1)}, což je víc než ${maxAgeMonths} měsíce zpět – nejspíš chybí novější zdroj`);
  }
  return errors;
}

/** Ze stránky produktu vytáhne odkazy na CSV soubory (absolutní URL). */
export function findCsvLinks(html, pageUrl) {
  const links = new Set();
  for (const m of html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    const href = m[1]
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
      .replace(/&amp;/g, '&');
    if (/\/schema\//i.test(href)) continue; // technické schéma, ne data
    if (/\.csv(\?|#|$)/i.test(href) || /format=csv|[?&]type=csv/i.test(href) || /\/distribuce\/csv\/?$/i.test(href)) {
      links.add(new URL(href, pageUrl).href);
    }
  }
  return [...links];
}

export function sortMap(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
