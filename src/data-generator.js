const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

// Кэш загруженных локалей
const localeCache = {};

/**
 * Загрузка справочника страны из data/locales/XX.json
 */
function loadLocale(countryCode) {
    if (localeCache[countryCode]) return localeCache[countryCode];
    const filePath = path.resolve(__dirname, '..', 'data', 'locales', `${countryCode}.json`);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Справочник страны не найден: ${filePath}. Создайте data/locales/${countryCode}.json`);
    }
    const locale = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    localeCache[countryCode] = locale;
    return locale;
}

/**
 * Загрузить/сохранить использованные адреса
 */
function loadUsedAddresses() {
    const filePath = path.resolve(__dirname, '..', 'data', 'used_addresses.json');
    if (!fs.existsSync(filePath)) return {};
    try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch (e) { return {}; }
}

function saveUsedAddress(countryCode, city, street, postcode) {
    const filePath = path.resolve(__dirname, '..', 'data', 'used_addresses.json');
    const used = loadUsedAddresses();
    if (!used[countryCode]) used[countryCode] = [];
    const key = `${city}|${street}|${postcode}`;
    if (!used[countryCode].includes(key)) {
        used[countryCode].push(key);
        fs.writeFileSync(filePath, JSON.stringify(used, null, 2), 'utf-8');
    }
}

/**
 * Загрузка email'ов из файла (по одному на строку)
 * Email'ы реальные (iCloud алиасы), НЕ генерируются
 */
function loadEmailsFromFile(filePath) {
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
        throw new Error(`Файл email'ов не найден: ${resolvedPath}`);
    }
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const emails = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && line.includes('@'));

    if (emails.length === 0) {
        throw new Error(`Файл ${resolvedPath} не содержит валидных email'ов`);
    }

    logger.info(`Загружено ${emails.length} email'ов из ${resolvedPath}`);
    return emails;
}

// Базы имён для генерации
const FIRST_NAMES_MALE = [
    'Ivan', 'Sergei', 'Alexei', 'Dmitry', 'Andrei', 'Mikhail', 'Nikolai',
    'Pavel', 'Viktor', 'Roman', 'Oleg', 'Maxim', 'Artem', 'Denis', 'Anton',
    'Konstantin', 'Valery', 'Yuri', 'Kirill', 'Vladislav', 'Ilya', 'Timur',
    'Ruslan', 'Stanislav', 'Evgeny', 'Alexander', 'Boris', 'Grigory', 'Leonid',
    'Fedor', 'Georgy', 'Vasily', 'Anatoly', 'Igor', 'Vyacheslav', 'Gennadiy',
    'Arkady', 'Valentin', 'Vladimir', 'Gleb', 'Daniil', 'Egor', 'Zakhar',
    'Lev', 'Makar', 'Matvey', 'Nikita', 'Oleg', 'Petr', 'Rostislav', 'Semen',
    'Stepan', 'Taras', 'Filipp', 'Eduard', 'Yakov', 'Bogdan', 'Vadim', 'Vsevolod',
    'Gennady', 'David', 'Zahar', 'Ignat', 'Klim', 'Mark', 'Nazar', 'Ostap',
    'Platon', 'Rodion', 'Savva', 'Trofim', 'Fedor', 'Yaroslav', 'Albert', 'Artur',
    'German', 'Timofey', 'Arseniy', 'Demid', 'Gordey', 'Mily', 'Prokhor', 'Saveliy'
];

const FIRST_NAMES_FEMALE = [
    'Anna', 'Maria', 'Elena', 'Olga', 'Natalia', 'Irina', 'Ekaterina',
    'Tatiana', 'Svetlana', 'Yulia', 'Anastasia', 'Valentina', 'Larisa',
    'Galina', 'Tamara', 'Vera', 'Lyudmila', 'Oksana', 'Marina', 'Daria',
    'Polina', 'Victoria', 'Alina', 'Sofia', 'Kristina', 'Evgenia',
    'Ksenia', 'Nadezhda', 'Lyubov', 'Diana', 'Veronika', 'Alexandra',
    'Alisa', 'Alla', 'Angelina', 'Antonina', 'Valeria', 'Varvara', 'Vasilisa',
    'Dina', 'Eva', 'Zlata', 'Inna', 'Karina', 'Kira', 'Lidia', 'Lilia',
    'Margarita', 'Milana', 'Miroslava', 'Nika', 'Nina', 'Pelageya', 'Raisa',
    'Regina', 'Rimma', 'Snezhana', 'Taisiya', 'Ulyana', 'Arina', 'Karolina'
];

const LAST_NAMES_MALE = [
    'Ivanov', 'Petrov', 'Smirnov', 'Kuznetsov', 'Popov', 'Vasilev',
    'Sokolov', 'Mikhailov', 'Novikov', 'Fedorov', 'Morozov', 'Volkov',
    'Alekseev', 'Lebedev', 'Semenov', 'Egorov', 'Pavlov', 'Kozlov',
    'Stepanov', 'Nikolaev', 'Orlov', 'Andreev', 'Makarov', 'Nikitin',
    'Zakharov', 'Zaitsev', 'Sobolev', 'Grigoriev', 'Romanov', 'Vorobyov',
    'Sergeev', 'Kuzmin', 'Frolov', 'Alexandrov', 'Dmitriev', 'Korolev',
    'Gusev', 'Kiselev', 'Ilyin', 'Maximov', 'Tarasov', 'Belov',
    'Antonov', 'Belyaev', 'Bogdanov', 'Borisov', 'Vlasov', 'Voronin',
    'Gavrilov', 'Galkin', 'Gerasimov', 'Gorshkov', 'Danilov', 'Denisov',
    'Zhuravlev', 'Zinin', 'Zotov', 'Ignatov', 'Kabanov', 'Karpov',
    'Komarov', 'Konov', 'Krylov', 'Kulikov', 'Lapin', 'Mironov',
    'Panov', 'Polyakov', 'Rodionov', 'Ryabov', 'Saveliev', 'Safonov',
    'Titov', 'Tikhonov', 'Ushakov', 'Chernov', 'Shishkin', 'Yakovlev'
];

