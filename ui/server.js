const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { execSync, spawn: spawnProc } = require('child_process');

// === Убить старый процесс на порту ===
function killOldProcess(port) {
    try {
        const result = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8', timeout: 5000 });
        const lines = result.split('\n').filter(l => l.includes('LISTENING'));
        const pids = new Set();
        for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && pid !== '0' && parseInt(pid) !== process.pid) {
                pids.add(pid);
            }
        }
        for (const pid of pids) {
            try {
                execSync(`taskkill /PID ${pid} /F`, { encoding: 'utf-8', timeout: 5000 });
                console.log(`Killed old process PID ${pid} on port ${port}`);
            } catch (_) { }
        }
        if (pids.size > 0) {
            // Подождать освобождения порта
            const wait = (ms) => new Promise(r => setTimeout(r, ms));
            return wait(1000);
        }
    } catch (_) {
        // Порт свободен — ОК
    }
    return Promise.resolve();
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, path) => {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Surrogate-Control', 'no-store');
    }
}));
app.use(express.json());

// Разрешаем CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Получение списка аккаунтов (для таблицы)
app.get('/api/accounts', (req, res) => {
    try {
        const file = path.join(__dirname, '..', 'data', 'accounts.json');
        if (fs.existsSync(file)) {
            res.json(JSON.parse(fs.readFileSync(file, 'utf-8')));
        } else {
            res.json([]);
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Broadcast логов
function broadcastLog(msg) {
    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify({ type: 'log', message: msg }));
        }
    });
}

let isRunning = false;
let activeChildren = []; // Массив дочерних процессов (потоков)

// === Автозавершение при закрытии Chrome ===
let autoShutdownTimer = null;
const AUTO_SHUTDOWN_DELAY = 5000; // 5 секунд после отключения последнего клиента

function scheduleAutoShutdown() {
    if (autoShutdownTimer) clearTimeout(autoShutdownTimer);
    // Если нет активных клиентов и нет запущенных задач — завершаемся
    if (wss.clients.size === 0) {
        autoShutdownTimer = setTimeout(() => {
            if (wss.clients.size === 0) {
                console.log('All clients disconnected. Shutting down...');
                gracefulShutdown();
            }
        }, AUTO_SHUTDOWN_DELAY);
    }
}

function cancelAutoShutdown() {
    if (autoShutdownTimer) {
        clearTimeout(autoShutdownTimer);
        autoShutdownTimer = null;
    }
}

wss.on('connection', (ws) => {
    cancelAutoShutdown();
    ws.on('close', () => {
        scheduleAutoShutdown();
    });
});

// === Graceful shutdown ===
function gracefulShutdown() {
    console.log('Graceful shutdown...');
    // Убиваем все дочерние процессы
    if (activeChildren.length > 0) {
        activeChildren.forEach(child => {
            try { child.kill('SIGTERM'); } catch (_) { }
        });
        activeChildren = [];
    }
    if (affiliateScanChild) {
        try { affiliateScanChild.kill('SIGTERM'); } catch (_) { }
        affiliateScanChild = null;
    }
    // Закрываем сервер
    try { server.close(); } catch (_) { }
    process.exit(0);
}

// Обработка сигналов завершения
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

app.post('/api/stop', (req, res) => {
    if (activeChildren.length > 0) {
        broadcastLog(`🛑 Останавливаю ${activeChildren.length} потоков...`);
        activeChildren.forEach(child => {
            try { child.kill('SIGTERM'); } catch (_) { }
        });
        activeChildren = [];
    }
    isRunning = false;
    broadcastLog('🛑 Регистрация остановлена вручную');
    wss.clients.forEach(c => {
        if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify({ type: 'done' }));
    });
    res.json({ success: true });
});

