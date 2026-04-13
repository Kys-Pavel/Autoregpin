const logger = require('./logger');
const { BrowserManager } = require('./browser');
const ProxyManager = require('./proxy');
const ProfileManager = require('./profile');
const { loadAccounts, updateAccount } = require('./data-generator');
const { solveCaptcha } = require('./captcha-solver');
const { performDeposit } = require('./depositor');
const config = require('../config.json');

/**
 * Случайная задержка в диапазоне [min, max] мс
 */
async function randomDelay(range) {
    const [min, max] = range;
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await new Promise(r => setTimeout(r, delay));
    return delay;
}

/**
 * Выбор случайного зеркала из списка (исключаем pinnacle888.com — там нет формы)
 */
function getRandomMirror(mirrors) {
    const valid = mirrors.filter(m => !m.includes('pinnacle888.com'));
    if (valid.length === 0) return mirrors[0];
    return valid[Math.floor(Math.random() * valid.length)];
}

/**
 * Резолв прокладки — переход по URL, ожидание редиректов
 */
async function resolveRedirect(page, url, timeoutMs = 60000) {
    logger.info(`Переход: ${url}`);
    try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    } catch (e) {
        logger.warn(`Таймаут загрузки: ${e.message}`);
    }
    // Ждём стабилизации URL (редиректы)
    let lastUrl = page.url();
    for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 1000));
        const currentUrl = page.url();
        if (currentUrl === lastUrl) break;
        lastUrl = currentUrl;
    }
    logger.info(`Итоговый URL: ${lastUrl}`);
    return lastUrl;
}

/**
 * Ввод текста в поле с человекоподобной задержкой
 */
async function humanType(page, selector, text, options = {}) {
    const { clearFirst = true, minDelay = 50, maxDelay = 150 } = options;

    const element = await page.$(selector);
    if (!element) {
        throw new Error(`Элемент не найден: ${selector}`);
    }

    await element.click();
    await new Promise(r => setTimeout(r, 300));

    if (clearFirst) {
        // Ctrl+A, Delete — надёжнее чем el.value = '' для кастомных полей (intl-tel-input)
        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        await new Promise(r => setTimeout(r, 100));
        await page.keyboard.press('Backspace');
        await new Promise(r => setTimeout(r, 400)); // ждём пока intl-input успокоится
    }

    for (const char of text) {
        const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        await page.keyboard.type(char, { delay });
    }
}


/**
 * Генерация ответа на контрольный вопрос по его типу
 */
function getAnswerForQuestion(qVal, qText) {
    const v = (qVal || '').toUpperCase();
    const t = (qText || '').toLowerCase();
    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    if (v.includes('MOTHER') || v.includes('MAMA') || t.includes('мат') || t.includes('мам'))
        return pick(['Anna', 'Maria', 'Elena', 'Natalia', 'Olga', 'Irina', 'Tatiana', 'Svetlana', 'Galina', 'Vera']);
    if (v.includes('MAIDEN') || t.includes('девич'))
        return pick(['Ivanova', 'Petrova', 'Smirnova', 'Kuznetsova', 'Volkova', 'Sokolova', 'Popova']);
    if (v.includes('PET') || v.includes('DOG') || v.includes('CAT') || t.includes('питом') || t.includes('кличк'))
        return pick(['Charlie', 'Buddy', 'Max', 'Rex', 'Bella', 'Luna', 'Barsik', 'Sharik', 'Murzik']);
    if (v.includes('CITY') || v.includes('BORN') || v.includes('HOMETOWN') || t.includes('город') || t.includes('родин'))
        return pick(['Moscow', 'Kiev', 'Kazan', 'Samara', 'Rostov', 'Voronezh', 'Perm', 'Ufa', 'Saratov']);
    if (v.includes('TEACHER') || v.includes('SCHOOL') || t.includes('учит') || t.includes('школ'))
        return pick(['Ivanov', 'Petrov', 'Sokolov', 'Lebedev', 'Kozlov', 'Nikitin', 'Morozov']);
    if (v.includes('SPORT_TEAM') || v.includes('TEAM') || (v.includes('SPORT') && !v.includes('HOBBY')) || t.includes('команд') || t.includes('клуб'))
        return pick(['Spartak', 'CSKA', 'Zenit', 'Lokomotiv', 'Dynamo', 'Rubin', 'Ural']);
    if (v.includes('MOVIE') || v.includes('FILM') || t.includes('фильм') || t.includes('кино'))
        return pick(['Avatar', 'Matrix', 'Titanic', 'Gladiator', 'Inception', 'Interstellar']);
    if (v.includes('HOBBY') || t.includes('хобби') || t.includes('увлечен'))
        return pick(['Fishing', 'Reading', 'Gaming', 'Football', 'Swimming', 'Music', 'Cooking', 'Cycling', 'Boxing']);
    if (v.includes('BOOK') || t.includes('книг'))
        return pick(['Harry Potter', 'War and Peace', 'The Count', 'Dune', 'Foundation', 'Master and Margarita']);
    if (v.includes('FOOD') || v.includes('DISH') || t.includes('еда') || t.includes('блюд'))
        return pick(['Pizza', 'Sushi', 'Borsch', 'Pasta', 'Pelmeni']);
    if (v.includes('FATHER') || v.includes('DAD') || t.includes('отц') || t.includes('папа'))
        return pick(['Ivan', 'Sergei', 'Alexei', 'Dmitry', 'Andrei', 'Mikhail', 'Viktor']);
    if (v.includes('FRIEND') || t.includes('друг'))
        return pick(['Alexei', 'Dmitry', 'Andrei', 'Sergei', 'Pavel', 'Anton']);
    return pick(['Charlie', 'Anna', 'Moscow', 'Football', 'Matrix', 'Ivanova', 'Ivan', 'Max']);
}

