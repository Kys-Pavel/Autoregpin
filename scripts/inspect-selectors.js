/**
 * Скрипт для инспекции CSS-селекторов формы регистрации Pinnacle
 * Запуск: node scripts/inspect-selectors.js [номер_зеркала]
 * 
 * Зеркала:
 * 0: pinnacle888.com (домашняя страница, кнопка Sign Up)
 * 1-3: 166.117.100.75 (с #sgnruss — возможно прямой вход в форму)
 * 4-6: b.link (прокладки)
 */

const { BrowserManager } = require('../src/browser');
const config = require('../config.json');
const path = require('path');
const fs = require('fs');

const screenshotsDir = path.resolve(__dirname, '..', 'screenshots');
if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
}

async function screenshot(page, name) {
    const filepath = path.join(screenshotsDir, `inspect_${name}_${Date.now()}.png`);
    await page.screenshot({ path: filepath, fullPage: true });
    console.log(`📸 Скриншот: ${filepath}`);
    return filepath;
}

async function dumpElements(page, label) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📋 ${label}`);
    console.log(`${'='.repeat(60)}`);

    const elements = await page.evaluate(() => {
        const results = [];

        // Все input'ы
        document.querySelectorAll('input').forEach(el => {
            results.push({
                tag: 'input',
                type: el.type,
                name: el.name,
                id: el.id,
                placeholder: el.placeholder,
                className: el.className.substring(0, 150),
                dataTestId: el.getAttribute('data-test-id') || '',
                ariaLabel: el.getAttribute('aria-label') || '',
                visible: el.offsetParent !== null,
                rect: el.getBoundingClientRect(),
                value: el.value
            });
        });

        // Все select'ы
        document.querySelectorAll('select').forEach(el => {
            const options = [...el.options].map(o => `${o.value}:${o.text}`).slice(0, 10);
            results.push({
                tag: 'select',
                name: el.name,
                id: el.id,
                className: el.className.substring(0, 150),
                dataTestId: el.getAttribute('data-test-id') || '',
                visible: el.offsetParent !== null,
                options: options.join(' | ')
            });
        });

        // Все button'ы
        document.querySelectorAll('button').forEach(el => {
            results.push({
                tag: 'button',
                type: el.type,
                text: el.textContent.trim().substring(0, 80),
                className: el.className.substring(0, 150),
                dataTestId: el.getAttribute('data-test-id') || '',
                visible: el.offsetParent !== null,
                rect: el.getBoundingClientRect()
            });
        });

        // Ссылки sign up / join / register
        const links = [...document.querySelectorAll('a')];
        links.forEach(el => {
            const text = el.textContent.trim();
            if (text.match(/sign.?up|join|register|регистр|присоедин/i)) {
                results.push({
                    tag: 'a',
                    text: text.substring(0, 80),
                    href: el.href,
                    className: el.className.substring(0, 150),
                    dataTestId: el.getAttribute('data-test-id') || '',
                    visible: el.offsetParent !== null
                });
            }
        });

        // Также ищем любые элементы с текстом содержащим "sign up" "register" "join"
        // в div/span которые могут быть кнопками
        document.querySelectorAll('div, span').forEach(el => {
            const text = el.textContent.trim();
            // Только прямые текстовые ноды, без вложенных
            if (el.children.length === 0 && text.match(/^(sign.?up|join|register|регистр|присоедин|создать|create)/i)) {
                results.push({
                    tag: el.tagName.toLowerCase(),
                    text: text.substring(0, 80),
                    className: el.className.substring(0, 150),
                    visible: el.offsetParent !== null,
                    role: el.getAttribute('role') || ''
                });
            }
        });

        return results;
    });

    if (elements.length === 0) {
        console.log('  (элементов не найдено)');
    } else {
        elements.forEach((el, i) => {
            console.log(`\n  [${i + 1}] <${el.tag}>`);
            Object.entries(el).forEach(([key, val]) => {
                if (key !== 'tag' && val !== '' && val !== undefined && val !== false) {
                    if (key === 'rect') {
                        console.log(`      rect: x=${Math.round(val.x)} y=${Math.round(val.y)} w=${Math.round(val.width)} h=${Math.round(val.height)}`);
                    } else {
                        console.log(`      ${key}: ${val}`);
                    }
                }
            });
        });
    }

    console.log(`\n  Всего элементов: ${elements.length}`);
}

async function dumpIframes(page, label) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📋 ${label} — IFRAMES`);
    console.log(`${'='.repeat(60)}`);

    const iframes = await page.evaluate(() => {
        return [...document.querySelectorAll('iframe')].map(f => ({
            src: f.src,
            id: f.id,
            name: f.name,
            className: f.className,
            width: f.width,
            height: f.height,
            visible: f.offsetParent !== null
        }));
    });

    if (iframes.length === 0) {
        console.log('  (iframe не найдено)');
    } else {
        iframes.forEach((f, i) => {
            console.log(`\n  [iframe ${i + 1}]`);
            Object.entries(f).forEach(([key, val]) => {
                if (val !== '' && val !== undefined) {
                    console.log(`      ${key}: ${val}`);
                }
            });
        });
    }
}

