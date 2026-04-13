const logger = require('./logger');
const path = require('path');
const fs = require('fs');

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
 * Скриншот текущего состояния страницы (депозит)
 */
async function takeScreenshot(page, accountId, step) {
    const screenshotsDir = path.resolve(__dirname, '..', 'screenshots');
    if (!fs.existsSync(screenshotsDir)) {
        fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    const filename = `dep_${accountId}_${step}_${Date.now()}.png`;
    const filepath = path.join(screenshotsDir, filename);
    try {
        await page.screenshot({ path: filepath, fullPage: false });
        logger.debug(`📸 Скриншот: ${filepath}`);
    } catch (e) {
        logger.warn(`Не удалось сделать скриншот: ${e.message}`);
    }
    return filepath;
}

/**
 * Получить активную страницу (переключиться на последний открытый таб)
 * Сайт может открыть новый таб после регистрации
 */
async function getActivePage(browser, currentPage) {
    try {
        const pages = await browser.pages();
        
        // Закрываем ненужные табы для экономии памяти
        if (pages.length > 1) {
            for (const p of pages) {
                const url = p.url();
                if (url === 'about:blank' || url.includes('chrome-error')) {
                    try { await p.close(); } catch (e) { /* ignore */ }
                }
            }
        }
        
        const remainingPages = await browser.pages();
        if (remainingPages.length > 0) {
            const realPages = remainingPages.filter(p => !p.url().includes('about:blank') && !p.url().includes('chrome-error'));
            if (realPages.length > 0) {
                const lastPage = realPages[realPages.length - 1];
                if (lastPage !== currentPage) {
                    logger.info(`🔀 Переключаемся на новый таб: ${lastPage.url().substring(0, 80)}`);
                    await lastPage.bringToFront();
                    return lastPage;
                }
            }
        }
    } catch (e) {
        logger.debug(`getActivePage: ${e.message}`);
    }
    return currentPage;
}

/**
 * Шаг 1: Закрыть попап "Условия и положения" — кнопка "Продолжить"
 * Из DevTools скриншота пользователя:
 *   div.terms-conditions.show → div.tc-dialog → div.tc-modal-content
 *   div.s-button-footer → button.s-button.btn-cancel ("Отменить")
 *                        → button.s-button.btn-handle ("Продолжить")
 *   div.s-info-footer → чекбокс "Я прочитал(а) и принимаю"
 */
async function dismissTermsPopup(page, accountId) {
    logger.info('⏳ Ожидаем попап "Условия и положения"...');

    const MAX_WAIT = 8000; // 8 секунд максимум (оптимизировано)
    const POLL_INTERVAL = 500;
    let elapsed = 0;

    while (elapsed < MAX_WAIT) {
        const found = await page.evaluate(() => {
            // Ищем модалку "Условия и положения" — точные селекторы из DevTools
            const modal = document.querySelector('.terms-conditions.show') ||
                          document.querySelector('.terms-conditions') ||
                          document.querySelector('.tc-dialog') ||
                          document.querySelector('.tc-modal-content') ||
                          document.querySelector('[class*="tc-modal"]');

            if (!modal || modal.offsetHeight === 0) return null;

            // ШАГ A: Ищем и кликаем ЧЕКБОКС "Я прочитал(а) и принимаю"
            // Из DevTools: чекбокс находится внутри .s-info-footer или рядом с текстом "прочитал"
            const checkboxSelectors = [
                '.s-info-footer input[type="checkbox"]',
                '.tc-modal-content input[type="checkbox"]',
                '.tc-dialog input[type="checkbox"]',
                '.terms-conditions input[type="checkbox"]'
            ];

            for (const sel of checkboxSelectors) {
                const checkboxes = document.querySelectorAll(sel);
                for (const cb of checkboxes) {
                    // Проверяем что чекбокс связан с текстом "прочитал" / "принимаю"
                    const parent = cb.closest('.terms-conditions') || cb.closest('.tc-dialog') || cb.closest('.tc-modal-content') || cb.closest('.modal-content');
                    if (parent) {
                        const nearText = (parent.textContent || '').toLowerCase();
                        if (nearText.includes('прочитал') || nearText.includes('принимаю') || 
                            nearText.includes('условия') || nearText.includes('terms')) {
                            if (!cb.checked) {
                                cb.click();
                                // Также пробуем ставить checked напрямую + dispatch
                                cb.checked = true;
                                cb.dispatchEvent(new Event('change', { bubbles: true }));
                                cb.dispatchEvent(new Event('click', { bubbles: true }));
                                return 'CHECKBOX_SET';
                            }
                        }
                    }
                }
            }

            // Также пробуем найти label с текстом и кликнуть по нему
            const labels = document.querySelectorAll('label, span, div');
            for (const lbl of labels) {
                const text = (lbl.textContent || '').toLowerCase();
                if ((text.includes('прочитал') || text.includes('принимаю')) && text.length < 100) {
                    // Ищем ближайший checkbox
                    const cb = lbl.querySelector('input[type="checkbox"]') ||
                               lbl.parentElement?.querySelector('input[type="checkbox"]');
                    if (cb && !cb.checked) {
                        lbl.click(); // Клик по label тоже переключает checkbox
                        cb.checked = true;
                        cb.dispatchEvent(new Event('change', { bubbles: true }));
                        return 'CHECKBOX_SET_VIA_LABEL';
                    }
                }
            }

            // ШАГ Б: Ищем кнопку "Продолжить" и кликаем
            const btnSelectors = [
                // Точные из DevTools:
                '.s-button-footer button.btn-handle',
                'button.s-button.btn-handle',
                '.tc-dialog button.btn-handle',
                '.tc-modal-content button.btn-handle',
                '.terms-conditions button.btn-handle',
                'button.btn-handle',
                '.modal-footer .btn-primary'
            ];

            for (const sel of btnSelectors) {
                const btn = document.querySelector(sel);
                if (btn && btn.offsetHeight > 0 && btn.offsetWidth > 0) {
                    const text = (btn.textContent || '').trim().toLowerCase();
                    if (text.includes('продолжить') || text.includes('continue') ||
                        text.includes('accept') || text.includes('принять')) {
                        // Проверяем что кнопка не disabled
                        if (!btn.disabled && !btn.classList.contains('disabled')) {
                            btn.click();
                            return `BUTTON_CLICKED: "${btn.textContent.trim()}" (${sel})`;
                        } else {
                            return 'BUTTON_DISABLED'; // Чекбокс может быть ещё не работает
                        }
                    }
                }
            }

            // Fallback: ищем по тексту среди всех кнопок
            const allBtns = document.querySelectorAll('button, a[role="button"], input[type="submit"]');
            for (const btn of allBtns) {
                if (btn.offsetHeight > 0 && btn.offsetWidth > 0) {
                    const text = (btn.textContent || btn.value || '').trim().toLowerCase();
                    if ((text.includes('продолжить') || text.includes('continue')) && text.length < 30) {
                        if (!btn.disabled) {
                            btn.click();
                            return `BUTTON_CLICKED_TEXT: "${btn.textContent.trim()}"`;
                        }
                    }
                }
            }

            return null;
        });

        if (found) {
            if (found === 'CHECKBOX_SET' || found === 'CHECKBOX_SET_VIA_LABEL') {
                logger.info(`✅ Чекбокс условий отмечен`);
                await takeScreenshot(page, accountId, 'dep_01a_checkbox_set');
                await new Promise(r => setTimeout(r, 500)); // Ждём активации кнопки (оптимизировано)
                // Теперь кликаем по кнопке "Продолжить"
                const btnClicked = await page.evaluate(() => {
                    const btnSelectors = [
                        '.s-button-footer button.btn-handle',
                        'button.s-button.btn-handle',
                        '.tc-dialog button.btn-handle',
                        'button.btn-handle'
                    ];
                    for (const sel of btnSelectors) {
                        const btn = document.querySelector(sel);
                        if (btn && btn.offsetHeight > 0 && !btn.disabled) {
                            const text = (btn.textContent || '').toLowerCase();
                            if (text.includes('продолжить') || text.includes('continue')) {
                                btn.click();
                                return `"${btn.textContent.trim()}"`;
                            }
                        }
                    }
                    // Fallback
                    const all = document.querySelectorAll('button');
                    for (const btn of all) {
                        const text = (btn.textContent || '').toLowerCase();
                        if (text.includes('продолжить') && btn.offsetHeight > 0 && !btn.disabled) {
                            btn.click();
                            return `fallback: "${btn.textContent.trim()}"`;
                        }
                    }
                    return null;
                });
                if (btnClicked) {
                    logger.info(`✅ Попап условий закрыт: кнопка ${btnClicked}`);
                } else {
                    logger.warn('⚠️ Чекбокс отмечен, но кнопка "Продолжить" не найдена или disabled');
                }
                await takeScreenshot(page, accountId, 'dep_01b_terms_closed');
                await new Promise(r => setTimeout(r, 1000)); // Оптимизировано: 3000 → 1000
                return true;
            } else if (found === 'BUTTON_DISABLED') {
                logger.info('⏳ Кнопка "Продолжить" disabled — ждём...');
                // Продолжаем цикл, чекбокс должен быть включён
            } else if (found.startsWith('BUTTON_CLICKED')) {
                logger.info(`✅ Попап условий: ${found}`);
                await takeScreenshot(page, accountId, 'dep_01_terms_closed');
                await new Promise(r => setTimeout(r, 1000)); // Оптимизировано: 3000 → 1000
                return true;
            }
        }

        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        elapsed += POLL_INTERVAL;
    }

    logger.info('ℹ️ Попап "Условия" не появился (возможно, уже был закрыт)');
    return false;
}

/**
 * Шаг 2: Закрыть попап "2FA" — кнопка "НЕ СЕЙЧАС"
 * Из DevTools (скриншот 2):
 * Модалка: .login-modal.confirm-otp-modal .modal-dialog
 * Кнопка: button.btn-cancel-otp.btn.btn-default внутри .authen-app-footer
 * Текст кнопки: "Не сейчас" (uppercase в CSS)
 */
async function dismiss2FAPopup(page, accountId) {
    logger.info('⏳ Ожидаем попап "2FA"...');

    const MAX_WAIT = 5000; // Оптимизировано: 12000 → 5000
    const POLL_INTERVAL = 500;
    let elapsed = 0;

    while (elapsed < MAX_WAIT) {
        const found = await page.evaluate(() => {
            // Точные селекторы из DevTools
            const selectors = [
                // Из скриншота: .authen-app-footer .btn-cancel-otp
                '.authen-app-footer button.btn-cancel-otp',
                '.authen-app-footer .btn-cancel-otp.btn-default',
                'button.btn-cancel-otp.btn.btn-default',
                '.confirm-otp-modal .btn-cancel-otp',
                '.login-modal.confirm-otp-modal button.btn-cancel-otp',
                // Общие
                'button.btn-cancel-otp',
                '.btn-cancel-otp.btn-default',
                '.jp-footer button.btn-cancel-otp'
            ];

            for (const sel of selectors) {
                const btn = document.querySelector(sel);
                if (btn && btn.offsetHeight > 0 && btn.offsetWidth > 0) {
                    btn.click();
                    return `Нажата: "${btn.textContent.trim()}" (${sel})`;
                }
            }

            // Fallback: текст "Не сейчас" / "Not now" среди кнопок
            const allBtns = document.querySelectorAll('button, a[role="button"]');
            for (const btn of allBtns) {
                if (btn.offsetHeight > 0 && btn.offsetWidth > 0) {
                    const text = (btn.textContent || '').trim().toLowerCase();
                    if (text.includes('не сейчас') || text.includes('not now') ||
                        text === 'cancel' || text === 'skip') {
                        const isInModal = btn.closest('.modal-content') || btn.closest('.modal-dialog') ||
                                          btn.closest('[class*="otp"]') || btn.closest('[class*="2fa"]') ||
                                          btn.closest('[class*="authen"]') || btn.closest('[class*="confirm"]');
                        if (isInModal || text.includes('не сейчас') || text.includes('not now')) {
                            btn.click();
                            return `По тексту: "${btn.textContent.trim()}"`;
                        }
                    }
                }
            }

            // Также ищем крестик закрытия модалки (×)
            const closeBtn = document.querySelector('.confirm-otp-modal .close') ||
                             document.querySelector('.login-modal .close') ||
                             document.querySelector('.modal-header .close');
            if (closeBtn && closeBtn.offsetHeight > 0) {
                const parentModal = closeBtn.closest('.confirm-otp-modal') || closeBtn.closest('[class*="otp"]');
                if (parentModal) {
                    closeBtn.click();
                    return 'Закрыт через крестик (×)';
                }
            }

            return null;
        });

        if (found) {
            logger.info(`✅ 2FA попап: ${found}`);
            await takeScreenshot(page, accountId, 'dep_02_2fa_closed');
            await new Promise(r => setTimeout(r, 1000)); // Оптимизировано: 3000 → 1000
            return true;
        }

        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        elapsed += POLL_INTERVAL;
    }

    logger.info('ℹ️ Попап 2FA не появился (возможно, уже отклонён)');
    return false;
}

/**
 * Шаг 2.5: Убрать Chrome popup "Сохранить адрес?" / "Save password?"
 * Это native Chrome UI — нельзя кликнуть через page.evaluate,
 * но можно уведомить CDP отключить autofill
 */
async function dismissChromePopups(page) {
    try {
        // Быстрый Escape для закрытия Chrome native popups (оптимизировано: 1 Escape + 200ms)
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 200));
        logger.debug('🔇 Chrome popup dismissed');
    } catch (e) {
        logger.debug(`Chrome popup dismiss: ${e.message}`);
    }
}

