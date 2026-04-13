/**
 * Генератор расширенных справочников локалей
 * Создаёт RU.json и UA.json с 1000+ адресами, именами, фамилиями и хобби
 * Запуск: node scripts/generate-locales.js
 */

const fs = require('fs');
const path = require('path');

// ============================================================
// ОБЩИЕ ХОББИ (ответы на секретные вопросы)
// ============================================================
const HOBBIES_COMMON = [
    'Football', 'Basketball', 'Volleyball', 'Tennis', 'Swimming', 'Cycling', 'Running',
    'Hiking', 'Fishing', 'Hunting', 'Chess', 'Checkers', 'Billiards', 'Bowling', 'Golf',
    'Boxing', 'Wrestling', 'Judo', 'Karate', 'Yoga', 'Fitness', 'Gym', 'CrossFit',
    'Dancing', 'Singing', 'Guitar', 'Piano', 'Violin', 'Drawing', 'Painting',
    'Photography', 'Videography', 'Reading', 'Writing', 'Poetry', 'Blogging',
    'Cooking', 'Baking', 'Gardening', 'Knitting', 'Sewing', 'Embroidery', 'Origami',
    'Modelling', '3D printing', 'Woodworking', 'Welding', 'Mechanics', 'Electronics',
    'Programming', 'Gaming', 'Board games', 'Card games', 'Puzzles', 'Lego',
    'Collecting stamps', 'Collecting coins', 'Collecting cars', 'Collecting watches',
    'Travel', 'Camping', 'Rock climbing', 'Skiing', 'Snowboarding', 'Ice skating',
    'Surfing', 'Diving', 'Kayaking', 'Rafting', 'Paragliding', 'Skydiving',
    'Astronomy', 'Birdwatching', 'Botany', 'Geology', 'History', 'Archaeology',
    'Languages', 'Calligraphy', 'Podcasting', 'Volunteering', 'Meditation',
    'Cigar collecting', 'Wine tasting', 'Beer brewing', 'Aquarium keeping',
    'Horse riding', 'Dog training', 'Cat breeding', 'Beekeeping', 'Farming',
    'Archery', 'Fencing', 'Shooting', 'Paintball', 'Airsoft', 'Karting',
    'Radio amateur', 'Drone flying', 'RC cars', 'Robotics', 'Microcontrollers',
    'Stock trading', 'Cryptocurrency', 'Numismatics', 'Philately', 'Antiques',
    'Cinema', 'Theater', 'Opera', 'Ballet', 'Concerts', 'Karaoke', 'Standup',
    'Tattoo art', 'Body modification', 'Fashion design', 'Interior design',
    'Architecture', 'Urban exploration', 'Street art', 'Graffiti', 'Parkour'
];

// ============================================================
// РОССИЯ
// ============================================================

