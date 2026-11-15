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