/**
 * Проверяет что в поле реально то значение, которое ввели
 */
async function verifyField(page, selector, expected, fieldName) {
    const actual = await page.$eval(selector, el => el.value).catch(() => null);
    if (actual === null) { logger.warn(`verifyField: поле ${fieldName} не найдено`); return false; }
    if (actual !== expected) {
        logger.warn(`⚠️ ${fieldName}: ожидалось "${expected}", в поле "${actual}"`);
        return false;
    }
    logger.info(`✓ ${fieldName} = "${actual}"`);
    return true;
}


/**
 * Заполнение поля даты — работает для type="date" и type="text"
 * @param {Page} page
 * @param {string} selector
 * @param {string} isoDate - формат YYYY-MM-DD
 */
async function fillDateField(page, selector, isoDate) {
    const [year, month, day] = isoDate.split('-');
    const inputType = await page.$eval(selector, el => el.type).catch(() => 'text');

    if (inputType === 'date') {
        // Нативный date input: value должен быть YYYY-MM-DD
        await page.$eval(selector, (el, val) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(el, val);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }, isoDate);
    } else {
        // type="text" — Ctrl+A + Delete для надёжной очистки default value, потом DD-MM-YYYY
        const formatted = `${day}-${month}-${year}`;
        const before = await page.$eval(selector, el => el.value).catch(() => '?');
        logger.info(`Дата в поле ДО ввода: "${before}"`);
        await page.click(selector);
        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        await new Promise(r => setTimeout(r, 100));
        await page.keyboard.press('Delete');
        await new Promise(r => setTimeout(r, 200));
        await page.keyboard.type(formatted, { delay: 80 });
        // Закрываем datepicker если открылся — он перекрывает CAPTCHA на скриншоте!
        await new Promise(r => setTimeout(r, 200));
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 300));
        // Убираем фокус с поля (двойная страховка)
        await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
        await page.$eval(selector, el => {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });
    }

    const actual = await page.$eval(selector, el => el.value).catch(() => '?');
    const expectedFmt = `${day}-${month}-${year}`;
    if (actual !== expectedFmt) {
        logger.warn(`⚠️ Дата в поле: "${actual}" ≠ ожидаемому "${expectedFmt}"`);
    } else {
        logger.info(`✓ Дата введена: "${actual}"`);
    }
}


/**
 * Ожидание и клик по селектору
 */
async function waitAndClick(page, selector, timeoutMs = 10000) {
    await page.waitForSelector(selector, { visible: true, timeout: timeoutMs });
    await page.click(selector);
}

/**
 * Скриншот текущего состояния страницы
 */
async function takeScreenshot(page, accountId, step) {
    const fs = require('fs');
    const path = require('path');
    const screenshotsDir = path.resolve(__dirname, '..', 'screenshots');
    if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    const filename = `acc_${accountId}_${step}_${Date.now()}.png`;
    const filepath = path.join(screenshotsDir, filename);
    try {
        await page.screenshot({ path: filepath, fullPage: false });
        logger.debug(`Скриншот: ${filepath}`);
    } catch (e) {
        logger.warn(`Не удалось сделать скриншот: ${e.message}`);
    }
    return filepath;
}

/**
 * Закрытие баннеров/модалок Pinnacle (техобслуживание, промо и т.д.)
 * Баннер перекрывает форму и мешает заполнению полей
 * Пробует несколько раз с задержкой — баннер может появиться не сразу
 */
