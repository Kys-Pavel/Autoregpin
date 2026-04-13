const {
    generatePassword,
    generateBirthDate,
    generateEmail,
    generateAccount,
    generateAccounts,
    generateLoginId,
    generatePhoneNumber,
    loadEmailsFromFile,
    randomInt,
    randomChoice,
    FIRST_NAMES_MALE,
    FIRST_NAMES_FEMALE,
    LAST_NAMES_MALE,
    LAST_NAMES_FEMALE,
    EMAIL_DOMAINS,
    SECURITY_QUESTIONS,
    SECURITY_ANSWERS,
    CITIES,
    COUNTIES
} = require('../src/data-generator');
const fs = require('fs');
const path = require('path');

// Мокаем логгер чтобы не спамил в тесты
jest.mock('../src/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

describe('randomInt', () => {
    test('возвращает число в заданном диапазоне', () => {
        for (let i = 0; i < 100; i++) {
            const val = randomInt(5, 10);
            expect(val).toBeGreaterThanOrEqual(5);
            expect(val).toBeLessThanOrEqual(10);
        }
    });

    test('работает с одинаковыми min и max', () => {
        expect(randomInt(7, 7)).toBe(7);
    });
});

describe('randomChoice', () => {
    test('возвращает элемент из массива', () => {
        const arr = ['a', 'b', 'c'];
        for (let i = 0; i < 50; i++) {
            expect(arr).toContain(randomChoice(arr));
        }
    });
});

describe('generatePassword', () => {
    test('генерирует пароль заданной длины', () => {
        const pw = generatePassword(12);
        expect(pw.length).toBe(12);
    });

    test('содержит заглавную букву', () => {
        const pw = generatePassword(12);
        expect(pw).toMatch(/[A-Z]/);
    });

    test('содержит строчную букву', () => {
        const pw = generatePassword(12);
        expect(pw).toMatch(/[a-z]/);
    });

    test('содержит цифру', () => {
        const pw = generatePassword(12);
        expect(pw).toMatch(/[0-9]/);
    });

    test('содержит спецсимвол', () => {
        const pw = generatePassword(12);
        expect(pw).toMatch(/[!@#$%&*]/);
    });

    test('генерирует разные пароли', () => {
        const passwords = new Set();
        for (let i = 0; i < 20; i++) {
            passwords.add(generatePassword(12));
        }
        expect(passwords.size).toBeGreaterThan(15);
    });
});

describe('generateBirthDate', () => {
    test('возвращает дату в формате YYYY-MM-DD', () => {
        const date = generateBirthDate();
        expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('возраст 21-55 лет', () => {
        for (let i = 0; i < 50; i++) {
            const date = generateBirthDate();
            const birthYear = parseInt(date.split('-')[0]);
            const currentYear = new Date().getFullYear();
            const age = currentYear - birthYear;
            expect(age).toBeGreaterThanOrEqual(21);
            expect(age).toBeLessThanOrEqual(55);
        }
    });

    test('месяц от 01 до 12', () => {
        for (let i = 0; i < 50; i++) {
            const date = generateBirthDate();
            const month = parseInt(date.split('-')[1]);
            expect(month).toBeGreaterThanOrEqual(1);
            expect(month).toBeLessThanOrEqual(12);
        }
    });
});

describe('generateEmail', () => {
    test('возвращает валидный email', () => {
        const email = generateEmail('Ivan', 'Petrov');
        expect(email).toMatch(/.+@.+\..+/);
    });

    test('не повторяет существующие', () => {
        const existing = new Set(['ivan.petrov1@gmail.com']);
        const email = generateEmail('Ivan', 'Petrov', existing);
        expect(email).not.toBe('ivan.petrov1@gmail.com');
    });
});

describe('generateLoginId', () => {
    test('генерирует логин из имени и фамилии', () => {
        const loginId = generateLoginId('Ivan', 'Petrov');
        expect(loginId).toMatch(/^ivanpetrov\d+$/);
    });

    test('генерирует уникальные логины', () => {
        const logins = new Set();
        for (let i = 0; i < 20; i++) {
            logins.add(generateLoginId('Ivan', 'Petrov'));
        }
        expect(logins.size).toBeGreaterThan(10);
    });
});

describe('generatePhoneNumber', () => {
    test('генерирует 10-значный номер (без кода страны)', () => {
        const phone = generatePhoneNumber();
        expect(phone.length).toBe(10);
        expect(phone).toMatch(/^\d{10}$/);
    });

    test('генерирует разные номера', () => {
        const phones = new Set();
        for (let i = 0; i < 20; i++) {
            phones.add(generatePhoneNumber());
        }
        expect(phones.size).toBeGreaterThan(15);
    });
});

describe('generateAccount', () => {
    test('генерирует аккаунт с корректными полями', () => {
        const account = generateAccount(1, new Set());
        expect(account).toHaveProperty('id', 1);
        expect(account).toHaveProperty('firstName');
        expect(account).toHaveProperty('lastName');
        expect(account).toHaveProperty('loginId');
        expect(account).toHaveProperty('email');
        expect(account).toHaveProperty('password');
        expect(account).toHaveProperty('birthDate');
        expect(account).toHaveProperty('title', 'MR');
        expect(account).toHaveProperty('gender', 'male');
        expect(account).toHaveProperty('country', 'RU');
        expect(account).toHaveProperty('currency', 'UDT');
        expect(account).toHaveProperty('county');
        expect(account).toHaveProperty('postcode');
        expect(account).toHaveProperty('address');
        expect(account).toHaveProperty('city');
        expect(account).toHaveProperty('contactNum');
        expect(account).toHaveProperty('securityQuestion');
        expect(account).toHaveProperty('securityAnswer');
        expect(account).toHaveProperty('status', 'pending');
        expect(account.firstName.length).toBeGreaterThan(0);
        expect(account.lastName.length).toBeGreaterThan(0);
        expect(account.loginId.length).toBeGreaterThan(0);
    });

    test('loginId содержит имя и фамилию в нижнем регистре', () => {
        const account = generateAccount(1, new Set());
        const loginLower = account.loginId.toLowerCase();
        expect(loginLower).toContain(account.firstName.toLowerCase());
        expect(loginLower).toContain(account.lastName.toLowerCase());
    });

    test('использует переданный email', () => {
        const account = generateAccount(1, new Set(), {}, 'test@icloud.com');
        expect(account.email).toBe('test@icloud.com');
    });

    test('генерирует email если не передан', () => {
        const account = generateAccount(1, new Set(), {}, null);
        expect(account.email).toMatch(/.+@.+/);
    });

    test('securityQuestion из списка SECURITY_QUESTIONS', () => {
        const account = generateAccount(1, new Set());
        expect(SECURITY_QUESTIONS).toContain(account.securityQuestion);
    });

    test('securityAnswer не пустой', () => {
        const account = generateAccount(1, new Set());
        expect(account.securityAnswer.length).toBeGreaterThan(0);
        expect(SECURITY_ANSWERS).toContain(account.securityAnswer);
    });

    test('city из списка CITIES', () => {
        const account = generateAccount(1, new Set());
        expect(CITIES).toContain(account.city);
    });

    test('county из списка COUNTIES', () => {
        const account = generateAccount(1, new Set());
        expect(COUNTIES).toContain(account.county);
    });

    test('postcode — 6-значное число строкой', () => {
        const account = generateAccount(1, new Set());
        expect(account.postcode).toMatch(/^\d{6}$/);
    });

    test('contactNum — 10-значный номер телефона', () => {
        const account = generateAccount(1, new Set());
        expect(account.contactNum).toMatch(/^\d{10}$/);
    });

    test('использует конфиг для gender female', () => {
        const account = generateAccount(1, new Set(), { gender: 'female' });
        expect(account.gender).toBe('female');
        expect(FIRST_NAMES_FEMALE).toContain(account.firstName);
        expect(LAST_NAMES_FEMALE).toContain(account.lastName);
    });
});

describe('loadEmailsFromFile', () => {
    const testEmailsPath = path.join(__dirname, 'test_emails.txt');

    beforeEach(() => {
        fs.writeFileSync(testEmailsPath, [
            '# Комментарий',
            'test1@icloud.com',
            'test2@icloud.com',
            '',
            '# Ещё комментарий',
            'test3@icloud.com'
        ].join('\n'));
    });

    afterEach(() => {
        if (fs.existsSync(testEmailsPath)) {
            fs.unlinkSync(testEmailsPath);
        }
    });

    test('загружает email из файла, пропускает комментарии и пустые строки', () => {
        const emails = loadEmailsFromFile(testEmailsPath);
        expect(emails).toEqual(['test1@icloud.com', 'test2@icloud.com', 'test3@icloud.com']);
    });

    test('выбрасывает ошибку если файл не найден', () => {
        expect(() => loadEmailsFromFile('/nonexistent/path')).toThrow('не найден');
    });

    test('выбрасывает ошибку если нет валидных email', () => {
        fs.writeFileSync(testEmailsPath, '# только комментарий\n\n');
        expect(() => loadEmailsFromFile(testEmailsPath)).toThrow('не содержит');
    });
});

describe('generateAccounts', () => {
    const testDir = path.join(__dirname, 'test_data');
    const testAccountsFile = path.join(testDir, 'accounts.json');
    const testEmailsFile = path.join(__dirname, 'test_gen_emails.txt');

    beforeEach(() => {
        // Подменяем путь в конфиге
        jest.resetModules();
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true });
        }
        if (fs.existsSync(testEmailsFile)) {
            fs.unlinkSync(testEmailsFile);
        }
        // Очищаем accounts.json чтобы тесты были изолированы
        const mainAccounts = path.resolve(__dirname, '..', 'data', 'accounts.json');
        if (fs.existsSync(mainAccounts)) {
            fs.unlinkSync(mainAccounts);
        }
    });

    afterEach(() => {
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true });
        }
        if (fs.existsSync(testEmailsFile)) {
            fs.unlinkSync(testEmailsFile);
        }
        // Очищаем accounts.json рядом с проектом если создался
        const mainAccounts = path.resolve(__dirname, '..', 'data', 'accounts.json');
        if (fs.existsSync(mainAccounts)) {
            fs.unlinkSync(mainAccounts);
        }
    });

    test('генерирует указанное количество аккаунтов', () => {
        const accounts = generateAccounts(3);
        expect(accounts.length).toBe(3);
        expect(accounts[0].id).toBe(1);
        expect(accounts[2].id).toBe(3);
    });

    test('генерирует аккаунты из файла email', () => {
        fs.writeFileSync(testEmailsFile, 'a@icloud.com\nb@icloud.com\nc@icloud.com\n');
        const accounts = generateAccounts(null, {}, testEmailsFile);
        expect(accounts.length).toBe(3);
        expect(accounts[0].email).toBe('a@icloud.com');
        expect(accounts[1].email).toBe('b@icloud.com');
        expect(accounts[2].email).toBe('c@icloud.com');
    });

    test('каждый аккаунт имеет уникальный id и email', () => {
        const accounts = generateAccounts(5);
        const ids = accounts.map(a => a.id);
        const emails = accounts.map(a => a.email);
        expect(new Set(ids).size).toBe(5);
        expect(new Set(emails).size).toBe(5);
    });

    test('каждый аккаунт имеет все поля формы', () => {
        const accounts = generateAccounts(2);
        for (const acc of accounts) {
            expect(acc).toHaveProperty('loginId');
            expect(acc).toHaveProperty('contactNum');
            expect(acc).toHaveProperty('securityQuestion');
            expect(acc).toHaveProperty('securityAnswer');
            expect(acc).toHaveProperty('county');
            expect(acc).toHaveProperty('postcode');
            expect(acc).toHaveProperty('address');
            expect(acc).toHaveProperty('city');
        }
    });
});
