// UI vrstva: čte data/cpi.json, ovládá formuláře a grafy. Výpočty jsou v inflation.js.
import {
  createSeries, resolveMonth, convert, cumulativeInflation, annualizedInflation, realReturn,
  nominalForPeriod, annualize, realWageChange, monthsBetween, levelSeries, yoySeries,
} from './inflation.js';

const MONTHS_NOM = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];
const MONTHS_GEN = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
const MONTHS_LOC = ['lednu', 'únoru', 'březnu', 'dubnu', 'květnu', 'červnu', 'červenci', 'srpnu', 'září', 'říjnu', 'listopadu', 'prosinci'];
const FIRST_YEAR = 1995;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const czk = (v) => new Intl.NumberFormat('cs-CZ', {
  style: 'currency', currency: 'CZK', maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2,
}).format(v);
const pct = (v, digits = 1, sign = false) => new Intl.NumberFormat('cs-CZ', {
  style: 'percent', minimumFractionDigits: digits, maximumFractionDigits: digits,
  signDisplay: sign ? 'exceptZero' : 'auto',
}).format(v);
const num = (v, d = 2) => new Intl.NumberFormat('cs-CZ', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
const nom = (m) => `${MONTHS_NOM[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const gen = (m) => `${MONTHS_GEN[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const loc = (m) => `${MONTHS_LOC[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;
const parseInput = (s) => Number(String(s).replace(/[\s ]/g, '').replace(',', '.'));
const shiftYears = (m, years) => `${Number(m.slice(0, 4)) + years}${m.slice(4)}`;

let series;
let charts = null;
let activeTool = 'convert';
const state = {}; // nástroj → { from, to } (vyřešené měsíce) pro grafy

// ---------- výběr měsíce ----------
function buildMonthPicker(fieldset, initial) {
  const row = document.createElement('div');
  row.className = 'month-row';
  const label = fieldset.querySelector('legend').textContent;
  const mSel = document.createElement('select');
  mSel.setAttribute('aria-label', `${label} – měsíc`);
  MONTHS_NOM.forEach((name, i) => mSel.add(new Option(name, String(i + 1).padStart(2, '0'))));
  const ySel = document.createElement('select');
  ySel.setAttribute('aria-label', `${label} – rok`);
  const lastYear = Number(series.last.slice(0, 4));
  for (let y = lastYear; y >= FIRST_YEAR; y--) ySel.add(new Option(String(y), String(y)));
  row.append(mSel, ySel);
  fieldset.append(row);
  setMonth(fieldset, initial);
}
const getMonth = (fs) => `${$$('select', fs)[1].value}-${$$('select', fs)[0].value}`;
function setMonth(fs, m) {
  const [mSel, ySel] = $$('select', fs);
  ySel.value = m.slice(0, 4);
  mSel.value = m.slice(5);
}

function readPeriod(form) {
  const notes = [];
  const pick = (key) => {
    const raw = getMonth($(`[data-month="${key}"]`, form));
    const r = resolveMonth(series, raw);
    if (r.clamped === 'after') notes.push(`Za ${nom(raw)} zatím data nejsou, počítám s posledním dostupným měsícem (${nom(r.month)}).`);
    if (r.clamped === 'before') notes.push(`Data začínají měsícem ${nom(r.month)}, počítám s ním.`);
    return r.month;
  };
  return { from: pick('from'), to: pick('to'), notes };
}

function show(panel, { value = '–', text = '', notes = [], tone = '' }) {
  const v = $('[data-out="value"]', panel);
  v.textContent = value;
  v.className = `result-value${tone ? ` ${tone}` : ''}`;
  $('[data-out="text"]', panel).textContent = text;
  const n = $('[data-out="note"]', panel);
  n.hidden = notes.length === 0;
  n.textContent = notes.join(' ');
}

// ---------- nástroje ----------
const tools = {
  convert(form, panel) {
    const amount = parseInput(form.amount.value);
    const { from, to, notes } = readPeriod(form);
    state.convert = { from, to };
    if (!(amount >= 0)) return show(panel, { text: 'Zadejte částku jako číslo, např. 10 000.', notes });
    const i0 = series.index(from), i1 = series.index(to);
    const result = convert(amount, i0, i1);
    const cum = cumulativeInflation(i0, i1);
    const months = Math.abs(monthsBetween(from, to));
    let text;
    if (from === to) {
      text = 'Výchozí i cílový měsíc jsou stejné, částka se nemění.';
    } else {
      const [a, b] = from < to ? [from, to] : [to, from];
      const change = from < to ? cum : 1 / (1 + cum) - 1; // změna cen v chronologickém směru
      const avg = months > 0 ? annualizedInflation(1, 1 + change, months) : 0;
      const dir = change >= 0 ? 'vzrostly' : 'klesly';
      text = `Ceny od ${gen(a)} do ${gen(b)} ${dir} o ${pct(Math.abs(change))} (průměrně ${pct(avg, 1)} ročně). `
        + `${czk(amount)} v ${loc(from)} má stejnou kupní sílu jako ${czk(result)} v ${loc(to)}.`;
    }
    show(panel, { value: czk(result), text, notes });
  },

  return(form, panel) {
    const rate = parseInput(form.rate.value) / 100;
    const { from, to, notes } = readPeriod(form);
    state.return = { from, to };
    const months = monthsBetween(from, to);
    if (!Number.isFinite(rate) || rate <= -1) return show(panel, { text: 'Zadejte výnos v procentech, např. 4 nebo 3,5.', notes });
    if (months <= 0) return show(panel, { text: 'Zvolte období, ve kterém je „Do“ později než „Od“.', notes });
    const i0 = series.index(from), i1 = series.index(to);
    const infl = cumulativeInflation(i0, i1);
    const nominal = form.rateType.value === 'pa' ? nominalForPeriod(rate, months) : rate;
    const real = realReturn(nominal, infl);
    const realPa = annualize(real, months);
    const grew = real >= 0;
    const perYear = form.rateType.value === 'pa';
    const value = perYear ? `${pct(realPa, 2, true)} ročně` : `${pct(real, 2, true)} za období`;
    const text = `Za ${months} měs. (${nom(from)} – ${nom(to)}) vzrostly peníze nominálně o ${pct(nominal)}, ceny o ${pct(infl)}. `
      + (grew
        ? `Reálně tedy peníze rostly o ${pct(real)} (průměrně ${pct(realPa, 2)} ročně).`
        : `Reálně tedy ztrácely hodnotu: ${pct(real, 1, true)} (průměrně ${pct(realPa, 2, true)} ročně).`);
    show(panel, { value, text, notes, tone: grew ? 'good' : 'bad' });
  },

  wage(form, panel) {
    const w0 = parseInput(form.wageThen.value);
    const w1 = parseInput(form.wageNow.value);
    const { from, to, notes } = readPeriod(form);
    state.wage = { from, to };
    if (!(w0 > 0) || !(w1 > 0)) return show(panel, { text: 'Zadejte obě mzdy jako kladná čísla.', notes });
    const i0 = series.index(from), i1 = series.index(to);
    const change = realWageChange(w0, w1, i0, i1);
    const needed = convert(w0, i0, i1);
    const better = change >= 0;
    const text = `Mzda se nominálně změnila o ${pct(w1 / w0 - 1, 1, true)}, ceny o ${pct(cumulativeInflation(i0, i1), 1, true)}. `
      + `${better ? 'Reálně jste si polepšili' : 'Reálně jste si pohoršili'} o ${pct(Math.abs(change), 2)}; `
      + `na stejnou kupní sílu jako ${czk(w0)} v ${loc(from)} by v ${loc(to)} stačilo ${czk(needed)}.`;
    show(panel, { value: pct(change, 2, true), text, notes, tone: better ? 'good' : 'bad' });
  },
};

function run(tool) {
  const panel = $(`#panel-${tool}`);
  tools[tool]($('form', panel), panel);
  if (tool === activeTool) renderCharts();
}

// ---------- grafy ----------
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function chartPeriod() {
  const { from, to } = state[activeTool] ?? { from: series.first, to: series.last };
  let [a, b] = from <= to ? [from, to] : [to, from];
  if (a === b) a = resolveMonth(series, shiftYears(b, -1)).month; // aspoň rok, ať je co kreslit
  return [a, b];
}

function renderCharts() {
  const [a, b] = chartPeriod();
  const level = levelSeries(series, a, b);
  const yoy = yoySeries(series, a, b);
  $('[data-chart-sub="level"]').textContent = `${nom(a)} = 100, do ${gen(b)}`;
  $('[data-chart-sub="yoy"]').textContent = `po měsících, ${nom(a)} – ${nom(b)}`;
  renderTable(level, yoy);

  if (!window.Chart) { $('#chart-error').hidden = false; return; }
  const color = cssVar('--series-1'), grid = cssVar('--grid'), ink = cssVar('--text-2');
  const labels = level.map((p) => `${Number(p.month.slice(5))}/${p.month.slice(0, 4)}`);
  const base = (data, fmt, zeroLine) => ({
    type: 'line',
    data: { labels, datasets: [{ data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHitRadius: 12, tension: 0, spanGaps: false }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { displayColors: false, callbacks: { title: (it) => nom(level[it[0].dataIndex].month), label: (it) => fmt(it.parsed.y) } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: ink, maxRotation: 0, autoSkip: true, maxTicksLimit: 5 } },
        y: {
          grid: { color: zeroLine ? (c) => (c.tick.value === 0 ? ink : grid) : grid },
          border: { display: false },
          ticks: { color: ink, maxTicksLimit: 6, callback: (v) => fmt(v, true) },
        },
      },
    },
  });
  const levelCfg = base(level.map((p) => p.value), (v, tick) => num(v, tick ? 0 : 1), false);
  const yoyCfg = base(yoy.map((p) => (p.value === null ? null : p.value * 100)), (v, tick) => `${num(v, tick ? 0 : 1)} %`, true);

  if (charts) { charts.level.destroy(); charts.yoy.destroy(); }
  charts = { level: new Chart($('#chart-level'), levelCfg), yoy: new Chart($('#chart-yoy'), yoyCfg) };
}

function renderTable(level, yoy) {
  const rows = level.map((p, i) => {
    const y = yoy[i].value;
    return `<tr><td>${nom(p.month)}</td><td>${num(series.index(p.month))}</td><td>${num(p.value, 1)}</td><td>${y === null ? '–' : `${num(y * 100, 1)} %`}</td></tr>`;
  });
  $('#data-table').innerHTML = rows.reverse().join('');
}

// ---------- záložky ----------
const HASH = { convert: 'prepocet', return: 'vynos', wage: 'mzda' };
function selectTab(tool, focus = false) {
  activeTool = tool;
  for (const tab of $$('[role="tab"]')) {
    const on = tab.id === `tab-${tool}`;
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $(`#${tab.getAttribute('aria-controls')}`).hidden = !on;
    if (on && focus) tab.focus();
  }
  history.replaceState(null, '', `#${HASH[tool]}`);
  renderCharts();
}

function initTabs() {
  const tabs = $$('[role="tab"]');
  tabs.forEach((tab, i) => {
    const tool = tab.id.replace('tab-', '');
    tab.addEventListener('click', () => selectTab(tool));
    tab.addEventListener('keydown', (e) => {
      const n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (n === undefined) return;
      e.preventDefault();
      selectTab(tabs[(n + tabs.length) % tabs.length].id.replace('tab-', ''), true);
    });
  });
}

// ---------- start ----------
async function init() {
  initTabs();
  try {
    const res = await fetch('data/cpi.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    series = createSeries(await res.json());
  } catch (err) {
    const box = $('#load-error');
    box.hidden = false;
    box.textContent = `Data indexu spotřebitelských cen se nepodařilo načíst (${err.message}). Zkuste stránku obnovit později.`;
    $$('form').forEach((f) => f.querySelectorAll('input, select, button').forEach((el) => { el.disabled = true; }));
    return;
  }
  $('#last-data').textContent = nom(series.last);

  const defaults = {
    convert: { from: resolveMonth(series, '2005-01').month, to: series.last },
    return: { from: resolveMonth(series, shiftYears(series.last, -5)).month, to: series.last },
    wage: { from: resolveMonth(series, shiftYears(series.last, -10)).month, to: series.last },
  };
  for (const form of $$('form[data-tool]')) {
    const tool = form.dataset.tool;
    for (const fs of $$('[data-month]', form)) buildMonthPicker(fs, defaults[tool][fs.dataset.month]);
    form.addEventListener('input', () => run(tool));
    form.addEventListener('change', () => run(tool));
    form.addEventListener('submit', (e) => e.preventDefault());
    const swap = $('[data-swap]', form);
    if (swap) swap.addEventListener('click', () => {
      const [a, b] = [$('[data-month="from"]', form), $('[data-month="to"]', form)];
      const m = getMonth(a);
      setMonth(a, getMonth(b));
      setMonth(b, m);
      run(tool);
    });
    tools[tool](form, $(`#panel-${tool}`));
  }

  const fromHash = Object.entries(HASH).find(([, h]) => `#${h}` === location.hash);
  selectTab(fromHash ? fromHash[0] : 'convert');
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderCharts);
}

init();
