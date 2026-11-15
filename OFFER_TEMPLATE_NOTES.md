# Offer template (user's Excel) — findings so far

Source copy: `synchro-data/template/offer_template.xlsx`; cell dumps per sheet: `synchro-data/template/dump/*.txt`
(format `A1=value | B1==formula`). 17 sheets: Equipment (2), Equipment, Труд, Play, Sport, Padel, SBR Tiles, КСС, GreenSet,
Grass, Материали, Multi1CS, Multi2CS, Melos EPDM, PU Top Coat, Corkeen EUR, One DNA.

Read so far: **Equipment**, **КСС** (generic offer sheets). NOT yet read: Труд, Play, Sport, Padel, SBR Tiles, GreenSet, Grass,
Материали, Multi1CS, Multi2CS, Melos EPDM, PU Top Coat, Corkeen EUR, One DNA.

## Header block (rows 1-7)
На вниманието на (C1) · Обект (C2) · Оферта № G… + date `=TODAY()` (C3) · валидност на оферта I4 = N месец/а ·
Валидна до `=EDATE(date, months)` · Съставил (C6) · Тел. за връзка (C7).

## Line columns (row 8 headers, lines from row 10)
A No | B Описание на СМР / Вид материал | D Изображение | E Ед. мярка | F Количество | G Ед. цена € | H Обща стойност
internal (not shown to customer): I Материал франко доставчик | J Доставка | K Сума доставки | L Надници | M Стойност (day rate) |
N Сума монтаж | O Сума | P Режийни | Q Сума режийни | R Себест-ст | S Печалба % | T profit/unit | U сума печалба | V Корпоративен данък | W Ед.цена към клиента

## Formulas (per unit unless noted)
- O = I + J + L*M              direct cost per unit (material + delivery + labour)
- P = O * 0.035                overhead 3.5 %
- S = 0.30                     profit rate (editable per line)
- T = O * S                    profit per unit
- V = T * 0.10                 corporate tax 10 % of profit
- W = O + P + T + V            unit price to customer
- G = ROUND(W, 2); H = F * G   line total
- K = J*F · N = L*M*F · Q = P*F · R = O*F + Q (cost total) · U = T*F (profit total)
- Totals: Σ H = "Общо, € без ДДС", ДДС 20 %, "Общо, € с ДДС"
- Equipment sheet pulls L (надници) and M (rate) from sheet Труд; fixed lines: "Сертифициране съгласно Наредба №1" (I=260),
  "Доставка на табела, съгласно Наредба №1 ..." (I=130).

## Legal / administrative clauses printed under the totals
1. Настоящата оферта има информативен характер и не представлява обвързващ договор.
2. Ангажиментите на страните стават окончателни само след подписването на писмен договор или изрично писмено потвърждение на поръчката от страна на Изпълнителя.
3. Изпълнителят си запазва правото да коригира предложените цени в случай на настъпване на обстоятелства извън неговия контрол (напр. рязка промяна в цените на енергоносителите, суровините или законови промени), за което Клиентът ще бъде уведомен своевременно.
4. Всички концепции, графични материали, изчисления и технически решения, съдържащи се в офертата, са собственост на Изпълнителя. Те не могат да бъдат предоставяни на трети лица без изрично писмено съгласие.

## Integration plan
- offer_lines gets the cost breakdown columns (material, delivery, man-days, day rate, profit %) and unit_price/unit_cost are
  computed with the formulas above; overhead %, corporate tax %, default profit % are Settings.
- Offer header gets: attention_to, validity months, prepared by + phone.
- Printable offer (customer view: No, description, unit, qty, unit price, total, totals, clauses) + Excel export.
- Product-system sheets (Play, Sport, Padel, …) to be turned into offer templates (preset lines) once read.
## Sheet Труд (labour calculator) — read
- Table rows: Мобилизация, Демобилизация, Механизация, Други СМР м²/бр., Плочи м², Плочи л/м, настилка м², разчертаване, съоръжения.
  Columns: C Брой работници | D Мярка (м²/л.м/брой) | E Брой надници = C*G | F нощувки | G Брой работни дни. Row 13 totals.
- Man-days per unit: "Настилка надник за м²" = E10/D10; "Плочи надник за м²" = E8/D8; "Плочи надник за л/м" = E9/D9.
- Разходи за изпълнение: Надници = Σ man-days × 240 €/day; Гориво = Σ fuel; Нощувки = Σ nights × 30 €; + Механизация + Други СМР + Други разходи
  = ОБЩО РАЗХОДИ ЗА ТРУД; "Единична цена за човек на ден" = total labour cost / man-days  (this is M "Стойност" in the offer lines).
