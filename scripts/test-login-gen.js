const { generateAccount } = require('../src/data-generator');
for (let i = 0; i < 10; i++) {
    const acc = generateAccount(i, new Set(), {}, 'test@test.com');
    const l = acc.loginId;
    const ok = l.length >= 10 && l.length <= 15 && /^[a-z0-9]+$/.test(l);
    console.log(l.padEnd(16), `${l.length}ch`, ok ? '✅' : '❌ FAIL');
}