const RU_DATA = {
    code: 'RU',
    name: 'Россия',
    flag: '🇷🇺',
    currency: 'RUB',
    country: 'RU',
    phonePrefix: '7',
    phoneCodes: [
        '900', '901', '902', '903', '904', '905', '906', '908', '909',
        '910', '911', '912', '913', '914', '915', '916', '917', '918', '919',
        '920', '921', '922', '923', '924', '925', '926', '927', '928', '929',
        '930', '931', '932', '933', '934', '936', '937', '938', '939',
        '950', '951', '952', '953', '958', '960', '961', '962', '963', '964',
        '965', '966', '967', '968', '969', '977', '978', '980', '981', '982',
        '983', '984', '985', '986', '987', '988', '989', '991', '992', '993',
        '994', '995', '996', '997', '999'
    ],
    maleNames: [
        'Ivan', 'Sergei', 'Alexei', 'Dmitry', 'Andrei', 'Mikhail', 'Nikolai', 'Pavel', 'Viktor', 'Roman',
        'Oleg', 'Maxim', 'Artem', 'Denis', 'Anton', 'Gennady', 'Yuri', 'Ruslan', 'Stanislav', 'Vladimir',
        'Anatoly', 'Valery', 'Evgeny', 'Timur', 'Konstantin', 'Georgy', 'Kirill', 'Ilya', 'Petr', 'Stepan',
        'Grigory', 'Boris', 'Leonid', 'Fedor', 'Arkady', 'Vladislav', 'Semyon', 'Albert', 'German', 'Timofey',
        'Arseniy', 'Demid', 'Yaroslav', 'Zakhar', 'Mark', 'Rodion', 'Savva', 'Platon', 'Klim', 'Nazar',
        'David', 'Ignat', 'Efim', 'Zakhar', 'Gleb', 'Lev', 'Makar', 'Matvei', 'Nikita', 'Pvel',
        'Rostislav', 'Svyatoslav', 'Vadim', 'Vsevolod', 'Vyacheslav', 'Zakhary', 'Zinoviy', 'Eduard',
        'Ernest', 'Filip', 'Khariton', 'Yakov', 'Yegor', 'Afanasiy', 'Agafon', 'Aldar', 'Alik', 'Amid',
        'Anatol', 'Arkasha', 'Arsen', 'Borya', 'Buyan', 'Danila', 'Daniil', 'Donat', 'Edik', 'Egor',
        'Eldar', 'Emil', 'Erik', 'Foma', 'Gavriil', 'Gena', 'Gerasim', 'Glib', 'Gordey', 'Grisha',
        'Iosif', 'Isidor', 'Istoma', 'Karp', 'Khristian', 'Kondrat', 'Korney', 'Kuprian', 'Lavr', 'Lavrentiy'
    ],
    femaleNames: [
        'Anna', 'Maria', 'Elena', 'Olga', 'Natalia', 'Irina', 'Ekaterina', 'Tatiana', 'Svetlana', 'Yulia',
        'Anastasia', 'Valentina', 'Larisa', 'Galina', 'Tamara', 'Vera', 'Lyudmila', 'Oksana', 'Marina', 'Daria',
        'Alina', 'Polina', 'Sofia', 'Veronika', 'Kristina', 'Diana', 'Valeria', 'Yana', 'Kseniya', 'Milena',
        'Kira', 'Regina', 'Arina', 'Karolina', 'Ulyana', 'Snezhana', 'Taisiya', 'Lidia', 'Nina', 'Raisa',
        'Rimma', 'Inna', 'Alla', 'Ada', 'Aglaya', 'Agrafena', 'Agnes', 'Aida', 'Aigerim', 'Aisylu',
        'Akulina', 'Albina', 'Aleftina', 'Aleksandra', 'Alena', 'Alesya', 'Alfiya', 'Alfreda', 'Alinka',
        'Alisa', 'Aliya', 'Alla', 'Almira', 'Alsu', 'Alya', 'Amalia', 'Aminat', 'Amira', 'Anfisa',
        'Angelina', 'Anzhela', 'Asel', 'Asiya', 'Asol', 'Assol', 'Avgustina', 'Avgusta', 'Avdotya',
        'Ayna', 'Azaliya', 'Bella', 'Darya', 'Dinara', 'Dominika', 'Emilia', 'Esenia', 'Eva', 'Evdokiya',
        'Evgeniya', 'Faina', 'Fatima', 'Feodosiya', 'Florencia', 'Frida', 'Galia', 'Glafira', 'Gloria'
    ],
    maleLastNames: [
        'Ivanov', 'Petrov', 'Smirnov', 'Kuznetsov', 'Popov', 'Vasilev', 'Sokolov', 'Mikhailov', 'Novikov', 'Fedorov',
        'Morozov', 'Volkov', 'Alekseev', 'Lebedev', 'Semenov', 'Egorov', 'Pavlov', 'Kozlov', 'Stepanov', 'Nikolaev',
        'Orlov', 'Andreev', 'Makarov', 'Nikitin', 'Zaitsev', 'Komarov', 'Konov', 'Krylov', 'Kulikov', 'Lapin',
        'Mironov', 'Panov', 'Polyakov', 'Rodionov', 'Ryabov', 'Saveliev', 'Safonov', 'Titov', 'Tikhonov', 'Ushakov',
        'Chernov', 'Shishkin', 'Yakovlev', 'Zhukov', 'Sobolev', 'Efimov', 'Belov', 'Tarasov', 'Vinogradov', 'Frolov',
        'Gusev', 'Kovalev', 'Bogdanov', 'Vorobyov', 'Isakov', 'Kalinin', 'Larin', 'Loginov', 'Lukashev', 'Lukin',
        'Malov', 'Matveev', 'Medvedev', 'Melnikov', 'Merkushev', 'Meshcheryakov', 'Mihaylov', 'Mochalov', 'Myasnikov',
        'Naumov', 'Nechaev', 'Nikiforov', 'Novoselov', 'Obraztsov', 'Odintsov', 'Osipov', 'Ovchinnikov', 'Panfilov',
        'Paramonov', 'Parshin', 'Pashkov', 'Perevalov', 'Peshkov', 'Plotnikov', 'Pozdnyakov', 'Prokhorov', 'Pronin',
        'Proshin', 'Protasov', 'Pugachev', 'Putilin', 'Rybakov', 'Rybkin', 'Ryzhov', 'Safronov', 'Samsonov',
        'Sannikov', 'Sdobnikov', 'Sedov', 'Selivanov', 'Semenkov', 'Shabanov', 'Sharin', 'Shatrov', 'Shchukin',
        'Shipov', 'Shiryaev', 'Shubin', 'Sidorov', 'Silvestrov', 'Skvortsov', 'Sleptsov', 'Smirnykh', 'Solovyov',
        'Suvorov', 'Sveshnikov', 'Tarkhov', 'Timashev', 'Timofeev', 'Tokarev', 'Tolstov', 'Tretyakov', 'Trifonov',
        'Trubilin', 'Tsvetkov', 'Tugushev', 'Tukhachevsky', 'Tupitsyn', 'Turchin', 'Ulyanov', 'Uvarov', 'Vadimov',
        'Vagin', 'Vanshin', 'Vasilyev', 'Vatutenko', 'Velikov', 'Vetrov', 'Viktorov', 'Vilensky', 'Vladimirov'
    ],
    femaleLastNames: [
        'Ivanova', 'Petrova', 'Smirnova', 'Kuznetsova', 'Popova', 'Vasileva', 'Sokolova', 'Mikhailova', 'Novikova', 'Fedorova',
        'Morozova', 'Volkova', 'Alekseeva', 'Lebedeva', 'Semenova', 'Egorova', 'Pavlova', 'Kozlova', 'Stepanova', 'Nikolaeva',
        'Orlova', 'Andreeva', 'Makarova', 'Nikitina', 'Zaitseva', 'Komarova', 'Konova', 'Krylova', 'Kulikova', 'Lapina',
        'Mironova', 'Panova', 'Polyakova', 'Rodionova', 'Ryabova', 'Savelieva', 'Safonova', 'Titova', 'Tikhonova', 'Ushakova',
        'Chernova', 'Shishkina', 'Yakovleva', 'Zhukova', 'Soboleva', 'Efimova', 'Belova', 'Tarasova', 'Vinogradova', 'Frolova',
        'Guseva', 'Kovaleva', 'Bogdanova', 'Vorobyova', 'Isakova', 'Kalinina', 'Larina', 'Loginova', 'Lukasheva', 'Lukina',
        'Malova', 'Matveeva', 'Medvedeva', 'Melnikova', 'Merkusheva', 'Meshcheryakova', 'Mochalova', 'Myasnikova',
        'Naumova', 'Nechaeva', 'Nikiforova', 'Novoselogva', 'Obraztsova', 'Odintsova', 'Osipova', 'Ovchinnikova',
        'Panfilova', 'Paramonova', 'Parshina', 'Pashkova', 'Perevakova', 'Peshkova', 'Plotnikova', 'Pozdnyakova',
        'Prokhorova', 'Pronina', 'Proshina', 'Protasova', 'Pugacheva', 'Putilina', 'Rybakova', 'Rybkina', 'Ryzhova',
        'Safronova', 'Samsonova', 'Sannikova', 'Sedova', 'Selivanova', 'Semenkolva', 'Shabanova', 'Sharinova',
        'Shatrova', 'Shchukina', 'Shipova', 'Shiryaeva', 'Shubina', 'Sidorova', 'Silvestrova', 'Skvortsova'
    ],
    securityAnswers: HOBBIES_COMMON,
    regions: []
};