- Fuel: per vehicle group, L = distance both ways × consumption/100 × 1.05 × trips. Consumption: Dacia/Touran 10 l/100km, Iveco/Renault/Ford 13, truck 17.
- Vehicle list (reg. no, model, avg consumption, seats, load): Iveco Daily ×2, Ford, Renault Master, Dacia Dokker, VW Touran, truck 6T.
- Productivity norms (reference text): Corkeen 100 m²/day first layer, 60 second; SBR/EPDM ≤2cm 100 m²/day with equipment, 120-130 without; EPDM 1cm 80 / 90-100;
  tiles 100 m²/day (min 4 people); tile kerb 100 l.m/day; paver 500 m²/day; bench anchor mount 2 people 5-7/day; foundation mount 3 people 3-5/day;
  fence 2 people 40 l.m/day; mixer 500 kg/h, 3 t/day max; PU paint on SBR 4 people / 2 coats / 400 m²/day; line marking per sport: 6 man-days + 400 € materials.
- Weekly day-by-day plan grid (day, activity, surface m², layer, people).

## Sheet Материали — read
Material order summary for a site: total m², kg of SBR, primer, SBR binder, aromatic / aliphatic EPDM binder, EPDM granule per RAL colour.

## Still to read: Play, Sport, Padel, SBR Tiles, GreenSet, Grass, Multi1CS, Multi2CS, Melos EPDM, PU Top Coat, Corkeen EUR, One DNA, Equipment (2)

## Sheet Sport — read
Same header and same line columns/formulas as КСС. The sheet is a set of **system sections**; each section = a description paragraph
(merged row, printed to the customer) + preset lines + its own totals (без ДДС, ДДС 20 %, с ДДС). L (man-days per m²) comes from the Труд calculator.
Sections (system → preset lines, unit м²):
- InfraSPORT 2Е — двупластова ударопоглъщаща саморазливна настилка; EPDM гранула + биндер Melos GmbH Германия, SBR гранула България.
  Lines: "Доставка и полагане на двупластова разливна каучукова настилка, дебелина 2см, цвят RAL …" ×2
- InfraSPORT 1Е — еднопластова; EPDM + биндер Melos. Lines: "… еднопластова разливна каучукова настилка, дебелина 1см, цвят RAL …" ×2
- InfraSPORT 1CS — еднопластова; биндер Melos + SBR България. Lines: еднопластова 1см ×2
- InfraSPORT 2CS — двупластова; биндер Melos + SBR. Lines: двупластова 2см ×2
- InfraSPORT PU Top coat — двупластова; Lines: двупластова 2см ×2
- InfraSPORT Retop — еднопластова полиуретанова финиш система; Line: "Доставка и полагане на еднопластова полиуретанова финиш система цвят по RAL"; **overhead 2 % (not 3.5 %)**
- InfraSPORT Insito — двупластова; EPDM + биндер Melos + SBR. Lines: двупластова 2см ×2
=> overhead % must be editable per line (default 3.5 %), and an offer needs **sections** with a printed description and per-section subtotals.
Prepared-by phone differs per sheet (0884445490 / 0898788202) => "Съставил" + phone come from the user who prepares the offer.

## Sheet Play — read (same structure as Sport: system sections, unit м², profit 30 %)
- MultiPLAY 2Е — двупластова ударопоглъщаща саморазливна настилка; EPDM гранула + биндер Melos GmbH Германия, SBR гранула България.
  Lines ×2: "Доставка и полагане на двупластова разливна каучукова настилка, дебелина 2 см, цвят RAL"
- MultiPLAY 1Е — еднопластова; EPDM + биндер Melos. Lines ×2: "… еднопластова разливна каучукова настилка, дебелина 1см, цвят RAL"
- MultiPLAY 1CS — еднопластова; биндер Melos + SBR България. Lines ×2: "… еднопластова разливна каучукова настилка, дебелина 1см"
- MultiPLAY 2CS — двупластова; биндер Melos + SBR. Lines ×2: "… двупластова разливна каучукова настилка, дебелина 2см, цвят"
- MultiPLAY PU Retop — еднопластова полиуретанова финиш система. Line: "Доставка и полагане на еднопластова полиуретанова финиш система цвят по RAL"
- Corkeen Play Original 40мм — двупластова система: ударопоглъщащ основен пласт 25мм и устойчив на износване горен пласт 15мм.
  Line: "Доставка и полагане на Corkeen Play Original 40мм., двупластова система: …" with material 59.89 €/м², delivery 4.92 €/м².