/**
 * Шаг 3: Переход на страницу депозита
 * URL: {origin}/ru/compact/account/deposit
 */
async function navigateToDeposit(page, accountId) {
    logger.info('🔄 Переход на страницу депозита...');

    const currentUrl = page.url();
    
    // КРИТИЧНО: если уже на странице deposit — НЕ перезагружаем!
    // SPA уже загрузила контент, page.goto убьёт React стейт и карточки
    if (currentUrl.includes('deposit')) {
        logger.info(`✅ Уже на странице депозита: ${currentUrl}`);
        // Быстрая проверка: карточки уже на месте?
        await new Promise(r => setTimeout(r, 1000)); // Минимальный ждём рендера
        
        // Проверяем что карточки оплаты загрузились (или iframe с контентом)
        try {
            await page.waitForSelector('.masonry-card, .masonry-grid, .card, iframe', { timeout: 8000, visible: true });
            logger.info('✅ Карточки оплаты или iframe найдены на текущей странице');
        } catch (e) {
            logger.warn(`⚠️ Карточки не загрузились, пробуем плавный reload...`);
            // Мягкий reload через SPA навигацию (клик по ссылке)
            const reloaded = await page.evaluate(() => {
                const depositLink = document.querySelector('a[href*="deposit"]');
                if (depositLink) { depositLink.click(); return true; }
                return false;
            });
            if (reloaded) {
                logger.info('🔄 SPA навигация через клик по ссылке deposit');
                await new Promise(r => setTimeout(r, 3000));
            }
        }
        
        await takeScreenshot(page, accountId, 'dep_03_deposit_page');
        return true;
    }

    let depositUrl;

    try {
        const origin = new URL(currentUrl).origin;
        const paths = [
            '/en/compact/account/deposit',
            '/account/deposit'
        ];

        for (const depositPath of paths) {
            depositUrl = `${origin}${depositPath}`;
            logger.info(`Пробую URL: ${depositUrl}`);

            try {
                // networkidle0 — ждём ВСЕ запросы (AJAX, JS) а не только HTML
                await page.goto(depositUrl, { waitUntil: 'networkidle0', timeout: 30000 });
            } catch (e) {
                logger.warn(`Таймаут загрузки: ${e.message}`);
            }

            await new Promise(r => setTimeout(r, 2000));

            const pageText = await page.evaluate(() => document.body?.innerText || '');
            const isDepositPage = pageText.toLowerCase().includes('депозит') || 
                                  pageText.toLowerCase().includes('deposit') ||
                                  page.url().includes('deposit');

            if (isDepositPage || page.url().includes('deposit')) {
                logger.info(`✅ Страница депозита загружена: ${page.url()}`);
                
                // Ждём появления карточек
                try {
                    await page.waitForSelector('.masonry-card, .masonry-grid, .card, iframe', { timeout: 8000, visible: true });
                    logger.info('✅ Карточки оплаты или iframe загрузились');
                } catch (e) {
                    logger.warn(`⚠️ Карточки/iframe не появились за 15 сек`);
                }
                
                await takeScreenshot(page, accountId, 'dep_03_deposit_page');
                return true;
            }
        }
    } catch (e) {
        logger.error(`Ошибка навигации на deposit: ${e.message}`);
    }

    // Последняя попытка — ищем ссылку "Депозит" на странице и кликаем SPA-way
    try {
        const depositLink = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a'));
            for (const a of links) {
                const text = (a.textContent || '').trim().toLowerCase();
                if ((text.includes('депозит') || text.includes('deposit')) && a.href) {
                    return a.href;
                }
            }
            return null;
        });

        if (depositLink) {
            logger.info(`Найдена ссылка на депозит: ${depositLink}`);
            
            // Пробуем SPA-навигацию (клик по ссылке) вместо page.goto
            const clicked = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a'));
                for (const a of links) {
                    const text = (a.textContent || '').trim().toLowerCase();
                    if ((text.includes('депозит') || text.includes('deposit'))) {
                        a.click();
                        return true;
                    }
                }
                return false;
            });
            
            if (clicked) {
                logger.info('✅ Клик по ссылке "Депозит" в SPA');
                await new Promise(r => setTimeout(r, 5000));
                await takeScreenshot(page, accountId, 'dep_03_deposit_page');
                return true;
            }
            
            // Fallback: goto
            await page.goto(depositLink, { waitUntil: 'networkidle0', timeout: 30000 });
            await new Promise(r => setTimeout(r, 5000));
            await takeScreenshot(page, accountId, 'dep_03_deposit_page');
            return true;
        }
    } catch (e) {
        logger.warn(`Ошибка поиска ссылки: ${e.message}`);
    }

    logger.error('❌ Не удалось перейти на страницу депозита');
    await takeScreenshot(page, accountId, 'dep_03_deposit_failed');
    return false;
}