const LAST_NAMES_FEMALE = [
    'Ivanova', 'Petrova', 'Smirnova', 'Kuznetsova', 'Popova', 'Vasileva',
    'Sokolova', 'Mikhailova', 'Novikova', 'Fedorova', 'Morozova', 'Volkova',
    'Alekseeva', 'Lebedeva', 'Semenova', 'Egorova', 'Pavlova', 'Kozlova',
    'Stepanova', 'Nikolaeva', 'Orlova', 'Andreeva', 'Makarova', 'Nikitina',
    'Zakharova', 'Zaitseva', 'Soboleva', 'Grigorieva', 'Romanova', 'Vorobyova',
    'Sergeeva', 'Kuzmina', 'Frolova', 'Alexandrova', 'Dmitrieva', 'Koroleva',
    'Guseva', 'Kiseleva', 'Ilyina', 'Maximova', 'Tarasova', 'Belova',
    'Antonova', 'Belyaeva', 'Bogdanova', 'Borisova', 'Vlasova', 'Voronina',
    'Gavrilova', 'Galkina', 'Gerasimova', 'Gorshkova', 'Danilova', 'Denisova',
    'Zhuravleva', 'Zinina', 'Zotova', 'Ignatova', 'Kabanova', 'Karpova',
    'Komarova', 'Konova', 'Krylova', 'Kulikova', 'Lapina', 'Mironova',
    'Panova', 'Polyakova', 'Rodionova', 'Ryabova', 'Savelieva', 'Safonova',
    'Titova', 'Tikhonova', 'Ushakova', 'Chernova', 'Shishkina', 'Yakovleva'
];

const EMAIL_DOMAINS = [
    'gmail.com', 'yahoo.com', 'outlook.com', 'mail.ru', 'yandex.ru',
    'hotmail.com', 'protonmail.com', 'inbox.ru', 'list.ru', 'bk.ru'
];

// ==============================================================
// СЛОВА ДЛЯ ГЕЙМЕРСКИХ НИКОВ — 500+ уникальных слов
// ==============================================================

// Префиксы / прилагательные
const GAMER_PREFIX = [
    'dark', 'evil', 'dead', 'mad', 'bad', 'raw', 'red', 'ice', 'hot', 'big',
    'real', 'old', 'new', 'top', 'god', 'war', 'one', 'two', 'fat', 'ace',
    'pro', 'neo', 'eco', 'bio', 'air', 'all', 'any', 'tri', 'hex', 'max',
    'ultra', 'super', 'mega', 'hyper', 'cyber', 'turbo', 'alpha', 'omega',
    'sigma', 'delta', 'gamma', 'theta', 'zeta', 'kappa', 'lambda', 'beta',
    'ghost', 'death', 'blood', 'steel', 'iron', 'gold', 'dark', 'void', 'toxic',
    'cold', 'black', 'white', 'grey', 'neon', 'acid', 'bold', 'wild', 'lone',
    'bare', 'bare', 'cruel', 'chaos', 'fury', 'risen', 'power', 'never', 'swift',
    'silent', 'hidden', 'unseen', 'sharp', 'blunt', 'blind', 'quick', 'rapid',
    'lethal', 'savage', 'ruthless', 'fallen', 'rogue', 'cursed', 'damned',
    'blazing', 'frozen', 'burning', 'endless', 'ancient', 'lost', 'broken',
    'digital', 'atomic', 'electric', 'nuclear', 'cosmic', 'stellar', 'solar',
    'infinite', 'eternal', 'shadow', 'hollow', 'riptor'
];

// Существительные (геймерские персонажи, сущности)
const GAMER_NOUN = [
    'killer', 'sniper', 'ninja', 'ghost', 'demon', 'beast', 'dragon', 'wolf',
    'eagle', 'hawk', 'falcon', 'raven', 'crow', 'viper', 'cobra', 'python',
    'panther', 'tiger', 'lion', 'bear', 'fox', 'lynx', 'shark', 'blade',
    'blade', 'bullet', 'bomb', 'nuke', 'laser', 'sword', 'axe', 'arrow',
    'spear', 'lance', 'dagger', 'cannon', 'rifle', 'pistol', 'shotgun',
    'strike', 'shot', 'slash', 'stab', 'blast', 'crash', 'smash', 'burst',
    'surge', 'spike', 'fang', 'claw', 'talon', 'venom', 'plague', 'curse',
    'skull', 'bone', 'storm', 'thunder', 'lightning', 'blizzard', 'tornado',
    'tsunami', 'quake', 'inferno', 'eclipse', 'nova', 'pulsar', 'comet',
    'voyager', 'raider', 'ranger', 'hunter', 'seeker', 'stalker', 'tracker',
    'warrior', 'soldier', 'fighter', 'knight', 'paladin', 'rogue', 'mage',
    'wizard', 'monk', 'archer', 'assassin', 'guard', 'scout', 'spy', 'agent',
    'phantom', 'spectre', 'wraith', 'banshee', 'ghoul', 'zombie', 'vampire',
    'reaper', 'slayer', 'breaker', 'crusher', 'shredder', 'destroyer', 'titan',
    'giant', 'golem', 'colossus', 'behemoth', 'kraken', 'hydra', 'chimera',
    'phoenix', 'griffin', 'wyvern', 'basilisk', 'leviathan', 'minotaur',
    'cyclops', 'medusa', 'cerberus', 'harpy', 'siren', 'valkyrie', 'berserker',
    'templar', 'crusader', 'inquisitor', 'herald', 'sentinel', 'guardian',
    'warden', 'keeper', 'master', 'lord', 'king', 'emperor', 'overlord', 'ruler',
    'champion', 'legend', 'hero', 'titan', 'god', 'devil', 'daemon', 'angel',
    'saint', 'prophet', 'oracle', 'sage', 'elder', 'ancient', 'prime', 'apex',
    'boss', 'ace', 'smurf', 'carry', 'tank', 'feeder', 'rusher', 'camper',
    'flanker', 'baiter', 'griefer', 'teamkiller', 'noob', 'veteran', 'tryhard'
];

