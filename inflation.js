// Čisté výpočty nad bazickým indexem spotřebitelských cen. Bez vazby na DOM,
// použitelné v prohlížeči i v Node (testy).

/** "RRRR-MM" → pořadové číslo měsíce (rok * 12 + měsíc - 1). */
export function monthToOrdinal(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`Neplatný měsíc "${month}", očekávám RRRR-MM`);
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) throw new Error(`Neplatný měsíc "${month}"`);
  return Number(m[1]) * 12 + mm - 1;
}

/** Pořadové číslo → "RRRR-MM". */
export function ordinalToMonth(ord) {
  const y = Math.floor(ord / 12);
  const mm = (ord % 12) + 1;
  return `${y}-${String(mm).padStart(2, '0')}`;
}

/** Počet měsíců mezi dvěma měsíci (to − from). */
export function monthsBetween(from, to) {
  return monthToOrdinal(to) - monthToOrdinal(from);
}

/**
 * Z mapy { "RRRR-MM": index } vytvoří řadu se seřazenými měsíci.
 * Vyžaduje souvislou řadu bez děr a kladné hodnoty.
 */
export function createSeries(cpiMap) {
  const months = Object.keys(cpiMap).sort();
  if (months.length === 0) throw new Error('Prázdná řada indexů');
  for (let i = 0; i < months.length; i++) {
    const v = cpiMap[months[i]];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      throw new Error(`Neplatná hodnota indexu pro ${months[i]}: ${v}`);
    }
    if (i > 0 && monthsBetween(months[i - 1], months[i]) !== 1) {
      throw new Error(`Díra v řadě mezi ${months[i - 1]} a ${months[i]}`);
    }
  }
  return {
    months,
    values: cpiMap,
    first: months[0],
    last: months[months.length - 1],
    index(month) {
      const v = cpiMap[month];
      if (v === undefined) throw new Error(`Index pro ${month} není k dispozici`);
      return v;
    },
  };
}

/**
 * Měsíc mimo dostupná data nahradí nejbližším dostupným.
 * @returns {{ month: string, clamped: false | 'after' | 'before' }}
 */
export function resolveMonth(series, month) {
  if (month > series.last) return { month: series.last, clamped: 'after' };
  if (month < series.first) return { month: series.first, clamped: 'before' };
  return { month, clamped: false };
}

/** Přepočet částky: částka × (index cíle / index výchozího měsíce). */
export function convert(amount, indexFrom, indexTo) {
  return amount * (indexTo / indexFrom);
}

/** Kumulativní inflace: index_cíl / index_výchozí − 1. */
export function cumulativeInflation(indexFrom, indexTo) {
  return indexTo / indexFrom - 1;
}

/** Průměrná roční inflace: (index_cíl / index_výchozí)^(12 / počet měsíců) − 1. */
export function annualizedInflation(indexFrom, indexTo, months) {
  if (!(months > 0)) throw new Error('Počet měsíců musí být kladný');
  return Math.pow(indexTo / indexFrom, 12 / months) - 1;
}

/** Reálný výnos: (1 + nominální) / (1 + inflace) − 1, za stejné období. */
export function realReturn(nominal, inflation) {
  return (1 + nominal) / (1 + inflation) - 1;
}

/** Roční sazba p.a. → nominální výnos za daný počet měsíců (s ročním složeným úročením). */
export function nominalForPeriod(ratePa, months) {
  return Math.pow(1 + ratePa, months / 12) - 1;
}

/** Výnos za období → průměrný roční (p.a.). */
export function annualize(totalReturn, months) {
  if (!(months > 0)) throw new Error('Počet měsíců musí být kladný');
  return Math.pow(1 + totalReturn, 12 / months) - 1;
}

/** Reálná změna mzdy: (mzda_dnes / mzda_dřív) / (index_dnes / index_dřív) − 1. */
export function realWageChange(wageThen, wageNow, indexThen, indexNow) {
  return wageNow / wageThen / (indexNow / indexThen) - 1;
}

/** Cenová hladina za období, přepočtená tak, aby výchozí měsíc = 100. */
export function levelSeries(series, from, to) {
  const base = series.index(from);
  const out = [];
  for (let o = monthToOrdinal(from); o <= monthToOrdinal(to); o++) {
    const m = ordinalToMonth(o);
    out.push({ month: m, value: (series.index(m) / base) * 100 });
  }
  return out;
}

/** Meziroční inflace po měsících (index[m] / index[m − 12] − 1); null, kde chybí data. */
export function yoySeries(series, from, to) {
  const out = [];
  for (let o = monthToOrdinal(from); o <= monthToOrdinal(to); o++) {
    const m = ordinalToMonth(o);
    const prev = series.values[ordinalToMonth(o - 12)];
    out.push({ month: m, value: prev === undefined ? null : series.index(m) / prev - 1 });
  }
  return out;
}
