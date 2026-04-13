/**
 * Диагностика полей формы регистрации
 * Смотрим реальную HTML-структуру #dob, #securityAns, #captcha
 */
const { BrowserManager } = require('../src/browser');
const { navigateToRegistration } = require('../src/registrator');
const config = require('../config.json');
const path = require('path');
const fs = require('fs');

async function diagnose() {
    const profilePath = path.resolve(__dirname, '..', 'profiles', 'diagnose_tmp');
    if (!fs.existsSync(profilePath)) fs.mkdirSync(profilePath, { recursive: true });

    const bm = new BrowserManager(config.chrome);
    const { page } = await bm.launch({ userDataDir: profilePath });

    const mirror = config.registration.mirrors[3];
    await navigateToRegistration(page, mirror);
    await new Promise(r => setTimeout(r, 2000));

    // Дамп полей
    const fieldIds = ['dob', 'securityAns', 'captcha', 'securityQns', 'firstName'];
    for (const id of fieldIds) {
        const info = await page.evaluate((fieldId) => {
            const el = document.getElementById(fieldId);
            if (!el) return { exists: false };
            return {
                exists: true,
                tagName: el.tagName,
                type: el.type,
                placeholder: el.placeholder,
                className: el.className,
                outerHTML: el.outerHTML.substring(0, 500),
                value: el.value,
                hasReactProp: !!el._reactFiber || !!el.__reactFiber,
                isReadOnly: el.readOnly,
                isDisabled: el.disabled
            };
        }, id);
        console.log(`\n=== #${id} ===`);
        console.log(JSON.stringify(info, null, 2));
    }

    // Пробуем ввести в securityAns разными способами
    console.log('\n=== Тест ввода в #securityAns ===');

    // Способ 1: evaluate прямой set
    await page.evaluate(() => {
        const el = document.getElementById('securityAns');
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
        if (setter && setter.set) setter.set.call(el, 'TestValue1');
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const v1 = await page.$eval('#securityAns', el => el.value).catch(() => 'not found');
    console.log('Способ 1 (evaluate set):', v1);

    // Сбрасываем
    await page.evaluate(() => { const el = document.getElementById('securityAns'); if (el) el.value = ''; });
    await new Promise(r => setTimeout(r, 500));

    // Способ 2: focus + keyboard.type
    await page.focus('#securityAns').catch(() => { });
    await page.keyboard.type('TestValue2', { delay: 50 });
    const v2 = await page.$eval('#securityAns', el => el.value).catch(() => 'not found');
    console.log('Способ 2 (focus+keyboard.type):', v2);

    // Способ 3: click + keyboard.type
    await page.evaluate(() => { const el = document.getElementById('securityAns'); if (el) el.value = ''; });
    await page.click('#securityAns');
    await new Promise(r => setTimeout(r, 300));
    await page.keyboard.type('TestValue3', { delay: 50 });
    const v3 = await page.$eval('#securityAns', el => el.value).catch(() => 'not found');
    console.log('Способ 3 (click+keyboard.type):', v3);

    // Тест дат
    console.log('\n=== Тест ввода даты в #dob ===');
    // Способ A: type digits only (no dashes)
    await page.click('#dob', { clickCount: 3 });
    await page.keyboard.type('19121985', { delay: 50 });
    const dobA = await page.$eval('#dob', el => el.value).catch(() => 'not found');
    console.log('Дата (цифры без дефисов "19121985"):', dobA);

    // Способ B: type with dashes
    await page.evaluate(() => { const el = document.getElementById('dob'); if (el) el.value = ''; });
    await page.click('#dob', { clickCount: 3 });
    await page.keyboard.type('19-12-1985', { delay: 50 });
    const dobB = await page.$eval('#dob', el => el.value).catch(() => 'not found');
    console.log('Дата (с дефисами "19-12-1985"):', dobB);

    await page.screenshot({ path: path.resolve(__dirname, '..', 'screenshots', 'diagnose_form.png'), fullPage: true });
    console.log('\n📸 Скриншот saved: screenshots/diagnose_form.png');

    await bm.close();
    // Очищаем профиль
    fs.rmSync(profilePath, { recursive: true, force: true });
}

diagnose().catch(e => { console.error(e); process.exit(1); });
