import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  convert, cumulativeInflation, annualizedInflation, realReturn, realWageChange, nominalForPeriod,
  annualize, createSeries, resolveMonth, monthsBetween, levelSeries, yoySeries,
} from '../inflation.js';

const close = (actual, expected, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < eps, `${actual} ≠ ${expected}`);

// Testovací data (nejsou to data ČSÚ)
const sample = { '2020-01': 100, '2020-02': 110, '2020-03': 125 };

test('index 100 → 125: 100 Kč → 125 Kč, kumulativní inflace 25 %', () => {
  close(convert(100, 100, 125), 125);
  close(cumulativeInflation(100, 125), 0.25);
});

test('obrácený přepočet 125 Kč → 100 Kč', () => {
  close(convert(125, 125, 100), 100);
});

test('nominální výnos 4 %, inflace 2,5 % → reálný výnos ≈ 1,46 %', () => {
  const r = realReturn(0.04, 0.025);
  assert.equal((r * 100).toFixed(2), '1.46');
});

test('mzda 40 000 → 50 000 Kč při růstu indexu o 20 % → reálně +4,17 %', () => {
  const r = realWageChange(40000, 50000, 100, 120);
  assert.equal((r * 100).toFixed(2), '4.17');
});

test('24 měsíců, index 100 → 110,25 → průměrná roční inflace 5 %', () => {
  close(annualizedInflation(100, 110.25, 24), 0.05);
});

test('výnos p.a. ↔ za období', () => {
  close(nominalForPeriod(0.05, 24), 0.1025);
  close(annualize(0.1025, 24), 0.05);
  close(nominalForPeriod(0.04, 12), 0.04);
});

test('createSeries odmítne díru v řadě a neplatnou hodnotu', () => {
  assert.throws(() => createSeries({ '2020-01': 100, '2020-03': 101 }), /Díra/);
  assert.throws(() => createSeries({ '2020-01': 100, '2020-02': -1 }), /Neplatná/);
  const s = createSeries(sample);
  assert.equal(s.first, '2020-01');
  assert.equal(s.last, '2020-03');
});

test('měsíc bez dat se nahradí posledním (prvním) dostupným', () => {
  const s = createSeries(sample);
  assert.deepEqual(resolveMonth(s, '2026-10'), { month: '2020-03', clamped: 'after' });
  assert.deepEqual(resolveMonth(s, '1994-12'), { month: '2020-01', clamped: 'before' });
  assert.deepEqual(resolveMonth(s, '2020-02'), { month: '2020-02', clamped: false });
});

test('monthsBetween přes přelom roku', () => {
  assert.equal(monthsBetween('2019-11', '2020-02'), 3);
  assert.equal(monthsBetween('2005-01', '2005-01'), 0);
});

test('levelSeries začíná na 100, yoySeries počítá meziroční změnu', () => {
  const s = createSeries(sample);
  const lvl = levelSeries(s, '2020-01', '2020-03');
  lvl.forEach((p, i) => close(p.value, [100, 110, 125][i]));
  const months = {};
  for (let i = 0; i < 12; i++) months[`2020-${String(i + 1).padStart(2, '0')}`] = 100 + i;
  months['2021-01'] = 112.2;
  const s2 = createSeries(months);
  const yoy = yoySeries(s2, '2020-12', '2021-01');
  assert.equal(yoy[0].value, null);
  close(yoy[1].value, 0.122);
});