All section descriptions end with "Използват се разходни норми, съгласно предписания на производителя."

## Sheet Padel — read (offer № example "39G"; unit к-т / бр; four alternative court variants, each its own table + totals)
Each variant: intro sentence, then
 1. "Доставка и анкерен монтаж на конструкция за падел корт игрище система Steel Vision - Glass court 12mm" — к-т, delivery 2500, 15 man-days, day rate from Труд
 2. "Доставка и полагане на тревна настилка за падел Court ADVANCE monof. Green /вкл. Glue for court & Join tape/" — бр, material 2530
Variant intro → structure material price: "Първият супер панорамен корт за падел на пазара с въглеродни влакна, издържащ на най-големите бури." 16400;
"Този супер панорамен корт е специално проектиран и разработен за събития и изложения. Играйте като професионалист!" 15520;
"Единственият корт за падел на пазара със система за регулиране на височината за по-прецизен и безопасен монтаж, предлага панорамна гледка." 14640;
"Първият корт за падел на пазара със система за регулиране на височината за по-прецизен и безопасен монтаж." 13680.
Footer "Допълнителни опции за персонализиране": избор тип настилка; цвят настилка; настилка за периметъра; тип структурна конструкция;
цвят и допълнително покритие на конструкция; допълнителна предпазна мрежа; размери и дебелини за стъкла; аксесоари.
=> sections can be **alternatives** (each with its own total, not summed together) and a section can carry a footer text.

## Still to read: SBR Tiles, GreenSet, Grass, Multi1CS, Multi2CS, Melos EPDM, PU Top Coat, Corkeen EUR, One DNA, Equipment (2)

## Sheet SBR Tiles — read (two alternative tables, unit м², profit 30 %)
- "Доставка и монтаж на каучукова настилка на плочи Inno PRO с размери 40см.*40 см. и дебелина 2 см, цвят - черен, зелен, червен"
  — unit price typed directly as a sum: G = 12.52 + 2.56 + 7.67 (not the W formula).
- "Доставка и монтаж на каучукова настилка на плочи Inno PRO MAX с размери 40см.*40 см. и дебелина 2 см, цвят - черен, зелен, червен,
  светло / тъмно сив, светло / тъмно син, жълт" — G = 16.61 + 2.56 + 7.67; example qty 400.
=> a line must allow a **manually entered unit price** that overrides the calculated one.

## Sheet GreenSet — read (variant of the model: labour entered as one amount per unit)
Columns here: I Материал франко доставчик | J Доставка | **L Монтаж (installation cost per unit, a single amount)** | M Сума монтаж = F*L |
N Сума = I + J + L | O Режийни = N*0.035 | Q Себест-ст = N*F + O*F | R Печалба 0.3 | S = N*R | U Корпоративен данък = S*10 % | V Ед.цена = U + S + N + O.
Same result as the main model with "man-days × day rate" replaced by one installation amount per unit.
Sections (alternatives, each with own totals):
- "TOUR COURT" от Greenset™ — трипластова акрилна система (свързващ, основен и финиш пласт), произход Greenset™ Испания; note "3 души - 5 дни общо".
  Lines: "Доставка и полагане на трипластова разливна акрилна настилка. TOUR COURT Greenset™" м², qty 648, material 6.40, delivery 2.00, installation 9.26;
  "Разчертаване за стандарт Тенис" бр, material 830.
- "GRAND SLAM COURT" от Greenset™ — акрилна система от 5 пласта; note "3 души - 8 дни общо".
  Lines: "… GRAND SLAM Greenset™" м², qty 648, material 11.50, delivery 2.38, installation 11.83; "Разчертаване за стандарт Тенис" бр, 830.

## Sheet Grass — read (GreenSet-style columns)
Line: "Доставка и полагане на изкуствена тревна настилка с височина на влакното … мм." м², material 13.78, delivery 1.44, installation 3.70.

=> labour input per line must support BOTH: (a) man-days per unit × day rate, (b) a direct installation amount per unit.

## Still to read: Multi1CS, Multi2CS, Melos EPDM, PU Top Coat, Corkeen EUR, One DNA, Equipment (2)

