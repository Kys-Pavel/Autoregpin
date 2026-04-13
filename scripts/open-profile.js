const proxyChain = require('proxy-chain');
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const accountId = process.argv[2];
if (!accountId) {
    console.error('Нужно передать ID аккаунта');
    process.exit(1);
}

const configPath = path.resolve(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

const dataFile = path.join(__dirname, '..', 'data', 'accounts.json');
if (!fs.existsSync(dataFile)) {
    console.error('База аккаунтов не найдена');
    process.exit(1);
}

const accounts = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
const acc = accounts.find(a => a.id == accountId);

if (!acc || !acc.profilePath) {
    console.error('Профиль не найден');
    process.exit(1);
}

const profilePath = path.resolve(__dirname, '..', acc.profilePath);

/**
 * Находит полную строку прокси (с авторизацией) по совпадению порта
 * Это нужно для старых аккаунтов, которые сохранились без пароля
 */
function resolveFullProxy(savedProxy) {
    if (!savedProxy) return null;

    const proxyList = (config.proxy && config.proxy.list) || [];

    // Если в сохранённой строке уже есть @ (=есть логин), используем как есть
    if (savedProxy.includes('@')) {
        return savedProxy;
    }

    // Иначе ищем в config.proxy.list строку с таким же хостом:портом
    try {
        const savedUrl = new URL(savedProxy.startsWith('socks') ? savedProxy : 'socks5://' + savedProxy);
        const savedPort = savedUrl.port;
        const savedHost = savedUrl.hostname;

        for (const p of proxyList) {
            try {
                const pUrl = new URL(p.startsWith('socks') ? p : 'socks5://' + p);
                if (pUrl.port === savedPort && pUrl.hostname === savedHost) {
                    console.log(`Найдена полная строка прокси с авторизацией: ${p}`);
                    return p;
                }
            } catch (e) { continue; }
        }

        // Если не нашли совпадение — просто берём первый из списка с тем же портом
        if (proxyList.length > 0) {
            console.log(`Используем первый доступный прокси из config: ${proxyList[0]}`);
            return proxyList[0];
        }
    } catch (e) {
        console.log(`Не удалось распарсить прокси аккаунта: ${e.message}`);
    }

    // Возвращаем что есть
    return savedProxy;
}

(async () => {
    let newProxyUrl = null;
    let proxyArg = null;

    const rawProxy = resolveFullProxy(acc.proxy);

    if (rawProxy) {
        console.log(`Подключение к прокси: ${rawProxy}`);
        try {
            newProxyUrl = await proxyChain.anonymizeProxy(rawProxy);
            proxyArg = newProxyUrl;
            console.log(`Создан локальный тоннель proxy-chain: ${newProxyUrl}`);
        } catch (e) {
            console.error('Ошибка создания тоннеля proxy-chain:', e.message);
        }
    } else {
        console.log('Прокси для этого аккаунта не задан, открываем без прокси');
    }

    const args = [
        '--no-first-run',
        '--no-default-browser-check',
        '--restore-last-session'
    ];
    if (proxyArg) {
        args.push(`--proxy-server=${proxyArg}`);
    }

    let chromeExe = 'chrome.exe';
    if (config.chrome && config.chrome.executablePath) {
        chromeExe = config.chrome.executablePath;
    }

    // Удаляем SingletonLock — он блокирует повторный запуск если предыдущий Chrome не завершился корректно
    const lockFile = path.join(profilePath, 'SingletonLock');
    if (fs.existsSync(lockFile)) {
        try {
            fs.unlinkSync(lockFile);
            console.log('Удален SingletonLock — разблокирован профиль');
        } catch (e) {
            console.warn('Не удалось удалить SingletonLock:', e.message);
        }
    }

    console.log(`Запуск Chrome для аккаунта #${acc.id}...`);
    console.log(`Профиль: ${profilePath}`);

    try {
        const browser = await puppeteer.launch({
            executablePath: chromeExe,
            headless: false,
            userDataDir: profilePath,
            args: args,
            defaultViewport: null
        });

        browser.on('disconnected', async () => {
            console.log('Браузер закрыт.');
            if (newProxyUrl) {
                await proxyChain.closeAnonymizedProxy(newProxyUrl, true).catch(() => { });
                console.log('Proxy-chain тоннель закрыт.');
            }
            process.exit(0);
        });

        console.log(`Chrome запущен успешно!`);
        if (proxyArg) {
            console.log(`Прокси активен: ${proxyArg}`);
        }

    } catch (e) {
        console.error('Ошибка запуска Chrome:', e.message);
        if (newProxyUrl) {
            await proxyChain.closeAnonymizedProxy(newProxyUrl, true).catch(() => { });
        }
        process.exit(1);
    }
})();
