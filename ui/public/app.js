const API_BASE = 'http://127.0.0.1:35890';

document.addEventListener('DOMContentLoaded', () => {
    const term = document.getElementById('terminal');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const exitBtn = document.getElementById('exitBtn');
    const clearLogsBtn = document.getElementById('clearLogsBtn');
    const refreshAccountsBtn = document.getElementById('refreshAccountsBtn');
    const accountsBody = document.getElementById('accountsBody');

    const statusText = document.getElementById('statusText');
    const statusDot = document.getElementById('statusDot');

    const currencySelect = document.getElementById('currencySelect');
    const mirrorSelect = document.getElementById('mirrorSelect');
    const regCountInput = document.getElementById('regCountInput');
    const threadCountInput = document.getElementById('threadCountInput');
    const useTestEmailCheck = document.getElementById('useTestEmailCheck');
    const keepOpenCheck = document.getElementById('keepOpenCheck');
    const keepOpenSecondsGroup = document.getElementById('keepOpenSecondsGroup');
    const keepOpenSecondsInput = document.getElementById('keepOpenSecondsInput');

    // WebSockets
    const ws = new WebSocket(`ws://127.0.0.1:35890`);
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'log') {
            appendLog(data.message);
        } else if (data.type === 'done') {
            setIdle();
            loadAccounts();
        }
    };

    function appendLog(msg) {
        const cleanMsg = msg.replace(/\x1B\[\d+m/g, '').trim();
        if (!cleanMsg) return;
        const div = document.createElement('div');
        div.className = 'log-line';
        if (cleanMsg.includes('ошибка') || cleanMsg.includes('error') || cleanMsg.includes('❌')) {
            div.style.color = 'var(--error)';
        } else if (cleanMsg.includes('успешн') || cleanMsg.includes('✅')) {
            div.style.color = 'var(--success)';
        }
        div.textContent = cleanMsg;
        term.appendChild(div);
        term.scrollTop = term.scrollHeight;
    }

    function setIdle() {
        startBtn.disabled = false;
        statusText.textContent = 'Ожидание...';
        statusDot.className = 'dot idle';
    }

    function setRunning() {
        startBtn.disabled = true;
        statusText.textContent = 'В работе...';
        statusDot.className = 'dot pulse';
    }

    // API calls to init dropdowns and data
    async function initData() {
        loadAccounts();
        loadMirrors();
        loadEmails();
        loadProxy();
        loadBlacklist();
        loadGemini();
    }

    async function loadAccounts() {
        try {
            const res = await fetch(`${API_BASE}/api/accounts`);
            const accounts = await res.json();
            accountsBody.innerHTML = '';
            if (!accounts.length) {
                accountsBody.innerHTML = '<tr><td colspan="13" class="empty-state">Нет сохраненных аккаунтов</td></tr>';
                return;
            }

            accounts.reverse().forEach(acc => {
                let regTimeStr = '-';
                if (acc.registeredAt) {
                    const d = new Date(acc.registeredAt);
                    regTimeStr = d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                }

                // Deposit status display
                let depositStr = '-';
                let depositColor = 'var(--text-dim)';
                if (acc.depositStatus === 'initiated') {
                    depositStr = `✅ ${acc.depositAmount || '?'} USDT`;
                    depositColor = 'var(--success)';
                } else if (acc.depositStatus === 'failed' || acc.depositStatus === 'error') {
                    depositStr = `❌ ${(acc.depositError || '').substring(0, 30)}`;
                    depositColor = 'var(--error)';
                }

                const statusColors = {
                    'registered': 'var(--success)',
                    'error': 'var(--error)',
                    'pending': '#f59e0b'
                };
                const statusColor = statusColors[acc.status] || 'var(--text-dim)';

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${acc.id}</td>
                    <td>${acc.firstName || ''} ${acc.lastName || ''}</td>
                    <td>${acc.loginId || '-'}</td>
                    <td style="font-size:11px;">${acc.email || '-'}</td>
                    <td>${acc.password || '-'}</td>
                    <td>${acc.dob || '-'}</td>
                    <td style="font-size:11px;">${regTimeStr}</td>
                    <td style="font-size:11px;">${acc.regIp || '-'}</td>
                    <td>${acc.attempts || '-'}</td>
                    <td style="color:${statusColor}; font-weight:bold;">${acc.status || '-'}</td>
                    <td>
                        <select class="crm-select" data-id="${acc.id}" style="width: 140px; padding: 4px; background: rgba(0,0,0,0.2); border: 1px solid var(--panel-border); color: white; border-radius: 4px; font-size: 11px;">
                            <option value="not_registered" ${!acc.crmStatus || acc.crmStatus === 'not_registered' ? 'selected' : ''}>не зареган</option>
                            <option value="registered_no_dep" ${acc.crmStatus === 'registered_no_dep' ? 'selected' : ''}>зареган / не депнут</option>
                            <option value="test" ${acc.crmStatus === 'test' ? 'selected' : ''}>тестовый</option>
                            <option value="dep_no_withdraw" ${acc.crmStatus === 'dep_no_withdraw' ? 'selected' : ''}>депнут / не выведен</option>
                            <option value="withdrawn" ${acc.crmStatus === 'withdrawn' ? 'selected' : ''}>выведен</option>
                            <option value="blocked" ${acc.crmStatus === 'blocked' ? 'selected' : ''}>заблокирован</option>
                        </select>
                    </td>
                    <td style="color:${depositColor}; font-size:11px; font-weight:bold;">${depositStr}</td>
                    <td>
                        <button class="btn-icon info-btn" title="Подробнее" style="font-size:16px;">📋</button>
                    </td>
                `;
                // CRM select change handler
                const sel = tr.querySelector('.crm-select');
                if (sel) {
                    sel.addEventListener('change', async (e) => {
                        e.stopPropagation();
                        await fetch(`${API_BASE}/api/accounts/${acc.id}/crm`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ crmStatus: e.target.value })
                        });
                    });
                }
                // Info button
                const infoBtn = tr.querySelector('.info-btn');
                if (infoBtn) {
                    infoBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        openProfileModal(acc);
                    });
                }
                // Row click also opens modal
                tr.style.cursor = 'pointer';
                tr.addEventListener('click', (e) => {
                    if (!e.target.closest('select') && !e.target.closest('button')) {
                        openProfileModal(acc);
                    }
                });

                accountsBody.appendChild(tr);
            });
        } catch (e) {
            console.error('Failed to load accounts', e);
        }
    }

    async function loadMirrors() {
        try {
            const res = await fetch(`${API_BASE}/api/mirrors`);
            const m = await res.json();
            mirrorSelect.innerHTML = m.map(x => `<option value="${x}">${x}</option>`).join('');
        } catch (e) { }
    }

    async function loadEmails() {
        try {
            const res = await fetch(`${API_BASE}/api/emails`);
            const data = await res.json();
            const el = document.getElementById('emailCountDisplay');
            if (el) el.textContent = `Доступно: ${data.available}`;
        } catch (e) { }
    }

    async function loadBlacklist() {
        try {
            const res = await fetch(`${API_BASE}/api/blacklist/get`);
            const data = await res.json();
            const el = document.getElementById('blacklistStats');
            if (el) el.textContent = `В списке: ${data.blacklist.length} адресов`;
        } catch (e) { }
    }

    async function loadProxy() {
        try {
            // Получаем текущую выбранную локаль
            const localeSel = document.getElementById('localeSelect');
            const locale = localeSel ? localeSel.value : null;

            // Обновляем метку в модалке
            const localeLabel = document.getElementById('proxyLocaleLabel');
            if (localeLabel) localeLabel.textContent = locale ? `${locale}` : 'Глобальные';

            const url = locale
                ? `${API_BASE}/api/proxy/config?locale=${locale}`
                : `${API_BASE}/api/proxy/config`;
            const res = await fetch(url);
            const data = await res.json();
            const el = document.getElementById('proxyActiveCount');
            if (el) el.textContent = (data.count !== undefined ? data.count : (data.list || []).length);
            const bs = document.getElementById('proxyBaseString');
            const sp = document.getElementById('proxyStartPort');
            const ep = document.getElementById('proxyEndPort');
            if (bs) bs.value = data.baseString || '';
            if (sp) sp.value = data.startPort || '';
            if (ep) ep.value = data.endPort || '';
        } catch (e) { }
    }

    async function loadGemini() {
        try {
            const res = await fetch(`${API_BASE}/api/gemini/config`);
            const data = await res.json();
            const ak = document.getElementById('geminiApiKey');
            const gm = document.getElementById('geminiModel');
            const gp = document.getElementById('geminiProxy');
            if (ak) ak.value = data.apiKey || '';
            if (gm) gm.value = data.model || 'gemini-2.5-flash';
            if (gp) gp.value = data.proxy || '';
        } catch (e) { }
    }

    // Modal helpers
    function setupModal(btnId, modalId, closeId) {
        const btn = document.getElementById(btnId);
        const modal = document.getElementById(modalId);
        const close = document.getElementById(closeId);
        if (btn && modal) {
            btn.addEventListener('click', () => modal.classList.add('active'));
            if (close) close.addEventListener('click', () => modal.classList.remove('active'));
            modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('active'); });
        }
    }

    setupModal('addMirrorBtn', 'mirrorModal', 'closeMirrorModal');
    setupModal('loadEmailsBtn', 'emailsModal', 'closeEmailsModal');
    setupModal('blacklistBtn', 'blacklistModal', 'closeBlacklistModal');
    setupModal('geminiSettingsBtn', 'geminiModal', 'closeGeminiModal');

    // Кнопка прокси — обновляем данные при каждом открытии, берём текущую локаль
    const configProxyBtn = document.getElementById('configProxyBtn');
    const proxyModal = document.getElementById('proxyModal');
    const closeProxyModal = document.getElementById('closeProxyModal');
    if (configProxyBtn && proxyModal) {
        configProxyBtn.addEventListener('click', async () => {
            await loadProxy(); // обновляем данные под текущую локаль из dropdown
            proxyModal.classList.add('active');
        });
        if (closeProxyModal) closeProxyModal.addEventListener('click', () => proxyModal.classList.remove('active'));
        proxyModal.addEventListener('click', e => { if (e.target === proxyModal) proxyModal.classList.remove('active'); });
    }

    // Custom Close for Profile Modal
    const closeModalBtn = document.getElementById('closeModalBtn');
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            document.getElementById('profileModal').classList.remove('active');
        });
    }

    // Affiliate and keepOpen checks removed

    // Deposit settings toggle
    const depositEnabledCheck = document.getElementById('depositEnabledCheck');
    const depositSettingsGroup = document.getElementById('depositSettingsGroup');
    if (depositEnabledCheck && depositSettingsGroup) {
        depositEnabledCheck.addEventListener('change', (e) => {
            depositSettingsGroup.style.display = e.target.checked ? 'block' : 'none';
            const amount = parseInt(document.getElementById('depositAmountInput')?.value) || 20;
            fetch(`${API_BASE}/api/deposit/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled: e.target.checked, amount })
            }).catch(() => {});
        });
    }

    // Save deposit amount on change
    const depositAmountInput = document.getElementById('depositAmountInput');
    if (depositAmountInput) {
        depositAmountInput.addEventListener('change', () => {
            const enabled = depositEnabledCheck?.checked ?? true;
            const amount = parseInt(depositAmountInput.value) || 20;
            fetch(`${API_BASE}/api/deposit/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled, amount })
            }).catch(() => {});
        });
    }

    // Save buttons
    document.getElementById('saveMirrorBtn').addEventListener('click', async () => {
        const url = document.getElementById('newMirrorUrl').value;
        if (url) {
            await fetch(`${API_BASE}/api/mirrors/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
            document.getElementById('mirrorModal').classList.remove('active');
            loadMirrors();
        }
    });

    document.getElementById('delMirrorBtn').addEventListener('click', async () => {
        const url = mirrorSelect.value;
        if (!url) return;
        if (!confirm(`Удалить зеркало?\n${url}`)) return;
        await fetch(`${API_BASE}/api/mirrors/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
        loadMirrors();
    });

    document.getElementById('saveEmailsBtn').addEventListener('click', async () => {
        const text = document.getElementById('emailsTextarea').value;
        if (text) {
            await fetch(`${API_BASE}/api/emails/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ names: text.split('\n') }) });
            document.getElementById('emailsModal').classList.remove('active');
            loadEmails();
        }
    });

    document.getElementById('saveBlacklistBtn').addEventListener('click', async () => {
        const text = document.getElementById('blacklistAddTextarea').value;
        if (text) {
            await fetch(`${API_BASE}/api/blacklist/add`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emails: text.split('\n') }) });
            loadBlacklist();
        }
    });

    document.getElementById('saveProxyBtn').addEventListener('click', async () => {
        const b = document.getElementById('proxyBaseString').value.trim();
        const s = parseInt(document.getElementById('proxyStartPort').value);
        const e = parseInt(document.getElementById('proxyEndPort').value);
        const localeSel = document.getElementById('localeSelect');
        const locale = localeSel ? localeSel.value : null;
        if (!b) { alert('Укажи базовую строку прокси'); return; }
        if (isNaN(s) || isNaN(e) || s > e) { alert('Укажи корректный диапазон портов'); return; }
        const res = await fetch(`${API_BASE}/api/proxy/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseString: b, startPort: s, endPort: e, locale })
        });
        const data = await res.json();
        if (data.error) { alert('Ошибка: ' + data.error); return; }
        document.getElementById('proxyModal').classList.remove('active');
        alert(`✅ Сохранено ${data.count} прокси для ${locale || 'глобально'} (порты ${s}–${e})`);
        loadProxy();
    });

    document.getElementById('saveGeminiBtn').addEventListener('click', async () => {
        const a = document.getElementById('geminiApiKey').value;
        const m = document.getElementById('geminiModel').value;
        const p = document.getElementById('geminiProxy').value;
        await fetch(`${API_BASE}/api/gemini/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: a, model: m, proxy: p }) });
        document.getElementById('geminiModal').classList.remove('active');
    });

    // ── Кошельки ──────────────────────────────────────────────
    const walletsTbody = document.getElementById('walletsTbody');
    const refreshWalletsBtn = document.getElementById('refreshWalletsBtn');
    const refreshWalletsBalancesBtn = document.getElementById('refreshWalletsBalancesBtn');
    const createWalletBtn = document.getElementById('createWalletBtn');

    async function loadWallets(refreshBalances = false) {
        walletsTbody.innerHTML = `<tr><td colspan="7" style="text-align:center; opacity:.6;">${refreshBalances ? 'Читаем балансы on-chain, подождите...' : 'Загрузка...'}</td></tr>`;
        try {
            const resp = await fetch(`${API_BASE}/api/wallets${refreshBalances ? '?refresh=1' : ''}`);
            const data = await resp.json();
            const wallets = data.wallets || [];
            if (!wallets.length) {
                walletsTbody.innerHTML = `<tr><td colspan="7" style="text-align:center; opacity:.6;">Нет кошельков. Создайте новый.</td></tr>`;
                return;
            }
            walletsTbody.innerHTML = wallets.map(w => {
                const used = w.usedForDeposit ? '✅' : '—';
                const onchain = w.onchainBalance === null ? '—' : (String(w.onchainBalance).startsWith('error') ? `<span style="color:#f87171;">err</span>` : w.onchainBalance);
                const tx = w.depositTxHash ? `<a href="https://etherscan.io/tx/${w.depositTxHash}" target="_blank" style="color:#60a5fa;">${w.depositTxHash.slice(0,10)}...</a>` : '—';
                const safeShort = `${w.safeAddress.slice(0,6)}...${w.safeAddress.slice(-4)}`;
                const eoaShort = w.eoaAddress ? `${w.eoaAddress.slice(0,6)}...${w.eoaAddress.slice(-4)}` : '—';
                return `<tr>
                    <td>${w.name || '—'}</td>
                    <td title="${w.safeAddress}"><code>${safeShort}</code> <button class="btn-icon" data-copy="${w.safeAddress}" title="Копировать адрес">📋</button></td>
                    <td>${w.balance}</td>
                    <td>${onchain}</td>
                    <td>${used}</td>
                    <td>${tx}</td>
                    <td><button class="btn-icon" data-del="${w.safeAddress}" style="color:#f87171;">🗑</button></td>
                </tr>`;
            }).join('');

            walletsTbody.querySelectorAll('[data-copy]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const addr = btn.getAttribute('data-copy');
                    try {
                        await navigator.clipboard.writeText(addr);
                        const prev = btn.textContent; btn.textContent = '✅';
                        setTimeout(() => { btn.textContent = prev; }, 900);
                    } catch {
                        prompt('Скопируйте адрес вручную:', addr);
                    }
                });
            });

            walletsTbody.querySelectorAll('[data-del]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const safeAddress = btn.getAttribute('data-del');
                    if (!confirm(`Удалить кошелёк ${safeAddress}?`)) return;
                    const r = await fetch(`${API_BASE}/api/wallets/delete`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ safeAddress })
                    });
                    const j = await r.json();
                    if (j.success) loadWallets();
                    else alert('Ошибка: ' + (j.error || 'unknown'));
                });
            });
        } catch (e) {
            walletsTbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#f87171;">Ошибка: ${e.message}</td></tr>`;
        }
    }

    if (refreshWalletsBtn) refreshWalletsBtn.addEventListener('click', () => loadWallets(false));
    if (refreshWalletsBalancesBtn) refreshWalletsBalancesBtn.addEventListener('click', () => loadWallets(true));
    if (createWalletBtn) createWalletBtn.addEventListener('click', async () => {
        const name = prompt('Название кошелька:', `wallet_${Date.now()}`);
        if (!name) return;
        createWalletBtn.disabled = true;
        createWalletBtn.textContent = 'Создаём...';
        try {
            const r = await fetch(`${API_BASE}/api/wallets/create`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const j = await r.json();
            if (j.success) {
                alert(`Создан: ${j.name}\nSafe: ${j.safeAddress}\nEOA: ${j.eoaAddress}\n\nПополни Safe-адрес USDT на ETH mainnet, затем жми «Балансы on-chain».`);
                loadWallets();
            } else {
                alert('Ошибка: ' + (j.error || 'unknown'));
            }
        } catch (e) {
            alert('Ошибка: ' + e.message);
        } finally {
            createWalletBtn.disabled = false;
            createWalletBtn.textContent = '+ Новый кошелёк';
        }
    });

    // Start / Stop / Exit / Clear
    clearLogsBtn.addEventListener('click', () => term.innerHTML = '');
    refreshAccountsBtn.addEventListener('click', loadAccounts);
    exitBtn.addEventListener('click', async () => {
        if (!confirm('Точно закрыть сервер регистрации?')) return;
        try {
            await fetch(`${API_BASE}/api/exit`, { method: 'POST' });
            startBtn.disabled = true;
        } catch (e) { }
        window.close();
    });
    stopBtn.addEventListener('click', () => fetch(`${API_BASE}/api/stop`, { method: 'POST' }));

    // Removed affiliate scanning API endpoints

    startBtn.addEventListener('click', async () => {
        term.innerHTML = '';
        appendLog('--- НОВАЯ СЕССИЯ ОРБИТРАЖА ---');
        setRunning();
        
        const targetForks = parseInt(document.getElementById('targetForksInput')?.value) || 1;
        const minProfit = parseFloat(document.getElementById('minProfitInput')?.value) || 0;
        const settlementCheckIntervalSec = parseInt(document.getElementById('settlementCheckIntervalInput')?.value) || 60;

        try {
            const res = await fetch(`${API_BASE}/api/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    currency: currencySelect.value,
                    mirrorUrl: mirrorSelect.value,
                    regCount: parseInt(regCountInput.value) || 1,
                    threadCount: parseInt(threadCountInput.value) || 1,
                    useTestEmail: useTestEmailCheck?.checked || true,
                    keepOpen: document.getElementById('keepOpenCheck')?.checked || false,
                    keepSeconds: parseInt(document.getElementById('keepOpenSecondsInput')?.value) || 600,
                    locale: (document.getElementById('localeSelect') || {}).value || 'RU',
                    depositEnabled: document.getElementById('depositEnabledCheck')?.checked ?? true,
                    depositAmount: parseInt(document.getElementById('depositAmountInput')?.value) || 20,
                    targetForks,
                    minProfit,
                    settlementCheckIntervalSec
                })
            });
            const data = await res.json();
            if (data.error) {
                appendLog(`Ошибка старта: ${data.error}`);
                setIdle();
            }
        } catch (e) {
            appendLog(`Сетевая ошибка: ${e.message}`);
            setIdle();
        }
    });

    // ===== Модальное окно профиля =====
    function openProfileModal(acc) {
        document.getElementById('modalProfileId').textContent = '#' + acc.id;

        let regTimeStr = '-';
        if (acc.registeredAt) {
            const d = new Date(acc.registeredAt);
            regTimeStr = d.toLocaleString('ru-RU');
        }

        const fields = [
            ['ID', acc.id],
            ['Имя', acc.firstName],
            ['Фамилия', acc.lastName],
            ['Логин', acc.loginId],
            ['Пароль', acc.password],
            ['Email', acc.email],
            ['Телефон', acc.phone || acc.contactNum],
            ['Дата рождения', acc.dob],
            ['Пол', acc.gender],
            ['Валюта', acc.currency],
            ['Страна', acc.country],
            ['Область', acc.county],
            ['Город', acc.city],
            ['Адрес', acc.address],
            ['Индекс', acc.postcode],
            ['Секретный вопрос', acc.securityQuestion],
            ['Ответ', acc.securityAnswer],
            ['Зеркало', acc.mirrorUsed],
            ['IP регистрации', acc.regIp],
            ['Прокси', acc.proxy],
            ['Статус', acc.status],
            ['Попыток', acc.attempts],
            ['Ошибка', acc.error],
            ['Дата регистрации', regTimeStr],
            ['Депозит', acc.depositStatus ? `${acc.depositStatus} (${acc.depositAmount || '?'} USDT)` : '-'],
            ['Дата депозита', acc.depositAt || '-'],
            ['Ошибка депозита', acc.depositError || ''],
        ];

        let html = '<div style="display:grid; grid-template-columns: 160px 1fr; gap: 6px 12px; font-size: 13px;">';
        fields.forEach(([label, val]) => {
            if (val !== undefined && val !== null && val !== '') {
                html += `<div style="color:var(--text-dim);">${label}:</div>`;
                html += `<div style="color:white; word-break:break-all;">${val}</div>`;
            }
        });
        html += '</div>';

        document.getElementById('modalProfileData').innerHTML = html;
        document.getElementById('profileModal').classList.add('active');

        document.getElementById('openBrowserBtn').onclick = async () => {
            try {
                const res = await fetch(`${API_BASE}/api/open-profile/${acc.id}`, { method: 'POST' });
                const data = await res.json();
                if (data.error) {
                    alert('Ошибка: ' + data.error);
                } else {
                    const btn = document.getElementById('openBrowserBtn');
                    btn.textContent = '✅ Запущен!';
                    setTimeout(() => btn.textContent = '🌐 Открыть в Chrome', 2000);
                }
            } catch (e) {
                alert('Ошибка запуска: ' + e.message);
            }
        };
        document.getElementById('copyProfileBtn').onclick = () => {
            const text = fields.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n');
            navigator.clipboard.writeText(text).then(() => {
                const btn = document.getElementById('copyProfileBtn');
                btn.textContent = '✅ Скопировано!';
                setTimeout(() => btn.textContent = 'Копировать всё', 1500);
            });
        };
    }

    async function loadLocales() {
        try {
            const res = await fetch(`${API_BASE}/api/locales`);
            const locales = await res.json();
            const sel = document.getElementById('localeSelect');
            if (!sel || !locales.length) return;
            sel.innerHTML = '';
            locales.forEach(l => {
                const opt = document.createElement('option');
                opt.value = l.code;
                opt.textContent = `${l.flag || '🌍'} ${l.name} (${l.code})`;
                if (l.code === 'RU') opt.selected = true;
                sel.appendChild(opt);
            });
        } catch (e) { console.warn('locales load failed', e); }
    }

    async function loadDeposit() {
        try {
            const res = await fetch(`${API_BASE}/api/deposit/config`);
            const data = await res.json();
            const chk = document.getElementById('depositEnabledCheck');
            const inp = document.getElementById('depositAmountInput');
            const grp = document.getElementById('depositSettingsGroup');
            if (chk) chk.checked = data.enabled !== false;
            if (inp) inp.value = data.amount || 20;
            if (grp) grp.style.display = (data.enabled !== false) ? 'block' : 'none';
        } catch (e) { }
    }

    async function loadBettingConfig() {
        try {
            const res = await fetch(`${API_BASE}/api/betting/config`);
            if (res.ok) {
                const data = await res.json();
                const tfi = document.getElementById('targetForksInput');
                const mpi = document.getElementById('minProfitInput');
                const sci = document.getElementById('settlementCheckIntervalInput');
                if (tfi && data.targetForks !== undefined) tfi.value = data.targetForks;
                if (mpi && data.minProfitPct !== undefined) mpi.value = data.minProfitPct;
                if (sci && data.settlementCheckIntervalSec !== undefined) sci.value = data.settlementCheckIntervalSec;
            }
        } catch (e) { }
    }

    async function initData() {
        await Promise.allSettled([loadMirrors(), loadEmails(), loadProxy(), loadGemini(), loadAccounts(), loadLocales(), loadDeposit(), loadBettingConfig(), loadWallets(false)]);
    }
    initData();
});
