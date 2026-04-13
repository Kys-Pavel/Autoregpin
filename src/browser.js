const puppeteer = require('puppeteer-core');
const proxyChain = require('proxy-chain');
const logger = require('./logger');

// Список user-agent'ов для ротации
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
];

const VIEWPORTS = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1536, height: 864 },
    { width: 1440, height: 900 },
    { width: 1680, height: 1050 },
    { width: 1280, height: 720 }
];

class BrowserManager {
    /**
     * @param {Object} chromeConfig
     * @param {string} chromeConfig.executablePath - путь к chrome.exe
     * @param {boolean} chromeConfig.headless - headless режим
     */
    constructor(chromeConfig) {
        this.executablePath = chromeConfig.executablePath;
        this.headless = chromeConfig.headless || false;
        this.browser = null;
        this.page = null;
        this.anonymizedProxyUrl = null; // для proxy-chain
    }

    /**
     * Формирование аргументов запуска Chrome
     */
    buildLaunchArgs(options = {}) {
        const { userDataDir, proxyArg, userAgent } = options;

        const args = [
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--disable-dev-shm-usage',
            '--disable-extensions',
            '--disable-gpu',
            '--disable-setuid-sandbox',
            '--no-sandbox',
            `--lang=en-US,en`,
            // Отключаем Chrome popups: "Сохранить пароль?", "Сохранить адрес?", перевод, уведомления
            '--disable-save-password-bubble',
            '--disable-translate',
            '--disable-notifications',
            '--disable-popup-blocking',
            '--disable-component-update',
            '--password-store=basic',
            '--disable-features=PasswordManager,AutofillAddressProfileSavePrompt,AutofillCreditCardEnabled,TranslateUI,AutofillServerCommunication',
            '--enable-features=PasswordImport',
            '--autofill-server-url=',
            '--disable-autofill-keyboard-accessory-view',
            // === Оптимизация памяти ===
            '--ignore-certificate-errors',
            '--disk-cache-size=33554432',          // Ограничиваем дисковый кэш 32MB
            '--disable-background-networking',      // Без фоновых сетевых запросов
            '--disable-sync',                       // Без синхронизации Google
            '--disable-default-apps',               // Без приложений по умолчанию
            '--disable-logging',                    // Без лишнего логирования Chrome
            '--disable-hang-monitor',               // Без мониторинга зависаний (экономит CPU)
            '--metrics-recording-only',             // Минимальная телеметрия
            '--no-pings',                           // Без ping-запросов
            '--disable-breakpad',                   // Без crash reporter
            '--disable-component-extensions-with-background-pages',  // Без фоновых extension-процессов
            '--disable-ipc-flooding-protection',    // Быстрее IPC для Puppeteer
            '--disable-renderer-backgrounding',     // Не замедлять фоновые вкладки
        ];

        if (proxyArg) {
            args.push(`--proxy-server=${proxyArg}`);
        }

        if (userDataDir) {
            args.push(`--user-data-dir=${userDataDir}`);
        }

        return args;
    }

    /**
     * Случайный user-agent
     */
    getRandomUserAgent() {
        return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    }

    /**
     * Случайный viewport
     */
    getRandomViewport() {
        return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
    }

    /**
     * Запуск Chrome и подключение через CDP
     */
    async launch(options = {}) {
        const { userDataDir } = options;
        const userAgent = this.getRandomUserAgent();
        const viewport = this.getRandomViewport();

        // Если есть прокси с аутентификацией — используем proxy-chain
        let proxyArg = options.proxyArg;
        if (options.proxyUrl) {
            // proxy-chain создаёт локальный анонимный прокси, который форвардит на реальный
            // Это решает проблему SOCKS5 auth, которую Chrome не поддерживает напрямую
            logger.info(`Создаю proxy-chain тоннель для: ${options.proxyUrl}`);
            try {
                this.anonymizedProxyUrl = await proxyChain.anonymizeProxy(options.proxyUrl);
                proxyArg = this.anonymizedProxyUrl;
                logger.info(`Proxy-chain тоннель: ${this.anonymizedProxyUrl}`);
            } catch (error) {
                logger.error(`Ошибка proxy-chain: ${error.message}`);
                throw error;
            }
        }

        const args = this.buildLaunchArgs({
            userDataDir,
            proxyArg,
            userAgent
        });

        logger.info(`Запуск Chrome: ${this.executablePath}`, {
            userDataDir: userDataDir || 'default',
            proxy: proxyArg || 'none',
            viewport: `${viewport.width}x${viewport.height}`
        });

        try {
            this.browser = await puppeteer.launch({
                executablePath: this.executablePath,
                headless: this.headless,
                args,
                defaultViewport: viewport,
                ignoreHTTPSErrors: true
            });

            // Логируем если Chrome неожиданно отключился
            this.browser.on('disconnected', () => {
                logger.warn('Chrome отключился (disconnected)');
            });

            this.page = await this.browser.newPage();

            // Антидетект: переопределяем navigator.webdriver
            await this.page.evaluateOnNewDocument(() => {
                Object.defineProperty(navigator, 'webdriver', { get: () => false });

                // Переопределяем permissions
                const originalQuery = window.navigator.permissions.query;
                window.navigator.permissions.query = (parameters) =>
                    parameters.name === 'notifications'
                        ? Promise.resolve({ state: Notification.permission })
                        : originalQuery(parameters);

                // Плагины
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3, 4, 5]
                });

                // Languages
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['en-US', 'en', 'ru']
                });

                // Chrome runtime
                window.chrome = { runtime: {} };
            });

            await this.page.setUserAgent(userAgent);

            logger.info('Chrome запущен успешно');
            return { browser: this.browser, page: this.page };
        } catch (error) {
            logger.error(`Ошибка запуска Chrome: ${error.message}`);
            throw error;
        }
    }

    /**
     * Закрытие браузера
     */
    async close() {
        if (this.browser) {
            try {
                await this.browser.close();
                logger.info('Chrome закрыт');
            } catch (e) {
                logger.warn(`Ошибка при закрытии Chrome: ${e.message}`);
            }
            this.browser = null;
            this.page = null;
        }
        // Закрываем proxy-chain тоннель
        if (this.anonymizedProxyUrl) {
            try {
                await proxyChain.closeAnonymizedProxy(this.anonymizedProxyUrl, true);
                logger.info('Proxy-chain тоннель закрыт');
            } catch (e) {
                logger.warn(`Ошибка закрытия proxy-chain: ${e.message}`);
            }
            this.anonymizedProxyUrl = null;
        }
    }

    /**
     * Получить текущую страницу
     */
    getPage() {
        return this.page;
    }

    /**
     * Получить текущий браузер
     */
    getBrowser() {
        return this.browser;
    }
}

module.exports = { BrowserManager, USER_AGENTS, VIEWPORTS };