async function dismissBanners(page) {
    const MAX_ATTEMPTS = 3;
    const DELAY_BETWEEN = 2000;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const closed = await page.evaluate(() => {
                const results = [];

                // === Способ 1: Поиск по CSS-селекторам ===
                const closeSelectors = [
                    // Кнопка "ЗАКРЫТЬ" в баннере техобслуживания (btn-n-default — реальный класс!)
                    'button.im-button.btn-n-default',
                    'button.im-button.pull-left.btn.btn-n-default',
                    'button.im-button.btn-default',
                    'button.im-button.pull-left.btn.btn-default',
                    // Общие кнопки закрытия модалок
                    '.im-button[data-dismiss]',
                    'button[data-dismiss="modal"]',
                    '.modal .close',
                    '.modal-footer .btn-default',
                    '.modal-footer .btn-n-default',
                    // Pinnacle-специфичные
                    '.hume_footer button',
                    '.maintenance-container button',
                    '.assistance-container button',
                    // Баннеры/нотификации
                    '.notification-close',
                    '.banner-close',
                    '.popup-close',
                    // Intercom / чат-виджеты
                    '.intercom-dismiss',
                    // SalesForce чат
                    '.SalesForceChat button.close',
                ];

                for (const sel of closeSelectors) {
                    try {
                        const buttons = document.querySelectorAll(sel);
                        for (const btn of buttons) {
                            if (btn.offsetHeight > 0 && btn.offsetWidth > 0) {
                                btn.click();
                                results.push(`selector: ${sel}`);
                            }
                        }
                    } catch (_) { }
                }

                // === Способ 2: Поиск ВСЕХ кнопок/ссылок по тексту "Закрыть"/"Close" ===
                const allClickables = document.querySelectorAll('button, a, [role="button"], .btn');
                for (const el of allClickables) {
                    const text = (el.textContent || '').trim();
                    if (el.offsetHeight > 0 && el.offsetWidth > 0) {
                        if (/^(закрыть|close|dismiss|ok|×|x)$/i.test(text)) {
                            // Не кликаем по кнопке закрытия формы регистрации
                            const isFormBtn = el.closest('form') || el.closest('.registration');
                            if (!isFormBtn) {
                                el.click();
                                results.push(`text: "${text}"`);
                            }
                        }
                    }
                }

                // === Способ 3: Удаляем баннер-контейнеры из DOM ===
                const bannerSelectors = [
                    '.hume_footer',
                    '.maintenance-container',
                    '.im-container',
                    '.modal-backdrop',
                    '.overlay',
                    '.im-overlay',
                ];
                for (const sel of bannerSelectors) {
                    try {
                        const els = document.querySelectorAll(sel);
                        for (const el of els) {
                            el.remove();
                            results.push(`removed: ${sel}`);
                        }
                    } catch (_) { }
                }

                return results;
            });

            if (closed.length > 0) {
                logger.info(`🔔 [Попытка ${attempt}] Закрыты баннеры: ${closed.join(', ')}`);
                await new Promise(r => setTimeout(r, 1000)); // Ждём анимацию закрытия
                // Успешно закрыли — выходим
                return;
            }
        } catch (e) {
            logger.warn(`Ошибка при закрытии баннеров (попытка ${attempt}): ${e.message}`);
        }

        // Ждём перед следующей попыткой (баннер может появиться с задержкой)
        if (attempt < MAX_ATTEMPTS) {
            await new Promise(r => setTimeout(r, DELAY_BETWEEN));
        }
    }
}

/**
 * Навигация на страницу регистрации
 * Зеркала ведут на различные домены (rapidwings59.xyz, quietthunder61.xyz и т.д.)
 * Оттуда берём /ru/register
 */
