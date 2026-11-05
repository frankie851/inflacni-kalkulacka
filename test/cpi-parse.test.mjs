import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parseCsv, parseNumber, selectBaseIndex, chainSeries, rebaseToYearAverage, validateSeries, findCsvLinks,
} from '../scripts/cpi-parse.mjs';
import { combine } from '../scripts/update-cpi.mjs';

const fixture = new URL('./fixtures/sample.csv', import.meta.url);

test('parseCsv: uvozovky, "" uvnitř, CRLF, BOM, středník', () => {
  const rows = parseCsv('﻿a;b\r\n"x;1";"he said ""hi"""\r\n2;3\r\n');
  assert.deepEqual(rows, [{ a: 'x;1', b: 'he said "hi"' }, { a: '2', b: '3' }]);
});

test('parseNumber: čárka i tečka', () => {
  assert.equal(parseNumber('104,25'), 104.25);
  assert.equal(parseNumber('104.25'), 104.25);
  assert.ok(Number.isNaN(parseNumber('')));
});

test('selectBaseIndex vybere jen bazický index (Z), úhrn, ISC 6134, základ 2015', async () => {
  const rows = parseCsv(await readFile(fixture, 'utf8'));
  const { base, values } = selectBaseIndex(rows);
  assert.equal(base, '2015');
  // B (meziměsíční), skupina 01, základ 2010, jiný ukazatel a prázdná hodnota jsou vyřazeny
  assert.deepEqual(values, { '2015-01': 100, '2015-02': 101, '2015-03': 102.5 });
});

test('selectBaseIndex: bez preferovaného základu vezme nejnovější', () => {
  const csv = 'hodnota,casz_kod,ecoicop_kod,rok,mesic,casz_txt\n'
    + '100,Z,,2025,1,průměr roku 2025 = 100\n101,Z,,2025,2,průměr roku 2025 = 100\n';
  const { base, values } = selectBaseIndex(parseCsv(csv));
  assert.equal(base, '2025');
  assert.deepEqual(values, { '2025-01': 100, '2025-02': 101 });
});

test('selectBaseIndex selže, když filtr není jednoznačný', () => {
  const csv = 'hodnota,casz_kod,ecoicop_kod,rok,mesic\n100,Z,,2025,1\n105,Z,,2025,1\n';
  assert.throws(() => selectBaseIndex(parseCsv(csv)), /víc různých hodnot/);
});

test('chainSeries naváže novější řadu s jiným základem', () => {
  const older = { '2024-11': 150, '2024-12': 151.5 };
  const newer = { '2024-11': 100, '2024-12': 101, '2025-01': 102 };
  const r = chainSeries(older, newer);
  assert.equal(r.overlap, 2);
  assert.deepEqual(r.values, { '2024-11': 150, '2024-12': 151.5, '2025-01': 153 });
  assert.throws(() => chainSeries(older, { '2024-11': 100, '2024-12': 105 }), /liší/);
});

test('rebaseToYearAverage: průměr roku = 100', () => {
  const v = {};
  for (let m = 1; m <= 12; m++) v[`2015-${String(m).padStart(2, '0')}`] = 50;
  v['2016-01'] = 55;
  const r = rebaseToYearAverage(v, 2015);
  assert.equal(r['2015-06'], 100);
  assert.equal(r['2016-01'], 110);
});

test('combine: navazuje řady a převádí na 2015 = 100', () => {
  const v2015 = {};
  for (let m = 1; m <= 12; m++) v2015[`2015-${String(m).padStart(2, '0')}`] = 100;
  const out = combine([
    { label: 'nová', base: '2025', values: { '2015-12': 50, '2016-01': 51 } },
    { label: 'stará', base: '2015', values: v2015 },
  ]);
  assert.equal(out['2015-01'], 100);
  assert.equal(out['2016-01'], 102);
});

test('validateSeries hlásí díry, špatný začátek a budoucnost', () => {
  const today = new Date('2026-11-05');
  assert.deepEqual(validateSeries({ '1995-01': 1, '1995-02': 2 }, { today }), []);
  const errs = validateSeries({ '1995-02': 1, '1995-04': 2, '2027-01': 3 }, { today });
  assert.equal(errs.length, 4);
});

