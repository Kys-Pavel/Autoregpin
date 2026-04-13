const ProxyManager = require('../src/proxy');

// Мокаем логгер
jest.mock('../src/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

describe('ProxyManager.parseProxy', () => {
    test('парсит HTTP URL формат', () => {
        const result = ProxyManager.parseProxy('http://user:pass@1.2.3.4:8080');
        expect(result).toEqual({
            type: 'http',
            host: '1.2.3.4',
            port: 8080,
            username: 'user',
            password: 'pass',
            raw: 'http://user:pass@1.2.3.4:8080'
        });
    });

    test('парсит SOCKS5 URL формат', () => {
        const result = ProxyManager.parseProxy('socks5://admin:secret@10.0.0.1:1080');
        expect(result).toEqual({
            type: 'socks5',
            host: '10.0.0.1',
            port: 1080,
            username: 'admin',
            password: 'secret',
            raw: 'socks5://admin:secret@10.0.0.1:1080'
        });
    });

    test('парсит формат host:port:user:pass', () => {
        const result = ProxyManager.parseProxy('1.2.3.4:8080:user:pass');
        expect(result).toEqual({
            type: 'http',
            host: '1.2.3.4',
            port: 8080,
            username: 'user',
            password: 'pass',
            raw: '1.2.3.4:8080:user:pass'
        });
    });

    test('парсит формат host:port', () => {
        const result = ProxyManager.parseProxy('1.2.3.4:8080');
        expect(result).toEqual({
            type: 'http',
            host: '1.2.3.4',
            port: 8080,
            username: '',
            password: '',
            raw: '1.2.3.4:8080'
        });
    });

    test('возвращает null для невалидного формата', () => {
        const result = ProxyManager.parseProxy('invalid');
        expect(result).toBeNull();
    });

    test('парсит URL без авторизации', () => {
        const result = ProxyManager.parseProxy('http://1.2.3.4:8080');
        expect(result.host).toBe('1.2.3.4');
        expect(result.port).toBe(8080);
        expect(result.username).toBe('');
        expect(result.password).toBe('');
    });
});

describe('ProxyManager rotation', () => {
    test('sequential ротация по кругу', () => {
        const pm = new ProxyManager({
            list: ['http://a:b@1.1.1.1:80', 'http://c:d@2.2.2.2:80'],
            changeIpUrl: '',
            rotationStrategy: 'sequential'
        });

        const first = pm.getNext();
        const second = pm.getNext();
        const third = pm.getNext(); // снова первый

        expect(first.host).toBe('1.1.1.1');
        expect(second.host).toBe('2.2.2.2');
        expect(third.host).toBe('1.1.1.1');
    });

    test('random ротация возвращает прокси из списка', () => {
        const pm = new ProxyManager({
            list: ['http://a:b@1.1.1.1:80', 'http://c:d@2.2.2.2:80'],
            changeIpUrl: '',
            rotationStrategy: 'random'
        });

        for (let i = 0; i < 20; i++) {
            const proxy = pm.getNext();
            expect(['1.1.1.1', '2.2.2.2']).toContain(proxy.host);
        }
    });

    test('пустой список возвращает null', () => {
        const pm = new ProxyManager({ list: [], changeIpUrl: '' });
        expect(pm.getNext()).toBeNull();
    });
});

describe('ProxyManager.getChromeArg', () => {
    test('формирует правильный аргумент', () => {
        const pm = new ProxyManager({ list: [], changeIpUrl: '' });
        const proxy = { type: 'http', host: '1.2.3.4', port: 8080 };
        expect(pm.getChromeArg(proxy)).toBe('http://1.2.3.4:8080');
    });

    test('возвращает null для null прокси', () => {
        const pm = new ProxyManager({ list: [], changeIpUrl: '' });
        expect(pm.getChromeArg(null)).toBeNull();
    });
});

describe('ProxyManager.checkProxy', () => {
    test('валидный прокси', async () => {
        const pm = new ProxyManager({ list: [], changeIpUrl: '' });
        const result = await pm.checkProxy({ host: '1.2.3.4', port: 8080 });
        expect(result.valid).toBe(true);
    });

    test('null прокси невалиден', async () => {
        const pm = new ProxyManager({ list: [], changeIpUrl: '' });
        const result = await pm.checkProxy(null);
        expect(result.valid).toBe(false);
    });

    test('невалидный порт', async () => {
        const pm = new ProxyManager({ list: [], changeIpUrl: '' });
        const result = await pm.checkProxy({ host: '1.2.3.4', port: 99999 });
        expect(result.valid).toBe(false);
    });
});

describe('ProxyManager properties', () => {
    test('count возвращает количество прокси', () => {
        const pm = new ProxyManager({ list: ['a:1', 'b:2'], changeIpUrl: '' });
        expect(pm.count).toBe(2);
    });

    test('hasProxies', () => {
        const pm1 = new ProxyManager({ list: ['a:1'], changeIpUrl: '' });
        const pm2 = new ProxyManager({ list: [], changeIpUrl: '' });
        expect(pm1.hasProxies).toBe(true);
        expect(pm2.hasProxies).toBe(false);
    });
});
