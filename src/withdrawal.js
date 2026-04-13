// src/withdrawal.js — Модуль вывода средств (withdrawal)
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

// Вспомогательные функции
const { takeScreenshot, randomDelay } = (() => {
    try {
        const depositor = require('./depositor');
        return {
            takeScreenshot: async (page, accountId, name) => {
                try {
                    const screenshotsDir = path.join(__dirname, '..', 'screenshots');
                    if (!fs.existsSync(screenshotsDir)) fs.mkdirSync(screenshotsDir, { recursive: true });
                    const filename = `wd_${accountId}_${name}_${Date.now()}.png`;
                    await page.screenshot({ path: path.join(screenshotsDir, filename), fullPage: false });
                    logger.debug(`Скриншот: ${filename}`);
                } catch (e) { /* ignore */ }
            },
            randomDelay: async (range) => {
                const ms = range[0] + Math.random() * (range[1] - range[0]);
                await new Promise(r => setTimeout(r, ms));
            }
        };
    } catch (e) {
        return {
            takeScreenshot: async () => {},
            randomDelay: async (range) => {
                const ms = range[0] + Math.random() * (range[1] - range[0]);
                await new Promise(r => setTimeout(r, ms));
            }
        };
    }
})();

// Минимальный остаток на счете (ОБЯЗАТЕЛЬНО оставлять)
const MIN_BALANCE_KEEP = 0.20;

/**
 * Шаг 1: Навигация на страницу вывода
 */
