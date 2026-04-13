const http = require('http');
const https = require('https');
const { URL } = require('url');
const logger = require('./logger');

class ProxyManager {
    // Статическая мап занятых прокси: port -> accountId
    // Используется для защиты от double-use в многопоточном режиме
    static usedProxies = new Map(); // port -> accountId

    /**
     * @param {Object} proxyConfig - конфигурация прокси из config.json
     * @param {string|null} locale - код страны (RU, UA, ...) для выбора локальных прокси
     */
    constructor(proxyConfig, locale = null) {
        let conf = null;
        this.generatedFromRange = false;

        // 1. Пытаемся получить настройки по локали
        if (locale && proxyConfig.byLocale && proxyConfig.byLocale[locale]) {
            conf = proxyConfig.byLocale[locale];
        }

        // 2. Если есть baseString и порты — генерируем list на лету
        //    (list может быть пустым если пользователь не нажал Save в UI)
        if (conf) {
            let list = conf.list || [];
            if (list.length === 0 && conf.baseString && conf.startPort && conf.endPort) {
                list = ProxyManager.buildList(conf.baseString, conf.startPort, conf.endPort);
                this.generatedFromRange = true;
                logger.info(`🔄 Список прокси для ${locale} сгенерирован на лету: ${list.length} шт`);
            }
            this.proxies = list;
            logger.info(`🌍 Прокси для ${locale}: ${this.proxies.length} шт`);
        } else {
            // Фаллбэк на глобальные
            let list = proxyConfig.list || [];
            if (list.length === 0 && proxyConfig.baseString && proxyConfig.startPort && proxyConfig.endPort) {
                list = ProxyManager.buildList(proxyConfig.baseString, proxyConfig.startPort, proxyConfig.endPort);
                this.generatedFromRange = true;
                logger.info(`🔄 Глобальный список прокси сгенерирован на лету: ${list.length} шт`);
            }
            this.proxies = list;
            if (locale) {
                logger.warn(`⚠️ Прокси для локали ${locale} не найдены, используем глобальные (${this.proxies.length} шт)`);
            }
        }

        this.changeIpUrl = proxyConfig.changeIpUrl || '';
        this.rotationStrategy = proxyConfig.rotationStrategy || 'sequential';
        this.currentIndex = 0;
    }

    /**
     * Генерация списка прокси из baseString + диапазон портов
     */
    static buildList(baseString, startPort, endPort) {
        const list = [];
        for (let p = parseInt(startPort); p <= parseInt(endPort); p++) {
            list.push(`${baseString}${p}`);
        }
        return list;
    }

    /**
     * Освобождение прокси (call after registration done)
     */
    static releaseProxy(port) {
        ProxyManager.usedProxies.delete(port);
        logger.debug(`✅ Прокси порт ${port} освобождён`);
    }

    /**
     * Сброс всех занятых прокси (helper for restart)
     */
    static resetUsed() {
        ProxyManager.usedProxies.clear();
    }

