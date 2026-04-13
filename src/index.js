const { Command } = require('commander');
const logger = require('./logger');
const { generateAccounts, loadAccounts } = require('./data-generator');
const ProfileManager = require('./profile');
const { Registrator } = require('./registrator');
const config = require('../config.json');
const path = require('path');

// Global error handlers — ловим всё чтобы не крашилось молча
process.on('unhandledRejection', (reason, promise) => {
    logger.error(`Unhandled Rejection: ${reason}`);
    if (reason && reason.stack) logger.error(reason.stack);
});

process.on('uncaughtException', (error) => {
    logger.error(`Uncaught Exception: ${error.message}`);
    if (error.stack) logger.error(error.stack);
});

const program = new Command();

program
    .name('reg-pin-888')
    .description('Массовый регистратор Pinnacle888')
    .version(config.version);

// ========== Генерация аккаунтов ==========
program
    .command('generate')
    .description('Генерация данных аккаунтов для регистрации')
    .option('-c, --count <number>', 'Количество аккаунтов', parseInt)
    .option('-e, --emails <path>', 'Путь к файлу с email адресами', 'data/emails.txt')
    .option('--country <country>', 'Страна')
    .option('--currency <currency>', 'Валюта')
    .action((options) => {
        logger.info('=== Генерация аккаунтов ===');

        const overrides = {};
        if (options.country) overrides.country = options.country;
        if (options.currency) overrides.currency = options.currency;

        const accounts = generateAccounts(options.count || null, overrides, options.emails);

        if (accounts.length > 0) {
            console.log('\nСгенерированные аккаунты:');
            console.table(accounts.map(a => ({
                ID: a.id,
                Email: a.email,
                Name: `${a.firstName} ${a.lastName}`,
                Birth: a.birthDate,
                Country: a.country,
                Currency: a.currency
            })));
        }
    });

// ========== Регистрация ==========
program
    .command('register')
    .description('Запуск регистрации аккаунтов')
    .option('-c, --count <number>', 'Количество аккаунтов для регистрации', parseInt)
    .action(async (options) => {
        logger.info('=== Запуск регистрации ===');

        try {
            const registrator = new Registrator();
            const result = await registrator.registerBatch(options.count);

            console.log('\nРезультаты:');
            console.log(`  Всего: ${result.total}`);
            console.log(`  Успешно: ${result.success}`);
            console.log(`  Ошибки: ${result.failed}`);
        } catch (error) {
            logger.error(`Критическая ошибка регистрации: ${error.message}`);
            if (error.stack) logger.error(error.stack);
            process.exit(1);
        }
    });

// ========== Статус ==========
program
    .command('status')
    .description('Показать статус аккаунтов')
    .action(() => {
        const accounts = loadAccounts();

        if (accounts.length === 0) {
            console.log('Нет аккаунтов. Используйте команду "generate" для создания.');
            return;
        }

        const stats = {
            pending: accounts.filter(a => a.status === 'pending').length,
            in_progress: accounts.filter(a => a.status === 'in_progress').length,
            registered: accounts.filter(a => a.status === 'registered').length,
            verified: accounts.filter(a => a.status === 'verified').length,
            error: accounts.filter(a => a.status === 'error').length
        };

        console.log('\n=== Статус аккаунтов ===');
        console.log(`  Всего: ${accounts.length}`);
        console.log(`  Ожидают: ${stats.pending}`);
        console.log(`  В процессе: ${stats.in_progress}`);
        console.log(`  Зарегистрированы: ${stats.registered}`);
        console.log(`  Верифицированы: ${stats.verified}`);
        console.log(`  Ошибки: ${stats.error}`);

        if (stats.error > 0) {
            console.log('\nАккаунты с ошибками:');
            const errorAccounts = accounts.filter(a => a.status === 'error');
            console.table(errorAccounts.map(a => ({
                ID: a.id,
                Email: a.email,
                Error: a.error
            })));
        }
    });

// ========== Профили ==========
program
    .command('profiles')
    .description('Показать сохранённые профили')
    .action(() => {
        const profileManager = new ProfileManager(
            path.resolve(__dirname, '..', config.paths.profilesDir)
        );
        const profiles = profileManager.listProfiles();

        if (profiles.length === 0) {
            console.log('Нет сохранённых профилей.');
            return;
        }

        console.log('\n=== Сохранённые профили ===');
        console.table(profiles.map(p => ({
            'Account ID': p.accountId,
            'Size (MB)': p.sizeMb,
            'Created': p.createdAt.toLocaleString(),
            'Path': p.path
        })));
    });

// ========== Список аккаунтов ==========
program
    .command('list')
    .description('Показать все аккаунты')
    .option('-s, --status <status>', 'Фильтр по статусу')
    .action((options) => {
        let filter = null;
        if (options.status) {
            filter = a => a.status === options.status;
        }

        const accounts = loadAccounts(filter);

        if (accounts.length === 0) {
            console.log('Нет аккаунтов.');
            return;
        }

        console.table(accounts.map(a => ({
            ID: a.id,
            Email: a.email,
            Name: `${a.firstName} ${a.lastName}`,
            Status: a.status,
            Mirror: a.mirrorUsed ? (new URL(a.mirrorUsed).hostname) : '-',
            Registered: a.registeredAt || '-',
            Error: a.error || '-'
        })));
    });

program.parse(process.argv);
