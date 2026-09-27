# Як перевірити працездатність скіла

Інструкція покрокова: від автоматичних перевірок до ручної роботи з CLI і перевірки агентом.
Кожен крок має чіткий критерій «пройдено». Числа в прикладах отримані 2026-09-27. Якщо
запускати пізніше, вони будуть іншими, бо період `2y` рахується від поточної дати.

> **Про оболонку.** Команди наведено для bash (Git Bash). У PowerShell замініть
> `2>/dev/null` на `2>$null`. Логи інструмент пише в **stderr**, а JSON — у **stdout**. Щоб
> передати JSON іншій програмі, відкиньте stderr.

---

## Крок 0. Передумови

1. Node.js 22+: `node -v`.
2. pnpm 10: `pnpm -v`. Якщо pnpm немає або `corepack` падає з помилкою ключів, використовуйте
   `npx pnpm@10` замість `pnpm` у всіх командах нижче.
3. Доступ до інтернету для кроків 3–6 (кроки 1–2 працюють офлайн).
4. Необов'язково: `export WIA_USER_AGENT="my-check/1.0 (you@example.org)"`. Wikimedia просить
   User-Agent із контактом.

## Крок 1. Встановлення з lockfile

```bash
cd wikipedia-interest-analysis
pnpm install --frozen-lockfile
```

✅ Пройдено: `Done`, без помилок. Попередження про «Ignored build scripts» (@parcel/watcher,
unrs-resolver) очікувані й не заважають роботі.

## Крок 2. Автоматична перевірка якості (офлайн)

```bash
pnpm check
```

Команда послідовно запускає typecheck → lint → format:check → тести з coverage → build.

✅ Пройдено:

- `Test Suites: 14 passed`, `Tests: 172 passed`;
- coverage не нижче порогів (≈96% statements, ≈79% branches, ≈98% lines);
- `Build success`;
- код виходу 0 (`echo $?` → `0`).

Можна вимкнути інтернет і повторити: тести не ходять у мережу.

## Крок 3. Smoke-тест проти реального API

```bash
pnpm smoke
```

✅ Пройдено: 5 рядків `PASS` (site matrix, резолвінг «astronomy» → Q333, неоднозначність
«Mercury», per-article і aggregate pageviews).

## Крок 4. Ручна перевірка CLI

Кожна команда — окрема функція з ТЗ. Код виходу перевіряйте через `echo $?`.

| #    | що перевіряємо                    | команда                                                                       | очікуваний результат                                                                                         |
| ---- | --------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 4.1  | резолвінг концепту → QID → статті | `pnpm resolve-topic --query "intermittent fasting" --languages pl,cs,uk,de`   | `qid: "Q1666254"`, статті cs/uk/de, у `missingLanguages` — pl з `no_article`; exit 0                         |
| 4.2  | неоднозначність                   | `pnpm analyze --topic Mercury --languages de,fr --period 12m`                 | `status: "needs_clarification"`, `agentInstruction` починається зі `STOP`, у `options` є Q308 і Q925; exit 2 |
| 4.3  | аналіз після уточнення            | `pnpm analyze --qid Q308 --languages de,fr --period 12m`                      | `status: "success"`, `languages.de`/`fr`, шляхи до `report.pdf` і графіків; exit 0                           |
| 4.4  | відсутня мова, без підміни        | `pnpm analyze --topic "intermittent fasting" --languages pl,cs`               | `status: "partial"`, аналіз лише cs; exit 0                                                                  |
| 4.5  | валідація вводу                   | `pnpm analyze --topic x --languages "pl;rm"`                                  | `error.code: "invalid_input"`, повідомлення `Invalid --languages: …`; exit 4                                 |
| 4.6  | невідома тема                     | `pnpm analyze --topic zzqqxxyy --languages en`                                | `error.code: "not_found"`; exit 3                                                                            |
| 4.7  | follow-up: період                 | після 4.3: `pnpm analyze --from last --period 2y`                             | той самий QID і мови, новий період; блок `previousRun` із різницею по мовах                                  |
| 4.8  | follow-up: виключення сплеску     | `pnpm analyze --from last --exclude-largest-spike`                            | `request.exclusions.largestSpike: true`, у `previousRun` є `differencePercentagePoints`                      |
| 4.9  | звіт офлайн із JSON               | `pnpm generate-report --input <шлях analysis.json з 4.3>`                     | `status: "ok"`, звіт і графіки перегенеровано без мережі                                                     |
| 4.10 | помилка мережі                    | вимкнути інтернет: `pnpm analyze --topic astronomy --languages uk --no-cache` | `error.message: "Unable to reach Wikimedia API."`, без stack trace у stdout; exit 5                          |
| 4.11 | формати виводу                    | `… --format text` / `--format full`                                           | text — читабельний звіт; full — повний JSON зі схемою `schemaVersion: "1.0"`                                 |

