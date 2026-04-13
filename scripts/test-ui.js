const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

async function testUI() {
    console.log('⏳ Запускаем сервер ui/server.js...');
    const serverProcess = spawn('node', [path.join(__dirname, '..', 'ui', 'server.js')]);

    // Ждем старта сервера
    await new Promise(r => setTimeout(r, 3000));

    console.log('🌐 Запускаем Headless Chrome для тестирования UI...');
    const browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });
    const page = await browser.newPage();

    await page.setViewport({ width: 1200, height: 850 });

    try {
        await page.goto('http://localhost:35890', { waitUntil: 'networkidle0' });
        console.log('✅ Интерфейс успешно загружен');

        await new Promise(r => setTimeout(r, 1500)); // Ждем подгрузки аккаунтов по fetch

        // 1. Скриншот главного окна
        const mainPath = path.join(__dirname, '..', 'ui_main_test.png');
        await page.screenshot({ path: mainPath });
        console.log(`📸 Скриншот главного окна сохранен: ${mainPath}`);

        // 2. Тест модального окна профиля (кликаем по первой строке)
        const rows = await page.$$('#accountsBody tr');
        let hasData = false;

        if (rows.length > 0) {
            const isEmptyContent = await page.evaluate(el => !!el.querySelector('.empty-state'), rows[0]);
            if (!isEmptyContent) {
                console.log('🖱️ Кликаем по первому профилю в таблице...');
                await rows[0].click();
                await new Promise(r => setTimeout(r, 1000)); // Ждем CSS анимацию

                const modalPath = path.join(__dirname, '..', 'ui_modal_test.png');
                await page.screenshot({ path: modalPath });
                console.log(`📸 Скриншот модального окна профиля сохранен: ${modalPath}`);

                console.log('❌ Закрываем модальное окно...');
                await page.click('#closeModalBtn');
                await new Promise(r => setTimeout(r, 500));
                hasData = true;
            }
        }

        if (!hasData) {
            console.log('ℹ️ Таблица аккаунтов пуста, модальное окно не протестировано.');
        }

        // 3. Тест селектора валюты
        console.log('🔄 Тестируем смену валюты на USDC...');
        await page.select('#currencySelect', 'USDC');

        // 4. Тест кнопки выхода (которая тушит сервер)
        console.log('🛑 Нажимаем кнопку "Выйти (Закрыть сервер)"...');
        // При клике на exit popup window.confirm ('Точно закрыть?')
        page.on('dialog', async dialog => {
            console.log('💬 Подтверждаем закрытие (confirm)...');
            await dialog.accept();
        });
        await page.click('#exitBtn');
        await new Promise(r => setTimeout(r, 1500));

        // Скриншот после отключения
        const exitPath = path.join(__dirname, '..', 'ui_exit_test.png');
        await page.screenshot({ path: exitPath });
        console.log(`📸 Скриншот после закрытия сохранен: ${exitPath}`);

        console.log('🎉 Все UI-тесты успешно пройдены!');

    } catch (e) {
        console.error('❌ Ошибка тестирования UI:', e);
    } finally {
        await browser.close();
        // Server will kill itself via /api/exit anyway, but just in case:
        try { serverProcess.kill(); } catch (e) { }
    }
}

testUI();
