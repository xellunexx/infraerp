# Changelog

## 2026-11-26 — Batch 1 of the 45-point review (audit: docs/AUDIT-SLACK-2026-11-26.md)
- **Dashboard (1, 2, 3):** the four KPI cards are gone. „В изпълнение", „Предстоящи" and „В договаряне" show their count and open the full list (`/projects?stage=…`). The projects list has stage tabs. One `stageOf` rule serves both.
- **Project card:**
  - 13: contract versions are a small „История" list on the appendices card.
  - 15: „Срок на договора".
  - 22: no unit price or value in КС.
  - 44: the contract value card is for Accounting, Logistics and Management only.
  - The КС picture read the document id as a version id; it now shows the latest version.
- **27 One КС line picker (`LineSelect`):** the list shows code, description and quantities. The chosen line is shown in full (done/left, instruction, picture). Used for progress, new activity and supplier orders.
- **Brigadier instructions** were always empty; the schedule now reads lines through `calc.projectLines` (instruction and done quantity, no prices).
- **Project card links** open `/technical/<project>`.
- **41 Timeline and audit** read as sentences in Bulgarian, with a „Поле: старо → ново" list (`server/human.js`, one place for all names).
- **40 Files for the brigadier:** checkboxes and „Изпрати на бригадира" in the project's files (office only, audited). The brigadier is notified and the link opens the new „Документи" tab, where all files are listed with the office's first.
- Answers recorded: 12 is waiting; delivery items may be free text; out-of-contract work up to 500 € is approved two-factor by Offers/Contracts, above that by the Manager; the brigadier sees everything; anyone may set urgency; batch order 1 → 2 → 4 → 3 → 6 → 5 → 7.
- Tests: `stages`, `contract_value_card`, `schedule_lines`, `human`, `brigade_docs`. Full suite 144/144.

## 2026-11-26 — Review fixes, by cause (to-do points 16, 9, 6, 36+35, 18, 8)
- **16 Notifications open the record itself.** `server/links.js` is one map of where each kind of record lives (payment request → Счетоводство / Заявки за плащане, proforma, order, accommodation, document, contract, message). It is applied when notifications and the management queue are read, so old notifications open the right place too. Accounting and the project card follow `?tab=` even when already open; `Table focus` marks the row.
- **9 A file uploaded again is never a second document.** Identical bytes in the same place (project + contract/appendix link) are refused with the title and version they already have. A changed file with the same name becomes the next version. The version route refuses bytes the document already has.
- **6 Payment notes show on their milestone.** `payment_notes` is read from the milestone's own ledger rows (nothing copied). The milestone note field grows with its text.
- **36 + 35 A delivery looks the same everywhere.** One column set (`deliveryCols`) is used in Logistics and in the project card: kind, pallets, vehicle, note, courier office, access. Each item is on its own line.
- **18 Addresses are searched in Bulgaria only**, from the full text down to the settlement. „гр.Бургас ж-к Славейков до бл.51" is now found; short or mistyped addresses are no longer placed in France or Russia.
- **8 Old mangled file names:** `tools/repair_filenames.mjs` (dry run by default, `--apply` writes an audit row per name). It was run once on the VM.
- Not changed: projects 2 and 4 keep the foreign coordinates found earlier from the addresses „12" and „гг". Correct the address and clear the coordinates to search again.
- Tests: `notification_links`, `doc_versions`, `milestone_note`, `geocode`, `repair_filenames`, plus extended `logistics`. Full suite 138/138.

## 2026-11-26 — Offer files from the company template (part B, tasks 1–2)
- `tools/build_offer_template.mjs` trims the company workbook to `server/assets/offer_template.xlsx` (sheets КСС + Труд, logo, page footer). It drops the other sheets, comments, external links, printer settings and calcChain. Template errors are fixed by class: one-row totals (U22) take the row's common range; error cells become `IFERROR(…,0)` (Труд G15:G17, F31). The style map `offer_template.map.json` is read from the template cells.
- `server/offer_xlsx.js` `offerXlsx(db, id, version, {internal})` fills the template: header fields, a section title row, line rows (B:D description), section totals and grand totals with the discount line. Alternatives are marked „не се сумира". Clauses follow. Every formula carries the app's value. Pictures are converted from webp to png, each stored once. The customer file has columns A–H only and no Труд sheet.
- **Not wired yet:** the download button still uses the old ExcelJS export. Tasks 3–6 remain: the internal Труд sheet, the routes and buttons, the replica tab, and the proof renders.
- Open question for the operator: in the Труд sheet, row 13, man-days E and work days G sum rows 6–12 only, leaving out mobilisation and demobilisation. This was left unchanged.
- Tests: `offer_template_file`, `offer_xlsx`; full suite 130/130.

## 2026-11-26 — Счетоводството смята като „Таблица ексел“

- Болестта: системата смяташе всеки платен изходящ ред за разход, затова превод без фактура
  удвояваше разхода (Нестум: 47 248,56 вместо 42 248,58), складовите разписки ставаха дългове,
  горивото през ЕВРОВАГ намаляваше баланса на човека (Хюсеин: −1 044,67 вместо 118,80), а
  фактурите към клиенти не се броеха като вземане.
- Сега всеки ред има една роля (`server/roles.js`): разход, плащане, приход, аванс, връщане, склад.
  Разходът е документът; преводът само го плаща. Неразпределените преводи и старите редове без вид
  са в „Счетоводство → Неразпределени“. Поръчка с плащане без фактура показва „чака фактура“.
- Нов блок „Резултат по обекта“ ред по ред като в таблицата; непреки разходи = надници × 150 €
  (настройка `indirect_per_manday`). Връщане от подотчетен = вид „Подотчетен: аванс / връщане“, приход.
- Независим преглед (12 находки): поправени са причините, не отделни случаи — ред се брои само ако е
  платен; документ с плащания се брои чрез плащанията си (не и сам); видът и посоката трябва да си
  съответстват; авансът към човек не е разход на обекта; складът не е нито дълг, нито пари; частична
  фактура оставя остатъка от проформата; трудът е без ДДС и в резултата. Тест: `test/review_accounting.test.mjs`.
- Доказателство: `test/excel_parity.test.mjs` с реалните редове (имената са заменени с кодове)
  дава 14 548,82 / 10 887,29 / 118,80 — до стотинка. Два реални реда за труд нямат дни и се показват.

## 2026-11-26 — Счетоводство може да поправи подписан разплащателен график

- След подпис планът се коригира само от Счетоводство, но маршрутът искаше и право Договори:запис —
  никой освен администратор не можеше. Сега финанси:запис е достатъчно. Тест в `test/payments.test.mjs`.

## 2026-11-25 — ДДС в плащанията към доставчици

- Плащането към доставчик носи ДДС % (задължително; 0 = без ДДС), подсказано от последното
  плащане по поръчката; Счетоводство може да го поправи при потвърждение. Разходът е без ДДС.
  Поправена сума запазва процента. Тест в `test/payments.test.mjs`.

## 2026-11-25 — Едно плащане — един запис

- Болестта: графикът по договора, проформата и книгата пазеха по свое „платено“ и се
  разминаваха; платена фактура се броеше два пъти; проформа влизаше в книгата без ДДС
  и с днешна дата; анулирано плащане оставяше етапа платен.
- Сега всичко „платено“ се чете от книгата (`server/payments.js`): етапи, проформи,
  срокове, финанси, поръчки към доставчици. Сумите в книгата са с ДДС; разходи и
  резултат — без ДДС; надписите го казват.
- Договори и Логистика докладват плащане, Счетоводство го потвърждава, отхвърля или
  обединява (`routes_payments.js`, таб „За потвърждение“). Докладваното не мести суми и срокове.
- Аванс %: изрично число 0–100 при изпращане; едно и също в Приложение 3 и графика.
- Не се заобикаля: документ под платеното, проформа с плащане, подписани количества и цени
  през заявка за промяна — отказват се.
- Стари дати без плащане се показват за решение; плащане не се измисля. Само нови колони.
- Независим преглед: старите входове (редакция, заявка за промяна, обединяване, план) заобикаляха
  правилата. Сега `server/ledger_rules.js` проверява крайното състояние след всеки запис.
  След подпис % и сума по етап се коригират само от Счетоводство; графикът трябва да е равен на договора.
- Тестове: `test/payments.test.mjs`; старите проверки са преминали на суми с ДДС.
- Дизайн и план: `docs/superpowers/`.

## 2026-11-25 — Вход, сесии, известия, файлове, съобщения, дневни архиви

- Вход: `cf-connecting-ip` се вярва само от локалния тунел; нов лимит 20 грешки
  на потребител за 15 мин от всички адреси (смяната на адрес не го заобикаля).
- Смяна на парола прекратява останалите сесии на потребителя. Преди вход
  `/api/auth/state` връща само името на фирмата.
- Известия: `brigadir` → `brigadier` в логистиката; `notify()` отказва непознат
  отдел, вместо тихо да не стигне до никого. Известието за проблем носи заглавието.
