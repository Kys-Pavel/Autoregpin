const { BrowserManager, USER_AGENTS, VIEWPORTS } = require('../src/browser');

// Мокаем логгер
jest.mock('../src/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

describe('BrowserManager', () => {
    const bm = new BrowserManager({
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: false
    });

    test('buildLaunchArgs содержит базовые аргументы', () => {
        const args = bm.buildLaunchArgs({});
        expect(args).toContain('--no-first-run');
        expect(args).toContain('--no-default-browser-check');
        expect(args).toContain('--disable-blink-features=AutomationControlled');
    });

    test('buildLaunchArgs добавляет proxy-server', () => {
        const args = bm.buildLaunchArgs({ proxyArg: 'http://1.2.3.4:8080' });
        expect(args).toContain('--proxy-server=http://1.2.3.4:8080');
    });

    test('buildLaunchArgs добавляет user-data-dir', () => {
        const args = bm.buildLaunchArgs({ userDataDir: 'C:\\profiles\\test' });
        expect(args).toContain('--user-data-dir=C:\\profiles\\test');
    });

    test('buildLaunchArgs без прокси не добавляет proxy-server', () => {
        const args = bm.buildLaunchArgs({});
        const hasProxy = args.some(a => a.startsWith('--proxy-server'));
        expect(hasProxy).toBe(false);
    });

    test('getRandomUserAgent возвращает UA из списка', () => {
        for (let i = 0; i < 20; i++) {
            const ua = bm.getRandomUserAgent();
            expect(USER_AGENTS).toContain(ua);
        }
    });

    test('getRandomViewport возвращает viewport из списка', () => {
        for (let i = 0; i < 20; i++) {
            const vp = bm.getRandomViewport();
            expect(VIEWPORTS).toContainEqual(vp);
        }
    });

    test('USER_AGENTS массив не пустой', () => {
        expect(USER_AGENTS.length).toBeGreaterThan(0);
    });

    test('VIEWPORTS все имеют width и height', () => {
        VIEWPORTS.forEach(vp => {
            expect(vp.width).toBeGreaterThan(0);
            expect(vp.height).toBeGreaterThan(0);
        });
    });
});
