const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '../config.json');
const ACCOUNTS_PATH = path.resolve(__dirname, '../data/accounts.json');

const proxyChain = require('proxy-chain');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    const accounts = JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf-8'));
    
    // Берем последний аккаунт с сохраненным профилем
    const account = accounts[accounts.length - 1]; 
    if (!account) return console.log('Нет аккаунтов для теста');

    const profileDir = path.resolve(__dirname, '..', account.profilePath || `profiles/profile_${account.id}`);
    console.log(`Используем профиль: ${profileDir}`);

    let proxyArgs = [];
    let proxyTunnel = null;
    if (account.proxy) {
        try {
            proxyTunnel = await proxyChain.anonymizeProxy(account.proxy);
            proxyArgs.push(`--proxy-server=${proxyTunnel}`);
            console.log(`ProxyTunnel: ${proxyTunnel}`);
        } catch (e) {
            console.log('Proxy chain failed, trying direct:', e.message);
            proxyArgs.push(`--proxy-server=${account.proxy.replace('socks5://', 'socks5://').replace('http://', '')}`);
        }
    }

    const browser = await puppeteer.launch({
        executablePath: config.chrome?.executablePath || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: 'new', // Фоновый режим
        userDataDir: profileDir,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--window-size=1280,800',
            ...proxyArgs
        ],
        defaultViewport: null
    });

    const pages = await browser.pages();
    const page = pages[0] || await browser.newPage();
    
    let capturedPayload = null;
    let csrfToken = null;
    let betUrl = null;

    // Перехват API
    await page.setRequestInterception(true);
    page.on('request', req => {
        const url = req.url();
        const method = req.method();
        const headers = req.headers();
        
        // Ловим POST ставки
        if (method === 'POST' && (url.includes('/bet') || url.includes('/api/v') || url.includes('graphql'))) {
            // Исключаем лишнее логирование, пытаемся выцепить саму ставку
            if (url.includes('place') || url.includes('/bets') || url.includes('straight')) {
                capturedPayload = {
                    url: url,
                    headers: headers,
                    body: req.postData()
                };
                console.log(`\n\n[API-INTERCEPT] 💎 ПОЙМАН ЗАПРОС СТАВКИ!\nURL: ${url}\nBODY: ${capturedPayload.body}\n`);
                fs.writeFileSync(path.resolve(__dirname, '../captured_bet.json'), JSON.stringify(capturedPayload, null, 2));
                
                // Прерываем запрос, чтобы не тратить реальные деньги (или можно continue)
                req.abort();
                return;
            }
        }
        req.continue();
    });

    const mirrorRaw = account.mirrorUsed || account.mirrorUrl || config.registration.mirrors[0] || 'https://www.thundercrest65.xyz';
    const mirrorDom = mirrorRaw.match(/^https?:\/\/[^/]+/)?.[0] || 'https://www.thundercrest65.xyz';
    console.log(`🌐 Переходим в LIVE Соккер: ${mirrorDom}/ru/compact/sports/soccer/live`);
    await page.goto(`${mirrorDom}/ru/compact/sports/soccer/live`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    
    await sleep(6000); // Give it time to load odds via WS
    
    // Сделаем скриншот для дебага
    await page.screenshot({ path: path.resolve(__dirname, '../intercept-test.png') });
    fs.writeFileSync(path.resolve(__dirname, '../intercept-body.html'), await page.content());
    console.log('Поиск кнопки с коэффициентом (price-button / odds)...');

    // Кликаем по первой попавшейся кнопке с кэфом
    const clicked = await page.evaluate(async () => {
        // Прокручиваем чтобы подгрузились матчи
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise(r => setTimeout(r, 1000));
        window.scrollTo(0, 0);
        await new Promise(r => setTimeout(r, 1000));
        
        // У Pinnacle обычно коэффициенты лежат в a, button или td
        const els = [...document.querySelectorAll('a, button, td, span')]
            .filter(el => el.offsetHeight > 0 && el.textContent.trim().match(/^[1-9]\.[0-9]{2,}$/));
        
        if (els.length > 0) {
            const btn = els[Math.floor(els.length / 2)]; // берем из серединки
            btn.scrollIntoView({ block: 'center' });
            btn.click();
            return btn.textContent.trim();
        }
        return false;
    });

    if (!clicked) {
        console.log('Не смог найти ни одного лайв-матча с кэфами!');
        await browser.close();
        return;
    }

    console.log(`✅ Кликнули по случайному коэффициенту: ${clicked}`);
    await sleep(2000);

    // Заполняем купон
    console.log('Ищем инпут для ввода суммы (Betslip)...');
    const inputFilled = await page.evaluate(() => {
        const selectors = [
            'input.input-stake.stake.risk',
            'input[class*="input-stake"]',
            'input[placeholder="Stake"]',
            'input[placeholder="Wager"]',
            '.bet-slip-panel input[type="text"]'
        ];
        
        for (const sel of selectors) {
            const inp = document.querySelector(sel);
            if (inp && inp.offsetHeight > 0 && !inp.disabled) {
                inp.focus();
                
                // React-совместимый ввод
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(inp, '1'); // Вводим 1 USDT
                inp.dispatchEvent(new Event('input', { bubbles: true }));
                inp.dispatchEvent(new Event('change', { bubbles: true }));
                
                return true;
            }
        }
        return false;
    });

    if (!inputFilled) {
        console.log('❌ Не найден инпут купона (Betslip не открылся или селекторы неверные).');
        await browser.close();
        return;
    }

    console.log('✍️ Сумма 1 USDT введена. Нажимаем Place Bet...');
    await sleep(1000);

    // Подтверждаем ставку
    await page.evaluate(() => {
        const submitTexts = ['place bet', 'поставить', 'submit', 'подтвердить', 'bet now', 'place 1 bet'];
        const btns = [...document.querySelectorAll('button, [role="button"]')];
        for (const btn of btns) {
            if (btn.offsetHeight === 0 || btn.disabled || btn.classList.contains('disabled')) continue;
            const t = (btn.textContent || btn.innerText || '').toLowerCase().trim();
            if (submitTexts.some(st => t.includes(st))) {
                btn.click();
                return;
            }
        }
    });

    console.log('⏳ Ждем перехвата POST-запроса (3 секунды)...');
    await sleep(3000);

    await browser.close();
    console.log('Скрипт завершен.');
}

run().catch(console.error);