async function navigateToWithdrawal(page, accountId) {
    logger.info('📍 Переход на страницу вывода средств...');

    const currentUrl = page.url();

    // Если уже на странице вывода
    if (currentUrl.includes('withdrawal')) {
        logger.info(`✅ Уже на странице вывода: ${currentUrl}`);
        await new Promise(r => setTimeout(r, 3000));
        await takeScreenshot(page, accountId, 'wd_01_withdrawal_page');
        return true;
    }

    // Способ 1: Через SPA-навигацию (клик по ссылке "Вывод средств")
    try {
        const linkClicked = await page.evaluate(() => {
            // Ищем ссылку "Вывод средств" в боковом меню
            const links = document.querySelectorAll('a.section-item, a[href*="withdrawal"], .account-side-bar-section a');
            for (const link of links) {
                const text = (link.textContent || '').trim().toLowerCase();
                const href = (link.getAttribute('href') || '').toLowerCase();
                if (text.includes('вывод') || href.includes('withdrawal')) {
                    link.click();
                    return `clicked: "${text}" (${href})`;
                }
            }
            return null;
        });

        if (linkClicked) {
            logger.info(`✅ Клик по ссылке: ${linkClicked}`);
            await new Promise(r => setTimeout(r, 5000)); // Ждём SPA навигацию
            await takeScreenshot(page, accountId, 'wd_01_withdrawal_page');
            return true;
        }
    } catch (e) {
        logger.debug(`Клик по ссылке: ${e.message}`);
    }

    // Способ 2: Прямая навигация через URL
    try {
        const baseUrl = currentUrl.match(/https?:\/\/[^/]+/)?.[0];
        if (baseUrl) {
            const withdrawalUrl = `${baseUrl}/ru/compact/account/withdrawal`;
            logger.info(`📍 Прямой переход: ${withdrawalUrl}`);
            await page.goto(withdrawalUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await new Promise(r => setTimeout(r, 5000));
            await takeScreenshot(page, accountId, 'wd_01_withdrawal_page');
            return true;
        }
    } catch (e) {
        logger.warn(`Прямая навигация: ${e.message}`);
    }

    logger.error('❌ Не удалось перейти на страницу вывода');
    return false;
}

/**
 * Шаг 2: Выбрать USDT (ERC20) для вывода
 * Использует координатный клик для элементов внутри iframe (аналогично депозиту)
 */
async function selectWithdrawalUSDTERC20(page, accountId) {
    logger.info('🔍 Ищем карточку USDT (ERC20) для вывода...');

    const MAX_ATTEMPTS = 3;
    
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        logger.info(`Попытка ${attempt}/${MAX_ATTEMPTS}...`);
        
        // Закрываем попапы
        await page.keyboard.press('Escape').catch(() => {});
        await new Promise(r => setTimeout(r, 1000));

        // Попытка 1: Клик в main frame
        let clicked = false;
        try {
            clicked = await page.evaluate(() => {
                const cards = Array.from(document.querySelectorAll('.masonry-card, .card, button, a, [role="button"]'));
                for (const card of cards) {
                    const text = (card.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase();
                    if ((text.includes('USDT') || text.includes('TETHER')) && text.includes('ERC') && card.offsetHeight > 0) {
                        card.scrollIntoView({ block: 'center' });
                        card.click();
                        return true;
                    }
                }
                return false;
            });
        } catch (e) {}

        if (clicked) {
            logger.info(`📍 USDT карточка найдена и кликнута (main)`);
            await new Promise(r => setTimeout(r, 5000));
            
            // Проверка: форма загрузилась?
            const formLoaded = await checkWithdrawalFormLoaded(page);
            if (formLoaded) {
                await takeScreenshot(page, accountId, 'wd_02_usdt_selected');
                return true;
            }
            logger.warn('⚠️ Форма не загрузилась после клика в main, пробуем iframe...');
        }

        // Попытка 2: Ищем в iframe и кликаем прямо в нём
        for (const frame of page.frames()) {
            if (frame === page.mainFrame()) continue;
            try {
                const frameClicked = await frame.evaluate(() => {
                    // Ищем по селекторам, или просто по тексту Tether / USDT
                    const els = Array.from(document.querySelectorAll('.masonry-card, .card, .payment-method, button, a, div[role="button"]'));
                    for (const el of els) {
                         // Проверяем видимость
                         if (el.offsetWidth === 0 || el.offsetHeight === 0) continue;
                         
                         const text = (el.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase();
                         if ((text.includes('USDT') || text.includes('TETHER')) && text.includes('ERC')) {
                             el.scrollIntoView({ block: 'center' });
                             
                             // Кликаем по самому элементу или по его родителям-контейнерам чтобы пробило
                             el.click();
                             return text.substring(0, 50);
                         }
                    }
                    return null;
                });

                if (!frameClicked) continue;

                logger.info(`📍 USDT карточка кликнута (iframe): ${frameClicked}`);

                await new Promise(r => setTimeout(r, 5000));

                // Проверка: форма загрузилась?
                const formLoaded = await checkWithdrawalFormLoaded(page);
                if (formLoaded) {
                    await takeScreenshot(page, accountId, 'wd_02_usdt_selected');
                    return true;
                }

                // Пробуем повторный клик чуть ниже (на заголовок карточки)
                logger.warn('⚠️ Форма не загрузилась, пробуем клик выше...');
                await page.mouse.click(clickX, clickY - 30);
                await new Promise(r => setTimeout(r, 5000));

                const formLoaded2 = await checkWithdrawalFormLoaded(page);
                if (formLoaded2) {
                    await takeScreenshot(page, accountId, 'wd_02_usdt_selected');
                    return true;
                }
            } catch (e) {
                logger.debug(`iframe error: ${e.message}`);
            }
        }

        await new Promise(r => setTimeout(r, 3000));
    }

    logger.error('❌ Карточка USDT (ERC20) для вывода не найдена или форма не загрузилась');
    await takeScreenshot(page, accountId, 'wd_02_usdt_not_found');
    return false;
}

/**
 * Проверяет, загрузилась ли форма вывода после клика по карточке
 */
async function checkWithdrawalFormLoaded(page) {
    const framesToTry = [page.mainFrame(), ...page.frames().filter(f => f !== page.mainFrame())];
    for (const frame of framesToTry) {
        try {
            const hasForm = await frame.evaluate(() => {
                const amountInput = document.querySelector('input[name="amount"]');
                const addressInput = document.querySelector('input[name="cryptoAccount.accountAddress"]');
                const passwordInput = document.querySelector('input[name="accountPassword"]');
                // Форма вывода: хотя бы 2 из 3 полей присутствуют
                let count = 0;
                if (amountInput) count++;
                if (addressInput) count++;
                if (passwordInput) count++;
                return count >= 2;
            });
            if (hasForm) {
                logger.info(`✅ Форма вывода загрузилась (${frame === page.mainFrame() ? 'main' : 'iframe'})`);
                return true;
            }
        } catch (e) { /* skip */ }
    }
    return false;
}

/**
 * Шаг 3: Получить баланс со страницы
 * Ищем: <div class="balance"><span class="total">1.00</span>
 */
async function getAccountBalance(page) {
    logger.info('💰 Получаем баланс счёта...');

    // Пробуем в main frame и во всех фреймах
    const framesToTry = [page.mainFrame(), ...page.frames().filter(f => f !== page.mainFrame())];

    for (const frame of framesToTry) {
        try {
            const balance = await frame.evaluate(() => {
                // Стратегия 1: span.total внутри .balance
                const totalSpan = document.querySelector('.balance .total, .balance span.total');
                if (totalSpan) {
                    const val = parseFloat(totalSpan.textContent.trim().replace(',', '.'));
                    if (!isNaN(val)) return val;
                }

                // Стратегия 2: любой элемент с классом balance/total
                const balEls = document.querySelectorAll('[class*="balance"], [class*="total"]');
                for (const el of balEls) {
                    const text = (el.textContent || '').trim();
                    const match = text.match(/([\d.,]+)\s*USDT/i);
                    if (match) {
                        const val = parseFloat(match[1].replace(',', '.'));
                        if (!isNaN(val) && val > 0) return val;
                    }
                }

                // Стратегия 3: в хедере где отображается баланс
                const header = document.querySelector('.accountPageContainer, .header, nav');
                if (header) {
                    const text = header.textContent || '';
                    const match = text.match(/([\d.,]+)\s*USDT/i);
                    if (match) {
                        const val = parseFloat(match[1].replace(',', '.'));
                        if (!isNaN(val)) return val;
                    }
                }

                return null;
            });

            if (balance !== null) {
                logger.info(`💰 Баланс: ${balance} USDT (${frame === page.mainFrame() ? 'main' : 'iframe'})`);
                return balance;
            }
        } catch (e) { /* skip */ }
    }

    logger.error('❌ Не удалось получить баланс');
    return null;
}

/**
 * Шаг 4: Создать новый кошелёк для получения вывода
 * Используем wallet.js из проекта deposit
 */
async function createWithdrawalWallet() {
    logger.info('🔑 Создаём новый кошелёк для вывода...');

    try {
        const wallet = require('./wallet');
        const newWallet = await wallet.createNewWallet();

        logger.info(`✅ Новый кошелёк создан!`);
        logger.info(`   EOA: ${newWallet.eoaAddress}`);
        logger.info(`   Safe: ${newWallet.safeAddress}`);

        // Сохраняем в wallets.json проекта deposit
        const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf-8'));
        const walletsPath = config.deposit?.walletsPath || 'c:/Project/deposit/dist/wallets.json';

        if (fs.existsSync(walletsPath)) {
            const wallets = JSON.parse(fs.readFileSync(walletsPath, 'utf-8'));
            wallets.push({
                privateKey: newWallet.privateKey,
                safeAddress: newWallet.safeAddress,
                eoaAddress: newWallet.eoaAddress,
                balance: '0.00',
                name: `Вывод #${wallets.length + 1} (${new Date().toISOString().split('T')[0]})`
            });
            fs.writeFileSync(walletsPath, JSON.stringify(wallets, null, 2), 'utf-8');
            logger.info(`💾 Кошелёк сохранён в ${path.basename(walletsPath)}`);
        }

        return newWallet;
    } catch (error) {
        logger.error(`❌ Ошибка создания кошелька: ${error.message}`);
        return null;
    }
}

/**
 * Шаг 5: Заполнить форму вывода и отправить
 * 
 * Поля формы (из DOM):
 * - input[name="amount"] — сумма вывода
 * - input[name="cryptoAccount.accountAddress"] — адрес USDT (ERC20)
 * - input[name="accountPassword"] — пароль от счёта
 * - button#submit — кнопка "ОТПРАВИТЬ"
 */
async function fillWithdrawalForm(page, accountId, withdrawAmount, toAddress, accountPassword) {
    logger.info(`📝 Заполняем форму вывода...`);
    logger.info(`   Сумма: ${withdrawAmount} USDT`);
    logger.info(`   Адрес: ${toAddress}`);
    logger.info(`   Пароль: ${'*'.repeat(accountPassword.length)}`);

    // Ищем форму — может быть в main frame или iframe
    const framesToTry = [page.mainFrame(), ...page.frames().filter(f => f !== page.mainFrame())];
    let targetFrame = null;

    for (const frame of framesToTry) {
        try {
            const hasForm = await frame.evaluate(() => {
                const amountInput = document.querySelector('input[name="amount"]');
                const addressInput = document.querySelector('input[name="cryptoAccount.accountAddress"]');
                return !!(amountInput && addressInput);
            });
            if (hasForm) {
                targetFrame = frame;
                logger.info(`🔍 Форма вывода найдена в ${frame === page.mainFrame() ? 'main frame' : 'iframe'}`);
                break;
            }
        } catch (e) { /* skip */ }
    }

    if (!targetFrame) {
        logger.error('❌ Форма вывода не найдена');
        await takeScreenshot(page, accountId, 'wd_03_form_not_found');
        return false;
    }

    // === Заполняем поле суммы ===
    logger.info('💰 Вводим сумму...');
    const amountFilled = await targetFrame.evaluate((amount) => {
        const input = document.querySelector('input[name="amount"]');
        if (!input) return false;

        // React-совместимый setter
        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        ).set;
        nativeSetter.call(input, String(amount));
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.focus();
        return true;
    }, withdrawAmount).catch(() => false);

    if (!amountFilled) {
        // Резервный метод: клик + ввод через Puppeteer
        try {
            await page.click('input[name="amount"]');
            await page.keyboard.down('Control');
            await page.keyboard.press('a');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            await page.type('input[name="amount"]', String(withdrawAmount), { delay: 80 });
            logger.info('✅ Сумма введена через Puppeteer type');
        } catch (e) {
            logger.error(`❌ Не удалось ввести сумму: ${e.message}`);
            return false;
        }
    } else {
        logger.info(`✅ Сумма введена: ${withdrawAmount}`);
    }

    await randomDelay([500, 1000]);

    // === Заполняем адрес ===
    logger.info('📍 Вводим адрес...');
    const addressFilled = await targetFrame.evaluate((addr) => {
        const input = document.querySelector('input[name="cryptoAccount.accountAddress"]');
        if (!input) return false;

        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        ).set;
        nativeSetter.call(input, addr);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.focus();
        return true;
    }, toAddress).catch(() => false);

    if (!addressFilled) {
        try {
            await page.click('input[name="cryptoAccount.accountAddress"]');
            await page.keyboard.down('Control');
            await page.keyboard.press('a');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            await page.type('input[name="cryptoAccount.accountAddress"]', toAddress, { delay: 50 });
            logger.info('✅ Адрес введён через Puppeteer type');
        } catch (e) {
            logger.error(`❌ Не удалось ввести адрес: ${e.message}`);
            return false;
        }
    } else {
        logger.info(`✅ Адрес введён: ${toAddress.substring(0, 12)}...`);
    }

    await randomDelay([500, 1000]);

    // === Заполняем пароль ===
    logger.info('🔒 Вводим пароль...');
    const passFilled = await targetFrame.evaluate((pass) => {
        const input = document.querySelector('input[name="accountPassword"]');
        if (!input) return false;

        const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, 'value'
        ).set;
        nativeSetter.call(input, pass);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.focus();
        return true;
    }, accountPassword).catch(() => false);

    if (!passFilled) {
        try {
            await page.click('input[name="accountPassword"]');
            await page.keyboard.down('Control');
            await page.keyboard.press('a');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            await page.type('input[name="accountPassword"]', accountPassword, { delay: 80 });
            logger.info('✅ Пароль введён через Puppeteer type');
        } catch (e) {
            logger.error(`❌ Не удалось ввести пароль: ${e.message}`);
            return false;
        }
    } else {
        logger.info(`✅ Пароль введён`);
    }

    await takeScreenshot(page, accountId, 'wd_04_form_filled');
    await randomDelay([1000, 2000]);

    // === Нажимаем "ОТПРАВИТЬ" ===
    logger.info('📨 Нажимаем кнопку "ОТПРАВИТЬ"...');

    // Сначала пробуем через evaluate во всех фреймах
    let submitted = false;
    const allFrames = [page.mainFrame(), ...page.frames().filter(f => f !== page.mainFrame())];

    for (const frame of allFrames) {
        if (submitted) break;
        try {
            const btnResult = await frame.evaluate(() => {
                // По id
                const submitBtn = document.querySelector('button#submit');
                if (submitBtn && submitBtn.offsetHeight > 0) {
                    // Убираем disabled если есть
                    submitBtn.removeAttribute('disabled');
                    submitBtn.click();
                    return `#submit: "${submitBtn.textContent.trim()}"`;
                }

                // По тексту
                for (const btn of document.querySelectorAll('button')) {
                    const text = (btn.textContent || '').trim().toLowerCase();
                    if (btn.offsetHeight > 0 && (text.includes('отправить') || text.includes('submit'))) {
                        btn.removeAttribute('disabled');
                        btn.click();
                        return `text: "${btn.textContent.trim()}"`;
                    }
                }
                return null;
            });

            if (btnResult) {
                submitted = true;
                logger.info(`✅ Кнопка нажата: ${btnResult} (${frame === page.mainFrame() ? 'main' : 'iframe'})`);
            }
        } catch (e) { /* skip */ }
    }

    // Fallback: Puppeteer click
    if (!submitted) {
        try {
            await page.click('button#submit');
            submitted = true;
            logger.info('✅ Кнопка нажата через Puppeteer click');
        } catch (e) {
            logger.warn(`Puppeteer click: ${e.message}`);
        }
    }

    if (!submitted) {
        logger.error('❌ Кнопка "ОТПРАВИТЬ" не найдена');
        await takeScreenshot(page, accountId, 'wd_05_submit_not_found');
        return false;
    }

    await new Promise(r => setTimeout(r, 5000));
    await takeScreenshot(page, accountId, 'wd_05_submitted');
    return true;
}

