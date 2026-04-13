/**
 * Скрипт для анализа формы регистрации Pinnacle
 * Открывает зеркало через прокси, кликает Sign Up, собирает все селекторы формы
 * 
 * Запуск: node scripts/inspect-form.js
 */

const puppeteer = require('puppeteer-core');
const proxyChain = require('proxy-chain');
const fs = require('fs');
const path = require('path');
const config = require('../config.json');

const SCREENSHOTS_DIR = path.resolve(__dirname, '..', 'screenshots', 'form-inspect');

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function takeScreenshot(page, name) {
    if (!fs.existsSync(SCREENSHOTS_DIR)) {
        fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    }
    const filepath = path.join(SCREENSHOTS_DIR, `${name}_${Date.now()}.png`);
    await page.screenshot({ path: filepath, fullPage: true });
    console.log(`📸 Скриншот: ${filepath}`);
    return filepath;
}

/**
 * Собирает информацию обо всех input/select/button/textarea на странице
 */
async function collectFormElements(page) {
    return await page.evaluate(() => {
        const elements = document.querySelectorAll('input, select, button, textarea, [role="button"], [role="combobox"], [role="listbox"]');
        const result = [];

        for (const el of elements) {
            // Пропускаем скрытые элементы (type=hidden)
            if (el.type === 'hidden') continue;

            const rect = el.getBoundingClientRect();
            const isVisible = rect.width > 0 && rect.height > 0;

            const info = {
                tag: el.tagName.toLowerCase(),
                type: el.type || '',
                name: el.name || '',
                id: el.id || '',
                className: el.className || '',
                placeholder: el.placeholder || '',
                value: el.value || '',
                innerText: el.innerText?.substring(0, 100) || '',
                role: el.getAttribute('role') || '',
                dataTestId: el.getAttribute('data-test-id') || el.getAttribute('data-testid') || '',
                ariaLabel: el.getAttribute('aria-label') || '',
                autocomplete: el.getAttribute('autocomplete') || '',
                isVisible,
                rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                // Все data-* атрибуты
                dataAttrs: {}
            };

            for (const attr of el.attributes) {
                if (attr.name.startsWith('data-')) {
                    info.dataAttrs[attr.name] = attr.value;
                }
            }

            // Ближайший label
            if (el.id) {
                const label = document.querySelector(`label[for="${el.id}"]`);
                if (label) info.labelText = label.textContent.trim();
            }

            // Родительский элемент с текстом-подсказкой
            const parent = el.closest('div, fieldset, form, section');
            if (parent) {
                const parentLabel = parent.querySelector('label, span, p');
                if (parentLabel && parentLabel.textContent.length < 100) {
                    info.nearestLabel = parentLabel.textContent.trim();
                }
            }

            result.push(info);
        }

        return result;
    });
}

/**
 * Собирает все ссылки/кнопки с текстом Sign Up, Join, Register и т.д.
 */
async function findSignUpButtons(page) {
    return await page.evaluate(() => {
        const keywords = ['sign up', 'join', 'register', 'регистрация', 'присоединиться', 'create account'];
        const allElements = document.querySelectorAll('a, button, span, div, [role="button"]');
        const results = [];

        for (const el of allElements) {
            const text = (el.textContent || '').trim().toLowerCase();
            const href = el.href || '';

            for (const kw of keywords) {
                if (text.includes(kw) || href.toLowerCase().includes(kw.replace(' ', ''))) {
                    const rect = el.getBoundingClientRect();
                    results.push({
                        tag: el.tagName.toLowerCase(),
                        text: (el.textContent || '').trim().substring(0, 100),
                        href: href,
                        id: el.id || '',
                        className: el.className || '',
                        dataTestId: el.getAttribute('data-test-id') || el.getAttribute('data-testid') || '',
                        isVisible: rect.width > 0 && rect.height > 0,
                        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                        matchedKeyword: kw
                    });
                    break;
                }
            }
        }

        return results;
    });
}

