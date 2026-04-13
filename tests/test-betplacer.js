/**
 * test-betplacer.js — демо-тест без реальных ставок
 *
 * Запуск:
 *   node tests/test-betplacer.js [apiUrl]
 *
 * Что делает:
 * 1. Запрашивает суребеты с API (или использует демо JSON)
 * 2. Считает ставки для KilometrDyxa
 * 3. Открывает Chrome с профилем, переходит на зеркало
 * 4. Логинится (если нужно)
 * 5. Ищет купоны для первого суребета
 * 6. НЕ ставит (dry-run) — только скриншоты
 */
'use strict';

const { runBettingSession, fetchSurebets, calcStakes } = require('../src/betplacer');
const path = require('path');
const fs   = require('fs');

const CONFIG_PATH = path.resolve(__dirname, '..', 'config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));

const DRY_RUN    = process.argv.includes('--dry');
const API_URL    = process.argv.find(a => a.startsWith('http')) || config.betting?.apiBaseUrl || 'http://localhost:8891';
const LOGIN_ID   = 'KilometrDyxa';
const PASSWORD   = 'Bipolzrkatyt&232';
const BANKROLL   = 100;
const MIRROR     = 'https://www.thundercrest65.xyz/ru/compact/sports?a=A609039794&lang=en';
const PROFILE    = path.resolve(__dirname, '..', 'profiles', 'profile_bet_KilometrDyxa');

console.log('═'.repeat(60));
console.log('🧪 BetPlacer Demo Test');
console.log(`   API:     ${API_URL}`);
console.log(`   Account: ${LOGIN_ID}`);
console.log(`   Bankroll: ${BANKROLL} USDT`);
console.log(`   Dry-run: ${DRY_RUN}`);
console.log(`   Profile: ${PROFILE}`);
console.log('═'.repeat(60));

// ── Шаг 0: Попробуем стянуть суребеты с API ──
async function main() {
    let surebets = [];

    console.log(`\n📡 Шаг 1: Запрос суребетов с ${API_URL} ...`);
    try {
        surebets = await fetchSurebets(API_URL);
        console.log(`✅ Получено: ${surebets.length} суребетов`);
    } catch(e) {
        console.warn(`⚠️  API недоступен: ${e.message}`);
        console.log('📦 Используем демо-данные...\n');
        surebets = getDemoSurebets();
    }

    // ── Шаг 1: Фильтрация ──
    const profitable = surebets.filter(sb => {
        const prices = sb.prices || {};
        const sides = Object.keys(prices);
        if (sides.length < 2) return false;
        const invSum = sides.reduce((s, k) => s + 1 / prices[k], 0);
        return (1 / invSum - 1) * 100 > -5; // показываем даже убыточные для демо
    });

    console.log(`\n📊 Шаг 2: Расчёт ставок (банкролл ${BANKROLL} USDT)`);
    console.log('─'.repeat(60));

    profitable.slice(0, 5).forEach((sb, i) => {
        const { stakes, profitPct, totalStake, invSum } = calcStakes(sb.prices, BANKROLL, 1);
        const sides = Object.keys(sb.prices);
        console.log(`\n${i+1}. ${sb.match}`);
        console.log(`   Вид: ${sb.sport} | Тип: ${sb.betType} | Hdp: ${sb.handicap}`);
        console.log(`   Прибыль: ${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(2)}% | Маржа: ${(invSum*100).toFixed(2)}%`);
        console.log(`   Итого ставок: ${totalStake.toFixed(2)} USDT`);
        sides.forEach(s => {
            console.log(`   → ${s}: ${stakes[s].toFixed(2)} USDT @ ${sb.prices[s]} (потенциал: ${(stakes[s] * sb.prices[s]).toFixed(2)} USDT)`);
        });
    });

    // ── Шаг 2: Запускаем BetPlacer ──
    console.log('\n' + '═'.repeat(60));
    console.log(`🚀 Шаг 3: Запуск BetPlacer для ${LOGIN_ID}`);

    await runBettingSession({
        accountLoginId:   LOGIN_ID,
        accountPassword:  PASSWORD,
        accountMirror:    MIRROR,
        profileOverride:  PROFILE,
        apiBaseUrl:       API_URL,
        bankroll:         BANKROLL,
        minProfitPct:     -10, // демо показывает все
        dryRun:           DRY_RUN,
    });
}

function getDemoSurebets() {
    return [
        {
            eventId:    1626892236,
            sport:      'Basketball',
            league:     'Turkey - Super League Women',
            match:      'Emlak Konut SK vs Galatasaray',
            period:     '4',
            betType:    'HDP',
            handicap:   '0',
            profitPct:  2.59,
            prices:     { HOME: 2.23, AWAY: 1.9 },
            elapsed:    "1st Quarter - 1'",
            settleEstimate: 'End of Q4',
        },
        {
            eventId:    1626902189,
            sport:      'Soccer',
            league:     'Saudi Arabia MOS Cup',
            match:      'Al Nasr vs Al-Ittihad Jeddah',
            period:     '0',
            betType:    'MONEYLINE',
            handicap:   '0',
            profitPct:  1.12,
            prices:     { HOME: 2.1, DRAW: 3.4, AWAY: 3.8 },
            elapsed:    "35'",
            settleEstimate: 'Full Time',
        },
    ];
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