app.post('/api/start', (req, res) => {
    if (isRunning) return res.status(400).json({ error: 'Регистрация уже идет!' });

    // Сохраняем валюту и локаль в config.json
    try {
        const configPath = path.join(__dirname, '..', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.account = config.account || {};
        config.registration = config.registration || {};

        // Мапинг USDT -> UDT, USDC -> USDC
        const userChoice = req.body.currency;
        config.account.currency = userChoice === 'USDT' ? 'UDT' : 'USDC';

        // Локаль (страна регистрации)
        if (req.body.locale) {
            config.registration.locale = req.body.locale;
        }

        // Депозит
        config.deposit = config.deposit || {};
        if (req.body.depositEnabled !== undefined) {
            config.deposit.enabled = req.body.depositEnabled;
        }
        if (req.body.depositAmount !== undefined) {
            config.deposit.amount = parseInt(req.body.depositAmount) || 20;
        }

        // Настройки орбитража (ставок)
        config.betting = config.betting || {};
        if (req.body.targetForks !== undefined) {
            config.betting.targetForks = parseInt(req.body.targetForks) || 1;
        }
        if (req.body.minProfit !== undefined) {
            config.betting.minProfitPct = parseFloat(req.body.minProfit) || 0;
        }
        if (req.body.settlementCheckIntervalSec !== undefined) {
            config.betting.settlementCheckIntervalSec = parseInt(req.body.settlementCheckIntervalSec) || 60;
        }

        fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
        broadcastLog(`Установлена валюта: ${userChoice} (${config.account.currency}), локаль: ${req.body.locale || config.registration.locale || 'RU'}, депозит: ${config.deposit.enabled !== false ? (config.deposit.amount || 20) + ' USDT' : 'ВЫКЛ'}`);
        broadcastLog(`🎲 Настройки вилок: ${config.betting.targetForks} шт, мин.профит ${config.betting.minProfitPct}%, проверка раз в ${config.betting.settlementCheckIntervalSec}сек.`);
    } catch (e) {
        broadcastLog(`Ошибка сохранения config: ${e.message}`);
    }

    isRunning = true;
    const totalRegs = req.body.regCount || 1;
    const threadCount = Math.min(Math.max(parseInt(req.body.threadCount) || 1, 1), 10);
    res.json({ message: `Запущено ${threadCount} потоков` });
    broadcastLog(`🚀 СТАРТ: ${totalRegs} регистраций в ${threadCount} потоков 🚀`);

    const testEmailArgs = req.body.useTestEmail ? ['--test-email'] : [];
    const keepOpenArgs = req.body.keepOpen ? ['--keep-open', req.body.keepSeconds || 60] : [];
    const localeArg = req.body.locale ? ['--locale', req.body.locale] : [];
    const affiliateArg = req.body.useAffiliate && req.body.affiliateUrl
        ? ['--affiliate-url', req.body.affiliateUrl]
        : [];
    const { spawn } = require('child_process');

    activeChildren = [];
    let finishedCount = 0;

    // Распределяем регистрации по потокам
    const regsPerThread = Math.ceil(totalRegs / threadCount);
    let assignedTotal = 0;

    for (let t = 0; t < threadCount; t++) {
        const count = Math.min(regsPerThread, totalRegs - assignedTotal);
        if (count <= 0) break;
        assignedTotal += count;

        const child = spawn('node', [
            path.join(__dirname, '..', 'scripts', 'test-run.js'),
            '--count', count,
            '--thread-id', t,
            '--total-threads', threadCount,
            ...testEmailArgs,
            ...keepOpenArgs,
            ...localeArg,
            ...affiliateArg
        ]);

        const threadLabel = `[Поток ${t + 1}]`;

        child.stdout.on('data', data => {
            const lines = data.toString().split('\n').filter(l => l.trim());
            lines.forEach(line => broadcastLog(`${threadLabel} ${line}`));
        });
        child.stderr.on('data', data => {
            const lines = data.toString().split('\n').filter(l => l.trim());
            lines.forEach(line => broadcastLog(`${threadLabel} ⚠️ ${line}`));
        });

        child.on('close', code => {
            finishedCount++;
            broadcastLog(`${threadLabel} 🏁 Завершён (код ${code}) [${finishedCount}/${threadCount}]`);

            // Убираем из массива
            activeChildren = activeChildren.filter(c => c !== child);

            // Все потоки завершились?
            if (finishedCount >= threadCount) {
                broadcastLog(`\n🏁🏁🏁 ВСЕ ${threadCount} ПОТОКОВ ЗАВЕРШЕНЫ 🏁🏁🏁`);
                isRunning = false;
                wss.clients.forEach(c => {
                    if (c.readyState === WebSocket.OPEN) {
                        c.send(JSON.stringify({ type: 'done' }));
                    }
                });
            }
        });

        activeChildren.push(child);
    }
});

// === API Перебора Affiliate ID ===
let affiliateScanChild = null;

app.post('/api/affiliate-scan/start', (req, res) => {
    if (affiliateScanChild) {
        return res.status(400).json({ error: 'Перебор уже запущен' });
    }
    const { fromId = '00000000', toId = '00000100', locale, noProxy, threads = 1 } = req.body;
    const localeArg = locale ? ['--locale', locale] : [];
    const noProxyArg = noProxy ? ['--no-proxy'] : [];
    const threadsArg = ['--threads', String(Math.min(Math.max(parseInt(threads) || 1, 1), 15))];
    const { spawn } = require('child_process');

    affiliateScanChild = spawn('node', [
        path.join(__dirname, '..', 'scripts', 'affiliate-scan.js'),
        '--from', fromId,
        '--to', toId,
        ...localeArg,
        ...noProxyArg,
        ...threadsArg
    ]);

    affiliateScanChild.stdout.on('data', data => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        lines.forEach(line => broadcastLog(`[AffScan] ${line}`));
    });
    affiliateScanChild.stderr.on('data', data => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        lines.forEach(line => broadcastLog(`[AffScan] ⚠️ ${line}`));
    });
    affiliateScanChild.on('close', (code) => {
        broadcastLog(`[AffScan] 🏁 Завершён (код ${code})`);
        affiliateScanChild = null;
        wss.clients.forEach(c => {
            if (c.readyState === WebSocket.OPEN) {
                c.send(JSON.stringify({ type: 'done' }));
            }
        });
    });

    broadcastLog(`🔍 Запущен перебор affiliate: A6${fromId}–A6${toId} (локаль: ${locale || 'из config'})`);
    res.json({ message: 'Перебор запущен' });
});