async function navigateToRegistration(page, mirror) {
    const fs = require('fs');
    const path = require('path');
    const configLive = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config.json'), 'utf-8'));

    // Шаг 1: Переходим на зеркало
    const baseUrl = await resolveRedirect(page, mirror);
    await new Promise(r => setTimeout(r, 5000));

    // Зеркало вообще не загрузилось
    if (!baseUrl || baseUrl.startsWith('chrome-error://') || baseUrl.startsWith('about:')) {
        throw new Error(`Зеркало недоступно: ${mirror}. Проверьте URL или смените зеркало.`);
    }

    // Проверяем антибот: /checker/ в URL = точно антибот
    if (baseUrl.includes('/checker/') || baseUrl.includes('/challenge')) {
        throw new Error(`Анти-бот проверка: ${baseUrl}. Смените прокси или зеркало.`);
    }

    // Проверяем IP-редирект только если зеркало было НЕ на IP
    const mirrorIsIp = /^https?:\/\/\d+\.\d+\.\d+\.\d+/.test(mirror);
    const isIpUrl = /^https?:\/\/\d+\.\d+\.\d+\.\d+/.test(baseUrl);
    if (isIpUrl && !mirrorIsIp) {
        throw new Error(`Анти-бот редирект на IP: ${baseUrl}. Сайт обнаружил автоматизацию.`);
    }

    // Шаг 2: Ищем ссылку на /register в DOM
    let registerUrl = await page.evaluate(() => {
        const links = [...document.querySelectorAll('a')];
        for (const a of links) {
            if (a.href && a.href.includes('/register') && !a.href.includes('affiliate')) {
                return a.href;
            }
        }
        return null;
    });

    // Шаг 3: Если не нашли — строим fallback URL из текущего origin
    if (!registerUrl) {
        const currentUrl = page.url();
        if (!currentUrl || currentUrl.startsWith('chrome-error://')) {
            throw new Error(`Зеркало не загружено, fallback невозможен: ${mirror}`);
        }
        const origin = new URL(currentUrl).origin;
        registerUrl = `${origin}${configLive.selectors.registerPath}`;
        logger.warn(`Ссылка /register не найдена, fallback: ${registerUrl}`);
    } else {
        logger.info(`Найден URL регистрации: ${registerUrl}`);
    }

    // Шаг 4: Переходим на страницу регистрации
    try {
        await page.goto(registerUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
        logger.warn(`Таймаут загрузки формы: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 5000));
    const finalUrl = page.url();
    logger.info(`Страница регистрации: ${finalUrl}`);

    // Закрываем баннеры Pinnacle (техобслуживание и прочее)
    await dismissBanners(page);

    // Проверяем на IP-редирект после загрузки формы
    const isIpFinal = /^https?:\/\/\d+\.\d+\.\d+\.\d+/.test(finalUrl);
    if (isIpFinal) {
        throw new Error(`Анти-бот редирект на форме: ${finalUrl}. Смените прокси или повторите позже.`);
    }

    return finalUrl;
}

/**
 * Заполнение формы регистрации
 * Форма одностраничная — все поля на одной странице
 */
async function fillRegistrationForm(page, account, selectors) {
    const S = selectors;

    // Закрываем баннеры если ещё остались (страховка)
    await dismissBanners(page);

    // --- Обращение (title: MR/MRS/MS) ---
    logger.info('Заполняю: обращение (title)');
    await page.select(S.title, account.title);
    await randomDelay([500, 1500]);

    // --- Имя ---
    logger.info('Заполняю: firstName');
    await humanType(page, S.firstName, account.firstName);
    await randomDelay([500, 1500]);

    // --- Фамилия ---
    logger.info('Заполняю: lastName');
    await humanType(page, S.lastName, account.lastName);
    await randomDelay([500, 1500]);

    // --- Логин ---
    logger.info('Заполняю: loginId');
    await humanType(page, S.loginId, account.loginId);
    await randomDelay([500, 1500]);

    // --- Пароль ---
    logger.info('Заполняю: password');
    await humanType(page, S.password, account.password);
    await randomDelay([500, 1000]);

    // --- Подтверждение пароля ---
    logger.info('Заполняю: confirmPassword');
    await humanType(page, S.confirmPassword, account.password);
    await randomDelay([500, 1500]);

    // --- Страна ---
    logger.info(`Заполняю: country = ${account.country}`);
    await page.select(S.country, account.country);
    await randomDelay([1000, 2000]);

    // --- Область/край ---
    const cleanCounty = account.county.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
    logger.info(`Заполняю: county (${cleanCounty})`);
    await humanType(page, S.county, cleanCounty);
    await randomDelay([500, 1000]);

    // --- Почтовый индекс ---
    logger.info('Заполняю: postcode');
    await humanType(page, S.postcode, account.postcode);
    await randomDelay([500, 1000]);

    // --- Адрес ---
    const cleanAddress = account.address.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
    logger.info(`Заполняю: address (${cleanAddress})`);
    await humanType(page, S.address, cleanAddress);
    await randomDelay([500, 1000]);

    // --- Город ---
    const cleanCity = account.city.replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
    logger.info(`Заполняю: city (${cleanCity})`);
    await humanType(page, S.city, cleanCity);
    await randomDelay([500, 1500]);

    // --- Email ---
    logger.info('Заполняю: email');
    await humanType(page, S.email, account.email);
    await randomDelay([500, 1000]);

    // --- Телефон ---
    logger.info('Заполняю: contactNum');
    await humanType(page, S.contactNum, account.contactNum);
    await randomDelay([500, 1000]);

    // --- Дата рождения ---
    // Поле ожидает DD-MM-YYYY, а account.birthDate хранится как YYYY-MM-DD
    const [dobYear, dobMonth, dobDay] = account.birthDate.split('-');
    logger.info(`Заполняю: dob = ${dobDay}-${dobMonth}-${dobYear} (raw: ${account.birthDate})`);
    await fillDateField(page, S.dob, account.birthDate);
    await randomDelay([500, 1000]);

    // --- Пол ---
    logger.info(`Заполняю: gender = ${account.gender}`);
    const genderSelector = account.gender === 'female' ? S.genderFemale : S.genderMale;
    await page.click(genderSelector);
    await randomDelay([500, 1000]);

    // --- Валюта ---
    logger.info(`Заполняю: currency = ${account.currency}`);
    await page.select(S.currency, account.currency);
    await randomDelay([500, 1500]);

    // --- Контрольный вопрос (читаем реальные варианты из DOM) ---
    logger.info('Читаю варианты securityQns из формы...');
    const securityOptions = await page.$$eval(S.securityQns + ' option', opts =>
        opts.filter(o => o.value && o.value !== '').map(o => ({ value: o.value, text: o.textContent.trim() }))
    ).catch(() => []);

    if (securityOptions.length > 0) {
        const picked = securityOptions[Math.floor(Math.random() * securityOptions.length)];
        await page.select(S.securityQns, picked.value);
        account.securityQuestion = picked.value;
        // Всегда генерируем ответ строго по типу выбранного вопроса
        account.securityAnswer = getAnswerForQuestion(picked.value, picked.text);
        logger.info(`securityQns: ${picked.value} ("${picked.text}") → ответ: "${account.securityAnswer}"`);
    } else {
        // fallback: используем значение из аккаунта
        logger.warn('Не удалось прочитать варианты securityQns, используем из аккаунта');
        await page.select(S.securityQns, account.securityQuestion).catch(() => { });
    }
    await randomDelay([500, 1000]);

    // --- Ответ на контрольный вопрос ---
    logger.info(`Заполняю: securityAns = ${account.securityAnswer}`);
    // humanType не работает для этого поля (Bootstrap/jQuery сбрасывает) — используем evaluate setter
    await new Promise(r => setTimeout(r, 800)); // ждём JS после выбора securityQns
    await page.$eval(S.securityAns, (el, val) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(el, val);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
    }, account.securityAnswer);
    await verifyField(page, S.securityAns, account.securityAnswer, 'securityAns');
    await randomDelay([500, 1000]);

    // --- Проверка заполненности полей ДО CAPTCHA (капча меняется при сабмите с пустыми полями!) ---
    // --- Проверка заполненности полей ДО CAPTCHA (капча меняется при сабмите с пустыми полями!) ---
    const preCheck = [
        [S.firstName, 'firstName'], [S.lastName, 'lastName'],
        [S.loginId, 'loginId'], [S.securityAns, 'securityAns']
    ];
    for (const [sel, name] of preCheck) {
        const v = await page.$eval(sel, el => el.value).catch(() => '');
        if (!v) logger.error(`🔴 ПОЛЕ ${name} ПУСТОЕ перед CAPTCHA! Регистрация скорее всего провалится.`);
    }



    // --- CAPTCHA (через AI Vision: OpenRouter / Gemini) ---
    let totalCaptchaAttempts = 0;
    if (config.gemini && config.gemini.enabled && config.gemini.apiKey) {
        const maxRetries = 3;
        let captchaSolved = false;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            totalCaptchaAttempts = attempt;
            try {
                logger.info(`CAPTCHA: попытка ${attempt}/${maxRetries}`);
                await new Promise(r => setTimeout(r, 1500)); // даём капче прогрузиться
                const captchaText = await solveCaptcha(
                    page,
                    config.gemini.apiKey,
                    config.gemini.proxy || null,
                    config.gemini.model || 'gemini-2.5-flash',
                    config.gemini.provider || null
                );
                if (!captchaText) {
                    logger.warn('Gemini вернул пустой текст');
                    continue;
                }
                // Очищаем поле и вводим
                await page.$eval(S.captcha, el => { el.value = ''; });
                await humanType(page, S.captcha, captchaText, false); // clearFirst=false — уже очищено
                // Проверяем что реально попало в поле
                const fieldVal = await page.$eval(S.captcha, el => el.value).catch(() => '?');
                if (fieldVal !== captchaText) {
                    logger.warn(`⚠️ CAPTCHA в поле: "${fieldVal}" ≠ введённому: "${captchaText}" (повторяем попытку)`);
                    continue; // повторяем попытку৷ капча могла измениться
                }
                logger.info(`✅ CAPTCHA введена и подтверждена: "${fieldVal}"`);
                captchaSolved = true;
                break;
            } catch (e) {
                logger.warn(`CAPTCHA попытка ${attempt} не удалась: ${e.message}`);
                if (attempt < maxRetries) {
                    logger.info('🔄 Обновляем картинку CAPTCHA (клик по изображению)...');
                    await page.click('.load-captcha img, .load-captcha canvas').catch(() => { });
                    await new Promise(r => setTimeout(r, 2500)); // Ждём загрузки новой картинки
                }
            }
        }
        if (!captchaSolved) {
            logger.warn('⚠️ CAPTCHA не решена автоматически — продолжаем без неё');
        }
    } else {
        logger.info('Gemini не настроен — ожидаем ручного ввода CAPTCHA 60 сек.');
        await new Promise(r => setTimeout(r, 60000));
    }

    account.captchaAttempts = totalCaptchaAttempts || 0;
    await randomDelay([500, 1000]);

    // --- Чекбокс правил ---
    // Чекбокс кастомный: <input id="agreeRule"> скрыт стилями, клик работает через label[for="agreeRule"]
    logger.info('Ставлю галочку agreeRule');
    const agreeClicked = await page.evaluate(checkboxId => {
        const checkbox = document.getElementById(checkboxId);
        if (!checkbox) return 'not_found';
        if (checkbox.checked) return 'already_checked';

        // Способ 1: Клик по label[for="agreeRule"]
        const label = document.querySelector(`label[for="${checkboxId}"]`);
        if (label) {
            label.click();
            return checkbox.checked ? 'clicked_label' : 'label_click_failed';
        }

        // Способ 2: dispatchEvent на input
        checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return checkbox.checked ? 'dispatched' : 'dispatch_failed';
    }, 'agreeRule');

    logger.info(`agreeRule: ${agreeClicked}`);

    if (agreeClicked === 'not_found' || agreeClicked.includes('failed')) {
        // Способ 3: скроллим вниз и кликаем по label через puppeteer
        try {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await new Promise(r => setTimeout(r, 500));
            const labelHandle = await page.$('label[for="agreeRule"]');
            if (labelHandle) {
                await labelHandle.click();
                logger.info('agreeRule: кликнули через puppeteer label handle');
            }
        } catch (e3) {
            logger.warn(`agreeRule все методы не сработали: ${e3.message}`);
        }
    }
    await randomDelay([500, 1000]);

    logger.info('✅ Все поля заполнены');
}

class Registrator {
    constructor() {
        this.proxyManager = null;
        this.profileManager = new ProfileManager(
            require('path').resolve(__dirname, '..', config.paths.profilesDir)
        );
        this.browserManager = null;
        this.selectors = config.selectors;
    }

    /**
     * Регистрация одного аккаунта
     */
    async registerOne(account, opts = {}) {
        logger.info(`=== Регистрация аккаунта #${account.id}: ${account.email} ===`);

        // 1. Создаём ЧИСТЫЙ профиль (удаляем старый если был — иначе куки/кеш от прошлых попыток остаются)
        const profilePath = this.profileManager.getProfilePath(account.id);
        try {
            const fs = require('fs');
            if (fs.existsSync(profilePath)) {
                fs.rmSync(profilePath, { recursive: true, force: true });
                logger.info(`Очищен старый профиль: ${profilePath}`);
            }
        } catch (e) {
            logger.warn(`Не удалось очистить профиль: ${e.message}`);
        }
        this.profileManager.createProfile(account.id);
        updateAccount(account.id, { profilePath, status: 'in_progress' });

        // 2. Получаем прокси (уникальный порт для каждого аккаунта)
        let proxy = null;
        let proxyUrl = null;
        const proxyLocale = account.locale || account.country || config.registration.locale || config.registration.country || null;
        this.proxyManager = new ProxyManager(config.proxy, proxyLocale);
        if (this.proxyManager.hasProxies) {
            proxy = this.proxyManager.getProxyForAccount(account.id);
            if (proxy) proxyUrl = proxy.raw;
            if (proxy) {
                updateAccount(account.id, {
                    proxy: proxy.raw
                });
            }
        } else {
            logger.warn('Прокси не настроены, работаем без прокси');
        }

        // 3. Запускаем браузер (ИЛИ используем переданный)
        let page;
        let externalBrowser = false;
        if (opts.existingBrowserManager && opts.existingPage) {
            externalBrowser = true;
            this.browserManager = opts.existingBrowserManager;
            page = opts.existingPage;
        } else {
            this.browserManager = new BrowserManager(config.chrome);
            try {
                const result = await this.browserManager.launch({
                    userDataDir: profilePath,
                    proxyUrl
                });
                page = result.page;
            } catch (error) {
                logger.error(`Не удалось запустить браузер: ${error.message}`);
                updateAccount(account.id, { status: 'error', error: error.message });
                return { success: false, error: error.message };
            }
        }

        try {
            // 4. Выбираем зеркало и переходим на страницу регистрации
            let mirror = config.registration.currentMirror || getRandomMirror(config.registration.mirrors);

            // Получаем точное имя зеркала, если оно сохранено в новой базе
            let mirrorName = "Custom Mirror";
            try {
                const fs = require('fs');
                const mFile = require('path').join(__dirname, '..', 'data', 'mirrors.json');
                if (fs.existsSync(mFile)) {
                    const mirrorsDb = JSON.parse(fs.readFileSync(mFile, 'utf-8'));
                    const found = mirrorsDb.find(m => m.url === mirror);
                    if (found) mirrorName = found.name;
                }
            } catch (e) { }

            updateAccount(account.id, { mirrorUsed: `${mirrorName} (${mirror})` });
            logger.info(`Зеркало: ${mirrorName} - ${mirror}`);

            await navigateToRegistration(page, mirror);
            await takeScreenshot(page, account.id, '01_reg_page');

            // --- ПРОВЕРКА УНИКАЛЬНОСТИ IP ---
            let currentIp = 'unknown';
            try {
                currentIp = await page.evaluate(async () => {
                    const res = await fetch('https://api.ipify.org?format=json');
                    const data = await res.json();
                    return data.ip;
                });
                logger.info(`🌐 Текущий IP браузера: ${currentIp}`);

                const { loadAccounts } = require('./data-generator');
                const registeredAccs = loadAccounts(a => a.status === 'registered');
                const usedIps = registeredAccs.map(a => a.registrationIp).filter(ip => ip && ip !== 'unknown');

                if (usedIps.includes(currentIp)) {
                    throw new Error(`На IP ${currentIp} УЖЕ была регистрация. Отменяем процесс.`);
                }

                updateAccount(account.id, { registrationIp: currentIp });
            } catch (e) {
                if (e.message.includes('УЖЕ была регистрация')) throw e;
                logger.warn(`Не удалось заранее получить IP: ${e.message}`);
            }

            // 5. Проверяем что форма загрузилась
            const hasForm = await page.$(this.selectors.firstName);
            if (!hasForm) {
                throw new Error('Форма регистрации не загрузилась — поле firstName не найдено');
            }
            logger.info('Форма регистрации загружена');

            // 6. Заполняем форму
            await fillRegistrationForm(page, account, this.selectors);
            await takeScreenshot(page, account.id, '02_filled');
            // Сохраняем динамически выбранный security question (мог измениться в fillRegistrationForm)
            updateAccount(account.id, {
                securityQuestion: account.securityQuestion,
                securityAnswer: account.securityAnswer
            });

            // 7. CAPTCHA — уже решена автоматически в fillRegistrationForm через OpenRouter/Gemini
            // (старый блок ручного ожидания 60 сек удалён — капча решается выше)

            await takeScreenshot(page, account.id, '03_before_submit');

            // 8. Отправка формы с повтором при ошибке CAPTCHA (до 5 попыток)
            const maxSubmitAttempts = 5;
            let success = false;
            let errorMsg = null;

            for (let submitAttempt = 1; submitAttempt <= maxSubmitAttempts; submitAttempt++) {
                logger.info(`Отправка формы (попытка ${submitAttempt}/${maxSubmitAttempts})...`);
                await page.click(this.selectors.submitButton);
                await new Promise(r => setTimeout(r, 6000));

                await takeScreenshot(page, account.id, `04_submit_${submitAttempt}`);

                // 9. Проверяем результат
                const pageUrl = page.url();
                const pageContent = await page.content();

                // Собираем ВСЕ ошибки со страницы
                const pageErrors = await page.evaluate(() => {
                    const sels = [
                        '.errorMsg', '.error-message', '.alert-danger',
                        '.has-error .help-block', '[class*="errorMsg"]', '.invalidMsg',
                        '[class*="invalid"]', '.notification-error', '.text-danger',
                        'span.error', 'div.error', '[class*="err"]'
                    ];
                    const msgs = [];
                    for (const sel of sels) {
                        try {
                            document.querySelectorAll(sel).forEach(el => {
                                const t = (el.innerText || el.textContent || '').trim();
                                if (t && t.length > 2 && t.length < 400 && el.offsetParent !== null) {
                                    msgs.push(t);
                                }
                            });
                        } catch (e) {}
                    }
                    return [...new Set(msgs)];
                });

                if (pageErrors.length > 0) {
                    errorMsg = pageErrors.join(' | ').substring(0, 500);
                    logger.error(`Ошибки на форме (попытка ${submitAttempt}): ${errorMsg}`);
                    
                    // Если ошибка НЕ про капчу, значит форма тупо не проходит валидацию — прерываем цикл!
                    const isCaptchaError = errorMsg.toLowerCase().includes('captcha') || errorMsg.toLowerCase().includes('security code');
                    if (!isCaptchaError) {
                        logger.error('❌ Обнаружена критическая ошибка валидации формы. Прерываем повторы.');
                        break;
                    }
                }

                // Успех — специфичные слова (НЕ 'успешно' — оно есть и в ошибках!)
                const successWords = ['congratulations', 'поздравляем',
                    'account has been created', 'аккаунт создан',
                    'successfully registered', 'confirm your email', 'verify your email',
                    'welcome, ', 'verification email', 'please check your email'];
                const lowerContent = pageContent.toLowerCase();
                if (successWords.some(w => lowerContent.includes(w)) && pageErrors.length === 0) {
                    success = true;
                }

                // Редирект = успех (если нет ошибок)
                if (!pageUrl.includes('/register') && pageErrors.length === 0) {
                    success = true;
                }

                if (success) {
                    logger.info('✅ Регистрация успешна!');
                    break;
                }

                // Если всё ещё на /register и есть поле капчи — пересолвляем
                const stillOnRegister = pageUrl.includes('/register');
                if (!stillOnRegister || submitAttempt >= maxSubmitAttempts) break;

                const captchaFieldVisible = await page.$(this.selectors.captcha);
                if (!captchaFieldVisible) break;

                logger.warn(`⚠️ CAPTCHA не принята, получаем новую (попытка ${submitAttempt + 1})...`);

                if (config.gemini && config.gemini.enabled && config.gemini.apiKey) {
                    try {
                        await new Promise(r => setTimeout(r, 1500)); // ждём пока новая капча прогрузится
                        const newCaptchaText = await solveCaptcha(
                            page,
                            config.gemini.apiKey,
                            config.gemini.proxy || null,
                            config.gemini.model || 'gemini-2.5-flash',
                            config.gemini.provider || null
                        );
                        await humanType(page, this.selectors.captcha, newCaptchaText);
                        logger.info(`✅ Новая CAPTCHA введена: "${newCaptchaText}"`);
                    } catch (e) {
                        logger.warn(`Не удалось пересолвить CAPTCHA: ${e.message}`);
                        continue; // Идем на следующую попытку сабмита, чтобы обновить капчу
                    }
                } else {
                    break; // нет Gemini — не можем повторить
                }
            }

            // 10. Итог регистрации
            if (success) {
                logger.info(`✅ Аккаунт #${account.id} зарегистрирован!`);

                updateAccount(account.id, {
                    status: 'registered',
                    registeredAt: new Date().toISOString(),
                    pinnacleLogin: account.loginId
                });

                // === РАБОТА С EMAIL (Удаление из базы + ЧС) ===
                logger.info(`📧 Перенос email ${account.email} в Черный Список...`);
                try {
                    const fs = require('fs');
                    const path = require('path');
                    const emFile = path.join(__dirname, '..', 'data', 'emails.txt');
                    const blFile = path.join(__dirname, '..', 'data', 'blacklist.txt');

                    if (fs.existsSync(emFile)) {
                        let lines = fs.readFileSync(emFile, 'utf-8').split('\n');
                        const newLines = lines.filter(l => l.trim().toLowerCase() !== account.email.toLowerCase());
                        if (lines.length !== newLines.length) {
                            fs.writeFileSync(emFile, newLines.join('\n'));
                        }
                    }
                    // Дописываем в blacklist
                    fs.appendFileSync(blFile, (fs.existsSync(blFile) ? '\n' : '') + account.email.toLowerCase());
                } catch (e) {
                    logger.warn(`Ошибка обработки email/ЧС: ${e.message}`);
                }

                // === ДЕПОЗИТ: Автоматический после регистрации ===
                const configLive = JSON.parse(require('fs').readFileSync(
                    require('path').resolve(__dirname, '../config.json'), 'utf-8'
                ));
                const depositConfig = configLive.deposit || {};
                const depositEnabled = depositConfig.enabled !== false; // по умолчанию включён
                const depositAmount = depositConfig.amount || 20;

                if (depositEnabled && !opts.skipAutoDeposit) {
                    logger.info(`\n💰 === АВТОМАТИЧЕСКИЙ ДЕПОЗИТ: ${depositAmount} USDT ===`);
                    await new Promise(r => setTimeout(r, 5000)); // Ждём стабилизации + открытия новых табов

                    try {
                        // Передаём browser для обработки новых табов
                        const browser = this.browserManager.getBrowser();
                        const depositResult = await performDeposit(page, account, depositAmount, browser);

                        if (depositResult.success) {
                            logger.info(`✅ Депозит #${account.id} успешно инициирован: ${depositAmount} USDT`);
                            updateAccount(account.id, {
                                depositStatus: 'initiated',
                                depositAmount: depositAmount,
                                depositAt: new Date().toISOString()
                            });
                        } else {
                            logger.warn(`⚠️ Депозит #${account.id} не выполнен: ${depositResult.error}`);
                            updateAccount(account.id, {
                                depositStatus: 'failed',
                                depositError: depositResult.error
                            });
                        }
                    } catch (depError) {
                        logger.error(`❌ Критическая ошибка депозита #${account.id}: ${depError.message}`);
                        updateAccount(account.id, {
                            depositStatus: 'error',
                            depositError: depError.message
                        });
                    }
                } else {
                    logger.info('ℹ️ Автодепозит отключён в настройках');
                }

                return { success: true, login: account.loginId };
            } else {
                const msg = errorMsg || 'Не удалось подтвердить регистрацию';
                logger.warn(`⚠️ Аккаунт #${account.id}: ${msg}`);
                updateAccount(account.id, { status: 'uncertain', error: msg });
                return { success: false, error: msg };
            }

        } catch (error) {
            logger.error(`❌ Ошибка регистрации #${account.id}: ${error.message}`);
            await takeScreenshot(page, account.id, 'error').catch(() => { });
            updateAccount(account.id, { status: 'error', error: error.message });
            return { success: false, error: error.message };

        } finally {
            if (!externalBrowser && this.browserManager) {
                await this.browserManager.close();
                this.browserManager = null;
            }
        }
    }

    /**
     * Массовая регистрация
     * @param {number} count - сколько аккаунтов зарегистрировать
     */
    async registerBatch(count) {
        logger.info(`=== Массовая регистрация: ${count} аккаунтов ===`);

        const accounts = loadAccounts(a => a.status === 'pending');

        if (accounts.length === 0) {
            logger.error('Нет аккаунтов со статусом pending');
            return { total: 0, success: 0, failed: 0 };
        }

        const toRegister = accounts.slice(0, count);
        logger.info(`Найдено ${accounts.length} pending, регистрирую ${toRegister.length}`);

        const results = {
            total: toRegister.length,
            success: 0,
            failed: 0,
            accounts: []
        };

        for (let i = 0; i < toRegister.length; i++) {
            const account = toRegister[i];
            logger.info(`\n--- [${i + 1}/${toRegister.length}] ---`);

            try {
                const result = await this.registerOne(account);
                if (result.success) {
                    results.success++;
                } else {
                    results.failed++;
                }
                results.accounts.push({
                    id: account.id,
                    email: account.email,
                    ...result
                });
            } catch (error) {
                results.failed++;
                results.accounts.push({
                    id: account.id,
                    email: account.email,
                    success: false,
                    error: error.message
                });
                logger.error(`Критическая ошибка: ${error.message}`);
            }

            // Задержка между регистрациями
            if (i < toRegister.length - 1) {
                const delay = await randomDelay(config.registration.delayBetweenRegistrationsMs);
                logger.info(`Пауза ${Math.round(delay / 1000)} сек до следующей регистрации`);
            }
        }

        logger.info(`\n=== Итого: ${results.success} успешно, ${results.failed} ошибок из ${results.total} ===`);
        return results;
    }
}

module.exports = { Registrator, randomDelay, getRandomMirror, resolveRedirect, humanType, navigateToRegistration, fillRegistrationForm, dismissBanners };