## Sheets Multi1CS and PU Top Coat — read. These are **system recipe calculators** (material cost per m²), not customer offers.
Inputs: Квадратура на площадката (м²), Дебелина на настилката (см).
Multi1CS "ЕДНОПЛАСТОВА ОЦВЕТЕНА САМОРАЗЛИВНА НАСТИЛКА 2-4mm":
- Ароматен биндер за грунд = area × 0.2 kg @ 2.65 €/kg
- SBR гранули = area × thickness(cm) × 6 kg @ 0.19 €/kg
- Боя (oxide pigment) = SBR kg × 0.025; price per colour €/kg: светло червено 2.5053, тъмно червено 1.5339, жълто 1.5339, зелено 8.4363,
  оранжево 1.7895, светло кафяво 1.7895, тъмно кафяво 1.7895, синьо 49.0840, бял 4.8573, черен 1.7895
- Ароматен биндер за SBR = SBR kg × 20 % @ 2.65 €/kg
- Delivery: SBR = kg/1000 × 77.24 €/t; binder = kg/214 × 30.9 € (per 214 kg drum); pigment delivery entered manually; Сума доставки / area = delivery per m²
- Рекапитулация per m²: Материал = Σ material cost / area; Труд (entered); Доставка = delivery per m²; Ед.цена = sum.
- Binder price list (primer binder €/kg): HASAN 2.65, DOW Chemicals 3.14, MELOS 3.58, HASAN зелен 3.13, HASAN червен 3.13.
- Consumption note: 80 kg SBR : 2 kg oxide pigment (0.025 × SBR) : 15 kg aromatic binder (0.19 × SBR).
PU Top Coat "ЕДНОПЛАСТОВА РАЗЛИВНА НАСТИЛКА PU Top Coat": same as above but pigment replaced by "Боя PU на два пласта" = area × 1.8 kg @ 5.54 €/kg.
=> These map to SYNCHRO **recipes** (norm per m² per cm thickness) feeding "Материал франко доставчик" and "Доставка" of an offer line.

## Still to read: Multi2CS, Melos EPDM, Corkeen EUR, One DNA, Equipment (2)

## Sheet Multi2CS — read. Recipe calculator "ДВУПЛАСТОВА ОЦВЕТЕНА САМОРАЗЛИВНА НАСТИЛКА 2-4mm" (inputs: area м², thickness см, default 2)
- Ароматен биндер за грунд = area × 0.4 kg @ 2.65
- SBR гранули долен слой = area × (thickness − 1) × 6 kg @ 0.19
- SBR гранули горен слой = area × 6 kg @ 0.19
- Боя = top-layer SBR × 0.025 (same colour price list as Multi1CS)
- Ароматен биндер за SBR, 1 пласт = bottom SBR × 15 % @ 2.65; 2 пласт = top SBR × 20 % @ 2.65
- Delivery: SBR kg/1000 × 77.24; binder kg/214 × 30.9; per m² = total / area. "Крайна цена за материал на м2" = Σ material / area.
- Labour block: norm by thickness (<4 cm 0.400, <5 cm 0.450, ≥5 cm 0.540 man-hours per m²); working days = norm × area / (workers × 8).
- Older labour cost block: Надници = days × workers × 50 + technician × days × 68; Гориво = Σ (distance × 12/100 × 2.3 × trips) per vehicle;
  Нощувки = (days − 1) × (workers + technician) × 20; Командировъчни = days × (workers + technician) × 15; Други (бутил ацетат);
  ОБЩО РАЗХОДИ ЗА ТРУД / Квадратура = Ед.цена на труда за м².

## Still to read: Melos EPDM, Corkeen EUR, One DNA, Equipment (2)

