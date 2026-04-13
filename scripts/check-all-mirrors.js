/**
 * Проверка формы регистрации на ВСЕХ зеркалах из config.json
 * Для каждого зеркала:
 * 1. Переходит на зеркало
 * 2. Ищет ссылку /register
 * 3. Переходит на страницу регистрации
 * 4. Выводит краткую сводку полей формы
 * 5. Делает скриншот
 */

const { BrowserManager } = require('../src/browser');
const config = require('../config.json');
const path = require('path');
const fs = require('fs');

const screenshotsDir = path.resolve(__dirname, '..', 'screenshots');
if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });

async function screenshot(page, name) {
    const filepath = path.join(screenshotsDir, `all_${name}_${Date.now()}.png`);
    await page.screenshot({ path: filepath, fullPage: true });
    console.log(`  📸 ${filepath}`);
    return filepath;
}

async function getFormSummary(page) {
    return await page.evaluate(() => {
        const inputs = [...document.querySelectorAll('input')].filter(el => el.offsetParent || el.type === 'hidden');
        const selects = [...document.querySelectorAll('select')].filter(el => el.offsetParent);
        const buttons = [...document.querySelectorAll('button')].filter(el => el.offsetParent);

        return {
            inputs: inputs.map(el => ({
                type: el.type, name: el.name, id: el.id,
                placeholder: el.placeholder,
                class: el.className.substring(0, 100)
            })),
            selects: selects.map(el => ({
                name: el.name, id: el.id,
                class: el.className.substring(0, 100),
                optionCount: el.options.length,
                firstOptions: [...el.options].slice(0, 3).map(o => o.text.trim())
            })),
            buttons: buttons.map(el => ({
                type: el.type,
                text: el.textContent.trim().substring(0, 50),
                class: el.className.substring(0, 100)
            })),
            hasRegisterForm: !!document.querySelector('#register-form, form.register, [class*="register"]'),
            formCount: document.querySelectorAll('form').length
        };
    });
}

