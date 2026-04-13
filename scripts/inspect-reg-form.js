/**
 * Скрипт для инспекции формы регистрации Pinnacle
 * Переходит НАПРЯМУЮ на страницу регистрации и дампит все поля формы.
 * 
 * Зеркало 3 показало что ссылки "Регистрация" ведут на:
 *   quietthunder61.xyz/ru/register
 * 
 * Но домен может быть динамическим, поэтому сначала идём на зеркало,
 * ищем ссылку регистрации, и переходим по ней.
 */

const { BrowserManager } = require('../src/browser');
const config = require('../config.json');
const path = require('path');
const fs = require('fs');

const screenshotsDir = path.resolve(__dirname, '..', 'screenshots');
if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

async function screenshot(page, name) {
    const filepath = path.join(screenshotsDir, `reg_${name}_${Date.now()}.png`);
    await page.screenshot({ path: filepath, fullPage: true });
    console.log(`📸 ${filepath}`);
    return filepath;
}

async function main() {
    console.log('\n🚀 Запускаю Chrome...');

    const bm = new BrowserManager(config.chrome);
    const tmpDir = path.resolve(__dirname, '..', 'profiles', 'inspect_temp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    let page;
    try {
        const result = await bm.launch({ userDataDir: tmpDir });
        page = result.page;
    } catch (e) {
        console.error(`❌ Chrome: ${e.message}`);
        return;
    }

    try {
        // Шаг 1: Переходим на зеркало 3 (с #sgnruss)
        const mirror = config.registration.mirrors[3] || config.registration.mirrors[1];
        console.log(`🔗 Зеркало: ${mirror}`);

        try {
            await page.goto(mirror, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e) {
            console.log(`⚠️ Таймаут загрузки, продолжаем`);
        }

        console.log('⏳ Жду 8 сек загрузки...');
        await new Promise(r => setTimeout(r, 8000));
        console.log(`📍 URL: ${page.url()}`);

        // Шаг 2: Ищем href на /register в любой ссылке
        const registerUrl = await page.evaluate(() => {
            const links = [...document.querySelectorAll('a')];
            for (const a of links) {
                if (a.href && a.href.includes('/register') && !a.href.includes('affiliate')) {
                    return a.href;
                }
            }
            return null;
        });

        if (!registerUrl) {
            console.log('❌ Ссылка на /register не найдена на странице!');

            // Fallback: пробуем построить URL вручную из текущего домена
            const currentUrl = new URL(page.url());
            const fallbackUrl = `${currentUrl.origin}/ru/register`;
            console.log(`🔄 Пробую fallback: ${fallbackUrl}`);

            await page.goto(fallbackUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
        } else {
            console.log(`✅ Найден URL регистрации: ${registerUrl}`);
            console.log('⏳ Перехожу...');
            await page.goto(registerUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
        }

        // Шаг 3: Ждём загрузки формы
        console.log('⏳ Жду 8 сек загрузки формы...');
        await new Promise(r => setTimeout(r, 8000));

        console.log(`📍 URL формы: ${page.url()}`);
        console.log(`📍 Title: ${await page.title()}`);

        await screenshot(page, '01_form');

        // Шаг 4: Дамп ВСЕХ input, select, button, textarea
        console.log('\n' + '='.repeat(60));
        console.log('📋 ЭЛЕМЕНТЫ ФОРМЫ РЕГИСТРАЦИИ');
        console.log('='.repeat(60));

        const formData = await page.evaluate(() => {
            const result = { inputs: [], selects: [], buttons: [], textareas: [], labels: [], checkboxes: [] };

            // Inputs
            document.querySelectorAll('input').forEach(el => {
                if (!el.offsetParent && el.type !== 'hidden') return; // пропускаем невидимые
                result.inputs.push({
                    type: el.type,
                    name: el.name,
                    id: el.id,
                    placeholder: el.placeholder,
                    className: el.className.substring(0, 200),
                    dataTestId: el.getAttribute('data-test-id') || '',
                    ariaLabel: el.getAttribute('aria-label') || '',
                    autocomplete: el.autocomplete || '',
                    required: el.required,
                    value: el.value,
                    parentForm: el.closest('form')?.id || el.closest('form')?.className?.substring(0, 100) || ''
                });
            });

            // Selects
            document.querySelectorAll('select').forEach(el => {
                if (!el.offsetParent) return;
                const opts = [...el.options].slice(0, 15).map(o => `${o.value}|${o.text.trim()}`);
                result.selects.push({
                    name: el.name,
                    id: el.id,
                    className: el.className.substring(0, 200),
                    dataTestId: el.getAttribute('data-test-id') || '',
                    options: opts
                });
            });

            // Buttons
            document.querySelectorAll('button').forEach(el => {
                if (!el.offsetParent) return;
                result.buttons.push({
                    type: el.type,
                    text: el.textContent.trim().substring(0, 80),
                    className: el.className.substring(0, 200),
                    dataTestId: el.getAttribute('data-test-id') || '',
                    disabled: el.disabled
                });
            });

            // Labels
            document.querySelectorAll('label').forEach(el => {
                if (!el.offsetParent) return;
                result.labels.push({
                    text: el.textContent.trim().substring(0, 100),
                    htmlFor: el.htmlFor,
                    className: el.className.substring(0, 100)
                });
            });

            // Dropdowns (custom divs с ролью listbox/combobox)
            document.querySelectorAll('[role="listbox"], [role="combobox"], [class*="dropdown"], [class*="Dropdown"], [class*="select"], [class*="Select"]').forEach(el => {
                if (!el.offsetParent) return;
                result.selects.push({
                    tag: el.tagName,
                    role: el.getAttribute('role') || '',
                    className: el.className.substring(0, 200),
                    dataTestId: el.getAttribute('data-test-id') || '',
                    text: el.textContent.trim().substring(0, 100)
                });
            });

            return result;
        });

        console.log('\n--- INPUTS ---');
        formData.inputs.forEach((el, i) => {
            console.log(`  [${i + 1}] type=${el.type} name="${el.name}" id="${el.id}"`);
            console.log(`       placeholder="${el.placeholder}" autocomplete="${el.autocomplete}"`);
            console.log(`       class="${el.className}"`);
            if (el.dataTestId) console.log(`       data-test-id="${el.dataTestId}"`);
            if (el.ariaLabel) console.log(`       aria-label="${el.ariaLabel}"`);
            if (el.parentForm) console.log(`       form="${el.parentForm}"`);
            console.log();
        });

        console.log('\n--- SELECTS / DROPDOWNS ---');
        formData.selects.forEach((el, i) => {
            console.log(`  [${i + 1}] name="${el.name || ''}" id="${el.id || ''}" tag=${el.tag || 'select'}`);
            console.log(`       class="${el.className}"`);
            if (el.dataTestId) console.log(`       data-test-id="${el.dataTestId}"`);
            if (el.options) console.log(`       options: ${el.options.join(', ')}`);
            if (el.text) console.log(`       text: "${el.text}"`);
            console.log();
        });

        console.log('\n--- BUTTONS ---');
        formData.buttons.forEach((el, i) => {
            console.log(`  [${i + 1}] type=${el.type} text="${el.text}" disabled=${el.disabled}`);
            console.log(`       class="${el.className}"`);
            if (el.dataTestId) console.log(`       data-test-id="${el.dataTestId}"`);
            console.log();
        });

        console.log('\n--- LABELS ---');
        formData.labels.forEach((el, i) => {
            console.log(`  [${i + 1}] "${el.text}" for="${el.htmlFor}"`);
        });

        console.log(`\nИтого: ${formData.inputs.length} inputs, ${formData.selects.length} selects, ${formData.buttons.length} buttons, ${formData.labels.length} labels`);

        // Шаг 5: Ещё дамп полного HTML формы (если есть <form>)
        const formHtml = await page.evaluate(() => {
            const form = document.querySelector('form');
            return form ? form.outerHTML.substring(0, 5000) : '(нет <form> на странице)';
        });
        console.log('\n--- FORM HTML (первые 5000 символов) ---');
        console.log(formHtml);

        // Пауза
        console.log('\n\n🔧 Chrome открыт 120 сек. Ctrl+C для выхода.');
        await new Promise(r => setTimeout(r, 120000));

    } catch (error) {
        console.error(`\n❌ ${error.message}`);
        console.error(error.stack);
        await screenshot(page, 'error').catch(() => { });
    } finally {
        await bm.close();
        console.log('🛑 Закрыт.');
    }
}

main().catch(e => { console.error(e); process.exit(1); });
