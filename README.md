# reg-pin-888

Массовый регистратор аккаунтов Pinnacle888 + автоматизация депозитов, ставок и выводов.

## Стек
- Node.js (CommonJS)
- Puppeteer-core (Chrome через `proxy-chain` для SOCKS5 → HTTP)
- Express (UI)
- viem + permissionless (web3 для депозитов)
- winston (логирование)

## Структура
```
src/              — основной код (registrator, betplacer, depositor, withdrawal, proxy, browser, ...)
scripts/          — вспомогательные/одноразовые скрипты (test-run, affiliate-scan, inspect-*)
ui/               — Express-сервер и фронтенд (страницы кошельков, калькулятор, статус)
data/             — БД аккаунтов, кошельков, зеркал, локалей (генерируется/наполняется при работе)
profiles/         — пользовательские директории Chrome (генерируется автоматически)
docs/             — заметки/лог исправлений
config.json       — конфигурация (НЕ коммитить — содержит пароли/api-ключи)
.env              — переменные окружения (НЕ коммитить)
```

## Установка
```bash
git clone <repo>
cd autoregPinn
npm install
cp .env.example .env
# заполни .env и создай config.json (см. ниже)
```

## config.json
В репозитории не лежит — содержит секреты. Минимальный шаблон:
```json
{
  "chrome": { "executablePath": "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "headless": false },
  "captcha": { "provider": "openrouter", "apiKey": "sk-or-v1-...", "model": "google/gemini-2.0-flash-exp:free" },
  "proxy": { "RU": { "base": "socks5://USER:PASS@proxy.soax.com:", "fromPort": 40500, "toPort": 40600 } },
  "registration": { "mirrors": ["https://www.example-mirror.xyz/"], "locale": "RU" },
  "selectors": { "firstName": "#firstName", "submitButton": "#submitButton" },
  "paths": { "profilesDir": "profiles" }
}
```

## Запуск
```bash
# UI
node ui/server.js

# Регистрация (один аккаунт через тестовый раннер)
node scripts/test-run.js

# CLI (см. package.json)
npm run register
npm run status
```

## Безопасность
- `.env`, `config.json`, `data/accounts.json`, `data/wallets.json`, `profiles/` — в `.gitignore`.
- **Перед первым `git push` убедись, что `git status` не показывает эти файлы.**
- Если случайно закоммитил секреты — ротируй ключи (Pimlico, OpenRouter, SOAX) и почисти историю через `git filter-repo`.
