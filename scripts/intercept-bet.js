const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '../config.json');
const ACCOUNTS_PATH = path.resolve(__dirname, '../data/accounts.json');

async function run() {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    
    if (!fs.existsSync(ACCOUNTS_PATH)) {
        console.error('Файл аккаунтов не найден!');
        return;
    }
    const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf-8'));
    // Берем любой аккаунт для теста, например последний зарегистрированный
    const account = accounts[accounts.length - 1]; 
    if (!account) return console.log('Нет аккаунтов');

    const profileDir = path.resolve(__dirname, '..', account.profilePath || `profiles/profile_${account.id}`);
    console.log(`Используем профиль: ${profileDir}`);

    let proxyArgs = [];
    if (account.proxy) {
        proxyArgs.push(`--proxy-server=${account.proxy.replace('socks5://', 'socks5://').replace('http://', '')}`);
    }

    const browser = await puppeteer.launch({
        executablePath: config.chrome?.executablePath || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: false,
        userDataDir: profileDir,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            ...proxyArgs
        ],
        defaultViewport: null
    });

    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    
    // Включаем перехват запросов
    await page.setRequestInterception(true);
    page.on('request', req => {
        const url = req.url();
        const method = req.method();
        
        // Ловим все интересные POST запросы, которые могут быть отправкой купона
        if (method === 'POST' && (url.includes('/bet') || url.includes('/api/') || url.includes('/graphql'))) {
            console.log('\n\n======================================================');
            console.log('🔵 ПОЙМАН ЗАПРОС СТАВКИ / API:');
            console.log('URL:    ', url);
            console.log('METHOD: ', method);
            console.log('HEADERS:', JSON.stringify(req.headers(), null, 2));
            console.log('BODY:   ', req.postData());
            console.log('======================================================\n\n');
        }
        
        // Также перехватываем WebSocket соединения для отладки
        if (req.resourceType() === 'websocket') {
            console.log(`\n🔌 WebSocket connection: ${url}`);
        }
        
        req.continue();
    });

    // Открываем Pinnacle
    const mirror = account.mirrorUsed || account.mirrorUrl || config.registration.mirrors[0] || 'https://www.thundercrest65.xyz';
    console.log(`Переходим на зеркало: ${mirror}/ru/compact/sports/soccer/live`);
    await page.goto(`${mirror}/ru/compact/sports/soccer/live`, { waitUntil: 'domcontentloaded' }).catch(()=>console.log('Таймаут перехода, продолжаем...'));

    console.log('\n✅ Браузер открыт. Пожалуйста, выполните в открывшемся окне следующее:');
    console.log('1. Дождитесь загрузки live-событий');
    console.log('2. Кликните на любой коэффициент, чтобы открыть купон (Betslip)');
    console.log('3. Введите сумму');
    console.log('4. Нажмите "Сделать ставку" (можно даже с пустым балансом, чтобы просто поймать запрос)');
    console.log('----------------------------------------------------');
    console.log('Скрипт перехватит сетевой запрос Pinnacle API и выдаст сюда точный JSON, заголовки и формат данных, который мы потом используем для скрытой проставки!');
    
    // Не закрываем браузер автоматически
}

run().catch(console.error);