// Данные по городам России: { city, county, postcode, streets[] }
const RU_CITIES = [
    { city: 'Moscow', county: 'Moscow Oblast', postcode: '119', streets: ['ul. Arbat', 'ul. Tverskaya', 'pr. Mira', 'ul. Noviy Arbat', 'Kutuzovskiy pr.', 'ul. Bolshaya Ordynka', 'ul. Pyatnitskaya', 'ul. Sretenka', 'ul. Myasnitskaya', 'ul. Pokrovka', 'ul. Petrovka', 'ul. Malaya Bronnaya', 'ul. Prechistenka', 'ul. Ostozhenka', 'ul. Bolshaya Yakimanka', 'ul. Sadovaya-Kudrinskaya', 'ul. Maroseika', 'ul. Ilyinka', 'ul. Varvarka', 'Smolensky bul.', 'ul. Lenivka', 'Leningradskiy pr.', 'pr. Vernadskogo', 'ul. Profsoyuznaya', 'ul. Akademika Koroleva'] },
    { city: 'Saint Petersburg', county: 'Leningrad Oblast', postcode: '191', streets: ['Nevskiy pr.', 'ul. Rubinshteyna', 'Ligovskiy pr.', 'Bolshoy pr.', 'ul. Sadovaya', 'ul. Marata', 'Kamennoostrovsky pr.', 'Moskovsky pr.', 'ul. Gorokhovaya', 'Voznesensky pr.', 'ul. Dekabristov', 'Primorsky pr.', 'pr. Stachek', 'ul. Zvenigorodskaya', 'ul. Ryleeva', 'ul. Furshtatskaya', 'ul. Pestelya', 'Liteyny pr.', 'ul. Chaikovskogo', 'Fontanka nab.'] },
    { city: 'Krasnodar', county: 'Krasnodar Krai', postcode: '350', streets: ['ul. Krasnaya', 'ul. Severnaya', 'ul. Kommunarov', 'ul. Mira', 'ul. Stavropolskaya', 'ul. Turgeneva', 'ul. Rashpilevskaya', 'pr. Chekistov', 'ul. Uralskaya', 'ul. Kubanskaya', 'ul. Kavkazskaya', 'ul. Gogolya', 'ul. Komsomolskaya', 'ul. Lenina', 'ul. Garibaldi', 'ul. Krasnykh Partizan', 'ul. Vorovskogo', 'ul. Zheleznodorozhnaya', 'ul. Oktyabrskaya', 'ul. Seleznyova'] },
    { city: 'Kazan', county: 'Tatarstan', postcode: '420', streets: ['ul. Pushkina', 'ul. Baumana', 'pr. Pobedy', 'ul. Kremlyovskaya', 'ul. Karla Marksa', 'ul. Gabdully Tukaya', 'ul. Dekabristov', 'ul. Spartakovskaya', 'ul. Bolshaya Krasnaya', 'Yamasheva pr.', 'ul. Chistopolskaya', 'ul. Universitetskaya', 'ul. Khadi Taktasha', 'ul. Dzerzhinskogo', 'ul. Tatarstan', 'ul. Sibirskiy trakt', 'ul. Spartak', 'ul. Gazieva', 'ul. Lobachevskogo', 'ul. Kutuzova'] },
    { city: 'Novosibirsk', county: 'Novosibirsk Oblast', postcode: '630', streets: ['Krasny pr.', 'ul. Lenina', 'ul. Kirova', 'ul. Revolyutsii', 'ul. Gorkogo', 'ul. Chelyuskintsev', 'ul. Vokzalnaya', 'ul. Serebrennikovskaya', 'pr. Marksa', 'ul. Vladimirskaya', 'ul. Frunze', 'ul. Kommunisticheskaya', 'ul. Dusi Kovalchuk', 'ul. Dzerzinskogo', 'ul. Chapygina', 'ul. Nikitina', 'ul. Galushina', 'ul. Timiryazeva', 'ul. Kolkhidskaya', 'ul. Plakitnaya'] },
    { city: 'Samara', county: 'Samara Oblast', postcode: '443', streets: ['ul. Kuybysheva', 'ul. Molodogvardeyskaya', 'ul. Lenina', 'ul. Galaktionovskaya', 'ul. Chapaevskaya', 'ul. Stepana Razina', 'ul. Alekseya Tolstogo', 'ul. Novo-Sadovaya', 'pr. Kirova', 'ul. Vilonovskaya', 'ul. Sadovaya', 'ul. Rechnaya', 'ul. Nekrasova', 'ul. Nikitinskaya', 'ul. Br. Korostelev', 'ul. Krasnoarmeyskaya', 'ul. Chernorechemskaya', 'ul. Avrory', 'ul. Volzhskiy pr.', 'ul. Leningradskaya'] },
    { city: 'Yekaterinburg', county: 'Sverdlovsk Oblast', postcode: '620', streets: ['ul. Lenina', 'ul. Karla Libknehta', 'ul. Malisheva', 'pr. Lenina', 'ul. 8 Marta', 'ul. Lunacharskogo', 'ul. Chelyuskintsev', 'ul. Sverdlova', 'ul. Bolshakova', 'Sibirskiy trakt', 'ul. Stepana Razina', 'ul. Frunze', 'ul. Verkhoturskaya', 'ul. Kuibysheva', 'ul. Khokhryakova', 'ul. Mamina-Sibiryaka', 'ul. Goncharova', 'ul. Narodnoj Voli', 'ul. Beloreche nskaya', 'ul. Moskovskaya'] },
    { city: 'Chelyabinsk', county: 'Chelyabinsk Oblast', postcode: '454', streets: ['pr. Lenina', 'ul. Kirova', 'ul. Svobody', 'ul. Revolyutsii', 'ul. Pushkina', 'ul. Komsomolskaya', 'ul. Kommuny', 'ul. Voroshilova', 'ul. Truda', 'ul. Artilleriyskaya', 'ul. Savina', 'ul. Makarenka', 'ul. Elkonina', 'Molodogvardeytsev ul.', 'ul. Ordzhonikidze', 'ul. Chicherina', 'ul. Dovatora', 'ul. Gorkogo', 'ul. Smolina', 'ul. Pokrovskaya'] },
    { city: 'Omsk', county: 'Omsk Oblast', postcode: '644', streets: ['ul. Lenina', 'pr. Mira', 'ul. Pushkina', 'ul. Partizanskaya', 'ul. Gorkogo', 'ul. Krasniy Put', 'ul. Chapaeva', 'ul. Marks', 'ul. Gesena', 'ul. Zhukova', 'ul. Dekabristov', 'ul. Lermontova', 'ul. Frunze', 'ul. 10 Let Oktyabrya', 'ul. Magazinnaya', 'ul. Leninskaya', 'ul. Kalinina', 'ul. Artilleriyskaya', 'ul. Sihirevskay', 'ul. Voennaya'] },
    { city: 'Rostov-on-Don', county: 'Rostov Oblast', postcode: '344', streets: ['pr. Sokolova', 'ul. Bolshaya Sadovaya', 'ul. Pushkinskaya', 'pr. Semashko', 'ul. Stanislavskogo', 'ul. Maksima Gorkogo', 'ul. Chekhova', 'ul. Suvorova', 'ul. Turgenevskaya', 'ul. Dobrovolskogo', 'ul. Beregovaya', 'ul. Tekucheva', 'ul. Budyonnov.', 'ul. Krasnoarmeyskaya', 'ul. Zakrutkin', 'ul. Mechnikova', 'ul. Novatorov', 'ul. Portovaya', 'ul. Berezinskaya', 'ul. Mariupol.'] },
    { city: 'Ufa', county: 'Bashkortostan', postcode: '450', streets: ['ul. Lenina', 'pr. Oktyabrya', 'ul. Dostoyevskogo', 'ul. Pushkina', 'ul. Zentsova', 'ul. Komsomolskaya', 'ul. Rasuleva', 'ul. Mendeleyeva', 'ul. Revolyutsionnaya', 'ul. Kommunisticheskaya', 'ul. Vorovskogo', 'ul. Aksakova', 'ul. Karla Marksa', 'ul. Chernyshevskogo', 'ul. Prospekt Zhukova', 'ul. Salavata Yulaeva', 'ul. Blyukhera', 'ul. Ayskaya', 'ul. Prospekt Slavy', 'ul. Bestuzheva'] },
    { city: 'Volgograd', county: 'Volgograd Oblast', postcode: '400', streets: ['pr. Lenina', 'ul. Mira', 'ul. Komsomolskaya', 'ul. Krasnoznamensskaya', 'ul. Kommunisticheskaya', 'ul. Chapaeva', 'ul. Sovetskaya', 'ul. Raboche-Krestyanskaya', 'ul. Militseyskaya', 'ul. Eletskaya', 'ul. Khimicheskaya', 'ul. Olimpiiskaya', 'ul. Rokossovskogo', 'ul. Academika Bakhreva', 'ul. Institutskaya', 'ul. Inzhenernaya', 'ul. Zelenovskaya', 'ul. Naberezhnaya', 'ul. Chuikovoy', 'ul. Zemlyachkovoy'] },
    { city: 'Krasnoyarsk', county: 'Krasnoyarsk Krai', postcode: '660', streets: ['pr. Mira', 'ul. Lenina', 'ul. Maerchaka', 'ul. Marksa', 'ul. Surikova', 'ul. Vzletnaya', 'ul. Semafornaya', 'ul. Krasnodarskaya', 'ul. Matrosova', 'ul. Dubrovinskogo', 'ul. Akademiciena Kirensky', 'ul. Kirovskogo', 'ul. Vzletnaya', 'ul. Truda', 'ul. Krasnаya Armiya', 'ul. Urytskogo', 'ul. Novosibir', 'ul. Bograda', 'ul. Schetnaya', 'ul. Partizana Zheleznyaka'] },
    { city: 'Voronezh', county: 'Voronezh Oblast', postcode: '394', streets: ['pr. Revolyutsii', 'ul. Lenina', 'ul. Moskovskiy pr.', 'ul. Karla Marksa', 'ul. Komissarzhevskoy', 'ul. Novousmanskaya', 'ul. Myasnitskaya', 'ul. Ostrоgоzhskaya', 'ul. Khersonskaya', 'ul. Plekhanovskaya', 'ul. Sredne-Moskovskaya', 'ul. Koltsovskaya', 'ul. Rimskogo-Korsakova', 'ul. Lizyukova', 'ul. Bul. Pobedy', 'ul. Karbysheva', 'ul. Berezinskaya', 'ul. Transportnaya', 'ul. Kholzunova', 'ul. Dimitrova'] },
    { city: 'Perm', county: 'Perm Krai', postcode: '614', streets: ['ul. Lenina', 'ul. Sibirskaya', 'ul. Komsomolskiy pr.', 'ul. Revolyutsii', 'ul. Petropavlovskaya', 'ul. Kuybysheva', 'ul. Gagarina', 'ul. Pushkina', 'ul. Mira', 'ul. Tekhnicheskaya', 'ul. Neftyanikov', 'ul. Academika Chirikova', 'ul. Sovetskaya', 'ul. Uralskaya', 'ul. Zheleznodorozhnaya', 'ul. Komprosovskaya', 'ul. Bakalinskaya', 'ul. Malaya Yamskaya', 'ul. Permskaya', 'ul. Stolyarova'] },
    { city: 'Nizhny Novgorod', county: 'Nizhny Novgorod Oblast', postcode: '603', streets: ['ul. Rozhdestvenskaya', 'ul. Bolshaya Pokrovskaya', 'ul. Lenina', 'ul. Minina', 'pr. Gagarina', 'ul. Kremlevskaya', 'ul. Varvarskaya', 'ul. Komsomolskaya', 'ul. Novaya', 'ul. Oktyabrskaya', 'ul. Piskunova', 'ul. Zelenodolskaya', 'ul. Poltavskay', 'ul. Mesherskoe oz.', 'ul. Molodyozhniy', 'ul. Yubileyniy', 'ul. Kuybysheva', 'ul. Krasnaya sloboda', 'ul. Glazunova', 'ul. Zorge'] },
    { city: 'Tyumen', county: 'Tyumen Oblast', postcode: '625', streets: ['ul. Lenina', 'ul. Pervomaiskaya', 'ul. Respubliki', 'ul. Mira', 'ul. 50 Let Oktyabrya', 'ul. Tobolskaya', 'ul. Chernyshevskogo', 'ul. Osipenko', 'ul. Malysheva', 'ul. Melnikaite', 'ul. Semakovskaya', 'ul. Gertsena', 'ul. Dzerzhinskogo', 'ul. Vostochnaya', 'ul. Zhukova', 'ul. Kolmogorova', 'ul. Parizhskoy Kommuny', 'ul. Pionerskaya', 'ul. Borodina', 'ul. Feldmana'] },
    { city: 'Irkutsk', county: 'Irkutsk Oblast', postcode: '664', streets: ['ul. Lenina', 'ul. Karla Libknehta', 'ul. Karla Marksa', 'ul. Kirov', 'ul. Gorkogo', 'ul. Poletaeva', 'ul. Timiryazeva', 'ul. Mopra', 'ul. Karskaya', 'ul. Marata', 'ul. Chekhova', 'ul. Dekabrskikh Sobytiy', 'ul. Novomechenaya', 'ul. 5-Ya Armiya', 'ul. Baikaldskaya', 'ul. Ryabinovaya', 'ul. Sportivnaya', 'ul. Pereselenk.', 'ul. Industrialnaya', 'ul. Transportnaya'] },
    { city: 'Barnaul', county: 'Altai Krai', postcode: '656', streets: ['pr. Lenina', 'ul. Komsomolskiy pr.', 'ul. Pushkina', 'ul. Sotsialisticheskiy pr.', 'ul. Gorkogo', 'ul. Anatoliya', 'ul. Molodezh', 'ul. Chekhova', 'ul. Dem.Respubliki', 'ul. Zarechnaya', 'ul. Partizanskaya', 'ul. Sibirskaya', 'ul. Matrosova', 'ul. Neftyanikov', 'ul. Maschinostritelney', 'ul. Belogorskaya', 'ul. Lyakhova', 'ul. Yuzhnaya', 'ul. Chkalova', 'ul. Revolyutsii'] },
    { city: 'Vladivostok', county: 'Primorsky Krai', postcode: '690', streets: ['ul. Svetlanskaya', 'Okeanskiy pr.', 'ul. Pushkina', 'pr. 100-letiya Vladivostoka', 'ul. Admirala Fotareva', 'ul. Aleutskaya', 'ul. Lermontova', 'ul. 1-Ya Morskaya', 'ul. Korabelnaya naberezhnaya', 'ul. Pogranichnaya', 'ul. Tikhookeanskaya', 'ul. Admirala Foka', 'ul. Batareinaya', 'ul. Praporshchika Komarova', 'ul. Molodezhnaya', 'ul. Rudnevskaya', 'ul. Shoshina', 'ul. Kalininskaya', 'ul.Sakhalinskaya', 'ul. Komsomolskaya'] }
];