/**
 * Полный флоу вывода средств
 * 
 * @param {Page} page - Puppeteer page (залогинен)
 * @param {Object} account - объект аккаунта { id, username, password, ... }
 * @param {Browser} browser - Puppeteer browser
 * @param {Object} withdrawalCfg - конфигурация вывода
 */
async function performWithdrawal(page, account, browser, withdrawalCfg = {}) {
    const accountId = account.id || account.username;
    logger.info(`\n=== 💸 ВЫВОД СРЕДСТВ для аккаунта #${accountId} ===`);

    try {
        // Шаг 1: Навигация на страницу вывода
        const withdrawalPageLoaded = await navigateToWithdrawal(page, accountId);
        if (!withdrawalPageLoaded) {
            return { success: false, error: 'Не удалось перейти на страницу вывода' };
        }
        await randomDelay([2000, 4000]);

        // Шаг 2: Выбрать USDT (ERC20)
        const usdtSelected = await selectWithdrawalUSDTERC20(page, accountId);
        if (!usdtSelected) {
            return { success: false, error: 'Не удалось выбрать USDT (ERC20) для вывода' };
        }
        await randomDelay([2000, 4000]);

        // Шаг 3: Получить баланс со страницы
        const balance = await getAccountBalance(page);
        if (balance === null || balance <= 0) {
            logger.error(`❌ Баланс = ${balance}, вывод невозможен`);
            return { success: false, error: `Баланс ${balance} USDT — недостаточно для вывода` };
        }

        // Рассчитываем сумму вывода: баланс минус MIN_BALANCE_KEEP (0.20)
        const withdrawAmount = parseFloat((balance - MIN_BALANCE_KEEP).toFixed(2));
        logger.info(`💰 Баланс: ${balance} USDT`);
        logger.info(`💰 К выводу: ${withdrawAmount} USDT (оставляем ${MIN_BALANCE_KEEP} USDT)`);

        if (withdrawAmount <= 0) {
            logger.error(`❌ После удержания ${MIN_BALANCE_KEEP} вывод невозможен (${withdrawAmount} USDT)`);
            return { success: false, error: `Нечего выводить: ${balance} - ${MIN_BALANCE_KEEP} = ${withdrawAmount}` };
        }

        // Шаг 4: Создать новый кошелёк для вывода
        const newWallet = await createWithdrawalWallet();
        if (!newWallet) {
            return { success: false, error: 'Не удалось создать кошелёк для вывода' };
        }

        const toAddress = newWallet.safeAddress;
        logger.info(`📍 Адрес для вывода: ${toAddress}`);

        // Шаг 5: Заполнить форму и отправить
        const accountPassword = account.password;
        if (!accountPassword) {
            logger.error('❌ Пароль аккаунта не найден');
            return { success: false, error: 'Пароль аккаунта не найден' };
        }

        const formSubmitted = await fillWithdrawalForm(page, accountId, withdrawAmount, toAddress, accountPassword);
        if (!formSubmitted) {
            return { success: false, error: 'Не удалось заполнить или отправить форму вывода' };
        }

        // Шаг 6: Проверяем: появился ли попап с кодом подтверждения?
        await new Promise(r => setTimeout(r, 3000));
        await takeScreenshot(page, accountId, 'wd_06_after_submit');

        const verificationRequired = await page.evaluate(() => {
            const body = document.body?.textContent || '';
            const hasVerification = body.includes('код') || body.includes('code') || body.includes('верификац') ||
                                    body.includes('verification') || body.includes('подтвержд');
            const hasEmailInput = !!document.querySelector('input[name*="code"], input[name*="verification"], input[placeholder*="код"]');
            return hasVerification || hasEmailInput;
        }).catch(() => false);

        if (verificationRequired) {
            logger.info('📧 Требуется email-подтверждение (код верификации)');
            logger.info('⏸️ Остановка: обработка верификации не реализована');
        }

        logger.info(`\n✅ ВЫВОД ИНИЦИИРОВАН!`);
        logger.info(`   Аккаунт: ${account.username}`);
        logger.info(`   Сумма: ${withdrawAmount} USDT`);
        logger.info(`   Адрес: ${toAddress}`);
        logger.info(`   Остаток: ${MIN_BALANCE_KEEP} USDT`);

        return {
            success: true,
            withdrawAmount,
            toAddress,
            toWalletPrivateKey: newWallet.privateKey,
            balance,
            remainingBalance: MIN_BALANCE_KEEP,
            verificationRequired,
        };

    } catch (error) {
        logger.error(`❌ Ошибка вывода #${accountId}: ${error.message}`);
        await takeScreenshot(page, accountId, 'wd_error').catch(() => {});
        return { success: false, error: error.message };
    }
}

module.exports = {
    navigateToWithdrawal,
    selectWithdrawalUSDTERC20,
    getAccountBalance,
    createWithdrawalWallet,
    fillWithdrawalForm,
    performWithdrawal,
    MIN_BALANCE_KEEP,
};
