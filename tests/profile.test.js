const ProfileManager = require('../src/profile');
const fs = require('fs');
const path = require('path');

// Мокаем логгер
jest.mock('../src/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
}));

describe('ProfileManager', () => {
    const testProfilesDir = path.join(__dirname, 'test_profiles');
    let pm;

    beforeEach(() => {
        if (fs.existsSync(testProfilesDir)) {
            fs.rmSync(testProfilesDir, { recursive: true });
        }
        pm = new ProfileManager(testProfilesDir);
    });

    afterEach(() => {
        if (fs.existsSync(testProfilesDir)) {
            fs.rmSync(testProfilesDir, { recursive: true });
        }
    });

    test('создаёт директорию profiles при инициализации', () => {
        expect(fs.existsSync(testProfilesDir)).toBe(true);
    });

    test('getProfilePath возвращает правильный путь', () => {
        const profilePath = pm.getProfilePath(42);
        expect(profilePath).toBe(path.join(testProfilesDir, 'account_42'));
    });

    test('createProfile создаёт директорию', () => {
        const profilePath = pm.createProfile(1);
        expect(fs.existsSync(profilePath)).toBe(true);
    });

    test('createProfile не падает при повторном вызове', () => {
        pm.createProfile(1);
        expect(() => pm.createProfile(1)).not.toThrow();
    });

    test('profileExists после создания', () => {
        expect(pm.profileExists(1)).toBe(false);
        pm.createProfile(1);
        expect(pm.profileExists(1)).toBe(true);
    });

    test('deleteProfile удаляет профиль', () => {
        pm.createProfile(5);
        expect(pm.profileExists(5)).toBe(true);
        const result = pm.deleteProfile(5);
        expect(result).toBe(true);
        expect(pm.profileExists(5)).toBe(false);
    });

    test('deleteProfile возвращает false для несуществующего', () => {
        expect(pm.deleteProfile(999)).toBe(false);
    });

    test('listProfiles возвращает список', () => {
        pm.createProfile(1);
        pm.createProfile(2);
        pm.createProfile(3);
        const profiles = pm.listProfiles();
        expect(profiles.length).toBe(3);
        expect(profiles[0].accountId).toBe(1);
        expect(profiles[2].accountId).toBe(3);
    });

    test('listProfiles пустая директория', () => {
        const profiles = pm.listProfiles();
        expect(profiles).toEqual([]);
    });

    test('listProfiles содержит метаданные', () => {
        pm.createProfile(1);
        // Создаём файл внутри для проверки sizeMb
        fs.writeFileSync(path.join(pm.getProfilePath(1), 'test.txt'), 'x'.repeat(2048));

        const profiles = pm.listProfiles();
        expect(profiles[0]).toHaveProperty('accountId', 1);
        expect(profiles[0]).toHaveProperty('path');
        expect(profiles[0]).toHaveProperty('sizeMb');
        expect(profiles[0]).toHaveProperty('createdAt');
        expect(typeof profiles[0].sizeMb).toBe('number');
        expect(profiles[0].sizeMb).toBeGreaterThanOrEqual(0);
    });
});