    /**
     * Парсинг строки прокси
     * Поддерживаемые форматы:
     *   http://user:pass@host:port
     *   socks5://user:pass@host:port
     *   host:port:user:pass
     *   host:port
     */
    static parseProxy(proxyStr) {
        // Формат URL
        if (proxyStr.includes('://')) {
            try {
                // Извлекаем auth-часть "напрямую" регуляркой, чтобы не терять спецсимволы
                const match = proxyStr.match(/(.+:\/\/)([-a-zA-Z0-9$_.+!*'(),%;:@&=]+@)(.+)/);
                let authStr = '';
                if (match) authStr = match[2];
                else {
                    // fallback. если юзернейм пустой или нет собаки
                    const url = new URL(proxyStr);
                    if (url.username || url.password) {
                        authStr = `${url.username}:${url.password}@`;
                    }
                }

                const url = new URL(proxyStr);
                return {
                    type: url.protocol.replace(':', ''),
                    host: url.hostname,
                    port: parseInt(url.port, 10),
                    username: decodeURIComponent(url.username || ''),
                    password: decodeURIComponent(url.password || ''),
                    authStr: authStr,
                    raw: proxyStr
                };
            } catch (e) {
                logger.error(`Не удалось распарсить прокси URL: ${proxyStr}`, { error: e.message });
                return null;
            }
        }

        // Формат host:port:user:pass
        const parts = proxyStr.split(':');
        if (parts.length === 4) {
            return {
                type: 'http',
                host: parts[0],
                port: parseInt(parts[1], 10),
                username: parts[2],
                password: parts[3],
                raw: proxyStr
            };
        }

        // Формат host:port
        if (parts.length === 2) {
            return {
                type: 'http',
                host: parts[0],
                port: parseInt(parts[1], 10),
                username: '',
                password: '',
                raw: proxyStr
            };
        }

        logger.error(`Неизвестный формат прокси: ${proxyStr}`);
        return null;
    }

    /**
     * Получить следующий прокси
     */
    getNext() {
        if (this.proxies.length === 0) {
            return null;
        }

        let proxy;
        if (this.rotationStrategy === 'random') {
            const idx = Math.floor(Math.random() * this.proxies.length);
            proxy = this.proxies[idx];
        } else {
            proxy = this.proxies[this.currentIndex];
            this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
        }

        return ProxyManager.parseProxy(proxy);
    }

    /**
     * Получить прокси для конкретного аккаунта
     * Порт = базовый + (accountId - 1)
     * Каждый порт у SOAX = отдельный IP
     * Проверяет, что прокси не используется другим потоком
     */
    getProxyForAccount(accountId) {
        if (this.proxies.length === 0) {
            return null;
        }

        if (!this.generatedFromRange) {
            const index = Math.max(0, (accountId - 1) % this.proxies.length);
            const proxy = ProxyManager.parseProxy(this.proxies[index]);
            if (!proxy) return null;

            if (!isNaN(proxy.port)) {
                ProxyManager.usedProxies.set(proxy.port, accountId);
            }

            logger.info(`Proxy for #${accountId}: ${proxy.type}://${proxy.host}:${proxy.port}`);
            return proxy;
        }

        const baseProxy = ProxyManager.parseProxy(this.proxies[0]);
        if (!baseProxy) return null;

        // Ищем свободный порт, не занятый другим потоком
        let port = baseProxy.port + (accountId - 1);
        const maxPort = baseProxy.port + this.proxies.length - 1;
        let attempts = 0;

        while (ProxyManager.usedProxies.has(port) && attempts < this.proxies.length) {
            port++;
            if (port > maxPort) port = baseProxy.port; // cyclically wrap
            attempts++;
        }

        if (ProxyManager.usedProxies.has(port)) {
            // Все порты заняты — берём базовый и предупреждаем
            logger.warn(`⚠️ Все порты заняты, используем первый доступный порт для #${accountId}`);
            port = baseProxy.port + (accountId - 1);
        }

        // Отмечаем порт как занятый
        ProxyManager.usedProxies.set(port, accountId);

        const authPart = baseProxy.authStr || (baseProxy.username ? `${baseProxy.username}:${baseProxy.password}@` : '');

        const proxy = {
            ...baseProxy,
            port,
            raw: `${baseProxy.type}://${authPart}${baseProxy.host}:${port}`
        };

        logger.info(`🌐 Прокси для #${accountId}: ${proxy.type}://${proxy.host}:${proxy.port}`);
        return proxy;
    }

    /**
     * Формирование аргумента --proxy-server для Chrome
     */
    getChromeArg(proxy) {
        if (!proxy) return null;
        return `${proxy.type}://${proxy.host}:${proxy.port}`;
    }

    /**
     * Смена IP через HTTP GET запрос
     */
    async changeIp(customUrl = null) {
        const url = customUrl || this.changeIpUrl;
        if (!url) {
            logger.debug('URL смены IP не задан, пропускаю');
            return { success: true, skipped: true };
        }

        logger.info(`Смена IP: ${url}`);

        return new Promise((resolve) => {
            const client = url.startsWith('https') ? https : http;

            const req = client.get(url, { timeout: 15000 }, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => {
                    logger.info(`Смена IP: HTTP ${res.statusCode}`, { response: body.substring(0, 200) });
                    if (res.statusCode >= 200 && res.statusCode < 400) {
                        resolve({ success: true, statusCode: res.statusCode, body });
                    } else {
                        resolve({ success: false, statusCode: res.statusCode, body });
                    }
                });
            });

            req.on('error', (err) => {
                logger.error(`Ошибка смены IP: ${err.message}`);
                resolve({ success: false, error: err.message });
            });

            req.on('timeout', () => {
                req.destroy();
                logger.error('Таймаут смены IP');
                resolve({ success: false, error: 'timeout' });
            });
        });
    }

    /**
     * Проверка прокси через запрос к IP-чекеру
     */
    async checkProxy(proxy) {
        // Проверка делается через реальный запрос в браузере, 
        // тут просто базовая валидация
        if (!proxy) return { valid: false, reason: 'proxy is null' };
        if (!proxy.host || !proxy.port) return { valid: false, reason: 'missing host or port' };
        if (isNaN(proxy.port) || proxy.port < 1 || proxy.port > 65535) {
            return { valid: false, reason: 'invalid port' };
        }
        return { valid: true };
    }

    /**
     * Количество доступных прокси
     */
    get count() {
        return this.proxies.length;
    }

    /**
     * Есть ли прокси
     */
    get hasProxies() {
        return this.proxies.length > 0;
    }
}

module.exports = ProxyManager;