// Генерируем адреса для России
function generateRuAddresses() {
    const regions = [];
    for (const cityData of RU_CITIES) {
        const addresses = [];
        const streets = cityData.streets;
        // По каждой улице генерируем ~55 домов = 20 streets * 55 = 1100 адресов
        for (const street of streets) {
            // Нечётные и чётные дома с разными индексами (+1 за каждые 100 домов)
            const houseNumbers = [];
            for (let h = 1; h <= 55; h++) {
                houseNumbers.push(h);
            }
            for (const house of houseNumbers) {
                // Постиндекс: базовый + вариация по улице и дому
                const streetIdx = streets.indexOf(street);
                const postcodeVariant = String(parseInt(cityData.postcode + '000') + (streetIdx * 10) + Math.floor(house / 50)).slice(0, 6);
                addresses.push({
                    street: `${street} ${house}`,
                    postcode: postcodeVariant
                });
            }
        }
        regions.push({
            county: cityData.county,
            city: cityData.city,
            addresses
        });
    }
    return regions;
}

RU_DATA.regions = generateRuAddresses();

// Подсчёт адресов
const ruTotal = RU_DATA.regions.reduce((s, r) => s + r.addresses.length, 0);
console.log(`RU: ${ruTotal} адресов в ${RU_DATA.regions.length} регионах`);