## Sheet Melos EPDM — read. Recipe calculator "САМОРАЗЛИВНА НАСТИЛКА 1-3,5mm" (SBR base + EPDM top; inputs: area м², thickness см)
- Ароматен биндер за грунд = area × 0.4 kg @ 2.65
- SBR гранули = area × (thickness − 1) × 6 kg @ 0.19
- EPDM гранули = Σ per RAL colour (area per colour × норма 10 kg/м²) priced per colour
- Ароматен биндер за SBR = SBR × 15 % @ 2.65
- Ароматен биндер за EPDM = EPDM kg of colours marked "ароматен" × 20 % @ 3.30
- Алифатен биндер за EPDM = EPDM kg of colours marked "алифатен" × 20 % @ 8.60
- Delivery: SBR kg/1000 × 77.24; binder kg/214 × 30.9; EPDM kg/500 × 30.9; per m² = total / area
- Рекапитулация per m²: Материал + Труд + Доставка = Ед.цена
- Binder prices €/kg: primer HASAN 2.65, DOW Chemicals 3.30, MELOS 3.90, HASAN зелен 3.13, HASAN червен 3.13; aliphatic for EPDM: DOW 8.60, MELOS 9.20
- EPDM granule 1-3.5 mm, 25 kg bags, €/kg by RAL (binder recommendation: A = ароматен, L = алифатен, A/L = both):
  3016 Red standard 1.81 A · 6011 Reseda green 2.14 L · 1001 Beige 2.53 A · 1002 Sand yellow 2.64 A · 1006 Earth yellow/охра 2.90 A ·
  1012 Yellow 2.88 A/L · 1013 Pearl 2.66 L · 1015 Eggshell 2.64 L · 2011 Orange outdoor 3.13 A/L · 3017 Rose 2.91 A/L ·
  4003 Heather violet 3.28 L · 4005 Purple 2.78 L · 5002 Hertha blue 2.83 L · 5010 Gentian blue 2.89 L · 5014 Blue grey 2.89 L ·
  5015 Sky blue 2.39 L · 5017 Rainbow blue 2.78 L · 5018 Turquoise 3.02 L · 5019 Capri blue 2.90 L · 5024 Teal 2.78 L ·
  6000 Patina green 2.63 A/L · 6017 May green 2.63 L · 6018 Lime green 3.28 L · 6025 Rainbow green 2.79 A · 6032 Signal green 2.69 A ·
  7011 Iron grey 2.50 L · 7015 Slate grey 2.66 L · 7035 Light grey 2.50 L · 8024 Brown 2.519 A · 9004 Black 2.63 A/L ·
  2004 Orange indoor 3.1889 A · Easy blend red 1.5185 A · Easy blend green 1.5185 A/L · Easy blend blue 1.5185 A/L
- Labour norms (man-hours per m²): SBR by thickness 2 cm 0.200, 3 cm 0.200, 4 cm 0.225, 5 cm 0.270; EPDM 0.8; days = norm × area / (workers × 8), 6 workers.
- Labour cost block as in Multi2CS (fuel = distance × 12/100 × 2.3 × trips).

## Still to read: Corkeen EUR, One DNA, Equipment (2)

## Sheet One DNA — read. Recipe calculator "Изкуствена трева" (inputs: area м², височина на влакното мм, default 40)
- Shockpad = area м² (price from the shockpad table)
- Изкуствена трева = area м² @ price of the chosen grass (example 16.40)
- Бяла изкуствена трева за разчертаване (м²) by area: <400 → 8, <600 → 10, <800 → 12, <1200 → 15, >1200 → 20; same price as the grass
- Подлепяща лента = area × 0.55 m @ 0.78
- Лепило = tape m × 0.33 kg @ 4.80
- SBR 0,8-2,0 = 8 kg/м² × area @ 0.36
- Кварцов пясък kg/м² by pile height: <41 mm → 20, <46 → 22, <51 → 25, <56 → 30, >57 → 40; @ 0.25
- Delivery: SBR kg/1000 × 150; others entered; per m² = total / area. Рекапитулация per m²: Материал + Труд (12) + Доставка = Ед.цена
- Shockpad €/м² (ex Istanbul, 30 kg/m³): 8 mm 3.42 · 10 mm 4.21 · 12 mm 4.99 · 20 mm 8.312
- Grass €/м² (ex Adana): Champion ECO 40 16.40 · ECO 50 = 11.05 × 1.95583 (21.612) · ECO 55 12.712895 · ECO 60 26.60 ·
  Champion PRO 40 11.8327715 · PRO 50 12.908478 · PRO 55 13.3974355 · PRO 60 13.886393 ·
  Duograss ECO 40 11.343814 · 50 12.2239375 · 55 12.712895 · 60 25.00 · Duograss PRO 40 12.126146 · 50 13.2018525 · 55 13.7886015 · 60 14.277559 ·
  Powerspine ECO 40 13.886393 · 50 14.668725 · 55 15.255474 · 60 15.9400145 · Powerspine PRO 40 14.081976 · 50 15.3532655 · 55 16.037806 · 60 FIFA 2* 17.406887 ·
  Legend C ECO 40 13.7886015 · 50 15.059891 · 55 15.64664 · 60 16.3311805 · ELEGANCE LNDSC 30 mm 12.712895 · ROYAL LNDSC 30 mm 14.864308 · ROYAL LNDSC 35 mm 16.037806 ·
  PRESTIGE LNDSC 35 mm 18.384802 · Champ. Tennis 15 mm 11.539397 · Champ. Tennis&Multisport ECO 20 mm 12.712895 · Champ. Tennis&Multisport 25 mm 13.104061 ·
  Champ. Tennis ITF Cert. 20 mm 13.299644 · Champ. ULTRA Tennis 15 mm 18.384802 · Duo Tennis&Multisport 20 mm 10.757065 · 22 mm 12.8106865
  (fibrillated: Champion, Duograss, tennis lines; monofilament: Powerspine, Legend, LNDSC)