app.post('/api/affiliate-scan/stop', (req, res) => {
    if (affiliateScanChild) {
        try { affiliateScanChild.kill('SIGTERM'); } catch (_) { }
        affiliateScanChild = null;
        broadcastLog('[AffScan] 🛑 Перебор остановлен вручную');
    }
    res.json({ message: 'Stopped' });
});


const mirrorsFile = path.join(__dirname, '..', 'data', 'mirrors.json');

function loadMirrorsData() {
    try {
        if (fs.existsSync(mirrorsFile)) {
            return JSON.parse(fs.readFileSync(mirrorsFile, 'utf-8'));
        }
    } catch (_) { }
    return [];
}

app.get('/api/mirrors', (req, res) => {
    res.json(loadMirrorsData());
});

app.post('/api/mirrors/add', (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL обязателен' });

        const mirrors = loadMirrorsData();
        if (!mirrors.includes(url)) {
            mirrors.push(url);
            fs.writeFileSync(mirrorsFile, JSON.stringify(mirrors, null, 4));
        }

        // Также обновим config.json registration.mirrors
        try {
            const configPath = path.join(__dirname, '..', 'config.json');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            config.registration = config.registration || {};
            config.registration.mirrors = mirrors;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
        } catch (_) { }

        res.json({ success: true, mirrors });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/mirrors/delete', (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL обязателен' });

        let mirrors = loadMirrorsData();
        mirrors = mirrors.filter(m => m !== url);
        fs.writeFileSync(mirrorsFile, JSON.stringify(mirrors, null, 4));

        // Синхронизируем config.json
        try {
            const configPath = path.join(__dirname, '..', 'config.json');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            config.registration = config.registration || {};
            config.registration.mirrors = mirrors;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
        } catch (_) { }

        res.json({ success: true, mirrors });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// === API для Настроек Gemini ===