/**
 * Находит фрейм (main или iframe), содержащий карточки оплаты USDT.
 * Также проверяет Shadow DOM если обычные селекторы не находят карточки.
 * Возвращает { frame, isIframe, isShadowDOM } или null.
 */
async function findDepositFrame(page) {
    // Сначала проверяем main frame
    const mainHasCards = await page.evaluate(() => {
        // Обычный DOM
        const cards = document.querySelectorAll('.masonry-card');
        if (cards.length > 0) return 'dom';
        
        // Проверяем по тексту (ERC20 в body)
        const body = document.body?.textContent || '';
        const hasERC20Text = body.includes('ERC20') && body.includes('USDT');
        const hasAnyCards = document.querySelectorAll('.card').length > 0;
        if (hasERC20Text && hasAnyCards) return 'dom-text';
        
        // Проверяем Shadow DOM — рекурсивный обход
        function searchShadowDOM(root, depth) {
            if (depth > 5) return false;
            const children = root.querySelectorAll ? root.querySelectorAll('*') : [];
            for (const el of children) {
                if (el.shadowRoot) {
                    const shadowText = el.shadowRoot.textContent || '';
                    if (shadowText.includes('USDT') && shadowText.includes('ERC20')) return true;
                    const shadowCards = el.shadowRoot.querySelectorAll('.masonry-card, .card');
                    if (shadowCards.length > 0) return true;
                    if (searchShadowDOM(el.shadowRoot, depth + 1)) return true;
                }
            }
            return false;
        }
        if (searchShadowDOM(document, 0)) return 'shadow-dom';
        
        // Проверяем ERC20 только в body textContent (для случая когда текст виден, но карточки не по DOM-селекторам)
        if (hasERC20Text) return 'text-only';
        
        return null;
    }).catch(() => null);

    if (mainHasCards) {
        logger.info(`🔍 Карточки найдены в MAIN frame (${mainHasCards})`);
        return { frame: page.mainFrame(), isIframe: false, isShadowDOM: mainHasCards === 'shadow-dom' };
    }

    // Если в main frame нет — ищем во всех iframes
    const frames = page.frames();
    logger.info(`🔍 Main frame пуст. Проверяем ${frames.length} фреймов...`);

    for (const frame of frames) {
        if (frame === page.mainFrame()) continue;
        try {
            const frameUrl = frame.url();
            logger.debug(`   🔍 Frame: ${frameUrl.substring(0, 100)}`);
            
            const hasCards = await frame.evaluate(() => {
                const cards = document.querySelectorAll('.masonry-card');
                if (cards.length > 0) return 'masonry:' + cards.length;
                const body = document.body?.textContent || '';
                if (body.includes('ERC20') && body.includes('USDT')) return 'text:USDT_ERC20';
                if (document.querySelectorAll('.card').length > 0) return 'card:' + document.querySelectorAll('.card').length;
                return null;
            }).catch(() => null);

            if (hasCards) {
                logger.info(`✅ Карточки найдены в IFRAME: ${hasCards} (url: ${frameUrl.substring(0, 80)})`);
                return { frame, isIframe: true };
            }
        } catch (e) {
            // Frame might be detached
        }
    }

    // Проверяем вложенные iframes (level 2)
    for (const frame of frames) {
        try {
            const childFrames = frame.childFrames();
            for (const child of childFrames) {
                const hasCards = await child.evaluate(() => {
                    const body = document.body?.textContent || '';
                    return (body.includes('ERC20') && body.includes('USDT')) ? 'nested-text:USDT' : null;
                }).catch(() => null);
                if (hasCards) {
                    logger.info(`✅ Карточки найдены в вложенном IFRAME: ${hasCards}`);
                    return { frame: child, isIframe: true };
                }
            }
        } catch (e) { /* skip */ }
    }

    return null;
}

/**
 * Кликает по карточке USDT (ERC20) внутри указанного фрейма.
 * Включает поиск в Shadow DOM.
 * Возвращает строку с описанием клика или null.
 */
