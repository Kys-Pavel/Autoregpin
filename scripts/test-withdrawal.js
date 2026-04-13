// scripts/test-withdrawal.js — Тест вывода средств на существующем аккаунте
// Использование: node scripts/test-withdrawal.js
// Открывает Chrome, логинится и выполняет вывод

const path = require('path');
const fs = require('fs');
const { BrowserManager } = require('../src/browser');
const { performWithdrawal } = require('../src/withdrawal');
const { dismissTermsPopup, dismiss2FAPopup, dismissChromePopups, getActivePage } = require('../src/depositor');

// Тестовый аккаунт (уже задепозичен)
const TEST_ACCOUNT = {
    id: 'test-wd',
    username: 'petlyteamkiller',
    password: 'PVeC7Y5HhZ!a',
};

// Загрузка конфига
function loadConfig() {
    const configPath = path.resolve(__dirname, '../config.json');
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

async function main() {
    const config = loadConfig();

    console.log('🌐 Запускаем Chrome...');
    const bm = new BrowserManager(config.chrome);
    await bm.launch();
    
    const browser = bm.getBrowser();
    let page = bm.getPage();

    try {
        // Шаг 1: Перейти на сайт и залогиниться
        const baseUrl = 'https://www.thundercrest65.xyz';
        const loginUrl = `${baseUrl}/ru/compact/account/login`;

        console.log(`📍 Переход на ${loginUrl}...`);
        await page.goto(loginUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise(r => setTimeout(r, 5000));

        // Заполняем логин
        console.log(`🔐 Логинимся: ${TEST_ACCOUNT.username}...`);

        // Ищем поле логина
        await page.evaluate((username) => {
            const inputs = document.querySelectorAll('input');
            for (const input of inputs) {
                const name = (input.name || '').toLowerCase();
                const placeholder = (input.placeholder || '').toLowerCase();
                if (name.includes('username') || name.includes('login') || name.includes('customerId') ||
                    placeholder.includes('имя') || placeholder.includes('логин') || placeholder.includes('username') ||
                    placeholder.includes('id')) {
                    const nativeSetter = Object.getOwnPropertyDescriptor(
                        window.HTMLInputElement.prototype, 'value'
                    ).set;
                    nativeSetter.call(input, username);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    console.log('login field found:', input.name, input.placeholder);
                    return true;
                }
            }
            return false;
        }, TEST_ACCOUNT.username);

        await new Promise(r => setTimeout(r, 500));

        // Ищем поле пароля
        await page.evaluate((password) => {
            const inputs = document.querySelectorAll('input[type="password"]');
            for (const input of inputs) {
                const nativeSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value'
                ).set;
                nativeSetter.call(input, password);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }
            return false;
        }, TEST_ACCOUNT.password);

        await new Promise(r => setTimeout(r, 500));

        // Нажимаем кнопку входа
        const loginResult = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button[type="submit"], button');
            for (const btn of buttons) {
                const text = (btn.textContent || '').trim().toLowerCase();
                if (text.includes('вход') || text.includes('войти') || text.includes('login') || text.includes('sign in')) {
                    btn.click();
                    return text;
                }
            }
            // Пробуем submit формы
            const form = document.querySelector('form');
            if (form) {
                const submitBtn = form.querySelector('button[type="submit"]');
                if (submitBtn) { submitBtn.click(); return 'submit-btn'; }
                form.submit();
                return 'form.submit()';
            }
            return null;
        });

        console.log(`🔐 Нажата кнопка: ${loginResult}`);
        console.log('⏳ Ожидание входа...');
        await new Promise(r => setTimeout(r, 10000));

        // Проверяем новые табы
        page = await getActivePage(browser, page);
        console.log(`📍 URL после логина: ${page.url()}`);

        // Снимаем попапы
        await dismissChromePopups(page);
        await dismissTermsPopup(page, TEST_ACCOUNT.id);
        await new Promise(r => setTimeout(r, 2000));
        await dismiss2FAPopup(page, TEST_ACCOUNT.id);
        await new Promise(r => setTimeout(r, 2000));
        await dismissChromePopups(page);

        // Шаг 2: Выполняем вывод
        const withdrawalCfg = config.withdrawal || {};
        const result = await performWithdrawal(page, TEST_ACCOUNT, browser, withdrawalCfg);

        console.log('\n📊 === РЕЗУЛЬТАТ ===');
        console.log(JSON.stringify(result, null, 2));

        if (result.success) {
            console.log(`\n✅ Вывод инициирован!`);
            console.log(`   Сумма: ${result.withdrawAmount} USDT`);
            console.log(`   На адрес: ${result.toAddress}`);
            console.log(`   Верификация: ${result.verificationRequired ? 'ТРЕБУЕТСЯ' : 'нет'}`);
        } else {
            console.log(`\n❌ Ошибка: ${result.error}`);
        }

        // Оставляем браузер открытым для инспекции
        console.log('\n🖥️ Браузер оставлен открытым. Нажмите Ctrl+C для завершения.');
        await new Promise(() => {}); // Не закрываем

    } catch (error) {
        console.error('❌ Ошибка:', error.message);
        console.error(error.stack);
        // browser всё равно оставляем открытым
        console.log('\n🖥️ Браузер оставлен открытым. Нажмите Ctrl+C.');
        await new Promise(() => {});
    }
}

main().catch(console.error);