- Labour norm 0.35 man-hours/м²; cost block as in Multi2CS.

## Still to read: Corkeen EUR (largest, 20 KB dump), Equipment (2) (expected to be a copy of Equipment)

## Sheet Corkeen EUR — rows 1-69 read (rows 70-137 NOT yet read). Recipe calculator for cork surfacing, six thickness variants.
Header note: "доставка 8 - 10 лв. м2". Input per variant: квадратура обект м² (variant I example 400).
Material prices €/kg: Acetone (solvent for primer) 1.83 · Corkeen binder 4.17 · Corkeen Base Layer granules 6.08 · Top Layer Engineered Cork Granules 15.74.
Norms kg/м² — same in every variant: Solvent for primer 0.10 · Binder for primer 0.20 · Top layer granules 2.22 · Binder for top layer 2.00.
Variant-specific norms kg/м² (Base Layer granules / Binder for base layer / total binder per m² as shown in the order block):
- I.   40 mm:  1.96 / 0.88 / 3.08
- II.  50 mm:  2.68 / 1.21 / 3.41
- III. 70 mm:  4.20 / 1.89 / 4.09
- IV.  90 mm:  5.70 / 2.56 / 4.76
- V.   110 mm: 7.17 / 3.23 / 5.43
- VI.  135 mm: 8.91 / 4.01 / 6.21
Cost per m² = Σ norm × price; material kg = norm × area; cost = cost per m² × area.
Order / packaging block per variant:
- Base layer: packed "LBB 2,5 m²" = 240 kg per package, 1 package per pallet → pallets = kg/240
- Top layer: paper bags 5.5 kg, 70 bags per pallet (385 kg per pallet) → pallets = kg/5.5/70
- Binder: barrels 220 kg, 4 per pallet (880 kg per pallet) → pallets = kg/220/4
- "за поръчка" = ROUNDUP(pallets) per material; остатък (surplus kg) = (ordered pallets − needed pallets) × kg per pallet;
  surplus "за м2" = surplus kg / norm; стойност остатък = surplus kg × price; стойност поръчка = material cost + surplus value
- Transport: 282.18 € per pallet; "цена за транспорт на м²" = Σ pallets × 282.18 / area; "цена за транспорт на поръчката" = Σ ordered pallets × 282.18
- ТОТАЛ = Σ стойност поръчка + transport of the order.
=> procurement must round up to whole pallets/packages and show the surplus; this is where warehouse "return / transfer of surplus" starts.

## Sheet Corkeen EUR — rows 70-137 read (sheet now fully read)
Two more variants, same layout, packaging and transport rules as variants I-VI (no base layer in either):
- "Коркова настила с дебелина 25 мм SPORT FIELD": solvent 0.10, binder for primer 0.20, top layer granules 3.70, binder for top layer 3.34 kg/м²
  (binder total shown in the order block 3.54)
- "Коркова настила с дебелина 15 мм": solvent 0.10, binder for primer 0.20, top layer granules 2.22, binder for top layer 2.00 kg/м² (binder total 2.00 as typed)
Rows 100-136: a day-by-day production plan (weekday → m² laid that day → layer 1 or 2), starting "понеделник моб.", ending "петък демобилизация",
total "35 дни". Daily outputs range 30-100 м². This is the linear schedule worked out by hand per layer.
=> the schedule should allow a per-day planned quantity and layer per activity, with mobilisation and demobilisation as first and last items.

## Reading status
All sheets read except **Equipment (2)** (same size and formula count as Equipment: 224 vs 223 cells, 134 formulas; not compared cell by cell).
Images: openpyxl reported 0 images on every sheet, but the file is 11 MB and every offer sheet has an "Изображение" column,
so pictures are probably embedded in a way openpyxl does not load. NOT verified: check `xl/media` inside the xlsx before deciding how line images work.

