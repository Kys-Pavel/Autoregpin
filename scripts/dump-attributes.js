const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const proxyChain = require('proxy-chain');

async function run() {
    const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config.json'), 'utf-8'));
    const accounts = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/accounts.json'), 'utf-8'));
    const account = accounts[accounts.length - 1]; 
    
    const profileDir = path.resolve(__dirname, '..', account.profilePath || `profiles/profile_${account.id}`);
    
    let proxyArgs = [];
    if (account.proxy) {
        try {
            const tunnel = await proxyChain.anonymizeProxy(account.proxy);
            proxyArgs.push(`--proxy-server=${tunnel}`);
        } catch(e) {}
    }

    const browser = await puppeteer.launch({
        executablePath: config.chrome?.executablePath || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: 'new',
        userDataDir: profileDir,
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', ...proxyArgs]
    });

    const page = await browser.newPage();
    const mirror = account.mirrorUsed || account.mirrorUrl || config.registration.mirrors[0] || 'https://www.thundercrest65.xyz';
    const mirrorDom = mirror.match(/^https?:\/\/[^/]+/)?.[0] || mirror;
    
    console.log(`Scanning page: ${mirrorDom}/ru/compact/sports/soccer/live`);
    await page.goto(`${mirrorDom}/ru/compact/sports/soccer/live`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(()=>{});
    
    await new Promise(r => setTimeout(r, 6000));

    const htmls = await page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
        const buttons = [...document.querySelectorAll('a[class*="price"], button[class*="price"], td[class*="price"]')];
        return buttons.slice(0, 5).map(b => b.outerHTML);
    });

    console.log('\n--- EXTRACTED BUTTON ATTRIBUTES ---');
    htmls.forEach((html, i) => console.log(`Button ${i}: ${html}`));
    console.log('-----------------------------------\n');
    
    // Также соберем глобальные переменные состояния (Redux, window.state)
    const stateKeys = await page.evaluate(() => Object.keys(window).filter(k => k.toLowerCase().includes('state') || k.toLowerCase().includes('pinnacle')));
    console.log('Window keys:', stateKeys.join(', '));
    
    await browser.close();
}
run().catch(console.error);