- Файлове: кирилски имена при качване и сваляне; над 25 MB → 413 с обяснение.
- Съобщения: показват се най-новите 300, „По-стари съобщения“ зарежда назад.
- Архив: `server/backup.js` — проверено копие на базата веднъж на ден, пазят се
  последните 14 автоматични. Файловете и копие извън машината НЕ са включени.
- Тестове: `test/hardening.test.mjs`.

## 2026-11-25 — Табът „Договор" не се отваряше; изтичане на чужди обекти и суми

- Болестта (бял екран): `useState` стоеше след ранен `return` в `ContractTab` →
  React #310 и празна страница. Куката е преместена; `test/hooks.test.mjs`
  проверява синтактичното дърво на всички страници за същия клас грешка;
  `ErrorBoundary` около страницата пази менюто при бъдеща грешка.
- Болестта (видимост): всеки маршрут сам решаваше обхвата по обект. Сега
  `scopeRows` / `needProject` / `hideForeignProject` (core.js) важат за поръчки,
  склад, заявки за материали, заявки за промяна, задачи, договори, етапи и
  финансовите списъци. Бригадир не вижда и не пипа чужд обект, дори с
  разширени права по модул.
- Болестта (пари): `redactMoney` скрива сумите по име на поле, и вътре в JSON
  (хронология, одит, детайл на заявка) за роли без финанси и без договори.
  Сумите по поръчки: финанси + роли със запис в Логистика (решение на оператора).
  Изгледът на договора за Техник остава без промяна (решение на оператора).
- Тестове: `test/scope.test.mjs`, `test/hooks.test.mjs`.

## 2026-11-25 — Подпис събира монтажния прозорец; договорът не се трие; „върнат" етап

- Болестта (подписане): `signContract` изисква `install_start`/`install_deadline`,
  но те са книжни полета, заключени след чернова → одобрен договор без дати
  никога не можеше да се подпише (мъртъв край). Сега подписът приема прозореца
  в тялото — актът на подписване записва уговорените дати атомарно със статуса;
  UI ползва модал с трите дати вместо гол prompt.
- Болестта (изтриване на договор): `contract` нямаше tombstone, а приложенията
  съществуват от чернова v0 → всяка заявка за изтриване гърмеше на FK и висеше
  „Чака" със сурова driver-грешка. Сега `noDelete` в ENT регистъра отказва
  заявката при подаване (и пази `applyDelete`) с пътя към реалните ленти:
  анекс за промени, архив за обекта.
- Болестта (архивиран обект изглежда жив): tombstone-ът работеше (изчезва от
  списъка), но `canSeeProject` е само brigadier-scope → директен URL сервираше
  обекта напълно жив като SIGNED. Сега картата носи „архивиран" банер за всички
  гледащи (остава достъпен за админ-restore).
- Болестта („Върни" невидим + без „върнат"): `setStage` пазеше стария `done_at`/
  `done_by` при обратен ход — върнатият етап изглеждаше като завършен (reopen
  лентата ги чистеше — несъстоятелност). Освен това `contract_*` етапите са
  огледала на домейн факти — ръчното им флипване десинхронизираше списъка от
  подписания факт. Сега `setStage` чисти клепалото при не-done преходи + нова
  `reverted` колона маркира върнатите; `contract_generation`/`contract_approval`/
  `project_card` отказват ръчни флипове (реалните преходи идват от домейна;
  no-op `done→done` остава безопасен).

## 2026-11-24 — Графикът на договора: срокове в дни се въвеждат и след подпис

- Болестта: `prod_delivery_days`/`install_days` са договорени след подпис
  („уточнен с доставчик/оферант"), но PATCH-гейтът пускаше само чернови, а
  полетата в UI бяха `disabled={!draft}` → при липсващи дни `delivery_due`
  падаше на преддоговорната `delivery_deadline` и „прогнозата" заемаше
  позиция преди реалния аванс.
- Сега: PATCH приема само `prod_delivery_days`/`install_days` при
  не-чернова; всяко друго поле → 400. `delivery_due = null` когато дните
  липсват при платен аванс (типизираната дата вече не се възкресява), а
  клиентът не прави локален fallback. Двете полета са редактируеми при
  contracts:write, „Запис" се показва при промяна, таймлайнът подскача
  „въведете срок" вместо да рисува измислена дата.
- `routes_projects.js`, `ProjectCard.tsx`; тест
  `lifecycle.test.mjs` → 7/7; пълен пакет 71/71; tsc + build чисти.

## 2026-11-24 — Достъп по модули още при създаване на потребител

- Болестта: секцията „Достъп по модули" се рендираше само `uid &&` —
  при нов потребител се виждаше само падащото меню за роля и ограниченията
  изискваха втори запис.
- Сега `/permissions` се зарежда предварително, секцията е видима още при
  създаване (база = наследява ролята), а „Създай и продължи" прави
  `POST /users` → `PUT /users/:id/overrides` в един поток (PUT е
  replace-all → идемпотентно). `Admin.tsx` — tsc + build чисти;
  деплоито на VM (488f826→1d439d3), тунелът сервира новия bundle.

## 2026-11-24 — Работна поръчка (11 точки): бъгове + документни версии + логистична повърхност + достъпи

Цяла поръчка от оператора: два реални бъга, версии на документи за
договори/приложения, логистика върху споделените записи, себестойност в
списъка, мулти-модулен достъп и отчет по документите „Тъмния".

**Бъг — архивиран обект излиза в „Обекти"** (`routes_projects.js`,
`Projects.tsx`, `lifecycle.test.mjs`)
- Болестта: `GET /api/projects` беше единственото четене, което не филтрираше
  `archived` — талбастоунът (архив = санкционираното изтриване, FK-ите не
  каскадират) се показваше със значка „Закрит" в списъка.
- Фикс на гейта: списъкът по подразбиране крие архивираните;
  `?archived=1` ги показва нарочно. Бутон „Архив" в Projects.tsx.

**Бъг — линейният график е „объркан"** (`domain.js`/`contractView`,
`ProjectCard.tsx` ContractTimeline, `lifecycle.test.mjs`)
- Болестта: точката „Доставка до" четеше статичната въведена
  `delivery_deadline`, докато сегментът се котвя на реалния
  `advance_paid_at` — при закъснял аванс доставката падаше *преди* аванса.
- Фикс: `contractView` дерива `delivery_due` (реален = аванс +
  `prod_delivery_days`; прогноза = днес + дни) — същата канонична точка като
  `final_deadline`. Сегментите показват реални дати; отложен аванс се бележи.

**„revert" проблем — заявка за изтриване гърмя на FK** (`routes_change_requests.js`,
`governance.test.mjs`)
- Болестта: `applyDelete` изпълняваше чист `DELETE` — записи с препратки
  (~28 некаскадни FK за проект) умираха с 400 и заявката висеше вечно.
- Фикс на механизма: ENT типовете с талбастоун (`project`→`archived`,
  `product`/`smr`/`project_line`→`active`) първо опитват физическо
  изтриване; при FK-блокада падат към талбастоуна. Заявката винаги се
  разрешава: чист запис изчезва, обвързан се архивира/деактивира.
- Измерен поток: заявка за изтриване на обект → одобрение → архивиран +
  отпада от „Обекти" (преди: 400 „не може да се изтрие").

**Бригадна страница — тех. карти като хипервръзки** (`routes_brigade.js`,
`Brigade.tsx`, `brigade.test.mjs`)
- `/api/projects/:pid/progress` мапва `offer_lines.image_document_id` →
  `spec_url` (последна версия на документа); колона „Спец." с линк в
  таблицата за изпълнение.

**Документни версии + прикачване към договор** (`routes_brigade.js`,
`ui.tsx`, `Brigade.tsx`, `ProjectCard.tsx`, `brigade.test.mjs`)
- Болестта: `documents` + `document_versions` съществуваха, но само v1 се
  пишеше — нямаше лента за нова версия; `entity_type` не се валидираше.
- `POST /api/documents/:did/versions` — append-only, следваща версия =
  max+1, `current_version` се бута; audit + `document.uploaded` събитие.
- Upload валидира `entity_type`/`entity_id` срещу карта на таблиците
  (`contract`, `project`, `delivery`, `offer_line`, `smr_types`, …) —
  духов-entity → 400.
- `ui.tsx`: споделени `VersionLinks` (линк за сваляне per версия) +
  `NewVersionButton`. Оплетено в PhotosTab и DocsTab (+ `write` prop);
  ContractTab има лента за прикачване към договора (SCAN бланки).

**Логистика — поръчки и количествена сметка** (`routes_accounting.js`,
`routes_technical.js`, `Logistics.tsx`, `ui.tsx`, `logistics.test.mjs`)
- `supplier_orders` (регистърът от Тъмния_2) е споделен запис: `needSO`
  гейта е either-of (finance OR logistics); логистиката чете и обновява
  същите редове — нов таб „Поръчки" с ъпдейт на статус/дати/документ.
