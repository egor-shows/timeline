# Хронограф

Интерактивный таймлайн мировой истории. Данные хранятся в Google Sheets.

## Быстрый старт

### 1. Google Sheets

Создай таблицу с тремя листами. Импортируй CSV-файлы из папки `data/`:

| Лист | Файл | Что внутри |
|------|-------|-----------|
| events | `data/events.csv` | События |
| countries | `data/countries.csv` | Страны и эпохи |
| leaders | `data/leaders.csv` | Лидеры |

Затем опубликуй каждый лист:
- **Файл → Поделиться → Опубликовать в интернете**
- Выбери конкретный лист → формат **CSV** → **Опубликовать**
- Скопируй полученный URL

### 2. Настройка

Открой `src/config.js` и вставь три URL:

```js
export const SHEETS = {
  events:    "https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?gid=0&single=true&output=csv",
  countries: "https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?gid=12345&single=true&output=csv",
  leaders:   "https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?gid=67890&single=true&output=csv",
};
```

Здесь же можно изменить диапазон лет: `YEAR_START` и `YEAR_END`.

### 3. Локальный запуск (проверка)

```bash
npm install
npm run dev
```

Откроется на `http://localhost:5173`

### 4. Деплой на Vercel

1. Залей проект на GitHub (новый репозиторий)
2. Зайди на [vercel.com](https://vercel.com), войди через GitHub
3. **Add New → Project → Import** твой репо
4. Framework: **Vite**, всё остальное по умолчанию
5. **Deploy**

Готово. Сайт на `https://твоё-имя.vercel.app`

## Формат данных

### events (лист «события»)

| Колонка | Описание |
|---------|----------|
| country_id | ID страны (совпадает с `countries.id`) |
| year | Год |
| month | Месяц 0–11 (пусто = годовое событие) |
| summary | Текст события |
| detail | Подробности для popup (опционально) |
| link_group | Группа связи — одинаковое значение = связанные события |

**Важно:** запятые внутри текста заменяй на точку с запятой (`;`), либо оборачивай ячейку в кавычки.

### countries (лист «страны»)

| Колонка | Описание |
|---------|----------|
| id | Уникальный ID (`russia`, `usa`) |
| emoji | Эмодзи-флаг |
| era_name | Название в эту эпоху |
| era_start | Начало эпохи (год) |
| era_end | Конец эпохи (пусто = по сей день) |
| sort_order | Порядок отображения |

Одна строка — одна эпоха одной страны. У России три строки: империя, СССР, РФ.

### leaders (лист «лидеры»)

| Колонка | Описание |
|---------|----------|
| country_id | ID страны |
| name | Имя лидера |
| start_year, start_month | Начало правления |
| end_year, end_month | Конец правления |
| color | Цвет полоски (HEX, например `#5B8AC4`) |