// ============================================================
// УКРАИНА
// ============================================================

const UA_DATA = {
    code: 'UA',
    name: 'Украина',
    flag: '🇺🇦',
    currency: 'UAH',
    country: 'UA',
    phonePrefix: '380',
    phoneCodes: ['50', '63', '66', '67', '68', '73', '91', '92', '93', '94', '95', '96', '97', '98', '99'],
    maleNames: [
        'Oleksandr', 'Andriy', 'Dmytro', 'Serhiy', 'Mykola', 'Vasyl', 'Volodymyr', 'Ivan', 'Oleh', 'Roman',
        'Artem', 'Taras', 'Bohdan', 'Pavlo', 'Viktor', 'Maksym', 'Ihor', 'Stanislav', 'Ruslan', 'Yurii',
        'Mykhailo', 'Kostiantyn', 'Hryhorii', 'Yehor', 'Denys', 'Anton', 'Vitalii', 'Vladyslav', 'Oleksii', 'Kyrylo',
        'Yaroslav', 'Zakhar', 'Fedir', 'Stepan', 'Illya', 'Matvii', 'Mark', 'Tymofiy', 'Nazar', 'Danylo',
        'Arsen', 'Boryslav', 'Vadym', 'Vitaliiy', 'Vladlen', 'Vsevolod', 'Vyacheslav', 'Zhenia', 'Zakhariia',
        'Zoreslav', 'Eduard', 'Ernest', 'Panas', 'Panko', 'Parfenii', 'Petro', 'Prokip', 'Savchenko', 'Semko',
        'Sofron', 'Sylvestr', 'Symon', 'Tymish', 'Tyt', 'Tyberiiy', 'Ulian', 'Feodosiy', 'Feodot', 'Ferriy',
        'Kharyton', 'Khrystofor', 'Yukhym', 'Yurko', 'Yakiv', 'Yarema', 'Yosyp', 'Zenon', 'Znusym', 'Zoryan'
    ],
    femaleNames: [
        'Olena', 'Natalia', 'Iryna', 'Kateryna', 'Yuliia', 'Oksana', 'Mariia', 'Svitlana', 'Tetiana', 'Olha',
        'Larysa', 'Halyna', 'Tamara', 'Liudmyla', 'Valentyna', 'Daria', 'Alina', 'Polina', 'Veronika', 'Anastasia',
        'Sofia', 'Viktoriia', 'Khrystyna', 'Diana', 'Valeriia', 'Yana', 'Kseniia', 'Milena', 'Kira', 'Uliana',
        'Nina', 'Lidia', 'Raisa', 'Inna', 'Ruslana', 'Zoriana', 'Nadiia', 'Lesya', 'Marta', 'Oksanya',
        'Bohdana', 'Daryna', 'Elina', 'Emiliia', 'Erika', 'Evelina', 'Hanna', 'Ilona', 'Jaryna', 'Joanna',
        'Kamillia', 'Karyna', 'Klara', 'Lada', 'Larysa', 'Liana', 'Lila', 'Liliana', 'Lina', 'Lira',
        'Liubov', 'Liudmyla', 'Liusia', 'Lora', 'Lubov', 'Lyubomyra', 'Lyudmyla', 'Marharyta', 'Marka', 'Marta',
        'Martyna', 'Nadiia', 'Nastia', 'Natalka', 'Nila', 'Nona', 'Nora', 'Oksana', 'Olena', 'Olesia'
    ],
    maleLastNames: [
        'Kovalenko', 'Melnyk', 'Shevchenko', 'Bondarenko', 'Tkachenko', 'Kravchenko', 'Oliinyk', 'Sydorenko', 'Marchenko', 'Moroz',
        'Lysenko', 'Petrenko', 'Savchenko', 'Boyko', 'Klymenko', 'Pavlenko', 'Rudenko', 'Karpenko', 'Yaremchuk', 'Honcharenko',
        'Hrytsenko', 'Semenko', 'Pavliuk', 'Levchenko', 'Hnatyuk', 'Dmytrenko', 'Zakharchenko', 'Yatsenko', 'Fedorenko', 'Mykhailenko',
        'Vasyliuk', 'Humeniuk', 'Ilchenko', 'Ishchenko', 'Kovalchuk', 'Kryvenko', 'Kushnir', 'Kuzyk', 'Liashenko', 'Luts',
        'Nazarenko', 'Nesterenko', 'Panasiuk', 'Ponomarenko', 'Prokopenko', 'Romanenko', 'Savytskyi', 'Skrypnyk', 'Slavchuk', 'Sokol',
        'Stetsenko', 'Sytnyk', 'Tereschenko', 'Tkach', 'Tymoshenko', 'Zahorulko', 'Zelensky', 'Zinchenko', 'Zubko', 'Zymovets',
        'Antoniuk', 'Avramenko', 'Baranets', 'Bazhan', 'Bezruchko', 'Bilous', 'Bilyk', 'Bondar', 'Burlaka', 'Chaban',
        'Chornovil', 'Chumachenko', 'Denysenko', 'Didenko', 'Dubovyk', 'Dutchak', 'Filonenko', 'Franchuk', 'Fursenko', 'Gavrylenko',
        'Gerasymenko', 'Gladchenko', 'Glushenko', 'Grygorenko', 'Homenko', 'Horbach', 'Hordiienko', 'Hrynchuk', 'Hrynko', 'Hutsuliak'
    ],
    femaleLastNames: [
        'Kovalenko', 'Melnyk', 'Shevchenko', 'Bondarenko', 'Tkachenko', 'Kravchenko', 'Oliinyk', 'Sydorenko', 'Marchenko', 'Moroz',
        'Lysenko', 'Petrenko', 'Savchenko', 'Boyko', 'Klymenko', 'Pavlenko', 'Rudenko', 'Karpenko', 'Yaremchuk', 'Honcharenko',
        'Hrytsenko', 'Semenko', 'Pavliuk', 'Levchenko', 'Hnatyuk', 'Dmytrenko', 'Zakharchenko', 'Yatsenko', 'Fedorenko', 'Mykhailenko',
        'Vasyliuk', 'Humeniuk', 'Ilchenko', 'Ishchenko', 'Kovalchuk', 'Kryvenko', 'Kushnir', 'Kuzyk', 'Liashenko', 'Luts',
        'Nazarenko', 'Nesterenko', 'Panasiuk', 'Ponomarenko', 'Prokopenko', 'Romanenko', 'Savytska', 'Skrypnyk', 'Slavchuk', 'Sokol',
        'Stetsenko', 'Sytnyk', 'Tereschenko', 'Tkach', 'Tymoshenko', 'Zahorulko', 'Zelenska', 'Zinchenko', 'Zubko', 'Zymovets',
        'Antoniuk', 'Avramenko', 'Baranets', 'Bazhan', 'Bezruchko', 'Bilous', 'Bilyk', 'Bondar', 'Burlaka', 'Chaban',
        'Chornovil', 'Chumachenko', 'Denysenko', 'Didenko', 'Dubovyk', 'Dutchak', 'Filonenko', 'Franchuk', 'Fursenko', 'Gavrylenko',
        'Gerasymenko', 'Gladchenko', 'Glushenko', 'Grygorenko', 'Homenko', 'Horbach', 'Hordiienko', 'Hrynchuk', 'Hrynko', 'Hutsuliak'
    ],
    securityAnswers: HOBBIES_COMMON,
    regions: []
};