## Крок 5. Перевірка артефактів

1. Відкрийте `report.pdf` будь-якого запуску (або готовий `examples/astronomy-uk-pl-cs/report.pdf`):
   - рівно **одна сторінка**;
   - розділи: Key findings, Charts, Core metrics, Evidence strength, Limitations. Вони є
     також у панелі закладок переглядача;
   - кирилиця відображається (Астрономія);
   - скопіюйте рядок «Traffic: access=all-access» і вставте в редактор: текст має бути
     повним, без втрачених літер.
2. Відкрийте `charts/*.svg` у браузері: підписи осей, легенда, лінія 100 на графіку індексу.
3. Автоматична звірка чисел JSON ↔ графіки ↔ PDF:

   ```bash
   pnpm consistency output/<тема>-<QID>/<мови>_<початок>_<кінець>
   ```

   ✅ Пройдено: усі рядки `OK`, жодного `FAIL`.

## Крок 6. Перевірка як Agent Skill (з дешевою моделлю)

1. Скопіюйте папку скіла в каталог скілів Claude Code: `~/.claude/skills/` (глобально) або
   `<проєкт>/.claude/skills/` (для проєкту). Виконайте в ній `pnpm install`.
2. Запустіть агент на дешевій моделі, наприклад `claude --model haiku`.
3. Дайте запити з кейсів нижче або з [`evals/prompts.md`](evals/prompts.md).
4. Збережіть відповідь агента в файл `answer.md` і перевірте, що всі числа взяті з інструменту:

   ```bash
   pnpm eval:grounding answer.md output/<…>/analysis.json
   ```

   ✅ Пройдено: `"ungrounded": []`.

5. Ручний чекліст відповіді:
   - є evidence strength і хоча б одне застереження;
   - є речення «pageviews ≠ попит»;
   - абсолютна популярність і відносний ріст подані окремо;
   - немає «significant», «winner», «market size», немає пояснень причин;
   - на неоднозначний запит агент **питає**, а не обирає сам.

---

## Три кейси використання

### Кейс 1. EdTech: «Чи додавати курс астрономії?»

**Контекст.** Освітній застосунок для україномовної аудиторії вирішує, чи інвестувати в курс
астрономії. Потрібна відповідь, наскільки можна довіряти тренду.

**Запит агенту:**

> Ми думаємо додати курс з астрономії до освітнього застосунку. Чи зростає інтерес до цієї
> теми в україномовній Wikipedia, і наскільки цьому зростанню можна довіряти?

**Що має зробити агент** (або вручну):

```bash
pnpm analyze --topic "астрономія" --search-lang uk --languages uk --period 2y
```

**Очікуваний результат (дані на 2026-09-27):**

- Q333, стаття «Астрономія»;
- середні перегляди 45.5 → 18.4 на день (−59.6%, вер 2024–сер 2025 проти вер 2025–сер 2026);
- тренд down (high), evidence **high**;
- сезонність виявлено (пік у вересні, мінімум у червні); тренд розраховано на сезонно
  скоригованих даних;
- частка статті в трафіку uk.wikipedia впала сильніше, ніж трафік усього розділу, тобто спад
  тематичний.

