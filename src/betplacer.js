'use strict';

/**
 * betplacer.js — Автономная проставка ставок на Pinnacle
 *
 * Алгоритм:
 *  1. Запрос суребетов с API (GET /api/surebets/top15)
 *  2. Фильтрация по мин. прибыли
 *  3. Открытие Chrome-профиля аккаунта (кешированная сессия)
 *  4. Логин если сессия протухла
 *  5. Для КАЖДОГО плеча: ищем купон на сайте → ставим
 *  6. Логирование результата
 */

const puppeteer  = require('puppeteer-core');
const path       = require('path');
const fs         = require('fs');
const https      = require('https');
const http       = require('http');
const { getAccountBalance } = require('./withdrawal'); // надёжное чтение баланса через селектор .balance .total

// ──────────────────────────────────────────────
// CONFIG
// ──────────────────────────────────────────────
const CONFIG_PATH = path.resolve(__dirname, '..', 'config.json');
const config      = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

const BETTING_CONFIG = config.betting || {
    apiBaseUrl:          'http://localhost:8891',        // меняется на IP прокси пинки
    apiToken:            'PinnacleFarmApiSecret2026',
    minProfitPct:        0,                              // мин % прибыли для ставки
    bankrollPct:         1.0,                            // % банкролла на одну вилку (1.0 = 100%)
    roundTo:             1,                              // округление ставки (USDT)
    delayBetweenBetsMs:  [3000, 6000],
    maxRetries:          3,
    screenshotsEnabled:  true,
    headless:            false,
};

const CHROME_PATH    = config.chrome?.executablePath || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PROFILES_DIR   = path.resolve(__dirname, '..', 'profiles');
const SCREENSHOTS_DIR = path.resolve(__dirname, '..', 'screenshots');
const ACCOUNTS_PATH  = path.resolve(__dirname, '..', 'data', 'accounts.json');

// ──────────────────────────────────────────────
// UTILS
// ──────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randDelay([min, max]) {
    return sleep(Math.floor(Math.random() * (max - min + 1)) + min);
}
function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim().replace(',', '.');
    if (!normalized) return null;
    const num = parseFloat(normalized);
    return Number.isFinite(num) ? num : null;
}
function normalizeDisplayedOdds(rawOdds, expectedDecimal = null) {
    const raw = toNumber(rawOdds);
    if (raw === null || raw <= 0) return null;

    const candidates = [
        { decimal: raw, format: 'decimal' },
        { decimal: raw + 1, format: 'hongkong' },
    ];
    const expected = toNumber(expectedDecimal);

    if (expected !== null) {
        candidates.sort((a, b) => Math.abs(a.decimal - expected) - Math.abs(b.decimal - expected));
        return { raw, decimal: candidates[0].decimal, format: candidates[0].format };
    }

    if (raw < 1.01) return { raw, decimal: raw + 1, format: 'hongkong' };
    return { raw, decimal: raw, format: 'decimal' };
}
function parseOddsIdParts(oddsId) {
    const parts = String(oddsId || '').split('|');
    if (parts.length < 6) return null;
    return {
        eventId: parts[0],
        period: parts[1],
        marketType: parts[2],
        subType: parts[3],
        sideCode: parts[4],
        line: parts.slice(5).join('|')
    };
}
function deriveSelectionSuffix(oddsId) {
    const parts = parseOddsIdParts(oddsId);
    if (!parts) return '0';
    const subType = Number(parts.subType);
    if (parts.marketType === '2') return String(subType === 1 ? 1 : 0);
    if (parts.marketType === '3') return String(subType === 4 ? 1 : 0);
    return String(subType === 1 ? 1 : 0);
}
function buildOpenSelectionId(lineId, oddsId) {
    if (!lineId || !oddsId) return null;
    return `${lineId}|${oddsId}|${deriveSelectionSuffix(oddsId)}`;
}
function toBuySelectionId(openSelectionId) {
    const parts = String(openSelectionId || '').split('|');
    if (parts.length < 8) return null;
    if (parts.length >= 9) {
        // API уже вернул 9-частный формат с altLineId:
        // lineId|altLineId|eventId|period|betType|subType|sideCode|line|suffix
        // Используем как есть, только нормализуем значение линии (предпоследний элемент)
        const result = [...parts];
        const lineIdx = result.length - 2;
        if (/^-?\d+(?:\.\d+)?$/.test(result[lineIdx])) {
            result[lineIdx] = Number(result[lineIdx]).toFixed(2);
        }
        return result.join('|');
    }
    // 8-частный: построенный формат без altLineId → вставляем |0|
    const [lineId, eventId, period, marketType, subType, sideCode, line, suffix] = parts;
    const normalizedLine = /^-?\d+(?:\.\d+)?$/.test(line)
        ? Number(line).toFixed(2)
        : line;
    return `${lineId}|0|${eventId}|${period}|${marketType}|${subType}|${sideCode}|${normalizedLine}|${suffix}`;
}
let cachedSelectionHints = null;
function loadSelectionHints() {
    if (cachedSelectionHints) return cachedSelectionHints;
    const hints = new Map();
    const sources = [
        path.resolve(__dirname, '..', 'all_posts.log'),
        path.resolve(__dirname, '..', 'tmp', 'captured-requests')
    ];
    const escapedPairRegex = /\\"oddsId\\":\\"([^"]+)\\"[\s\S]*?\\"selectionId\\":\\"([^"]+)\\"/g;
    const plainPairRegex = /"oddsId":"([^"]+)"[\s\S]*?"selectionId":"([^"]+)"/g;

    const scanText = (text) => {
        if (!text) return;
        for (const rx of [escapedPairRegex, plainPairRegex]) {
            rx.lastIndex = 0;
            let match;
            while ((match = rx.exec(text)) !== null) {
                hints.set(match[1], match[2]);
            }
        }
    };

    for (const source of sources) {
        if (!fs.existsSync(source)) continue;
        const stat = fs.statSync(source);
        if (stat.isDirectory()) {
            for (const entry of fs.readdirSync(source)) {
                const file = path.join(source, entry);
                try { scanText(fs.readFileSync(file, 'utf8')); } catch (_) {}
            }
            continue;
        }
        try { scanText(fs.readFileSync(source, 'utf8')); } catch (_) {}
    }

    cachedSelectionHints = hints;
    return hints;
}
function resolveOpenSelectionId(lineId, oddsId) {
    if (!oddsId) return null;
    const hinted = loadSelectionHints().get(oddsId);
    return hinted || buildOpenSelectionId(lineId, oddsId);
}
function roundDown(val, step) {
    if (!step || step <= 0) return val;
    return Math.floor(val / step) * step;
}
/**
 * Конвертирует oddsId из API формата (sideCode-based) в DOM/betslip формат (subType-based).
 *
 * API:  eventId|period|betType|0|sideCode|line   (sideCode: 1=HOME/OVER, 2=AWAY/UNDER)
 * DOM:  eventId|period|betType|subType|altFlag|line
 *       ML:  subType 0=HOME, 1=AWAY;  altFlag=0
 *       HDP: subType 0=HOME, 1=AWAY;  altFlag=isAlt
 *       OU:  subType 3=OVER, 4=UNDER; altFlag=isAlt
 */
function convertOddsIdForBetslip(apiOddsId, side, isAlt) {
    const parts = String(apiOddsId || '').split('|');
    if (parts.length !== 6) return apiOddsId;
    const [eventId, period, betType, , , line] = parts;
    const altFlag = isAlt ? '1' : '0';

    switch (betType) {
        case '1': // ML
            return `${eventId}|${period}|1|${side === 'HOME' ? '0' : '1'}|0|${line}`;
        case '2': // HDP
            return `${eventId}|${period}|2|${side === 'HOME' ? '0' : '1'}|${altFlag}|${line}`;
        case '3': // OU
            return `${eventId}|${period}|3|${side === 'OVER' ? '3' : '4'}|${altFlag}|${line}`;
        default:
            return apiOddsId;
    }
}

// ──────────────────────────────────────────────
// TEST MODE: 1+1 USDT на плечо. Берётся из config.betting.testEqualStakes.
// По умолчанию true — для продакшена переключить на false в config.json (без правки кода).
// ──────────────────────────────────────────────
const TEST_EQUAL_STAKES = BETTING_CONFIG.testEqualStakes !== false;
const SECOND_LEG_WAIT_MS = 90_000;   // ждём валидную линию для 2-го плеча
const SECOND_LEG_POLL_MS = 3_000;

function oddsIdLine(oddsId) {
    const parts = String(oddsId || '').split('|');
    if (parts.length < 6) return null;
    const v = parseFloat(parts[parts.length - 1]);
    return Number.isFinite(v) ? v : null;
}

// Правило коридора (для справки — ту же логику исполняет inline-код внутри page.evaluate):
//   OU:  OVER L1 + UNDER L2 → нужно L2 ≥ L1;   UNDER L1 + OVER L2 → нужно L2 ≤ L1.
//   HDP: сумма хендикэпов двух плеч ≥ 0 (= арб, > 0 — положительный коридор).
//   ML:  линии нет.

// Арбитражный пересчёт: stake2 = stake1 * odds1 / odds2 (округление вверх до roundTo).
function recalcSecondStake(stake1, odds1, odds2, roundTo) {
    const s1 = Number(stake1), o1 = Number(odds1), o2 = Number(odds2);
    if (!s1 || !o1 || !o2) return null;
    const raw = s1 * o1 / o2;
    const step = roundTo || 0.01;
    return Math.ceil(raw / step) * step;
}

function log(msg)  { console.log(`[BetPlacer] ${new Date().toISOString().slice(11,19)} ${msg}`); }
function warn(msg) { console.warn(`[BetPlacer] ⚠️  ${msg}`); }
function err(msg)  { console.error(`[BetPlacer] ❌ ${msg}`); }

async function screenshot(page, label) {
    if (!BETTING_CONFIG.screenshotsEnabled) return;
    if (!fs.existsSync(SCREENSHOTS_DIR)) fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    const file = path.join(SCREENSHOTS_DIR, `bet_${label}_${Date.now()}.png`);
    try { await page.screenshot({ path: file, fullPage: false }); log(`📸 ${file}`); }
    catch(e) { warn(`Скриншот не удался: ${e.message}`); }
}

// ──────────────────────────────────────────────
// 1. FETCH SUREBETS
// ──────────────────────────────────────────────
async function fetchSurebets(baseUrl) {
    const url = `${baseUrl}/api/surebets/top15?token=${BETTING_CONFIG.apiToken}`;
    log(`📡 Запрос суребетов: ${url}`);
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const req = mod.get(url, { timeout: 10000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const list = Array.isArray(json) ? json : (json.surebets || []);
                    log(`✅ Получено ${list.length} суребет(ов)`);
                    resolve(list);
                } catch(e) {
                    reject(new Error(`JSON parse error: ${e.message}. Body: ${data.slice(0, 200)}`));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('API timeout')); });
    });
}