async function clickUSDTCardInFrame(frame) {
    return await frame.evaluate(() => {
        // Стратегия 1: Все `.card` или вложенные элементы карточек на странице
        const cards = document.querySelectorAll('.card, .channel-item, .payment-method');
        for (const card of cards) {
            const text = (card.textContent || '').replace(/\s+/g, ' ').trim();
            if (text.includes('USDT') && text.includes('ERC20') && text.length < 300) {
                card.click();
                const innerBtn = card.querySelector('button') || card.querySelector('a');
                if (innerBtn) innerBtn.click();
                return `card: "${text.substring(0, 60)}"`;
            }
        }

        // Стратегия 2: .card внутри .masonry-grid или .selector-container
        const containers = document.querySelectorAll('.masonry-grid .card, .selector-container .card, .channel-selector-container .card');
        for (const card of containers) {
            const text = (card.textContent || '').replace(/\s+/g, ' ').trim();
            if (text.includes('USDT') && text.includes('ERC20') && text.length < 300) {
                card.click();
                return `.masonry-grid .card: "${text.substring(0, 60)}"`;
            }
        }

        // Стратегия 3: card-header с текстом
        const headers = document.querySelectorAll('.card-header');
        for (const h of headers) {
            const text = (h.textContent || '').replace(/\s+/g, ' ').trim();
            if (text.includes('USDT') && text.includes('ERC20') && text.length < 300) {
                const clickTarget = h.closest('.masonry-card') || h.closest('.card') || h;
                clickTarget.click();
                return `card-header: "${text.substring(0, 60)}"`;
            }
        }

        // Стратегия 4: любой видимый div/span/a/button/li с "USDT" + "ERC20"
        const allEls = document.querySelectorAll('div, span, a, button, li');
        for (const el of allEls) {
            if (el.offsetHeight > 0 && el.offsetWidth > 0) {
                const ownText = el.childNodes.length <= 5
                    ? (el.textContent || '').replace(/\s+/g, ' ').trim()
                    : '';
                if (ownText.includes('USDT') && ownText.includes('ERC20') && ownText.length < 300) {
                    const clickTarget = el.closest('.masonry-card') || el.closest('.card') || el;
                    clickTarget.click();
                    return `text-search: "${ownText.substring(0, 60)}" (${clickTarget.tagName}.${(clickTarget.className || '').toString().split(' ')[0]})`;
                }
            }
        }

        // Стратегия 5: Shadow DOM — рекурсивный обход
        function findInShadow(root, depth) {
            if (depth > 5) return null;
            const children = root.querySelectorAll ? root.querySelectorAll('*') : [];
            for (const el of children) {
                if (el.shadowRoot) {
                    // Ищем карточки внутри shadow root
                    const shadowCards = el.shadowRoot.querySelectorAll('.masonry-card, .card, div, span');
                    for (const sc of shadowCards) {
                        const text = (sc.textContent || '').replace(/\s+/g, ' ').trim();
                        if (text.includes('USDT') && text.includes('ERC20') && text.length < 300 && sc.offsetHeight > 0) {
                            const target = sc.closest('.masonry-card') || sc.closest('.card') || sc;
                            target.click();
                            sc.click();
                            return `shadow-dom: "${text.substring(0, 60)}"`;
                        }
                    }
                    const deeper = findInShadow(el.shadowRoot, depth + 1);
                    if (deeper) return deeper;
                }
            }
            return null;
        }
        const shadowResult = findInShadow(document, 0);
        if (shadowResult) return shadowResult;

        return null;
    }).catch(e => {
        return null;
    });
}

/**
 * Шаг 4: Выбор USDT (ERC20) метод депозита
 * Карточка с текстом "USDT (ERC20)" — клик
 * 
 * КРИТИЧНЫЙ FIX: карточки могут быть внутри iframe!
 * page.evaluate() работает только в main frame, поэтому нужно проверять все фреймы.
 */
