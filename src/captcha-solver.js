'use strict';

const https = require('https');
const { SocksProxyAgent } = require('socks-proxy-agent');
const logger = require('./logger');

/**
 * POST запрос к OpenRouter API (OpenAI-совместимый формат)
 * https://openrouter.ai/docs#requests
 */
function openRouterPost(apiKey, model, messages, proxyUrl) {
    return new Promise((resolve, reject) => {
        const body = {
            model,
            messages,
            temperature: 0.0,
            max_tokens: 20
        };
        const bodyStr = JSON.stringify(body);

        const options = {
            hostname: 'openrouter.ai',
            path: '/api/v1/chat/completions',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://autoregpinn.local',
                'X-Title': 'AutoRegPinn CAPTCHA Solver',
                'Content-Length': Buffer.byteLength(bodyStr),
            },
        };

        if (proxyUrl) {
            options.agent = new SocksProxyAgent(proxyUrl);
        }

        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error(`Parse error: ${data.substring(0, 500)}`)); }
            });
        });

        req.on('error', reject);
        req.setTimeout(45000, () => req.destroy(new Error('OpenRouter timeout 45s')));
        req.write(bodyStr);
        req.end();
    });
}

/**
 * Обратная совместимость: POST запрос к Gemini API напрямую (через SOCKS5 прокси)
 * Используется если в config provider === 'gemini'
 */
function geminiPost(apiKey, model, payload, proxyUrl, apiVer = 'v1') {
    return new Promise((resolve, reject) => {
        const bodyStr = JSON.stringify(payload);
        const path = `/${apiVer}/models/${model}:generateContent?key=${apiKey}`;

        const options = {
            hostname: 'generativelanguage.googleapis.com',
            path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr),
            },
        };

        if (proxyUrl) {
            options.agent = new SocksProxyAgent(proxyUrl);
        }

        const req = https.request(options, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error(`Parse error: ${data.substring(0, 300)}`)); }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => req.destroy(new Error('Gemini timeout 30s')));
        req.write(bodyStr);
        req.end();
    });
}

const CAPTCHA_PROMPT = `You are an expert optical character recognition (OCR) AI specializing in solving complex CAPTCHAs. 
Look at the attached CAPTCHA image carefully. It contains EXACTLY 4 digits.
The image may contain visual noise, background patterns, intersecting colored lines, or text distortions designed to confuse automated systems. 
Your task is to mentally filter out all the noise and background lines, focusing ONLY on the primary shapes of the numbers.
Extract exactly the 4 digits shown.
Reply strictly with the 4 digits only. Do not add any text, explanations, spaces, or markdown formatting!`;

/**
 * Решение CAPTCHA через OpenRouter API (OpenAI vision формат)
 */
async function solveViaOpenRouter(imageBase64, apiKey, model, proxyUrl) {
    // На OpenRouter модель gemini-2.5-flash → google/gemini-2.5-flash
    let orModel = model;
    if (!orModel.includes('/')) {
        orModel = `google/${orModel}`;
    }

    logger.info(`OpenRouter: модель ${orModel}`);

    const messages = [{
        role: 'user',
        content: [
            { type: 'text', text: CAPTCHA_PROMPT },
            {
                type: 'image_url',
                image_url: {
                    url: `data:image/png;base64,${imageBase64}`
                }
            }
        ]
    }];

    const response = await openRouterPost(apiKey, orModel, messages, proxyUrl);

    // Обработка ошибок OpenRouter
    if (response.error) {
        const errMsg = response.error.message || JSON.stringify(response.error);
        throw new Error(`OpenRouter error: ${errMsg}`);
    }

    const text = response.choices?.[0]?.message?.content?.trim();
    if (!text) {
        const reason = response.choices?.[0]?.finish_reason || 'unknown';
        throw new Error(`OpenRouter пустой ответ. finish_reason=${reason}, raw=${JSON.stringify(response).substring(0, 300)}`);
    }

    return text;
}

/**
 * Решение CAPTCHA через Gemini API напрямую
 */