const UA_CITIES = [
    { city: 'Kyiv', county: 'Kyiv Oblast', postcode: '010', streets: ['vul. Khreshchatyk', 'bul. Tarasa Shevchenka', 'vul. Velyka Vasylkivska', 'vul. Lva Tolstoho', 'vul. Sahaidachnoho', 'prsp. Peremohy', 'vul. Antonovycha', 'vul. Gorodetskoho', 'vul. Instytutska', 'vul. Yaroslaviv Val', 'vul. Mykhailivska', 'vul. Prorizna', 'vul. Zankovetskoi', 'vul. Reytarska', 'vul. Spaska', 'vul. Predslavilska', 'vul. Zankovetska', 'vul. Bankova', 'vul. Tryokhsviatytelska', 'vul. Zolotovoritska'] },
    { city: 'Kharkiv', county: 'Kharkiv Oblast', postcode: '610', streets: ['vul. Sumska', 'vul. Pushkinska', 'prsp. Nezalezhnosti', 'prsp. Nauky', 'vul. Hryhoria Skovorody', 'vul. Haharina', 'vul. Klochkivska', 'vul. Heroiv Pratsi', 'bul. Haharina', 'vul. Plekhaniivska', 'vul. Moskovskiy prsp.', 'vul. Matuzova', 'vul. Korolenkivska', 'vul. Artema', 'vul. Darvina', 'vul. Blahovishchenska', 'vul. Kultur', 'vul. Minska', 'vul. Academika Pavlova', 'vul. Valentinyvska'] },
    { city: 'Odesa', county: 'Odesa Oblast', postcode: '650', streets: ['vul. Derybasivska', 'prsp. Shevchenka', 'vul. Preobrazhenska', 'vul. Richelievska', 'vul. Pushkinska', 'vul. Katerynynska', 'vul. Hretska', 'vul. Bunina', 'vul. Lanzheronovska', 'vul. Uspenska', 'prsp. Miru', 'vul. Bazarna', 'vul. Italiianska', 'vul. Tyraspolska', 'vul. Chornomorska', 'vul. Havanna', 'vul. Karantine', 'vul. Pastem', 'vul. Shota Rustaveli', 'vul. Mechnikova'] },
    { city: 'Dnipro', county: 'Dnipropetrovsk Oblast', postcode: '490', streets: ['prsp. Dmytra Yavornytskoho', 'vul. Haharina', 'vul. Korolenka', 'vul. Shevchenka', 'prsp. Heroyiv', 'vul. Naberezhna Peremogy', 'vul. Lermontova', 'vul. Hrushevskoho', 'vul. Nyzhnodniprovska', 'prsp. Slobozhanskyi', 'vul. Zaliznychna', 'vul. Hlinka', 'vul. Artema', 'vul. Monityrova', 'vul. Korolennka', 'vul. Sverdlova', 'vul. Terska', 'vul. Pervomayska', 'vul. Monastyrska', 'vul. Pleshanivska'] },
    { city: 'Lviv', county: 'Lviv Oblast', postcode: '790', streets: ['prsp. Svobody', 'vul. Halytskoho', 'vul. Sichovi Striltsiv', 'vul. Bandery', 'vul. Lychakivska', 'vul. Franka', 'vul. Kopernika', 'vul. Doroshenka', 'vul. Hrushevskoho', 'vul. Gorodotska', 'vul. Shevchenka', 'vul. Zelena', 'prsp. Chornovola', 'vul. Pid Dubom', 'vul. Sakharova', 'vul. Levandivska', 'vul. Kleparivska', 'vul. Zaliznychna', 'vul. Holoska', 'vul. Pluhova'] },
    { city: 'Zaporizhzhia', county: 'Zaporizhzhia Oblast', postcode: '690', streets: ['prsp. Sobornyi', 'vul. Shevchenka', 'vul. Metalurhiv', 'vul. Heroiv Stalinhrada', 'bul. Vinhranovskoho', 'vul. Komsomolska', 'vul. Chekistiv', 'vul. Ukrainska', 'vul. Hlinkova', 'vul. Pravdy', 'vul. Lisoova', 'prsp. Lenina', 'vul. Sichevykh Striltsiv', 'vul. Peremogy', 'vul. Haharina', 'vul. Akademika Makarova', 'vul. Pivdenna', 'vul. Dniprovske shousse', 'vul. Komunalna', 'vul. Volodarsky'] },
    { city: 'Vinnytsia', county: 'Vinnytsia Oblast', postcode: '210', streets: ['vul. Soborna', 'vul. Shevchenka', 'vul. Hrushevskoho', 'vul. Keletska', 'vul. Pyrohova', 'vul. Zamostianivska', 'vul. Teatralna', 'vul. Lesi Ukrainky', 'bul. Shevchenka', 'vul. Mykhaila Hrushevskogo', 'vul. Yuvileina', 'vul. Nemyrivske shousse', 'vul. Khmelnytske shousse', 'prsp. Kotsyubynskoho', 'vul. Tyraspolska', 'vul. Artema', 'vul. Zaozerna', 'vul. Verdikha', 'vul. Pavlivska', 'vul. Vasylaya Poryka'] },
    { city: 'Poltava', county: 'Poltava Oblast', postcode: '360', streets: ['vul. Soborna', 'prsp. Pervomayskyi', 'vul. Shevchenka', 'vul. Franka', 'vul. Pushkinska', 'vul. Kotlyarevskoho', 'vul. Hoholya', 'vul. Nezalezhnosti', 'vul. Zinkivska', 'prsp. Bielinska', 'vul. Komsomolska', 'vul. Monastyrska', 'vul. Lenina', 'vul. Heroiv Stalinhrada', 'vul. Leona Pohoriltsya', 'vul. Frunze', 'vul. Richkova', 'vul. Ostrografska', 'vul. Poltavska bitva', 'vul. Rayna'] },
    { city: 'Chernihiv', county: 'Chernihiv Oblast', postcode: '140', streets: ['vul. Miru', 'prsp. Lybidskyi', 'vul. Shevchenka', 'vul. Rokosovskogo', 'vul. Heroiv Stalinhrada', 'vul. Lenina', 'vul. Komsomolska', 'vul. Magistralna', 'vul. Vatutina', 'vul. Preobrazhenska', 'vul. Desnyanска', 'vul. Henerala Blyukhera', 'vul. Mishuryna', 'vul. Tykhonivska', 'vul. Shidna', 'vul. Pivnichna', 'vul. Studentska', 'vul. Vesnianka', 'vul. Dobrovolskoho', 'vul. Yakivlivska'] },
    { city: 'Sumy', county: 'Sumy Oblast', postcode: '400', streets: ['vul. Petra Ohlobli', 'vul. Kharytonivska', 'vul. Pryvokzalna', 'vul. Troitska', 'vul. Soborna', 'vul. Sanatorna', 'prsp. Shevchenka', 'vul. Metalurhiv', 'vul. Stepana Razina', 'vul. Heroiv Ukrainy', 'vul. Petropavlivska', 'vul. Lunacharskogo', 'vul. Kirova', 'vul. Druzhby', 'vul. Zhukovskoho', 'vul. Kalinina', 'vul. Nezalezhnosti', 'vul. Remennoho', 'vul. Romana Lazareva', 'vul. Koroleva'] },
    { city: 'Zhytomyr', county: 'Zhytomyr Oblast', postcode: '100', streets: ['vul. Velyka Berdychivska', 'vul. Mala Berdychivska', 'vul. Kyivska', 'vul. Mykhailivska', 'vul. Shevchenka', 'vul. Komunistychna', 'prsp. Miru', 'vul. Vyshneva', 'vul. Korolenka', 'vul. Borodiiuka', 'vul. Makarova', 'vul. Soborna', 'vul. Ivana Kocherhy', 'vul. Zhukova', 'vul. Luhova', 'vul. Novgorodska', 'vul. Zhukovskoho', 'vul. Dovzhenko', 'vul. Moskovska', 'vul. Zakhidna'] },
    { city: 'Kirovohrad', county: 'Kirovohrad Oblast', postcode: '250', streets: ['vul. Chmilenka', 'vul. Blahovishchenska', 'vul. Petra Doroshenka', 'prsp. Komunistychnyi', 'vul. Lenina', 'vul. Shevchenko', 'vul. Komsomolska', 'vul. Suvorova', 'vul. Krasna', 'vul. Karpat.', 'vul. Heroiv Maydanu', 'vul. Hetmana Sahaidachnoho', 'vul. Arkhitektora Pashchenka', 'vul. Akademika Korolia', 'vul. Mykoli Skovorody', 'vul. Peremohy', 'vul. Sobornosti', 'vul. Arsenycheva', 'vul. Shakhterskoho', 'vul. Dobrovalnoho'] },
    { city: 'Kherson', county: 'Kherson Oblast', postcode: '730', streets: ['prsp. Ushakova', 'vul. Suvorova', 'vul. Perekopka', 'vul. Moskovska', 'vul. Lenina', 'vul. Mira', 'vul. Kommunara', 'vul. Yantarna', 'vul. Pavlova', 'vul. Komsomolska', 'vul. Radyanska', 'vul. Tekstylna', 'vul. Komyshanska shousse', 'vul. Klenovyi gai', 'vul. Lybidska', 'vul. Transportna', 'vul. Odesska', 'vul. Slobids.', 'vul. Krymskoho', 'vul. Lva Tolstoho'] },
    { city: 'Ivano Frankivsk', county: 'Ivano Frankivsk Oblast', postcode: '760', streets: ['vul. Nezalezhnosti', 'vul. Bandery', 'vul. Halytska', 'vul. Shevchenka', 'vul. Ivana Franka', 'prsp. Shevchenka', 'vul. Konovaltsia', 'vul. Lepkalya', 'vul. Lesi Ukrainky', 'vul. Melnychuka', 'vul. Vasyliana Barvinskoho', 'vul. Symonenka', 'vul. Dnisterska', 'vul. Dovha', 'vul. Promyslova', 'vul. Prikarpatska', 'vul. Vyshnevska', 'vul. Parkova', 'vul. Sakharova', 'vul. Paryivska'] },
    { city: 'Ternopil', county: 'Ternopil Oblast', postcode: '460', streets: ['vul. Ruska', 'vul. Shevchenko', 'vul. Bandery', 'vul. Hnat Yura', 'prsp. Stepana Bandery', 'vul. Lesi Ukrainky', 'vul. Ivana Franka', 'vul. Korolka', 'vul. Zaliznychna', 'vul. Chaika', 'vul. Kozatska', 'vul. Peremohy', 'vul. Salamandry', 'vul. Shumylovicha', 'vul. Mykulynetska', 'vul. Lystopadova', 'vul. Obizna', 'vul. Zhovtneva', 'vul. Tarnovilska', 'vul. Dnistrovska'] },
    { city: 'Lutsk', county: 'Volyn Oblast', postcode: '430', streets: ['vul. Lesi Ukrainky', 'vul. Bohushevicha', 'vul. Shevchenko', 'prsp. Voli', 'vul. Bandery', 'vul. Kovalska', 'vul. Danyla Galitskoho', 'vul. Krakovska', 'vul. Ternopilska', 'vul. Shumska', 'vul. Zhukovskoho', 'vul. Sobornosti', 'vul. Karbysheva', 'vul. Chornovola', 'vul. Haydamak', 'vul. Levchuka', 'vul. Kyyivska shosse', 'vul. Dubnivskoho', 'vul. Holovna', 'vul. Kuprina'] },
    { city: 'Rivne', county: 'Rivne Oblast', postcode: '330', streets: ['vul. Soborna', 'vul. Shevchenka', 'vul. Symonenko', 'prsp. Myru', 'vul. Hайдamaka', 'vul. Bandery', 'vul. Borts.Antifashyst.', 'vul. Borodina', 'vul. Zamkova', 'vul. Bilorusska', 'vul. Korolenka', 'vul. Makarova', 'vul. Paliyeva', 'vul. Tynna', 'vul. Kyivska', 'vul. Hetmana Mazepy', 'vul. Kuprina', 'vul. Lazareva', 'vul. Bila', 'vul. Zelenaya'] },
    { city: 'Uzhhorod', county: 'Zakarpattia Oblast', postcode: '880', streets: ['pl. Teatralna', 'vul. Voloshyna', 'vul. Shevchenko', 'vul. Peremohy', 'vul. Korzo', 'vul. Grushevskogo', 'vul. Universytetska', 'vul. Rakhivska', 'vul. Kapitulna', 'vul. Zakarpatska', 'vul. Zaliznychna', 'vul. Soborna', 'vul. Kamyanska', 'vul. Tarasa Shevchenka', 'vul.Druzhby Narodiv', 'vul. Avgustivska', 'vul. Beregoviy massiv', 'vul. Podhardeiyska', 'vul. Makovetskoho', 'vul. Lukachovа'] },
    { city: 'Chernivtsi', county: 'Chernivtsi Oblast', postcode: '580', streets: ['vul. Holovna', 'vul. Ukraynska', 'vul. Hrushevskogo', 'pr. Nezalezhnosti', 'vul. Shevchenko', 'vul. Zankovetska', 'vul. Heroiv Maidanu', 'vul. Ruska', 'vul. Kalinina', 'vul. Fedkovycha', 'vul. Sahaidachnoho', 'vul. Pivdenna', 'vul. Prykarpatska', 'vul. Komarna', 'vul. Kobylianska', 'vul. Zolota Lypa', 'vul. Stusа', 'vul. Kobzarevhova', 'vul. Lesi Ukrainky', 'vul. Komunalna'] },
    { city: 'Mykolaiv', county: 'Mykolaiv Oblast', postcode: '540', streets: ['prsp. Tsentralnyi', 'vul. Admiralska', 'vul. Radyanska', 'vul. Artyleriiska', 'vul. Dekabristiv', 'vul. Prymorska', 'vul. Skodovska', 'vul. Shmidta', 'vul. Lenina', 'vul. Nikolska', 'vul. Miru', 'vul. Komsomolska', 'vul. Ordzhoni.', 'vul. Soborna', 'vul. Lymanska', 'vul. Krymskoho', 'vul. Industrialna', 'vul. Rybalska', 'vul. Chervonoarmiyska', 'vul. Mykolayivska'] }
];