app.get('/api/gemini/config', (req, res) => {
    try {
        const configPath = path.join(__dirname, '..', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const g = config.gemini || {};
        res.json({ apiKey: g.apiKey || '', model: g.model || 'gemini-2.5-flash', proxy: g.proxy || '' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/gemini/config', (req, res) => {
    try {
        const { apiKey, model, proxy } = req.body;
        if (!apiKey) return res.status(400).json({ error: 'API Key обязателен' });

        const configPath = path.join(__dirname, '..', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.gemini = config.gemini || {};
        config.gemini.apiKey = apiKey;
        config.gemini.model = model || 'gemini-2.5-flash';
        config.gemini.proxy = proxy || '';
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4));

        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// === API для Настроек Депозита ===
app.get('/api/deposit/config', (req, res) => {
    try {
        const configPath = path.join(__dirname, '..', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const d = config.deposit || {};
        res.json({ enabled: d.enabled !== false, amount: d.amount || 20, method: d.method || 'USDT_ERC20' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/deposit/config', (req, res) => {
    try {
        const configPath = path.join(__dirname, '..', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.deposit = config.deposit || {};
        if (req.body.enabled !== undefined) config.deposit.enabled = req.body.enabled;
        if (req.body.amount !== undefined) config.deposit.amount = parseInt(req.body.amount) || 20;
        if (req.body.method !== undefined) config.deposit.method = req.body.method;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// === API для Настроек Орбитража ===
app.get('/api/betting/config', (req, res) => {
    try {
        const configPath = path.join(__dirname, '..', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const b = config.betting || {};
        res.json({ 
            targetForks: b.targetForks !== undefined ? b.targetForks : 1, 
            minProfitPct: b.minProfitPct || 0,
            settlementCheckIntervalSec: b.settlementCheckIntervalSec || 60
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// === API для Управления статусами CRM ===
app.post('/api/accounts/:id/crm', (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { crmStatus } = req.body;
        const file = path.join(__dirname, '..', 'data', 'accounts.json');

        if (!fs.existsSync(file)) return res.status(404).json({ error: 'База не найдена' });

        const accounts = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const account = accounts.find(a => a.id === id);

        if (!account) return res.status(404).json({ error: 'Аккаунт не найден' });

        account.crmStatus = crmStatus;
        fs.writeFileSync(file, JSON.stringify(accounts, null, 4));

        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// === API для Управления Зеркалами ===
app.get('/api/mirrors', (req, res) => {
    try {
        const file = path.join(__dirname, '..', 'data', 'mirrors.json');
        if (fs.existsSync(file)) {
            res.json(JSON.parse(fs.readFileSync(file, 'utf-8')));
        } else {
            // Фолбэк на конфиг, если файла нет
            const configPath = path.join(__dirname, '..', 'config.json');
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            const defaultMirror = config.registration.mirrors[0] || 'https://www.quietthunder61.xyz/';
            const defaults = [{ id: 'default_mirror', name: 'Original Config', url: defaultMirror }];
            fs.writeFileSync(file, JSON.stringify(defaults, null, 4));
            res.json(defaults);
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/mirrors/add', (req, res) => {
    try {
        const { name, url } = req.body;
        if (!name || !url) return res.status(400).json({ error: 'Name and URL are required' });

        const file = path.join(__dirname, '..', 'data', 'mirrors.json');
        let mirrors = [];
        if (fs.existsSync(file)) {
            mirrors = JSON.parse(fs.readFileSync(file, 'utf-8'));
        }

        const newMirror = { id: 'mirror_' + Date.now(), name, url };
        mirrors.push(newMirror);
        fs.writeFileSync(file, JSON.stringify(mirrors, null, 4));

        res.json({ success: true, mirror: newMirror });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// === API для Управления Email и Черным Списком ===
const getLines = (filePath) => fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8').split('\n').map(l => l.trim().toLowerCase()).filter(Boolean) : [];

app.get('/api/emails', (req, res) => {
    try {
        const file = path.join(__dirname, '..', 'data', 'emails.txt');
        const count = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8').split('\n').filter(l => l.trim()).length : 0;
        res.json({ count });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/emails/add', (req, res) => {
    try {
        const { emailsText } = req.body;
        if (!emailsText) return res.status(400).json({ error: 'Empty payload' });

        // Парсим и чистим входящие
        let rawList = emailsText.split(/[\n,;\t ]+/).map(e => e.trim().toLowerCase()).filter(e => e.includes('@'));
        rawList = [...new Set(rawList)]; // Уник внутри пакета

        const emailFile = path.join(__dirname, '..', 'data', 'emails.txt');
        const blacklistFile = path.join(__dirname, '..', 'data', 'blacklist.txt');

        const existing = new Set(getLines(emailFile));
        const blacklisted = new Set(getLines(blacklistFile));

        const toAdd = [];
        let duplicateCount = 0;
        let blacklistCount = 0;

        for (const email of rawList) {
            if (blacklisted.has(email)) {
                blacklistCount++;
            } else if (existing.has(email)) {
                duplicateCount++;
            } else {
                toAdd.push(email);
            }
        }

        if (toAdd.length > 0) {
            fs.appendFileSync(emailFile, (fs.existsSync(emailFile) ? '\n' : '') + toAdd.join('\n'));
        }

        res.json({
            totalProcessed: rawList.length,
            added: toAdd.length,
            duplicates: duplicateCount,
            blacklisted: blacklistCount
        });

    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/blacklist/get', (req, res) => {
    try {
        const file = path.join(__dirname, '..', 'data', 'blacklist.txt');
        const emails = getLines(file);
        res.json({ emails });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/blacklist/add', (req, res) => {
    try {
        const file = path.join(__dirname, '..', 'data', 'blacklist.txt');
        const existing = new Set(getLines(file));
        const newEmails = (req.body.emailsText || '').split(/[\n,;\t ]+/).map(l => l.trim().toLowerCase()).filter(l => l && l.includes('@'));

        let added = 0;
        let duplicates = 0;

        const toAppend = [];
        for (const e of newEmails) {
            if (existing.has(e)) {
                duplicates++;
            } else {
                existing.add(e);
                toAppend.push(e);
                added++;
            }
        }

        if (toAppend.length > 0) {
            fs.appendFileSync(file, (fs.existsSync(file) ? '\n' : '') + toAppend.join('\n'));
        }

        res.json({ success: true, added, duplicates });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// === API Локали (справочники стран) ===
app.get('/api/locales', (req, res) => {
    try {
        const localesDir = path.join(__dirname, '..', 'data', 'locales');
        if (!fs.existsSync(localesDir)) {
            return res.json([]);
        }
        const files = fs.readdirSync(localesDir).filter(f => f.endsWith('.json'));
        const locales = files.map(f => {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(localesDir, f), 'utf-8'));
                return { code: data.code, name: data.name, flag: data.flag || '🌍', currency: data.currency };
            } catch (e) { return null; }
        }).filter(Boolean);
        res.json(locales);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// === API для Управления Прокси-портами ===
app.get('/api/proxy/config', (req, res) => {
    try {
        const configPath = path.join(__dirname, '..', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const pConf = config.proxy || {};
        const locale = req.query.locale; // ?locale=RU

        if (locale && pConf.byLocale && pConf.byLocale[locale]) {
            // Возвращаем настройки для конкретной локали
            const lConf = pConf.byLocale[locale];
            res.json({
                locale,
                baseString: lConf.baseString || '',
                startPort: lConf.startPort || 0,
                endPort: lConf.endPort || 0,
                list: lConf.list || [],
                count: (lConf.list || []).length
            });
        } else {
            // Дефолт: общие настройки
            res.json({
                locale: null,
                baseString: pConf.baseString || 'socks5://user:pass@127.0.0.1:',
                startPort: pConf.startPort || 20000,
                endPort: pConf.endPort || 20500,
                list: pConf.list || [],
                count: (pConf.list || []).length
            });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/proxy/config', (req, res) => {
    try {
        const configPath = path.join(__dirname, '..', 'config.json');
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.proxy = config.proxy || {};
        config.proxy.byLocale = config.proxy.byLocale || {};

        const locale = req.body.locale || null; // Если указана локаль — сохраняем в byLocale
        let generatedList = [];

        const { baseString, startPort, endPort } = req.body;
        if (!baseString || isNaN(startPort) || isNaN(endPort) || parseInt(startPort) > parseInt(endPort)) {
            return res.status(400).json({ error: 'Invalid proxy parameters' });
        }
        const sp = parseInt(startPort, 10);
        const ep = parseInt(endPort, 10);
        for (let p = sp; p <= ep; p++) {
            generatedList.push(`${baseString}${p}`);
        }

        if (locale) {
            // Сохраняем для конкретной страны
            config.proxy.byLocale[locale] = {
                baseString,
                startPort: sp,
                endPort: ep,
                list: generatedList
            };
            broadcastLog && broadcastLog(`🌍 Прокси для ${locale}: ${generatedList.length} шт (${sp}–${ep})`);
        } else {
            // Сохраняем как глобальные (дефолт)
            config.proxy.baseString = baseString;
            config.proxy.startPort = sp;
            config.proxy.endPort = ep;
            config.proxy.list = generatedList;
        }

        fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
        res.json({ success: true, count: generatedList.length, locale });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/exit', (req, res) => {
    res.json({ message: 'Shutting down...' });
    setTimeout(() => {
        console.log('Server shutting down by user request');
        process.exit(0);
    }, 500);
});

app.post('/api/open-profile/:id', (req, res) => {
    try {
        const file = path.join(__dirname, '..', 'data', 'accounts.json');
        if (!fs.existsSync(file)) return res.status(404).json({ error: 'Нет базы аккаунтов' });
        const accounts = JSON.parse(fs.readFileSync(file, 'utf-8'));
        const acc = accounts.find(a => a.id == req.params.id);

        if (!acc || !acc.profilePath) {
            return res.status(404).json({ error: 'Профиль не найден или папка не сохранена' });
        }

        const fullProfilePath = path.resolve(__dirname, '..', acc.profilePath);
        if (!fs.existsSync(fullProfilePath)) {
            return res.status(404).json({ error: `Папка ${fullProfilePath} физически не существует` });
        }

        const configPath = path.join(__dirname, '..', 'config.json');
        let chromeExe = 'chrome.exe';
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (config.chrome && config.chrome.executablePath) {
                chromeExe = config.chrome.executablePath;
            }
        }

        const { spawn } = require('child_process');
        const scriptPath = path.join(__dirname, '..', 'scripts', 'open-profile.js');
        spawn('node', [scriptPath, acc.id], { detached: true, stdio: 'ignore' }).unref();

        res.json({ success: true, message: 'Скрипт профиля с прокси запущен' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==============================================
// API: Кошельки (wallets.json)
// ==============================================
function getWalletsPath() {
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf-8'));
        return cfg.deposit?.walletsPath || 'c:/Project/deposit/dist/wallets.json';
    } catch { return 'c:/Project/deposit/dist/wallets.json'; }
}

// Получить список кошельков (без приватных ключей). refresh=true → обновить балансы on-chain.
app.get('/api/wallets', async (req, res) => {
    try {
        const walletsPath = getWalletsPath();
        if (!fs.existsSync(walletsPath)) return res.json({ wallets: [], walletsPath });

        const wallets = JSON.parse(fs.readFileSync(walletsPath, 'utf-8'));
        const refresh = req.query.refresh === '1' || req.query.refresh === 'true';

        let walletModule = null;
        if (refresh) {
            try { walletModule = require(path.join(__dirname, '..', 'src', 'wallet.js')); } catch (_) {}
        }

        const out = [];
        for (const w of wallets) {
            let onchainBalance = null;
            if (refresh && walletModule) {
                try {
                    onchainBalance = await walletModule.getUsdtBalance(w.safeAddress);
                } catch (e) {
                    onchainBalance = `error: ${e.message}`;
                }
            }
            out.push({
                name: w.name || null,
                safeAddress: w.safeAddress,
                eoaAddress: w.eoaAddress,
                balance: w.balance || '0.00',
                onchainBalance,
                usedForDeposit: !!w.usedForDeposit,
                depositTxHash: w.depositTxHash || null,
                depositAt: w.depositAt || null,
            });
        }
        res.json({ wallets: out, walletsPath, count: out.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Создать новый кошелёк и дописать в wallets.json
app.post('/api/wallets/create', async (req, res) => {
    try {
        const walletModule = require(path.join(__dirname, '..', 'src', 'wallet.js'));
        const newWallet = await walletModule.createNewWallet();
        const name = (req.body && req.body.name) || `wallet_${Date.now()}`;

        const walletsPath = getWalletsPath();
        const dir = path.dirname(walletsPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        let wallets = [];
        if (fs.existsSync(walletsPath)) {
            try { wallets = JSON.parse(fs.readFileSync(walletsPath, 'utf-8')); } catch { wallets = []; }
        } else {
            // Backup не нужен — файла нет
        }
        // Бэкап перед записью
        try {
            const backupDir = path.join(__dirname, '..', 'data');
            if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
            if (fs.existsSync(walletsPath)) {
                fs.copyFileSync(walletsPath, path.join(backupDir, 'wallets.backup.json'));
            }
        } catch (_) {}

        wallets.push({
            name,
            privateKey: newWallet.privateKey,
            eoaAddress: newWallet.eoaAddress,
            safeAddress: newWallet.safeAddress,
            balance: '0.00',
            usedForDeposit: false,
            createdAt: new Date().toISOString(),
        });
        fs.writeFileSync(walletsPath, JSON.stringify(wallets, null, 2), 'utf-8');
        broadcastLog(`💳 Создан новый кошелёк: ${name} → ${newWallet.safeAddress}`);
        res.json({ success: true, name, safeAddress: newWallet.safeAddress, eoaAddress: newWallet.eoaAddress });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Удалить кошелёк по safeAddress (опасная операция — есть бэкап)
app.post('/api/wallets/delete', (req, res) => {
    try {
        const { safeAddress } = req.body || {};
        if (!safeAddress) return res.status(400).json({ error: 'safeAddress обязателен' });

        const walletsPath = getWalletsPath();
        if (!fs.existsSync(walletsPath)) return res.status(404).json({ error: 'wallets.json не найден' });

        // Бэкап
        const backupDir = path.join(__dirname, '..', 'data');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        fs.copyFileSync(walletsPath, path.join(backupDir, 'wallets.backup.json'));

        const wallets = JSON.parse(fs.readFileSync(walletsPath, 'utf-8'));
        const before = wallets.length;
        const filtered = wallets.filter(w =>
            (w.safeAddress || '').toLowerCase() !== safeAddress.toLowerCase()
        );
        if (filtered.length === before) return res.status(404).json({ error: 'Кошелёк не найден' });

        fs.writeFileSync(walletsPath, JSON.stringify(filtered, null, 2), 'utf-8');
        broadcastLog(`🗑 Кошелёк удалён: ${safeAddress}`);
        res.json({ success: true, removed: before - filtered.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

const PORT = 35890; // Статичный порт для удобства разработки

// Убиваем старый процесс перед запуском
killOldProcess(PORT).then(() => {
    server.listen(PORT, () => {
        console.log(`UI Server started on http://localhost:${PORT}`);

        // Запуск Chrome в режиме App Mode
        const chromePaths = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
        ];

        let browserExecuted = false;
        for (const p of chromePaths) {
            if (fs.existsSync(p)) {
                spawnProc(p, [`--app=http://localhost:${PORT}`, '--window-size=1100,800']);
                browserExecuted = true;
                break;
            }
        }

        if (!browserExecuted) {
            console.log('Пожалуйста, откройте http://localhost:35890 в вашем браузере');
        }
    });
});
