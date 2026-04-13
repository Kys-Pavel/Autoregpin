/**
 * Скрипт для пакетного запуска регистрации
 * Запускает цикл и для каждой итерации: генерирует аккаунт, заполняет форму и пытается решить CAPTCHA
 */

const { generateAccount } = require('../src/data-generator');
const { navigateToRegistration, fillRegistrationForm } = require('../src/registrator');
const { solveCaptcha } = require('../src/captcha-solver');
const { performDeposit } = require('../src/depositor');
const { BrowserManager } = require('../src/browser');
const ProxyManager = require('../src/proxy');
const configPath = require('path').resolve(__dirname, '../config.json');
const path = require('path');
const fs = require('fs');

// Читаем конфиг через readFileSync (не require!) чтобы всегда брать актуальные данные
function loadConfig() {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

// === Трекинг использованных IP по локали === 
const USED_IPS_FILE = path.resolve(__dirname, '../data/used_ips.json');

function loadUsedIps() {
    try {
        if (fs.existsSync(USED_IPS_FILE)) {
            return JSON.parse(fs.readFileSync(USED_IPS_FILE, 'utf-8'));
        }
    } catch (e) { /* ignore parse errors */ }
    return {}; // { "RU": ["1.2.3.4", ...], "UA": [...] }
}

function isIpUsed(ip, locale) {
    if (!ip) return false;
    const data = loadUsedIps();
    const list = data[locale] || [];
    return list.includes(ip);
}

function saveUsedIp(ip, locale, accountId) {
    if (!ip) return;
    // Потокобезопасная запись с retry
    for (let retry = 0; retry < 4; retry++) {
        try {
            const data = loadUsedIps();
            if (!data[locale]) data[locale] = [];
            if (!data[locale].includes(ip)) {
                data[locale].push(ip);
                fs.writeFileSync(USED_IPS_FILE, JSON.stringify(data, null, 2));
                console.log(`💾 [IP-данные] ${ip} записан для локали ${locale} (акк #${accountId})`);
            }
            break;
        } catch (e) {
            if (retry < 3) {
                const delay = 300 + Math.random() * 200;
                require('child_process').execSync(`ping -n 1 -w ${Math.round(delay)} 127.0.0.1 > nul 2>&1`);
            }
        }
    }
}

// Отправка данных зарегистрированного аккаунта в Telegram
const https = require('https');
const TG_BOT_TOKEN = '7743043481:AAHe-6C2Pc3eQfytCWHZVgkcQdbJv5Nm7UA';
const TG_CHAT_ID = '-5218110329';

function sendToTelegram(account) {
    const isOk = account.status === 'registered';
    const header = isOk
        ? `✅ <b>Аккаунт #${account.id} зарегистрирован</b>`
        : `❌ <b>Аккаунт #${account.id} — ошибка</b>`;

    const lines = [
        header,
        ``,
        `👤 <b>Имя:</b> ${account.firstName} ${account.lastName}`,
        `🔑 <b>Логин:</b> <code>${account.loginId}</code>`,
        `🔒 <b>Пароль:</b> <code>${account.password}</code>`,
        `📧 <b>Email:</b> <code>${account.email}</code>`,
        `📅 <b>Дата рождения:</b> ${account.dob || '-'}`,
        `🌐 <b>IP:</b> ${account.regIp || '-'}`,
        `🔗 <b>Зеркало:</b> ${account.mirrorUsed || '-'}`,
        `🛡 <b>Прокси:</b> <code>${account.proxy || '-'}</code>`,
        `❓ <b>Секр. вопрос:</b> ${account.securityQuestion || '-'}`,
        `💬 <b>Ответ:</b> <code>${account.securityAnswer || '-'}</code>`,
        `📍 <b>Страна:</b> ${account.country || '-'}`,
        `💰 <b>Валюта:</b> ${account.currency || '-'}`,
    ];
    if (account.error) lines.push(`⚠️ <b>Ошибка:</b> ${account.error}`);
    lines.push(`⏰ <b>Дата:</b> ${new Date().toLocaleString('ru-RU')}`);

    const text = lines.join('\n');
    const payload = JSON.stringify({
        chat_id: TG_CHAT_ID,
        text: text,
        parse_mode: 'HTML'
    });

    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${TG_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };

    const req = https.request(options, (res) => {
        if (res.statusCode === 200) {
            console.log(`📨 Данные аккаунта #${account.id} отправлены в Telegram`);
        } else {
            console.warn(`⚠️ Telegram ответил ${res.statusCode}`);
        }
    });
    req.on('error', (e) => console.warn(`⚠️ Ошибка отправки в Telegram: ${e.message}`));
    req.write(payload);
    req.end();
}

async function main() {
    let regCount = 1;
    const args = process.argv.slice(2);
    const countIndex = args.indexOf('--count');
    if (countIndex !== -1 && args[countIndex + 1]) {
        regCount = parseInt(args[countIndex + 1], 10) || 1;
    }
    const useTestEmail = args.includes('--test-email');
    const keepOpen = args.includes('--keep-open');
    const keepIdx = args.indexOf('--keep-open');
    const keepSeconds = (keepOpen && keepIdx !== -1 && args[keepIdx + 1]) ? parseInt(args[keepIdx + 1], 10) || 60 : 60;

    // Локаль из аргументов (переопределяет config.json)
    const localeIdx = args.indexOf('--locale');
    const localeArg = (localeIdx !== -1 && args[localeIdx + 1]) ? args[localeIdx + 1] : null;

    // Партнёрский URL (случайная партнёрка)
    const affiliateUrlIdx = args.indexOf('--affiliate-url');
    const affiliateUrlArg = (affiliateUrlIdx !== -1 && args[affiliateUrlIdx + 1]) ? args[affiliateUrlIdx + 1] : null;
    const useAffiliate = !!affiliateUrlArg;

    // Параллельные потоки
    const threadIdIdx = args.indexOf('--thread-id');
    const threadId = (threadIdIdx !== -1 && args[threadIdIdx + 1] !== undefined) ? parseInt(args[threadIdIdx + 1], 10) : 0;
    const totalThreadsIdx = args.indexOf('--total-threads');
    const totalThreads = (totalThreadsIdx !== -1 && args[totalThreadsIdx + 1] !== undefined) ? parseInt(args[totalThreadsIdx + 1], 10) : 1;

    const T = `[T${threadId + 1}]`; // Префикс для логов

    /**
     * Генерация реферального кода ?a=A6{8 цифр}
     */
    function generateRefCode() {
        const digits = Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join('');
        return `A6${digits}`;
    }

    /**
     * Берём случайный affiliate URL:
     * 1) Резолвим shortUrl (b.link) через Node.js http.get — без браузера
     * 2) Если финальный URL — IP-адрес или содержит /checker/ → fallback на mirror из config
     * 3) Добавляем ?a=A6{8цифр} к итоговому URL
     */
    async function buildAffiliateUrl(shortUrl) {
        console.log(`\n🔗 [Партнёрка] Резолвим: ${shortUrl}`);

        // --- Резолв редиректов через Node.js (без браузера) ---
        const resolved = await new Promise((resolve) => {
            let hops = 0;
            const maxHops = 10;
            function follow(url) {
                if (hops++ >= maxHops) { return resolve(url); }
                const lib = url.startsWith('https') ? require('https') : require('http');
                const req = lib.get(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
                    }
                }, (res) => {
                    res.resume();
                    const loc = res.headers['location'];
                    if ([301, 302, 303, 307, 308].includes(res.statusCode) && loc) {
                        let next;
                        try { next = new URL(loc, url).toString(); } catch (e) { next = loc; }
                        console.log(`   ↳ ${res.statusCode} → ${next}`);
                        follow(next);
                    } else {
                        console.log(`   ✅ Финал (${res.statusCode}): ${url}`);
                        resolve(url);
                    }
                });
                req.on('error', (err) => { console.warn(`⚠️ [Партнёрка] Ошибка: ${err.message}`); resolve(url); });
                req.setTimeout(10000, () => { req.destroy(); console.warn(`⚠️ [Партнёрка] Таймаут`); resolve(url); });
            }
            follow(shortUrl);
        });

        // --- Проверка: если финальный URL — IP или /checker/ → fallback на mirrors ---
        const isIPorChecker = (() => {
            try {
                const u = new URL(resolved);
                // IP-адрес типа http://166.117.100.75/ или путь /checker/
                return /^[\d.]+$/.test(u.hostname) || u.pathname.includes('/checker');
            } catch (e) { return true; }
        })();

        let baseUrl;
        if (isIPorChecker) {
            const mirrors = loadConfig().registration.mirrors || [];
            const valid = mirrors.filter(m => !m.includes('pinnacle888.com') && m.includes('?'));
            const pool = valid.length > 0 ? valid : mirrors;
            baseUrl = pool[Math.floor(Math.random() * pool.length)];
            console.log(`⚠️ [Партнёрка] b.link → IP/checker, fallback: ${baseUrl.split('?')[0]}`);
        } else {
            baseUrl = resolved;
            console.log(`✅ [Партнёрка] b.link → зеркало: ${baseUrl.split('?')[0]}`);
        }

        // --- Добавляем ?a=A6{8цифр} ---
        const refCode = generateRefCode();
        let targetUrl;
        try {
            const u = new URL(baseUrl);
            u.searchParams.set('a', refCode);
            targetUrl = u.toString();
        } catch (e) {
            const sep = baseUrl.includes('?') ? '&' : '?';
            targetUrl = `${baseUrl}${sep}a=${refCode}`;
        }
        console.log(`🔗 [Партнёрка] URL: ${targetUrl}`);
        return targetUrl;
    }



    console.log(`\n========================================`);
    console.log(`🚀 ${T} ПОТОК ${threadId + 1}/${totalThreads}: ${regCount} регистраций${useTestEmail ? ' [ТЕСТ GMAIL]' : ''}${keepOpen ? ` [НЕ ЗАКРЫТЬ ${keepSeconds}с]` : ''}${localeArg ? ` [ЛОКАЛЬ: ${localeArg}]` : ''}`);
    console.log(`========================================\n`);

    // Чтение почт из emails.txt — каждый поток берёт свой срез.
    // Фильтрация против blacklist.txt и data/accounts.json гарантирует что email
    // не будет использован повторно (backup на случай если emails.txt вручную содержит б/у).
    let availableEmails = [];
    const emailsFile = path.resolve(__dirname, '../data/emails.txt');
    const blacklistFile = path.resolve(__dirname, '../data/blacklist.txt');
    const accountsFile = path.resolve(__dirname, '../data/accounts.json');

    const usedEmails = new Set();
    if (fs.existsSync(blacklistFile)) {
        fs.readFileSync(blacklistFile, 'utf-8').split(/\r?\n/)
            .map(s => s.trim().toLowerCase()).filter(Boolean)
            .forEach(e => usedEmails.add(e));
    }
    if (fs.existsSync(accountsFile)) {
        try {
            const accs = JSON.parse(fs.readFileSync(accountsFile, 'utf-8'));
            accs.forEach(a => { if (a.email) usedEmails.add(String(a.email).toLowerCase()); });
        } catch (_) {}
    }

    if (fs.existsSync(emailsFile)) {
        const allEmails = fs.readFileSync(emailsFile, 'utf-8')
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#') && l.includes('@'));

        const beforeBl = allEmails.length;
        const filtered = allEmails.filter(e => !usedEmails.has(e.toLowerCase()));
        const droppedBl = beforeBl - filtered.length;
        if (droppedBl > 0) {
            console.log(`📛 ${T} Отфильтровано ${droppedBl} email'ов (уже в accounts.json или blacklist.txt)`);
        }

        // Каждый поток берёт свою порцию: поток 0 берёт [0, totalThreads, 2*totalThreads...], поток 1 — [1, 1+totalThreads, ...]
        for (let idx = threadId; idx < filtered.length; idx += totalThreads) {
            availableEmails.push(filtered[idx]);
        }
        console.log(`📧 ${T} Доступно email-адресов для потока: ${availableEmails.length} (из ${filtered.length} уникальных)`);
    }

    const screenshotsDir = path.resolve(__dirname, '..', 'screenshots');
    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

    // Offset для прокси — каждый поток начинает с уникального порта
    const proxyThreadOffset = threadId * regCount;

    for (let i = 1; i <= regCount; i++) {
        console.log(`\n\n--- Регистрация ${i} из ${regCount} ---`);

        let realEmail = null;
        if (!useTestEmail && availableEmails.length > 0) {
            realEmail = availableEmails.shift();
            console.log(`📧 Выбран email: ${realEmail}`);
            // Атомарно удаляем ТОЛЬКО использованный email из общего файла.
            // File-lock: эксклюзивный .lock файл, ретраи с экспоненциальной паузой.
            // Закрывает гонку read→write между параллельными потоками.
            const lockFile = emailsFile + '.lock';
            const acquireLock = async () => {
                for (let a = 0; a < 50; a++) { // до ~5 сек
                    try {
                        const fd = fs.openSync(lockFile, 'wx'); // эксклюзивное создание
                        fs.closeSync(fd);
                        return true;
                    } catch (_) {
                        await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
                    }
                }
                return false;
            };
            const releaseLock = () => { try { fs.unlinkSync(lockFile); } catch (_) {} };

            try {
                const locked = await acquireLock();
                if (!locked) console.warn(`⚠️ ${T} Не удалось взять lock для emails.txt, пишем без блокировки`);
                try {
                    if (fs.existsSync(emailsFile)) {
                        const current = fs.readFileSync(emailsFile, 'utf-8').split(/\r?\n/);
                        const target = realEmail.toLowerCase();
                        const next = current.filter(l => l.trim().toLowerCase() !== target);
                        if (next.length !== current.length) {
                            fs.writeFileSync(emailsFile, next.join('\n'));
                        }
                    }
                } finally {
                    if (locked) releaseLock();
                }
            } catch (e) {
                console.warn(`⚠️ Не удалось обновить emails.txt: ${e.message}`);
            }
        } else if (useTestEmail) {
            const rndString = Math.random().toString(36).substring(2, 10);
            realEmail = `${rndString}@gmail.com`;
            console.log(`🧪 Тестовый Gmail: ${realEmail}`);
        } else {
            const rndString = Math.random().toString(36).substring(2, 10);
            realEmail = `${rndString}@gmail.com`;
            console.log(`⚠️ База email пуста! Используем случайно сгенерированный: ${realEmail}`);
        }

        const regConfig = loadConfig().registration;
        if (localeArg) regConfig.locale = localeArg; // Приоритет аргумента командной строки
        const account = generateAccount(999, new Set(), regConfig, realEmail);


        const dbPath = path.resolve(__dirname, '../data/accounts.json');
        let accountId = 1;
        if (fs.existsSync(dbPath)) {
            try {
                const accountsDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
                if (accountsDb.length > 0) accountId = Math.max(...accountsDb.map(a => a.id)) + 1;
            } catch (e) { }
        }
        // Для параллельных потоков: сдвигаем ID чтобы не было коллизий
        // Поток 0 берёт base+0, поток 1 берёт base+1, и т.д.
        accountId = accountId + threadId + ((i - 1) * totalThreads);
        account.id = accountId;

        console.log(`\n📋 АККАУНТ #${account.id}: ${account.firstName} ${account.lastName} | ${account.loginId} | ${account.email}`);

        const profilePath = path.resolve(__dirname, '..', 'profiles', `profile_${account.id}`);
        account.profilePath = `profiles/profile_${account.id}`;
        // Удаляем папку профиля если уже есть — чтобы не открывать старую сессию
        if (fs.existsSync(profilePath)) {
            fs.rmSync(profilePath, { recursive: true, force: true });
            console.log(`🗑️ Удален старый профиль: ${profilePath}`);
        }
        fs.mkdirSync(profilePath, { recursive: true });


        // Переменные для финального блока
        let success = false;
        let errorMsg = null;
        let submitsDone = 0;  // объявляем здесь чтобы было доступно в finally

        let mirrorLoaded = false;
        const proxyManager = new ProxyManager(loadConfig().proxy, localeArg || regConfig.locale || null);
        const bm = new BrowserManager(loadConfig().chrome);
        let page = null;

        const MAX_IP_ATTEMPTS = 10;
        const triedMirrors = new Set();
        let forceMirrorRotation = false;
        for (let ipAttempt = 1; ipAttempt <= MAX_IP_ATTEMPTS; ipAttempt++) {
            if (ipAttempt > 1) {
                console.log(`\n🔄 Форма не открылась. Меняю IP (Попытка ${ipAttempt}/${MAX_IP_ATTEMPTS})...`);
                if (bm && bm.browser) {
                    try { await bm.browser.close() } catch (e) { }
                }
                // Каждые 3 неудачные попытки: чистим кеш профиля и форсим новое зеркало
                if ((ipAttempt - 1) % 3 === 0) {
                    try {
                        if (fs.existsSync(profilePath)) {
                            fs.rmSync(profilePath, { recursive: true, force: true });
                            console.log(`🗑️ Кеш профиля очищен после 3 неудачных попыток: ${profilePath}`);
                        }
                        fs.mkdirSync(profilePath, { recursive: true });
                    } catch (e) {
                        console.warn(`⚠️ Не удалось очистить кеш профиля: ${e.message}`);
                    }
                    forceMirrorRotation = true;
                }
            }

            let proxyUrl = null;
            if (proxyManager.hasProxies) {
                // Для новой попытки внутри сессии сдвигаем порт на +1, плюс offset потока
                const proxy = proxyManager.getProxyForAccount(account.id + (ipAttempt - 1) + proxyThreadOffset);
                proxyUrl = proxy.raw;
                account.proxy = proxy.raw;
                console.log(`\n🌐 Прокси: ${account.proxy}`);
            } else {
                console.log('\n⚠️ Прокси не настроены, работаем напрямую');
            }

            try {
                const result = await bm.launch({ userDataDir: profilePath, proxyUrl });
                page = result.page;
                console.log('\n✅ Chrome запущен');
            } catch (e) {
                console.error(`❌ Chrome не запустился: ${e.message}`);
                continue; // пробуем следующий IP
            }

            // Проверка IP через прокси (пауза 2с чтобы прокси стабилизировалась)
            await new Promise(r => setTimeout(r, 2000));
            let ipIsUnique = true;
            try {
                if (page && !page.isClosed()) {
                    await page.goto('https://api.ipify.org?format=json', { waitUntil: 'networkidle2', timeout: 12000 });
                    const bodyText = await page.evaluate(() => document.body.innerText);
                    const ipData = JSON.parse(bodyText);
                    account.regIp = ipData.ip;
                    console.log(`🌐 Реальный IP: ${account.regIp}`);

                    // === Проверка уникальности IP ===
                    const currentLocale = localeArg || regConfig.locale || 'RU';
                    if (proxyManager.hasProxies && isIpUsed(account.regIp, currentLocale)) {
                        console.warn(`⚠️ IP ${account.regIp} уже использовался (локаль ${currentLocale})! Беру следующий порт...`);
                        ipIsUnique = false;
                    } else {
                        console.log(`✅ IP ${account.regIp} — уникальный (локаль ${currentLocale})`);
                    }
                }
            } catch (ipErr) {
                console.warn(`⚠️ Не удалось получить IP: ${ipErr.message}`);
                account.regIp = null;
            }

            // Если IP занят — закрываем браузер и идём на следующую попытку
            if (!ipIsUnique) {
                try { await bm.browser.close(); } catch (_) { }
                continue; // следующая итерация ipAttempt — сдвинет порт через ProxyManager
            }

            try {
                let registrationUrl;

                const mirrorsList = loadConfig().registration.mirrors || [];
                const pickFreshMirror = () => {
                    const fresh = mirrorsList.filter(m => !triedMirrors.has(m));
                    const pool = fresh.length > 0 ? fresh : mirrorsList;
                    return pool.length > 0
                        ? pool[Math.floor(Math.random() * pool.length)]
                        : 'https://www.quietthunder61.xyz/';
                };

                if (useAffiliate && !forceMirrorRotation) {
                    // Режим партнёрки: резолвим редирект и добавляем ?a=A6{8цифр}
                    registrationUrl = await buildAffiliateUrl(affiliateUrlArg);
                    account.mirrorUsed = registrationUrl;
                    triedMirrors.add(registrationUrl.split('?')[0]);
                    console.log(`\n🔗 Партнёрка: ${registrationUrl}`);

                    console.log('\n⏳ Переходим на страницу регистрации (через партнёрку)...');
                    await navigateToRegistration(page, registrationUrl);
                } else {
                    // Обычный режим (или fallback после 3 неудач): зеркало из списка, исключая уже пробованные
                    const mirror = pickFreshMirror();
                    registrationUrl = mirror;
                    account.mirrorUsed = mirror;
                    triedMirrors.add(mirror);
                    forceMirrorRotation = false;
                    console.log(`\n🔗 Зеркало${useAffiliate ? ' (fallback после очистки кеша)' : ''}: ${mirror}`);

                    console.log('\n⏳ Переходим на страницу регистрации...');
                    await navigateToRegistration(page, mirror);
                }


                const hasForm = await page.$('#firstName');
                if (!hasForm) {
                    throw new Error("Form not loaded");
                }
                console.log('✅ Форма загружена (#firstName найден)');
                mirrorLoaded = true;
                break; // Выходим из цикла ipAttempt, так как форма загружена!
            } catch (err) {
                console.error(`❌ Ошибка загрузки Зеркала/Формы: ${err.message}`);
                errorMsg = err.message;
            }
        }

        try {
            if (!mirrorLoaded) {
                throw new Error(errorMsg || "Не удалось загрузить зеркало за 3 попытки (все IP отклонены)");
            }

            console.log('\n📝 Начинаю заполнение формы...');
            await fillRegistrationForm(page, account, loadConfig().selectors);

            // === САБМИТ С СИСТЕМОЙ ПЕРЕПОДАЧИ ===
            const maxSubmitAttempts = 5;
            // submitsDone объявлена перед try чтобы быть доступной в finally

            for (let attempt = 1; attempt <= maxSubmitAttempts; attempt++) {
                submitsDone = attempt;
                console.log(`\n🚀 Отправляю форму (попытка ${attempt}/${maxSubmitAttempts})...`);
                await page.click(loadConfig().selectors.submitButton);
                await new Promise(r => setTimeout(r, 6000));

                const pageUrl = page.url();
                const pageContent = await page.content();
                console.log(`📍 URL после сабмита: ${pageUrl}`);

                const pageErrors = await page.evaluate(() => {
                    const sels = ['.errorMsg', '.error-message', '.alert-danger',
                        '.has-error .help-block', '[class*="errorMsg"]', '.invalidMsg'];
                    const msgs = [];
                    for (const sel of sels) {
                        document.querySelectorAll(sel).forEach(el => {
                            const t = el.textContent.trim();
                            if (t && t.length > 2 && t.length < 400) msgs.push(t);
                        });
                    }
                    return [...new Set(msgs)];
                });

                if (pageErrors.length > 0) {
                    errorMsg = pageErrors.join(' | ').substring(0, 500);
                    console.log(`❌ Ошибки: ${errorMsg}`);
                }

                // Проверяем успешную регистрацию по URL или тексту страницы
                // ВАЖНО: /compact/account/deposit тоже содержит /compact/account —
                // поэтому проверяем что URL НЕ является страницей кассы
                const isDepositOrCashier = pageUrl.includes('/deposit') || pageUrl.includes('/withdrawal') || pageUrl.includes('/cashier');
                const isSuccessUrl = !isDepositOrCashier && (
                    pageUrl.includes('/success') ||
                    pageUrl.includes('/compact/account/home') ||
                    pageUrl.includes('/compact/sports') ||
                    (/\/account\/(?!deposit|withdrawal|cashier)/.test(pageUrl))
                );
                const isSuccessContent = pageContent.includes('Registration Completed') || pageContent.includes('Регистрация завершена');
                if (isSuccessUrl || isSuccessContent) {
                    console.log('\n🎉 Успешная регистрация обнаружена');
                    success = true;
                    errorMsg = null;
                    break;
                }

                // Если попали на депозит — аккаунт уже существует, но регистрация прошла ранее
                // (двойной сабмит или редирект после Terms popup)
                if (pageUrl.includes('/compact/account/deposit') || pageUrl.includes('/account/deposit')) {
                    console.log('\n⚠️ Редирект на /deposit — Pinnacle уже зарегистрировал аккаунт (возможно 2-й сабмит)');
                    console.log('  Считаем регистрацию успешной, переходим к депозиту...');
                    success = true;
                    errorMsg = null;
                    break;
                }

                const visibleCaptcha = await page.evaluate(() => {
                    const c = document.querySelector('#captcha');
                    if (!c) return false;
                    const style = window.getComputedStyle(c);
                    return style && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
                });

                if (visibleCaptcha) {
                    console.log('🧩 Обнаружена капча, решаю...');
                    const cfg = loadConfig();
                    const captchaCode = await solveCaptcha(page, cfg.gemini.apiKey, cfg.gemini.proxy || null, cfg.gemini.model || 'gemini-2.5-flash', cfg.gemini.provider || null);
                    if (!captchaCode) {
                        console.log('❌ Не удалось решить капчу.');
                        errorMsg = 'Captcha Failed';
                    } else {
                        // ВВОДИМ КОД В ПОЛЕ КАПЧИ перед следующим сабмитом
                        try {
                            const captchaSel = cfg.selectors.captcha;
                            await page.$eval(captchaSel, el => { el.value = ''; });
                            await page.type(captchaSel, captchaCode, { delay: 80 });
                            const fieldVal = await page.$eval(captchaSel, el => el.value).catch(() => '');
                            console.log(`✅ Капча введена в поле: "${fieldVal}", пробуем сабмит...`);
                        } catch (typeErr) {
                            console.warn(`⚠️ Не удалось ввести капчу: ${typeErr.message}`);
                        }
                    }
                } else if (pageErrors.length > 0) {
                    console.log('🛑 Критическая ошибка на форме, сабмит отменен.');
                    break;
                }
            }

            if (!success) {
                console.log(`\n⚠️ Регистрация #${account.id} не завершена. Ошибка: ${errorMsg || 'неизвестна'}`);
            }

            } catch (e) {
            console.error(`\n❌ ОШИБКА РЕГИСТРАЦИИ #${account.id}: ${e.message}`);
            // Проверяем URL — возможно регистрация фактически удалась
            try {
                if (page) {
                    const curUrl = page.url();
                    // Не считаем deposit/withdrawal страницей успеха регистрации
                    const isCashier = curUrl.includes('/deposit') || curUrl.includes('/withdrawal') || curUrl.includes('/cashier');
                    const isAccountPage = (curUrl.includes('/account/') || curUrl.includes('/compact/account')) && !isCashier;
                    if (isAccountPage || curUrl.includes('/compact/sports')) {
                        console.log(`✅ Переключаемся в успех по URL: ${curUrl}`);
                        success = true;
                        errorMsg = null;
                    } else if (isCashier) {
                        console.log(`✅ Попали на кассу (${curUrl}) — регистрация явно прошла`);
                        success = true;
                        errorMsg = null;
                    } else {
                        if (!errorMsg) errorMsg = e.message;
                    }
                }
            } catch (_) { if (!errorMsg) errorMsg = e.message; }

        } finally {
            // СОХРАНЕНИЕ ВСЕГДА — даже при краше
            account.status = success ? 'registered' : 'error';

            // Почта в ЧС всегда — она уже была использована (независимо от результата)
            try {
                const blFile = path.resolve(__dirname, '../data/blacklist.txt');
                const blContent = fs.existsSync(blFile) ? fs.readFileSync(blFile, 'utf-8') : '';
                const blEmails = blContent.split('\n').map(l => l.trim()).filter(Boolean);
                if (!blEmails.includes(account.email)) {
                    fs.appendFileSync(blFile, (blContent.trim() ? '\n' : '') + account.email);
                    console.log(`🚧 Почта ${account.email} добавлена в ЧС`);
                }
            } catch (blErr) { console.error('Ошибка добавления в ЧС:', blErr.message); }

            if (success) {
                account.registeredAt = new Date().toISOString();
                account.pinnacleLogin = account.loginId;
                account.submitAttempts = submitsDone || 1;
                console.log(`\n[OK] АККАУНТ ${account.id} ЗАРЕГИСТРИРОВАН (попыток: ${account.submitAttempts})`);
            } else {
                account.error = errorMsg || 'Неизвестная ошибка';
                console.log(`\n❌❌❌ РЕГИСТРАЦИЯ ${account.id} НЕ УДАЛАСЬ (${account.error}) ❌❌❌`);
            }

            // Отправляем данные в Telegram при любом результате
            try { sendToTelegram(account); } catch (tgErr) { console.warn(`⚠️ TG ошибка: ${tgErr.message}`); }

            // Потокобезопасная запись в accounts.json (retry если файл заблокирован)
            for (let retryWrite = 0; retryWrite < 5; retryWrite++) {
                try {
                    let saved = [];
                    if (fs.existsSync(dbPath)) {
                        try { saved = JSON.parse(fs.readFileSync(dbPath, 'utf-8')); } catch (_) { }
                    }
                    // Не добавляем дубликаты
                    if (!saved.find(a => a.id === account.id)) {
                        saved.push(account);
                        fs.writeFileSync(dbPath, JSON.stringify(saved, null, 4));
                        console.log(`💾 Аккаунт #${account.id} (${account.status}) записан в accounts.json`);
                    }
                    break; // Успешно записали
                } catch (saveErr) {
                    if (retryWrite < 4) {
                        console.log(`⏳ Файл accounts.json занят, повтор через 500мс...`);
                        await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
                    } else {
                        console.error(`❌ Ошибка записи аккаунта после 5 попыток: ${saveErr.message}`);
                    }
                }
            }

            // === АВТОДЕПОЗИТ после успешной регистрации ===
            if (success) {
                const depositCfg = loadConfig().deposit || {};
                const depositEnabled = depositCfg.enabled === true;
                const depositAmount = depositCfg.amount || 20;

                if (depositEnabled) {
                    console.log(`\n💰 === АВТОДЕПОЗИТ: реальная отправка ${depositAmount} USDT (форма — случайное 20..50) ===`);
                    await new Promise(r => setTimeout(r, 2000)); // Оптимизировано: 5000 → 2000

                    try {
                        const browser = bm.getBrowser();
                        const depositResult = await performDeposit(page, account, depositAmount, browser, depositCfg);

                        if (depositResult.success) {
                            console.log(`✅ Депозит #${account.id}: ${depositResult.actualSent || depositAmount} USDT отправлено`);
                            account.depositStatus = 'initiated';
                            account.depositAmount = depositResult.actualSent || depositAmount;
                            account.depositFormAmount = depositAmount;
                            account.depositAt = new Date().toISOString();
                            account.depositTxHash = depositResult.txHash || null;
                            account.depositAddress = depositResult.depositAddress || null;
                        } else {
                            console.warn(`⚠️ Депозит #${account.id} не выполнен: ${depositResult.error}`);
                            account.depositStatus = 'failed';
                            account.depositError = depositResult.error;
                        }
                    } catch (depErr) {
                        console.error(`❌ Ошибка депозита #${account.id}: ${depErr.message}`);
                        account.depositStatus = 'error';
                        account.depositError = depErr.message;
                    }
                } else {
                    console.log('ℹ️ Автодепозит отключён');
                }
            }

            // === ОЖИДАНИЕ ДЕПОЗИТА И ОРБИТРАЖ ===
            if (success) {
                const cfg = loadConfig();
                const bettingCfg = cfg.betting || {};
                const targetForks = bettingCfg.targetForks || 1;
                const minProfit = bettingCfg.minProfitPct || 0;
                const { getAccountBalance, performWithdrawal } = require('../src/withdrawal');

                // Хелпер: получить баланс через надёжный модуль из withdrawal.js
                const fetchBalance = async (p) => {
                    try { return (await getAccountBalance(p)) || 0; } catch (e) { return 0; }
                };
                
                let balance = await fetchBalance(page);
                console.log(`\n💰 Текущий баланс: ${balance.toFixed(2)} USDT`);

                if (balance < 0.1 && account.depositStatus === 'initiated') {
                    console.log(`⏳ Ожидание зачисления средств...`);
                    let waitAttempts = 0;

                    while (waitAttempts < 180) { // до 30 минут (180 раз по 10 сек)
                        await new Promise(r => setTimeout(r, 10000));
                        balance = await fetchBalance(page);
                        
                        if (balance >= 0.1) {
                             console.log(`\n✅ Депозит зачислен! Баланс: ${balance.toFixed(2)}`);
                             break;
                        }
                        waitAttempts++;
                        process.stdout.write(`\r  [${waitAttempts}/180] Ждем депозит... баланс: 0.00`);
                    }
                } else if (balance < 0.1) {
                    console.log(`⏭️ Баланс мал (${balance.toFixed(2)} USDT), а автодепозит не инициировался. Пропуск арбитража.`);
                }

                if (balance >= 0.1) {
                    const stakePerFork = Math.floor((balance / targetForks) * 100) / 100;
                    console.log(`\n🎲 Начинаем проставку вилок (цель: ${targetForks} вилок по ${stakePerFork} USDT)`);
                    
                    const { runBettingSession, fetchSurebets, calcStakesForFork } = require('../src/betplacer');
                    let surebets = [];
                    try {
                        const apiUrl = bettingCfg.apiBaseUrl || 'http://192.168.0.60:8891';
                        surebets = await fetchSurebets(apiUrl);
                    } catch(e) {
                        console.error(`❌ Ошибка API суребетов: ${e.message}`);
                    }

                    const filtered = surebets.filter(sb => {
                        if (!(sb.prices && Object.keys(sb.prices).length >= 2)) return false;
                        const sides = Object.keys(sb.prices);
                        const invSum = sides.reduce((s, k) => s + 1 / sb.prices[k], 0);
                        const pct = (1 / invSum - 1) * 100;
                        return pct > (minProfit > 0 ? minProfit : -100);
                    });

                    if (filtered.length > 0) {
                        let successCount = 0;
                        let sbIndex = 0;
                        const placed = new Set();
                        
                        while (successCount < targetForks && sbIndex < filtered.length) {
                            const sb = filtered[sbIndex++];
                            const matchKey = `${sb.match}|${sb.betType}|${sb.handicap}`;
                            if (placed.has(matchKey)) continue;

                            console.log(`\n  [${successCount+1}/${targetForks}] Попытка поставить на: ${sb.match}`);
                            
                            let retries = 0;
                            while (retries < 3) {
                                try {
                                    const result = await runBettingSession({
                                        accountLoginId: account.loginId,
                                        accountPassword: account.password,
                                        bankroll: stakePerFork,
                                        dryRun: false,
                                        _overrideSurebets: [sb],
                                        prelaunchedBrowser: bm.browser,
                                        prelaunchedPage: page
                                    });
                                    const anySuccess = result && result.results && Object.values(result.results).some(r => r?.success);
                                    if (anySuccess) {
                                        console.log(`✅ Вилка #${successCount+1} поставлена!`);
                                        successCount++;
                                        placed.add(matchKey);
                                        break;
                                    } else {
                                        console.log(`⚠️ Попытка ${retries+1}: ${Object.values(result.results || {}).map(r => r?.reason).join(', ')}`);
                                    }
                                } catch (e) {
                                    console.log(`❌ Ошибка ставки: ${e.message}`);
                                }
                                retries++;
                            }
                        }

                        // === ОЖИДАНИЕ РОЗЫГРЫША ===
                        if (successCount > 0) {
                            const intervalSec = bettingCfg.settlementCheckIntervalSec || 60;
                            console.log(`\n⏳ Ожидание розыгрыша ставок (проверка каждые ${intervalSec} сек)...`);
                            
                            let settlementIter = 0;
                            let settledBalance = 0;
                            while (settlementIter < 600) { // до 600 проверок
                                await new Promise(r => setTimeout(r, intervalSec * 1000));
                                
                                try {
                                    // Обновляем страницу перед проверкой
                                    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(()=>{});
                                    await new Promise(r => setTimeout(r, 5000));
                                    
                                    settledBalance = await fetchBalance(page);
                                    
                                    if (settledBalance > 0.1) {
                                        console.log(`\n🎉 Вилки рассчитаны! Баланс вернулся: ${settledBalance.toFixed(2)} USDT`);
                                        break;
                                    }
                                    
                                    settlementIter++;
                                    process.stdout.write(`\r  [${settlementIter}] Ожидание расчета... Баланс: 0.00`);
                                } catch(e) {
                                    console.log(`\n⚠️ Ошибка обновления баланса: ${e.message}`);
                                }
                            }

                            // === АВТОМАТИЧЕСКИЙ ВЫВОД СРЕДСТВ ===
                            if (settledBalance > 0.1) {
                                const withdrawAmount = Math.max(0, settledBalance - 0.2).toFixed(2);
                                console.log(`\n💸 Запускаем автоматический вывод: ${withdrawAmount} USDT (оставляем 0.20 на балансе)`);

                                const withdrawalCfg = loadConfig().withdrawal || {};
                                try {
                                    const withdrawResult = await performWithdrawal(
                                        page,
                                        account,
                                        bm.getBrowser(),
                                        withdrawalCfg
                                    );

                                    if (withdrawResult.success) {
                                        console.log(`\n✅ ВЫВОД ИНИЦИИРОВАН!`);
                                        console.log(`   Сумма: ${withdrawResult.withdrawAmount} USDT → ${withdrawResult.toAddress}`);
                                        if (withdrawResult.verificationRequired) {
                                            console.log(`\n⚠️  Требуется email-верификация!`);
                                            console.log(`   Откройте почту ${account.email} и введите код подтверждения вручную в браузер.`);
                                            // Ждём 10 мин на ввод кода вручную, затем продолжаем
                                            await new Promise(r => setTimeout(r, 600000));
                                        }
                                        account.withdrawStatus = 'completed';
                                        account.withdrawAmount = withdrawResult.withdrawAmount;
                                        account.withdrawAddress = withdrawResult.toAddress;
                                    } else {
                                        console.log(`\n❌ Автоматический вывод не удался: ${withdrawResult.error}`);
                                        console.log(`   Баланс для ручного вывода: ${settledBalance.toFixed(2)} USDT`);
                                        account.withdrawStatus = 'failed';
                                        account.withdrawError = withdrawResult.error;
                                    }
                                } catch (wdErr) {
                                    console.error(`❌ Ошибка вывода: ${wdErr.message}`);
                                    account.withdrawStatus = 'error';
                                    account.withdrawError = wdErr.message;
                                }
                            } else {
                                console.log(`\n❌ Баланс не вернулся за отведенное время — ставка, вероятно, проиграна.`);
                                account.withdrawStatus = 'loss';
                            }
                        }
                    } else {
                        console.log(`⚠️ Нет подходящих вилок.`);
                    }
                }
            }

            // === Обновить запись в accounts.json после вывода ===
            if (account.withdrawStatus) {
                for (let retryWd = 0; retryWd < 5; retryWd++) {
                    try {
                        let saved = [];
                        if (fs.existsSync(dbPath)) {
                            try { saved = JSON.parse(fs.readFileSync(dbPath, 'utf-8')); } catch (_) { }
                        }
                        const idx = saved.findIndex(a => a.id === account.id);
                        if (idx !== -1) {
                            saved[idx] = { ...saved[idx], ...account };
                        } else {
                            saved.push(account);
                        }
                        fs.writeFileSync(dbPath, JSON.stringify(saved, null, 4));
                        console.log(`💾 Аккаунт #${account.id} обновлён (withdraw: ${account.withdrawStatus})`);
                        break;
                    } catch (saveErr) {
                        if (retryWd < 4) await new Promise(r => setTimeout(r, 500));
                    }
                }
            }

            // Задержка перед закрытием если включена галочка
            if (keepOpen && success) {
                console.log(`\n🔍 Браузер остаётся открытым ${keepSeconds} сек...`);
                await new Promise(r => setTimeout(r, keepSeconds * 1000));
                console.log('⏰ Время вышло, закрываю...');
            }

            console.log('Закрываю браузер...');
            try { await bm.browser.close(); } catch (_) { }

            // Освобождаем прокси-порт — его может взять следующий поток
            if (proxyManager && proxyManager.hasProxies && account.proxy) {
                try {
                    const parsedRelease = ProxyManager.parseProxy(account.proxy);
                    if (parsedRelease && parsedRelease.port) {
                        ProxyManager.releaseProxy(parsedRelease.port);
                        console.log(`🔓 Прокси порт ${parsedRelease.port} освобождён`);
                    }
                } catch (relErr) { /* non-critical */ }
            }

            // Сохраняем IP в used_ips.json только при успехе
            if (success && account.regIp) {
                const currentLocale = localeArg || regConfig.locale || 'RU';
                saveUsedIp(account.regIp, currentLocale, account.id);
            }

            if (i < regCount) {
                console.log('\n🔄 Следующий аккаунт...');
            }
        }
    }

    console.log(`\n🏁 ПАКЕТНАЯ РЕГИСТРАЦИЯ ЗАВЕРШЕНА 🏁\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