function generateUaAddresses() {
    const regions = [];
    for (const cityData of UA_CITIES) {
        const addresses = [];
        const streets = cityData.streets;
        for (const street of streets) {
            const streetIdx = streets.indexOf(street);
            for (let h = 1; h <= 55; h++) {
                const postcodeBase = parseInt(cityData.postcode + '000') + (streetIdx * 5) + Math.floor(h / 20);
                const postcode = String(postcodeBase).slice(0, 5).padStart(5, '0');
                addresses.push({
                    street: `${street} ${h}`,
                    postcode
                });
            }
        }
        regions.push({
            county: cityData.county,
            city: cityData.city,
            addresses
        });
    }
    return regions;
}

UA_DATA.regions = generateUaAddresses();

const uaTotal = UA_DATA.regions.reduce((s, r) => s + r.addresses.length, 0);
console.log(`UA: ${uaTotal} адресов в ${UA_DATA.regions.length} регионах`);

// ============================================================
// ЗАПИСЬ ФАЙЛОВ
// ============================================================
const localesDir = path.resolve(__dirname, '..', 'data', 'locales');
fs.mkdirSync(localesDir, { recursive: true });

fs.writeFileSync(path.join(localesDir, 'RU.json'), JSON.stringify(RU_DATA, null, 2), 'utf-8');
console.log(`✅ RU.json записан: ${ruTotal} адресов`);

fs.writeFileSync(path.join(localesDir, 'UA.json'), JSON.stringify(UA_DATA, null, 2), 'utf-8');
console.log(`✅ UA.json записан: ${uaTotal} адресов`);

console.log('\n📊 Итого:');
console.log(`  RU: ${RU_DATA.maleNames.length} мужских имён, ${RU_DATA.femaleNames.length} женских`);
console.log(`      ${RU_DATA.maleLastNames.length} мужских фамилий, ${RU_DATA.femaleLastNames.length} женских`);
console.log(`      ${ruTotal} адресов в ${RU_DATA.regions.length} городах`);
console.log(`      ${RU_DATA.securityAnswers.length} ответов на секретный вопрос`);
console.log(`  UA: ${UA_DATA.maleNames.length} мужских имён, ${UA_DATA.femaleNames.length} женских`);
console.log(`      ${UA_DATA.maleLastNames.length} мужских фамилий, ${UA_DATA.femaleLastNames.length} женских`);
console.log(`      ${uaTotal} адресов в ${UA_DATA.regions.length} городах`);
console.log(`      ${UA_DATA.securityAnswers.length} ответов на секретный вопрос`);