// Суффиксы / стиль
const GAMER_SUFFIX = [
    'gg', 'irl', 'afk', 'ez', 'lol', 'kek', 'pog', 'rip', 'omg', 'wtf',
    'op', 'meta', 'gg', 'max', 'pro', 'god', 'hd', '4k', 'fps', 'pvp',
    'pve', 'rpg', 'mmo', 'rts', 'fps', 'tps', 'br', 'ow', 'cs', 'lol',
    'wow', 'mc', 'tf', 'r6', 'pub', 'cod', 'val', 'rl', 'aoe', 'dota',
    'king', 'lord', 'boy', 'man', 'guy', 'bro', 'sis', 'jr', 'sr', 'vip',
    'xd', 'uwu', 'sus', 'chad', 'simp', 'incel', 'sigma', 'alpha', 'npc',
    'bot', 'alt', 'smurf', 'main', 'one', 'two', 'three', 'x', 'y', 'z',
    'prime', 'ultra', 'mega', 'plus', 'max', 'pro', 'real', 'true', 'legit',
    '360', '420', '666', '777', '999', '1337', '2077', '3000', '9000'
];

// Числовые суффиксы с особым смыслом среди геймеров
const GAMER_NUMS = [
    '1', '2', '3', '7', '13', '21', '42', '47', '69', '77', '88', '99',
    '100', '101', '123', '321', '007', '404', '420', '666', '777', '888',
    '999', '1337', '2000', '2024', '2025', '2077', '9000', '0', '00', '000',
    '11', '22', '33', '44', '55', '66', '77', '88', '99', '111', '222', '333', '444', '555'
];

// Основной объединённый массив для обратной совместимости
const GAMER_WORDS = [
    ...GAMER_PREFIX, ...GAMER_NOUN, ...GAMER_SUFFIX
];

console.log && (typeof console !== 'undefined') && (() => { })(); // noop

/**
 * Случайное число в диапазоне [min, max] включительно
 */
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Случайный элемент из массива
 */
function randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Генерация случайного пароля, соответствующего требованиям
 * (буквы верхний/нижний регистр, цифры, спецсимволы, 10-16 символов)
 */
function generatePassword(length = 12) {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789';
    const special = '!@#$%&*';

    // Гарантируем наличие каждого типа символов
    let password = [
        upper[randomInt(0, upper.length - 1)],
        lower[randomInt(0, lower.length - 1)],
        digits[randomInt(0, digits.length - 1)],
        special[randomInt(0, special.length - 1)]
    ];

    const allChars = upper + lower + digits + special;
    for (let i = password.length; i < length; i++) {
        password.push(allChars[randomInt(0, allChars.length - 1)]);
    }

    // Перемешиваем
    for (let i = password.length - 1; i > 0; i--) {
        const j = randomInt(0, i);
        [password[i], password[j]] = [password[j], password[i]];
    }

    return password.join('');
}

/**
 * Генерация случайной даты рождения (21-55 лет)
 */