async function main() {
    const mirror = config.registration.mirrors[0]; // Берём первое зеркало
    console.log(`\n🔍 Анализ формы регистрации Pinnacle`);
    console.log(`📎 Зеркало: ${mirror}`);

    // Настраиваем прокси
    let proxyUrl = null;
    let anonymizedProxy = null;

    if (config.proxy.list && config.proxy.list.length > 0) {
        proxyUrl = config.proxy.list[0];
        console.log(`🔒 Прокси: ${proxyUrl.replace(/:[^:@]+@/, ':****@')}`);

        // Анонимизируем прокси через proxy-chain
        try {
            anonymizedProxy = await proxyChain.anonymizeProxy(proxyUrl);
            console.log(`🔒 Анонимизированный прокси: ${anonymizedProxy}`);
        } catch (err) {
            console.error(`❌ Ошибка анонимизации прокси: ${err.message}`);
            console.log('Пробуем без прокси...');
        }
    }

    const args = [
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1280,900'
    ];

    if (anonymizedProxy) {
        args.push(`--proxy-server=${anonymizedProxy}`);
    }

    console.log(`\n🚀 Запускаю Chrome...`);

    const browser = await puppeteer.launch({
        executablePath: config.chrome.executablePath,
        headless: false,
        args,
        defaultViewport: { width: 1280, height: 900 }
    });

    const page = await browser.newPage();

    // Ставим user-agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36');

    try {
        // === ШАГ 1: Загружаем зеркало ===
        console.log(`\n📄 Загружаю ${mirror}...`);
        await page.goto(mirror, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await sleep(8000); // Ждём рендеринг SPA

        console.log(`✅ URL: ${page.url()}`);
        await takeScreenshot(page, '01_main_page');

        // === ШАГ 2: Ищем кнопку Sign Up ===
        console.log(`\n🔍 Ищу кнопки Sign Up...`);
        const signUpButtons = await findSignUpButtons(page);
        console.log(`Найдено кнопок: ${signUpButtons.length}`);

        for (const btn of signUpButtons) {
            console.log(`  - [${btn.tag}] "${btn.text}" href=${btn.href} visible=${btn.isVisible} class="${btn.className}" data-test-id="${btn.dataTestId}"`);
        }

        // Записываем в файл
        const outputDir = path.resolve(__dirname, '..', 'data');
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

        const report = {
            timestamp: new Date().toISOString(),
            mirror,
            finalUrl: page.url(),
            step: 'main_page',
            signUpButtons,
            formElements: await collectFormElements(page)
        };

        // === ШАГ 3: Кликаем Sign Up ===
        // Пробуем найти Sign Up кнопку по тексту
        const signUpTexts = ['SIGN UP', 'Sign Up', 'Sign up', 'JOIN', 'Join', 'REGISTER', 'Регистрация', 'ПРИСОЕДИНИТЬСЯ'];
        let clicked = false;

        try {
            clicked = await page.evaluate((texts) => {
                const elements = [...document.querySelectorAll('button, a, span, div, [role="button"]')];
                for (const text of texts) {
                    for (const el of elements) {
                        const elText = (el.textContent || '').trim();
                        if (elText === text || elText.toUpperCase() === text.toUpperCase()) {
                            const href = el.href || el.closest('a')?.href || '';
                            if (href.includes('affiliate') || href.includes('partner')) continue;
                            const rect = el.getBoundingClientRect();
                            if (rect.width === 0 || rect.height === 0) continue;
                            el.click();
                            return true;
                        }
                    }
                }
                return false;
            }, signUpTexts);
        } catch (e) {
            console.log(`⚠️  Ошибка при клике по тексту: ${e.message}`);
        }

        if (!clicked) {
            // Пробуем по селекторам
            const selectors = [
                'button[data-test-id="SignUp"]',
                'a[data-test-id="SignUp"]',
                '[class*="signup" i]',
                '[class*="SignUp"]',
                '[class*="sign-up" i]',
                '[href*="signup"]',
                '[href*="sign-up"]',
                '#signup',
                '#signUp'
            ];

            for (const sel of selectors) {
                try {
                    const el = await page.$(sel);
                    if (el) {
                        const href = await page.evaluate(e => e.href || '', el);
                        if (!href.includes('affiliate') && !href.includes('partner')) {
                            await el.click();
                            clicked = true;
                            console.log(`✅ Кликнул Sign Up через: ${sel}`);
                            break;
                        }
                    }
                } catch (e) { /* next */ }
            }
        } else {
            console.log(`✅ Кликнул Sign Up через текст`);
        }

        if (!clicked) {
            console.log(`⚠️  Не нашёл кнопку Sign Up. Проверь скриншот.`);
            await takeScreenshot(page, '02_no_signup_button');
        }

        // Ждём после клика
        await sleep(5000);
        await takeScreenshot(page, '02_after_signup_click');

        // === ШАГ 4: Собираем элементы формы (шаг 1) ===
        console.log(`\n📋 Собираю элементы формы (шаг 1)...`);
        const step1Elements = await collectFormElements(page);
        console.log(`Элементов формы: ${step1Elements.length}`);

        for (const el of step1Elements.filter(e => e.isVisible)) {
            console.log(`  [${el.tag}] type="${el.type}" name="${el.name}" id="${el.id}" placeholder="${el.placeholder}" data-test-id="${el.dataTestId}" label="${el.nearestLabel || ''}" autocomplete="${el.autocomplete}"`);
        }

        report.step1 = {
            url: page.url(),
            formElements: step1Elements
        };

        // === ШАГ 5: Получаем полный HTML формы ===
        const formHtml = await page.evaluate(() => {
            // Ищем форму или модальное окно
            const form = document.querySelector('form') ||
                document.querySelector('[class*="modal"]') ||
                document.querySelector('[class*="dialog"]') ||
                document.querySelector('[class*="signup"]') ||
                document.querySelector('[class*="register"]') ||
                document.querySelector('[class*="SignUp"]');

            if (form) return form.outerHTML;

            // Если не нашли — весь body
            return document.body.innerHTML.substring(0, 50000);
        });

        report.formHtml = formHtml;

        // Сохраняем полный отчёт
        const reportPath = path.join(outputDir, 'form-inspection-report.json');
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
        console.log(`\n📁 Отчёт сохранён: ${reportPath}`);

        // Сохраняем HTML отдельно
        const htmlPath = path.join(outputDir, 'form-html.html');
        fs.writeFileSync(htmlPath, formHtml, 'utf-8');
        console.log(`📁 HTML формы: ${htmlPath}`);

        // Ждём чтобы пользователь мог посмотреть
        console.log(`\n⏳ Браузер будет открыт 30 секунд для ручного осмотра...`);
        console.log(`   Можно вручную пройти по шагам формы.`);
        await sleep(30000);

    } catch (error) {
        console.error(`\n❌ Ошибка: ${error.message}`);
        await takeScreenshot(page, 'error').catch(() => { });
    } finally {
        await browser.close();
        if (anonymizedProxy) {
            await proxyChain.closeAnonymizedProxy(anonymizedProxy, true);
        }
        console.log(`\n🏁 Готово.`);
    }
}

main().catch(err => {
    console.error(`Фатальная ошибка: ${err.message}`);
    process.exit(1);
});