async function solveViaGemini(imageBase64, apiKey, model, proxyUrl) {
    const payload = {
        contents: [{
            parts: [
                { text: CAPTCHA_PROMPT },
                { inline_data: { mime_type: 'image/png', data: imageBase64 } }
            ]
        }],
        generationConfig: {
            temperature: 0.0,
            topK: 1,
            topP: 0.1
        }
    };

    const response = await geminiPost(apiKey, model, payload, proxyUrl, 'v1');

    if (response.error) {
        throw new Error(`Gemini API error: ${response.error.message || JSON.stringify(response.error)}`);
    }

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
        const reason = response.candidates?.[0]?.finishReason || 'unknown';
        const feedback = response.promptFeedback?.blockReason || '';
        throw new Error(`Gemini пустой ответ. finishReason=${reason}, blockReason=${feedback}`);
    }

    return text;
}

/**
 * Решает CAPTCHA через AI Vision (OpenRouter или Gemini).
 * Автоматически определяет провайдера по формату API key:
 * - sk-or-* → OpenRouter
 * - AIza* → Gemini прямой
 * - config.gemini.provider === 'openrouter' → OpenRouter
 * 
 * @param {Page} page - puppeteer page
 * @param {string} apiKey - API key
 * @param {string} proxyUrl - SOCKS5 proxy URL (для Gemini; OpenRouter обычно без прокси)
 * @param {string} model - модель
 * @param {string} provider - 'openrouter' | 'gemini' | auto-detect
 * @returns {Promise<string>} текст капчи (цифры)
 */