async function main() {
    const mirrorIndex = parseInt(process.argv[2] || '0');
    const mirror = config.registration.mirrors[mirrorIndex];

    if (!mirror) {
        console.log('Доступные зеркала:');
        config.registration.mirrors.forEach((m, i) => console.log(`  ${i}: ${m}`));
        console.log(`\nИспользование: node scripts/inspect-selectors.js <номер>`);
        return;
    }

    console.log(`\n🚀 Запускаю Chrome...`);
    console.log(`🔗 Зеркало [${mirrorIndex}]: ${mirror}`);

    const bm = new BrowserManager(config.chrome);

    const tmpProfileDir = path.resolve(__dirname, '..', 'profiles', 'inspect_temp');
    if (!fs.existsSync(tmpProfileDir)) {
        fs.mkdirSync(tmpProfileDir, { recursive: true });
    }

    let page;
    try {
        const result = await bm.launch({
            userDataDir: tmpProfileDir
        });
        page = result.page;
    } catch (error) {
        console.error(`❌ Не удалось запустить Chrome: ${error.message}`);
        return;
    }

    try {
        // Переходим на зеркало
        console.log(`\n⏳ Перехожу на ${mirror}...`);

        try {
            await page.goto(mirror, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } catch (e) {
            console.log(`⚠️ Таймаут, продолжаем: ${e.message}`);
        }

        // Ждём загрузки
        console.log('⏳ Жду 10 сек...');
        await new Promise(r => setTimeout(r, 10000));

        const currentUrl = page.url();
        console.log(`\n📍 Текущий URL: ${currentUrl}`);
        console.log(`📍 Title: ${await page.title()}`);

        await screenshot(page, '01_loaded');
        await dumpElements(page, 'ПОСЛЕ ЗАГРУЗКИ');
        await dumpIframes(page, 'ПОСЛЕ ЗАГРУЗКИ');

        // === Клик на Sign Up через page.click() ===
        console.log('\n\n🔍 Ищу кнопку регистрации...');

        let clicked = false;

        // Пробуем CSS-селектор a.signUpBtn (найден на pinnacle888)
        const signUpSelectors = [
            'a.signUpBtn',
            'a.signUpHomePage',
            '.signUpBtn',
            'a[class*="signUp"]',
            'a[class*="SignUp"]',
            'button[class*="signUp"]',
            'button[class*="SignUp"]',
            '[data-test-id="SignUp"]',
            '[class*="signup"]',
            '[class*="register"]'
        ];

        for (const sel of signUpSelectors) {
            try {
                const el = await page.$(sel);
                if (el) {
                    // Проверяем что не affiliate
                    const href = await page.evaluate(e => e.href || '', el);
                    if (href.includes('affiliate') || href.includes('partner')) {
                        console.log(`  Пропускаю affiliate: ${sel} -> ${href}`);
                        continue;
                    }

                    console.log(`  Найден: ${sel} (href: ${href})`);

                    // Кликаем через page.click() — это вызывает навигацию корректно
                    await page.click(sel);
                    clicked = true;
                    console.log(`✅ Кликнул через page.click(${sel})`);
                    break;
                }
            } catch (e) {
                console.log(`  ❌ ${sel}: ${e.message}`);
            }
        }

        // Если по CSS не нашли — ищем по тексту, но кликаем через puppeteer
        if (!clicked) {
            console.log('  Ищу по тексту...');
            const signUpTexts = ['SIGN UP', 'Sign Up', 'Sign up', 'JOIN', 'Join', 'REGISTER', 'Register'];

            for (const text of signUpTexts) {
                try {
                    // Находим элемент по тексту
                    const elements = await page.$$('button, a');
                    for (const el of elements) {
                        const elText = await page.evaluate(e => e.textContent.trim(), el);
                        if (elText.toUpperCase() === text.toUpperCase()) {
                            const href = await page.evaluate(e => e.href || '', el);
                            if (href.includes('affiliate') || href.includes('partner')) continue;

                            console.log(`  Найден по тексту: "${elText}" (href: ${href})`);
                            await el.click();
                            clicked = true;
                            console.log(`✅ Кликнул!`);
                            break;
                        }
                    }
                    if (clicked) break;
                } catch (e) { /* next */ }
            }
        }

        if (!clicked) {
            console.log('\n⚠️ Кнопка регистрации не найдена.');
            await screenshot(page, '02_no_button');
        } else {
            // Ждём навигацию / открытие формы
            console.log('\n⏳ Жду навигацию...');
            try {
                await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
            } catch (e) {
                console.log(`  waitForNavigation таймаут (это OK если форма открылась попапом)`);
            }

            await new Promise(r => setTimeout(r, 5000));

            const newUrl = page.url();
            console.log(`\n📍 URL после клика: ${newUrl}`);

            await screenshot(page, '02_after_click');
            await dumpElements(page, 'ПОСЛЕ КЛИКА Sign Up');
            await dumpIframes(page, 'ПОСЛЕ КЛИКА Sign Up');

            // Проверяем все вкладки — форма могла открыться в новой вкладке
            const pages = await page.browser().pages();
            console.log(`\n📑 Открыто вкладок: ${pages.length}`);
            for (let i = 0; i < pages.length; i++) {
                const p = pages[i];
                console.log(`  Tab[${i}]: ${p.url()}`);
            }

            // Если есть новая вкладка — переключаемся на неё
            if (pages.length > 1) {
                const lastPage = pages[pages.length - 1];
                console.log(`\n🔄 Переключаюсь на последнюю вкладку: ${lastPage.url()}`);
                await lastPage.bringToFront();
                await new Promise(r => setTimeout(r, 5000));

                console.log(`📍 URL новой вкладки: ${lastPage.url()}`);
                await screenshot(lastPage, '03_new_tab');
                await dumpElements(lastPage, 'НОВАЯ ВКЛАДКА — ФОРМА?');
                await dumpIframes(lastPage, 'НОВАЯ ВКЛАДКА');
            }
        }

        // Пауза
        console.log('\n\n🔧 Chrome открыт 120 сек для ручной инспекции...');
        console.log('   Нажми Ctrl+C чтобы завершить.\n');
        await new Promise(r => setTimeout(r, 120000));

    } catch (error) {
        console.error(`\n❌ Ошибка: ${error.message}`);
        console.error(error.stack);
        await screenshot(page, 'error').catch(() => { });
    } finally {
        await bm.close();
        console.log('\n🛑 Chrome закрыт.');
    }
}

main().catch(err => {
    console.error('Критическая ошибка:', err);
    process.exit(1);
});