**Критерії «пройдено»:** відповідь українською; агент прямо каже «не зростає», називає
evidence strength, згадує сезонність, додає обмеження «перегляди ≠ попит»; `eval:grounding`
без незаземлених чисел.

**Продовження:** «А як у польській і чеській?» → `pnpm analyze --from last --languages uk,pl,cs`.
Агент має спиратися на `comparison.rankings`: pl має найменше падіння, і воно майже збігається
з падінням усього pl.wikipedia.

### Кейс 2. Застосунок для вивчення мов: «Які аудиторії досліджувати далі?»

**Контекст.** Команда обирає наступні ринки для курсу англійської. Потрібен короткий звіт,
яким можна поділитися.

**Запит агенту:**

> We're building a language-learning app. Compare interest in the English language in Polish,
> Czech, Ukrainian and Turkish Wikipedia and prepare a short report: which audiences should we
> research next and why?

**Команда:**

```bash
pnpm analyze --topic "English language" --languages pl,cs,uk,tr --period 2y
```

**Очікуваний результат:**

- Q1860, чотири статті (Język angielski, Angličtina, Англійська мова, İngilizce);
- усі чотири мови падають: tr −16.5%, pl −18.3%, cs −22.8%, uk −35.6%;
- `comparison.researchCandidates`: **tr → pl → cs → uk**, з причинами. Приклад для tr: «article
  −16.5% vs edition −16.3% → share −0.2%: moved with its edition»;
- `researchNote`: це порядок для подальшого дослідження, а не оцінка попиту;
- PDF на одну сторінку з графіком індексу і таблицею.

**Критерії «пройдено»:** агент подає кандидатів **у порядку інструменту** з його причинами;
не вигадує причин спаду («геополітика», «освітні пріоритети»); не називає аудиторію
«ринком» чи «переможцем»; дає шлях до PDF; усі числа заземлені.

### Кейс 3. Coding-bootcamp: неоднозначна тема і серія уточнень

**Контекст.** Школа програмування порівнює інтерес до Python у кількох мовах, а потім звужує
аналіз.

**Розмова з агентом:**

1. «Як змінювався інтерес до Python в англійській, німецькій, польській і українській
   Wikipedia за два роки?»
   - Очікується: інструмент повертає `needs_clarification` (exit 2). Агент **питає**, що саме
     мається на увазі: Python (programming language) Q28865, Monty Python, Python (mythology)
     та інші.
2. «Мова програмування.»
   - Очікується: `pnpm analyze --qid Q28865 --languages en,de,pl,uk --period 2y`.
   - Результат (2026-09-27): en −7.3% (найбільша аудиторія, 4 133/день), de −21.6%,
     pl −29.8%, uk −53.5%; сезонність у de/pl/uk (пік у січні–лютому, мінімум улітку); частка
     en у трафіку en.wikipedia майже не змінилась (−0.3% проти −7.0% для розділу).
3. «Тепер тільки останні 12 місяців.»
   - Очікується: `pnpm analyze --from last --period 12m`. Той самий QID і мови, у `previousRun`
     різниця до/після. Агент попереджає, що 12-місячне порівняння зіставляє різні сезони, і
     evidence знижено.
4. «Виключи найбільший сплеск.»
   - Очікується: `pnpm analyze --from last --exclude-largest-spike`, застосовано саме до
     12-місячного аналізу. Різницю в п.п. агент бере з `previousRun`, а не рахує сам.

**Критерії «пройдено»:** агент не обирає значення «Python» самостійно; кожне уточнення
змінює лише потрібний параметр; зміни «до → після» взято з інструменту; у відповіді на
крок 3 є сезонне застереження.

---

## Якщо щось не так

- `pnpm` не знайдено або corepack падає → `npx pnpm@10 …`.
- У логах `Wikimedia API rate limit reached; retrying...` → це нормально: інструмент чекає
  `Retry-After` і повторює запит. Повторні запуски беруть дані з кешу `.cache/`.
- Потрібні свіжі дані → `--no-cache`.
- Детальні технічні логи → `--log-level debug` (stack traces лише там, не у stdout).
