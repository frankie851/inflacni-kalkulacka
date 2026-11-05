// Kontrola skutečných dat v data/cpi.json (vytváří je scripts/update-cpi.mjs).
// Pokud soubor chybí, test se přeskočí; s REQUIRE_CPI_DATA=1 (v GitHub Action) selže.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateSeries } from '../scripts/cpi-parse.mjs';

const file = new URL('../data/cpi.json', import.meta.url);
let data = null;
try {
  data = JSON.parse(await readFile(file, 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT' || process.env.REQUIRE_CPI_DATA === '1') throw err;
}

test('data/cpi.json: od 1995-01, bez děr, kladné hodnoty, ne v budoucnosti', { skip: data ? false : 'data/cpi.json chybí – spusťte npm run update-data' }, () => {
  const keys = Object.keys(data);
  assert.ok(keys.every((k) => /^\d{4}-\d{2}$/.test(k)), 'klíče musí být RRRR-MM');
  assert.deepEqual(validateSeries(data), []);
});

test('data/cpi.json: průměr roku 2015 ≈ 100', { skip: data ? false : 'data/cpi.json chybí' }, () => {
  const v = Object.entries(data).filter(([k]) => k.startsWith('2015-')).map(([, x]) => x);
  assert.equal(v.length, 12);
  const avg = v.reduce((a, b) => a + b, 0) / 12;
  assert.ok(Math.abs(avg - 100) < 0.05, `průměr 2015 = ${avg}`);
});