## Inside the xlsx (verified by listing the zip)
- `xl/media`: **75 image files, 11.05 MB** (largest ~0.5-0.6 MB PNGs) — so the sheets DO carry pictures (logo/header and line images); openpyxl just did not load them.
- `xl/drawings`: 53 files (image anchors per sheet) · `xl/comments1..13.xml`: cell comments on 13 sheets (comments3 is the largest, 8.7 KB) · `xl/externalLinks`: 2 (the `[1]Труд!` references in Padel point to another workbook).
- NOT yet done: extract the images and see which ones are the company header/logo vs product pictures; read the cell comments.

## Cell comments — read (the authors' own instructions; these are business rules)
- **Offer number** (A3 on every offer sheet): "след символа № поставяме пореден номер на оферта и символ на името на съставителя:
  G - Георги Бургас, S - Георги София, P - Георги Варна, T - Теодора … и т.н." → number = running number + the preparer's letter (example on Padel: "№39G").
  => each user who prepares offers needs an **offer letter/suffix** (and office: Бургас / София / Варна); offer code = sequence + that letter.
- Date (C3): "датата се актуализира сама" → offer date = today at creation/issue.
- Validity (C4 / I4): "Тук пишем колко месеца ще е валидна офертата, датите се актуализират АВТОМАТИЧНО" → valid until = date + N months, N typed by the user.
- Труд sheet, C4:C17 (Брой работници / мярка rows): "Попълва се ръчно в зависимост от производителността за брой или квадратура".
- Труд G15: "Коефициента се нанася в раздела на настилките в графа надници, съотнесен е за м²"; G16: same for плочи
  → the man-days-per-m² coefficient from the labour calculator is what goes into the line's "Надници" column.
- Труд D26 (нощувки): "Попълва се ръчно в зависимост от общата продължителност за обекта по седмици /1 седмица - 4 нощувки/".
- Recipe sheets E12 (SBR): "Заложена разходна норма на 1 м² е 6 кг. Може да се увеличи на 7 кг/м² при работа с машина." (author Лина)
- Recipe sheets G19/G21 (Боя): "Моля въведете килограмите на оксидната боя срещу желания цвят."

Extracted for inspection: `synchro-data/template/media/` (75 images as `xl__media__imageN.*`, drawings, sheet rels, comments). Images NOT yet viewed.

## Image inventory (68 PNG + 7 JPEG in `synchro-data/template/media/xl__media__imageN.*`) — sizes measured, contents NOT yet viewed
- Wide banners (likely letterhead/header or footer strips): image4 2126x294 · image14 1527x168 · image40 3702x526 · image24 1489x297 · image25 1396x293 ·
  image26 1476x286 · image27 1478x289 · image75 546x91 · image35 704x194
- Small marks (likely logos): image1 261x45 · image5 280x61 · image11 225x85 · image23 265x91 · image44 131x50 · image33 250x158 · image2 201x169
- Large pictures ~1360x650 (likely product/system pictures or screenshots): image10, image15-21, image36-38; medium: image6-9 (~915x440)
- Thumbnails ~235x120: image45-74 (30 files — likely the EPDM colour swatches of the Melos EPDM sheet, which has 34 colour rows) · image28-30 ~260x190 · image41-43 ~110x110
- Others: image3 95x175 · image12 339x282 · image13 180x357 · image22 343x232 · image31 327x218 · image32 269x203 · image34 292x150 · image39 344x135
Which image belongs to which sheet/cell is in `xl__drawings__drawingN.xml` + `xl__worksheets___rels__sheetN.xml.rels` (NOT yet mapped).

## Image → sheet/cell mapping (read from the drawing XML; image numbers refer to `xl__media__imageN`)
- **image1 (261x45) sits at A1 on every offer sheet** (Equipment, Equipment (2), Play, Sport, Padel, SBR Tiles, КСС, GreenSet, Grass) → the company logo in the offer header.
- Equipment / Equipment (2): D18 → image3 (picture in the "Изображение" column of the sign/табела line).
- Play: D10, D19, D28, D37 → image5 (section header mark for the MultiPLAY systems) · D46 → image10 · E54 → image11 · D55 → image13.
- Sport: D10, D18, D26, D34, D42, D57 → image5 (same mark on every InfraSPORT section) · D50 → image21 (Retop).
- Padel: D10 → image25 · D21, D32, D43 → image23 · D11 → image28 · D22 → image30 · D33 → image22 · D44 → image29 (court variant pictures in "Изображение").
- SBR Tiles: D10 → image32 · D19 → image31 (tile pictures).
- GreenSet: D10, D20 → image35 (system mark) · D11 → image34 · D12, D22 → image33 · D21 → image38 · F10 → image36 · F20 → image37.
- Grass: D10 → image39.
- Melos EPDM: A21:A54 → image41-74 (one colour swatch per EPDM colour row) · A51-A54 → image44, 41, 42, 43.
- Corkeen EUR: V2 → image75.
- КСС: logo only. Sheets without drawings: Труд, Материали, Multi1CS, Multi2CS, PU Top Coat, One DNA.
- Images not referenced by any anchor found: 2, 4, 6-9, 12, 14-20, 24, 26, 27, 40 (may be leftovers or header/footer pictures; NOT checked).
=> offer lines and sections need an optional **image**; the printed offer needs the company logo at top-left.