// ──────────────────────────────────────────────
// 2. CALCULATE STAKES (арбитражное распределение)
// ──────────────────────────────────────────────
/**
 * Арбитражное распределение ставки по плечам.
 *
 * Формула: чтобы выигрыш любого плеча был одинаковым и равным `stakeTotal / invSum`,
 *          каждое плечо получает `stake_i = stakeTotal / (prices_i * invSum)`.
 *
 *   stakeTotal — полная сумма на эту вилку (USDT). Обычно рассчитывается как
 *                bankroll / targetForks в лаунчере и приходит сюда в параметре bankroll.
 *   roundTo    — шаг округления вниз (0.01 по умолчанию).
 *
 * TEST_EQUAL_STAKES (флаг наверху файла) — переопределяет распределение на 1+1
 * USDT для тестовых прогонов. Флипнуть в false для продакшена.
 */
function calcStakes(prices, bankroll, roundTo) {
    const sides = Object.keys(prices);
    const invSum = sides.reduce((s, k) => s + 1 / prices[k], 0);
    const profitPct = (1 / invSum - 1) * 100;
    const step = roundTo && roundTo > 0 ? roundTo : 0.01;

    const stakes = {};
    if (TEST_EQUAL_STAKES) {
        sides.forEach(side => { stakes[side] = 1.0; });
    } else {
        const total = Number(bankroll) > 0 ? Number(bankroll) : 0;
        sides.forEach(side => {
            const raw = total / (prices[side] * invSum);
            stakes[side] = Math.floor(raw / step) * step;
        });
    }
    const totalStake = sides.reduce((s, k) => s + stakes[k], 0);
    return { stakes, profitPct, totalStake, invSum };
}

// ──────────────────────────────────────────────
// 3. BROWSER — открыть профиль
// ──────────────────────────────────────────────
async function launchWithProfile(profileDir, proxy) {
    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--start-maximized',
        '--ignore-certificate-errors'
    ];
    if (proxy) {
        // Поддержка socks5 и http прокси без внешних пакетов
        const proxyStr = proxy.startsWith('socks5://') ? proxy : proxy.replace(/^https?:\/\//, '');
        args.push(`--proxy-server=${proxyStr}`);
    }

    const browser = await puppeteer.launch({
        executablePath: CHROME_PATH,
        headless: BETTING_CONFIG.headless ? 'new' : false,
        userDataDir: profileDir,
        args,
        defaultViewport: null,
    });
    return browser;
}

// Алиас: открыть браузер для аккаунта
async function initBrowser(account) {
    const profileDir = account.profileDir;
    if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
    }
    return launchWithProfile(profileDir, account.proxy);
}

// ──────────────────────────────────────────────
// 4. LOGIN если нужно
// ──────────────────────────────────────────────
async function ensureLoggedIn(page, account) {
    const url = page.url();
    log(`🔗 Текущий URL: ${url.substring(0, 80)}`);

    // Проверяем есть ли признак авторизации
    const isLoggedIn = await page.evaluate(() => {
        // Признаки авторизации на Pinnacle:
        // Если есть инпут password значит мы 100% не залогинены.
        if (document.querySelector('input[type="password"]')) return false;

        const loginBtns = [...document.querySelectorAll('button, a, input[type="submit"]')];
        const hasLoginBtn = loginBtns.some(b => {
            if (b.offsetHeight === 0) return false;
            const t = (b.textContent || b.value || '').toLowerCase().trim();
            return t === 'вход' || t === 'войти' || t === 'log in' || t === 'login' || t === 'sign in' || t === 'join';
        });
        if (hasLoginBtn) return false;

        const isSiteLoaded = document.querySelectorAll('button, a, div').length > 50;
        if (!isSiteLoaded) return false; // Защита от Cloudflare блока или пустой страницы

        const userIndicators = document.querySelectorAll(
            '[class*="balance"], [class*="username"], [class*="user-info"], [class*="header-account"]'
        );
        for (const el of userIndicators) {
            if (el.offsetHeight > 0 && el.textContent.trim()) return true;
        }
        return !hasLoginBtn;
    });

    if (isLoggedIn) {
        log(`✅ Сессия активна для ${account.loginId}`);
        return true;
    }

    log(`🔐 Нужен логин для ${account.loginId} — выполняю вход...`);
    return await performLogin(page, account);
}

async function performLogin(page, account) {
    try {
        // Кликаем кнопку ВХОД
        await page.evaluate(() => {
            const btns = [...document.querySelectorAll('button, a, input[type="submit"]')];
            const loginBtn = btns.find(b => {
                const t = (b.textContent || b.value || b.innerText || '').toLowerCase().trim();
                return t === 'вход' || t === 'log in' || t === 'login' || t === 'sign in';
            });
            if (loginBtn) loginBtn.click();
        });
        await sleep(2500);

        // Ждём появления полей формы
        await page.waitForSelector('input[type="password"]', { timeout: 8000 }).catch(() => {});
        await sleep(500);

        // Заполняем форму логина
        const filled = await page.evaluate((loginId, password) => {
            const inputs = [...document.querySelectorAll('input:not([type="hidden"])')];
            const usernameInput = inputs.find(i =>
                i.type === 'text' || i.type === 'email' ||
                (i.name || '').toLowerCase().includes('user') ||
                (i.id   || '').toLowerCase().includes('user') ||
                (i.placeholder || '').toLowerCase().includes('пользов') ||
                (i.placeholder || '').toLowerCase().includes('user') ||
                (i.placeholder || '').toLowerCase().includes('login') ||
                i.autocomplete === 'username'
            );
            const passwordInput = inputs.find(i => i.type === 'password');

            if (!usernameInput || !passwordInput) return `NO_INPUTS (found ${inputs.length})`;

            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            nativeSetter.call(usernameInput, loginId);
            usernameInput.dispatchEvent(new Event('input',  { bubbles: true }));
            usernameInput.dispatchEvent(new Event('change', { bubbles: true }));

            nativeSetter.call(passwordInput, password);
            passwordInput.dispatchEvent(new Event('input',  { bubbles: true }));
            passwordInput.dispatchEvent(new Event('change', { bubbles: true }));
            return 'OK';
        }, account.loginId, account.password);

        log(`  Форма логина: ${filled}`);
        if (filled !== 'OK') { warn(`Форма не заполнена: ${filled}`); return false; }

        await sleep(600);

        // Submit
        await page.evaluate(() => {
            // Ищем кнопку submit в форме
            const btns = [...document.querySelectorAll('button[type="submit"], input[type="submit"], button')];
            const submitBtn = btns.find(b => {
                if (b.disabled) return false;
                const t = (b.textContent || b.value || '').toLowerCase().trim();
                return t === 'вход' || t === 'войти' || t === 'log in' || t === 'login' ||
                       t === 'sign in' || t === 'submit' || b.type === 'submit';
            });
            if (submitBtn) { submitBtn.click(); return true; }
            return false;
        });

        // Ждём навигации или изменения страницы
        await Promise.race([
            page.waitForNavigation({ timeout: 12000, waitUntil: 'domcontentloaded' }),
            sleep(5000),
        ]).catch(() => {});

        await sleep(2000);

        // Проверяем результат
        const loggedIn = await page.evaluate(() => {
            const btns = [...document.querySelectorAll('button, a')];
            return !btns.some(b => {
                const t = (b.textContent || '').toLowerCase().trim();
                return t === 'вход' || t === 'log in' || t === 'login';
            });
        });

        if (loggedIn) {
            log(`✅ Логин выполнен для ${account.loginId}`);
        } else {
            warn(`Логин мог не пройти — кнопка ВХОД всё ещё видна`);
        }
        return loggedIn;

    } catch(e) {
        err(`Ошибка логина: ${e.message}`);
        return false;
    }
}

// ──────────────────────────────────────────────
// 5. DISMISS POPUPS (условия, 2fa, etc.)
// ──────────────────────────────────────────────
async function dismissPopups(page) {
    const dismissed = await page.evaluate(() => {
        let count = 0;
        const closeTexts = ['не сейчас', 'later', 'закрыть', 'close', 'dismiss', 'no thanks',
                            'продолжить', 'continue', 'accept', 'принять', 'ok'];
        const btns = [...document.querySelectorAll('button, a[role="button"]')];
        for (const btn of btns) {
            if (btn.offsetHeight === 0) continue;
            const t = (btn.textContent || '').toLowerCase().trim();
            if (closeTexts.some(ct => t.includes(ct))) {
                btn.click(); count++;
                break;
            }
        }
        return count;
    });
    if (dismissed > 0) await sleep(1000);
}