function generateBirthDate() {
    const now = new Date();
    const minAge = 21;
    const maxAge = 55;
    const age = randomInt(minAge, maxAge);

    const year = now.getFullYear() - age;
    const month = randomInt(1, 12);
    const maxDay = new Date(year, month, 0).getDate(); // последний день месяца
    const day = randomInt(1, maxDay);

    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Генерация случайного email (фоллбэк, если нет списка)
 * 100+ паттернов: игровой стиль + человекоподобные комбинации
 */
function generateEmail(firstName, lastName, existingEmails = new Set()) {
    const fn = firstName.toLowerCase().replace(/[^a-z]/g, '') || 'user';
    const ln = lastName.toLowerCase().replace(/[^a-z]/g, '') || 'player';
    const fn2 = fn.slice(0, 2); const fn3 = fn.slice(0, 3); const fn4 = fn.slice(0, 4); const fn5 = fn.slice(0, 5);
    const ln2 = ln.slice(0, 2); const ln3 = ln.slice(0, 3); const ln4 = ln.slice(0, 4);
    function rp() { return randomChoice(GAMER_PREFIX); }
    function rn2() { return randomChoice(GAMER_NOUN); }
    function rnum() { return randomChoice(GAMER_NUMS); }
    function ri(a, b) { return String(randomInt(a, b)); }

    const emailPatterns = [
        // === Классика firstName+lastName ===
        () => fn + ln + ri(10, 99),
        () => fn + '.' + ln + ri(10, 99),
        () => fn + ln + ri(1, 9),
        () => fn3 + ln + ri(10, 999),
        () => fn + ln3 + ri(10, 999),
        () => fn4 + ln2 + ri(10, 99),
        () => fn2 + ln4 + ri(10, 99),
        () => fn + ri(10, 9999),
        () => ln + ri(10, 9999),
        () => fn + ln,
        () => fn3 + ln3,
        () => fn + ri(1, 9) + ln,
        () => ln + fn + ri(10, 99),
        () => fn + ln + ri(1900, 2005),
        () => fn + ri(1970, 2005) + ln3,

        // === Геймерский стиль целиком ===
        () => rp() + rn2() + rnum(),
        () => rn2() + rnum(),
        () => rp() + rnum(),
        () => rn2() + rp() + rnum(),
        () => rp() + rn2() + ri(10, 999),
        () => rn2() + ri(10, 9999),
        () => rp() + ri(10, 9999),
        () => 'x' + rn2() + rnum(),
        () => rn2() + 'x' + rnum(),
        () => rp() + rp() + ri(10, 99),
        () => rn2() + rn2() + ri(10, 99),
        () => 'the' + rn2() + ri(10, 999),
        () => 'real' + rn2() + ri(10, 99),

        // === Имя + геймерское слово ===
        () => fn + rn2() + rnum(),
        () => fn + rp() + rnum(),
        () => fn3 + rn2() + ri(10, 99),
        () => rn2() + fn + rnum(),
        () => rp() + fn + rnum(),
        () => fn + rnum(),
        () => fn4 + rn2() + ri(1, 99),
        () => fn + rn2() + ri(1, 999),
        () => fn2 + rp() + ri(10, 9999),

        // === Фамилия + геймерское слово ===
        () => ln + rn2() + rnum(),
        () => ln + rp() + rnum(),
        () => ln3 + rn2() + ri(10, 99),
        () => rn2() + ln + rnum(),
        () => rp() + ln + rnum(),
        () => ln + rnum(),
        () => ln4 + rn2() + ri(1, 99),

        // === Имя + фамилия + геймер ===
        () => fn3 + ln3 + rn2(),
        () => fn + ln3 + rnum(),
        () => fn3 + rn2() + ln3,
        () => rn2() + fn3 + ln2,
        () => fn + rn2() + ln2 + ri(1, 99),
        () => fn3 + ln + ri(10, 99),

        // === Даты / популярные у людей ===
        () => fn + ri(1990, 2003),
        () => fn + ri(80, 99),
        () => ln + ri(1990, 2003),
        () => fn + ln + ri(1990, 2003),
        () => fn3 + ri(1985, 2005) + ln2,
        () => fn + '19' + ri(70, 99),
        () => fn + '20' + ri(0, 9).padStart(2, '0'),

        // === Короткие / простые ===
        () => fn + ri(100, 9999),
        () => fn3 + ri(100, 9999),
        () => fn + ri(1, 99),
        () => fn5 + ri(100, 999),
        () => ln + ri(100, 9999),
        () => ln3 + ri(100, 9999),
        () => fn2 + ln2 + ri(100, 999),

        // === Популярный стиль с разделителями ===
        () => fn + '.' + ri(1, 999),
        () => fn + '.' + ln3 + ri(1, 99),
        () => fn3 + '.' + rn2() + ri(10, 99),
        () => rn2() + '.' + fn + ri(10, 99),
        () => fn + '.' + rnum(),
        () => ln + '.' + fn + ri(10, 99),

        // === Совсем случайные комбинации ===
        () => rn2() + fn3 + ri(10, 999),
        () => fn2 + rn2() + ri(100, 9999),
        () => fn3 + ln2 + rnum(),
        () => rp() + fn3 + ln2 + ri(1, 99),
        () => fn + ln2 + rnum(),
        () => fn2 + ln3 + ri(10, 9999),
        () => rn2() + ri(10, 99) + fn3,
        () => fn4 + ri(10, 99) + ln2,
        () => fn3 + ri(10, 99) + rn2(),
        () => rp() + ri(10, 99) + fn4,

        // === Fallback хэш ===
        () => fn + crypto.randomBytes(3).toString('hex'),
        () => fn + ln + crypto.randomBytes(2).toString('hex'),
    ];

    let email;
    let attempts = 0;
    const maxAttempts = 150;

    do {
        const domain = randomChoice(EMAIL_DOMAINS);
        const base = emailPatterns[randomInt(0, emailPatterns.length - 1)]();
        email = `${base}@${domain}`;
        attempts++;
    } while (existingEmails.has(email) && attempts < maxAttempts);

    if (attempts >= maxAttempts) {
        const hash = crypto.randomBytes(4).toString('hex');
        email = `${fn}${hash}@${randomChoice(EMAIL_DOMAINS)}`;
    }

    return email;
}

// Контрольные вопросы (values из select на сайте)
const SECURITY_QUESTIONS = [
    'MOTHERS_FIRST_NAME',
    'NAME_OF_FAVORITE_BOOK',
    'FAVORITE_PETS_NAME',
    'FAVORITE_MOVIE',
    'FAVORITE_HOBBY',
    'FAVORITE_SPORT_TEAM'
];

// Массив более чем из 200 разнообразных реалистичных ответов на контрольные вопросы
const SECURITY_ANSWERS = [
    'Fluffy', 'Rex', 'Bella', 'Max', 'Luna', 'Charlie', 'Buddy', 'Milo', 'Rocky', 'Bear', 'Duke', 'Cooper', 'Sadie', 'Daisy',
    'Barsik', 'Murzik', 'Sharik', 'Bobik', 'Pushok', 'Ryzhyk', 'Snowball', 'ZhuZhu', 'Kuzya', 'Chernysh', 'Belka', 'Strelka',
    'Harry Potter', 'Lord of the Rings', 'The Witcher', 'War and Peace', 'Crime and Punishment', '1984', 'Master and Margarita',
    'The Great Gatsby', 'Hobbit', 'Dune', 'Idiot', 'Anna Karenina', 'To Kill a Mockingbird', 'The Catcher in the Rye', 'Fahrenheit 451',
    'Little Prince', 'Three Comrades', 'Jane Eyre', 'Pride and Prejudice', 'Matrix', 'Titanic', 'Avatar', 'Inception', 'Pulp Fiction',
    'Forrest Gump', 'Star Wars', 'The Godfather', 'Dark Knight', 'Fight Club', 'Avengers', 'Gladiator', 'Terminator', 'Jurassic Park',
    'Spartak', 'Zenit', 'CSKA', 'Lokomotiv', 'Dynamo', 'Krasnodar', 'Rostov', 'Rubin', 'Real Madrid', 'Barcelona', 'Manchester United',
    'Arsenal', 'Chelsea', 'Liverpool', 'Juventus', 'Milan', 'Bayern', 'PSG', 'Bulls', 'Lakers', 'Celtics', 'Yankees', 'Maple Leafs',
    'Football', 'Hockey', 'Basketball', 'Tennis', 'Reading', 'Gaming', 'Drawing', 'Cycling', 'Fishing', 'Cooking', 'Traveling',
    'Swimming', 'Running', 'Skiing', 'Photography', 'Music', 'Dancing', 'Yoga', 'Chess', 'Gardening', 'Singing', 'Knitting',
    'Anna', 'Maria', 'Elena', 'Olga', 'Natalia', 'Irina', 'Ekaterina', 'Tatiana', 'Svetlana', 'Yulia', 'Anastasia', 'Valentina',
    'Toyota', 'Honda', 'Ford', 'BMW', 'Mercedes', 'Audi', 'Volkswagen', 'Nissan', 'Hyundai', 'Kia', 'Volvo', 'Mazda', 'Chevrolet',
    'Moscow', 'Paris', 'London', 'New York', 'Tokyo', 'Berlin', 'Rome', 'Madrid', 'Prague', 'Vienna', 'Dubai', 'Istanbul', 'Sydney',
    'Black', 'White', 'Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Pink', 'Brown', 'Grey', 'Silver', 'Gold',
    'Puskin', 'Tolstoy', 'Dostoevsky', 'Chekhov', 'Gogol', 'Lermontov', 'Turgenev', 'Bulgakov', 'Esenin', 'Mayakovsky', 'Akhmatova',
    'Tom', 'Jerry', 'Mickey', 'Donald', 'Bugs', 'Daffy', 'Homer', 'Bart', 'Peter', 'Stewie', 'Spongebob', 'Patrick', 'Scooby', 'Shaggy',
    'Pizza', 'Burger', 'Sushi', 'Pasta', 'Steak', 'Salad', 'Taco', 'Borsch', 'Pelmeni', 'Blini', 'Kebab', 'Shawarma', 'Pancake', 'Waffle',
    'Apple', 'Samsung', 'Sony', 'Panasonic', 'LG', 'Philips', 'Asus', 'Acer', 'Lenovo', 'HP', 'Dell', 'Microsoft', 'Nokia', 'Motorola',
    'Spider-Man', 'Batman', 'Superman', 'Iron Man', 'Thor', 'Hulk', 'Captain America', 'Wolverine', 'Deadpool', 'Flash', 'Aquaman',
    'Mario', 'Luigi', 'Zelda', 'Link', 'Sonic', 'Tails', 'Knuckles', 'Crash', 'Spyro', 'Pac-Man', 'Donkey Kong', 'Bowser', 'Peach',
    'Dog', 'Cat', 'Fish', 'Bird', 'Hamster', 'Rabbit', 'Turtle', 'Snake', 'Lizard', 'Frog', 'Spider', 'Mouse', 'Rat', 'Guinea Pig',
    'Spring', 'Summer', 'Autumn', 'Winter', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    'Math', 'History', 'Biology', 'Chemistry', 'Physics', 'Geography', 'Literature', 'Art', 'Music Class', 'PE', 'English', 'French',
    'Piano', 'Guitar', 'Drums', 'Violin', 'Flute', 'Saxophone', 'Trumpet', 'Cello', 'Bass', 'Keyboard', 'Synthesizer', 'Accordion',
    'Doctor', 'Teacher', 'Engineer', 'Lawyer', 'Nurse', 'Police', 'Firefighter', 'Pilot', 'Chef', 'Writer', 'Artist', 'Musician',
    'Rose', 'Tulip', 'Lily', 'Daisy', 'Sunflower', 'Orchid', 'Carnation', 'Daffodil', 'Peony', 'Violet', 'Lotus', 'Jasmine',
    'Mars', 'Venus', 'Jupiter', 'Saturn', 'Mercury', 'Neptune', 'Uranus', 'Pluto', 'Earth', 'Moon', 'Sun', 'Star', 'Galaxy'
];

// Согласованные пары регион + город + улицы + индексы
// Каждая запись: { county, city, streets[], postcodeRange }
const REGIONS = [
    {
        county: 'Moscow Oblast',
        city: 'Moscow',
        streets: [
            'ul. Arbat', 'ul. Tverskaya', 'pr. Mira', 'ul. Lenina',
            'Bolshaya Ordynka ul.', 'ul. Noviy Arbat', 'Kutuzovskiy pr.',
            'ul. Pyatnitskaya', 'Leningradskiy pr.', 'ul. Sretenka'
        ],
        postcodes: ['101000', '115093', '109012', '125009', '117997', '103132', '127006', '121099', '119019', '125315']
    },
    {
        county: 'Leningrad Oblast',
        city: 'Saint Petersburg',
        streets: [
            'Nevskiy pr.', 'ul. Rubinshteyna', 'Ligovskiy pr.', 'Bolshoy pr.',
            'ul. Sadovaya', 'Moskovsky pr.', 'ul. Marata', 'Kamennoostrovsky pr.',
            'ul. Vasilevskaya', 'pr. Enlightenment'
        ],
        postcodes: ['190000', '191186', '197000', '199178', '196070', '195277', '190121', '192007', '198095', '197372']
    },
    {
        county: 'Krasnodar Krai',
        city: 'Krasnodar',
        streets: [
            'ul. Krasnaya', 'ul. Severnaya', 'ul. Kommunarov', 'ul. Mira',
            'ul. Stavropolskaya', 'ul. Turgeneva', 'ul. Rashpilevskaya',
            'pr. Chekistov', 'ul. Uralskaya', 'ul. Kubanskaya'
        ],
        postcodes: ['350000', '350020', '350042', '350063', '350051', '350059', '350061', '350049', '350015', '350072']
    },
    {
        county: 'Tatarstan',
        city: 'Kazan',
        streets: [
            'ul. Pushkina', 'ul. Baumana', 'pr. Pobedy', 'ul. Kremlyovskaya',
            'ul. Karla Marksa', 'ul. Gabdully Tukaya', 'ul. Dekabristov',
            'ul. Spartakovskaya', 'ul. Bolshaya Krasnaya', 'Yamasheva pr.'
        ],
        postcodes: ['420000', '420015', '420029', '420061', '420066', '420080', '420088', '420107', '420111', '420138']
    },
    {
        county: 'Novosibirsk Oblast',
        city: 'Novosibirsk',
        streets: [
            'Krasny pr.', 'ul. Lenina', 'ul. Kirov', 'ul. Revolyutsii',
            'Pervomayskaya ul.', 'ul. Gorkogo', 'ul. Chelyuskintsev',
            'pr. Dzerzhinskoye', 'ul. Vokzalnaya', 'Trolleynaya ul.'
        ],
        postcodes: ['630000', '630004', '630007', '630015', '630025', '630032', '630043', '630049', '630055', '630075']
    },
    {
        county: 'Samara Oblast',
        city: 'Samara',
        streets: [
            'ul. Kuybysheva', 'ul. Molodogvardeyskaya', 'ul. Lenina',
            'ul. Galaktionovskaya', 'ul. Chapaevskaya', 'ul. Stepana Razina',
            'Leninskaya ul.', 'pr. Kirova', 'ul. Novo-Sadovaya', 'pr. Metallurgov'
        ],
        postcodes: ['443000', '443010', '443011', '443013', '443020', '443022', '443041', '443068', '443079', '443086']
    }
];

// Устаревшие списки для совместимости с тестами
const CITIES = REGIONS.map(r => r.city);
const COUNTIES = REGIONS.map(r => r.county);

/**
 * Генерация согласованного адреса из локали с трекингом уникальности
 * @param {Object|null} locale - объект локали из loadLocale(). Если null — fallback на старые REGIONS
 */
function generateAddress(locale) {
    if (!locale || !locale.regions) {
        // Fallback: старая логика для совместимости с тестами
        const region = randomChoice(REGIONS);
        const street = randomChoice(region.streets);
        const house = randomInt(1, 185);
        return {
            county: region.county,
            city: region.city,
            address: `${street} ${house}`,
            postcode: randomChoice(region.postcodes)
        };
    }

    const used = loadUsedAddresses();
    const usedSet = new Set(used[locale.code] || []);

    // Перебираем регионы в случайном порядке
    const shuffledRegions = [...locale.regions].sort(() => Math.random() - 0.5);
    for (const region of shuffledRegions) {
        // Ищем первый свободный адрес в случайном порядке
        const shuffledAddresses = [...region.addresses].sort(() => Math.random() - 0.5);
        for (const addr of shuffledAddresses) {
            const key = `${region.city}|${addr.street}|${addr.postcode}`;
            if (!usedSet.has(key)) {
                saveUsedAddress(locale.code, region.city, addr.street, addr.postcode);
                return {
                    county: region.county,
                    city: region.city,
                    address: addr.street,
                    postcode: addr.postcode
                };
            }
        }
    }

    // Все адреса исчерпаны — предупреждение и рандомный
    logger.warn(`⚠️ Все адреса справочника ${locale.code} уже использованы! Повтор адреса.`);
    const region = randomChoice(locale.regions);
    const addr = randomChoice(region.addresses);
    return {
        county: region.county,
        city: region.city,
        address: addr.street,
        postcode: addr.postcode
    };
}

/**
 * Генерация уникального логина (игровой стиль)
 */
function generateLoginId(firstName, lastName, existingLogins = new Set()) {
    const fn = firstName.toLowerCase().replace(/[^a-z]/g, '') || 'user';
    const ln = lastName.toLowerCase().replace(/[^a-z]/g, '') || 'player';
    function rn(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
    function ri(a, b) { return String(rn(a, b)); }
    function rp() { return randomChoice(GAMER_PREFIX); }
    function rn2() { return randomChoice(GAMER_NOUN); }
    function rs() { return randomChoice(GAMER_SUFFIX); }
    function rnum() { return randomChoice(GAMER_NUMS); }

    const patterns = [
        // === С именем/фамилией ===
        () => rp() + fn.slice(0, 4) + rnum(),
        () => fn.slice(0, 4) + rn2() + rnum(),
        () => rn2() + ln.slice(0, 4) + rnum(),
        () => ln.slice(0, 4) + rp() + rnum(),
        () => fn.slice(0, 3) + ln.slice(0, 3) + rnum(),
        () => rp() + fn.slice(0, 3) + rn2(),
        () => fn.slice(0, 2) + rp() + rn2() + rnum(),
        () => rn2() + fn.slice(0, 4) + rs(),
        () => fn.slice(0, 5) + rnum(),
        () => ln.slice(0, 5) + rnum(),
        () => fn.slice(0, 3) + rnum() + rn2(),
        () => rn2() + fn.slice(0, 3) + rnum(),
        () => fn.slice(0, 4) + rp() + rnum(),
        () => rp() + fn.slice(0, 2) + ln.slice(0, 3) + rnum(),
        () => fn.slice(0, 3) + ln.slice(0, 2) + rn2(),

        // === Чистые геймерские ===
        () => rp() + rn2() + rnum(),
        () => rn2() + rp() + rnum(),
        () => rp() + rn2() + rp(),
        () => rn2() + rn2() + rnum(),
        () => rp() + rp() + rn2(),
        () => rp() + rn2() + rs(),
        () => rn2() + rs() + rnum(),
        () => rp() + rnum() + rn2(),
        () => rn2() + rnum() + rp(),
        () => rp() + rn2() + rn2() + rnum(),
        () => rn2() + rp() + rp() + rnum(),
        () => rp() + rp() + rnum(),
        () => rn2() + rn2() + rp(),
        () => rp() + rn2() + rp() + rnum(),
        () => rp() + rp() + rn2() + rnum(),

        // === Короткие ===
        () => rp() + rn2(),
        () => rn2() + rp(),
        () => rn2() + rnum(),
        () => rp() + rnum(),
        () => rn2() + ri(10, 999),
        () => rp() + ri(10, 999),

        // === X V стиль (без _) ===
        () => 'x' + rn2() + rnum(),
        () => rn2() + 'x' + rnum(),
        () => rn2() + 'xx' + rnum(),
        () => 'v' + rp() + rnum(),
        () => 'xx' + rn2() + rnum(),
        () => rn2() + 'gg' + rnum(),
        () => 'vip' + rn2() + rnum(),
        () => 'pro' + rn2() + rnum(),

        // === Капс первой буквы ===
        () => (rp()[0].toUpperCase() + rp().slice(1)) + rn2() + rnum(),
        () => rn2()[0].toUpperCase() + rn2().slice(1) + rnum(),
        () => fn.slice(0, 1).toUpperCase() + fn.slice(1, 4) + rn2() + rnum(),
        () => rp() + ln.slice(0, 1).toUpperCase() + ln.slice(1, 4) + rnum(),
        () => (rn2()[0].toUpperCase() + rn2().slice(1)) + (rp()[0].toUpperCase() + rp().slice(1)) + rnum(),

        // === Геймерский сленг (без _ ) ===
        () => 'the' + rn2() + rnum(),
        () => 'real' + rn2() + rnum(),
        () => rn2() + 'master' + rnum(),
        () => rn2() + 'god' + rnum(),
        () => rn2() + 'king' + rnum(),
        () => rn2() + 'lord' + rnum(),
        () => rn2() + 'prime' + rnum(),
        () => rn2() + 'zero' + rnum(),
        () => rn2() + 'one' + rnum(),
        () => 'mr' + rn2() + rnum(),
        () => 'sir' + rn2() + rnum(),
        () => rp() + rn2() + 'gg',
        () => rn2() + rn2() + rs(),
        () => rs() + rn2() + rnum(),
        () => rn2() + 'ez' + rnum(),
        () => rp() + 'gg' + rnum(),

        // === Fallback ===
        () => fn + rnum(),
        () => ln + rnum(),
        () => fn + rn2(),
        () => rn2() + fn.slice(0, 5),
        () => fn.slice(0, 4) + ri(100, 9999),
        () => ln.slice(0, 4) + ri(100, 9999),
    ];

    let loginId;
    let attempts = 0;
    do {
        const pat = patterns[rn(0, patterns.length - 1)];
        loginId = pat()
            .replace(/[^a-zA-Z0-9_]/g, '')  // только допустимые символы
            .slice(0, 15);                   // лимит Pinnacle
        while (loginId.length < 6) loginId += String(rn(0, 9));
        attempts++;
    } while (existingLogins.has(loginId) && attempts < 150);
    return loginId;
}

/**
 * Генерация случайного номера телефона
 * @param {Object|null} locale - объект локали. Если null — используется российский формат по умолчанию
 */
function generatePhoneNumber(locale) {
    if (locale && locale.phoneCodes && locale.phoneCodes.length > 0) {
        const code = randomChoice(locale.phoneCodes);
        const num = String(randomInt(1000000, 9999999));
        return `${code}${num}`;
    }
    // Fallback: российский
    const code = randomChoice(['900', '901', '902', '905', '910', '911', '912', '915', '916',
        '920', '921', '922', '925', '926', '927', '930', '937', '950', '960',
        '961', '962', '965', '967', '980', '981', '985', '989', '991', '999']);
    const num = String(randomInt(1000000, 9999999));
    return `${code}${num}`;
}

/**
 * Генерация одного аккаунта
 * @param {string|null} email - если передан, используется этот email; иначе генерируется
 */
function generateAccount(id, existingEmails, config = {}, email = null) {
    const gender = config.gender || 'male';

    // Загружаем локаль если указана
    let locale = null;
    const localeCode = config.locale || config.country || null;
    if (localeCode) {
        try {
            locale = loadLocale(localeCode);
        } catch (e) {
            logger.warn(`Локаль ${localeCode} не найдена, используем встроенные данные: ${e.message}`);
        }
    }

    // Выбираем имя/фамилию из локали или из встроенных массивов
    const maleNames = (locale && locale.maleNames) ? locale.maleNames : FIRST_NAMES_MALE;
    const femaleNames = (locale && locale.femaleNames) ? locale.femaleNames : FIRST_NAMES_FEMALE;
    const maleLastNames = (locale && locale.maleLastNames) ? locale.maleLastNames : LAST_NAMES_MALE;
    const femaleLastNames = (locale && locale.femaleLastNames) ? locale.femaleLastNames : LAST_NAMES_FEMALE;

    const firstName = gender === 'female' ? randomChoice(femaleNames) : randomChoice(maleNames);
    const lastName = gender === 'female' ? randomChoice(femaleLastNames) : randomChoice(maleLastNames);

    if (!email) {
        email = generateEmail(firstName, lastName, existingEmails);
    }
    existingEmails.add(email);

    const loginId = generateLoginId(firstName, lastName);
    const password = generatePassword();
    const addrData = generateAddress(locale);

    return {
        id,
        firstName,
        lastName,
        loginId,
        email,
        password,
        birthDate: generateBirthDate(),
        title: config.title || 'MR',
        gender: gender,
        country: (locale && locale.country) ? locale.country : (config.country || 'RU'),
        currency: config.currency || (locale && locale.currency) || 'RUB',
        county: addrData.county,
        postcode: addrData.postcode,
        address: addrData.address,
        city: addrData.city,
        contactNum: generatePhoneNumber(locale),
        securityQuestion: config.securityQuestion || randomChoice(SECURITY_QUESTIONS),
        securityAnswer: randomChoice((locale && locale.securityAnswers && locale.securityAnswers.length > 0) ? locale.securityAnswers : SECURITY_ANSWERS),
        locale: localeCode || 'RU',
        status: 'pending',
        registeredAt: null,
        pinnacleLogin: null,
        profilePath: null,
        mirrorUsed: null,
        error: null
    };
}

/**
 * Генерация аккаунтов из списка email'ов или указанного количества
 * @param {number|null} count - количество (если без email файла)
 * @param {Object} configOverrides
 * @param {string|null} emailsFile - путь к файлу с email'ами
 */
function generateAccounts(count, configOverrides = {}, emailsFile = null) {
    const config = require('../config.json');
    const accountsFile = path.resolve(__dirname, '..', config.paths.accountsFile);

    // Загрузка существующих аккаунтов
    let existing = [];
    if (fs.existsSync(accountsFile)) {
        try {
            existing = JSON.parse(fs.readFileSync(accountsFile, 'utf-8'));
        } catch (e) {
            logger.warn(`Не удалось прочитать ${accountsFile}, создаю новый: ${e.message}`);
            existing = [];
        }
    }

    // Собираем все "занятые" email: уже сохранённые аккаунты + blacklist.txt.
    // Blacklist пополняется registrator.js после каждой успешной регистрации — гарантирует
    // что email не будет использован повторно даже если по какой-то причине остался в emails.txt.
    const existingEmails = new Set(existing.map(a => (a.email || '').toLowerCase()).filter(Boolean));
    const blacklistPath = path.resolve(__dirname, '..', 'data', 'blacklist.txt');
    if (fs.existsSync(blacklistPath)) {
        try {
            const blLines = fs.readFileSync(blacklistPath, 'utf-8')
                .split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(Boolean);
            blLines.forEach(e => existingEmails.add(e));
            logger.info(`📛 Blacklist: ${blLines.length} email'ов исключены из пула`);
        } catch (e) {
            logger.warn(`Не удалось прочитать blacklist: ${e.message}`);
        }
    }
    const startId = existing.length > 0 ? Math.max(...existing.map(a => a.id)) + 1 : 1;

    // Загрузка email'ов из файла если указан
    let emailList = null;
    if (emailsFile) {
        const resolvedEmailsFile = path.resolve(__dirname, '..', emailsFile);
        emailList = loadEmailsFromFile(resolvedEmailsFile);
        // Фильтруем уже использованные (accounts.json + blacklist.txt)
        const beforeFilter = emailList.length;
        emailList = emailList.filter(e => !existingEmails.has((e || '').toLowerCase()));
        const dropped = beforeFilter - emailList.length;
        if (dropped > 0) logger.info(`📧 Отфильтровано ${dropped} уже использованных email'ов`);
        if (emailList.length === 0) {
            logger.error('Все email из файла уже использованы!');
            return [];
        }
        count = count ? Math.min(count, emailList.length) : emailList.length;
        logger.info(`Будет создано ${count} аккаунтов из ${emailList.length} доступных email'ов`);
    }

    if (!count || count <= 0) {
        logger.error('Не указано количество аккаунтов и нет email файла');
        return [];
    }

    const newAccounts = [];
    for (let i = 0; i < count; i++) {
        const email = emailList ? emailList[i] : null;
        const account = generateAccount(startId + i, existingEmails, {
            locale: configOverrides.locale || config.registration.locale || config.registration.country || 'RU',
            country: configOverrides.country || config.registration.country || 'RU',
            currency: configOverrides.currency || config.registration.currency || 'RUB',
            gender: configOverrides.gender || config.registration.gender,
            title: configOverrides.title || config.registration.title,
            securityQuestion: configOverrides.securityQuestion || config.registration.securityQuestion
        }, email);
        newAccounts.push(account);
    }

    // Сохранение
    const allAccounts = [...existing, ...newAccounts];
    const dir = path.dirname(accountsFile);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(accountsFile, JSON.stringify(allAccounts, null, 2), 'utf-8');

    logger.info(`Сгенерировано ${count} аккаунтов. Всего: ${allAccounts.length}. Файл: ${accountsFile}`);
    return newAccounts;
}

/**
 * Загрузка аккаунтов из файла
 */
function loadAccounts(filter = null) {
    const config = require('../config.json');
    const accountsFile = path.resolve(__dirname, '..', config.paths.accountsFile);

    if (!fs.existsSync(accountsFile)) {
        return [];
    }

    let accounts = JSON.parse(fs.readFileSync(accountsFile, 'utf-8'));

    if (filter) {
        accounts = accounts.filter(filter);
    }

    return accounts;
}

/**
 * Обновление аккаунта в файле
 */
function updateAccount(id, updates) {
    const config = require('../config.json');
    const accountsFile = path.resolve(__dirname, '..', config.paths.accountsFile);

    if (!fs.existsSync(accountsFile)) {
        throw new Error(`Файл аккаунтов не найден: ${accountsFile}`);
    }

    const accounts = JSON.parse(fs.readFileSync(accountsFile, 'utf-8'));
    const idx = accounts.findIndex(a => a.id === id);

    if (idx === -1) {
        throw new Error(`Аккаунт с id=${id} не найден`);
    }

    accounts[idx] = { ...accounts[idx], ...updates };
    fs.writeFileSync(accountsFile, JSON.stringify(accounts, null, 2), 'utf-8');

    return accounts[idx];
}

module.exports = {
    generateAccounts,
    generateAccount,
    generatePassword,
    generateBirthDate,
    generateEmail,
    generateLoginId,
    generatePhoneNumber,
    loadEmailsFromFile,
    loadAccounts,
    updateAccount,
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
};
