/**
 * Скрипт анализа DOM формы регистрации Pinnacle
 * Запускать на СЕРВЕРЕ: node scripts/analyze-selectors.js
 * 
 * Открывает Chrome через CDP с прокси, переходит на зеркало,
 * находит форму регистрации и выводит все CSS-селекторы полей.
 */

const { BrowserManager } = require('../src/browser');
const ProxyManager = require('../src/proxy');
const config = require('../config.json');
const fs = require('fs');
const path = require('path');

const SCREENSHOTS_DIR = path.resolve(__dirname, '..', 'screenshots', 'analysis');

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
 * Извлечение всех input/select/button/textarea элементов из DOM
 */
async function extractFormElements(page) {
    return await page.evaluate(() => {
        const elements = document.querySelectorAll('input, select, textarea, button, [role="button"], [role="combobox"], [role="listbox"]');
        const result = [];

        for (const el of elements) {
            const rect = el.getBoundingClientRect();
            const computed = window.getComputedStyle(el);
            const isVisible = rect.width > 0 && rect.height > 0 && computed.visibility !== 'hidden' && computed.display !== 'none';

            result.push({
                tag: el.tagName.toLowerCase(),
                type: el.type || '',
                id: el.id || '',
                name: el.name || '',
                className: el.className || '',
                placeholder: el.placeholder || '',
                role: el.getAttribute('role') || '',
                ariaLabel: el.getAttribute('aria-label') || '',
                dataTestId: el.getAttribute('data-test-id') || el.getAttribute('data-testid') || '',
                dataAttrs: Array.from(el.attributes)
                    .filter(a => a.name.startsWith('data-'))
                    .map(a => `${a.name}="${a.value}"`),
                text: el.textContent?.trim().substring(0, 100) || '',
                value: el.value || '',
                isVisible,
                rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                parentClasses: el.parentElement?.className || '',
                parentId: el.parentElement?.id || '',
                // XPath-like path
                cssPath: getCssPath(el)
            });
        }

        function getCssPath(el) {
            const parts = [];
            while (el && el.nodeType === 1) {
                let selector = el.tagName.toLowerCase();
                if (el.id) {
                    selector += `#${el.id}`;
                    parts.unshift(selector);
                    break;
                }
                if (el.className && typeof el.className === 'string') {
                    const classes = el.className.trim().split(/\s+/).slice(0, 2).join('.');
                    if (classes) selector += `.${classes}`;
                }
                parts.unshift(selector);
                el = el.parentElement;
            }
            return parts.join(' > ');
        }

        return result;
    });
}

/**
 * Поиск и клик по кнопке регистрации
 */
async function findAndClickJoinButton(page) {
    const signUpTexts = ['SIGN UP', 'Sign Up', 'Sign up', 'JOIN', 'Join', 'REGISTER', 'Register', 'Регистрация', 'ПРИСОЕДИНИТЬСЯ', 'Присоединиться'];

    // Способ 1: по тексту
    const clicked = await page.evaluate((texts) => {
        const elements = [...document.querySelectorAll('button, a, span, div')];
        for (const text of texts) {
            for (const el of elements) {
                const elText = el.textContent?.trim();
                if (elText === text || (elText && elText.toUpperCase() === text.toUpperCase())) {
                    const href = el.href || el.closest('a')?.href || '';
                    if (href.includes('affiliate') || href.includes('partner')) continue;
                    el.click();
                    return { found: true, text: elText, tag: el.tagName, class: el.className };
                }
            }
        }
        return { found: false };
    }, signUpTexts);

    if (clicked.found) {
        console.log(`✅ Кнопка регистрации найдена: "${clicked.text}" (${clicked.tag}.${clicked.class})`);
        return true;
    }

    // Способ 2: CSS селекторы
    const selectors = [
        'button[data-test-id="SignUp"]',
        'a[data-test-id="SignUp"]',
        '.sign-up', '.join-button',
        '[class*="signup"]', '[class*="SignUp"]',
        '[href*="signup"]', '[href*="sign-up"]'
    ];

    for (const sel of selectors) {
        try {
            const el = await page.$(sel);
            if (el) {
                const href = await page.evaluate(e => e.href || '', el);
                if (href.includes('affiliate') || href.includes('partner')) continue;
                await el.click();
                console.log(`✅ Кнопка регистрации найдена по CSS: ${sel}`);
                return true;
            }
        } catch (e) { /* next */ }
    }

    console.log('❌ Кнопка регистрации НЕ найдена');
    return false;
}