async function selectUSDTERC20(page, accountId) {
    logger.info('🔍 Ищем карточку USDT (ERC20)...');

    // Закрываем Chrome попап "Сохранить адрес?" если есть
    await page.keyboard.press('Escape').catch(() => {});
    await new Promise(r => setTimeout(r, 500));
    await page.keyboard.press('Escape').catch(() => {});
    await new Promise(r => setTimeout(r, 500));

    // Ждём пока появятся карточки оплаты (пробуем и в main, и в iframe)
    let waitedForCards = false;
    try {
        await page.waitForSelector('.masonry-card, .masonry-grid, .selector-container, [class*="channel"], iframe', { 
            timeout: 15000, visible: true 
        });
        waitedForCards = true;
        logger.info('✅ Контейнер карточек или iframe найден');
    } catch (e) {
        logger.warn(`⚠️ Контейнер карточек не появился за 15сек: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, 3000)); // Доп. ожидание рендера (увеличено для iframe)

    // РАСШИРЕННАЯ ДИАГНОСТИКА: проверяем main frame + iframes
    const mainDiag = await page.evaluate(() => {
        const result = { 
            cards: [], allText: [], bodyClasses: document.body.className,
            iframes: [], masonryCount: 0, cardCount: 0
        };
        
        // Проверяем masonry-card
        const masonryCards = document.querySelectorAll('.masonry-card');
        result.masonryCount = masonryCards.length;
        masonryCards.forEach((c, i) => {
            result.cards.push({ i, cls: c.className, text: (c.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 100) });
        });

        // Проверяем .card
        result.cardCount = document.querySelectorAll('.card').length;

        // Ищем текст USDT в main frame
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while (node = walker.nextNode()) {
            const t = (node.textContent || '').trim();
            if (t.includes('USDT') && t.length < 100) {
                result.allText.push(t);
            }
        }

        // Проверяем наличие iframe
        const iframes = document.querySelectorAll('iframe');
        iframes.forEach((iframe, i) => {
            result.iframes.push({
                i, src: (iframe.src || '').substring(0, 150),
                class: iframe.className, id: iframe.id,
                w: iframe.offsetWidth, h: iframe.offsetHeight,
                visible: iframe.offsetHeight > 0 && iframe.offsetWidth > 0
            });
        });

        return result;
    }).catch(() => ({ masonryCount: 0, cardCount: 0, allText: [], iframes: [], cards: [], bodyClasses: '?' }));

    logger.info(`📊 Main frame: masonry-card=${mainDiag.masonryCount}, .card=${mainDiag.cardCount}, iframes=${mainDiag.iframes.length}, body="${mainDiag.bodyClasses}"`);
    if (mainDiag.cards.length > 0) {
        mainDiag.cards.forEach(c => logger.info(`   📦 Card[${c.i}]: "${c.text}"`));
    }
    if (mainDiag.allText.length > 0) {
        logger.info(`   📝 USDT текст на странице: ${mainDiag.allText.slice(0, 5).join(' | ')}`);
    }
    if (mainDiag.iframes.length > 0) {
        mainDiag.iframes.forEach(f => logger.info(`   🖼️ iframe[${f.i}]: src="${f.src}" ${f.w}x${f.h} visible=${f.visible}`));
    }

    // === ОСНОВНОЙ ПОИСК ===
    const MAX_WAIT = 30000; // Увеличено до 30 сек
    const POLL_INTERVAL = 2000;
    let elapsed = 0;

    while (elapsed < MAX_WAIT) {
        // --- Шаг A: ищем фрейм с карточками ---
        const depositFrame = await findDepositFrame(page);
        
        if (depositFrame) {
            const { frame, isIframe } = depositFrame;
            logger.info(`🎯 Целевой фрейм: ${isIframe ? 'IFRAME' : 'MAIN'}`);

            // --- Шаг B: кликаем по USDT (ERC20) карточке внутри фрейма ---
            const clickResult = await clickUSDTCardInFrame(frame);

            if (clickResult) {
                logger.info(`✅ USDT (ERC20) выбран: ${clickResult}`);

                // Дополнительно: Puppeteer click для надёжности (работает только для main frame)
                if (!isIframe) {
                    try {
                        const elHandle = await page.evaluateHandle(() => {
                            const cards = document.querySelectorAll('.masonry-card');
                            for (const c of cards) {
                                if (c.textContent.includes('USDT') && c.textContent.includes('ERC20')) return c;
                            }
                            // Fallback: любой элемент с USDT ERC20
                            const allEls = document.querySelectorAll('div, span');
                            for (const el of allEls) {
                                const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
                                if (t.includes('USDT') && t.includes('ERC20') && t.length < 200 && el.offsetHeight > 0) {
                                    return el.closest('.masonry-card') || el.closest('.card') || el;
                                }
                            }
                            return null;
                        });
                        if (elHandle && elHandle.asElement()) {
                            await elHandle.asElement().click();
                            logger.info('✅ Дополнительный Puppeteer click');
                        }
                    } catch (e) { /* не критично */ }
                }

                // Для iframe: пробуем кликнуть через координаты в page
                if (isIframe) {
                    try {
                        // Получаем координаты карточки внутри iframe + позицию iframe
                        const coords = await page.evaluate(() => {
                            const iframes = document.querySelectorAll('iframe');
                            for (const iframe of iframes) {
                                if (iframe.offsetHeight > 0) {
                                    const rect = iframe.getBoundingClientRect();
                                    return { iframeX: rect.x, iframeY: rect.y };
                                }
                            }
                            return null;
                        });
                        
                        const cardCoords = await frame.evaluate(() => {
                            const cards = document.querySelectorAll('.masonry-card');
                            for (const card of cards) {
                                if (card.textContent.includes('USDT') && card.textContent.includes('ERC20')) {
                                    const rect = card.getBoundingClientRect();
                                    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
                                }
                            }
                            // Fallback
                            const allEls = document.querySelectorAll('div, span');
                            for (const el of allEls) {
                                const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
                                if (t.includes('USDT') && t.includes('ERC20') && t.length < 200 && el.offsetHeight > 20) {
                                    const target = el.closest('.masonry-card') || el.closest('.card') || el;
                                    const rect = target.getBoundingClientRect();
                                    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
                                }
                            }
                            return null;
                        }).catch(() => null);

                        if (coords && cardCoords) {
                            const absX = coords.iframeX + cardCoords.x;
                            const absY = coords.iframeY + cardCoords.y;
                            logger.info(`🖱️ Клик по координатам (iframe): x=${absX}, y=${absY}`);
                            await page.mouse.click(absX, absY);
                        }
                    } catch (e) {
                        logger.debug(`iframe координатный клик: ${e.message}`);
                    }
                }

                await new Promise(r => setTimeout(r, 5000)); // Ждём загрузку формы
                await takeScreenshot(page, accountId, 'dep_04_usdt_selected');
                return true;
            }
        }

        // --- Шаг C: FALLBACK — клик по Puppeteer XPath/координатам ---
        if (elapsed >= 10000) {
            logger.info('🔄 Пробуем XPath и координатный fallback...');
            
            // XPath поиск текста "USDT (ERC20)" или "USDT(ERC20)" во ВСЕХ фреймах
            for (const frame of page.frames()) {
                try {
                    const xpathResult = await frame.evaluate(() => {
                        const xpath = "//div[contains(text(), 'USDT') and contains(text(), 'ERC20')]";
                        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                        const node = result.singleNodeValue;
                        if (node && node.offsetHeight > 0) {
                            const target = node.closest('.masonry-card') || node.closest('.card') || node;
                            target.click();
                            node.click();
                            return `xpath in ${location.href.substring(0, 60)}`;
                        }
                        
                        // Также попробуем XPath по span/div с точным текстом
                        const xpath2 = "//*[contains(., 'USDT') and contains(., 'ERC20')]";
                        const iter = document.evaluate(xpath2, document, null, XPathResult.ORDERED_NODE_ITERATOR_TYPE, null);
                        let n;
                        while (n = iter.iterateNext()) {
                            if (n.offsetHeight > 10 && n.offsetWidth > 50 && n.childElementCount <= 5) {
                                const t = (n.textContent || '').replace(/\s+/g, ' ').trim();
                                if (t.includes('USDT') && t.includes('ERC20') && t.length < 500) {
                                    const target = n.closest('.masonry-card') || n.closest('.card') || n;
                                    target.click();
                                    return `xpath2: "${t.substring(0, 60)}"`;
                                }
                            }
                        }
                        return null;
                    }).catch(() => null);

                    if (xpathResult) {
                        logger.info(`✅ USDT (ERC20) найден через XPath: ${xpathResult}`);
                        await new Promise(r => setTimeout(r, 5000));
                        await takeScreenshot(page, accountId, 'dep_04_usdt_selected');
                        return true;
                    }
                } catch (e) { /* skip frame */ }
            }

            // Координатный клик: USDT карточка обычно первая слева в секции карточек
            // Из скриншотов: примерно x=450, y=350 для viewport 1366x768
            if (elapsed >= 16000) {
                logger.info('🖱️ Последний шанс: клик по примерным координатам карточки USDT...');
                try {
                    const viewport = page.viewport();
                    // Карточка USDT (ERC20) обычно расположена:
                    // - горизонтально: ~35% ширины экрана (первая карточка слева из двух)
                    // - вертикально: ~42% высоты экрана (под заголовком "Все способы...")
                    const clickX = Math.round(viewport.width * 0.35);
                    const clickY = Math.round(viewport.height * 0.42);
                    logger.info(`🖱️ Координаты: x=${clickX}, y=${clickY} (viewport: ${viewport.width}x${viewport.height})`);
                    await page.mouse.click(clickX, clickY);
                    await new Promise(r => setTimeout(r, 3000));
                    
                    // Проверяем: изменилась ли страница после клика?
                    const changed = await page.evaluate(() => {
                        // Если появилось поле ввода суммы — значит клик удался
                        const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input:not([type])');
                        for (const inp of inputs) {
                            if (inp.offsetHeight > 0 && !inp.readOnly) {
                                const ctx = (inp.closest('div')?.textContent || '').toLowerCase();
                                if (ctx.includes('сумм') || ctx.includes('amount') || ctx.includes('usdt')) {
                                    return 'amount_field_appeared';
                                }
                            }
                        }
                        // Проверяем появление формы депозита
                        const formSels = ['.d-form-card', '.cashier-form', '.deposit-form', '[class*="crypto"]', '[class*="deposit-detail"]'];
                        for (const sel of formSels) {
                            if (document.querySelector(sel)) return `form: ${sel}`;
                        }
                        return null;
                    }).catch(() => null);
                    
                    // Также проверяем во фреймах
                    if (!changed) {
                        for (const frame of page.frames()) {
                            if (frame === page.mainFrame()) continue;
                            const frameChanged = await frame.evaluate(() => {
                                const inputs = document.querySelectorAll('input[type="text"], input[type="number"]');
                                for (const inp of inputs) {
                                    if (inp.offsetHeight > 0) return 'iframe_input_appeared';
                                }
                                return null;
                            }).catch(() => null);
                            if (frameChanged) {
                                logger.info(`✅ Координатный клик сработал! (iframe: ${frameChanged})`);
                                await takeScreenshot(page, accountId, 'dep_04_usdt_selected');
                                return true;
                            }
                        }
                    }
                    
                    if (changed) {
                        logger.info(`✅ Координатный клик сработал! (${changed})`);
                        await takeScreenshot(page, accountId, 'dep_04_usdt_selected');
                        return true;
                    }
                    
                    logger.warn('⚠️ Координатный клик не привел к изменению страницы');
                } catch (e) {
                    logger.warn(`⚠️ Координатный клик: ${e.message}`);
                }
            }
        }

        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        elapsed += POLL_INTERVAL;
        logger.debug(`USDT поиск: ${elapsed}/${MAX_WAIT}ms...`);
    }

    logger.error('❌ Карточка USDT (ERC20) не найдена за 30 секунд');
    await takeScreenshot(page, accountId, 'dep_04_usdt_not_found');
    return false;
}

/**
 * Шаг 5: Ввод суммы депозита и клик "ОТПРАВИТЬ"
 * Также проверяет iframes если поле не найдено в main frame.
 */
async function enterAmountAndSubmit(page, accountId, amount) {
    logger.info(`💰 Ввод суммы депозита: ${amount} USDT...`);

    // Ждём загрузку формы после выбора метода
    await new Promise(r => setTimeout(r, 5000));
    await takeScreenshot(page, accountId, 'dep_05a_before_amount');

    /**
     * Вспомогательная: ищет поле ввода суммы в указанном фрейме
     */
    async function findAmountInputInFrame(frame) {
        return await frame.evaluate(() => {
            const selectors = [
                '.CryptoAmount_container input',
                '.cryptoAmount_container input',
                'input[name*="amount"]',
                'input[name*="Amount"]',
                'input[placeholder*="сумм"]',
                'input[placeholder*="amount"]',
                'input[placeholder*="Amount"]',
                '.d-form-card input[type="text"]',
                '.d-form-card input[type="number"]',
                '.cashier-form-container input[type="text"]',
                '.cashier-form-container input[type="number"]',
                '.crypto-amount input',
                '.amount-input input',
                'input.form-control'
            ];

            for (const sel of selectors) {
                const inputs = document.querySelectorAll(sel);
                for (const input of inputs) {
                    if (input.offsetHeight > 0 && input.offsetWidth > 0) {
                        const parentText = (input.closest('.form-group, .d-flex, div') || document.body).textContent || '';
                        const isAmountField = parentText.toLowerCase().includes('сумм') ||
                                              parentText.toLowerCase().includes('amount') ||
                                              parentText.includes('USDT') ||
                                              input.name?.toLowerCase().includes('amount') ||
                                              input.placeholder?.toLowerCase().includes('amount') ||
                                              input.placeholder?.toLowerCase().includes('сумм');
                        if (isAmountField) {
                            return { found: true, selector: sel };
                        }
                    }
                }
            }

            // Super fallback: первый видимый text/number input
            for (const input of document.querySelectorAll('input[type="text"], input[type="number"], input:not([type])')) {
                if (input.offsetHeight > 0 && input.offsetWidth > 0 && !input.readOnly) {
                    return { found: true, selector: null };
                }
            }

            return { found: false };
        }).catch(() => ({ found: false }));
    }

    // Определяем целевой фрейм для ввода
    let targetFrame = page; // По умолчанию — main page
    let inputSelector = null;

    // Сначала ищем в main frame
    const mainResult = await findAmountInputInFrame(page.mainFrame());
    if (mainResult.found) {
        inputSelector = mainResult.selector;
        logger.info(`🔍 Поле суммы найдено в MAIN frame: ${inputSelector || 'fallback'}`);
    } else {
        // Ищем во всех iframe
        logger.info('🔍 Поле суммы не найдено в main frame, проверяем iframes...');
        for (const frame of page.frames()) {
            if (frame === page.mainFrame()) continue;
            try {
                const frameResult = await findAmountInputInFrame(frame);
                if (frameResult.found) {
                    targetFrame = frame;
                    inputSelector = frameResult.selector;
                    logger.info(`🔍 Поле суммы найдено в IFRAME: ${inputSelector || 'fallback'} (${frame.url().substring(0, 60)})`);
                    break;
                }
            } catch (e) { /* skip */ }
        }
    }

    // Пробуем ввести значение
    let amountEntered = false;

    if (inputSelector && targetFrame === page) {
        try {
            // Фокус + очистка + ввод через Puppeteer (только в main frame)
            await page.click(inputSelector);
            await page.keyboard.down('Control');
            await page.keyboard.press('a');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            await page.type(inputSelector, String(amount), { delay: 100 });
            amountEntered = true;
            logger.info(`✅ Сумма введена через Puppeteer type: ${amount} (${inputSelector})`);
        } catch (e) {
            logger.warn(`Puppeteer type failed: ${e.message}`);
        }
    }

    // Fallback: через evaluate + React-совместимый setter (во всех фреймах)
    if (!amountEntered) {
        const framesToTry = [page.mainFrame(), ...page.frames().filter(f => f !== page.mainFrame())];
        
        for (const frame of framesToTry) {
            try {
                const result = await frame.evaluate((amountValue) => {
                    const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input:not([type])');
                    for (const input of inputs) {
                        if (input.offsetHeight > 0 && input.offsetWidth > 0 && !input.readOnly && !input.disabled) {
                            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                                window.HTMLInputElement.prototype, 'value'
                            ).set;
                            nativeInputValueSetter.call(input, String(amountValue));
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            input.dispatchEvent(new Event('change', { bubbles: true }));
                            input.focus();
                            return `${input.name || input.className || 'input'}: value=${input.value}`;
                        }
                    }
                    return null;
                }, amount);

                if (result) {
                    amountEntered = true;
                    logger.info(`✅ Сумма введена через evaluate: ${result} (${frame === page.mainFrame() ? 'main' : 'iframe'})`);
                    targetFrame = frame;
                    break;
                }
            } catch (e) { /* skip frame */ }
        }
    }

    if (!amountEntered) {
        logger.error('❌ Поле ввода суммы не найдено (main + iframes)');
        await takeScreenshot(page, accountId, 'dep_05_amount_not_found');
        return false;
    }

    await takeScreenshot(page, accountId, 'dep_05_amount_entered');
    await new Promise(r => setTimeout(r, 2000));

    // Клик "ОТПРАВИТЬ" — ищем во всех фреймах
    logger.info('📨 Нажимаем кнопку "ОТПРАВИТЬ"...');

    let submitted = false;
    const allFrames = [page.mainFrame(), ...page.frames().filter(f => f !== page.mainFrame())];
    
    for (const frame of allFrames) {
        if (submitted) break;
        try {
            const btnClicked = await frame.evaluate(() => {
                const selectors = [
                    'button.text-uppercase.font-weight-bold.btn.btn-primary',
                    '.submit-section .btn.btn-primary',
                    '.btn-section .btn.btn-primary',
                    'button.btn.btn-primary'
                ];
                for (const sel of selectors) {
                    const btns = document.querySelectorAll(sel);
                    for (const btn of btns) {
                        const text = (btn.textContent || '').trim().toLowerCase();
                        if (btn.offsetHeight > 0 && (text.includes('отправить') || text.includes('submit') || text.includes('deposit'))) {
                            btn.click();
                            return `"${btn.textContent.trim()}" (${sel})`;
                        }
                    }
                }
                // Fallback: любая кнопка с текстом "отправить"
                for (const btn of document.querySelectorAll('button')) {
                    const text = (btn.textContent || '').trim().toLowerCase();
                    if (btn.offsetHeight > 0 && (text.includes('отправить') || text.includes('submit'))) {
                        btn.click();
                        return `fallback: "${btn.textContent.trim()}"`;
                    }
                }
                return null;
            });

            if (btnClicked) {
                submitted = true;
                logger.info(`✅ Кнопка "ОТПРАВИТЬ" нажата: ${btnClicked} (${frame === page.mainFrame() ? 'main' : 'iframe'})`);
            }
        } catch (e) { /* skip frame */ }
    }

    // Дополнительно: Puppeteer click для main frame
    if (!submitted) {
        const submitBtnHandle = await page.evaluateHandle(() => {
            for (const btn of document.querySelectorAll('button')) {
                const text = (btn.textContent || '').trim().toLowerCase();
                if (btn.offsetHeight > 0 && (text.includes('отправить') || text.includes('submit') || text.includes('deposit'))) {
                    return btn;
                }
            }
            return null;
        });

        if (submitBtnHandle && submitBtnHandle.asElement()) {
            try {
                await submitBtnHandle.asElement().click();
                submitted = true;
                logger.info('✅ Кнопка "ОТПРАВИТЬ" нажата через Puppeteer handle');
            } catch (e) {
                logger.warn(`Puppeteer handle click failed: ${e.message}`);
            }
        }
    }

    if (submitted) {
        await new Promise(r => setTimeout(r, 5000));
        await takeScreenshot(page, accountId, 'dep_06_submitted');
        return true;
    }

    logger.error('❌ Кнопка "ОТПРАВИТЬ" не найдена (main + iframes)');
    await takeScreenshot(page, accountId, 'dep_06_submit_not_found');
    return false;
}

/**
 * Шаг 6: Дождаться попап окна оплаты (apix.pin88pay.com) и извлечь адрес
 * 
 * После нажатия "ОТПРАВИТЬ" открывается новый таб с попапом оплаты:
 * - URL: apix.pin88pay.com/pi/checkout/...
 * - Сначала отображается QR-код (вкладка "Scan")
 * - Нужно нажать "Copy" для отображения адреса
 * - Адрес находится в input.checkoutTextbox (readonly)
 */
async function extractAddressFromPaymentPopup(browser, page, accountId) {
    logger.info('🔍 Ищем попап окно оплаты (pin88pay.com)...');

    // Ждём пока новый таб откроется
    let paymentPage = null;
    const MAX_WAIT_POPUP = 30000;
    const POLL_INTERVAL = 2000;
    let elapsed = 0;

    while (elapsed < MAX_WAIT_POPUP) {
        const pages = await browser.pages();
        logger.debug(`📊 Всего табов: ${pages.length}`);

        for (const p of pages) {
            const url = p.url();
            if (url.includes('pin88pay') || url.includes('checkout') || url.includes('invoice')) {
                paymentPage = p;
                logger.info(`✅ Попап оплаты найден: ${url.substring(0, 100)}`);
                break;
            }
        }

        if (paymentPage) break;

        await new Promise(r => setTimeout(r, POLL_INTERVAL));
        elapsed += POLL_INTERVAL;
        logger.debug(`Ожидание попапа: ${elapsed}/${MAX_WAIT_POPUP}ms...`);
    }

    if (!paymentPage) {
        logger.error('❌ Попап оплаты не найден за 30 сек');
        await takeScreenshot(page, accountId, 'dep_07_popup_not_found');
        return null;
    }

    // Переключаемся на попап
    await paymentPage.bringToFront();
    await new Promise(r => setTimeout(r, 3000)); // Ждём загрузку формы

    await takeScreenshot(paymentPage, accountId, 'dep_07_payment_popup');

    // Кликаем на вкладку "Copy"
    logger.info('📋 Переключаемся на вкладку "Copy"...');
    
    const copyTabClicked = await paymentPage.evaluate(() => {
        // Ищем вкладку "Copy" по тексту
        const elements = document.querySelectorAll('div, span, a, button, nav *');
        for (const el of elements) {
            const text = (el.textContent || '').trim();
            // Точное совпадение "Copy" (не "Copyright" и т.п.)
            if (text === 'Copy' || text === 'copy') {
                el.click();
                return `clicked: ${el.tagName}.${el.className}`;
            }
        }
        // Попробуем по id="copy" 
        const copyEl = document.querySelector('#copy, [id*="copy"], .copy-tab, nav a:last-child');
        if (copyEl) {
            copyEl.click();
            return `selector: ${copyEl.tagName}.${copyEl.className}`;
        }
        return null;
    }).catch(() => null);

    if (copyTabClicked) {
        logger.info(`✅ Вкладка "Copy" нажата: ${copyTabClicked}`);
    } else {
        logger.warn('⚠️ Вкладка "Copy" не найдена, пробуем клик по координатам...');
        // Copy обычно справа от Scan, примерно на 65% ширины viewport
        const viewport = paymentPage.viewport() || { width: 800, height: 600 };
        await paymentPage.mouse.click(Math.round(viewport.width * 0.55), 282);
    }

    await new Promise(r => setTimeout(r, 3000)); // Ждём загрузку вкладки Copy
    await takeScreenshot(paymentPage, accountId, 'dep_08_copy_tab');

    // Извлекаем адрес из input.checkoutTextbox или input[readonly]
    logger.info('📋 Извлекаем адрес депозита...');
    
    const depositAddress = await paymentPage.evaluate(() => {
        // Стратегия 1: input.checkoutTextbox
        const checkoutInput = document.querySelector('input.checkoutTextbox');
        if (checkoutInput && checkoutInput.value) return checkoutInput.value.trim();

        // Стратегия 2: input.copyInput или .inputWithIcon input
        const copyInput = document.querySelector('.copyInput, .inputWithIcon input, .copySectionBox input');
        if (copyInput && copyInput.value) return copyInput.value.trim();

        // Стратегия 3: любой readonly input со значением, похожим на ETH-адрес (0x...)
        const inputs = document.querySelectorAll('input[readonly]');
        for (const inp of inputs) {
            const val = (inp.value || '').trim();
            if (val.startsWith('0x') && val.length >= 40) {
                return val;
            }
        }

        // Стратегия 4: любой видимый input значительной длины
        for (const inp of document.querySelectorAll('input')) {
            const val = (inp.value || '').trim();
            if (val.startsWith('0x') && val.length >= 40 && inp.offsetHeight > 0) {
                return val;
            }
        }

        // Стратегия 5: текст на странице, похожий на ETH-адрес
        const body = document.body?.textContent || '';
        const match = body.match(/0x[a-fA-F0-9]{40,}/);
        if (match) return match[0];

        return null;
    }).catch(() => null);

    if (depositAddress) {
        logger.info(`✅ Адрес депозита получен: ${depositAddress}`);
        await takeScreenshot(paymentPage, accountId, 'dep_09_address_extracted');
        return depositAddress;
    }

    logger.error('❌ Не удалось извлечь адрес депозита');
    await takeScreenshot(paymentPage, accountId, 'dep_09_address_not_found');
    return null;
}

/**
 * Шаг 7: Отправить USDT на адрес депозита через Pimlico wallet.
 * Автоматически находит кошелёк с достаточным балансом из walletsPath.
 * 
 * @param {string} depositAddress - адрес куда отправлять
 * @param {number} actualAmount - сумма к отправке
 * @param {Object} depositCfg - конфигурация депозита (содержит walletsPath)
 */
async function sendUsdtToAddress(depositAddress, actualAmount, depositCfg) {
    logger.info(`\n💸 === ОТПРАВКА ${actualAmount} USDT ===`);
    logger.info(`📍 Адрес получателя: ${depositAddress}`);

    try {
        const wallet = require('./wallet');
        const fs = require('fs');
        const path = require('path');

        // Загружаем список кошельков
        const walletsPath = depositCfg.walletsPath || 'c:/Project/deposit/dist/wallets.json';
        if (!fs.existsSync(walletsPath)) {
            logger.error(`❌ Файл кошельков не найден: ${walletsPath}`);
            return { success: false, error: `Файл кошельков не найден: ${walletsPath}` };
        }

        const wallets = JSON.parse(fs.readFileSync(walletsPath, 'utf-8'));
        logger.info(`📋 Загружено ${wallets.length} кошельков из ${path.basename(walletsPath)}`);

        // Ищем кошелёк с достаточным балансом.
        // Пропускаем usedForDeposit=true — такие кошельки уже участвовали в депозите
        // и не должны использоваться повторно (политика "один кошелёк = один депозит").
        let selectedWallet = null;
        let selectedBalance = 0;
        let skippedUsed = 0;

        for (const w of wallets) {
            if (w.usedForDeposit) { skippedUsed++; continue; }
            try {
                const balance = await wallet.getUsdtBalance(w.safeAddress);
                const balNum = parseFloat(balance);
                logger.info(`   💳 ${w.name || w.safeAddress.substring(0, 10)} | ${w.safeAddress} | ${balance} USDT${balNum >= actualAmount ? ' ✅' : ''}`);

                if (balNum >= actualAmount && !selectedWallet) {
                    selectedWallet = w;
                    selectedBalance = balNum;
                }
            } catch (e) {
                logger.debug(`   ⚠️ ${w.name || '?'}: ошибка проверки баланса`);
            }
        }
        if (skippedUsed > 0) logger.info(`   ⏭ Пропущено ${skippedUsed} уже использованных кошельков (usedForDeposit=true)`);

        if (!selectedWallet) {
            logger.error(`❌ Ни один кошелёк не имеет достаточно средств (нужно: ${actualAmount} USDT)`);
            return { success: false, error: `Нет кошелька с балансом >= ${actualAmount} USDT` };
        }

        logger.info(`\n✅ Выбран кошелёк: ${selectedWallet.name || 'Unknown'}`);
        logger.info(`   Адрес: ${selectedWallet.safeAddress}`);
        logger.info(`   Баланс: ${selectedBalance} USDT`);
        logger.info(`   Отправляем: ${actualAmount} USDT`);

        logger.info(`\n🚀 Отправляем ${actualAmount} USDT на ${depositAddress}...`);
        const result = await wallet.sendUsdt(selectedWallet.privateKey, depositAddress, actualAmount);

        logger.info(`✅ Транзакция отправлена!`);
        logger.info(`   Hash: ${result.hash}`);
        logger.info(`   Block: ${result.blockNumber}`);
        logger.info(`   Status: ${result.status}`);
        logger.info(`   Gas: $${result.gasCostUsd}`);

        // Пост-обработка кошелька: помечаем usedForDeposit=true и удаляем если пустой.
        // Бэкап wallets.json в data/wallets.backup.json перед изменением.
        try {
            const backupDir = path.resolve(__dirname, '..', 'data');
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
            const backupPath = path.join(backupDir, 'wallets.backup.json');
            fs.copyFileSync(walletsPath, backupPath);
            logger.debug(`💾 Бэкап wallets.json → ${backupPath}`);

            let postBalance = null;
            try {
                postBalance = parseFloat(await wallet.getUsdtBalance(selectedWallet.safeAddress));
            } catch (e) {
                logger.warn(`   ⚠️ Не удалось перепроверить баланс после отправки: ${e.message}`);
            }

            const fresh = JSON.parse(fs.readFileSync(walletsPath, 'utf-8'));
            const idx = fresh.findIndex(w =>
                (w.safeAddress || '').toLowerCase() === (selectedWallet.safeAddress || '').toLowerCase()
            );

            if (idx !== -1) {
                const isEmpty = postBalance !== null && postBalance < 0.01;
                if (isEmpty) {
                    fresh.splice(idx, 1);
                    logger.info(`   🗑 Кошелёк удалён из wallets.json (баланс=${postBalance} USDT)`);
                } else {
                    fresh[idx].usedForDeposit = true;
                    fresh[idx].depositTxHash = result.hash;
                    fresh[idx].depositAt = new Date().toISOString();
                    fresh[idx].balance = postBalance !== null ? postBalance.toFixed(2) : fresh[idx].balance;
                    logger.info(`   🏷 Кошелёк помечен usedForDeposit=true (остаток ${postBalance} USDT)`);
                }
                fs.writeFileSync(walletsPath, JSON.stringify(fresh, null, 2), 'utf-8');
            }
        } catch (e) {
            logger.warn(`⚠️ Пост-обработка wallets.json не удалась: ${e.message}`);
        }

        return {
            success: true,
            hash: result.hash,
            blockNumber: result.blockNumber,
            status: result.status,
            gasCostUsd: result.gasCostUsd,
            fromWallet: selectedWallet.name || selectedWallet.safeAddress,
        };
    } catch (error) {
        logger.error(`❌ Ошибка отправки USDT: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * Полный флоу депозита после успешной регистрации
 * @param {Page} page - Puppeteer page (уже залогинен после регистрации)
 * @param {Object} account - объект аккаунта
 * @param {number} depositAmount - РЕАЛЬНАЯ сумма, которую отправим on-chain (из лаунчера)
 * @param {Browser} [browser] - Puppeteer browser (для переключения табов)
 * @param {Object} [depositCfg] - конфигурация депозита из config.json
 */
async function performDeposit(page, account, depositAmount, browser, depositCfg = {}) {
    // Форма на Pinnacle должна показывать случайное число ≥ 20 (мин. депозит),
    // а реально отправляем на кошелёк Pinnacle сумму, указанную в лаунчере (depositAmount).
    const formAmount = 20 + Math.floor(Math.random() * 31); // 20..50
    const actualSendAmount = depositAmount;

    logger.info(`\n=== 💰 ДЕПОЗИТ для аккаунта #${account.id} ===`);
    logger.info(`Форма: ${formAmount} USDT (случайное) | Реальная отправка: ${actualSendAmount} USDT (из лаунчера)`);

    try {
        // Шаг -1: Проверяем не открылся ли новый таб
        if (browser) {
            page = await getActivePage(browser, page);
        }

        logger.info(`📍 Текущий URL: ${page.url()}`);
        await takeScreenshot(page, account.id, 'dep_00_start');

        // Шаг 0: Быстрый Escape для Chrome native popups
        await dismissChromePopups(page);

        // Шаг 1: Закрыть попап "Условия и положения" (всегда проверяем)
        await dismissTermsPopup(page, account.id);
        await new Promise(r => setTimeout(r, 300));

        // Шаг 1.5: Escape после попапа
        await dismissChromePopups(page);

        // Шаг 2: Закрыть попап "2FA" (всегда проверяем)
        await dismiss2FAPopup(page, account.id);
        await new Promise(r => setTimeout(r, 300));

        // Шаг 2.5: Escape перед навигацией
        await dismissChromePopups(page);

        // Шаг 3: Переход на страницу депозита
        const depositPageLoaded = await navigateToDeposit(page, account.id);
        if (!depositPageLoaded) {
            return { success: false, error: 'Не удалось загрузить страницу депозита' };
        }
        await randomDelay([500, 1500]); // Оптимизировано: 2000-4000 → 500-1500

        // Шаг 4: Выбрать USDT (ERC20)
        const usdtSelected = await selectUSDTERC20(page, account.id);
        if (!usdtSelected) {
            return { success: false, error: 'Не удалось выбрать USDT (ERC20)' };
        }
        await randomDelay([500, 1500]); // Оптимизировано: 2000-4000 → 500-1500

        // Шаг 5: Ввести сумму и нажать "ОТПРАВИТЬ"
        const amountSubmitted = await enterAmountAndSubmit(page, account.id, formAmount);
        if (!amountSubmitted) {
            return { success: false, error: 'Не удалось ввести сумму или нажать ОТПРАВИТЬ' };
        }

        logger.info(`✅ Форма депозита отправлена (${formAmount} USDT, отображаемое)`);
        await takeScreenshot(page, account.id, 'dep_07_form_submitted');

        // Шаг 6: Дождать попап оплаты и извлечь адрес
        if (!browser) {
            logger.warn('⚠️ Browser не передан, пропускаем извлечение адреса.');
            return { success: true, amount: formAmount, actualSent: actualSendAmount };
        }

        const depositAddress = await extractAddressFromPaymentPopup(browser, page, account.id);
        if (!depositAddress) {
            return { 
                success: false, 
                error: 'Не удалось извлечь адрес из попапа оплаты' 
            };
        }

        // Шаг 7: Отправить USDT на адрес
        if (!depositCfg.walletsPath) {
            logger.warn('⚠️ walletsPath не указан в config.json, пропускаем отправку.');
            return {
                success: true,
                amount: formAmount,
                actualSent: actualSendAmount,
                depositAddress,
                note: 'Адрес извлечён, но walletsPath не настроен'
            };
        }

        const sendResult = await sendUsdtToAddress(depositAddress, actualSendAmount, depositCfg);

        if (sendResult.success) {
            logger.info(`\n🎉 ДЕПОЗИТ ЗАВЕРШЁН УСПЕШНО!`);
            logger.info(`   Аккаунт: #${account.id}`);
            logger.info(`   Форма: ${formAmount} USDT`);
            logger.info(`   Отправлено: ${actualSendAmount} USDT`);
            logger.info(`   Адрес: ${depositAddress}`);
            logger.info(`   TX: ${sendResult.hash}`);
            
            await takeScreenshot(page, account.id, 'dep_10_complete');

            return { 
                success: true, 
                amount: formAmount,
                actualSent: actualSendAmount,
                depositAddress,
                txHash: sendResult.hash,
                gasCostUsd: sendResult.gasCostUsd
            };
        } else {
            logger.error(`❌ Отправка USDT не удалась: ${sendResult.error}`);
            return { 
                success: false, 
                error: `Отправка не удалась: ${sendResult.error}`,
                depositAddress 
            };
        }

    } catch (error) {
        logger.error(`❌ Ошибка депозита #${account.id}: ${error.message}`);
        await takeScreenshot(page, account.id, 'dep_error').catch(() => {});
        return { success: false, error: error.message };
    }
}

module.exports = {
    performDeposit,
    getActivePage,
    dismissTermsPopup,
    dismiss2FAPopup,
    dismissChromePopups,
    navigateToDeposit,
    selectUSDTERC20,
    enterAmountAndSubmit,
    extractAddressFromPaymentPopup,
    sendUsdtToAddress
};