- Количествената сметка `/api/projects/:pid/consumption` се отключва за
  логистика (таб „Количествена"); `STATUS` картата в ui.tsx добива
  `in_production`/`delivered`.
- Поправен латентен crash: `useForm` липсваше в импортите на Logistics.

**Себестойност в списъка Обекти** (`routes_projects.js`, `Projects.tsx`,
`lifecycle.test.mjs`)
- `cost_price` влиза в payload-а на списъка; колоната „Стойност" показва
  договор + себестойност **само за финансовите роли** — теренните не
  виждат пари (същия money-gate като картона на обекта).

**Мулти-модулен достъп — UX върху user_overrides** (`Admin.tsx`,
`governance.test.mjs`)
- Механизмът съществуваше (overrides върху role_permissions); формата за
  потребител добива preset падащи менюта per модул (наследи/няма/четене/
  четене+писане/пълен/custom) + жив readout на ефективния достъп от
  `/api/permissions` матрицата.
- Тестът доказва grant-beyond-role: technical потребител с finance read
  override → `GET /api/supplier-orders` 200 (either-of гейт — logistics=0
  не може да е причината).

**Почистване на латентен tsc клас** (`ProjectCard.tsx`, `Technical.tsx`,
`Accounting.tsx`)
- `ContractTimeline`: `.filter()` върху литерала чупеше contextual typing
  (`state`→`string`) — анотиран `Pt[]` преди филтъра.
- `ReturnType<typeof useLoad>` prop типове изтриваха generic-а (`{}`) —
  сега `any`; implicit-any параметър в Accounting. tsc напълно чист.

**Отчет — покритие на „Тъмния_1/2.docx"** (`docs/tumnia-coverage.md`)
- Пълен мапинг на двете спецификации към съществуващи повърхности:
  регистърът на доставни поръчки ≈ 1:1 покрит; картонът на обекта ≈ 1:1;
  отворени: таб „Обекти на клиента", файлов конвертор, Excel експорт на
  доставническия регистър, генерация от бланки.

**Suite: 70/70 зелено; `npm run build` чист; mount-проби 400-vs-404 ОК.**

## 2026-11-23 — Договорен календар + автоматичен разплащателен график при подписване

Contract tab gains a progressing calendar bar, and the sign → proforma → paid →
milestone chain is now wired end-to-end.

**Web — `web/src/pages/ProjectCard.tsx`, `web/src/styles.css`**
- `ContractTimeline`: horizontal stage bar between the contract card and the
  payment schedule. Anchor points Подписан (`signed_on`) → Аванс платен
  (`advance_paid_at`) → Доставка до → Краен срок (`final_deadline`); spans for
  Производство и доставка (`advance_paid_at` + `prod_delivery_days`) and
  Монтаж (`install_start`/`install_deadline`); interim/final payments as dots on
  their `paid_at`; accent fill up to a „днес“ marker, red + badge when the final
  deadline passed with money still owed; hint fallback until ≥2 dates exist.
- New `.ctline/.ctl-*` styles on the shared design tokens.

**Server — `server/domain.js` (`signContract`)**
- Signing seeds the payment schedule: аванс = `advance_pct` (default 50),
  междинно 30, окончателно = remainder, amounts from the active version's
  `total_value`. `ON CONFLICT` fill of NULL columns only — human-entered rows
  are never overwritten.
- Signing auto-issues the advance proforma (`kind='advance'`, amount = the
  milestone, `due_on` = signed + `payment_terms_days`, note „Аванс по подписан
  договор“), once — skipped if an advance proforma already exists.

**Server — `server/routes_accounting.js` (`proforma paid`)**
- Paying a milestone-kind proforma marks `contract_payments[kind].paid_at`
  when cumulative paid proformas of that kind reach the milestone amount
  (or immediately when the milestone has no amount). Emits the same
  `contract.payment_recorded` event as the manual PUT route — so
  `advance_paid_at` fills, `final_deadline` computes, and the calendar bar
  starts. The posted transaction is the issued invoice/receipt.

**Tests — `test/accounting.test.mjs`**
- New test covers the whole chain: seeded 50/30/20 rows, auto PF-0001,
  paid → milestone + `advance_paid_at` + `final_deadline`, second payment
  doesn't move the date, `other`-kind proformas don't touch the schedule.
- Two existing finance tests updated for the auto-issued proforma appearing
  in `invoiced`/`proformas`.

## 2026-11-20 — Agent pipeline tooling: project skills, review bots, MCP wiring, AGENTS.md

- `.devin/skills/` — five project skills encoding the verify/review pipeline as
  invocable bots: `review-pipeline` (orchestrator), `product-engineer-review`,
  `audit-review`, `qa-vectors`, `erp-ops` (run/deploy/probe runbook).
- `AGENTS.md` — project runbook: stack map, commands, conventions, the
  enter-once-sync-everywhere rule, pipeline summary, deploy notes.
- `.devin/config.json` — permission allowlist for the standard pipeline
  commands (tests, build, git, probes).
- `.devin/mcp_config.json` — `project-memory` MCP server pinned to a repo-local
  memory file so project decisions persist in-repo, not in the user profile.
  (GitHub MCP already wired globally; remote is `xellunexx/infraerp`.)

## 2026-11-20 — Warehouse write-path coverage: inter-project transfers, module-origin requests, КС-line traceability, fleet view

Audit found the warehouse schema already had `to_project_id`, `project_line_id`,
`request_id`, `material_requests.origin` — the columns existed but the write
gates never produced them. Three write-path mechanisms completed, no schema
change needed.

**Server — `server/routes_warehouse.js`**
- Project↔project transfer: `POST /api/warehouse/movements` accepts
  `transfer_out` + `to_project_id` and writes the pair (`transfer_out` on the
  source, `transfer_in` on the destination) inside one transaction. `transfer_in`
  is deliberately not a standalone kind — it is minted only by the pair so an
  orphan inbound transfer cannot exist. Same-source/target rejected (400),
  warehouse stock unchanged, `consumption()` shifts `on_site` between projects.
- Manual `issue`/`receipt`/`return`/`adjust` movements now accept an optional
  `project_line_id` (validated to belong to the movement's project), and request
  fulfilment propagates `request_items.project_line_id` into the generated issue
  rows — issued stock is attributable to a КС line end to end.
- Module-origin requests: `POST /api/projects/:pid/material-requests` — Technical
  and Contracts file a material request straight from the project; origin is
  stamped from the caller's department permission, `canSeeProject` enforced, and
  the request lands in the same warehouse queue via a shared `createRequest`
  (one write path, one audit/event shape). Warehouse-origin requests keep
  `origin='manual'` through `POST /api/material-requests`.
- `GET /api/warehouse/fleet` — the warehouse's read-only window onto the same
  `assets` + `asset_allocations` registry Logistics allocates from (one source
  of truth, two windows): live allocation per asset shown as the project.
- Demand assistant now also lists products physically on-site (`issued > 0`)
  that are not in the plan — transferred-in material no longer disappears from
  the project demand view.
- Movements list joins `to_project_id` → `to_project_code` for display.

**UI**
- Warehouse: movement form offers „Пренос към друг обект" with a required
  target-project select (source list excludes the target); movements table shows
  a „Към обект" column; new „Машини и инструменти" tab lists the fleet registry
  with status, plate, location and live project allocation.
- Technical → project → Материали tab: „Заявка към склад" button opens a request
  modal pre-filling each material's deficit (по договор − на обекта); files to
  the new module-origin endpoint — no warehouse rights needed.

**Review-pass hardening (product-engineer + audit findings, same session)**
- `issue`/`return` without a project now rejected (400) — untagged issues were
  silent shrinkage; untagged returns double-counted material (on-hand up,
  on_site unchanged).
- Transfers can no longer exceed the source project's on-site quantity —
  `consumption()` computed at write time; previously `on_site` could go
  negative and inflate `demand.suggest_qty`.
- `request_items.project_line_id` validated to belong to the request's
  project — same gate the manual-movement endpoint already had; a foreign
  line would have been stamped onto the fulfil issue movement.
- Approve now snapshots `to_purchase_qty = max(0, qty − free)` per item —
  the „За покупка" column finally carries data.
- Notifications wired for the whole request lifecycle (were emitted events
  with no handlers — nobody ever heard them): submitted → warehouse dept;
  approved/fulfilled/cancelled → the requester; new `warehouse.transfer`
  event type → logistics + warehouse (someone has to physically move it).
  `warehouse.movement` stays silent — per-movement pings would be noise.
- New module read: `GET /api/projects/:pid/material-requests` — the filing
  modules see their project's requests (`canSeeProject` enforced); the
  Technical request modal subtracts pending submitted/approved quantities
  so the same need isn't filed twice.
- Line traceability rendered: movements table gets a СМР column
  (`project_line_code`), request detail shows per-item line, request queue
  shows origin; movement list labels transfers direction-aware (→/←).
- Timeline labels for `material_request.*` / `warehouse.*` in ProjectCard.

**Tests — `test/warehouse_reports.test.mjs`** (+5, file now 8/8)
- transfer pair: on_site shifts A→B, warehouse stock untouched, same-project
  rejected; line link survives request→approve→fulfil into the issue movement;
  technical-origin request lands in the queue with `origin='technical'`;
  gates: untagged issue/return 400, overdraft transfer 400, foreign line 400;
  approve snapshots to_purchase, module feed + brigadier scoping 403,
  submit→warehouse and fulfil→requester notifications.

## 2026-11-20 — Phase 4 extension: единна книга (shared ledger), supplier orders, contract milestones, dashboard buckets, reopen flow

Implements §14 of `design.md` — the two Тъмния specs plus the analysis of the real
accounting workbook (`Таблица ексел.xlsx`): one shared transaction ledger replaces
hand-copied sheets; person cards, supplier-order production tracking, contract
payment milestones with a computed final deadline, operational dashboard buckets,
and a Management-gated project reopen are built on top.

**Server — `server/routes_accounting.js`**
- `GET /api/ledger` — flat ledger + totals with filters (company, project, cost
  center, person, tx_kind, method, direction, status, date range, documents only).
- Transactions extended: `tx_kind` fixed vocabulary (client, supplier_doc,
  bank_in, bank_out, proforma, labour, fiscal, card, no_doc, store, other — kills
  the workbook's 34 typo variants), `method` bank/cash/card, `company` legal entity
  (ЕВРОВАГ separate), `document_id` settlement→document link, `cost_center_id`,
  `person_id`, `asset_id`, `has_vat` + `vat_amount`, `pko_no`/`rko_no`,
  `labour_worker`/`labour_days`/`labour_rate` (amount = days × rate when amount is
  not typed).
- Document→settlements: `open_amount` = amount − paid linked rows; partial
  payments are multiple settlement rows on one document; a payment row cannot
  become a parent document (400) and direction must match (400); voided rows are
  excluded from every total.
- `accountable_persons` + `GET /api/accountable-persons/:id/card` — given (card
  advances out), spent (non-card out), returned (in), balance = given − spent −
  returned (same formula the workbook's person sheets used).
- `cost_centers` CRUD; `supplier_orders` CRUD returning `supplierOrderView()` —
  ready_date = advance paid + production days, days_left countdown, final_eur,
  expected_delivery (real after final payment, forecast before it via the
  `delivery_forecast` flag), computed status ordered/in_production/in_transit/
  delivered/cancelled.

**Server — `server/routes_projects.js`**
- `PUT /api/projects/:pid/contract/payments` — advance/interim/final milestones
  (pct, amount, real paid_at) in `contract_payments` — the versioned contract
  body stays untouched. `contract_kind`, `prod_delivery_days`, `install_days`
  editable only while the contract is draft; `final_deadline` = advance paid +
  production/delivery + install days — computed, never typed.
- `GET /api/dashboard` — negotiating (no signed contract), upcoming (signed,
  execution not started; `awaiting_advance` flag until the advance milestone is
  paid), executing.
- Reopen: `POST .../reopen-request` (reason mandatory, duplicate pending request
  blocked, approval row) → `POST .../reopen-decide` (`approvals:approve` only).
  Approval resets the target stage to active AND every later stage to pending —
  downstream completions belonged to the closed reality — then re-derives
  `projects.status`. Events `project.reopen_requested` / `reopen_decided` /
  `reopened`; reason and decision live in audit + approvals.decision_note.

**Notifications (`core.js`, `domain.js`)** — `notify()` now stores `ref_type`,
`ref_id`, `author_id`; the list joins project + author names and resolves the
linked entity's live status. Reopen events notify management (request) and the
affected departments + the requester personally (decision).

**Web** — `Accounting.tsx` gains tabs Книга (ledger, filters, totals), Подотчетни
(person cards), Поръчки (supplier orders), Центрове; TransactionForm carries all
new fields. `Dashboard.tsx` shows the three buckets. `Projects.tsx` drops the
Договор column (per spec — details live on the project card). `ProjectCard.tsx`
gains contract kind/days fields (draft only), the Разплащателен график milestone
card with computed final deadline, site-questionnaire fields (GPS, phones,
machinery, electricity, water, waste, pallet office), reopen request/decide
controls, КС image column, timeline labels for the new events. `Admin.tsx`
notification rows show project, author, linked status.

**DB (`db.js`)** — additive only: tables `cost_centers`, `accountable_persons`,
`contract_payments`, `supplier_orders`; 14 new columns on `transactions`, 3 on
`contracts`, 3 on `notifications`. Verified against a copy of the real pre-change
database — all land, existing rows intact.

**Verified:** `npm test` 57/57 (6 new tests in `test/finance_ledger.test.mjs`:
doc→partial settlements, payment-chain + direction rejections, ledger filters,
company/cost-center totals, person card, labour days×rate, supplier-order math,
milestone deadline, dashboard buckets, reopen request→approve→status re-derive);
`npm run build` clean. Live write-path check on a :4801 clone of the real DB:
person card balance −102.42 computed; document 13 555 settled by 6 500 + 7 055 →
open 0; payment→payment link rejected 400; order ready/expected dates and
in_transit status; advance 2026-11-20 + 45 + 20 days → deadline 2027-01-24.
NOT measured: real-browser click-through of the new tabs/forms.

## 2026-11-15 — Offer editor rebuilt as the document (Excel offer template)

The "Оферта" tab of the offer editor is now the offer document itself, modelled on
`Offer Template_+ правно административни допълнения.xlsx` (КСС / Equipment sheets).

**Layout**
- Letterhead: `offer_logo.png` + the Excel header grid inline — На вниманието на,
  Обект, Адрес, Оферта № (code), Дата, yellow "валидност N месец/а" cell driving
  the computed "Валидна до" date, Съставил + телефон, Клиент. Notes/execution
  logic collapsed under the header ("Бележки и логика на изпълнение").
- Every section is a bordered sheet: section title/description/footer editable,
  "вариант" marker, two-tier header splitting customer columns (№, Описание,
  Ед. мярка, Кол-во, Ед. цена, Стойност) from the tinted internal "Калкулация"
  block (Материал, Доставка, Σдост., Надници, Надник, Монт./ед, Σмонтаж, Сума,
  Реж.%, Σреж., Себ-ст, Печ.%, Печ./ед, Σпеч., Дан.%, Дан./ед, Ръчна, →Ед.цена).
- Each Σ column is a live read-only formula cell mirroring `server/pricing.js`
  (material+delivery+labour → direct; ×3.5% overhead; ×30% profit; ×10% tax on
  profit → customer unit price). Manual price shows the calculated value beneath.
- Per-section totals (без ДДС / ДДС 20% / с ДДС) inside the grid footer; grand
  totals at the document end excluding unselected variants, plus cost/margin
  line (finance only) and the four legal clauses from `offer_clauses`.
- Internal columns hidden unless `finance` rights + "Показвай калкулацията" on;
  never rendered into print/export regardless.

**Smart input**
- Description cell searches the СМР catalogue and products while typing.
  Picking a СМР fills description + unit + labour_days (labour_norm_h ÷ 8);
  picking a product fills description + unit + material_cost (unit_cost).
  The catalogue id is stored on the line (smr_type_id / product_id) and shown
  as a СМР/МАТ tag. Free text remains possible.
- "+ От готов шаблон" (existing templates) and the Труд calculator tab kept.

**Spreadsheet behaviour**
- Tab/Shift-Tab and arrow keys walk cells; Enter moves down and appends a row
  past the last row of a grid; Enter in the description goes to the next row
  (Shift+Enter = newline); Enter on an open suggestion list takes the pick.

**Guardrails**
- `lineIssues` flags missing description, zero quantity and no price (neither
  cost breakdown nor manual) — shown as ⚠ in the № cell; "Изпрати на клиента"
  runs a preflight listing the problem rows before sending.

**Files:** `web/src/pages/OfferEditor.tsx` (rewritten, same API/data flow),
`web/src/styles.css` (sheet/grid/doc styles), `web/public/offer_logo.png` (new).
No server/API/schema changes.

**Verified:** `npm run build` ✓; `npm test` 15/15 ✓; live browser check on a
seeded offer — header, both grids, calc toggle (54→0→54 columns), СМР pick
(fill + labour norm), Enter-adds-row (2→3 rows, focus follows), send preflight
(2 problem rows listed, send blocked), save persisted (server totals unchanged).

### Ops — quick tunnel config (same date)

- `web/cloudflared-quick.yml` (new, intentionally empty): isolates
  `cloudflared tunnel --url http://127.0.0.1:4800` from the machine-wide
  `~/.cloudflared/config.yml`, whose named-tunnel ingress catch-all
  (`http_status:404`) was answering every trycloudflare hostname with 404.
  Run: `cloudflared tunnel --config web/cloudflared-quick.yml --url
  http://127.0.0.1:4800 --no-autoupdate`. Verified: public URL 404 → 200,
  `/api/projects` 401 (auth gate intact).

## 2026-11-15 — Phase 2 slice: Техник — linear schedule, daily progress, consumption watch

**Server (`server/routes_technical.js`, new; mounted in `index.js`)**
- `GET /api/technical` workspace: active projects (progress %, open issues, overdue items, next deadline), open tasks for technical/me, open issues for technical — brigadier rows filtered by project assignment.
- Tasks: `POST /api/tasks` (assign to dept/user, `TSK-` code, `task.assigned` → notify assignee), `POST /api/tasks/:id/done|reopen`.
- Schedule: `GET /api/projects/:id/schedule` (items with pct / planned % / late_days / slip_days / behind + install deadline), `POST .../schedule` (custom item, optional КС link + dependency), `PATCH /api/schedule-items/:id` (dates/name/crew/dependency/sort; row_version → 409; `schedule.changed` → brigadier+logistics).
- Progress: `GET/POST /api/projects/:id/progress` (per-line done/qty + history; `uid` dedupe — a field double-tap is a no-op), `POST /api/progress-entries/:id/void` (void, never edit — corrections stay auditable). First entry sets `actual_start` and activates the `execution` stage. `progress.recorded`/`progress.voided` events.
- `GET /api/projects/:id/consumption` — required (contract) vs expected (by recorded progress) vs consumed (warehouse), tolerance from `overconsumption_tolerance_pct`.

**Handlers (`server/domain.js`)**
- `progress.recorded → execution_watch`: over-consumption/unplanned material opens ONE tracked `issue` per product (kind `overconsumption`, high); a worked КС line behind plan/late opens one issue per line (kind `schedule_delay`). Newly opened issues notify technical+management. Recalc needs no handler — all figures are computed on read.
- `progress.voided → notify accounting`; `schedule.changed → notify brigadier+logistics`; `task.assigned → notify assignee`.

**Bug fix (mechanism, not a line):** `init_project_card` scheduled only offer lines with `smr_type_id` — free-text work lines (most real offer lines, incl. all 6 lines of PRJ-2026-001) fell through both gates: no schedule row, no recipe row. Gate rewritten: every КС line that is not a catalogue product gets a schedule item; product lines keep their 1:1 recipe. Live repair for PRJ-2026-001 backfilled 6 items chained 24→29.11 (audit `schedule_item/backfill`).

**Web (`web/src/pages/Technical.tsx`, new; `main.tsx` routes; `styles.css` gantt bars)**
- `/technical` — workspace: KPIs, projects table, tasks (Готово action), open issues.
- `/technical/:id` — tabs: Линеен график (baseline dashed vs current bars, today + deadline markers, late/behind/slip flags, edit/add modals), Дневен прогрес (entry form + per-line bars + voidable history), Материали (planned vs actual, over/unplanned flagged).

**Verified:** `npm test` 21/21 ✓ (6 new Technical tests incl. the gate regression); `npm run build` ✓; live 127.0.0.1:4800 — CTR-0001 signed (install 24.11→19.12.2026), schedule visible, all endpoints serve real data. NOT yet checked in a real browser; no real progress entries recorded (left to the operator).

## 2026-11-15 — Счетоводство (Phase 4 core)

The `/accounting` page is built: portfolio finance overview plus record-keeping
for proformas, income/expenses, payment requests with Management approval, and
worker accommodations. Finance figures were already computed by `calc.finance()`;
this phase adds the write side — until now there was no way to enter them.

**Server — `server/routes_accounting.js` (new, mounted in `index.js`)**
- `GET /api/accounting` — every visible project with `finance()` figures + totals.
- `GET /api/projects/:pid/finance` — the reconciliation block plus the project's
  proformas, transactions, payment requests and accommodations.
- Proformas `GET/POST /api/proformas`, `POST /api/proformas/:id/paid|cancel` —
  issued against a project that has a contract (`PF-####`, amount net of VAT,
  `vat_pct` defaults from settings). "Платена" posts exactly one incoming
  transaction linked by `proforma_id` (idempotent — repeat calls return the same
  receipt, no double-posting); cancelled proformas drop out of `invoiced`.
- Transactions `GET/POST /api/transactions`, `PATCH /api/transactions/:id` —
  manual income/expense, direction in/out, status planned/committed/paid/voided.
  No delete: corrections are audited edits; `voided` is excluded from every
  `finance()` total automatically.
- Payment requests `GET/POST /api/payment-requests`,
  `POST /api/payment-requests/:id/approve|reject` — filed by accounting, each
  creates an `approvals` row; only `approvals.approve` holders decide.
  `exceptional` auto-flags amounts over `exceptional_expense_limit`.
  Approval does **not** post money — the expense is entered manually afterwards
  (operator decision). `payment_request.created` notifies Management,
  `payment_request.decided` notifies Счетоводство.
- Accommodations `GET/POST /api/accommodations`, `PATCH /api/accommodations/:id`.
- All writes hit `audit_log` (before/after) and emit engine events; every endpoint
  is gated by `finance` read/write, decisions by `approvals.approve`.

**Schema** — `row_version` added to `proformas`, `transactions`,
`payment_requests`, `accommodations` (additive `migrateColumns`, live DB
migrated on boot): financial records get the same 409 optimistic-concurrency
guard as the rest of the system.

**Web**
- `web/src/pages/Accounting.tsx` (new): KPI strip (receivables, payables,
  received, result-to-date), per-project finance table with totals, project
  filter, tabs for the four record types with add/edit modals and row actions
  (proforma paid/cancel, request approve/reject for approvers).
- `ProjectCard` gains the missing **Финанси** tab (was in the PLANNED list):
  `finance()` KPIs, reconciliation vs completed work, the project's records
  read-only, link into `/accounting?pid=`.
- Route wired in `main.tsx`.

**Verified:** `test/accounting.test.mjs` — 5 tests (role gates, proforma→paid
single receipt + idempotency + cancel rules, transaction edit/409/void
exclusion, request approve/reject + notifications + no auto money,
accommodations + portfolio bundle). `npm test` 26/26 pass; `npm run build` pass.
Live on :4800 after restart: all five GET endpoints 200 for admin (temp session,
deleted after), public tunnel serves the new bundle, `/accounting` → 200.
Not measured: browser click-through of the new page.

## 2026-11-15 — Логистика (deliveries, assets, allocations)

The `/logistics` page is built: it was a `Soon` placeholder while its tables
(`deliveries`, `delivery_items`, `assets`, `asset_allocations`) sat as dead
schema. Настаняване stays in Счетоводство per operator decision.

**Server — `server/routes_logistics.js` (new, mounted in `index.js`)**
- `GET /api/logistics` — portfolio: per visible project delivery counts by
  status + live allocations, fleet by status, totals.
- `GET /api/projects/:pid/logistics` — one project: deliveries with items,
  allocations, and the project's logistics questionnaire fields.
- Deliveries `GET/POST /api/deliveries`, `PATCH /api/deliveries/:id` — code
  `DLV-####`, kind to_site/return/other, planned date, carrier, courier office,
  pallets, palletized, vehicle (asset), optional material_request link (same
  project enforced), items[] (product+qty, ≥1 required, replaced atomically on
  PATCH). Status flow planned→in_transit→delivered, cancelled from either;
  delivered/cancelled terminal. `row_version` 409 guard on edits.
- Assets `GET/POST /api/assets`, `PATCH /api/assets/:id` — registry (code
  `AST-####`, name, kind, plate, status available/in_use/maintenance/retired,
  location) with current-allocation lookup.
- Allocations `GET/POST /api/asset-allocations`, `PATCH .../:id` — assign asset
  to project for a date range; overlap guard rejects double-booking while
  planned/active (re-checked on PATCH excluding self).
- All gated by `logistics` read/write + per-project visibility (brigadier sees
  only assigned projects). Writes hit `audit_log`; events notify ops:
  `delivery.created`→warehouse+technical+brigadir, `delivery.delivered`→
  brigadir+technical, `delivery.cancelled`→warehouse (warn),
  `asset.allocated`→technical+logistics.

**Schema** — `row_version` added to `asset_allocations` (additive
`migrateColumns`; the only editable logistics table missing it).

**Web** — `web/src/pages/Logistics.tsx` (new): KPI strip, per-project logistics
table, tabs Доставки (status advance/cancel, edit modal with item rows editor)
and Техника (registry + allocations with activate/complete/cancel). Route in
`main.tsx`; `?pid=` deep link supported.

**Verified:** `test/logistics.test.mjs` — 3 tests (role gates incl. brigadier
scope, delivery lifecycle + 409 + items replace + bundle + notification,
asset registry + overlap guard + allocation lifecycle + portfolio). `npm test`
29/29 pass; `npm run build` pass. Live on :4800: all five GET endpoints 200
plus POST /api/assets 200 (temp admin created direct in DB, verified, then
deleted with session + audit row — operator's own `bosshev` admin untouched).
Public tunnel serves new bundle; `/logistics` → 200. Not measured: browser
click-through.

## 2026-11-15 — Бригадир (field interface)

**Server — `server/routes_brigade.js` (new, mounted in `index.js`)**
- `GET /api/brigade` — workspace bundle: projects visible to the user
  (`canSeeProject` — brigadier sees only assigned projects) with progress %,
  open-issue count, today's crew headcount; plus open tasks and issues routed
  to the user / brigadier dept.
- Attendance `GET /api/projects/:pid/attendance?date=`, `POST /api/attendance` —
  daily crew list (worker, hours, team); upsert on (project, work_date, worker)
  so re-posting corrects instead of duplicating. Gated by `progress` write.
- Issues `GET /api/issues?project_id=&status=`, `POST /api/issues`,
  `PATCH /api/issues/:id` — brigadir reports problem/delay/material_shortage/
  damage/additional_work/other with severity, optional product/line link and
  `assigned_dept` (default `technical` — the "request support" path). Status
  open→in_progress→resolved (resolution required)→reopen/cancel, `row_version`
  409 guard. `issue.reported`/`issue.resolved` notify the assigned department.
- Messages `GET/POST /api/projects/:pid/messages` — project comment thread with
  author join, optional entity link, gated by `messages` read/write +
  project visibility.
- Documents `POST /api/projects/:pid/documents` (multer multipart — images/pdf/
  office, 25 MB cap), `GET .../documents`, `GET /api/documents/:vid/file` —
  stored under `synchro-data/files/` with sha256 + mime on the version row.
  Gated by `documents` read/write + project visibility. Download streams the
  file and returns `undefined` — returning the stream made the shared `h()`
  wrapper try to `res.json()` it (500); fixed at the handler boundary.

**Schema** — `row_version` added to `issues` (additive `migrateColumns`).

**Web** — `web/src/pages/Brigade.tsx` (new): `/brigade` project cards
(progress %, open issues, today's crew) + tasks/issues inbox;
`/brigade/:id` field workspace, mobile-first single column, tabs План
(schedule + site logistics notes + line instructions), Прогрес (daily qty
form with uid dedupe, per-line progress, voidable entries), Присъствие
(date + crew upsert list), Проблеми (report form + status workflow),
Снимки (multipart upload + image grid + open/download), Съобщения (thread).
Routes wired in `main.tsx`.

**Verified:** `test/brigade.test.mjs` — 5 tests (scope/gates, attendance
upsert, issue lifecycle + notify, messages, photo upload→list→download
roundtrip). Written failing first (all 404), now 5/5. Full suite **34/34**;
`npm run build` pass. Live on :4800 (restarted onto new code): all 8 brigade
endpoints 200 plus POST /api/attendance and POST /api/issues 200 via temp
admin (probe rows + temp user + sessions + audit fully removed after —
operator's `bosshev` untouched). Public tunnel serves new bundle;
`/brigade` → 200. Not measured: browser click-through.

## 2026-11-15 — Lifecycle status sync (projects.status was a dead-end field)

**Illness:** `projects.status` (the coarse badge: Очаква договор / Подготовка /
Изпълнение / Завършен / Закрит / Спрян) had exactly one writer —
`contract.signed → 'preparation'` — and no transition mechanism. The 22-stage
checklist (`project_stages`) completing never propagated, so finished projects
stayed "Подготовка" forever. `archived` and `on_hold` were equally dead: read
by four modules, written nowhere.

**Fix — derive, don't duplicate:** `deriveProjectStatus()` + `syncProjectStatus()`
in `domain.js`. Status = leading edge of the stage checklist: phase of the
furthest-progressed (active/done) stage — pending earlier stages don't hold it
back (first-unfinished waterfall was tried and rejected: prep paperwork
routinely finishes during early execution). `skipped` counts as finished;
wrap-up stages (`completion` onward) read as `completed`; unsigned contract →
`contract_pending`; all done/skipped → `completed`. `closed`/`on_hold` are
manual states, never auto-derived.

- `setStage()` calls `syncProjectStatus()` — every stage transition (UI,
  contract-sign handler, Technical's auto `execution→active` on first progress
  entry) re-derives atomically in the same transaction.
- Stage `add` endpoint syncs too (new pending stage can regress the frontier).
- Startup sweep in `index.js` heals existing rows once per boot (manual states
  skipped) — project PRJ-2026-001 went `preparation → completed` on restart.
- `PATCH /api/projects/:id` accepts `status:'on_hold'` (pause, sticky) and
  `status:'resume'` (clears hold → re-derive); other values rejected.
- `POST /api/projects/:id/archive {archived}` — archive sets `archived=1` +
  `status='closed'`; unarchive clears the flag and re-derives. Audited.
- ProjectCard header: Пауза/Възобнови + Архивирай/Възстанови buttons
  (`projects` write permission).

**Verified:** `test/lifecycle.test.mjs` — 3 tests written failing first
(status stuck at `preparation`), now green: contract_pending→preparation→
execution→completed derivation, hold stickiness + resume, archive→closed +
unarchive re-derive, skipped-counts + frontier regression. Full suite
**37/37**; `npm run build` pass. Live :4800 restarted: startup sweep flipped
PRJ-2026-001 to `completed` (verified in DB); public `/projects/1` → 200 on
the new bundle. Not measured: browser click-through.

## 2026-11-15 — Управител (management portfolio board)

**Server — `server/routes_management.js` (new, mounted in `index.js`)**
- `GET /api/management` — one bundle for approvals-holding roles (`approvals`
  read = admin/manager only; every other role gets 403):
  - `kpis` — active projects, contract value / receivables / payables /
    result-to-date / forecast (only when `finance` read is held — verified by
    stripping the permission), critical issues, pending approvals, overdue
    tasks, failed events, in-transit deliveries.
  - `attention.approvals` — events with `approval_status='pending'` (the live
    decision queue), `attention.issues` — open high/critical, `attention.tasks`
    — open past due_date, `attention.events` — failed sync events.
  - `projects` — per-project portfolio rows (status, progress %, critical
    issues, finance fields when permitted).
  - `workload` — open tasks/issues/critical per department.

**Illness fixed at the mechanism (same dead-field class as projects.status):**
`events.approval_status` was written `'pending'` at emit time and NEVER
transitioned — decided approvals stayed in the queue forever. New
`resolveApproval()` in `core.js` marks the originating event approved/rejected
inside the same transaction as the decision; wired into contract
approve/return (`routes_projects.js`) and payment-request approve/reject
(`routes_accounting.js`). The management queue is now truthful: it drains on
decision (tested).

**Web — `web/src/pages/Management.tsx` (new)**, route `/management` in
`main.tsx` (was a `Soon` placeholder): KPI strip, four attention cards
(approvals / critical issues / overdue tasks / failed sync) with deep links,
portfolio table with money columns, workload-by-department table.

**Verified:** `test/management.test.mjs` — 3 tests (role gates across all 8
non-management roles, bundle content + queue drains after approve, finance
sections hidden when permission stripped). Full suite **40/40**;
`npm run build` pass. Live :4800 restarted: `/api/management` 200 for temp
manager — real KPIs returned (PRJ-2026-001 completed, PRJ-2026-002
contract_pending, contract_value totals correct); temp user + session removed
after. Public `/management` → 200 on new bundle. Not measured: browser
click-through.

## 2026-11-15 — Бригадир nav fix (module was unreachable)

The Бригадир menu item pointed to `/brigadier` but the module routes are
`/brigade` + `/brigade/:id` — clicking it fell through to the `Soon`
placeholder. NAV `to` corrected to `/brigade`. Frontend-only change;
`npm run build` pass, server restarted, public bundle verified
(`index-iy7Jpe6Y.js`), `/brigade` and `/brigade/1` → 200. Not measured:
browser click-through.

## 2026-11-15 — Project Card: real tabs for built modules

The "Предстоящи раздели" list claimed eight shipped capabilities were unbuilt.
Each now reads the same shared records through a real, permission-gated tab —
nothing is duplicated into a card-specific store.

**Server**
- `GET /api/projects/:pid/tasks` (routes_technical.js) — per-project bundle of
  tasks + issues with assignee/dept names; gated by `tasks` read + project
  visibility. The workspace `/api/technical` tasks view stays global.

**Web — `web/src/pages/ProjectCard.tsx`**
- Six new tabs, each gated by its module permission: **График**
  (`/projects/:id/schedule` — items, %, late/behind flags; `technical`),
  **Изпълнение** (`/progress` — per-line % + daily reports; `progress`),
  **Логистика** (`/logistics` — site logistics notes, deliveries, механизация
  allocations; `logistics`), **Задачи** (`/tasks` — tasks + problems;
  `tasks`), **Документи** (`/documents` — file list + image grid;
  `documents`), **Съобщения** (`/messages` — thread + post box;
  `messages` write for the input).
- Each tab deep-links into its owning module (Технически / Логистика /
  Бригадир) for edits — the card is a window onto shared records, not a
  second editor.
- `PLANNED` trimmed to what is genuinely missing: Технически спецификации,
  Склад. Анекси removed — contract versions/appendices already live in the
  Договор tab.

**Proof** — `test/technical.test.mjs` extended (per-project bundle returns
the created task + issues array; commercial role reads it). Full suite
**40/40**, `npm run build` pass. Live :4800 restarted: all six endpoints
200 on project 1 (schedule/progress/tasks return real rows; logistics/
documents/messages return honest empty arrays). Temp session removed after.
Public `/projects/1` → 200 on new bundle. Not measured: browser click-through.

## 2026-11-15 — Over-contract progress: warn-and-allow

Reporting more than the contracted quantity was silently accepted and the %
column capped at 100, so 154% of a line rendered as a clean "100%".

**Server** — `POST /api/projects/:pid/progress` now returns
`over_contract: { contract_qty, done_qty, excess }` whenever cumulative
non-voided quantity on the line exceeds `project_lines.qty` (epsilon-guarded
for float noise). The entry still saves — extra work is real — including on
the deduped-replay path, which reports current state.

**Web**
- "над договора +N" badge under Извършено wherever done-vs-contract is shown:
  ProjectCard Изпълнение + КС tabs, Technical Дневен прогрес, Brigade Прогрес.
- Both entry forms (Technical, Brigade) toast "Отчетът е записан — над
  договора с N unit" instead of the plain success message when the response
  carries the flag.

**Proof** — assertions added to the daily-progress test (90/100 → no flag;
110/100 → flag with excess 10; deduped replay still reports state): failed
before the change, pass after. Full suite **40/40**, `npm run build` pass.
Live :4800 restarted; `GET /api/projects/4/progress` returns line 38 at
done_qty 1000 vs qty 648 — the badge now surfaces the +352 that was
invisible. Temp session removed after. Not measured: browser click-through
of the badge/toast.

## 2026-11-15 — Каталог с изображения + галерия в офертите

**Goal** — offers should look like the company's Excel template without
copy-pasting photos: a searchable catalogue gallery wired into the offer
editor, with images rendering fitted in the printed/PDF output.

**Schema** — `catalog_items(slug UNIQUE, name, brand, cat, specs JSON,
images JSON, source 'isport'|'excel', active)`; `offer_templates.catalog_slug`
links a template to its catalogue image. Images live in
`DATA_DIR/files` as `cat-*` (no duplication per attach).

**Import** — `tools/import_catalog.mjs` (announced, DB backed up first):
- isport `crawl/catalog.norm.json` + `images.map.json`: 2,581 unique items
  (186 exact-duplicate source rows collapse on slug), 5,037 live image refs
  copied (74 dead links skipped), zero basename collisions verified.
- Excel embedded product images: 62 items (MultiPLAY/Play/Sport/Padel/
  SBR Tiles/GreenSet/Grass/Melos EPDM/Corkeen/Equipment), 51 staged files.
- All 23 offer templates mapped to their Excel system photo (23/23).

**API** (`server/routes_catalog.js`) — `catalog` read for browse (every
role has it): `GET /api/catalog/items?q=&cat=&brand=` (120-row cap,
excel-sourced first), `GET /api/catalog/items/:ref` (id or slug, image URL
list), `GET /api/catalog/items/:ref/img/:idx` (streamed, immutable cache),
`GET /api/catalog/facets`. `POST /api/catalog/items/:ref/attach` requires
`offers` write: materializes a `documents` row (`entity_type='catalog'`,
`project_id NULL`) + version pointing at the same stored file — idempotent
per (item, image); returns `document_id` for `image_document_id`.

**Offers** — `offerView` resolves `image_url` (latest document version)
for sections and lines; PUT already round-trips `image_document_id`.
Print/PDF (`server/print.js`) resolves `image_document_id` → latest version
→ base64 and renders `.pimg` — `object-fit: contain` inside a 26mm×52mm
bordered box floated in the section header / line description cell.
Excel `.xlsx` export intentionally does not embed images (flagged
limitation, not silent).

**Web** — OfferEditor: 🖼 button on every section header and line row opens
`CatalogPicker` (search grid → item detail → click an image → attach →
`image_document_id` set, saved by the normal PUT). Inserting an offer
template auto-attaches its `catalog_slug` image to the new section.
Thumbnails show next to the button once set.

**Proof** — `test/catalog.test.mjs` (2 tests): search/detail/stream/404,
anon 401, accounting read OK + attach 403, attach idempotent by id AND
slug, attached image serves via `/api/documents/:vid/file`, offer PUT
round-trip persists `image_document_id`+`image_url`, print HTML contains
`class="pimg"` + `data:image/png;base64`. Full suite **42/42**,
`npm run build` pass. Live: import run against `synchro-data` (backup
`synchro-pre-catalog-20261115-204911.db`), :4800 restarted — live search
returns excel+isport items, image streams `200 image/webp`, attach →
`document_id` then `reused:true` on repeat, anon 401, public tunnel 200.
Smoke session + probe document row removed (4 real sessions untouched).
Not measured: browser click-through of the picker; xlsx export has no
images by design.

## 2026-11-15 — Template picker: multi-select without auto-close

The "Готови системи" modal no longer closes after each "Добави" — the
operator can insert as many systems as needed; added rows dim to
"Добавено ✓" (disabled, prevents duplicates), a footer counter shows the
count, and "Готово" closes. `tplAdded` resets each time the picker opens.
Frontend-only change; `npm run build` pass, public bundle
`index-CjTEEJ_3.js` verified served. Not measured: browser click-through.

## 2026-11-15 — Offer .xlsx export embeds catalogue images

The earlier "xlsx has no images" limitation is removed: `offerWorkbook`
now embeds section and line images into the "Оферта" sheet. Catalog images
are stored as webp (99% of refs) which Excel cannot render, so each image
is re-encoded to PNG via `sharp` at export time (rotate() normalizes EXIF
orientation), fitted into a bounded box preserving aspect (section ≤350×115px
on the title row's right side; line ≤280×105px right-aligned inside the
description column via fractional-col anchor), `editAs:'oneCell'`, and the
row height grows to fit image-or-text, whichever is taller. Logo anchor
unchanged; "Калкулация" sheet stays image-free (internal).

**Proof** — catalog test extended: export.xlsx round-trips through ExcelJS
and `getImages()` on "Оферта" ≥ 2 (logo + line image). Full suite **42/42**.
Live :4800 restarted; `GET /api/offers/5/export.xlsx` → 200, 1.05 MB, 13
media parts (logo + 12 section photos the operator attached via the picker).
Sample written to `~/Downloads/Oferta_5_v1_images.xlsx` for visual check.
Smoke session removed (4 real sessions untouched). Not measured: opening
the file in Excel itself.

## Excel replica tab in offer editor

- New **"Excel реплика"** tab in OfferEditor renders the offer literally like
  the company's workbook: 23-column grid in source order (№, merged Описание,
  Изображение, Ед.мярка … Ед.цена към клиента), merged section banner rows
  with floated section photo, per-section total rows (без ДДС / ДДС / с ДДС)
  and a grand-total footer.
- Fully editable through the SAME state/handlers as the Оферта tab
  (`setL`/`pickL`/`delL`/`setS`/`addLine`) — replica edits save identically;
  no second pricing model (`calcLine` is the single source).
- Image column per line + 🖼 picker on section banner and line cells reuses
  `CatalogPicker`; internal calc columns gated to `money` exactly like
  SheetGrid; read-only for locked versions.
- Styles: `.xr*` block in styles.css (Excel-like gray grid, sticky header).
- Verified: `npm run build` clean, `npm test` 42/42, :4800 restarted,
  local + public serve `index-DGj_BnEX.js` → 200. Not measured: clicking
  through the tab in a browser.

## Offer picker — full catalogue insert

- The "Готови системи" modal is now "Готови системи и каталог" with two tabs:
  Системи (шаблони, unchanged) and Цял каталог — searchable/faceted browse of
  all ~2,600 active `catalog_items` (thumb grid, cat+brand filters, 120-result
  cap noted in UI).
- Picking a catalogue item attaches its first image (idempotent `attach`,
  image-less items insert without one) and appends a section titled with the
  item name + specs summary, containing one line pre-filled with name/unit
  `бр.` — same shape as template inserts, same PUT save path.
- Multi-select preserved across both tabs: per-source added-sets, footer
  counter sums them, modal stays open until "Готово".
- Verified: `npm run build` clean (`index-D0fQjFel.js`), `npm test` 42/42,
  :4800 restarted, local + public serve new bundle → 200. Not measured:
  clicking through the catalog tab in a browser.

## Repo sync + catalogue data exclusion

- Merged full local tree to `xellunexx/infraerp` main (f433cfa): all modules,
  tests, design docs, cloudflared quick-tunnel config.
- `tools/catalog-import/` (Excel-extracted catalogue staging, ~4.9 MB images
  + items JSON) added to `.gitignore` — catalogue DATA stays local; only the
  importer code (`tools/import_catalog.mjs`) ships.
- `requirements.txt` added for `tools/import_offer_template.py`
  (`openpyxl==3.1.5`, the only Python dep in the repo).

## Deployment to dedicated VM

- Full stack moved to `devops@68.210.226.194` (tenderops-vm): repo snapshot +
  `synchro-data` (DB + 120 MB files incl. catalogue) rsynced to
  `/home/devops/synchro/`; Node upgraded 20 → 22.23.5 (required for
  `node:sqlite`); `npm install --omit=dev` (sharp verified on linux-x64).
- `synchro.service` (systemd, Restart=always, PORT=4800,
  SYNCHRO_DATA=/home/devops/synchro/synchro-data) — enabled, active, 200.
- `synchro-tunnel.service` — cloudflared quick tunnel with an intentionally
  empty `--config` (same guard as isport-tunnel): without it cloudflared
  auto-loads `/etc/cloudflared/config.yml` and the TenderOps named-tunnel
  catch-all answers 404 (measured: first URL returned 404, fixed URL 200).
- Public: https://laboratory-founded-design-louis.trycloudflare.com → 200,
  serving `index-D0fQjFel.js`; `/api/offers` → 401 (auth gate intact).
- Local :4800 server + its quick tunnel stopped — prevents two writable
  SQLite copies diverging; local `synchro-data` untouched as backup.
  Other tunnels/services on the VM (TenderOps named tunnel, isport
  quick tunnel, :8043/:9000/:7100 apps) verified untouched.
- Update (same day, later): governance phase 1 + warehouse/reports phase 2
  deployed — tar sync into `/home/devops/synchro/infraerp/` (the systemd
  WorkingDirectory; an initial sync to the parent dir was reverted),
  `synchro.service` restarted, `https://synchro.tenderops.io` serves
  `index-8XJ_SVtq.js`; `/api/reports`, `/api/warehouse/stock`,
  `/api/material-requests`, `/api/change-requests` all 401-gated.
  isport./eop. verified unaffected.

## Permanent hostnames: isport./synchro.tenderops.io on named tunnel

- Root cause of dead tunnel links found: TWO connectors shared tunnel
  `tenderops` (6676bd08) — the VM (68.210.226.194) AND this PC's Cloudflared
  Windows service (95.42.8.198) with a stale localhost-pointing config.
  Edge load-balanced requests across both → ~50% hit the stale connector's
  catch-all 404. Quick tunnels died separately (ephemeral sessions).
- Fix: added `isport.tenderops.io`→:8043 and `synchro.tenderops.io`→:4800 to
  `/etc/cloudflared/config.yml` ingress (backup kept); `cloudflared tunnel
  login` cert → `route dns` created both CNAMEs (proxied).
- Rogue connector removed at mechanism level: rotated `tunnel_secret` via CF
  API (PATCH cfd_tunnel) + updated VM credentials-file + `tunnel cleanup`
  dropped all connections → PC's stale-secret connector can never re-register.
  VM now sole connector (4 conns, all 68.210.226.194).
- Verified: isport./synchro.tenderops.io → 200 (synchro serves
  index-D0fQjFel.js); eop → 302 (app's own host redirect, tunnel fine);
  tenderops.io + erp.tenderops.io → 200 unaffected. protocol: http2 set
  (QUIC showed recurring Azure NAT stream errors).
- Note: PC's Cloudflared service still runs and retries with dead secret —
  harmless; disable via admin `Stop-Service Cloudflared` when convenient.

## Governance core — change requests, admin-only settings, per-user visibility, reminders (phase 1)

Design: `docs/governance-design.md`. NOT yet deployed to the VM — awaiting
operator's local test pass.

**Universal change requests** (`/change-requests`, `server/routes_change_requests.js`)
- Any user files edit (optional proposed values) or delete requests against 22
  entity types via a registry (customer, product, СМР, inquiry, offer, project,
  КС line, contract, transaction, proforma, payment request, accommodation,
  delivery, asset(+allocation), task, issue, schedule item, lifecycle stage,
  material request, attendance, document). Whitelisted columns only; values
  coerced by column kind; `PRAGMA foreign_keys=ON` makes referenced rows
  undeletable with a clear error.
- Flow: `pending` → admin-only `decide` (approve applies inside the same tx —
  failure rolls back and the request stays pending; reject closes with note).
  Flag-only requests (no payload) close as `applied: 'manual'` — the admin
  fixes the record himself and acknowledges. Every step writes `audit_log`;
  creation pings the management department.
- Bug found by tests: payload was double-JSON-encoded → decide saw index keys;
  fixed before ship.

**Admin-only settings** — `needAdmin()` in core.js now guards `POST/PATCH
/api/users`, `GET/PUT /api/permissions`, `PUT /api/settings`. `/settings` nav
item and route are admin-only (manager previously had read access — removed
per requirement). `GET /api/users` stays readable (picker directory).

**Per-user visibility** (`user_overrides` table) — admin sets per-resource
presets (inherit / none / read / rw / full) in the user form; `userFromToken`
merges overrides per request (immediate effect, no re-login), admins are never
restrictable. UI: "Ограничения по модули" section in UserForm — after creating
a user the modal stays open so limits can be set right away.

**Automatic reminders** (`server/reminders.js`, 60s sweep) — 12 watchdogs:
approval events/rows, open/overdue tasks, overdue lifecycle stages, planned
deliveries, submitted material requests, pending payment requests, overdue
proformas, critical open issues, pending change requests/amendments,
contract-pending projects. >12h pending → `notifications` (warn) to the
responsible dept/user, deduped to once/day/entity via `reminders_log` — the
history the reports engine (phase 2) queries for "was it reminded / attended".

**Verified:** `npm test` 48/48 (6 new governance tests), `npm run build`
clean (`index-CcpdolQn.js`), local :4800 restarted and serving; new endpoints
401-gated without session. Not measured: clicking through the UI in a browser.

## Warehouse + Reports (phase 2)

**Склад** (`/warehouse`, `server/routes_warehouse.js`) — the write side of the
stock pipeline that already existed in schema/calc but had no writer:
- `GET /api/warehouse/stock` — live stock per product from immutable
  `stock_movements` (on_hand / reserved / free / min_stock / low), merged with
  reservation holds. Never a directly-edited total.
- `POST /api/warehouse/movements` — receipt / issue-to-project / return /
  adjust with document ref, responsible user, project context; writes
  `stock_movements` + audit + event. `warehouse` write perm required.
- `GET/POST /api/warehouse/movements`, `/reservations` — history and live
  holds (active/reserved/fulfilled/cancelled).
- `GET /api/warehouse/demand?project_id=` — per-product need computed from
  project lines × recipes minus issued/reserved, vs free stock; suggests
  request qty. This is the "suggested quantities" of the design.
- Material requests (`/api/material-requests`, existing table now writable):
  submit → approve (auto-creates `reservations`, computes `to_purchase_qty`
  for the uncovered remainder) → fulfil (issues stock per item, links
  movement to project, releases reservations) / cancel. Status guards
  (409/400 on illegal transitions), requester + warehouse notifications.

**Справки** (`/reports`, `server/routes_reports.js`) — curated catalog +
reusable engine (`{params → run(db) → cols/rows/sections}`), not a query
builder. `reports` perm gates catalog + every run; finance columns require
`finance` perm. Every report returns tabular rows + optional secondary
sections; CSV export is client-side.
- `dwell` — the pending-step analyzer: pick an entity (task, approval,
  delivery, material request, payment request, issue, project stage,
  contract signature, change request, sync failure, unsigned contract) →
  per-instance pending-since, age hours, responsible dept/user, **reminders
  sent count** (from `reminders_log` written by the sweeper — same source
  of truth), resolved-at, deep link into the module. `min_hours` filter.
- `variance` — plan vs fact per project line: offer/schedule assumed days
  vs actual work days (distinct `work_date`s from `progress_entries`),
  attendance hours where recorded, day-rate context, over/under flags.
  Crew section aggregates actual-vs-assumed across projects — answers
  "does this crew run +2 days vs the offer".
- `exceptions` — aged open issues, failed sync events, overdue tasks,
  pending approvals/change-requests, negative stock: one digest with age,
  severity, owner, link.
- `finance` — per-project contract value / invoiced / received / result
  (reuses `calc.finance`), money columns hidden without `finance` perm.
- `attendance` — hours per team/project/week from `attendance`.

**Frontend:** `web/src/pages/Warehouse.tsx` (4 tabs: stock grid with low
badges + movement modal, request list + detail modal with
suggest/approve/fulfil/cancel, reservations, movement history) and
`web/src/pages/Reports.tsx` (report picker, typed params incl. project
select fed from `/api/projects`, multi-section results, per-table CSV
download with BOM for Excel). `/warehouse` + `/reports` nav items already
existed — now route to real pages instead of `Soon`.

**Bug found by tests:** `ageH()` in the reports engine divided the
julianday diff by 24 instead of multiplying — every dwell/exception row
under 24 days reported 0 pending hours. Fixed at the helper; all 11 call
sites corrected at once. `reminders.js` uses JS date math — unaffected.

**Verified:** `npm test` 51/51 (3 new: stock lifecycle incl.
reserve→fulfil→release, warehouse-vs-commercial perm split, report
catalog gating + dwell-with-reminder + variance/finance/attendance/
exceptions), `npm run build` clean (`index-8XJ_SVtq.js`), local :4800
restarted; `/api/warehouse/stock`, `/api/material-requests`,
`/api/reports` all 401 without session. Not measured: clicking through
the UI in a browser.