// ──────────────────────────────────────────────
// 6. PLACE MULTIPLE BETS (Оба плеча сразу)
// ──────────────────────────────────────────────
async function placeMultipleBets(page, sb, stakesMap) {
    const { eventId, betType, handicap, match } = sb;
    const sides = Object.keys(stakesMap);
    log(`\n  🎯 ${match} | ${sides.join('+')} | ${betType} hdp:${handicap}`);

    const finalResults = {};
    let placedLeg = null; // {side, line, stake, odds} после успеха первого плеча
    const betTypeCode = (() => {
        const t = String(betType || '').toUpperCase();
        if (t === 'OU' || t === 'TOTAL' || t === 'TOTALS') return '3';
        if (t === 'HDP' || t === 'SPREAD' || t === 'AH')   return '2';
        if (t === 'ML' || t === 'MONEYLINE')               return '1';
        return '3';
    })();

    // 1. Переходим на live-страницу нужного спорта (один раз)
    const base = page.url().match(/^(https?:\/\/[^/]+)/)?.[1] || 'https://www.thundercrest65.xyz';
    const sportMap = { football:'soccer', soccer:'soccer', basketball:'basketball', hockey:'hockey', tennis:'tennis', baseball:'baseball', volleyball:'volleyball', esports:'esports' };
    const sport = sportMap[(sb.sport || '').toLowerCase()] || 'basketball';
    const liveUrl = `${base}/en/compact/sports/${sport}/live?lang=en`;

    // Проверяем текущий URL — если уже на нужной странице, не перезагружаем
    const curUrl = page.url();
    if (!curUrl.includes(`/${sport}/live`)) {
        log(`  🌐 Переход: ${liveUrl}`);
        await page.goto(liveUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        await sleep(4000);
    }

    // 2. Проверяем что eventId есть на странице
    const eventOnPage = await page.evaluate((eid) => {
        return [...document.querySelectorAll('[id], [data-id]')].some(el => {
            const id = el.id || el.getAttribute('data-id') || '';
            return id.startsWith(eid + '|') && el.offsetHeight > 0;
        });
    }, String(eventId)).catch(() => false);

    if (!eventOnPage) {
        warn(`  ❌ Event ${eventId} не найден на странице live ${sport}`);
        sides.forEach(s => { finalResults[s] = { success: false, reason: 'event_not_on_page' }; });
        return finalResults;
    }
    log(`  ✅ Event ${eventId} найден на странице`);

    // 3. Ставим плечи последовательно
    let isFirstLeg = true;
    for (const side of sides) {
        log(`\n  --- 🎲 ПЛЕЧО [${side}] ---`);

        // Проверяем не разлогинило ли — закрываем попапы Error / Sign In
        const loggedOut = await page.evaluate(() => {
            const pageText = (document.body?.innerText || '').toLowerCase();
            return pageText.includes('log in to your account') || pageText.includes('sign in') ||
                   pageText.includes('you have been signed out') || pageText.includes('multiple logins') ||
                   !!document.querySelector('input[type="password"]');
        }).catch(() => false);

        if (loggedOut) {
            warn(`  ⚠️ Разлогинило! Закрываем попап и перелогиниваемся...`);
            // Закрываем Error попап
            await page.evaluate(() => {
                const btns = [...document.querySelectorAll('button, a, span, div')]
                    .filter(el => el.offsetHeight > 0);
                const okBtn = btns.find(el => {
                    const t = (el.innerText || '').trim().toLowerCase();
                    return t === 'ok' || t === 'close' || t === '×' || t === '✕';
                });
                if (okBtn) okBtn.click();
            }).catch(() => {});
            await sleep(1500);

            // Перелогиниваемся
            const account = sb._account || null;
            if (account) {
                const relogged = await ensureLoggedIn(page, account);
                if (!relogged) {
                    warn(`  ❌ Не удалось перелогиниться. Прерываем.`);
                    sides.forEach(s => { finalResults[s] = { success: false, reason: 'logged_out' }; });
                    return finalResults;
                }
                log(`  ✅ Перелогинились`);
                // Возвращаемся на live
                await page.goto(`${base}/en/compact/sports/${sport}/live?lang=en`, {
                    waitUntil: 'domcontentloaded', timeout: 20000
                }).catch(() => {});
                await sleep(3000);
            } else {
                warn(`  ❌ Нет данных аккаунта для перелогина. Прерываем.`);
                sides.forEach(s => { finalResults[s] = { success: false, reason: 'logged_out' }; });
                return finalResults;
            }
        }
        const expOdds = toNumber(sb.prices[side]);
        const rawOddsId = sb.oddsIds?.[side] || null;
        const exactOddsId = rawOddsId ? convertOddsIdForBetslip(rawOddsId, side, !!sb.isAlt) : null;
        if (!exactOddsId) {
            warn(`  ❌ [${side}] Нет oddsId`);
            finalResults[side] = { success: false, reason: 'no_odds_id' };
            if (isFirstLeg) break;
            continue;
        }
        if (rawOddsId !== exactOddsId) log(`  🔄 oddsId: ${rawOddsId} → ${exactOddsId}`);

        let legSuccess = false;
        const failedIds = new Set();          // id коэффициентов, на которые клик не открыл слип
        const legDeadline = Date.now() + (isFirstLeg ? 60_000 : SECOND_LEG_WAIT_MS);
        let lastCandidateId = null;           // id последнего кликнутого кандидата (для добавления в failedIds при неудаче)

        // Собираем ID существующих ставок ОДИН РАЗ перед циклом попыток
        await page.evaluate(() => {
            const tab = [...document.querySelectorAll('button, div, a, span')]
                .find(el => el.offsetHeight > 0 && (el.innerText || '').trim().toLowerCase().startsWith('pending bets'));
            if (tab) tab.click();
        }).catch(() => {});
        await sleep(1500);
        const oldBetIds = await page.evaluate(() => {
            const text = (document.querySelector('.LeftSideBarComponent_container, .body-left')?.innerText || '');
            const ids = [];
            const re = /ID[:\s]*(\d{6,})/gi;
            let m;
            while ((m = re.exec(text)) !== null) ids.push(m[1]);
            return [...new Set(ids)];
        }).catch(() => []);
        log(`  📋 Существующие ставки: ${oldBetIds.length} [${oldBetIds.join(', ')}]`);
        // Переключаемся обратно на Bet Slip
        await page.evaluate(() => {
            const tab = [...document.querySelectorAll('button, div, a, span')]
                .find(el => el.offsetHeight > 0 && (el.innerText || '').trim().toLowerCase() === 'bet slip');
            if (tab) tab.click();
        }).catch(() => {});
        await sleep(1000);

        let attempt = 0;
        while (!legSuccess && Date.now() < legDeadline) {
            attempt++;
            if (attempt > 1) {
                log(`  🔄 Попытка ${attempt} (осталось ${Math.round((legDeadline - Date.now())/1000)}с, failed=${failedIds.size})...`);
                await sleep(2000);
            }

            // a) Закрываем попапы (Selection Unavailable, etc.) и очищаем купон
            await page.evaluate(async () => {
                const wait = ms => new Promise(r => setTimeout(r, ms));
                const click = (el) => { if (el && el.offsetHeight > 0) el.click(); };

                // 1. Закрываем попапы — кнопки OK / Close / X
                for (let i = 0; i < 3; i++) {
                    const okBtn = [...document.querySelectorAll('button, a, span, div')]
                        .find(el => {
                            if (!el.offsetHeight) return false;
                            const t = (el.innerText || '').trim().toLowerCase();
                            return t === 'ok' || t === 'close' || t === 'закрыть' || t === '✕' || t === '×';
                        });
                    if (!okBtn) break;
                    click(okBtn);
                    await wait(500);
                }

                // 2. Remove all selections в бетслипе
                const removeAll = document.querySelector('[class*="remove-all"], [class*="clear-all"]');
                if (removeAll && removeAll.offsetHeight > 0) {
                    click(removeAll);
                    await wait(700);
                    // Подтверждение удаления
                    const confirm = [...document.querySelectorAll('button')].find(b =>
                        b.offsetHeight > 0 && ['ok','yes','confirm','удалить'].includes((b.innerText||'').trim().toLowerCase())
                    );
                    click(confirm);
                    await wait(500);
                }

                // 3. Убираем отдельные ставки крестиками
                const xBtns = [...document.querySelectorAll('[class*="remove"], [class*="close"], [aria-label*="emove"]')]
                    .filter(el => {
                        const inSlip = el.closest('[class*="slip"], [class*="sidebar"], .body-left');
                        return inSlip && el.offsetHeight > 0;
                    });
                for (const btn of xBtns) { click(btn); await wait(300); }

                // 4. Снимаем активные коэффициенты (кликаем повторно чтобы деселектнуть)
                const activeOdds = [...document.querySelectorAll('a.odds.active, a.odds.selected, a.odds[class*="active"]')]
                    .filter(el => el.offsetHeight > 0);
                for (const el of activeOdds) { click(el); await wait(300); }
            }).catch(() => {});
            await sleep(500);

            // Проверяем что купон чист
            const slipClean = await page.evaluate(() => {
                const text = (document.querySelector('.LeftSideBarComponent_container, .body-left')?.innerText || '').toLowerCase();
                return text.includes('no bets selected') || (!text.includes('total stake'));
            }).catch(() => false);
            log(`  🧹 Купон: ${slipClean ? 'чист' : 'не удалось очистить'}`);


            // b) Ищем и кликаем нужный коэффициент в DOM
            // Фильтры: совпадение eventId+betType+subType; исключение failedIds;
            // для 2-го плеча — только линии, образующие положительный/нулевой коридор.
            const corridorSpec = placedLeg ? {
                betType: betTypeCode,
                placedSide: placedLeg.side,
                placedLine: placedLeg.line,
                candSide: side,
            } : null;
            const targetLine = oddsIdLine(exactOddsId);
            const clickResult = await page.evaluate((targetOddsId, eid, failedArr, corridor, targetLineVal) => {
                const failed = new Set(failedArr || []);
                const triggerClick = (el) => {
                    const target = el.closest('a, button, td, [role="button"]') || el;
                    target.scrollIntoView({ block: 'center' });
                    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                    target.click();
                };
                const corridorOk = (cL) => {
                    if (!corridor) return true;
                    const pL = Number(corridor.placedLine);
                    const c  = Number(cL);
                    if (!Number.isFinite(pL) || !Number.isFinite(c)) return true;
                    if (corridor.betType === '3') {
                        if (corridor.placedSide === 'OVER'  && corridor.candSide === 'UNDER') return c >= pL;
                        if (corridor.placedSide === 'UNDER' && corridor.candSide === 'OVER')  return c <= pL;
                        return false;
                    }
                    if (corridor.betType === '2') return (pL + c) >= 0;
                    return true;
                };

                const targetParts = targetOddsId.split('|');
                if (targetParts.length < 6) return { found: false, reason: 'bad_format' };
                const [, period, betType, subType] = targetParts;

                // Собираем всех кандидатов — eventId + betType + subType совпадают; возможно ЛЮБОЙ period.
                const all = [...document.querySelectorAll('a.odds, [data-id]')]
                    .map(el => ({ el, id: el.id || el.getAttribute('data-id') || '' }))
                    .filter(({ el, id }) => {
                        if (!id.startsWith(eid + '|') || el.offsetHeight <= 0) return false;
                        if (failed.has(id)) return false;
                        const p = id.split('|');
                        return p.length >= 6 && p[2] === betType && p[3] === subType;
                    });

                // Фильтр по коридору (для 2-го плеча)
                const valid = all.filter(({ id }) => {
                    const p = id.split('|');
                    const line = parseFloat(p[p.length - 1]);
                    return corridorOk(line);
                });

                if (!valid.length) {
                    const available = all.map(({ id }) => id).slice(0, 8);
                    return { found: false, reason: all.length ? 'corridor_wait' : 'not_found', available };
                }

                // Сортировка: сначала совпадение period, потом по близости линии к target.
                const tLine = Number(targetLineVal);
                valid.sort((a, b) => {
                    const pa = a.id.split('|'), pb = b.id.split('|');
                    const periodMatchA = pa[1] === period ? 0 : 1;
                    const periodMatchB = pb[1] === period ? 0 : 1;
                    if (periodMatchA !== periodMatchB) return periodMatchA - periodMatchB;
                    const la = parseFloat(pa[pa.length - 1]);
                    const lb = parseFloat(pb[pb.length - 1]);
                    const da = Number.isFinite(tLine) && Number.isFinite(la) ? Math.abs(la - tLine) : 0;
                    const db = Number.isFinite(tLine) && Number.isFinite(lb) ? Math.abs(lb - tLine) : 0;
                    return da - db;
                });

                const pick = valid[0];
                triggerClick(pick.el);
                return {
                    found: true,
                    id: pick.id,
                    text: pick.el.textContent.trim().slice(0, 30),
                    via: pick.id.split('|')[1] === period ? 'period_match' : 'any_period',
                    total: valid.length,
                };
            }, exactOddsId, String(eventId), [...failedIds], corridorSpec, targetLine).catch(e => ({ found: false, reason: e.message }));

            lastCandidateId = clickResult.id || null;

            if (!clickResult.found) {
                const reason = clickResult.reason;
                if (reason === 'corridor_wait') {
                    // Линия ушла в негативный коридор — ждём пока откроется валидная
                    log(`  ⏳ [${side}] Ждём валидную линию (коридор). Доступные: ${(clickResult.available||[]).join(', ')}`);
                    await sleep(SECOND_LEG_POLL_MS);
                    continue;
                }
                if (reason === 'not_found' && !(clickResult.available?.length)) {
                    // Ивент ушёл со страницы: для 1-го плеча — выход, для 2-го — ждём
                    if (isFirstLeg) {
                        warn(`  ❌ [${side}] Коэффициент не найден, ивент ушёл`);
                        finalResults[side] = { success: false, reason: 'odds_not_found' };
                        break;
                    }
                    warn(`  ⏳ [${side}] Ивент пропал со страницы. Ждём...`);
                    await sleep(SECOND_LEG_POLL_MS);
                    continue;
                }
                // Все кандидаты в failedIds — сбрасываем список и пробуем снова (линия могла перезакрыться)
                if (failedIds.size > 0) {
                    log(`  🔄 [${side}] Все кандидаты в failed (${failedIds.size}). Сбрасываем и ждём...`);
                    failedIds.clear();
                    await sleep(SECOND_LEG_POLL_MS);
                    continue;
                }
                warn(`  ⚠️ [${side}] Коэффициент не найден: ${reason}`);
                await sleep(2000);
                continue;
            }
            log(`  ✅ [${side}] Клик: ${clickResult.id} "${clickResult.text}" (${clickResult.via})`);

            // c) Ждём появления бетслипа (но не "unavailable")
            await sleep(2000);
            const slipReady = await page.waitForFunction(() => {
                const slipText = (document.querySelector('.LeftSideBarComponent_container, .body-left')?.innerText || '').toLowerCase();
                // Если unavailable — не ждём дальше
                if (slipText.includes('currently unavailable') || slipText.includes('selection is currently')) return true;
                return slipText.includes('total stake') && !slipText.includes('no bets selected');
            }, { timeout: 6000, polling: 300 }).then(() => true).catch(() => false);

            // Проверяем не unavailable ли
            const earlyError = await page.evaluate(() => {
                const text = (document.querySelector('.LeftSideBarComponent_container, .body-left')?.innerText || '').toLowerCase();
                return text.includes('currently unavailable') || (text.includes('attention') && text.includes('unavailable'));
            }).catch(() => false);
            if (earlyError) {
                warn(`  ⚠️ [${side}] Selection unavailable после клика. Исключаем ${lastCandidateId} и ищем другой...`);
                if (lastCandidateId) failedIds.add(lastCandidateId);
                await page.evaluate(() => {
                    const x = [...document.querySelectorAll('span, button, a')].find(el =>
                        el.offsetHeight > 0 && ['×','x','✕'].includes((el.innerText||'').trim()) &&
                        el.closest('.body-left, [class*="slip"]'));
                    if (x) x.click();
                    const rm = document.querySelector('[class*="remove-all"]');
                    if (rm && rm.offsetHeight > 0) rm.click();
                }).catch(() => {});
                await sleep(1000);
                continue;
            }

            if (!slipReady) {
                // Закрываем попап ошибки если есть (Selection Unavailable и т.п.)
                await page.evaluate(() => {
                    const okBtn = [...document.querySelectorAll('button, a, span')]
                        .find(el => el.offsetHeight > 0 && ['ok','close','закрыть'].includes((el.innerText||'').trim().toLowerCase()));
                    if (okBtn) okBtn.click();
                }).catch(() => {});
                const slipState = await page.evaluate(() => {
                    return (document.querySelector('.LeftSideBarComponent_container, .body-left')?.innerText || '').toLowerCase().slice(0, 200);
                }).catch(() => '');
                warn(`  ⚠️ [${side}] Бетслип не появился (линия залочена). Исключаем ${lastCandidateId}.`);
                if (lastCandidateId) failedIds.add(lastCandidateId);
                log(`     Состояние: ${slipState.slice(0, 100)}`);
                continue;
            }
            log(`  ✅ [${side}] Бетслип открыт`);

            // c2) Читаем фактический кеф из слипа.
            // Стратегия: ищем точечный селектор (класс содержит odds/price) внутри карточки выбора
            // в бетслипе. Пропускаем поля "total stake", "max win", "risk" — они тоже числа и раньше
            // ложно отлавливались первым regex-совпадением.
            const slipOddsRaw = await page.evaluate(() => {
                const slip = document.querySelector('.LeftSideBarComponent_container, .body-left');
                if (!slip) return null;

                const parseOdds = (t) => {
                    const m = String(t || '').trim().match(/(\d+\.\d{2,3})/);
                    if (!m) return null;
                    const v = parseFloat(m[1]);
                    return (v >= 1.01 && v <= 50) ? v : null;
                };

                // 1) Специализированные селекторы, которые Pinnacle использует для коэфа в карточке бетслипа
                const oddsSelectors = [
                    '[class*="selection"] [class*="odds"]',
                    '[class*="selection"] [class*="price"]',
                    '[class*="betSlipSelection"] [class*="odds"]',
                    '[class*="betslip"] [class*="odds"]',
                    '[class*="SelectionItem"] [class*="odds"]',
                ];
                for (const sel of oddsSelectors) {
                    const el = slip.querySelector(sel);
                    if (el && el.offsetHeight > 0) {
                        const v = parseOdds(el.innerText);
                        if (v) return v;
                    }
                }

                // 2) Fallback: среди строк слипа отбрасываем известные поля "итого" и берём первое валидное число
                const skipKeywords = ['total stake', 'max win', 'risk', 'stake', 'to win', 'amount', 'balance'];
                const lines = (slip.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
                for (const l of lines) {
                    const low = l.toLowerCase();
                    if (skipKeywords.some(k => low.includes(k))) continue;
                    const v = parseOdds(l);
                    if (v) return v;
                }
                return null;
            }).catch(() => null);
            const slipOdds = Number(slipOddsRaw) || null;
            if (slipOdds) log(`  📈 [${side}] Кеф в слипе: ${slipOdds}`);

            let stakeToPlace = Number(stakesMap[side]) || 1;
            if (placedLeg && !TEST_EQUAL_STAKES && slipOdds) {
                const recalc = recalcSecondStake(placedLeg.stake, placedLeg.odds, slipOdds, BETTING_CONFIG.roundTo);
                if (recalc) {
                    log(`  🧮 [${side}] Пересчёт: stake1=${placedLeg.stake}@${placedLeg.odds} × odds2=${slipOdds} → ${recalc}`);
                    stakeToPlace = recalc;
                }
            } else if (placedLeg && TEST_EQUAL_STAKES) {
                log(`  🧪 [${side}] TEST_EQUAL_STAKES=true → stake=${stakeToPlace} (без пересчёта)`);
            }

            // Проверка доступного баланса через селектор `.balance .total` (см. src/withdrawal.js).
            // Надёжнее regex-скана всего DOM: исключает ложные совпадения со стейками / купоном.
            const liveBalance = await getAccountBalance(page).catch(() => null);
            if (liveBalance !== null) {
                log(`  💰 [${side}] Доступный баланс в шапке: ${liveBalance}`);
                if (liveBalance < stakeToPlace - 0.001) {
                    const downgraded = Math.floor(liveBalance * 100) / 100;
                    if (downgraded < 0.5) {
                        err(`  ❌ [${side}] Баланс ${liveBalance} < минимальной ставки.`);
                        finalResults[side] = { success: false, reason: 'balance_too_low', balance: liveBalance };
                        break;
                    }
                    if (placedLeg) {
                        warn(`  ⚠️ [${side}] Баланса ${liveBalance} < нужно ${stakeToPlace}. Понижаем до ${downgraded} (ЧАСТИЧНОЕ покрытие, вилка недопокрыта).`);
                    } else {
                        warn(`  ⚠️ [${side}] Баланса ${liveBalance} < stake ${stakeToPlace} — понижаем до ${downgraded}`);
                    }
                    stakeToPlace = downgraded;
                }
            }

            // Сохраняем линию кликнутого коэфа и сам кеф — понадобятся после accepted
            const clickedLine = clickResult.id ? parseFloat(clickResult.id.split('|').slice(-1)[0]) : null;

            // d) Вводим ставку и жмём Place Bet
            const placeResult = await page.evaluate((stake) => {
                const isVisible = (el) => !!el && el.offsetHeight > 0 && el.offsetWidth > 0;
                const textOf = (el) => (el?.innerText || '').trim().toLowerCase();

                // Accept better odds — нажимаем пока чекбокс не станет checked
                const acceptLabels = [...document.querySelectorAll('input[type="checkbox"], label, span, div')]
                    .filter(el => isVisible(el) && textOf(el).includes('accept better odds'));
                for (const el of acceptLabels) {
                    // Если это чекбокс — проверяем checked
                    if (el.tagName === 'INPUT' && el.type === 'checkbox') {
                        if (!el.checked) el.click();
                    } else {
                        // Ищем input внутри или рядом
                        const cb = el.querySelector('input[type="checkbox"]') ||
                                   el.parentElement?.querySelector('input[type="checkbox"]');
                        if (cb && !cb.checked) {
                            cb.click();
                        } else {
                            el.click(); // fallback — кликаем на лейбл
                        }
                    }
                }

                // Ищем stake input
                const inputs = [...document.querySelectorAll('input')].filter(i => {
                    if (!isVisible(i) || i.readOnly || i.disabled) return false;
                    const cls = (i.className || '').toLowerCase();
                    const ph = (i.placeholder || '').toLowerCase();
                    if (cls.includes('search') || ph.includes('search')) return false;
                    return cls.includes('stake') || ph.includes('stake') || i.type === 'tel';
                });

                if (!inputs.length) return { ok: false, reason: 'no_stake_input' };

                // Вводим сумму
                const input = inputs[0];
                input.focus();
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                if (setter) setter.call(input, String(stake));
                else input.value = String(stake);
                input.dispatchEvent(new InputEvent('input', { bubbles: true, data: String(stake) }));
                input.dispatchEvent(new Event('change', { bubbles: true }));

                return { ok: true, inputFound: true };
            }, Number(stakeToPlace)).catch(e => ({ ok: false, reason: e.message }));

            if (!placeResult.ok) {
                warn(`  ⚠️ [${side}] ${placeResult.reason}`);
                continue;
            }
            log(`  ✅ [${side}] Сумма введена: ${stakeToPlace}`);

            // Проверяем бетслип на ошибки перед Place Bet
            const slipError = await page.evaluate(() => {
                const slipText = (document.querySelector('.LeftSideBarComponent_container, .body-left')?.innerText || '').toLowerCase();
                if (slipText.includes('selection is currently unavailable') || slipText.includes('currently unavailable'))
                    return 'unavailable';
                if (slipText.includes('attention') && slipText.includes('unavailable'))
                    return 'attention_unavailable';
                if (slipText.includes('suspended') || slipText.includes('closed'))
                    return 'suspended';
                // odds have changed — НЕ ошибка, просто нажмём Place Bet повторно
                return null;
            }).catch(() => null);

            if (slipError) {
                warn(`  ⚠️ [${side}] Бетслип ошибка: ${slipError}. Очищаем и retry...`);
                await page.evaluate(() => {
                    const xBtn = [...document.querySelectorAll('[class*="remove"], [class*="close"], span, button')]
                        .find(el => {
                            const t = (el.innerText || '').trim();
                            const inSlip = el.closest('.body-left, .LeftSideBarComponent_container, [class*="slip"]');
                            return inSlip && el.offsetHeight > 0 && (t === '×' || t === 'X' || t === 'x' || t === '✕');
                        });
                    if (xBtn) xBtn.click();
                    const removeAll = document.querySelector('[class*="remove-all"]');
                    if (removeAll && removeAll.offsetHeight > 0) removeAll.click();
                }).catch(() => {});
                await sleep(1000);
                continue;
            }

            // Если odds changed — тикаем Accept Better Odds и жмём Place Bet
            await page.evaluate(() => {
                const slipText = (document.querySelector('.LeftSideBarComponent_container, .body-left')?.innerText || '').toLowerCase();
                if (slipText.includes('odds have changed')) {
                    // Ставим галку Accept Better Odds
                    const checkbox = [...document.querySelectorAll('input[type="checkbox"], label, span, div')]
                        .find(el => {
                            const t = (el.innerText || el.textContent || '').toLowerCase();
                            return el.offsetHeight > 0 && (t.includes('accept better odds') || t.includes('accept'));
                        });
                    if (checkbox) checkbox.click();
                }
            }).catch(() => {});

            // Ждём активации кнопки Place Bet
            await sleep(500);
            const placed = await page.evaluate(() => {
                const textOf = (el) => (el?.innerText || '').trim().toLowerCase();
                const isVisible = (el) => !!el && el.offsetHeight > 0;
                const btn = [...document.querySelectorAll('button, [role="button"]')]
                    .find(el => {
                        const t = textOf(el);
                        return isVisible(el) && !el.disabled &&
                            (t.includes('place 1 bet') || t.includes('place bet') || t === 'place bets');
                    });
                if (!btn) return { clicked: false, reason: 'no_active_button' };
                btn.click();
                return { clicked: true, text: textOf(btn) };
            }).catch(() => ({ clicked: false, reason: 'error' }));

            if (!placed.clicked) {
                warn(`  ⚠️ [${side}] Кнопка Place Bet: ${placed.reason}`);
                continue;
            }
            log(`  ✅ [${side}] Нажали "${placed.text}"`);

            // Детекция ошибки "insufficient funds" / "not enough balance" / etc.
            await sleep(1200);
            const postErr = await page.evaluate(() => {
                const body = (document.body?.innerText || '').toLowerCase();
                const slip = (document.querySelector('.LeftSideBarComponent_container, .body-left')?.innerText || '').toLowerCase();
                const combined = body + '\n' + slip;
                if (/insufficient\s+(funds|balance)/i.test(combined)) return 'insufficient_funds';
                if (/not\s+enough\s+(balance|funds)/i.test(combined)) return 'insufficient_funds';
                if (/exceeds?\s+(?:your\s+)?balance/i.test(combined)) return 'insufficient_funds';
                if (/below\s+minimum/i.test(combined)) return 'below_minimum';
                if (/above\s+maximum/i.test(combined)) return 'above_maximum';
                return null;
            }).catch(() => null);

            if (postErr) {
                err(`  ❌ [${side}] Ошибка от Pinnacle: ${postErr}`);
                // Закрываем попап
                await page.evaluate(() => {
                    const okBtn = [...document.querySelectorAll('button, a, span')]
                        .find(el => el.offsetHeight > 0 && ['ok','close','dismiss'].includes((el.innerText||'').trim().toLowerCase()));
                    if (okBtn) okBtn.click();
                }).catch(() => {});
                if (postErr === 'insufficient_funds' && placedLeg) {
                    finalResults[side] = { success: false, reason: 'insufficient_funds_after_leg1' };
                    break; // вилка разбита, дальше нет смысла
                }
                if (postErr === 'insufficient_funds' && !placedLeg) {
                    finalResults[side] = { success: false, reason: 'insufficient_funds' };
                    break;
                }
                // below_minimum / above_maximum — пробуем следующий коэф
                if (lastCandidateId) failedIds.add(lastCandidateId);
                continue;
            }

            // После Place Bet — если odds changed, тикаем accept и жмём ещё раз (до 3 раз)
            for (let oddsRetry = 0; oddsRetry < 3; oddsRetry++) {
                await sleep(1500);
                const oddsChanged = await page.evaluate(() => {
                    const text = (document.querySelector('.LeftSideBarComponent_container, .body-left')?.innerText || '').toLowerCase();
                    return text.includes('odds have changed');
                }).catch(() => false);

                if (!oddsChanged) break;

                log(`  🔄 [${side}] Odds changed — accept и retry Place Bet (${oddsRetry + 1}/3)`);
                await page.evaluate(() => {
                    const textOf = (el) => (el?.innerText || '').trim().toLowerCase();
                    const isVisible = (el) => !!el && el.offsetHeight > 0;
                    // Accept
                    const cb = [...document.querySelectorAll('input[type="checkbox"], label, span, div')]
                        .find(el => isVisible(el) && textOf(el).includes('accept better odds'));
                    if (cb) cb.click();
                    // Place Bet снова
                    setTimeout(() => {
                        const btn = [...document.querySelectorAll('button, [role="button"]')]
                            .find(el => {
                                const t = textOf(el);
                                return isVisible(el) && !el.disabled &&
                                    (t.includes('place 1 bet') || t.includes('place bet'));
                            });
                        if (btn) btn.click();
                    }, 500);
                }).catch(() => {});
                await sleep(1000);
            }

            // e) Ждём попап "Confirm Bets" и нажимаем OK/CONFIRM
            await sleep(1500);
            const confirmed = await page.evaluate(async () => {
                const wait = ms => new Promise(r => setTimeout(r, ms));
                const textOf = (el) => (el?.innerText || '').trim().toLowerCase();
                const isVisible = (el) => !!el && el.offsetHeight > 0;

                for (let i = 0; i < 10; i++) {
                    // Ищем попап — модалку/оверлей с "confirm" в заголовке
                    const allClickable = [...document.querySelectorAll('button, a, div[role="button"], span[role="button"], input[type="button"], input[type="submit"]')];

                    // 1. Кнопка OK/Confirm в попапе
                    const confirmBtn = allClickable.find(el => {
                        if (!isVisible(el)) return false;
                        const t = textOf(el);
                        // В попапе Confirm Bets кнопка может быть OK, Confirm, Yes
                        return t === 'ok' || t === 'confirm' || t === 'confirm bet' || t === 'confirm bets' ||
                               t === 'yes' || t === 'подтвердить' || t === 'да' ||
                               t.includes('confirm');
                    });

                    // Но не нажимаем CANCEL
                    if (confirmBtn && !textOf(confirmBtn).includes('cancel')) {
                        // Проверяем что это в контексте попапа confirm, а не просто кнопка на странице
                        const inModal = confirmBtn.closest('[class*="modal"], [class*="dialog"], [class*="popup"], [class*="overlay"], [class*="confirm"], [role="dialog"]');
                        const pageHasConfirmPopup = document.body.innerText.toLowerCase().includes('confirm bet');

                        if (inModal || pageHasConfirmPopup) {
                            confirmBtn.click();
                            return { clicked: true, text: textOf(confirmBtn) };
                        }
                    }

                    // 2. Альтернатива — ищем красную/primary кнопку в модалке
                    const modals = document.querySelectorAll('[class*="modal"], [class*="dialog"], [class*="popup"], [class*="overlay"], [class*="confirm"], [role="dialog"]');
                    for (const modal of modals) {
                        if (!isVisible(modal)) continue;
                        const primaryBtn = [...modal.querySelectorAll('button, a, div')]
                            .find(el => {
                                if (!isVisible(el)) return false;
                                const t = textOf(el);
                                const cls = (el.className || '').toLowerCase();
                                // Красная/primary кнопка — не cancel
                                return (cls.includes('primary') || cls.includes('ok') || cls.includes('confirm') ||
                                        cls.includes('action') || cls.includes('submit') || cls.includes('accept')) &&
                                       !t.includes('cancel');
                            });
                        if (primaryBtn) {
                            primaryBtn.click();
                            return { clicked: true, text: textOf(primaryBtn) || 'primary-button' };
                        }
                    }

                    await wait(500);
                }
                return { clicked: false };
            }).catch(() => ({ clicked: false }));

            if (confirmed.clicked) {
                log(`  ✅ [${side}] Подтверждение: "${confirmed.text}"`);
            } else {
                log(`  ℹ️ [${side}] Попап подтверждения не появился (возможно не требуется)`);
            }

            // f) Переключаемся на Pending Bets и ждём Running/Accepted для НОВОЙ ставки
            await sleep(2000);

            const clickTab = async (name) => {
                await page.evaluate((n) => {
                    const tab = [...document.querySelectorAll('button, div, a, span')]
                        .find(el => el.offsetHeight > 0 && (el.innerText || '').trim().toLowerCase().startsWith(n));
                    if (tab) tab.click();
                }, name).catch(() => {});
                await sleep(1500);
            };

            // oldBetIds уже собраны выше (перед Place Bet)
            // Polling Pending Bets до 60 сек
            let betStatus = 'unknown';
            let newBetId = null;
            let acceptedOddsFromPending = null; // фактически принятый кеф — читаем из Pending Bets

            // Ждём появление новой ставки до 5 секунд (10 итераций × 500мс)
            for (let poll = 0; poll < 10; poll++) {
                if (poll > 0) await sleep(500);

                // Закрываем любые попапы (верификация, ошибки и т.д.)
                await page.evaluate(() => {
                    const btns = [...document.querySelectorAll('button, a, span')];
                    const dismiss = btns.find(el => {
                        if (!el.offsetHeight) return false;
                        const t = (el.innerText || '').trim().toLowerCase();
                        return t === 'ok' || t === 'close' || t === 'dismiss' || t === 'later' ||
                               t === 'not now' || t === '×' || t === '✕';
                    });
                    if (dismiss) dismiss.click();
                }).catch(() => {});

                // Переключаемся на Pending Bets (с русскими fallback-вариантами)
                await page.evaluate(() => {
                    const aliases = ['pending bets', 'открытые ставки', 'действующие ставки', 'мои ставки', 'ожидающие ставки'];
                    const tab = [...document.querySelectorAll('button, div, a, span')]
                        .find(el => {
                            if (!el.offsetHeight) return false;
                            const t = (el.innerText || '').trim().toLowerCase();
                            return aliases.some(a => t.startsWith(a) || t === a);
                        });
                    if (tab) tab.click();
                }).catch(() => {});
                await sleep(800);

                // Простой парсинг: собираем ВСЕ ID и текст вокруг них.
                // Дополнительно вытаскиваем фактически принятый коэф (вида @ 1.98 или просто 1.98 рядом со стейком).
                const result = await page.evaluate((oldIds) => {
                    const area = document.querySelector('.LeftSideBarComponent_container, .body-left') || document.body;
                    const fullText = area.innerText || '';

                    // Ищем все ID
                    const allIds = [];
                    const re = /ID[:\s]*(\d{6,})/gi;
                    let m;
                    while ((m = re.exec(fullText)) !== null) allIds.push(m[1]);
                    const uniqueIds = [...new Set(allIds)];

                    // Для каждого ID ищем статус и принятый коэф в окружающем тексте (±200 символов)
                    const bets = uniqueIds.map(id => {
                        const idx = fullText.indexOf(id);
                        const chunk = fullText.slice(Math.max(0, idx - 200), idx + 200);
                        const low = chunk.toLowerCase();
                        let status = 'unknown';
                        if (low.includes('running') || low.includes('в игре') || low.includes('действует')) status = 'running';
                        else if (low.includes('rejected') || low.includes('not accepted') || low.includes('отклонен')) status = 'rejected';
                        else if (low.includes('accepted') || low.includes('принят')) status = 'accepted';
                        else if (low.includes('pending') || low.includes('ожидан')) status = 'pending';

                        // Принятый кеф: приоритет @1.98, иначе первый \d.\d{2,3} в диапазоне [1.01..50]
                        // не являющийся стейком/ставкой/риском.
                        let acceptedOdds = null;
                        const atMatch = chunk.match(/@\s*(\d+\.\d{2,3})/);
                        if (atMatch) {
                            const v = parseFloat(atMatch[1]);
                            if (v >= 1.01 && v <= 50) acceptedOdds = v;
                        }
                        if (!acceptedOdds) {
                            const lines = chunk.split('\n').map(s => s.trim()).filter(Boolean);
                            for (const l of lines) {
                                const lo = l.toLowerCase();
                                if (['stake','risk','win','total','amount','id'].some(k => lo.includes(k))) continue;
                                const mm = l.match(/(\d+\.\d{2,3})/);
                                if (mm) {
                                    const v = parseFloat(mm[1]);
                                    if (v >= 1.01 && v <= 50) { acceptedOdds = v; break; }
                                }
                            }
                        }
                        return { id, status, acceptedOdds };
                    });

                    const newBets = bets.filter(b => !oldIds.includes(b.id));
                    const allSorted = [...bets].sort((a, b) => Number(b.id) - Number(a.id));

                    return {
                        allBets: bets,
                        newBets,
                        newest: allSorted[0] || null,
                        totalIds: uniqueIds.length,
                        snippet: fullText.slice(0, 200)
                    };
                }, oldBetIds).catch(() => ({ allBets: [], newBets: [], newest: null, totalIds: 0, snippet: '' }));

                // Только НОВЫЕ ставки — никаких fallback на newest, иначе засчитаем прошлое плечо
                const ourBet = result.newBets.length > 0 ? result.newBets[0] : null;

                if (ourBet) {
                    if (!newBetId && ourBet.id) {
                        newBetId = ourBet.id;
                        log(`  🆔 [${side}] Ставка ID: ${newBetId}`);
                    }
                    if (!acceptedOddsFromPending && ourBet.acceptedOdds) {
                        acceptedOddsFromPending = ourBet.acceptedOdds;
                    }

                    if (ourBet.status === 'running' || ourBet.status === 'accepted') {
                        betStatus = 'accepted';
                        log(`  ✅ [${side}] ID ${ourBet.id}: Running!`);
                        break;
                    } else if (ourBet.status === 'rejected') {
                        betStatus = 'rejected';
                        log(`  ❌ [${side}] ID ${ourBet.id}: Rejected`);
                        break;
                    } else {
                        if (poll % 2 === 0) log(`  ⏳ [${side}] ID ${ourBet.id}: ${ourBet.status}... (${poll + 1}/10) total=${result.totalIds}`);
                    }
                } else {
                    // Если в Bet Slip пусто (нет "total stake"/"общая ставка") — ставка ушла,
                    // вероятно уже в Pending Bets но мы её не нашли (не та вкладка / язык).
                    // Дополнительно листаем 5 раз ещё с двойной задержкой.
                    const slipEmpty = await page.evaluate(() => {
                        const slipText = (document.querySelector('.LeftSideBarComponent_container, .body-left')?.innerText || '').toLowerCase();
                        return slipText.includes('no bets selected') || slipText.includes('ставки не выбраны') ||
                               (!slipText.includes('total stake') && !slipText.includes('общая ставка') && !slipText.includes('сумма ставки'));
                    }).catch(() => false);
                    if (slipEmpty && poll >= 4) {
                        log(`  📤 [${side}] Купон пуст — ставка ушла в Pending. Завершаем poll раньше.`);
                        break;
                    }
                    if (poll % 3 === 0) {
                        log(`  ⏳ [${side}] Ищу новую ставку... (${poll + 1}/10) ids=${result.totalIds} old=${oldBetIds.length}`);
                        if (result.snippet) log(`     snippet: ${result.snippet.slice(0, 120)}`);
                    }
                }
            }

            log(`  📋 [${side}] Финальный статус: ${betStatus}`);

            if (betStatus === 'accepted') {
                log(`  🎉 [${side}] СТАВКА ПРИНЯТА!`);
                // Приоритет для отчёта: фактически принятый кеф из Pending Bets
                // (точнее slipOdds если сработал Accept Better Odds).
                const acceptedOdds = (acceptedOddsFromPending && Number.isFinite(acceptedOddsFromPending))
                    ? acceptedOddsFromPending
                    : (slipOdds || expOdds);
                finalResults[side] = { success: true, odds: acceptedOdds, stake: stakeToPlace };
                legSuccess = true;
                // Сохраняем данные 1-го плеча для коридорной логики + пересчёта 2-го
                if (isFirstLeg) {
                    placedLeg = {
                        side,
                        line: clickedLine,
                        stake: stakeToPlace,
                        odds: acceptedOdds,
                    };
                    log(`  📝 placedLeg: side=${placedLeg.side} line=${placedLeg.line} odds=${placedLeg.odds} (фактически принятый) stake=${placedLeg.stake}`);
                }
                await screenshot(page, `bet_ok_${side}_${eventId}`);
            } else if (betStatus === 'rejected') {
                warn(`  ❌ [${side}] ОТКЛОНЕНА — исключаем ${lastCandidateId} и пробуем снова`);
                finalResults[side] = { success: false, reason: 'rejected' };
                if (lastCandidateId) failedIds.add(lastCandidateId);
            } else {
                warn(`  ❓ [${side}] Не удалось определить статус (${betStatus})`);
                finalResults[side] = { success: false, reason: 'status_unknown' };
                if (lastCandidateId) failedIds.add(lastCandidateId);
            }

            // Переключаемся на Bet Slip для следующего плеча
            await clickTab('bet slip');
        }

        if (!legSuccess && isFirstLeg) {
            warn(`  ❌ Первое плечо [${side}] не проставилось. Отменяем вилку.`);
            break;
        }
        isFirstLeg = false;
    }

    return finalResults;
}

// ─── Submit ставки ───
async function submitBet(page) {
    await sleep(500);

    try {
        log(`  ⏳ Ожидание активной кнопки Submit: ждем когда откроется линия (до 60 сек)...`);
        
        // Постоянно опрашиваем кнопку. Если линия закрылась, кнопка будет .disabled.
        // Как только Pinnacle откроет линию, класс пропадет, и мы кликнем!
        const clicked = await page.waitForFunction(() => {
            // Клик "Accept Better Odds" перед ставкой
            let checks = [...document.querySelectorAll('span, div, label, button')].filter(el => {
                let t = (el.innerText || '').toLowerCase();
                return (t.includes('accept better odds') || t.includes('принять лучшие') || t === 'accept changes' || t.includes('odds have changed'));
            });
            checks.forEach(c => c.click());

            // Точный Pinnacle селектор
            const exactBtn = document.querySelector('button.place-bet-btn:not(.disabled)');
            if (exactBtn && !exactBtn.disabled && exactBtn.offsetHeight > 0) {
                exactBtn.click();
                return 'place-bet-btn';
            }

            // Fallback по тексту
            const submitTexts = ['place bet', 'place bets', 'place 1 bet', 'place 2 bets', 'place a bet', 'поставить', 'submit',
                                  'подтвердить', 'bet now', 'confirm', 'apply'];
            const btns = [...document.querySelectorAll('button, [role="button"]')];
            for (const btn of btns) {
                if (btn.offsetHeight === 0 || btn.disabled || btn.classList.contains('disabled')) continue;
                const t = (btn.textContent || btn.innerText || '').toLowerCase().trim();
                if (submitTexts.some(st => t.includes(st))) {
                    btn.click();
                    return `text-match:${t}`;
                }
            }
            return false; // Возвращаем false, чтобы waitForFunction продолжал цикл
        }, { timeout: 60000, polling: 500 }).catch(() => null);

        if (!clicked) {
            log(`  ❌ Submit клик: таймаут 60 сек, кнопка так и не активировалась`);
            return { success: false, reason: 'submit_btn_timeout_60s' };
        }
        
        log(`  📌 Submit клик: ${clicked}`);

        await sleep(1500);

        const result = await page.waitForFunction(() => {
            const bodyText = (document.body.innerText || '').toLowerCase();
            
            // --- Авто-клик для Confirm Bets (Pinnacle Confirmation Dialog) ---
            const confirmSignals = ['are you sure you want to risk', 'confirm bets', 'подтвердить ставку', 'confirm bet'];
            const needsConfirm = confirmSignals.some(s => bodyText.includes(s));
            if (needsConfirm) {
                const okBtns = [...document.querySelectorAll('button, a[role="button"]')];
                const btn = okBtns.find(b => (b.innerText || '').toLowerCase().trim() === 'ok' || (b.innerText || '').toLowerCase().trim() === 'confirm');
                if (btn && btn.offsetHeight > 0) {
                    btn.click();
                    // return null to continue polling for the actual result after click!
                    // Очищаем DOM чтобы повторно не кликать
                    btn.remove();
                }
            }
            // -----------------------------------------------------------------

            const successSignals = ['bet placed', 'ставка принята', 'success', 'accepted',
                                     'confirmed', 'bet accepted', 'congratulations', 'ticket'];
            
            // Ищем точное сообщение об ошибке в DOM (всплывающие уведомления/алёрты)
            const errorNodes = [...document.querySelectorAll('.error-message, .error-msg, .alert-danger, .toast-error, [class*="error"], [class*="alert"]')];
            for (const node of errorNodes) {
                const hidden = window.getComputedStyle(node).display === 'none' || node.offsetHeight === 0;
                if (!hidden) {
                    const text = node.innerText.trim();
                    if (text.length > 3) return 'fail: ' + text.replace(/\n/g, ' ');
                }
            }

            const failSignals = ['rejected', 'отклонено', 'error', 'failed', 'insufficient',
                                     'odds changed', 'коэффициент изменился', 'insufficient funds',
                                     'not enough', 'minimum bet'];
            
            if (successSignals.some(s => bodyText.includes(s))) return 'success';
            
            // Если текст прямо из body
            const matchingFail = failSignals.find(s => bodyText.includes(s));
            if (matchingFail) return 'fail: ' + matchingFail;

            return null; // продолжаем polling
        }, { timeout: 5000, polling: 200 }).catch(() => 'unknown (timeout)');

        // Extract value if it is a JSHandle
        const val = typeof result === 'object' && result.jsonValue ? await result.jsonValue() : result;
        log(`  📋 Результат ставки: ${val}`);
        
        return { success: val === 'success' || val.includes('unknown'), reason: val };

    } catch(e) {
        err(`submitBet: ${e.message}`);
        return false;
    }
}

// ──────────────────────────────────────────────
// 7. ГЛАВНАЯ ФУНКЦИЯ — проставить одну вилку
// page передаётся снаружи (из runBettingSession),
// браузер управляется централизованно.
// ──────────────────────────────────────────────
async function placeArbitrageOnAccount(account, sb, bankroll, page, { skipLogin = false } = {}) {
    const prices = sb.prices || {};
    const sides  = Object.keys(prices);
    if (sides.length < 2) { warn(`Недостаточно плеч в суребете ${sb.eventId}`); return null; }

    const { stakes, profitPct, totalStake } = calcStakes(
        prices, bankroll, BETTING_CONFIG.roundTo
    );

    log(`\n${'═'.repeat(60)}`);
    log(`📌 ${sb.match} | ${sb.sport} | ${sb.betType} hdp:${sb.handicap}`);
    log(`   Аккаунт: ${account.loginId} | Профиль: ${account.profileDir}`);
    log(`   Банк: ${bankroll} USDT → Итого ставок: ${totalStake.toFixed(2)} USDT | Прибыль: ${profitPct.toFixed(2)}%`);
    sides.forEach(s => log(`   ${s}: ${stakes[s].toFixed(2)} USDT @ ${prices[s]}`));

    // page передаётся готовым — не открываем свой браузер
    if (!page) {
        err(`placeArbitrageOnAccount: page не передан!`);
        return null;
    }

    try {
        await page.setDefaultTimeout(20000);

        // --- ИНЖЕКЦИЯ ПЕРЕХВАТЧИКА POST-запросов СТАВКИ (один раз) ---
        if (!page._betInterceptorInstalled) {
            await page.setRequestInterception(true);
            page.on('request', req => {
                const url     = req.url();
                const method  = req.method();
                const postData = req.postData();
                if (method === 'POST') {
                    const isBet = postData && (
                        postData.includes('place') || postData.includes('stake') ||
                        postData.includes('amount') || url.includes('bet')
                    );
                    if (isBet) {
                        const payload = { url, method, headers: req.headers(), body: postData };
                        fs.appendFileSync(
                            path.resolve(__dirname, '../all_posts.log'),
                            JSON.stringify(payload, null, 2) + ',\n'
                        );
                        if (postData.includes('stake') || postData.includes('amount') || url.includes('straight')) {
                            fs.writeFileSync(
                                path.resolve(__dirname, '../captured_bet.json'),
                                JSON.stringify(payload, null, 2)
                            );
                        }
                    }
                }
                req.continue();
            });
            page._betInterceptorInstalled = true;
        }
        // ---------------------------------------------------------------

        // Если страница ещё не загружена — навигируем на зеркало
        const currentUrl = page.url();
        if (!currentUrl || currentUrl === 'about:blank' || currentUrl === 'chrome://newtab/') {
            let mirror = 'https://www.quietthunder61.xyz';
            mirror = mirror.replace(/\/ru\/compact/i, '/en/compact');
            log(`🌐 Открываем зеркало: ${mirror}`);
            await page.goto(mirror, { waitUntil: 'domcontentloaded', timeout: 15000 })
                      .catch(e => warn(`Ошибка навигации: ${e.message}`));
            await sleep(3000);
        }

        if (!skipLogin) {
            await dismissPopups(page);
            const loggedInStatus = await ensureLoggedIn(page, account);
            if (!loggedInStatus) {
                warn(`Не удалось авторизоваться в аккаунт ${account.loginId}, прерываем ставку.`);
                return { error: 'login_failed' };
            }
            await dismissPopups(page);
        }

        // ── Принудительно переключаем язык на английский ──
        // (на русском парсинг купона/Pending Bets ломается: "BET SLIP", "Running", "Pending Bets" не находятся)
        try {
            const urlNow = page.url() || '';
            const needEnglish = /\/ru\//i.test(urlNow) || /[?&]lang=(?!en)/i.test(urlNow);
            if (needEnglish) {
                let enUrl = urlNow.replace(/\/ru\//i, '/en/').replace(/([?&])lang=[a-z-]+/i, '$1lang=en');
                if (!/[?&]lang=en/i.test(enUrl)) enUrl += (enUrl.includes('?') ? '&' : '?') + 'lang=en';
                log(`🌐 Переключаем язык на EN: ${enUrl}`);
                await page.goto(enUrl, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(e => warn(`EN-нав: ${e.message}`));
                await sleep(2500);
                await dismissPopups(page).catch(() => {});
            }
        } catch (e) { warn(`Переключение языка: ${e.message}`); }

        // ── Фильтруем нулевые ставки ──
        const validStakes = {};
        sides.forEach(s => { if (stakes[s] > 0) validStakes[s] = stakes[s]; });

        let results = {};
        if (Object.keys(validStakes).length > 0) {
            log(`\n  🎲 Ставим плечи: [${Object.keys(validStakes).join(', ')}]`);
            sb._account = account;
            const multiRes = await placeMultipleBets(page, sb, validStakes);
            // Правильное маппирование результатов по каждому side
            sides.forEach(s => { results[s] = (multiRes && multiRes[s]) ? multiRes[s] : multiRes; });
        }

        return { eventId: sb.eventId, match: sb.match, profitPct, totalStake, results };

    } catch(e) {
        err(`placeArbitrageOnAccount: ${e.message}`);
        await screenshot(page, `error_${sb.eventId}`).catch(() => {});
        return null;
    }
}

// ──────────────────────────────────────────────
// 8. RUNNER — основная точка входа
// ──────────────────────────────────────────────
async function runBettingSession(options = {}) {
    const {
        accountLoginId,    // loginId из accounts.json ИЛИ хардкод
        accountPassword,   // если не в accounts.json
        accountMirror,     // зеркало для входа
        accountProxy,      // прокси для этого аккаунта
        profileOverride,   // путь к профилю (если не из accounts.json)
        apiBaseUrl,        // URL API суребетов
        bankroll,          // сколько USDT ставить (весь баланс)
        minProfitPct,      // мин. % прибыли
        dryRun = false,    // если true — не ставит, только логирует
        _overrideSurebets, // массив вилок из лаунчера (минует API)
        prelaunchedBrowser,
        prelaunchedPage
    } = options;

    log(`\n${'═'.repeat(60)}`);
    log(`🚀 Запуск BetPlacer`);
    log(`   Аккаунт: ${accountLoginId}`);
    log(`   API: ${apiBaseUrl || BETTING_CONFIG.apiBaseUrl}`);
    log(`   Банк: ${bankroll} USDT`);
    log(`   Мин. прибыль: ${minProfitPct ?? BETTING_CONFIG.minProfitPct}%`);
    log(`   Dry-run: ${dryRun}`);
    log(`${'═'.repeat(60)}\n`);

    // ─── Загружаем аккаунт ───
    let account = null;

    // 1. Сначала ищем в config.bettingAccounts (там хранятся profileDir, mirror, bankroll)
    const bettingAccounts = config.bettingAccounts || [];
    account = bettingAccounts.find(a => a.loginId === accountLoginId);
    if (account) {
        log(`📋 Аккаунт из config.bettingAccounts: ${account.loginId}`);
    }

    // 2. Запасной вариант — ищем в data/accounts.json
    if (!account && fs.existsSync(ACCOUNTS_PATH)) {
        const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf-8'));
        account = accounts.find(a => a.loginId === accountLoginId);
        if (account) log(`📋 Аккаунт из accounts.json: ${account.loginId}`);
    }

    // 3. Fallback: хардкод из параметров
    if (!account) {
        account = {
            loginId:    accountLoginId,
            password:   accountPassword,
            mirrorUsed: accountMirror,
            proxy:      accountProxy,
            id:         'manual',
        };
    }

    // Аргументы CLI имеют приоритет над конфигом
    if (accountProxy) account.proxy = accountProxy;
    if (accountMirror) account.mirrorUsed = accountMirror;

    // Определяем профиль Chrome
    account.profileDir = profileOverride
        || account.profileDir
        || (account.id && account.id !== 'manual' ? path.join(PROFILES_DIR, `profile_${account.id}`) : null);

    if (!account.profileDir || !fs.existsSync(account.profileDir)) {
        warn(`Профиль ${account.profileDir} не существует, будет создан новый временный`);
        account.profileDir = path.join(PROFILES_DIR, `profile_bet_temp_${account.loginId}`);
        fs.mkdirSync(account.profileDir, { recursive: true });
    }

    log(`📁 Профиль: ${account.profileDir}`);

    // ─── Получаем суребеты ───
    let surebets;
    if (_overrideSurebets && _overrideSurebets.length > 0) {
        surebets = _overrideSurebets;
        log(`📦 Используем ${surebets.length} вилок из лаунчера (без API-запроса)`);
    } else {
        const apiUrl = apiBaseUrl || BETTING_CONFIG.apiBaseUrl;
        try {
            surebets = await fetchSurebets(apiUrl);
        } catch(e) {
            warn(`Не удалось получить суребеты: ${e.message}`);
            if (dryRun) {
                log('📦 Dry-run: используем демо-данные');
                surebets = DEMO_SUREBETS;
            } else {
                err('API недоступен, ставки отменяются');
                return;
            }
        }
    }

    // ─── Фильтрация ───
    const minPct = -100; // Разрешаем минусовые вилки ради тестов проставки
    const filtered = surebets.filter(sb => {
        if (!(sb.prices && Object.keys(sb.prices).length >= 2)) return false;
        const sides = Object.keys(sb.prices);
        const invSum = sides.reduce((s, k) => s + 1 / sb.prices[k], 0);
        const pct = (1 / invSum - 1) * 100;
        return pct > minPct;
    });

    log(`📊 Отфильтровано: ${filtered.length} суребетов (порог >${minPct}%)`);

    if (!filtered.length) {
        log(`😐 Нет суребетов с прибылью > ${minPct}%. Завершение.`);
        return;
    }

    // Показываем топ-N
    const topN = filtered.slice(0, 15);
    topN.forEach((sb, i) => {
        const sides = Object.keys(sb.prices);
        const invSum = sides.reduce((s, k) => s + 1 / sb.prices[k], 0);
        const pct = (1 / invSum - 1) * 100;
        log(`  ${i+1}. ${sb.match} | ${sb.betType} | profitPct: +${pct.toFixed(2)}%`);
    });

    if (dryRun) {
        log(`\n🔍 DRY-RUN: ставки не ставятся. Запустите с dryRun: false для реальных.`);
        return;
    }

    // ─── Открываем браузер ОДИН РАЗ для всех попыток ───
    let browser = prelaunchedBrowser || null;
    let page    = prelaunchedPage || null;
    let finalResult = null;

    try {
        if (!browser || !page) {
            browser = await initBrowser(account);
            const pages = await browser.pages();
            page = pages[0] || await browser.newPage();
        }

        // Навигация на зеркало — только если страница пустая
        const currentUrl = page.url() || '';
        if (!currentUrl || currentUrl === 'about:blank' || currentUrl === 'chrome://newtab/' || currentUrl.includes('chrome-error')) {
            let mirror = account.mirrorUsed || account.mirrorUrl ||
                           BETTING_CONFIG.defaultMirror || 'https://www.thundercrest65.xyz';
            mirror = mirror.replace(/\/ru\/compact/i, '/en/compact');
            if (!mirror.includes('lang=en')) mirror += (mirror.includes('?') ? '&' : '?') + 'lang=en';
            log(`🌐 Открываем зеркало: ${mirror}`);
            await page.goto(mirror, { waitUntil: 'domcontentloaded', timeout: 15000 })
                      .catch(e => warn(`Навигация: ${e.message}`));
            await sleep(3000);
        }

        // ─── Пробуем вилки по очереди, пока одна не зайдёт ───
        for (const sb of topN) {
            log(`\n${'═'.repeat(60)}`);
            log(`📌 ${sb.match} | ${sb.sport} | ${sb.betType} hdp:${sb.handicap}`);

            finalResult = await placeArbitrageOnAccount(account, sb, bankroll, page, { skipLogin: !!prelaunchedPage });

            if (finalResult && finalResult.error === 'login_failed') {
                 warn('Остановка сессии из-за ошибки логина.');
                 break;
            }

            if (!finalResult || !finalResult.results) continue;

            let allMissingError = true;
            let anySuccess = false;
            let allSuccess = true;

            const resultsValues = Object.values(finalResult.results);
            resultsValues.forEach(r => {
                if (r && r.success) anySuccess = true;
                else allSuccess = false;
                if (r && r.reason && !r.reason.includes('не найден') && !r.reason.includes('not found')) allMissingError = false;
            });

            if (anySuccess) {
                if (allSuccess) {
                    log(`\n🎯 УСПЕШНО! Оба плеча приняты. Завершаем.`);
                } else {
                    // Частичное покрытие — вилка разбита (например 2-е плечо insufficient/rejected)
                    const failed = Object.entries(finalResult.results)
                        .filter(([, r]) => !r?.success)
                        .map(([side, r]) => `${side}:${r?.reason||'fail'}`).join(', ');
                    warn(`\n⚠️ ЧАСТИЧНО: поставлено не все плечи. Провалены: ${failed}. Завершаем.`);
                }
                break;
            }

            if (allMissingError) {
                warn(`⚠️ Матч "${sb.match}" не найден. Пробуем следующий (браузер остаётся открытым)...`);
            } else {
                warn(`⚠️ Ошибка проставки "${sb.match}". Остановка цикла.`);
                break;
            }
        }
    } finally {
        if (!prelaunchedBrowser && browser && !BETTING_CONFIG.keepBrowserOpen) {
            await browser.close().catch(() => {});
        }
    }

    // ─── Отчёт ───
    log(`\n${'═'.repeat(60)}`);
    if (finalResult) {
        log(`📋 ИТОГ ставки:`);
        log(`   Матч: ${finalResult.match}`);
        log(`   Прибыль: +${finalResult.profitPct.toFixed(2)}%`);
        log(`   Итого поставлено: ${finalResult.totalStake.toFixed(2)} USDT`);
        Object.entries(finalResult.results).forEach(([side, r]) => {
            if (r?.success) {
                log(`   ✅ ${side}: +${r.potentialWin} USDT (ставка ${r.stake} @ ${r.odds})`);
            } else {
                log(`   ❌ ${side}: ОШИБКА — ${r?.reason || 'unknown'}`);
            }
        });
    } else {
        err(`Ставка не выполнена`);
    }
    log(`${'═'.repeat(60)}\n`);

    return finalResult;
}

// ──────────────────────────────────────────────
// DEMO DATA (fallback when API unavailable)
// ──────────────────────────────────────────────
const DEMO_SUREBETS = [
    {
        eventId: 1626892236,
        sport: 'Basketball', league: 'Turkey - Super League Women',
        match: 'Emlak Konut SK vs Galatasaray',
        period: '4', betType: 'HDP', handicap: '0',
        prices: { HOME: 2.23, AWAY: 1.9 },
        elapsed: "1st Quarter - 1'", settleEstimate: 'End of Q4',
    },
    {
        eventId: 1626902189,
        sport: 'Soccer', league: 'Saudi Arabia MOS Cup',
        match: 'Al Nasr vs Al-Ittihad Jeddah',
        period: '0', betType: 'MONEYLINE', handicap: '0',
        prices: { HOME: 2.1, DRAW: 3.4, AWAY: 3.8 },
        elapsed: "35'", settleEstimate: 'Full Time',
    },
];

// ──────────────────────────────────────────────
// EXPORTS
// ──────────────────────────────────────────────
// calcStakesForFork — alias для лаунчера
function calcStakesForFork(stakeTotal, prices) {
    const sides = Object.keys(prices);
    const invSum = sides.reduce((s, k) => s + 1 / prices[k], 0);
    const stakes = {};
    for (const side of sides) {
        stakes[side] = Math.floor(stakeTotal / prices[side] / invSum * 100) / 100;
    }
    return stakes;
}

module.exports = { runBettingSession, fetchSurebets, calcStakes, calcStakesForFork, ensureLoggedIn };

// ──────────────────────────────────────────────
// CLI: node src/betplacer.js [apiUrl] [loginId] [password] [bankroll] [--dry]
// ──────────────────────────────────────────────
if (require.main === module) {
    const args = process.argv.slice(2);
    const dryRun    = args.includes('--dry');
    const apiUrl    = args.find(a => a.startsWith('http'));
    const loginId   = args.find(a => !a.startsWith('http') && !a.startsWith('--') && isNaN(Number(a)));
    const password  = args[args.indexOf(loginId) + 1];
    const bankroll  = parseFloat(args.find(a => !isNaN(Number(a)) && Number(a) > 0)) || 100;

    runBettingSession({
        accountLoginId:  loginId  || 'KilometrDyxa',
        accountPassword: password || 'Bipolzrkatyt&232',
        apiBaseUrl:      apiUrl   || BETTING_CONFIG.apiBaseUrl,
        bankroll,
        dryRun,
    }).catch(e => { err(e.message); process.exit(1); });
}
