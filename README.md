# Inflační kalkulačka – kolik mají moje peníze dnes

Statický web v češtině se třemi nástroji nad oficiálními daty Českého statistického úřadu:

1. **Přepočet částky:** kolik odpovídá dnes např. 10 000 Kč z ledna 2005 (tlačítkem ⇄ i obráceně).
2. **Reálný výnos:** jestli úrok nebo výnos investice za zvolené období porazil inflaci.
3. **Reálná mzda:** o kolik procent si reálně polepšila (nebo pohoršila) vaše mzda.

Pod výsledkem jsou dva grafy: vývoj cenové hladiny za zvolené období (začátek = 100) a meziroční
inflace po měsících. Stejná čísla lze zobrazit i v tabulce.

Výpočet je orientační: index popisuje průměrný spotřební koš domácností, ne vaše osobní výdaje.

## Data

- Zdroj: ČSÚ, [Indexy spotřebitelských cen – inflace – časové řady](https://csu.gov.cz/produkty/isc_cr),
  sekce Otevřená data (CSV), dokumentace datové sady 010022.
- Použitá řada: **bazický index** (`casz_kod = Z`, ukazatel 6134) za **úhrn spotřebního koše**, ČR,
  měsíčně, **průměr 2015 = 100**, od ledna 1995.
- Web čte jen soubor `data/cpi.json` ve tvaru `{ "RRRR-MM": index }`. ČSÚ z prohlížeče nikdy nevolá.

### Vzorce (`inflation.js`)

| Výpočet | Vzorec |
|---|---|
| Přepočet částky | částka × (index cílového měsíce / index výchozího měsíce) |
| Kumulativní inflace | index_cíl / index_výchozí − 1 |
| Průměrná roční inflace | (index_cíl / index_výchozí)^(12 / počet měsíců) − 1 |
| Reálný výnos | (1 + nominální výnos) / (1 + inflace) − 1, za stejné období |
| Reálná změna mzdy | (mzda_dnes / mzda_dřív) / (index_dnes / index_dřív) − 1 |

Výnos zadaný „ročně (p.a.)“ se na období přepočte jako (1 + r)^(měsíce / 12) − 1.
Když zvolíte měsíc, za který ještě nejsou data, použije se poslední dostupný a u výsledku je to napsané.

## Spuštění

Potřebujete Node.js 20 nebo novější (pro testy a aktualizaci dat). Web samotný nemá žádné závislosti,
jen ho musíte otevřít přes lokální server, protože `fetch` ze souboru (`file://`) nefunguje:

```bash
npx serve .
```

nebo

```bash
python3 -m http.server 8000
```

a otevřete <http://localhost:8000> (u `serve` adresu, kterou vypíše).

Testy:

```bash
node --test
```

## Aktualizace dat

### Automaticky

GitHub Action `.github/workflows/update-cpi.yml` běží 11.–15. den každého měsíce (ČSÚ zveřejňuje inflaci
obvykle kolem 10.). Spustí `scripts/update-cpi.mjs`, pak testy, a když se data změnila, commitne
`data/cpi.json`. Ručně ji můžete spustit v záložce **Actions → Aktualizace dat ČSÚ → Run workflow**.

### Ručně ze sítě

```bash
node scripts/update-cpi.mjs
```

Skript načte stránku produktu ISC, najde na ní odkazy na CSV, z každého vybere bazický index za úhrn
spotřebního koše a řady spojí. Vypíše použité soubory a sloupce, rozsah řady a dvě kontroly (průměr roku
2015 ≈ 100 a meziroční inflaci za poslední měsíc, kterou můžete porovnat s tiskovou zprávou ČSÚ).
Volba `--dry-run` nic nezapíše, `--url <adresa.csv>` použije konkrétní soubor.

### Ručně ze staženého souboru (když automatické stažení nejde)

1. Jednou měsíčně (po zveřejnění inflace) otevřete <https://csu.gov.cz/produkty/isc_cr>, v sekci
   **Otevřená data** stáhněte CSV s časovou řadou indexů.
2. Spusťte:

   ```bash
   node scripts/update-cpi.mjs --file ~/Stažené/soubor.csv
   ```

   Pokud řada od roku 1995 vychází ve dvou souborech (starší a novější část, případně jiný základ),
   zadejte oba, skript je naváže přes společné měsíce a přepočte na 2015 = 100:

   ```bash
   node scripts/update-cpi.mjs --file stary.csv --file novy.csv
   ```

3. Spusťte `node --test` a commitněte `data/cpi.json`.

Skript skončí chybou místo hádání, když filtr nenajde právě jednu hodnotu na měsíc, v řadě je díra
nebo se dvě navazované řady v překryvu liší o víc než 0,05 %.

## Nasazení (GitHub Pages)

1. Nahrajte repozitář na GitHub.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**, větev `main`, složka `/ (root)`.
3. **Settings → Actions → General → Workflow permissions:** zapněte **Read and write permissions**,
   aby měsíční akce mohla commitovat data.
4. Web poběží na `https://<uživatel>.github.io/<repozitář>/`. Všechny cesty jsou relativní, takže funguje
   i v podsložce.

## Struktura

```
index.html, styles.css, app.js   uživatelské rozhraní
inflation.js                     výpočty (bez DOM)
data/cpi.json                    bazický index, měsíc → hodnota
scripts/update-cpi.mjs           stažení a uložení dat
scripts/cpi-parse.mjs            parsování CSV, výběr řady, navázání, kontroly
test/                            testy (node --test)
.github/workflows/               měsíční aktualizace dat a testy
```
