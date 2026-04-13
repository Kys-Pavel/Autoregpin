/**
 * affiliate-scan.js v2.1 — Параллельный перебор affiliate ID
 *
 * --from  00000000   начало диапазона (8 цифр)
 * --to    00000100   конец диапазона
 * --locale RU|UA     (опционально)
 * --no-proxy         без прокси
 * --threads N        количество параллельных Chrome (по умолчанию 1)
 */

'use strict';

const { generateAccount } = require('../src/data-generator');
const { solveCaptcha } = require('../src/captcha-solver');
const { BrowserManager } = require('../src/browser');
const ProxyManager = require('../src/proxy');
const configPath = require('path').resolve(__dirname, '../config.json');
const path = require('path');
const fs = require('fs');
const https = require('https');

// === Лог проверенных ID ===
const checkedLogFile = path.resolve(__dirname, '../data/scan-checked.jsonl');
function logChecked(affiliateId, result, reason) {
    try {
        const line = JSON.stringify({ id: affiliateId, result, reason, ts: new Date().toISOString() });
        fs.appendFileSync(checkedLogFile, line + '\n');
    } catch (_) { }
}

function loadConfig() {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

// === TG ===
const TG_BOT_TOKEN = '7743043481:AAHe-6C2Pc3eQfytCWHZVgkcQdbJv5Nm7UA';
const TG_CHAT_ID = '-5218110329';

function sendTG(html) {
    const body = JSON.stringify({ chat_id: TG_CHAT_ID, text: html, parse_mode: 'HTML' });
    return new Promise((resolve) => {
        const req = https.request({
            hostname: 'api.telegram.org',
            path: `/bot${TG_BOT_TOKEN}/sendMessage`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, (res) => { res.resume(); resolve(); });
        req.on('error', () => resolve());
        req.write(body);
        req.end();
    });
}

// === Аргументы ===
const args = process.argv.slice(2);
function getArg(flag, def) {
    const i = args.indexOf(flag);
    return (i !== -1 && args[i + 1]) ? args[i + 1] : def;
}

const fromStr = getArg('--from', '00000000');
const toStr = getArg('--to', '00000001');
const localeArg = getArg('--locale', null);
const urlArg = getArg('--url', null);   // фиксированный URL зеркала
const noProxy = args.includes('--no-proxy');
const THREADS = Math.min(Math.max(parseInt(getArg('--threads', '15'), 10) || 15, 1), 30);

const fromNum = parseInt(fromStr, 10);
const toNum = parseInt(toStr, 10);

if (isNaN(fromNum) || isNaN(toNum) || fromNum > toNum) {
    console.error(`❌ Неверный диапазон: ${fromStr}–${toStr}`);
    process.exit(1);
}

// === Быстрое заполнение формы через JS ===
async function fastFillForm(page, account, S) {
    const set = (sel, val) => page.evaluate((s, v) => {
        const el = document.querySelector(s);
        if (!el) return;
        const nativeSetter = Object.getOwnPropertyDescriptor(
            el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value'
        )?.set;
        if (nativeSetter) nativeSetter.call(el, v);
        else el.value = v;
        ['input', 'change', 'blur'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
    }, sel, val);

    const click = (sel) => page.evaluate(s => {
        const el = document.querySelector(s);
        if (el) el.click();
    }, sel);

    await set(S.title, account.title || 'MR');
    await set(S.firstName, account.firstName);
    await set(S.lastName, account.lastName);
    await set(S.loginId, account.loginId);
    await set(S.password, account.password);
    await set(S.confirmPassword, account.password);
    await set(S.country, account.country || 'RU');
    await new Promise(r => setTimeout(r, 300));
    await set(S.county, account.county || '');
    await set(S.postcode, account.postcode || '');
    await set(S.address, account.address || '');
    await set(S.city, account.city || '');
    await set(S.email, account.email);

    // Телефон — кастомный masked input, нужны реальные keyboard events
    await page.evaluate(s => {
        const el = document.querySelector(s);
        if (el) { el.value = ''; el.focus(); }
    }, S.contactNum);
    if (account.contactNum) {
        await page.type(S.contactNum, account.contactNum, { delay: 20 });
    }


    const [y, m, d] = (account.birthDate || '1990-01-01').split('-');
    await page.evaluate((sel, iso, dStr) => {
        const el = document.querySelector(sel);
        if (!el) return;
        const val = el.type === 'date' ? iso : dStr;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (setter) setter.call(el, val);
        else el.value = val;
        ['input', 'change', 'blur'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
    }, S.dob, `${y}-${m}-${d}`, `${d}-${m}-${y}`);

    await click(account.gender === 'female' ? S.genderFemale : S.genderMale);
    await set(S.currency, account.currency || 'RUB');

    await page.evaluate(sel => {
        const el = document.querySelector(sel);
        if (!el) return;
        const opt = [...el.options].find(o => o.value && o.value !== '');
        if (opt) {
            const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
            if (setter) setter.call(el, opt.value);
            else el.value = opt.value;
            ['change', 'blur'].forEach(t => el.dispatchEvent(new Event(t, { bubbles: true })));
        }
    }, S.securityQns);
    await new Promise(r => setTimeout(r, 200));
    await set(S.securityAns, account.securityAnswer || 'Answer1');

    await page.evaluate(() => {
        const cb = document.getElementById('agreeRule');
        if (!cb) return;
        if (cb.checked) return;
        const lbl = document.querySelector('label[for="agreeRule"]');
        if (lbl) lbl.click();
        else cb.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // === Капча решается ТОЛЬКО после submit — не здесь ===
}

// === URL регистрации с affiliate (берём origin зеркала + /ru/register) ===
function getRegistrationUrl(refCode) {
    const cfg = loadConfig();
    const registerPath = (cfg.selectors && cfg.selectors.registerPath) || '/ru/register';
    // --url фиксирует конкретный домен
    if (urlArg) {
        try {
            const origin = new URL(urlArg).origin;
            return `${origin}${registerPath}?a=A6${refCode}`;
        } catch (e) { /* fallthrough */ }
    }
    const mirrors = cfg.registration.mirrors || [];
    const valid = mirrors.filter(m => !m.includes('pinnacle888.com'));
    const pool = valid.length > 0 ? valid : mirrors;
    const mirror = pool[Math.floor(Math.random() * pool.length)];
    try {
        const origin = new URL(mirror).origin;
        return `${origin}${registerPath}?a=A6${refCode}`;
    } catch (e) {
        const base = mirror.split('?')[0].split('#')[0];
        return `${base}${registerPath}?a=A6${refCode}`;
    }
}

// === Прогресс ===
const progressFile = path.resolve(__dirname, '../data/affiliate-scan-progress.json');

function saveProgress(data) {
    try { fs.writeFileSync(progressFile, JSON.stringify(data)); } catch (_) { }
}

function loadProgress() {
    try {
        if (fs.existsSync(progressFile)) return JSON.parse(fs.readFileSync(progressFile, 'utf-8'));
    } catch (_) { }
    return null;
}

function clearProgress() {
    try { fs.unlinkSync(progressFile); } catch (_) { }
}

// === Общее состояние (между потоками) ===
const foundIds = [];
const existingEmails = new Set();
let accountIdCounter = 0;
const counterLock = { v: 0 };

function nextAccount(cfg) {
    counterLock.v++;
    return generateAccount(counterLock.v, existingEmails, cfg);
}

// === Поток (один Chrome) ===
async function runThread(threadId, startNum, endNum, proxyManager) {
    const cfg = loadConfig();
    const selectors = cfg.selectors;
    const regConfig = cfg.registration || {};
    if (localeArg) regConfig.countryCode = localeArg.toUpperCase();

    let account = nextAccount(regConfig);
    let bm = null;
    let page = null;

    async function launchBrowser() {
        bm = new BrowserManager(loadConfig().chrome);
        let proxyUrl = null;
        if (!noProxy && proxyManager.hasProxies) {
            const proxy = proxyManager.getProxyForAccount(counterLock.v);
            proxyUrl = proxy.raw;
            console.log(`[T${threadId}] 🌐 Прокси: ${proxy.raw}`);
        } else if (noProxy) {
            console.log(`[T${threadId}] 🔴 Без прокси`);
        }
        const userDataDir = path.resolve(require('os').tmpdir(), `chrome-aff-scan-t${threadId}-${Date.now()}`);
        const result = await bm.launch({ proxyUrl, userDataDir });
        page = result.page;
        // Автоматически принимаем диалог "Закрыть сайт?" при переходе на следующий URL
        page.on('dialog', async dialog => { await dialog.accept().catch(() => { }); });
        page.setDefaultNavigationTimeout(35000);
        console.log(`[T${threadId}] ✅ Chrome запущен`);
    }

    try {
        await launchBrowser();
    } catch (e) {
        console.error(`[T${threadId}] ❌ Не удалось запустить Chrome: ${e.message}`);
        return;
    }

    const total = toNum - fromNum + 1;

    // Утилита: полная очистка сессии (cookies, cache, localStorage, sessionStorage)
    async function clearBrowserData() {
        try {
            const client = await page.target().createCDPSession();
            await client.send('Network.clearBrowserCookies');
            await client.send('Network.clearBrowserCache');
            // Очищаем Storage через CDP — удаляет localStorage, sessionStorage, IndexedDB
            try {
                await client.send('Storage.clearDataForOrigin', {
                    origin: new URL(page.url()).origin,
                    storageTypes: 'all'
                });
            } catch (_) { }
            await client.detach().catch(() => { });
        } catch (_) { }
        // Дополнительно через JS для текущего origin
        await page.evaluate(() => {
            try { localStorage.clear(); } catch (_) { }
            try { sessionStorage.clear(); } catch (_) { }
        }).catch(() => { });
    }

    const MAX_CAPTCHA_ATTEMPTS = 5;
    const CAPTCHA_WAIT_MS = 3000;
    const SUBMIT_WAIT_MS = 4000;

    for (let num = startNum; num <= endNum; num++) {
        const refCode = String(num).padStart(8, '0');
        const affiliateId = `A6${refCode}`;
        const registrationUrl = getRegistrationUrl(refCode);

        console.log(`[T${threadId}] 🔑 [${num - fromNum + 1}/${total}] ${affiliateId}`);

        let success = false;
        let affiliateInvalid = false;

        try {
            // Переходим на форму регистрации с новым affiliate
            console.log(`[T${threadId}] 🔗 ${registrationUrl}`);
            try { await page.goto(registrationUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }); }
            catch (e) { console.warn(`[T${threadId}] ⚠️ goto timeout: ${e.message}`); }

            // Очищаем сессию ПОСЛЕ goto — теперь origin правильный (localStorage/sessionStorage того сайта)
            try {
                const client = await page.target().createCDPSession();
                await client.send('Network.clearBrowserCookies');
                await client.send('Network.clearBrowserCache');
                await client.detach().catch(() => { });
            } catch (_) { }
            await page.evaluate(() => {
                try { localStorage.clear(); } catch (_) { }
                try { sessionStorage.clear(); } catch (_) { }
            }).catch(() => { });

            // Перезагружаем страницу — SPA теперь не восстановит сессию из storage
            try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }); }
            catch (e) { console.warn(`[T${threadId}] ⚠️ reload timeout: ${e.message}`); }
            await new Promise(r => setTimeout(r, 1000));

            const hasForm = await page.$('#firstName').catch(() => null);
            if (!hasForm) {
                console.log(`[T${threadId}] ⚠️ Форма не загружена → следующий`);
                affiliateInvalid = true;
            } else {
                // Быстрое заполнение
                await fastFillForm(page, account, selectors);
                console.log(`[T${threadId}] ⚡ Форма заполнена`);

                // Сабмит + до MAX_CAPTCHA_ATTEMPTS попыток решить капчу
                let captchaAttempts = 0;
                let submitted = false;
                let prevCaptchaCode = null; // для детектора «капча не меняется = invalid»
                let sameCaptchaCount = 0;

                while (!submitted && captchaAttempts <= MAX_CAPTCHA_ATTEMPTS) {
                    // Запоминаем src + naturalWidth капчи ДО submit — для детектирования обновления
                    const captchaSrcBefore = await page.evaluate(() => {
                        const container = document.querySelector('.load-captcha');
                        if (!container) return '';
                        const img = container.querySelector('img');
                        if (img && img.naturalWidth > 0) return img.src || img.currentSrc || '';
                        // Если canvas — используем timestamp как маркер (canvas нельзя idентифицировать стабильно)
                        const canvas = container.querySelector('canvas');
                        return canvas ? `canvas:${canvas.width}x${canvas.height}:${Date.now()}` : '';
                    }).catch(() => '');

                    // JS-клик обходит overlay "Node is not clickable" от puppeteer
                    const clicked = await page.evaluate(sel => {
                        const el = document.querySelector(sel);
                        if (!el) return false;
                        el.scrollIntoView({ block: 'center' });
                        el.click();
                        return true;
                    }, selectors.submitButton);
                    if (!clicked) {
                        console.log(`[T${threadId}] ⚠️ Submit-кнопка не найдена → следующий ID`);
                        affiliateInvalid = true;
                        submitted = true;
                        break;
                    }

                    // Ждём пока URL уйдёт со страницы /register (ловит SPA history.pushState тоже)
                    await Promise.race([
                        page.waitForFunction(
                            () => !window.location.href.includes('/register'),
                            { timeout: 6000, polling: 200 }
                        ).catch(() => { }),
                        new Promise(r => setTimeout(r, SUBMIT_WAIT_MS))
                    ]);

                    // Если URL ушёл с /register — ждём загрузки страницы аккаунта
                    const midUrl = page.url();
                    if (!midUrl.includes('/register')) {
                        await page.waitForFunction(
                            () => document.readyState === 'complete',
                            { timeout: 5000 }
                        ).catch(() => { });
                        await new Promise(r => setTimeout(r, 2000)); // SPA доотрисовка
                    }

                    const pageUrl = page.url();
                    const pageContent = await page.content();
                    console.log(`[T${threadId}] 🔎 URL после submit: ${pageUrl.split('?')[0].slice(-60)}`);

                    // Проверка успеха: URL содержит /account + элементы аккаунта загружены
                    const wasOnRegister = registrationUrl.includes('/register');
                    const nowOnRegister = pageUrl.includes('/register');
                    const urlIsAccount = pageUrl.includes('/account'); // строгая проверка


                    // Элементы аккаунта на странице — проверяем только если URL похож на аккаунт
                    const hasAccountElements = urlIsAccount ? await page.evaluate(() => {
                        const text = document.body ? document.body.innerText : '';
                        // Диагностика: что на странице
                        const snippet = text.slice(0, 300).replace(/\s+/g, ' ');
                        console._acctSnippet = snippet; // сохраним для лога
                        // Проверяем признаки аккаунта
                        const hasDeposit = /deposit|депозит|пополни/i.test(text);
                        const hasBalance = !!(
                            document.querySelector('[class*="balance"], [class*="Balance"]') ||
                            document.querySelector('[class*="wallet"], [class*="Wallet"]') ||
                            document.querySelector('[class*="amount"], [class*="Amount"]')
                        );
                        const hasLogout = /logout|выйти|sign.?out|выход/i.test(text);
                        const hasAvatar = !!(document.querySelector('[class*="avatar"], [class*="Avatar"], [class*="user-menu"], [class*="UserMenu"], [class*="profile"]'));
                        const hasWithdraw = /withdraw|вывод|снять/i.test(text);
                        // Если страница вообще не пустая и URL /account — считаем успехом
                        const pageNotEmpty = text.trim().length > 100;
                        return hasDeposit || hasBalance || hasLogout || hasAvatar || hasWithdraw || pageNotEmpty;
                    }).catch(() => false) : false;

                    if (urlIsAccount) {
                        const snippet = await page.evaluate(() => (document.body?.innerText || '').slice(0, 200).replace(/\s+/g, ' ')).catch(() => '');
                        console.log(`[T${threadId}] 📄 Страница аккаунта: "${snippet}"`);
                    }


                    const isSuccess = (urlIsAccount && hasAccountElements) ||
                        pageUrl.includes('/success') ||
                        pageContent.includes('Registration Completed') ||
                        pageContent.includes('Регистрация завершена') ||
                        pageContent.includes('successfully registered') ||
                        pageContent.includes('успешно зарегистрирован');

                    console.log(`[T${threadId}] 🔎 URL: ${pageUrl.slice(-80)} | success=${isSuccess} (acct=${hasAccountElements})`);


                    if (isSuccess) {
                        console.log(`[T${threadId}] 🎉 УСПЕХ! ${affiliateId}`);
                        success = true;
                        submitted = true;
                        break;
                    }

                    // Ошибки формы
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
                        const errText = pageErrors.join(' | ');
                        const isAffiliateError = /affiliate|partner|код партнёра|недействительн|invalid.*code|code.*invalid/i.test(errText);
                        const isCaptchaError = /captcha|верн|код подтвержд/i.test(errText);
                        const isFillError = /обязательно|required|mandatory/i.test(errText);
                        const isLoginDuplicate = /имя для входа.*уже|login.*already|already.*taken|username.*taken|уже используется|уже занято/i.test(errText);

                        if (isAffiliateError) {
                            console.log(`[T${threadId}] 🚫 Affiliate invalid: ${errText}`);
                            affiliateInvalid = true;
                            submitted = true;
                            break;
                        } else if (isLoginDuplicate) {
                            // Логин занят — генерируем новый account и переполняем форму
                            console.log(`[T${threadId}] 🔄 Логин занят: ${errText} → новый аккаунт`);
                            account = nextAccount(regConfig);
                            await fastFillForm(page, account, selectors);
                            console.log(`[T${threadId}] ⚡ Форма перезаполнена`);
                            // Не прерываем цикл — идём на следующий submit
                        } else if (isCaptchaError) {
                            // Капча неверна — продолжаем цикл (не считаем affiliate invalid)
                            console.log(`[T${threadId}] 🔁 Капча неверна (сайт): ${errText}`);
                        } else if (isFillError) {
                            console.log(`[T${threadId}] ⚠️ Поле не заполнено: ${errText}`);
                            affiliateInvalid = true;
                            submitted = true;
                            break;
                        } else {
                            // Неизвестная ошибка — логируем и идём дальше (не прерываем)
                            console.log(`[T${threadId}] ⚠️ Ошибка формы (неизвестная): ${errText}`);
                        }
                    } else {
                        console.log(`[T${threadId}] ℹ️ Нет видимых ошибок формы`);
                    }

                    // Капча?
                    const visibleCaptcha = await page.evaluate(() => {
                        const c = document.querySelector('#captcha');
                        if (!c) return false;
                        const style = window.getComputedStyle(c);
                        return style && style.display !== 'none' && style.visibility !== 'hidden';
                    });

                    if (!visibleCaptcha) {
                        console.log(`[T${threadId}] ⚠️ Нет ошибок/успеха/капчи → следующий`);
                        affiliateInvalid = true;
                        submitted = true;
                        break;
                    }

                    captchaAttempts++;
                    if (captchaAttempts > MAX_CAPTCHA_ATTEMPTS) {
                        console.log(`[T${threadId}] ⛔ Исчерпаны все ${MAX_CAPTCHA_ATTEMPTS} попыток капчи → следующий ID`);
                        affiliateInvalid = true;
                        submitted = true;
                        break;
                    }

                    console.log(`[T${threadId}] 🧩 Капча (попытка ${captchaAttempts}/${MAX_CAPTCHA_ATTEMPTS}) — жду обновления...`);

                    // Ждём пока img.src капчи изменится — captcha-solver.js использует .load-captcha img
                    if (captchaSrcBefore && !captchaSrcBefore.startsWith('canvas:')) {
                        // img.src: ждём другого URL
                        await page.waitForFunction(
                            (oldSrc) => {
                                const container = document.querySelector('.load-captcha');
                                if (!container) return true; // нет капчи — редирект
                                const img = container.querySelector('img');
                                if (!img) return true;
                                const newSrc = img.src || img.currentSrc || '';
                                return newSrc !== oldSrc && newSrc.length > 0 && img.naturalWidth > 0;
                            },
                            { timeout: 8000, polling: 100 },
                            captchaSrcBefore
                        ).catch(() => { });
                        console.log(`[T${threadId}] 🔄 Капча (img.src) обновилась — решаю`);
                    } else {
                        // canvas: ждём фиксированную паузу (нельзя сравнивать toDataURL через CORS)
                        await new Promise(r => setTimeout(r, 1500));
                        console.log(`[T${threadId}] ⏱️ Капча (canvas) — пауза 1.5s — решаю`);
                    }



                    const captchaCode = await solveCaptcha(page, cfg.gemini.apiKey, cfg.gemini.proxy || null, cfg.gemini.model || 'gemini-2.5-flash').catch(e => {
                        console.warn(`[T${threadId}] ⚠️ Капча не решена: ${e.message}`);
                        return null;
                    });

                    if (!captchaCode) {
                        console.log(`[T${threadId}] ⚠️ Gemini не дал ответ (попытка ${captchaAttempts}/${MAX_CAPTCHA_ATTEMPTS})`);
                        if (captchaAttempts >= MAX_CAPTCHA_ATTEMPTS) {
                            console.log(`[T${threadId}] ⛔ Исчерпаны попытки капчи → следующий ID`);
                            affiliateInvalid = true;
                            submitted = true;
                        }
                        continue;
                    }

                    // Детектор: капча не меняется = affiliate невалидный
                    if (captchaCode === prevCaptchaCode) {
                        sameCaptchaCount++;
                        if (sameCaptchaCount >= 2) {
                            console.log(`[T${threadId}] 🚫 Капча не меняется (${captchaCode}) → affiliate невалидный`);
                            affiliateInvalid = true;
                            submitted = true;
                            break;
                        }
                    } else {
                        sameCaptchaCount = 0;
                    }
                    prevCaptchaCode = captchaCode;

                    // Вводим код: сначала фокус + clear, потом page.type (симулирует нажатия клавиш)
                    await page.click(selectors.captcha).catch(() => { });
                    await page.keyboard.down('Control');
                    await page.keyboard.press('a');
                    await page.keyboard.up('Control');
                    await page.keyboard.press('Delete');
                    await page.type(selectors.captcha, captchaCode, { delay: 40 });
                    console.log(`[T${threadId}] 🧩 Капча введена: ${captchaCode} (попытка ${captchaAttempts}/${MAX_CAPTCHA_ATTEMPTS})`);
                    // Снова submit в начале следующей итерации
                }
            }
        } catch (err) {
            // Проверяем — возможно мы уже на странице аккаунта (редирект прошёл)
            const currentUrl = page.url();
            // Строго: только /account URL засчитывается как успех в catch
            if (currentUrl.includes('/account')) {
                console.log(`[T${threadId}] 🎉 УСПЕХ (через catch)! ${affiliateId} → ${currentUrl.slice(-60)}`);
                success = true;
            } else {
                console.error(`[T${threadId}] ❌ ${err.message}`);
                const isCrash = err.message.includes('disconnected') ||
                    err.message.includes('Target closed') ||
                    err.message.includes('Session closed') ||
                    err.message.includes('detached Frame') ||
                    err.message.includes('detached');
                if (isCrash) {
                    console.log(`[T${threadId}] 🔄 Chrome упал (${err.message.slice(0, 60)}), перезапускаю...`);
                    try { await bm.browser.close(); } catch (_) { }
                    await new Promise(r => setTimeout(r, 2000));
                    try { await launchBrowser(); } catch (_) { }
                }
                logChecked(affiliateId, 'error', err.message.slice(0, 120));
                affiliateInvalid = true;
            }
        }

        // Результат
        if (success) {
            foundIds.push(affiliateId);
            logChecked(affiliateId, 'success', `login:${account.loginId}`);
            await sendTG(
                `🎯 <b>Рабочий affiliate ID!</b>\n\n` +
                `🔑 <code>${affiliateId}</code>\n` +
                `🔗 ${registrationUrl.split('?')[0]}\n\n` +
                `👤 Логин: <code>${account.loginId}</code>\n` +
                `🔒 Пароль: <code>${account.password}</code>\n` +
                `📧 Email: <code>${account.email}</code>`
            );
            // Новый аккаунт для следующего ID
            account = nextAccount(regConfig);

            // Перезапускаем Chrome с чистым профилем — единственный надёжный способ стереть сессию
            console.log(`[T${threadId}] 🔄 Перезапуск Chrome (чистый профиль) после успеха...`);
            try { await bm.browser.close(); } catch (_) { }
            await new Promise(r => setTimeout(r, 1500));
            try { await launchBrowser(); } catch (e) {
                console.error(`[T${threadId}] ❌ Не удалось перезапустить Chrome: ${e.message}`);
                break;
            }
        } else if (affiliateInvalid) {
            logChecked(affiliateId, 'invalid', 'affiliate not found or form error');
        }
    }

    // Закрываем Chrome потока
    try { await bm.browser.close(); } catch (_) { }
    console.log(`[T${threadId}] 🏁 Поток завершён`);
}

// === Основной запуск ===
(async () => {
    const total = toNum - fromNum + 1;
    const localeToUse = localeArg || loadConfig().registration?.locale || 'RU';

    console.log(`\n${'='.repeat(55)}`);
    console.log(`🔍 ПЕРЕБОР: A6${fromStr} → A6${toStr} (${total} ID, потоков: ${THREADS})`);
    console.log(`${'='.repeat(55)}\n`);

    await sendTG(
        `🔍 <b>Запущен перебор affiliate ID</b>\n` +
        `📊 <code>A6${fromStr}</code> – <code>A6${toStr}</code> (${total} шт, ${THREADS} потоков)`
    );

    // Проверяем прогресс
    let threadStarts = null;
    const saved = loadProgress();
    if (saved && saved.from === fromNum && saved.to === toNum && Array.isArray(saved.threads)) {
        threadStarts = saved.threads;
        console.log(`📂 Восстановление прогресса: ${threadStarts.map((s, i) => `T${i}:${s}`).join(', ')}`);
        await sendTG(`📂 <b>Продолжаем перебор с сохранённого прогресса</b>`);
    }

    // Делим диапазон на N потоков
    const chunkSize = Math.ceil(total / THREADS);
    const proxyManager = new ProxyManager(loadConfig().proxy, localeToUse);

    const tasks = [];
    for (let i = 0; i < THREADS; i++) {
        const chunkStart = fromNum + i * chunkSize;
        const chunkEnd = Math.min(chunkStart + chunkSize - 1, toNum);
        if (chunkStart > toNum) break;

        const startFrom = (threadStarts && threadStarts[i] != null) ? Math.max(threadStarts[i], chunkStart) : chunkStart;
        if (startFrom > chunkEnd) {
            console.log(`[T${i}] ✅ Диапазон уже пройден`);
            continue;
        }

        console.log(`[T${i}] Диапазон: A6${String(startFrom).padStart(8, '0')} → A6${String(chunkEnd).padStart(8, '0')}`);
        tasks.push(runThread(i, startFrom, chunkEnd, proxyManager));
    }

    // Периодически сохраняем прогресс (по 30 сек)
    // Простой механизм: каждые 30 сек пишем fromNum/toNum/threads
    const progressInterval = setInterval(() => {
        saveProgress({ from: fromNum, to: toNum, threads: Array(THREADS).fill(null) });
    }, 30000);

    await Promise.all(tasks);
    clearInterval(progressInterval);
    clearProgress();

    // Итоговый отчёт
    console.log(`\n${'='.repeat(55)}`);
    console.log(`📊 ИТОГ: найдено ${foundIds.length} рабочих ID`);
    foundIds.forEach(id => console.log(`  ✅ ${id}`));
    console.log(`${'='.repeat(55)}\n`);

    const list = foundIds.length > 0
        ? foundIds.map(id => `  ✅ <code>${id}</code>`).join('\n')
        : '  ❌ Рабочих не найдено';

    await sendTG(
        `📊 <b>Перебор завершён</b>\n\n` +
        `📋 <code>A6${fromStr}</code> – <code>A6${toStr}</code>\n` +
        `🔢 Проверено: ${total}\n` +
        `🎯 Найдено: <b>${foundIds.length}</b>\n\n` +
        list
    );

    process.exit(0);
})();