test('findCsvLinks najde odkazy na CSV', () => {
  const html = '<a href="/docs/1/x/010022-25data.csv?version&#x3D;1.0">CSV</a> <a href="a.pdf">x</a>'
    + '<a href="https://csu.gov.cz/x?format=csv&amp;y=1">data</a>';
  assert.deepEqual(findCsvLinks(html, 'https://csu.gov.cz/produkty/isc_cr'), [
    'https://csu.gov.cz/docs/1/x/010022-25data.csv?version=1.0',
    'https://csu.gov.cz/x?format=csv&y=1',
  ]);
});

test('skutečný formát ČSÚ 010022-25 (výřez): Z, prázdný ucel_kod, základ z bazobdobiod/do', async () => {
  const rows = parseCsv(await readFile(new URL('./fixtures/csu-010022-25.csv', import.meta.url), 'utf8'));
  const { base, values } = selectBaseIndex(rows);
  assert.equal(base, '2015');
  assert.deepEqual(values, { '2024-11': 152.4, '2024-12': 152, '2025-11': 155.6, '2025-12': 155.2 });
  // meziroční změna z bazického indexu odpovídá oficiálnímu meziročnímu indexu (C = 102,1) v témže souboru
  const official = rows.find((r) => r.casz_kod === 'C' && r.ucel_kod === '' && r.rok === '2025' && r.mesic === '12');
  assert.equal(((values['2025-12'] / values['2024-12']) * 100).toFixed(1), parseNumber(official.hodnota).toFixed(1));
});

test('findCsvLinks: odkaz na distribuci data.csu.gov.cz ano, technické schéma ne', () => {
  const html = '<a href="https://data.csu.gov.cz/opendata/sady/CEN0101E/distribuce/csv">Data (CSV)</a>'
    + '<a href="https://data.csu.gov.cz/opendata/sady/CEN0101E/schema/csv">Technické schéma</a>';
  assert.deepEqual(findCsvLinks(html, 'https://csu.gov.cz/produkty/isc_cr'), [
    'https://data.csu.gov.cz/opendata/sady/CEN0101E/distribuce/csv',
  ]);
});

test('validateSeries s maxAgeMonths hlásí zastaralá data', () => {
  const today = new Date('2026-11-05');
  const v = { '1995-01': 1 };
  assert.equal(validateSeries(v, { today, maxAgeMonths: 3 }).filter((e) => /zpět/.test(e)).length, 1);
  assert.deepEqual(validateSeries({ '1995-01': 1 }, { today: new Date('1995-03-01'), maxAgeMonths: 3 }), []);
});

test('skutečný formát DataStat CEN0101E (výřez): IZ2015, úhrn, Česko, domácnosti celkem, jen měsíce', async () => {
  const rows = parseCsv(await readFile(new URL('./fixtures/csu-CEN0101E.csv', import.meta.url), 'utf8'));
  const { base, values } = selectBaseIndex(rows);
  assert.equal(base, '2015');
  // Praha, důchodci, oddíl 01, kumulace (RRRR-MMK) a základ 2025 jsou vyřazeny
  assert.deepEqual(values, { '2025-12': 155.2, '2026-01': 156.5 });
  assert.equal(selectBaseIndex(rows, { preferBase: '2030' }).base, '2025');
});

test('combine: řada 010022 (1995–2025) + CEN0101E (2015–2026) se spojí bez změny hodnot', async () => {
  const oldRows = parseCsv(await readFile(new URL('./fixtures/csu-010022-25.csv', import.meta.url), 'utf8'));
  const newRows = parseCsv(await readFile(new URL('./fixtures/csu-CEN0101E.csv', import.meta.url), 'utf8'));
  const out = combine([
    { label: 'CEN0101E', ...selectBaseIndex(newRows) },
    { label: '010022', ...selectBaseIndex(oldRows) },
  ], () => {});
  // fixture 010022 nemá rok 2015, combine proto nepřepočítává základ (obě řady jsou 2015 = 100)
  assert.deepEqual(out, { '2024-11': 152.4, '2024-12': 152, '2025-11': 155.6, '2025-12': 155.2, '2026-01': 156.5 });
});