async function checkMirror(page, mirrorIndex, mirrorUrl) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🔗 [${mirrorIndex}] ${mirrorUrl}`);
    console.log(`${'═'.repeat(60)}`);

    // Переходим на зеркало
    try {
        await page.goto(mirrorUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
        console.log(`  ⚠️ Таймаут загрузки`);
    }

    await new Promise(r => setTimeout(r, 8000));

    const landingUrl = page.url();
    console.log(`  📍 Landing URL: ${landingUrl}`);

    // Ищем ссылку /register
    const registerUrl = await page.evaluate(() => {
        const links = [...document.querySelectorAll('a')];
        for (const a of links) {
            if (a.href && a.href.includes('/register') && !a.href.includes('affiliate')) {
                return a.href;
            }
        }
        return null;
    });

    // Проверяем тип сайта — pinnacle888.com или основной Pinnacle
    const isPinnacle888 = landingUrl.includes('pinnacle888');

    if (isPinnacle888) {
        // Проверяем кнопку Sign Up на pinnacle888
        const signUpHref = await page.evaluate(() => {
            const btn = document.querySelector('a.signUpBtn, a[class*="signUp"]');
            return btn ? btn.href : null;
        });
        console.log(`  📌 Тип: Pinnacle888 (отдельный сайт)`);
        console.log(`  📌 Sign Up href: ${signUpHref || 'не найден'}`);

        if (signUpHref) {
            try {
                await page.goto(signUpHref, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await new Promise(r => setTimeout(r, 5000));
                console.log(`  📍 Sign Up URL: ${page.url()}`);

                const summary = await getFormSummary(page);
                printSummary(summary, mirrorIndex);
                await screenshot(page, `mirror${mirrorIndex}_form`);
            } catch (e) {
                console.log(`  ❌ Ошибка перехода: ${e.message}`);
            }
        }
        return;
    }

    // Основной Pinnacle
    if (registerUrl) {
        console.log(`  ✅ Register URL: ${registerUrl}`);
        try {
            await page.goto(registerUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch (e) {
            console.log(`  ⚠️ Таймаут`);
        }
        await new Promise(r => setTimeout(r, 5000));
        console.log(`  📍 Итоговый URL: ${page.url()}`);

        const summary = await getFormSummary(page);
        printSummary(summary, mirrorIndex);
        await screenshot(page, `mirror${mirrorIndex}_form`);
    } else {
        // Fallback — пробуем добавить /ru/register к текущему домену
        try {
            const url = new URL(landingUrl);
            const fallback = `${url.origin}/ru/register`;
            console.log(`  ⚠️ /register не найден. Пробую fallback: ${fallback}`);
            await page.goto(fallback, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 5000));
            console.log(`  📍 Fallback URL: ${page.url()}`);

            const summary = await getFormSummary(page);
            printSummary(summary, mirrorIndex);
            await screenshot(page, `mirror${mirrorIndex}_fallback`);
        } catch (e) {
            console.log(`  ❌ Fallback не сработал: ${e.message}`);
        }
    }
}

function printSummary(summary, idx) {
    const regInputs = summary.inputs.filter(i => i.class.includes('field') || i.class.includes('register'));
    const allInputs = summary.inputs;

    console.log(`\n  --- Форма [${idx}] ---`);
    console.log(`  Всего форм: ${summary.formCount} | hasRegisterForm: ${summary.hasRegisterForm}`);
    console.log(`  Inputs: ${allInputs.length} | Selects: ${summary.selects.length} | Buttons: ${summary.buttons.length}`);

    console.log(`\n  Поля формы:`);
    allInputs.forEach(inp => {
        if (inp.class.includes('field') || inp.class.includes('form-control') || inp.class.includes('register')) {
            console.log(`    ✓ ${inp.type.padEnd(10)} name="${inp.name}" id="${inp.id}" class="${inp.class}"`);
        }
    });

    console.log(`\n  Selects:`);
    summary.selects.forEach(sel => {
        console.log(`    ✓ name="${sel.name}" id="${sel.id}" options(${sel.optionCount}): ${sel.firstOptions.join(', ')}`);
    });

    console.log(`\n  Кнопки:`);
    summary.buttons.forEach(btn => {
        if (btn.text.includes('Создать') || btn.text.includes('Submit') || btn.text.includes('Register') ||
            btn.text.includes('регистр') || btn.class.includes('Submit') || btn.class.includes('submit')) {
            console.log(`    🔘 "${btn.text}" class="${btn.class}"`);
        }
    });
}

async function main() {
    console.log('🚀 Проверка формы регистрации на ВСЕХ зеркалах\n');
    console.log(`Зеркал в конфиге: ${config.registration.mirrors.length}`);
    config.registration.mirrors.forEach((m, i) => console.log(`  [${i}] ${m}`));

    const bm = new BrowserManager(config.chrome);
    const tmpDir = path.resolve(__dirname, '..', 'profiles', 'inspect_all');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    let page;
    try {
        const result = await bm.launch({ userDataDir: tmpDir });
        page = result.page;
    } catch (e) {
        console.error(`❌ Chrome: ${e.message}`);
        return;
    }

    const results = [];

    try {
        for (let i = 0; i < config.registration.mirrors.length; i++) {
            try {
                await checkMirror(page, i, config.registration.mirrors[i]);
                results.push({ mirror: i, status: 'ok' });
            } catch (e) {
                console.log(`  ❌ ОШИБКА: ${e.message}`);
                results.push({ mirror: i, status: 'error', error: e.message });
            }
        }

        // Итоговая сводка
        console.log(`\n\n${'═'.repeat(60)}`);
        console.log('📊 ИТОГОВАЯ СВОДКА');
        console.log(`${'═'.repeat(60)}`);
        results.forEach(r => {
            console.log(`  [${r.mirror}] ${r.status}${r.error ? ': ' + r.error : ''}`);
        });

    } catch (error) {
        console.error(`\n❌ ${error.message}`);
    } finally {
        await bm.close();
        console.log('\n🛑 Chrome закрыт.');
    }
}

main().catch(e => { console.error(e); process.exit(1); });