async function solveCaptcha(page, apiKey, proxyUrl, model = 'gemini-2.5-flash', provider = null) {
    if (!apiKey) throw new Error('API key не задан в config.json');

    // Автоопределение провайдера по формату ключа
    if (!provider) {
        if (apiKey.startsWith('sk-or-')) {
            provider = 'openrouter';
        } else if (apiKey.startsWith('AIza')) {
            provider = 'gemini';
        } else {
            provider = 'openrouter'; // По умолчанию OpenRouter
        }
    }

    // Закрываем любые открытые попапы (datepicker и т.п.) перед скриншотом
    await page.keyboard.press('Escape').catch(() => { });
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); }).catch(() => { });
    await new Promise(r => setTimeout(r, 500));

    // Ищем контейнер капчи — div/span, содержащий img
    const captchaEl = await page.$('.load-captcha img, .load-captcha canvas, .load-captcha');
    if (!captchaEl) throw new Error('Элемент капчи .load-captcha не найден на странице');

    // Ждём пока img внутри .load-captcha реально загрузится (naturalWidth > 0 или src != "")
    await page.waitForFunction(() => {
        const container = document.querySelector('.load-captcha');
        if (!container) return false;
        const img = container.querySelector('img');
        if (img) {
            return img.naturalWidth > 0 && img.src && img.src !== '' && !img.src.endsWith('#');
        }
        // canvas — проверяем что элемент виден
        const canvas = container.querySelector('canvas');
        if (canvas) return canvas.width > 0 && canvas.height > 0;
        return false;
    }, { timeout: 10000 }).catch(() => {
        logger.warn('Капча: img.naturalWidth=0 за 10сек — всё равно пробуем скриншот');
    });

    await new Promise(r => setTimeout(r, 500));

    // === Попытка 1: Нарисовать img на canvas и взять toDataURL ===
    let imageBase64 = await page.evaluate(() => {
        const container = document.querySelector('.load-captcha');
        if (!container) return null;

        const img = container.querySelector('img');
        const canvasEl = container.querySelector('canvas');

        // Если уже canvas — берём напрямую
        if (canvasEl && canvasEl.width > 10) {
            try { return canvasEl.toDataURL('image/png').split(',')[1]; } catch (e) { }
        }

        // Если img — рисуем на временный canvas
        if (img && img.complete && img.naturalWidth > 0) {
            try {
                const c = document.createElement('canvas');
                c.width = img.naturalWidth;
                c.height = img.naturalHeight;
                c.getContext('2d').drawImage(img, 0, 0);
                return c.toDataURL('image/png').split(',')[1];
            } catch (e) { }

            // data:image напрямую
            if (img.src && img.src.startsWith('data:image')) {
                return img.src.split(',')[1];
            }
        }

        return null;
    }).catch(() => null);

    if (imageBase64 && imageBase64.length > 1500) {
        logger.info(`Капча получена через canvas.drawImage: ${imageBase64.length} байт`);
    } else {
        // === Попытка 2: page.screenshot с clip ===
        imageBase64 = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
            const bbox = await captchaEl.boundingBox().catch(() => null);
            if (bbox && bbox.width > 10 && bbox.height > 10) {
                const shot = await page.screenshot({
                    encoding: 'base64',
                    clip: {
                        x: Math.max(0, bbox.x - 4),
                        y: Math.max(0, bbox.y - 4),
                        width: bbox.width + 8,
                        height: bbox.height + 8
                    }
                }).catch(() => null);
                if (shot && shot.length > 1500) {
                    imageBase64 = shot;
                    break;
                }
                logger.warn(`Капча: clip-скриншот ${shot ? shot.length : 0} байт, попытка ${attempt}/3`);
            } else {
                logger.warn(`Капча: нет bbox, попытка ${attempt}/3`);
            }
            await new Promise(r => setTimeout(r, 1000));
        }

        // === Диагностика ===
        if (!imageBase64 || imageBase64.length < 1500) {
            try {
                const fs = require('fs'), path = require('path');
                const dir = path.resolve('./screenshots');
                fs.mkdirSync(dir, { recursive: true });
                const fullshot = await page.screenshot({ encoding: 'base64', fullPage: true }).catch(() => null);
                if (fullshot) {
                    const fp = path.join(dir, `fullpage_captcha_${Date.now()}.png`);
                    fs.writeFileSync(fp, Buffer.from(fullshot, 'base64'));
                    logger.warn(`[ДИАГНОСТИКА] Full-page: ${fp}`);
                }
            } catch (e) { logger.warn(`[ДИАГНОСТИКА] err: ${e.message}`); }
            throw new Error('Капча не захвачена (< 1500 байт)');
        }
    }

    const box = await captchaEl.boundingBox().catch(() => null);
    logger.info(`Скриншот капчи: ${imageBase64.length} байт (${box ? Math.round(box.width) + 'x' + Math.round(box.height) + 'px' : '?'})`);

    // Сохраняем на диск для отладки
    try {
        const fs = require('fs'); const path = require('path');
        const dir = path.resolve('./screenshots');
        fs.mkdirSync(dir, { recursive: true });
        const fpath = path.join(dir, `captcha_${Date.now()}.png`);
        fs.writeFileSync(fpath, Buffer.from(imageBase64, 'base64'));
        logger.info(`Скриншот CAPTCHA: ${fpath}`);
    } catch (_) { }

    logger.info(`Провайдер: ${provider} | Модель: ${model}`);
    if (proxyUrl && provider === 'gemini') {
        logger.info(`Запрос через прокси: ${proxyUrl.replace(/:([^@]+)@/, ':***@')}`);
    }

    // === Вызов AI ===
    let rawText;
    if (provider === 'openrouter') {
        // OpenRouter НЕ нуждается в прокси — прямой доступ
        rawText = await solveViaOpenRouter(imageBase64, apiKey, model, null);
    } else {
        rawText = await solveViaGemini(imageBase64, apiKey, model, proxyUrl);
    }

    const cleaned = rawText.replace(/\D/g, '');
    logger.info(`AI ответил: "${rawText}" → цифры: "${cleaned}" (${cleaned.length} шт)`);

    if (cleaned.length < 3 || cleaned.length > 5) {
        throw new Error(`Неверное число цифр CAPTCHA: ${cleaned.length} (raw: "${rawText}")`);
    }
    if (cleaned.length !== 4) {
        logger.warn(`Получено ${cleaned.length} цифр вместо 4: "${cleaned}" — используем`);
    }

    // Проверка стабильности
    const imageBase64_after = await captchaEl.screenshot({ encoding: 'base64' }).catch(() => null);
    if (imageBase64_after) {
        const len1 = imageBase64.length;
        const len2 = imageBase64_after.length;
        const diffPercent = Math.abs(len1 - len2) / len1;
        if (diffPercent > 0.30) {
            logger.warn(`Капча обновилась за время запроса (diff: ${(diffPercent * 100).toFixed(1)}%)`);
        }
        logger.info(`CAPTCHA распознана: "${cleaned}" (diff: ${(diffPercent * 100).toFixed(1)}%)`);
    } else {
        logger.info(`CAPTCHA распознана: "${cleaned}"`);
    }
    return cleaned;
}

module.exports = { solveCaptcha };