async function main() {
    // Берём IP-зеркало (домен pinnacle888.com может быть заблокирован)
    const mirror = config.registration.mirrors[1] || config.registration.mirrors[0];
    console.log(`\n🌐 Зеркало: ${mirror}\n`);

    // Прокси
    const proxyManager = new ProxyManager(config.proxy);
    let proxyUrl = null;
    if (proxyManager.hasProxies) {
        const proxy = proxyManager.getNext();
        proxyUrl = proxy.raw;
        console.log(`🔒 Прокси: ${proxy.type}://${proxy.host}:${proxy.port}`);
    }

    // Профиль временный
    const profileDir = path.resolve(__dirname, '..', 'profiles', 'analysis_temp');
    if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
    }

    // Запуск Chrome
    const browserManager = new BrowserManager(config.chrome);
    let page;

    try {
        const result = await browserManager.launch({
            userDataDir: profileDir,
            proxyUrl
        });
        page = result.page;
    } catch (error) {
        console.error(`❌ Не удалось запустить Chrome: ${error.message}`);
        console.error('Проверьте config.json -> chrome.executablePath');
        process.exit(1);
    }

    try {
        // 1. Переходим на зеркало
        console.log('\n📄 Загрузка страницы...');
        try {
            await page.goto(mirror, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (e) {
            console.log(`⚠️  Таймаут при загрузке, но продолжаем: ${e.message}`);
        }

        // Ждём JS 
        await new Promise(r => setTimeout(r, 8000));

        const currentUrl = page.url();
        console.log(`📍 Текущий URL: ${currentUrl}`);
        await takeScreenshot(page, '01_initial_page');

        // 2. Все элементы ДО клика на регистрацию
        console.log('\n═══════════════════════════════════════');
        console.log('📋 ЭЛЕМЕНТЫ НА ГЛАВНОЙ СТРАНИЦЕ');
        console.log('═══════════════════════════════════════');

        const mainPageElements = await extractFormElements(page);
        const visibleMain = mainPageElements.filter(e => e.isVisible);
        console.log(`Найдено элементов: ${mainPageElements.length} (видимых: ${visibleMain.length})`);
        for (const el of visibleMain) {
            console.log(`  ${el.tag}[type=${el.type}] id="${el.id}" name="${el.name}" class="${el.className.substring(0, 80)}" placeholder="${el.placeholder}" text="${el.text.substring(0, 50)}" data=${el.dataAttrs.join(', ')}`);
        }

        // 3. Ищем и кликаем кнопку регистрации
        console.log('\n═══════════════════════════════════════');
        console.log('🔍 ПОИСК КНОПКИ РЕГИСТРАЦИИ');
        console.log('═══════════════════════════════════════');

        const joinFound = await findAndClickJoinButton(page);

        if (joinFound) {
            // Ждём появления формы
            await new Promise(r => setTimeout(r, 5000));
            await takeScreenshot(page, '02_after_join_click');

            // 4. Элементы формы регистрации
            console.log('\n═══════════════════════════════════════');
            console.log('📝 ЭЛЕМЕНТЫ ФОРМЫ РЕГИСТРАЦИИ');
            console.log('═══════════════════════════════════════');

            const formElements = await extractFormElements(page);
            const visibleForm = formElements.filter(e => e.isVisible);
            console.log(`Найдено элементов: ${formElements.length} (видимых: ${visibleForm.length})\n`);

            for (const el of visibleForm) {
                console.log(`─────────────────────────────────`);
                console.log(`  TAG:         ${el.tag}`);
                console.log(`  TYPE:        ${el.type}`);
                console.log(`  ID:          ${el.id}`);
                console.log(`  NAME:        ${el.name}`);
                console.log(`  CLASS:       ${el.className.substring(0, 120)}`);
                console.log(`  PLACEHOLDER: ${el.placeholder}`);
                console.log(`  ROLE:        ${el.role}`);
                console.log(`  ARIA-LABEL:  ${el.ariaLabel}`);
                console.log(`  DATA-TEST:   ${el.dataTestId}`);
                console.log(`  DATA-*:      ${el.dataAttrs.join(', ')}`);
                console.log(`  TEXT:         ${el.text.substring(0, 80)}`);
                console.log(`  CSS PATH:    ${el.cssPath}`);
                console.log(`  POSITION:    x=${el.rect.x} y=${el.rect.y} w=${el.rect.w} h=${el.rect.h}`);
            }

            // 5. Пробуем найти следующий шаг
            console.log('\n═══════════════════════════════════════');
            console.log('🔄 ПРОБУЕМ ПЕРЕЙТИ НА ШАГ 2');
            console.log('═══════════════════════════════════════');

            // Ищем кнопку Next/Submit
            const nextClicked = await page.evaluate(() => {
                const btns = [...document.querySelectorAll('button, input[type="submit"]')];
                for (const btn of btns) {
                    const text = btn.textContent?.trim().toUpperCase() || '';
                    if (text.includes('NEXT') || text.includes('CONTINUE') || text.includes('ДАЛЕЕ') || text === 'SUBMIT') {
                        btn.click();
                        return text;
                    }
                }
                // Попробуем submit form
                const form = document.querySelector('form');
                if (form) {
                    const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
                    if (submitBtn) {
                        submitBtn.click();
                        return 'form submit button';
                    }
                }
                return null;
            });

            if (nextClicked) {
                console.log(`✅ Нажата кнопка: ${nextClicked}`);
                await new Promise(r => setTimeout(r, 5000));
                await takeScreenshot(page, '03_step2');

                const step2Elements = await extractFormElements(page);
                const visibleStep2 = step2Elements.filter(e => e.isVisible);
                console.log(`\nЭлементов на шаге 2: ${step2Elements.length} (видимых: ${visibleStep2.length})\n`);

                for (const el of visibleStep2) {
                    console.log(`─────────────────────────────────`);
                    console.log(`  TAG:         ${el.tag}`);
                    console.log(`  TYPE:        ${el.type}`);
                    console.log(`  ID:          ${el.id}`);
                    console.log(`  NAME:        ${el.name}`);
                    console.log(`  CLASS:       ${el.className.substring(0, 120)}`);
                    console.log(`  PLACEHOLDER: ${el.placeholder}`);
                    console.log(`  DATA-TEST:   ${el.dataTestId}`);
                    console.log(`  DATA-*:      ${el.dataAttrs.join(', ')}`);
                    console.log(`  TEXT:         ${el.text.substring(0, 80)}`);
                    console.log(`  CSS PATH:    ${el.cssPath}`);
                }
            } else {
                console.log('❌ Кнопка Next/Submit не найдена на шаге 1');
            }

        } else {
            // Форма не найдена — выводим полный HTML для анализа
            console.log('\n⚠️  Кнопка Join не найдена. Сохраняю HTML страницы...');
            const html = await page.content();
            const htmlPath = path.join(SCREENSHOTS_DIR, `page_html_${Date.now()}.html`);
            fs.writeFileSync(htmlPath, html, 'utf-8');
            console.log(`HTML сохранён: ${htmlPath}`);
        }

        // Итоговый вывод URL
        console.log(`\n📍 Финальный URL: ${page.url()}`);
        console.log('\n✅ Анализ завершен. Скриншоты в: ' + SCREENSHOTS_DIR);

    } catch (error) {
        console.error(`\n❌ Ошибка: ${error.message}`);
        console.error(error.stack);
        await takeScreenshot(page, 'error').catch(() => { });
    } finally {
        await browserManager.close();
    }
}

main().catch(console.error);