## Images viewed so far (3 of 75)
- **image1** (A1 of every offer sheet): black wordmark "infraconcept" → the company logo for the offer header. Copy kept at `synchro-data/template/logo_image1.png`.
- **image5** (section rows of Play and Sport): the "melos" logo (supplier mark shown next to the MultiPLAY / InfraSPORT system descriptions).
- **image4** (2126x294, not anchored to a cell in the drawings I parsed — probably the page footer): a footer strip with
  - partner/brand logos: KOMPAN, Proludic, Vinci Play, stilum, Corkeen by Amorim, melos, Innoflex, 3D PROGRAM, FULCO SYSTEM, greenset, ONE·DNA, HBH, STREET UNIT, playNETIC, SAVVO Bike/system
  - the "IC infra concept" round logo and a QR code
  - company details as printed: **ИНФРА КОНЦЕПТ ЕООД · гр. Бургас; кв. Зорница, к-с Перла /партер/ офис 1 · тел.: +359 (0) 894 44 54 90; +359 (0) 894 44 54 92 · e-mail: office@infraconcept.bg**
  - "certified by TÜV NORD"
  => the printed offer gets this strip as its footer. The company name/address/phones/e-mail come from this image, read by eye; they are the user's own letterhead,
     to be confirmed with the user before they are put into Settings as company data.
- Not yet viewed: the other 72 images (product pictures, colour swatches, remaining banners image14 / 24-27 / 40 / 75).

## Implementation status (kept current)
DONE and tested (6 tests pass: `test/pricing.test.mjs`, `test/offer_template.test.mjs`, `test/phase1.test.mjs`; expected figures worked out by hand from the Excel formulas):
- `server/pricing.js`: `priceLine`, `summarize`, `validUntil` (date + N months, like EDATE).
- Schema (`server/db.js`): `offer_versions` + attention_to, offer_date, validity_months; `offer_lines` + section_id, material_cost, delivery_cost, labour_days,
  day_rate, install_cost, overhead_pct, profit_pct, tax_pct, manual_price, image_document_id; `offer_sections` (title, description, footer, alternative, selected);
  `offer_templates` (empty); `users` + offer_letter, office.
- API (`server/routes_offers.js`): `PUT /api/offers/:id` saves header fields, sections and lines with the cost breakdown; unit_price / unit_cost are computed
  on the server with `priceLine`; a line without a breakdown keeps its typed price as manual_price. `GET` returns sections, per-line `calc`, totals per section,
  `valid_until`, and the owner (name, phone, offer_letter, office). Revisions copy sections, header and every line column.
- Alternatives: `POST /api/offers/:id/confirm { sections: [ids] }` — required when the offer has alternative sections; only the chosen variant's lines
  go into the Project Card / contract (КС) and into the approved offer value (`COUNTED_LINES` in `server/domain.js`, `finance()` in `server/calc.js`).
- Settings read by pricing defaults: `overhead_pct`, `profit_pct`, `corporate_tax_pct` (fall back to 3.5 / 30 / 10; NOT yet added to bootstrap or the Settings screen).
NOT done yet:
- Offer number rule (running number + preparer's letter); offer_letter/office are in the schema but not in the user API or Settings.
- Seeding `offer_templates` with the systems from the Excel and an endpoint to insert a template into an offer; catalogue prices/recipes from the calculators.
- Labour calculator (Труд), recipe calculators (SBR/EPDM/Corkeen/grass with pallet rounding).
- Printable offer (logo, pictures, clauses, footer strip) and Excel export. Line/section image upload (documents API does not exist yet).
- Offers UI: `web/src/pages/Offers.tsx` does not exist yet (also missing: Contracts, Projects, ProjectCard, Admin, Dashboard pages — `web/src/main.tsx` imports them, so the web build fails until they exist).