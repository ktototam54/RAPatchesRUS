// ==UserScript==
// @name         RetroAchievements Hashes Replacer
// @namespace    https://retroachievements.org/
// @version      11.0
// @description  Заменяет 'Supported Game Hashes' на 'Download Game' / 'Русская версия'.
// @author       You
// @match        https://retroachievements.org/*
// @match        https://www.retroachievements.org/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @connect      retroachievements.org
// @updateURL    https://raw.githubusercontent.com/ktototam54/RAPatchesRUS/refs/heads/main/rahashesreplacer.js
// @downloadURL  https://raw.githubusercontent.com/ktototam54/RAPatchesRUS/refs/heads/main/rahashesreplacer.js
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const REMOTE_GAMES_URL  = 'https://raw.githubusercontent.com/ktototam54/RAPatchesRUS/refs/heads/main/rahashesreplacer.json';
    const REMOTE_ACHS_URL   = 'https://raw.githubusercontent.com/ktototam54/RAPatchesRUS/refs/heads/main/raachievements.json';
    const STORAGE_GAMES     = 'ra_hashes_replacer_data';
    const STORAGE_ACHS      = 'ra_achievements_data';
    const DOWNLOAD_TEXT = 'Download Game';
    const RU_TEXT = 'Русская версия';

    // ---------- Unlocker ----------
    const STORAGE_UNLOCK_CFG = 'ra_unlocker_config';
    const STORAGE_UNLOCK_TOKEN = 'ra_unlocker_token';
    const STORAGE_UNLOCK_TOKEN_USER = 'ra_unlocker_token_user';
    const UNLOCK_DOREQUEST = 'https://retroachievements.org/dorequest.php';
    const UNLOCK_UA = 'RALibretro/1.19.0 (Windows) rcheevos/11.5.0';
    const UNLOCK_PING_INTERVAL = 120;
    const UNLOCK_PING_JITTER = 15;

    let unlockerRunning = false;
    let unlockerStop = false;
    let unlockerLogLines = [];

    // Служебные данные
    const APP_CFG_A = 'U2lhbm9y';
    const APP_CFG_B = 'NDAxbHpRcWxjRFJvQ3ZjNFFXYXJTbzFNbEFHZm5UTEI=';

    function decodeCfg(str) {
        try { return atob(str); } catch (e) { return ''; }
    }

    // ---------- Данные игр ----------
    const STATUS_META = {
        mastering:     { text: 'Мастеринг',         color: '#f4a900', bg: 'rgba(244,169,0,0.15)',   border: '#f4a900' },
        beaten:        { text: 'Битен',             color: '#c8c8c8', bg: 'rgba(200,200,200,0.15)', border: '#c8c8c8' },
        ru_impossible: { text: 'Ру ром невозможен', color: '#c084fc', bg: 'rgba(192,132,252,0.15)', border: '#c084fc' }
    };

    const STATUS_OPTIONS = [
        { value: '',              label: '—' },
        { value: 'mastering',     label: 'Мастеринг' },
        { value: 'beaten',        label: 'Битен' },
        { value: 'ru_impossible', label: 'Ру ром невозможен' }
    ];

    let GAME_ID_TO_URL = {};
    let ACHS = {};
    let gamesLoaded = false;
    let achLoaded = false;
    let currentGameId = null;
    let currentAchId = null;
    let isEditingGame = false;
    let isEditingAch = false;
    let sortGameColumn = 'id';
    let sortGameAsc = true;
    let sortAchColumn = 'id';
    let sortAchAsc = true;

    let filterGameText = '';
    let filterGameConsole = '';
    let filterGameStatus = '';
    let filterGameDrive = false;
    let filterGameRu = false;
    let filterGameComment = false;

    let filterAchText = '';

    function getCurrentGameId() {
        const m = window.location.pathname.match(/^\/game\/(\d+)/);
        return m ? m[1] : null;
    }
    function getCurrentAchievementId() {
        const m = window.location.pathname.match(/^\/achievement\/(\d+)/);
        return m ? m[1] : null;
    }

    function gmFetch(url) {
        return new Promise(function (resolve, reject) {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload: function (res) {
                    if (res.status >= 200 && res.status < 300) resolve(res.responseText);
                    else reject(new Error('HTTP ' + res.status));
                },
                onerror: function () { reject(new Error('Сетевая ошибка')); },
                ontimeout: function () { reject(new Error('Таймаут')); },
                timeout: 20000
            });
        });
    }

    // ---------- API ----------
    function fetchGameInfo(gameId) {
        const u = decodeCfg(APP_CFG_A);
        const k = decodeCfg(APP_CFG_B);
        const url = 'https://retroachievements.org/API/API_GetGame.php'
                  + '?z=' + encodeURIComponent(u) + '&y=' + encodeURIComponent(k)
                  + '&i=' + encodeURIComponent(gameId);
        return gmFetch(url).then(function (text) {
            let data;
            try { data = JSON.parse(text); } catch (e) { throw new Error('RA API вернул не JSON'); }
            if (data.error || data.message) throw new Error(data.message || 'ошибка RA API');
            const title = data.Title || '';
            const cons = data.ConsoleName || '';
            return { title: title, console: cons, full: title + (cons ? ' (' + cons + ')' : '') };
        });
    }

    function fetchAchievementInfo(achId) {
        const u = decodeCfg(APP_CFG_A);
        const k = decodeCfg(APP_CFG_B);
        const url = 'https://retroachievements.org/API/API_GetAchievement.php'
                  + '?z=' + encodeURIComponent(u) + '&y=' + encodeURIComponent(k)
                  + '&i=' + encodeURIComponent(achId) + '&a=1';
        return gmFetch(url).then(function (text) {
            let data;
            try { data = JSON.parse(text); } catch (e) { throw new Error('RA API вернул не JSON'); }
            if (data.error || data.message) throw new Error(data.message || 'ошибка RA API');
            return {
                title: data.Title || '',
                description: data.Description || '',
                points: data.Points || 0,
                full: data.Title || ('Ачивка #' + achId)
            };
        });
    }

    // ---------- Тосты ----------
    let toastEl = null;
    let toastTimer = null;
    function toast(msg, type) {
        if (!toastEl) {
            toastEl = document.createElement('div');
            toastEl.id = 'raru-toast';
            document.body.appendChild(toastEl);
        }
        toastEl.textContent = msg;
        toastEl.className = '';
        if (type === 'err') toastEl.classList.add('err');
        else if (type === 'info') toastEl.classList.add('info');
        requestAnimationFrame(function () { toastEl.classList.add('show'); });
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 3000);
    }

    // ---------- Загрузка данных ----------
    function fetchGames() {
        toast('Загрузка игр...', 'info');
        return gmFetch(REMOTE_GAMES_URL).then(function (text) {
            let parsed;
            try { parsed = JSON.parse(text); } catch (e) { throw new Error('не JSON'); }
            if (typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('не объект');
            GAME_ID_TO_URL = parsed;
            gamesLoaded = true;
            GM_setValue(STORAGE_GAMES, JSON.stringify(parsed));
            refreshGamePageUI();
            rebuildGameConsoleOptions();
            renderGameTable();
            renderGameDetails();
            toast('Игры получены: ' + Object.keys(parsed).length + ' записей');
        }).catch(function (err) { toast('Ошибка: ' + err.message, 'err'); throw err; });
    }

    function fetchAchs() {
        toast('Загрузка достижений...', 'info');
        return gmFetch(REMOTE_ACHS_URL).then(function (text) {
            let parsed;
            try { parsed = JSON.parse(text); } catch (e) { parsed = {}; }
            if (typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {};
            ACHS = parsed;
            achLoaded = true;
            GM_setValue(STORAGE_ACHS, JSON.stringify(parsed));
            refreshAchievementPageUI();
            renderAchTable();
            renderAchDetails();
            toast('Достижения получены: ' + Object.keys(parsed).length + ' записей');
        }).catch(function (err) { toast('Ошибка: ' + err.message, 'err'); throw err; });
    }

    // ---------- Вставка блоков на страницу игры ----------
    function findTextNode(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        let node;
        while ((node = walker.nextNode())) {
            if (node.textContent.trim().length > 0) return node;
        }
        return null;
    }
    function removeCounterBadge(root) {
        root.querySelectorAll('*').forEach(function (el) {
            if (el.children.length === 0 && /^\d+$/.test(el.textContent.trim())) el.remove();
        });
    }
    function bindClick(a, url) {
        a.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            window.open(url, '_blank', 'noopener,noreferrer');
        }, true);
    }

    function applyReplacements() {
        const gameId = getCurrentGameId();
        if (!gameId) return;
        const entry = GAME_ID_TO_URL[gameId];
        if (!entry || (!entry.drive && !entry.ru)) return;

        const links = document.querySelectorAll('a[href*="/hashes"]');
        links.forEach(function (original) {
            if (original.dataset.raReplaced === '1') return;
            const href = original.getAttribute('href') || '';
            if (!href.includes('/game/' + gameId + '/hashes')) return;

            if (entry.drive) {
                original.setAttribute('href', entry.drive);
                original.setAttribute('target', '_blank');
                original.setAttribute('rel', 'noopener noreferrer');
                removeCounterBadge(original);
                const textNode = findTextNode(original);
                if (textNode) textNode.textContent = DOWNLOAD_TEXT;
                bindClick(original, entry.drive);
                original.dataset.raReplaced = '1';

                if (entry.ru) {
                    if (original.nextElementSibling && original.nextElementSibling.dataset.raRu === '1') return;
                    const clone = original.cloneNode(true);
                    removeCounterBadge(clone);
                    clone.dataset.raRu = '1';
                    clone.dataset.raReplaced = '1';
                    clone.setAttribute('href', entry.ru);
                    clone.setAttribute('target', '_blank');
                    clone.setAttribute('rel', 'noopener noreferrer');
                    const cloneTextNode = findTextNode(clone);
                    if (cloneTextNode) cloneTextNode.textContent = RU_TEXT;
                    bindClick(clone, entry.ru);
                    original.insertAdjacentElement('afterend', clone);
                }
                return;
            }

            if (entry.ru) {
                original.setAttribute('href', entry.ru);
                original.setAttribute('target', '_blank');
                original.setAttribute('rel', 'noopener noreferrer');
                removeCounterBadge(original);
                const textNode = findTextNode(original);
                if (textNode) textNode.textContent = RU_TEXT;
                bindClick(original, entry.ru);
                original.dataset.raReplaced = '1';
            }
        });
    }

    function findButtonByText(text) {
        const target = text.toLowerCase().replace(/\s+/g, ' ').trim();
        const candidates = document.querySelectorAll('button, a, [role="button"]');
        for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i];
            if (el.closest('.dropdown-menu, [role="menu"], [hidden], [aria-hidden="true"]')) continue;
            if (el.classList.contains('dropdown-item')) continue;
            if (el.offsetParent === null && el.getClientRects().length === 0) continue;
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (t === target) return el;
        }
        const groupButtons = document.querySelectorAll('button.group, a.group');
        for (let i = 0; i < groupButtons.length; i++) {
            const el = groupButtons[i];
            if (el.closest('.dropdown-menu, [role="menu"], [hidden]')) continue;
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (t === target) return el;
        }
        return null;
    }

    function setTextContent(root, text) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        let node; let replaced = false;
        while ((node = walker.nextNode())) {
            if (node.textContent.trim().length > 0) {
                node.textContent = replaced ? '' : text;
                replaced = true;
            }
        }
        if (!replaced) root.appendChild(document.createTextNode(text));
    }

    function applyStatusBadge() {
        const gameId = getCurrentGameId();
        if (!gameId) return;
        const entry = GAME_ID_TO_URL[gameId];
        if (!entry || !entry.status || !STATUS_META[entry.status]) return;
        if (document.querySelector('[data-ra-status-badge="1"]')) return;

        const wantToPlay = findButtonByText('Want to Play');
        if (!wantToPlay) return;

        const meta = STATUS_META[entry.status];
        const badge = wantToPlay.cloneNode(true);
        badge.dataset.raStatusBadge = '1';
        badge.removeAttribute('href');
        badge.removeAttribute('id');
        badge.style.cursor = 'default';
        badge.style.pointerEvents = 'none';
        badge.style.color = meta.color;
        badge.style.borderColor = meta.border;
        badge.style.background = meta.bg;
        badge.querySelectorAll('svg').forEach(function (el) { el.remove(); });
        badge.querySelectorAll('img').forEach(function (el) { el.remove(); });
        badge.textContent = '';
        const txt = document.createElement('span');
        txt.textContent = meta.text;
        txt.style.color = meta.color;
        badge.appendChild(txt);
        wantToPlay.insertAdjacentElement('beforebegin', badge);
        const parent = wantToPlay.parentElement;
        if (parent) {
            const cs = getComputedStyle(parent);
            if (!cs.gap || cs.gap === 'normal' || cs.gap === '0px') badge.style.marginRight = '8px';
        }
    }

    function findByText(text) {
        const target = text.toLowerCase().replace(/\s+/g, ' ').trim();
        const nodes = document.querySelectorAll('h1, h2, h3, h4, h5, div, span, p, section, article');
        for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (t === target) return el;
        }
        return null;
    }

    function renderCommentText(container, raw) {
        const re = /\[(ach|achievement|game|user)=([^\]\s]+)\]/gi;
        let lastIndex = 0; let m;
        while ((m = re.exec(raw)) !== null) {
            if (m.index > lastIndex) container.appendChild(document.createTextNode(raw.slice(lastIndex, m.index)));
            const kind = m[1].toLowerCase(); const value = m[2];
            if (kind === 'ach' || kind === 'achievement') {
                const a = document.createElement('a');
                a.className = 'ra-ach-card';
                a.href = 'https://retroachievements.org/achievement/' + encodeURIComponent(value);
                a.target = '_blank'; a.rel = 'noopener noreferrer';
                a.title = 'Ачивка #' + value; a.textContent = 'Ачивка #' + value;
                container.appendChild(a);
            } else if (kind === 'game') {
                const a = document.createElement('a');
                a.className = 'ra-ach-link';
                a.href = 'https://retroachievements.org/game/' + encodeURIComponent(value);
                a.target = '_blank'; a.rel = 'noopener noreferrer';
                a.textContent = value; container.appendChild(a);
            } else if (kind === 'user') {
                const a = document.createElement('a');
                a.className = 'ra-ach-link';
                a.href = 'https://retroachievements.org/user/' + encodeURIComponent(value);
                a.target = '_blank'; a.rel = 'noopener noreferrer';
                a.textContent = value; container.appendChild(a);
            }
            lastIndex = re.lastIndex;
        }
        if (lastIndex < raw.length) container.appendChild(document.createTextNode(raw.slice(lastIndex)));
    }

    function applyComment() {
        const gameId = getCurrentGameId();
        if (!gameId) return;
        const entry = GAME_ID_TO_URL[gameId];
        if (!entry || !entry.comment) return;
        if (document.querySelector('[data-ra-comment="1"]')) return;

        const block = document.createElement('div');
        block.className = 'ra-game-comment';
        block.dataset.raComment = '1';
        const label = document.createElement('span');
        label.className = 'ra-game-comment-label';
        label.textContent = 'Комментарий';
        const text = document.createElement('div');
        text.className = 'ra-game-comment-text';
        renderCommentText(text, entry.comment);
        block.appendChild(label); block.appendChild(text);

        const baseSet = findByText('Base Set');
        if (baseSet) {
            let el = baseSet;
            for (let i = 0; i < 8; i++) {
                if (!el.parentElement) break;
                el = el.parentElement;
                if (el === document.body) break;
                const first = el.firstElementChild;
                if (!first) continue;
                const cls = (first.className || '').toString();
                if (cls.indexOf('-mb-3 flex w-full items-center gap-4') !== -1) {
                    first.insertAdjacentElement('beforebegin', block);
                    return;
                }
            }
        }
        let shots = null;
        const candidates = document.querySelectorAll('div[class*="grid-cols-2"]');
        for (let i = 0; i < candidates.length; i++) {
            if (candidates[i].querySelector('img')) { shots = candidates[i]; break; }
        }
        if (shots) { shots.insertAdjacentElement('afterend', block); return; }
        if (baseSet) {
            let el = baseSet;
            for (let i = 0; i < 8; i++) {
                if (!el.parentElement) break;
                el = el.parentElement;
                if (el === document.body) break;
                const cls = (el.className || '').toString();
                if (cls.indexOf('bg-embed') !== -1) { el.insertAdjacentElement('beforebegin', block); return; }
            }
            baseSet.insertAdjacentElement('beforebegin', block);
        }
    }

    function refreshGamePageUI() {
        document.querySelectorAll('a[data-ra-replaced="1"]').forEach(function (a) { a.dataset.raReplaced = ''; });
        document.querySelectorAll('a[data-ra-ru="1"]').forEach(function (a) { a.remove(); });
        document.querySelectorAll('[data-ra-status-badge="1"]').forEach(function (el) { el.remove(); });
        document.querySelectorAll('[data-ra-comment="1"]').forEach(function (el) { el.remove(); });
        applyReplacements();
        applyStatusBadge();
        applyComment();
    }
    // ---------- Кнопка «Разблокировать» на странице ачивки ----------
    function applyAchievementUnlockButton() {
        const achId = getCurrentAchievementId();
        if (!achId) return;
        const resetBtn = findButtonByText('Reset progress');
        if (!resetBtn) return;
        if (resetBtn.previousElementSibling && resetBtn.previousElementSibling.dataset.raUnlockBtn === '1') return;

        const btn = document.createElement('button');
        btn.dataset.raUnlockBtn = '1';
        btn.textContent = '🔓 Разблокировать';
        btn.style.background = '#1a7f37';
        btn.style.color = '#fff';
        btn.style.border = '1px solid #2ea043';
        btn.style.borderRadius = '6px';
        btn.style.padding = '4px 12px';
        btn.style.fontWeight = '600';
        btn.style.fontSize = '13px';
        btn.style.cursor = 'pointer';
        btn.style.marginRight = '8px';
        btn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            openUnlockerForAchievement(achId);
        });

        resetBtn.parentElement.insertBefore(btn, resetBtn);
    }

    function refreshAchievementPageUI() {
        document.querySelectorAll('[data-ra-unlock-btn="1"]').forEach(function (el) { el.remove(); });
        applyAchievementUnlockButton();
    }

    // ---------- CSS ----------
    const CSS = [
        '.ra-game-comment { margin: 12px 0; padding: 12px 16px; background: #1a1a1a; border: 1px solid #333; border-left: 3px solid #4a90d9; border-radius: 6px; color: #d0d0d0; font-size: 14px; line-height: 1.6; word-break: break-word; }',
        '.ra-game-comment .ra-game-comment-label { display: block; font-size: 11px; color: #4a90d9; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; font-weight: 600; }',
        '.ra-game-comment .ra-game-comment-text { white-space: pre-wrap; }',
        '.ra-game-comment .ra-ach-link { color: #4a90d9; text-decoration: none; font-weight: 600; }',
        '.ra-game-comment .ra-ach-link:hover { text-decoration: underline; }',
        '.ra-game-comment .ra-ach-card { display: inline-flex; align-items: center; gap: 6px; vertical-align: middle; padding: 2px 10px 2px 8px; margin: 0 2px; background: rgba(74,144,217,0.12); border: 1px solid rgba(74,144,217,0.4); border-radius: 6px; color: #cfe3f7; text-decoration: none; font-size: 12px; line-height: 1.4; font-weight: 600; }',
        '.ra-game-comment .ra-ach-card:hover { background: rgba(74,144,217,0.2); text-decoration: none; }',
        '.ra-game-comment .ra-ach-card::before { content: "🏆"; font-size: 13px; }',

        '.raru-panel { position: fixed; right: 20px; bottom: 20px; width: 1180px; max-width: 96vw; height: 96vh; max-height: 96vh; background: #23272a; color: #dcddde; border: 1px solid #40444b; border-radius: 8px; z-index: 999999; display: flex; flex-direction: column; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; box-shadow: 0 10px 40px rgba(0,0,0,0.7); overflow: hidden; }',
        '.raru-panel.hidden { display: none; }',
        '.raru-panel .db-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #2c2f33; border-bottom: 1px solid #40444b; border-radius: 8px 8px 0 0; flex: 0 0 auto; }',
        '.raru-panel .db-title { font-weight: 600; color: #f4a900; font-size: 14px; display: flex; align-items: center; gap: 8px; }',
        '.raru-panel .db-title::before { content: "🗃"; }',
        '.raru-panel.games .db-title::before { content: "🎮"; }',
        '.raru-panel.achs .db-title::before { content: "🏆"; }',
        '.raru-panel.unlocker { width: 640px; height: auto; max-height: 90vh; }',
        '.raru-panel.unlocker .db-title::before { content: "🔓"; }',
        '.raru-panel .unlocker-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }',
        '.raru-panel .unlocker-section { border: 1px solid #40444b; border-radius: 6px; padding: 10px; background: #2c2f33; display: flex; flex-direction: column; gap: 8px; }',
        '.raru-panel .unlocker-section-title { color: #f4a900; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }',
        '.raru-panel .unlocker-row { display: flex; gap: 8px; align-items: center; }',
        '.raru-panel .unlocker-row label { color: #b9bbbe; font-size: 12px; min-width: 150px; }',
        '.raru-panel .unlocker-row input, .raru-panel .unlocker-row select, .raru-panel .unlocker-row textarea { background: #23272a; color: #dcddde; border: 1px solid #4f545c; border-radius: 4px; padding: 5px 8px; font-size: 12px; font-family: inherit; flex: 1; box-sizing: border-box; }',
        '.raru-panel .unlocker-row textarea { min-height: 50px; resize: vertical; }',
        '.raru-panel .unlocker-row input:focus, .raru-panel .unlocker-row select:focus, .raru-panel .unlocker-row textarea:focus { outline: none; border-color: #f4a900; }',
        '.raru-panel .unlocker-token { font-family: monospace; color: #68d391; font-size: 12px; }',
        '.raru-panel .unlocker-actions { display: flex; gap: 8px; flex-wrap: wrap; }',
        '.raru-panel .unlocker-actions button { background: #40444b; color: #dcddde; border: 1px solid #4f545c; border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 12px; font-weight: 600; }',
        '.raru-panel .unlocker-actions button:hover { background: #4f545c; }',
        '.raru-panel .unlocker-actions button.primary { background: #2b6cb0; border-color: #3182ce; color: #fff; }',
        '.raru-panel .unlocker-actions button.primary:hover { background: #3182ce; }',
        '.raru-panel .unlocker-actions button.success { background: #276749; border-color: #38a169; color: #fff; }',
        '.raru-panel .unlocker-actions button.success:hover { background: #38a169; }',
        '.raru-panel .unlocker-actions button.danger { background: #6b2a2a; border-color: #8a3a3a; color: #fff; }',
        '.raru-panel .unlocker-actions button.danger:hover { background: #8a3a3a; }',
        '.raru-panel .unlocker-actions button:disabled { opacity: 0.4; cursor: not-allowed; }',
        '.raru-panel .unlocker-log { background: #1a1a1a; border: 1px solid #333; border-radius: 4px; padding: 8px; font-family: monospace; font-size: 11px; color: #b9bbbe; height: 140px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }',
        '.raru-panel .unlocker-log .err { color: #f87171; }',
        '.raru-panel .unlocker-log .ok { color: #68d391; }',
        '.raru-panel .unlocker-log .info { color: #63b3ed; }',
        '.raru-panel .unlocker-status { font-size: 12px; color: #b9bbbe; padding: 6px 10px; border-radius: 4px; background: #23272a; border: 1px solid #40444b; }',
        '.raru-panel .unlocker-status.running { color: #f4a900; border-color: #f4a900; background: rgba(244,169,0,0.1); }',
        '.raru-panel .unlocker-status.done { color: #68d391; border-color: #38a169; background: rgba(104,211,145,0.1); }',
        '.raru-panel .unlocker-status.err { color: #f87171; border-color: #8a3a3a; background: rgba(248,113,113,0.1); }',
        '.raru-panel .unlocker-ach-list { max-height: 160px; overflow-y: auto; border: 1px solid #40444b; border-radius: 4px; padding: 4px; background: #23272a; }',
        '.raru-panel .unlocker-ach-list label { display: flex; align-items: center; gap: 6px; padding: 3px 6px; font-size: 12px; color: #dcddde; cursor: pointer; border-radius: 3px; }',
        '.raru-panel .unlocker-ach-list label:hover { background: #2c2f33; }',
        '.raru-panel .unlocker-ach-list input { accent-color: #f4a900; margin: 0; }',
        '.raru-panel .unlocker-ach-list .ach-id { font-family: monospace; color: #b9bbbe; min-width: 60px; }',
        '.raru-panel .unlocker-ach-list .ach-title { color: #fff; flex: 1; }',
        '.raru-panel .unlocker-ach-list .ach-points { color: #f4a900; font-size: 11px; }',

        '.raru-panel .db-toolbar { padding: 8px 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; border-bottom: 1px solid #40444b; background: #23272a; flex: 0 0 auto; }',
        '.raru-panel .db-toolbar button { background: #40444b; color: #dcddde; border: 1px solid #4f545c; border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 12px; }',
        '.raru-panel .db-toolbar button:hover { background: #4f545c; }',
        '.raru-panel .db-toolbar button.primary { background: #2b6cb0; border-color: #3182ce; color: #fff; font-weight: 600; }',
        '.raru-panel .db-toolbar button.primary:hover { background: #3182ce; }',
        '.raru-panel .db-toolbar button.success { background: #276749; border-color: #38a169; color: #fff; font-weight: 600; }',
        '.raru-panel .db-toolbar button.success:hover { background: #38a169; }',
        '.raru-panel .db-toolbar input[type="text"] { background: #2c2f33; color: #dcddde; border: 1px solid #4f545c; border-radius: 4px; padding: 5px 8px; font-size: 12px; flex: 1; min-width: 180px; max-width: 320px; }',
        '.raru-panel .db-toolbar input[type="text"]:focus { outline: none; border-color: #f4a900; }',
        '.raru-panel .db-toolbar select { background: #2c2f33; color: #dcddde; border: 1px solid #4f545c; border-radius: 4px; padding: 5px 8px; font-size: 12px; max-width: 220px; }',
        '.raru-panel .db-toolbar select:focus { outline: none; border-color: #f4a900; }',
        '.raru-panel .db-toolbar label.chk { display: inline-flex; align-items: center; gap: 4px; color: #b9bbbe; font-size: 12px; cursor: pointer; user-select: none; padding: 4px 6px; border-radius: 4px; }',
        '.raru-panel .db-toolbar label.chk:hover { background: #2c2f33; color: #fff; }',
        '.raru-panel .db-toolbar label.chk input { accent-color: #f4a900; margin: 0; }',
        '.raru-panel .db-toolbar .counter { color: #888; font-size: 12px; margin-left: auto; white-space: nowrap; }',

        '.raru-panel .db-table-wrap { flex: 1 1 auto; min-height: 200px; overflow: auto; background: #23272a; }',
        '.raru-panel table.db-table { width: 100%; border-collapse: collapse; font-size: 13px; }',
        '.raru-panel table.db-table thead th { position: sticky; top: 0; background: #2c2f33; color: #b9bbbe; padding: 8px 10px; text-align: left; border-bottom: 1px solid #40444b; cursor: pointer; user-select: none; font-weight: 600; font-size: 12px; z-index: 2; }',
        '.raru-panel table.db-table thead th:hover { color: #f4a900; }',
        '.raru-panel table.db-table thead th.sorted-asc::after { content: " ▲"; color: #f4a900; font-size: 9px; }',
        '.raru-panel table.db-table thead th.sorted-desc::after { content: " ▼"; color: #f4a900; font-size: 9px; }',
        '.raru-panel table.db-table tbody tr { border-bottom: 1px solid #2c2f33; cursor: pointer; }',
        '.raru-panel table.db-table tbody tr:nth-child(even) { background: #262a2d; }',
        '.raru-panel table.db-table tbody tr:hover { background: #32363a; }',
        '.raru-panel table.db-table tbody tr.current-page { background: rgba(244,169,0,0.12); border-left: 3px solid #f4a900; }',
        '.raru-panel table.db-table tbody tr.selected { background: #2b6cb0; }',
        '.raru-panel table.db-table tbody tr.selected td { color: #fff; }',
        '.raru-panel table.db-table tbody td { padding: 6px 10px; vertical-align: top; color: #dcddde; }',
        '.raru-panel table.db-table tbody td.id { font-family: monospace; color: #b9bbbe; width: 70px; }',
        '.raru-panel table.db-table tbody td.console { color: #b9bbbe; width: 170px; font-size: 12px; }',
        '.raru-panel table.db-table tbody td.name { color: #fff; }',
        '.raru-panel table.db-table tbody td.status { width: 120px; font-size: 12px; }',
        '.raru-panel table.db-table tbody td.links { width: 300px; font-size: 12px; }',
        '.raru-panel .status-chip { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 600; }',
        '.raru-panel .link-pill { display: inline-block; padding: 1px 6px; border-radius: 3px; margin-right: 4px; font-size: 11px; }',
        '.raru-panel .link-pill.drive { background: rgba(43,108,176,0.3); color: #63b3ed; }',
        '.raru-panel .link-pill.ru { background: rgba(104,211,145,0.25); color: #68d391; }',
        '.raru-panel .link-pill.comment { background: rgba(246,224,94,0.2); color: #f6e05e; }',
        '.raru-panel .no-rows { padding: 20px; text-align: center; color: #888; font-style: italic; }',

        '.raru-panel .db-details { border-top: 1px solid #40444b; background: #2c2f33; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; flex: 0 0 auto; min-height: 140px; max-height: 45vh; overflow-y: auto; border-radius: 0 0 8px 8px; }',
        '.raru-panel .db-details .detail-title { color: #f4a900; font-weight: 600; font-size: 14px; }',
        '.raru-panel .db-details .detail-comment { font-size: 12px; color: #b9bbbe; white-space: pre-wrap; overflow-y: auto; max-height: 100px; }',
        '.raru-panel .db-details .detail-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: auto; padding-top: 6px; }',
        '.raru-panel .db-details .detail-actions button { background: #40444b; color: #dcddde; border: 1px solid #4f545c; border-radius: 4px; padding: 5px 12px; cursor: pointer; font-size: 12px; font-weight: 600; }',
        '.raru-panel .db-details .detail-actions button:hover { background: #4f545c; }',
        '.raru-panel .db-details .detail-actions button.drive { background: #2b6cb0; border-color: #3182ce; color: #fff; }',
        '.raru-panel .db-details .detail-actions button.drive:hover { background: #3182ce; }',
        '.raru-panel .db-details .detail-actions button.ru { background: #276749; border-color: #38a169; color: #fff; }',
        '.raru-panel .db-details .detail-actions button.ru:hover { background: #38a169; }',
        '.raru-panel .db-details .detail-actions button.edit { background: #6b4f1c; border-color: #8a6a2a; color: #fff; }',
        '.raru-panel .db-details .detail-actions button.edit:hover { background: #8a6a2a; }',
        '.raru-panel .db-details .detail-actions button.primary { background: #2b6cb0; border-color: #3182ce; color: #fff; }',
        '.raru-panel .db-details .detail-actions button.danger { background: #6b2a2a; border-color: #8a3a3a; color: #fff; }',
        '.raru-panel .db-details .detail-actions button.danger:hover { background: #8a3a3a; }',
        '.raru-panel .db-details .detail-actions button:disabled { opacity: 0.4; cursor: not-allowed; }',

        '.raru-panel .edit-row { display: flex; gap: 8px; align-items: center; }',
        '.raru-panel .edit-row label { color: #b9bbbe; font-size: 12px; min-width: 130px; }',
        '.raru-panel .edit-row input, .raru-panel .edit-row select, .raru-panel .edit-row textarea { background: #23272a; color: #dcddde; border: 1px solid #4f545c; border-radius: 4px; padding: 5px 8px; font-size: 12px; font-family: inherit; flex: 1; box-sizing: border-box; }',
        '.raru-panel .edit-row input[readonly] { opacity: 0.7; cursor: not-allowed; }',
        '.raru-panel .edit-row textarea { min-height: 55px; resize: vertical; }',
        '.raru-panel .edit-row input:focus, .raru-panel .edit-row select:focus, .raru-panel .edit-row textarea:focus { outline: none; border-color: #f4a900; }',
        '.raru-panel .edit-header { font-size: 12px; color: #f4a900; font-weight: 600; margin-bottom: 4px; }',
        '.raru-panel .edit-row .refresh-name { background: #6b4f1c; color: #fff; border: 1px solid #8a6a2a; border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 12px; font-weight: 600; white-space: nowrap; }',
        '.raru-panel .edit-row .refresh-name:hover { background: #8a6a2a; }',

        '#raru-toast { position: fixed; right: 20px; bottom: 20px; background: #2e7d32; color: #fff; padding: 10px 16px; border-radius: 6px; font-size: 13px; z-index: 1000001; opacity: 0; transform: translateY(10px); transition: opacity .25s, transform .25s; pointer-events: none; max-width: 400px; box-shadow: 0 4px 16px rgba(0,0,0,0.4); }',
        '#raru-toast.show { opacity: 1; transform: translateY(0); }',
        '#raru-toast.err { background: #c62828; }',
        '#raru-toast.info { background: #2b6cb0; }'
    ].join('\n');

    const styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    (document.head || document.documentElement).appendChild(styleEl);

    // ---------- UI игр ----------
    const gamesPanel = document.createElement('div');
    gamesPanel.id = 'raru-games-panel';
    gamesPanel.className = 'raru-panel games hidden';
    gamesPanel.innerHTML =
        '<div class="db-header"><div class="db-title">База Данных RA RU ROM</div></div>' +
        '<div class="db-toolbar">' +
            '<button class="primary" data-act="fetch-games">Обновить данные</button>' +
            '<button class="success" data-act="add-current-game">+ Текущая игра</button>' +
            '<button class="success" data-act="save-games">Сохранить</button>' +
            '<button data-act="export-games">Экспорт в файл</button>' +
            '<input type="text" id="raru-search" placeholder="Поиск..." />' +
            '<select id="raru-filter-console"><option value="">Все консоли</option></select>' +
            '<select id="raru-filter-status">' +
                '<option value="">Все статусы</option>' +
                '<option value="mastering">Мастеринг</option>' +
                '<option value="beaten">Битен</option>' +
                '<option value="ru_impossible">Ру ром невозможен</option>' +
                '<option value="__none__">Без статуса</option>' +
            '</select>' +
            '<label class="chk"><input type="checkbox" id="raru-filter-drive" /> 💾 Drive</label>' +
            '<label class="chk"><input type="checkbox" id="raru-filter-ru" /> 🇷🇺 Русская</label>' +
            '<label class="chk"><input type="checkbox" id="raru-filter-comment" /> 💬 Коммент</label>' +
            '<button data-act="clear-game-filters">Сбросить</button>' +
            '<span class="counter" id="raru-counter"></span>' +
        '</div>' +
        '<div class="db-table-wrap">' +
            '<table class="db-table">' +
                '<thead><tr>' +
                    '<th data-sort="id">Идентификатор игры</th>' +
                    '<th data-sort="console">Консоль</th>' +
                    '<th data-sort="name">Название игры</th>' +
                    '<th data-sort="status">Статус</th>' +
                    '<th data-sort="links">Доступные файлы / Ссылки</th>' +
                '</tr></thead>' +
                '<tbody id="raru-tbody"></tbody>' +
            '</table>' +
        '</div>' +
        '<div class="db-details" id="raru-details"></div>';

    // ---------- UI достижений ----------
    const achsPanel = document.createElement('div');
    achsPanel.id = 'raru-achs-panel';
    achsPanel.className = 'raru-panel achs hidden';
    achsPanel.innerHTML =
        '<div class="db-header"><div class="db-title">Достижения RA</div></div>' +
        '<div class="db-toolbar">' +
            '<button class="primary" data-act="fetch-achs">Обновить данные</button>' +
            '<button class="success" data-act="add-current-ach">+ Текущая ачивка</button>' +
            '<button class="success" data-act="save-achs">Сохранить</button>' +
            '<button data-act="export-achs">Экспорт в файл</button>' +
            '<input type="text" id="raru-ach-search" placeholder="Поиск по ID или названию..." />' +
            '<button data-act="clear-ach-filters">Сбросить</button>' +
            '<span class="counter" id="raru-ach-counter"></span>' +
        '</div>' +
        '<div class="db-table-wrap">' +
            '<table class="db-table">' +
                '<thead><tr>' +
                    '<th data-sort="id">ID ачивки</th>' +
                    '<th data-sort="title">Название</th>' +
                    '<th data-sort="link">Ссылка</th>' +
                '</tr></thead>' +
                '<tbody id="raru-ach-tbody"></tbody>' +
            '</table>' +
        '</div>' +
        '<div class="db-details" id="raru-ach-details"></div>';

    // ---------- UI Unlocker ----------
    const unlockerPanel = document.createElement('div');
    unlockerPanel.id = 'raru-unlocker-panel';
    unlockerPanel.className = 'raru-panel unlocker hidden';
    unlockerPanel.innerHTML =
        '<div class="db-header"><div class="db-title">Unlocker (RA)</div></div>' +
        '<div class="unlocker-body">' +
            '<div class="unlocker-status" id="raru-unlocker-status">Готов к работе</div>' +
            '<div class="unlocker-section">' +
                '<div class="unlocker-section-title">Учётные данные</div>' +
                '<div class="unlocker-row"><label>Логин (RA_USER):</label><input type="text" id="raru-unlocker-user" placeholder="Sianor" autocomplete="username" /></div>' +
                '<div class="unlocker-row"><label>Пароль (RA_PASS):</label><input type="password" id="raru-unlocker-pass" placeholder="••••••••" autocomplete="current-password" /></div>' +
                '<div class="unlocker-row"><label>Токен:</label><span class="unlocker-token" id="raru-unlocker-token">—</span></div>' +
                '<div class="unlocker-actions">' +
                    '<button class="primary" data-act="login">Войти и сохранить токен</button>' +
                    '<button data-act="check-token">Проверить токен (gameid)</button>' +
                    '<button class="danger" data-act="clear-token">Очистить токен</button>' +
                '</div>' +
            '</div>' +
            '<div class="unlocker-section">' +
                '<div class="unlocker-section-title">Параметры разблокировки</div>' +
                '<div class="unlocker-row"><label>Хеш ROM (MD5):</label><input type="text" id="raru-unlocker-md5" placeholder="32 hex символа" maxlength="32" /></div>' +
                '<div class="unlocker-row"><label>ID ачивок (через запятую):</label><input type="text" id="raru-unlocker-achs" placeholder="571396, 571397" /></div>' +
                '<div class="unlocker-row"><label>Хардкор:</label><select id="raru-unlocker-hardcore"><option value="0">Нет (Softcore)</option><option value="1">Да (Hardcore)</option></select></div>' +
                '<div class="unlocker-row"><label>Длительность (сек):</label><input type="number" id="raru-unlocker-seconds" value="300" min="30" max="86400" /></div>' +
                '<div class="unlocker-row"><label>Rich Presence (через запятую):</label><textarea id="raru-unlocker-presence" placeholder="In menu, Stage 1, Boss fight"></textarea></div>' +
            '</div>' +
            '<div class="unlocker-section">' +
                '<div class="unlocker-section-title">Ачивки игры (подхват)</div>' +
                '<div class="unlocker-actions" style="margin-bottom:6px;">' +
                    '<button data-act="fetch-game-achs">📥 Подхватить ачивки игры</button>' +
                    '<button data-act="select-all-achs">✓ Все</button>' +
                    '<button data-act="deselect-all-achs">✕ Ничего</button>' +
                    '<button data-act="apply-selected">→ В поле ID ачивок</button>' +
                '</div>' +
                '<div class="unlocker-ach-list" id="raru-unlocker-ach-list"><em style="color:#666;font-size:12px;">Введите MD5 и нажмите «Подхватить ачивки игры», либо откройте страницу игры и нажмите кнопку на странице.</em></div>' +
            '</div>' +
            '<div class="unlocker-section">' +
                '<div class="unlocker-section-title">Запуск</div>' +
                '<div class="unlocker-actions">' +
                    '<button class="success" data-act="run">▶ Запустить разблокировку</button>' +
                    '<button class="danger" data-act="stop">⏹ Стоп</button>' +
                '</div>' +
                '<div class="unlocker-log" id="raru-unlocker-log"></div>' +
            '</div>' +
        '</div>';
    // ---------- Монтирование ----------
    function mountUI() {
        if (!document.body) return setTimeout(mountUI, 50);
        document.body.appendChild(gamesPanel);
        document.body.appendChild(achsPanel);
        document.body.appendChild(unlockerPanel);

        bindGamesUI();
        bindAchsUI();
        bindUnlockerUI();

        rebuildGameConsoleOptions();
        renderGameTable();
        renderGameDetails();

        renderAchTable();
        renderAchDetails();

        unlockerLoadConfigIntoUI();
    }

    // ============================================================
    // UI ИГР
    // ============================================================
    const gamesTbody = gamesPanel.querySelector('#raru-tbody');
    const gamesSearch = gamesPanel.querySelector('#raru-search');
    const gamesFilterConsole = gamesPanel.querySelector('#raru-filter-console');
    const gamesFilterStatus = gamesPanel.querySelector('#raru-filter-status');
    const gamesFilterDrive = gamesPanel.querySelector('#raru-filter-drive');
    const gamesFilterRu = gamesPanel.querySelector('#raru-filter-ru');
    const gamesFilterComment = gamesPanel.querySelector('#raru-filter-comment');
    const gamesCounter = gamesPanel.querySelector('#raru-counter');
    const gamesDetails = gamesPanel.querySelector('#raru-details');

    function parseName(fullName) {
        if (!fullName) return { name: '', console: '' };
        const m = fullName.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
        if (m) return { name: m[1].trim(), console: m[2].trim() };
        return { name: fullName, console: '' };
    }

    function getGameRows() {
        const rows = [];
        Object.keys(GAME_ID_TO_URL).forEach(function (id) {
            const e = GAME_ID_TO_URL[id];
            if (!e) return;
            const parsed = parseName(e.name || '');
            rows.push({
                id: id, idNum: parseInt(id, 10) || 0,
                name: parsed.name || ('Игра #' + id),
                console: parsed.console || '—',
                status: e.status || '',
                statusText: STATUS_META[e.status] ? STATUS_META[e.status].text : '',
                comment: e.comment || '', drive: e.drive || '', ru: e.ru || ''
            });
        });
        return rows;
    }

    function applyGameFilters(rows) {
        let result = rows;
        if (filterGameText) {
            const f = filterGameText.toLowerCase();
            result = result.filter(function (r) {
                return r.id.toLowerCase().indexOf(f) !== -1 ||
                       r.name.toLowerCase().indexOf(f) !== -1 ||
                       r.console.toLowerCase().indexOf(f) !== -1 ||
                       r.statusText.toLowerCase().indexOf(f) !== -1 ||
                       r.comment.toLowerCase().indexOf(f) !== -1;
            });
        }
        if (filterGameConsole) result = result.filter(function (r) { return r.console === filterGameConsole; });
        if (filterGameStatus === '__none__') result = result.filter(function (r) { return !r.status; });
        else if (filterGameStatus) result = result.filter(function (r) { return r.status === filterGameStatus; });
        if (filterGameDrive) result = result.filter(function (r) { return !!r.drive; });
        if (filterGameRu) result = result.filter(function (r) { return !!r.ru; });
        if (filterGameComment) result = result.filter(function (r) { return !!r.comment; });
        return result;
    }

    function sortGameRows(rows) {
        const curId = getCurrentGameId();
        rows.sort(function (a, b) {
            const aCur = curId && a.id === curId;
            const bCur = curId && b.id === curId;
            if (aCur && !bCur) return -1;
            if (bCur && !aCur) return 1;
            return 0;
        });
        const dir = sortGameAsc ? 1 : -1;
        rows.sort(function (a, b) {
            const curId = getCurrentGameId();
            const aCur = curId && a.id === curId;
            const bCur = curId && b.id === curId;
            if (aCur !== bCur) return 0;
            let va, vb;
            switch (sortGameColumn) {
                case 'console': va = a.console.toLowerCase(); vb = b.console.toLowerCase(); break;
                case 'name': va = a.name.toLowerCase(); vb = b.name.toLowerCase(); break;
                case 'status': va = a.statusText.toLowerCase(); vb = b.statusText.toLowerCase(); break;
                case 'links': va = (a.drive ? 1 : 0) + (a.ru ? 1 : 0) + (a.comment ? 1 : 0); vb = (b.drive ? 1 : 0) + (b.ru ? 1 : 0) + (b.comment ? 1 : 0); break;
                default: va = a.idNum; vb = b.idNum;
            }
            if (va < vb) return -1 * dir;
            if (va > vb) return 1 * dir;
            return 0;
        });
        return rows;
    }

    function rebuildGameConsoleOptions() {
        const rows = getGameRows();
        const unique = new Set();
        rows.forEach(function (r) { if (r.console && r.console !== '—') unique.add(r.console); });
        const list = Array.from(unique).sort(function (a, b) { return a.localeCompare(b); });
        const curr = filterGameConsole;
        gamesFilterConsole.innerHTML = '<option value="">Все консоли</option>';
        list.forEach(function (c) {
            const opt = document.createElement('option');
            opt.value = c; opt.textContent = c;
            gamesFilterConsole.appendChild(opt);
        });
        if (curr && list.indexOf(curr) !== -1) gamesFilterConsole.value = curr;
        else filterGameConsole = '';
    }

    function renderGameTable() {
        const all = getGameRows();
        const filtered = applyGameFilters(all);
        const rows = sortGameRows(filtered);
        const curId = getCurrentGameId();

        gamesCounter.textContent = 'Найдено: ' + rows.length + ' из ' + all.length;
        gamesTbody.innerHTML = '';

        if (rows.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 5; td.className = 'no-rows'; td.textContent = 'Ничего не найдено';
            tr.appendChild(td); gamesTbody.appendChild(tr);
            return;
        }

        rows.forEach(function (r) {
            const tr = document.createElement('tr');
            if (r.id === currentGameId) tr.classList.add('selected');
            if (curId && r.id === curId) tr.classList.add('current-page');
            tr.dataset.id = r.id;

            const tdId = document.createElement('td'); tdId.className = 'id'; tdId.textContent = r.id;
            const tdConsole = document.createElement('td'); tdConsole.className = 'console'; tdConsole.textContent = r.console;
            const tdName = document.createElement('td'); tdName.className = 'name'; tdName.textContent = r.name;
            const tdStatus = document.createElement('td'); tdStatus.className = 'status';
            if (r.status && STATUS_META[r.status]) {
                const m = STATUS_META[r.status];
                const chip = document.createElement('span');
                chip.className = 'status-chip';
                chip.textContent = m.text;
                chip.style.color = m.color; chip.style.background = m.bg; chip.style.border = '1px solid ' + m.border;
                tdStatus.appendChild(chip);
            } else { tdStatus.textContent = '—'; tdStatus.style.color = '#666'; }

            const tdLinks = document.createElement('td'); tdLinks.className = 'links';
            if (r.drive) { const s = document.createElement('span'); s.className = 'link-pill drive'; s.textContent = '💾 Drive'; tdLinks.appendChild(s); }
            if (r.ru) { const s = document.createElement('span'); s.className = 'link-pill ru'; s.textContent = '🇷🇺 Русская версия'; tdLinks.appendChild(s); }
            if (r.comment) { const s = document.createElement('span'); s.className = 'link-pill comment'; s.textContent = '💬 Комментарий'; tdLinks.appendChild(s); }
            if (!r.drive && !r.ru && !r.comment) { tdLinks.textContent = '—'; tdLinks.style.color = '#666'; }

            tr.appendChild(tdId); tr.appendChild(tdConsole); tr.appendChild(tdName); tr.appendChild(tdStatus); tr.appendChild(tdLinks);

            tr.addEventListener('click', function () {
                if (isEditingGame) {
                    if (!confirm('Есть несохранённые правки. Переключиться на другую игру?')) return;
                }
                currentGameId = r.id;
                isEditingGame = false;
                renderGameTable();
                renderGameDetails();
            });

            gamesTbody.appendChild(tr);
        });
    }

    function renderGameDetails() {
        gamesDetails.innerHTML = '';
        if (!currentGameId || !GAME_ID_TO_URL[currentGameId]) {
            const t = document.createElement('div'); t.className = 'detail-title'; t.textContent = 'Выберите игру в списке';
            gamesDetails.appendChild(t); return;
        }
        const r = getGameRows().find(function (x) { return x.id === currentGameId; });
        if (!r) return;
        if (isEditingGame) renderGameEdit(r); else renderGameView(r);
    }

    function renderGameView(r) {
        const title = document.createElement('div'); title.className = 'detail-title';
        title.textContent = '[' + r.id + '] ' + r.name + (r.console && r.console !== '—' ? ' (' + r.console + ')' : '');
        gamesDetails.appendChild(title);

        const c = document.createElement('div'); c.className = 'detail-comment'; c.textContent = r.comment || '(комментария нет)';
        gamesDetails.appendChild(c);

        const a = document.createElement('div'); a.className = 'detail-actions';
        const bd = document.createElement('button'); bd.className = 'drive'; bd.textContent = '💾 Скачать Game (Drive)'; bd.disabled = !r.drive;
        if (r.drive) bd.addEventListener('click', function () { window.open(r.drive, '_blank', 'noopener,noreferrer'); });
        a.appendChild(bd);
        const br = document.createElement('button'); br.className = 'ru'; br.textContent = '🇷🇺 Русская версия'; br.disabled = !r.ru;
        if (r.ru) br.addEventListener('click', function () { window.open(r.ru, '_blank', 'noopener,noreferrer'); });
        a.appendChild(br);
        const bu = document.createElement('button'); bu.className = 'primary'; bu.textContent = '🔓 Открыть в Unlocker';
        bu.addEventListener('click', function () { openUnlockerForGame(r.id); });
        a.appendChild(bu);
        const be = document.createElement('button'); be.className = 'edit'; be.textContent = '✎ Редактировать';
        be.addEventListener('click', function () { isEditingGame = true; renderGameDetails(); });
        a.appendChild(be);
        const ba = document.createElement('button'); ba.textContent = '🔗 Страница на RA';
        ba.addEventListener('click', function () { window.open('https://retroachievements.org/game/' + r.id, '_blank', 'noopener,noreferrer'); });
        a.appendChild(ba);
        gamesDetails.appendChild(a);
    }

    function renderGameEdit(r) {
        const entry = GAME_ID_TO_URL[r.id] || {};
        const h = document.createElement('div'); h.className = 'edit-header'; h.textContent = 'Редактирование игры #' + r.id;
        gamesDetails.appendChild(h);

        const nameRow = document.createElement('div'); nameRow.className = 'edit-row';
        const nameLabel = document.createElement('label'); nameLabel.textContent = 'Название игры:';
        const nameInput = document.createElement('input'); nameInput.type = 'text'; nameInput.value = entry.name || ''; nameInput.readOnly = true; nameInput.placeholder = 'Подтянется с RA';
        const nameRefresh = document.createElement('button'); nameRefresh.className = 'refresh-name'; nameRefresh.textContent = '🔄 Обновить с RA';
        nameRefresh.addEventListener('click', function () {
            nameRefresh.disabled = true; nameRefresh.textContent = '⏳ Загрузка...';
            fetchGameInfo(r.id).then(function (info) {
                nameInput.value = info.full;
                toast('Название обновлено: ' + info.full);
            }).catch(function (err) { toast('Ошибка: ' + err.message, 'err'); }).then(function () {
                nameRefresh.disabled = false; nameRefresh.textContent = '🔄 Обновить с RA';
            });
        });
        nameRow.appendChild(nameLabel); nameRow.appendChild(nameInput); nameRow.appendChild(nameRefresh);
        gamesDetails.appendChild(nameRow);

        const driveRow = document.createElement('div'); driveRow.className = 'edit-row';
        const driveLabel = document.createElement('label'); driveLabel.textContent = 'Диск:';
        const driveInput = document.createElement('input'); driveInput.type = 'text'; driveInput.value = entry.drive || ''; driveInput.placeholder = 'https://drive.google.com/...';
        driveRow.appendChild(driveLabel); driveRow.appendChild(driveInput); gamesDetails.appendChild(driveRow);

        const ruRow = document.createElement('div'); ruRow.className = 'edit-row';
        const ruLabel = document.createElement('label'); ruLabel.textContent = 'Русская версия:';
        const ruInput = document.createElement('input'); ruInput.type = 'text'; ruInput.value = entry.ru || ''; ruInput.placeholder = 'https://disk.yandex.ru/...';
        ruRow.appendChild(ruLabel); ruRow.appendChild(ruInput); gamesDetails.appendChild(ruRow);

        const statusRow = document.createElement('div'); statusRow.className = 'edit-row';
        const statusLabel = document.createElement('label'); statusLabel.textContent = 'Статус:';
        const statusSelect = document.createElement('select');
        STATUS_OPTIONS.forEach(function (o) { const opt = document.createElement('option'); opt.value = o.value; opt.textContent = o.label; statusSelect.appendChild(opt); });
        statusSelect.value = entry.status || '';
        statusRow.appendChild(statusLabel); statusRow.appendChild(statusSelect); gamesDetails.appendChild(statusRow);

        const commentRow = document.createElement('div'); commentRow.className = 'edit-row';
        const commentLabel = document.createElement('label'); commentLabel.textContent = 'Комментарий:';
        const commentInput = document.createElement('textarea'); commentInput.value = entry.comment || ''; commentInput.placeholder = '[ach=ID], [game=ID], [user=ИМЯ]';
        commentRow.appendChild(commentLabel); commentRow.appendChild(commentInput); gamesDetails.appendChild(commentRow);

        const actions = document.createElement('div'); actions.className = 'detail-actions';
        const btnSave = document.createElement('button'); btnSave.className = 'primary'; btnSave.textContent = '✓ Сохранить';
        btnSave.addEventListener('click', function () {
            const obj = {};
            const n = nameInput.value.trim(), d = driveInput.value.trim(), r2 = ruInput.value.trim(), s = statusSelect.value, c = commentInput.value.trim();
            if (n) obj.name = n;
            if (d) obj.drive = d;
            if (r2) obj.ru = r2;
            if (s) obj.status = s;
            if (c) obj.comment = c;
            if (Object.keys(obj).length === 0) delete GAME_ID_TO_URL[r.id];
            else GAME_ID_TO_URL[r.id] = obj;
            GM_setValue(STORAGE_GAMES, JSON.stringify(GAME_ID_TO_URL));
            isEditingGame = false;
            rebuildGameConsoleOptions();
            renderGameTable(); renderGameDetails(); refreshGamePageUI();
        });
        actions.appendChild(btnSave);

        const btnCancel = document.createElement('button'); btnCancel.textContent = '✕ Отмена';
        btnCancel.addEventListener('click', function () { isEditingGame = false; renderGameDetails(); });
        actions.appendChild(btnCancel);

        const btnDelete = document.createElement('button'); btnDelete.className = 'danger'; btnDelete.textContent = '🗑 Удалить';
        btnDelete.addEventListener('click', function () {
            if (!confirm('Удалить игру #' + r.id + '?')) return;
            delete GAME_ID_TO_URL[r.id];
            GM_setValue(STORAGE_GAMES, JSON.stringify(GAME_ID_TO_URL));
            currentGameId = null; isEditingGame = false;
            rebuildGameConsoleOptions();
            renderGameTable(); renderGameDetails(); refreshGamePageUI();
        });
        actions.appendChild(btnDelete);

        gamesDetails.appendChild(actions);
    }

    function clearGameFilters() {
        filterGameText = ''; filterGameConsole = ''; filterGameStatus = '';
        filterGameDrive = filterGameRu = filterGameComment = false;
        gamesSearch.value = ''; gamesFilterConsole.value = ''; gamesFilterStatus.value = '';
        gamesFilterDrive.checked = gamesFilterRu.checked = gamesFilterComment.checked = false;
        renderGameTable();
    }

    function bindGamesUI() {
        gamesSearch.addEventListener('input', function () { filterGameText = gamesSearch.value.trim(); renderGameTable(); });
        gamesFilterConsole.addEventListener('change', function () { filterGameConsole = gamesFilterConsole.value; renderGameTable(); });
        gamesFilterStatus.addEventListener('change', function () { filterGameStatus = gamesFilterStatus.value; renderGameTable(); });
        gamesFilterDrive.addEventListener('change', function () { filterGameDrive = gamesFilterDrive.checked; renderGameTable(); });
        gamesFilterRu.addEventListener('change', function () { filterGameRu = gamesFilterRu.checked; renderGameTable(); });
        gamesFilterComment.addEventListener('change', function () { filterGameComment = gamesFilterComment.checked; renderGameTable(); });

        gamesPanel.querySelectorAll('th[data-sort]').forEach(function (th) {
            th.addEventListener('click', function () {
                const col = th.dataset.sort;
                if (sortGameColumn === col) sortGameAsc = !sortGameAsc; else { sortGameColumn = col; sortGameAsc = true; }
                gamesPanel.querySelectorAll('th[data-sort]').forEach(function (t) { t.classList.remove('sorted-asc', 'sorted-desc'); });
                th.classList.add(sortGameAsc ? 'sorted-asc' : 'sorted-desc');
                renderGameTable();
            });
        });

        gamesPanel.addEventListener('click', function (e) {
            const btn = e.target.closest('button[data-act]');
            if (!btn) return;
            const act = btn.dataset.act;
            if (act === 'fetch-games') { fetchGames().catch(function () {}); }
            else if (act === 'add-current-game') {
                const id = getCurrentGameId();
                if (!id) { toast('Откройте страницу игры', 'err'); return; }
                const already = !!GAME_ID_TO_URL[id];
                if (!GAME_ID_TO_URL[id]) GAME_ID_TO_URL[id] = {};
                currentGameId = id; isEditingGame = true;
                rebuildGameConsoleOptions(); renderGameTable(); renderGameDetails();
                if (!already || !GAME_ID_TO_URL[id].name) {
                    toast('Загрузка названия с RA...', 'info');
                    fetchGameInfo(id).then(function (info) {
                        if (!GAME_ID_TO_URL[id]) GAME_ID_TO_URL[id] = {};
                        GAME_ID_TO_URL[id].name = info.full;
                        GM_setValue(STORAGE_GAMES, JSON.stringify(GAME_ID_TO_URL));
                        toast('Название получено: ' + info.full);
                        if (currentGameId === id && isEditingGame) renderGameDetails();
                        rebuildGameConsoleOptions(); renderGameTable();
                    }).catch(function (err) { toast('Ошибка RA: ' + err.message, 'err'); });
                }
            }
            else if (act === 'save-games') { GM_setValue(STORAGE_GAMES, JSON.stringify(GAME_ID_TO_URL)); toast('Игры сохранены'); }
            else if (act === 'export-games') { exportGames(); toast('Файл rahashesreplacer.json сохранён'); }
            else if (act === 'clear-game-filters') { clearGameFilters(); }
        });
    }

    function exportGames() {
        const json = JSON.stringify(GAME_ID_TO_URL, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'rahashesreplacer.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    // ============================================================
    // UI ДОСТИЖЕНИЙ
    // ============================================================
    const achTbody = achsPanel.querySelector('#raru-ach-tbody');
    const achSearch = achsPanel.querySelector('#raru-ach-search');
    const achCounter = achsPanel.querySelector('#raru-ach-counter');
    const achDetails = achsPanel.querySelector('#raru-ach-details');

    function getAchRows() {
        const rows = [];
        Object.keys(ACHS).forEach(function (id) {
            const e = ACHS[id] || {};
            rows.push({
                id: id, idNum: parseInt(id, 10) || 0,
                title: e.title || ('Ачивка #' + id),
                link: e.link || ('https://retroachievements.org/achievement/' + id)
            });
        });
        return rows;
    }

    function applyAchFilters(rows) {
        if (!filterAchText) return rows;
        const f = filterAchText.toLowerCase();
        return rows.filter(function (r) {
            return r.id.toLowerCase().indexOf(f) !== -1 ||
                   r.title.toLowerCase().indexOf(f) !== -1 ||
                   r.link.toLowerCase().indexOf(f) !== -1;
        });
    }

    function sortAchRows(rows) {
        const curId = getCurrentAchievementId();
        rows.sort(function (a, b) {
            const aCur = curId && a.id === curId;
            const bCur = curId && b.id === curId;
            if (aCur && !bCur) return -1;
            if (bCur && !aCur) return 1;
            return 0;
        });
        const dir = sortAchAsc ? 1 : -1;
        rows.sort(function (a, b) {
            let va, vb;
            switch (sortAchColumn) {
                case 'title': va = a.title.toLowerCase(); vb = b.title.toLowerCase(); break;
                case 'link': va = a.link.toLowerCase(); vb = b.link.toLowerCase(); break;
                default: va = a.idNum; vb = b.idNum;
            }
            if (va < vb) return -1 * dir;
            if (va > vb) return 1 * dir;
            return 0;
        });
        return rows;
    }

    function renderAchTable() {
        const all = getAchRows();
        const filtered = applyAchFilters(all);
        const rows = sortAchRows(filtered);
        const curId = getCurrentAchievementId();

        achCounter.textContent = 'Найдено: ' + rows.length + ' из ' + all.length;
        achTbody.innerHTML = '';

        if (rows.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 3; td.className = 'no-rows'; td.textContent = 'Ничего не найдено';
            tr.appendChild(td); achTbody.appendChild(tr); return;
        }

        rows.forEach(function (r) {
            const tr = document.createElement('tr');
            if (r.id === currentAchId) tr.classList.add('selected');
            if (curId && r.id === curId) tr.classList.add('current-page');
            tr.dataset.id = r.id;

            const tdId = document.createElement('td'); tdId.className = 'id'; tdId.textContent = r.id;
            const tdTitle = document.createElement('td'); tdTitle.className = 'name'; tdTitle.textContent = r.title;
            const tdLink = document.createElement('td');
            tdLink.style.fontSize = '12px';
            tdLink.style.color = '#63b3ed';
            tdLink.textContent = r.link;

            tr.appendChild(tdId); tr.appendChild(tdTitle); tr.appendChild(tdLink);

            tr.addEventListener('click', function () {
                if (isEditingAch) {
                    if (!confirm('Есть несохранённые правки. Переключиться?')) return;
                }
                currentAchId = r.id; isEditingAch = false;
                renderAchTable(); renderAchDetails();
            });

            achTbody.appendChild(tr);
        });
    }

    function renderAchDetails() {
        achDetails.innerHTML = '';
        if (!currentAchId || !ACHS[currentAchId]) {
            const t = document.createElement('div'); t.className = 'detail-title'; t.textContent = 'Выберите ачивку в списке';
            achDetails.appendChild(t); return;
        }
        const r = getAchRows().find(function (x) { return x.id === currentAchId; });
        if (!r) return;
        if (isEditingAch) renderAchEdit(r); else renderAchView(r);
    }

    function renderAchView(r) {
        const title = document.createElement('div'); title.className = 'detail-title';
        title.textContent = '[' + r.id + '] ' + r.title;
        achDetails.appendChild(title);

        const link = document.createElement('div'); link.className = 'detail-comment';
        link.textContent = r.link;
        achDetails.appendChild(link);

        const a = document.createElement('div'); a.className = 'detail-actions';
        const bu = document.createElement('button'); bu.className = 'primary'; bu.textContent = '🔓 Открыть в Unlocker';
        bu.addEventListener('click', function () { openUnlockerForAchievement(r.id); });
        a.appendChild(bu);
        const be = document.createElement('button'); be.className = 'edit'; be.textContent = '✎ Редактировать';
        be.addEventListener('click', function () { isEditingAch = true; renderAchDetails(); });
        a.appendChild(be);
        const bl = document.createElement('button'); bl.textContent = '🔗 Открыть на RA';
        bl.addEventListener('click', function () { window.open(r.link, '_blank', 'noopener,noreferrer'); });
        a.appendChild(bl);
        achDetails.appendChild(a);
    }

    function renderAchEdit(r) {
        const entry = ACHS[r.id] || {};
        const h = document.createElement('div'); h.className = 'edit-header'; h.textContent = 'Редактирование достижения #' + r.id;
        achDetails.appendChild(h);

        const titleRow = document.createElement('div'); titleRow.className = 'edit-row';
        const titleLabel = document.createElement('label'); titleLabel.textContent = 'Название:';
        const titleInput = document.createElement('input'); titleInput.type = 'text'; titleInput.value = entry.title || ''; titleInput.readOnly = true; titleInput.placeholder = 'Подтянется с RA';
        const titleRefresh = document.createElement('button'); titleRefresh.className = 'refresh-name'; titleRefresh.textContent = '🔄 Обновить с RA';
        titleRefresh.addEventListener('click', function () {
            titleRefresh.disabled = true; titleRefresh.textContent = '⏳ Загрузка...';
            fetchAchievementInfo(r.id).then(function (info) {
                titleInput.value = info.full;
                toast('Название обновлено: ' + info.full);
            }).catch(function (err) { toast('Ошибка RA: ' + err.message, 'err'); }).then(function () {
                titleRefresh.disabled = false; titleRefresh.textContent = '🔄 Обновить с RA';
            });
        });
        titleRow.appendChild(titleLabel); titleRow.appendChild(titleInput); titleRow.appendChild(titleRefresh);
        achDetails.appendChild(titleRow);

        const linkRow = document.createElement('div'); linkRow.className = 'edit-row';
        const linkLabel = document.createElement('label'); linkLabel.textContent = 'Ссылка:';
        const linkInput = document.createElement('input'); linkInput.type = 'text'; linkInput.value = entry.link || ('https://retroachievements.org/achievement/' + r.id); linkInput.placeholder = 'https://retroachievements.org/achievement/...';
        linkRow.appendChild(linkLabel); linkRow.appendChild(linkInput); achDetails.appendChild(linkRow);

        const actions = document.createElement('div'); actions.className = 'detail-actions';
        const btnSave = document.createElement('button'); btnSave.className = 'primary'; btnSave.textContent = '✓ Сохранить';
        btnSave.addEventListener('click', function () {
            const obj = {};
            const t = titleInput.value.trim();
            const l = linkInput.value.trim();
            if (t) obj.title = t;
            if (l) obj.link = l;
            if (Object.keys(obj).length === 0) delete ACHS[r.id];
            else ACHS[r.id] = obj;
            GM_setValue(STORAGE_ACHS, JSON.stringify(ACHS));
            isEditingAch = false;
            renderAchTable(); renderAchDetails(); refreshAchievementPageUI();
        });
        actions.appendChild(btnSave);

        const btnCancel = document.createElement('button'); btnCancel.textContent = '✕ Отмена';
        btnCancel.addEventListener('click', function () { isEditingAch = false; renderAchDetails(); });
        actions.appendChild(btnCancel);

        const btnDelete = document.createElement('button'); btnDelete.className = 'danger'; btnDelete.textContent = '🗑 Удалить';
        btnDelete.addEventListener('click', function () {
            if (!confirm('Удалить достижение #' + r.id + '?')) return;
            delete ACHS[r.id];
            GM_setValue(STORAGE_ACHS, JSON.stringify(ACHS));
            currentAchId = null; isEditingAch = false;
            renderAchTable(); renderAchDetails(); refreshAchievementPageUI();
        });
        actions.appendChild(btnDelete);

        achDetails.appendChild(actions);
    }

    function clearAchFilters() {
        filterAchText = '';
        achSearch.value = '';
        renderAchTable();
    }

    function bindAchsUI() {
        achSearch.addEventListener('input', function () { filterAchText = achSearch.value.trim(); renderAchTable(); });

        achsPanel.querySelectorAll('th[data-sort]').forEach(function (th) {
            th.addEventListener('click', function () {
                const col = th.dataset.sort;
                if (sortAchColumn === col) sortAchAsc = !sortAchAsc; else { sortAchColumn = col; sortAchAsc = true; }
                achsPanel.querySelectorAll('th[data-sort]').forEach(function (t) { t.classList.remove('sorted-asc', 'sorted-desc'); });
                th.classList.add(sortAchAsc ? 'sorted-asc' : 'sorted-desc');
                renderAchTable();
            });
        });

        achsPanel.addEventListener('click', function (e) {
            const btn = e.target.closest('button[data-act]');
            if (!btn) return;
            const act = btn.dataset.act;
            if (act === 'fetch-achs') { fetchAchs().catch(function () {}); }
            else if (act === 'add-current-ach') {
                const id = getCurrentAchievementId();
                if (!id) { toast('Откройте страницу достижения', 'err'); return; }
                const already = !!ACHS[id];
                if (!ACHS[id]) ACHS[id] = {};
                currentAchId = id; isEditingAch = true;
                renderAchTable(); renderAchDetails();
                if (!already || !ACHS[id].title) {
                    toast('Загрузка названия с RA...', 'info');
                    fetchAchievementInfo(id).then(function (info) {
                        if (!ACHS[id]) ACHS[id] = {};
                        ACHS[id].title = info.full;
                        ACHS[id].link = 'https://retroachievements.org/achievement/' + id;
                        GM_setValue(STORAGE_ACHS, JSON.stringify(ACHS));
                        toast('Название получено: ' + info.full);
                        if (currentAchId === id && isEditingAch) renderAchDetails();
                        renderAchTable();
                    }).catch(function (err) { toast('Ошибка RA: ' + err.message, 'err'); });
                }
            }
            else if (act === 'save-achs') { GM_setValue(STORAGE_ACHS, JSON.stringify(ACHS)); toast('Достижения сохранены'); }
            else if (act === 'export-achs') { exportAchs(); toast('Файл raachievements.json сохранён'); }
            else if (act === 'clear-ach-filters') { clearAchFilters(); }
        });
    }

    function exportAchs() {
        const json = JSON.stringify(ACHS, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'raachievements.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    // ============================================================
    // UNLOCKER — логика
    // ============================================================
    const uUI = {
        status: unlockerPanel.querySelector('#raru-unlocker-status'),
        user: unlockerPanel.querySelector('#raru-unlocker-user'),
        pass: unlockerPanel.querySelector('#raru-unlocker-pass'),
        token: unlockerPanel.querySelector('#raru-unlocker-token'),
        md5: unlockerPanel.querySelector('#raru-unlocker-md5'),
        achs: unlockerPanel.querySelector('#raru-unlocker-achs'),
        hardcore: unlockerPanel.querySelector('#raru-unlocker-hardcore'),
        seconds: unlockerPanel.querySelector('#raru-unlocker-seconds'),
        presence: unlockerPanel.querySelector('#raru-unlocker-presence'),
        achList: unlockerPanel.querySelector('#raru-unlocker-ach-list'),
        log: unlockerPanel.querySelector('#raru-unlocker-log')
    };

    function ulog(msg, type) {
        const t = new Date().toLocaleTimeString();
        unlockerLogLines.push({ t: t, msg: msg, type: type || '' });
        if (unlockerLogLines.length > 300) unlockerLogLines.shift();
        const div = document.createElement('div');
        if (type) div.className = type;
        div.textContent = '[' + t + '] ' + msg;
        uUI.log.appendChild(div);
        uUI.log.scrollTop = uUI.log.scrollHeight;
    }
    function usetStatus(text, cls) {
        uUI.status.textContent = text;
        uUI.status.className = 'unlocker-status' + (cls ? ' ' + cls : '');
    }

    function unlockerGetConfig() {
        try {
            const raw = GM_getValue(STORAGE_UNLOCK_CFG, null);
            if (raw) return JSON.parse(raw);
        } catch (e) {}
        return { user: '', pass: '', md5: '', achs: '', hardcore: 1, seconds: 300, presence: 'In menu, Stage 1, Boss fight' };
    }
    function unlockerSetConfig(cfg) {
        GM_setValue(STORAGE_UNLOCK_CFG, JSON.stringify(cfg));
    }
    function unlockerGetToken() {
        const tok = GM_getValue(STORAGE_UNLOCK_TOKEN, '');
        const usr = GM_getValue(STORAGE_UNLOCK_TOKEN_USER, '');
        const cfg = unlockerGetConfig();
        if (tok && usr && usr === cfg.user) return tok;
        return '';
    }
    function unlockerSetToken(token, user) {
        GM_setValue(STORAGE_UNLOCK_TOKEN, token || '');
        GM_setValue(STORAGE_UNLOCK_TOKEN_USER, user || '');
        uUI.token.textContent = token ? token.slice(0, 8) + '…' + token.slice(-4) : '—';
    }

    function unlockerLoadConfigIntoUI() {
        const cfg = unlockerGetConfig();
        uUI.user.value = cfg.user || '';
        uUI.pass.value = cfg.pass || '';
        uUI.md5.value = cfg.md5 || '';
        uUI.achs.value = cfg.achs || '';
        uUI.hardcore.value = String(cfg.hardcore || 0);
        uUI.seconds.value = String(cfg.seconds || 300);
        uUI.presence.value = cfg.presence || 'In menu, Stage 1, Boss fight';
        const tok = unlockerGetToken();
        uUI.token.textContent = tok ? tok.slice(0, 8) + '…' + tok.slice(-4) : '—';
    }

    function unlockerSaveConfigFromUI() {
        const cfg = {
            user: uUI.user.value.trim(),
            pass: uUI.pass.value,
            md5: uUI.md5.value.trim().toLowerCase(),
            achs: uUI.achs.value.trim(),
            hardcore: parseInt(uUI.hardcore.value, 10) || 0,
            seconds: parseInt(uUI.seconds.value, 10) || 300,
            presence: uUI.presence.value.trim() || 'In menu'
        };
        unlockerSetConfig(cfg);
        return cfg;
    }

    function unlockerPost(payload) {
        return new Promise(function (resolve, reject) {
            const body = Object.keys(payload).map(function (k) {
                return encodeURIComponent(k) + '=' + encodeURIComponent(payload[k] == null ? '' : payload[k]);
            }).join('&');
            GM_xmlhttpRequest({
                method: 'POST',
                url: UNLOCK_DOREQUEST,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': UNLOCK_UA
                },
                data: body,
                timeout: 20000,
                onload: function (res) {
                    if (res.status >= 200 && res.status < 300) {
                        let j;
                        try { j = JSON.parse(res.responseText); }
                        catch (e) { j = { _raw: res.responseText }; }
                        resolve(j);
                    } else if (res.status === 401 || res.status === 403) {
                        reject(new Error('HTTP ' + res.status + ' (неверный логин/токен или доступ запрещён)'));
                    } else {
                        reject(new Error('HTTP ' + res.status + ': ' + (res.responseText || '').slice(0, 200)));
                    }
                },
                onerror: function () { reject(new Error('Сетевая ошибка')); },
                ontimeout: function () { reject(new Error('Таймаут')); }
            });
        });
    }

    function unlockerLogin() {
        const cfg = unlockerSaveConfigFromUI();
        if (!cfg.user || !cfg.pass) throw new Error('Введите логин и пароль');
        ulog('login2 для ' + cfg.user + '...', 'info');
        return unlockerPost({ r: 'login2', u: cfg.user, p: cfg.pass }).then(function (data) {
            const token = data && data.Token;
            if (!token) throw new Error('login2 не вернул Token: ' + JSON.stringify(data));
            unlockerSetToken(token, cfg.user);
            ulog('login2 ok, token=' + token.slice(0, 8) + '...', 'ok');
            usetStatus('Токен получен', 'done');
            return token;
        });
    }

    function unlockerResolveGameId(token, md5) {
        const cfg = unlockerGetConfig();
        return unlockerPost({ r: 'gameid', u: cfg.user, t: token, m: md5 }).then(function (data) {
            const gid = data && data.GameID;
            if (!gid) throw new Error('gameid: неизвестный хеш ' + md5 + ' — ' + JSON.stringify(data));
            ulog('gameid ' + md5 + ' -> ' + gid, 'ok');
            return parseInt(gid, 10);
        });
    }

    function unlockerFetchPatch(token, gameId) {
        const cfg = unlockerGetConfig();
        return unlockerPost({ r: 'patch', u: cfg.user, t: token, g: gameId }).then(function (data) {
            const n = data && data.PatchData ? Object.keys(data.PatchData).length : 0;
            ulog('patch g=' + gameId + ': ' + n + ' определений ачивок', 'info');
            return data;
        });
    }

    function unlockerFetchUnlocks(token, gameId, hardcore) {
        const cfg = unlockerGetConfig();
        return unlockerPost({ r: 'unlocks', u: cfg.user, t: token, g: gameId, h: hardcore }).then(function (data) {
            const ids = new Set((data && data.UserUnlocks) || []);
            ulog('unlocks g=' + gameId + ' hc=' + hardcore + ': уже есть ' + ids.size, 'info');
            return ids;
        });
    }

    function unlockerStartSession(token, gameId, md5, hardcore) {
        const cfg = unlockerGetConfig();
        return unlockerPost({ r: 'startsession', u: cfg.user, t: token, g: gameId, m: md5, h: hardcore }).then(function (data) {
            ulog('startsession g=' + gameId + ' hc=' + hardcore, 'ok');
            return data;
        });
    }

    function unlockerPing(token, gameId, md5, presence) {
        const cfg = unlockerGetConfig();
        return unlockerPost({ r: 'ping', u: cfg.user, t: token, g: gameId, m: presence, m2: md5 }).then(function (data) {
            ulog('ping g=' + gameId + ' presence=' + JSON.stringify(presence), 'info');
            return data;
        });
    }

    function unlockerAchievementWonData(token, achId, hardcore) {
        const cfg = unlockerGetConfig();
        return unlockerPost({ r: 'achievementwondata', u: cfg.user, t: token, a: achId, h: hardcore }).then(function (data) {
            ulog('achievementwondata a=' + achId + ': NumAchieved=' + (data && data.NumAchieved), 'info');
            return data;
        });
    }

    function md5hex(str) {
        // Простая реализация MD5 (hex)
        function rotl(x, n) { return (x << n) | (x >>> (32 - n)); }
        function tohex(n) {
            let s = '', i;
            for (i = 0; i < 4; i++) s += ((n >> (i * 8 + 4)) & 0xf).toString(16) + ((n >> (i * 8)) & 0xf).toString(16);
            return s;
        }
        function utf8(s) {
            return unescape(encodeURIComponent(s));
        }
        const bytes = utf8(str);
        const len = bytes.length;
        const words = [];
        for (let i = 0; i < len; i++) words[i >> 2] |= (bytes.charCodeAt(i) & 0xff) << ((i % 4) * 8);
        words[len >> 2] |= 0x80 << ((len % 4) * 8);
        const bitLen = len * 8;
        words[(bitLen + 64 >>> 9 << 4) + 14] = bitLen;
        let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
        function ff(a, b, c, d, x, s, t) { return rotl(a + ((b & c) | (~b & d)) + x + t, s) + b; }
        function gg(a, b, c, d, x, s, t) { return rotl(a + ((b & d) | (c & ~d)) + x + t, s) + b; }
        function hh(a, b, c, d, x, s, t) { return rotl(a + (b ^ c ^ d) + x + t, s) + b; }
        function ii(a, b, c, d, x, s, t) { return rotl(a + (c ^ (b | ~d)) + x + t, s) + b; }
        for (let i = 0; i < words.length; i += 16) {
            const oa = a, ob = b, oc = c, od = d;
            a = ff(a, b, c, d, words[i] || 0, 7, -680876936);
            d = ff(d, a, b, c, words[i + 1] || 0, 12, -389564586);
            c = ff(c, d, a, b, words[i + 2] || 0, 17, 606105819);
            b = ff(b, c, d, a, words[i + 3] || 0, 22, -1044525330);
            a = ff(a, b, c, d, words[i + 4] || 0, 7, -176418897);
            d = ff(d, a, b, c, words[i + 5] || 0, 12, 1200080426);
            c = ff(c, d, a, b, words[i + 6] || 0, 17, -1473231341);
            b = ff(b, c, d, a, words[i + 7] || 0, 22, -45705983);
            a = ff(a, b, c, d, words[i + 8] || 0, 7, 1770035416);
            d = ff(d, a, b, c, words[i + 9] || 0, 12, -1958414417);
            c = ff(c, d, a, b, words[i + 10] || 0, 17, -42063);
            b = ff(b, c, d, a, words[i + 11] || 0, 22, -1990404162);
            a = ff(a, b, c, d, words[i + 12] || 0, 7, 1804603682);
            d = ff(d, a, b, c, words[i + 13] || 0, 12, -40341101);
            c = ff(c, d, a, b, words[i + 14] || 0, 17, -1502002290);
            b = ff(b, c, d, a, words[i + 15] || 0, 22, 1236535329);
            a = gg(a, b, c, d, words[i + 1] || 0, 5, -165796510);
            d = gg(d, a, b, c, words[i + 6] || 0, 9, -1069501632);
            c = gg(c, d, a, b, words[i + 11] || 0, 14, 643717713);
            b = gg(b, c, d, a, words[i] || 0, 20, -373897302);
            a = gg(a, b, c, d, words[i + 5] || 0, 5, -701558691);
            d = gg(d, a, b, c, words[i + 10] || 0, 9, 38016083);
            c = gg(c, d, a, b, words[i + 15] || 0, 14, -660478335);
            b = gg(b, c, d, a, words[i + 4] || 0, 20, -405537848);
            a = gg(a, b, c, d, words[i + 9] || 0, 5, 568446438);
            d = gg(d, a, b, c, words[i + 14] || 0, 9, -1019803690);
            c = gg(c, d, a, b, words[i + 3] || 0, 14, -187363961);
            b = gg(b, c, d, a, words[i + 8] || 0, 20, 1163531501);
            a = gg(a, b, c, d, words[i + 13] || 0, 5, -1444681467);
            d = gg(d, a, b, c, words[i + 2] || 0, 9, -51403784);
            c = gg(c, d, a, b, words[i + 7] || 0, 14, 1735328473);
            b = gg(b, c, d, a, words[i + 12] || 0, 20, -1926607734);
            a = hh(a, b, c, d, words[i + 5] || 0, 4, -378558);
            d = hh(d, a, b, c, words[i + 8] || 0, 11, -2022574463);
            c = hh(c, d, a, b, words[i + 11] || 0, 16, 1839030562);
            b = hh(b, c, d, a, words[i + 14] || 0, 23, -35309556);
            a = hh(a, b, c, d, words[i + 1] || 0, 4, -1530992060);
            d = hh(d, a, b, c, words[i + 4] || 0, 11, 1272893353);
            c = hh(c, d, a, b, words[i + 7] || 0, 16, -155497632);
            b = hh(b, c, d, a, words[i + 10] || 0, 23, -1094730640);
            a = hh(a, b, c, d, words[i + 13] || 0, 4, 681279174);
            d = hh(d, a, b, c, words[i] || 0, 11, -358537222);
            c = hh(c, d, a, b, words[i + 3] || 0, 16, -722521979);
            b = hh(b, c, d, a, words[i + 6] || 0, 23, 76029189);
            a = hh(a, b, c, d, words[i + 9] || 0, 4, -640364487);
            d = hh(d, a, b, c, words[i + 12] || 0, 11, -421815835);
            c = hh(c, d, a, b, words[i + 15] || 0, 16, 530742520);
            b = hh(b, c, d, a, words[i + 2] || 0, 23, -995338651);
            a = ii(a, b, c, d, words[i] || 0, 6, -198630844);
            d = ii(d, a, b, c, words[i + 7] || 0, 10, 1126891415);
            c = ii(c, d, a, b, words[i + 14] || 0, 15, -1416354905);
            b = ii(b, c, d, a, words[i + 5] || 0, 21, -57434055);
            a = ii(a, b, c, d, words[i + 12] || 0, 6, 1700485571);
            d = ii(d, a, b, c, words[i + 3] || 0, 10, -1894986606);
            c = ii(c, d, a, b, words[i + 10] || 0, 15, -1051523);
            b = ii(b, c, d, a, words[i + 1] || 0, 21, -2054922799);
            a = ii(a, b, c, d, words[i + 8] || 0, 6, 1873313359);
            d = ii(d, a, b, c, words[i + 15] || 0, 10, -30611744);
            c = ii(c, d, a, b, words[i + 6] || 0, 15, -1560198380);
            b = ii(b, c, d, a, words[i + 13] || 0, 21, 1309151649);
            a = ii(a, b, c, d, words[i + 4] || 0, 6, -145523070);
            d = ii(d, a, b, c, words[i + 11] || 0, 10, -1120210379);
            c = ii(c, d, a, b, words[i + 2] || 0, 15, 718787259);
            b = ii(b, c, d, a, words[i + 9] || 0, 21, -343485551);
            a = (a + oa) | 0; b = (b + ob) | 0; c = (c + oc) | 0; d = (d + od) | 0;
        }
        return (tohex(a) + tohex(b) + tohex(c) + tohex(d)).toLowerCase();
    }

    function unlockerAward(token, achId, hardcore) {
        const cfg = unlockerGetConfig();
        const v = md5hex(String(achId) + token + String(hardcore));
        return unlockerPost({ r: 'awardachievement', u: cfg.user, t: token, a: achId, h: hardcore, v: v }).then(function (data) {
            const ok = data && data.Success;
            ulog('award a=' + achId + ' hc=' + hardcore + ' Success=' + ok + ' Score=' + (data && data.Score), ok ? 'ok' : 'err');
            if (!ok) ulog('payload: ' + JSON.stringify(data), 'err');
            return data;
        });
    }

    function unlockerSchedule(totalSeconds, n) {
        if (n <= 0) return [];
        let lo = 15, hi = Math.max(30, totalSeconds - 15);
        if (hi - lo < n) hi = lo + n;
        const arr = [];
        while (arr.length < n) {
            const v = lo + Math.floor(Math.random() * (hi - lo));
            if (arr.indexOf(v) === -1) arr.push(v);
        }
        arr.sort(function (a, b) { return a - b; });
        return arr;
    }

    function unlockerSleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function parsePresenceList(raw) {
        return (raw || '').split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
    }

    async function unlockerRun() {
        if (unlockerRunning) { toast('Уже запущено', 'err'); return; }
        const cfg = unlockerSaveConfigFromUI();
        if (!cfg.user || !cfg.pass) { usetStatus('Ошибка: нужны логин/пароль', 'err'); return; }
        if (!/^[0-9a-f]{32}$/.test(cfg.md5)) { usetStatus('Ошибка: MD5 должен быть 32 hex-символа', 'err'); return; }
        const achsList = cfg.achs.split(',').map(function (s) { return parseInt(s.trim(), 10); }).filter(function (n) { return n > 0; });
        if (achsList.length === 0) { usetStatus('Ошибка: укажите хотя бы одну ачивку', 'err'); return; }

        unlockerRunning = true;
        unlockerStop = false;
        usetStatus('Запущено...', 'running');
        ulog('=== Старт: ' + achsList.length + ' ачивок, hc=' + cfg.hardcore + ', ' + cfg.seconds + 'с ===', 'info');

        try {
            let token = unlockerGetToken();
            if (!token) {
                ulog('Токена нет, логинимся...', 'info');
                token = await unlockerLogin();
            }

            let gameId;
            try {
                gameId = await unlockerResolveGameId(token, cfg.md5);
            } catch (e) {
                ulog('Токен отклонён (' + e.message + '), перелогин', 'err');
                token = await unlockerLogin();
                gameId = await unlockerResolveGameId(token, cfg.md5);
            }

            await unlockerFetchPatch(token, gameId);
            const already = await unlockerFetchUnlocks(token, gameId, cfg.hardcore);
            await unlockerStartSession(token, gameId, cfg.md5, cfg.hardcore);

            const todo = achsList.filter(function (a) { return !already.has(a); });
            if (todo.length !== achsList.length) {
                ulog('Пропускаем уже выбитые: ' + achsList.filter(function (a) { return already.has(a); }).join(', '), 'info');
            }
            if (todo.length === 0) {
                ulog('Все ачивки уже выбиты — нечего делать', 'ok');
                usetStatus('Все ачивки уже выбиты', 'done');
                unlockerRunning = false;
                return;
            }

            const presenceList = parsePresenceList(cfg.presence);
            if (presenceList.length === 0) presenceList.push('Playing');

            const delays = unlockerSchedule(cfg.seconds, todo.length);
            const t0 = Date.now();
            let nextPing = t0 + 5000 + Math.random() * 10000;

            for (let i = 0; i < todo.length; i++) {
                if (unlockerStop) { ulog('Остановлено пользователем', 'err'); usetStatus('Остановлено', 'err'); break; }
                const achId = todo[i];
                const target = t0 + delays[i] * 1000;

                while (Date.now() < target && !unlockerStop) {
                    const now = Date.now();
                    if (now >= nextPing) {
                        try {
                            const p = presenceList[Math.floor(Math.random() * presenceList.length)];
                            await unlockerPing(token, gameId, cfg.md5, p);
                        } catch (e) { ulog('ping failed: ' + e.message, 'err'); }
                        nextPing = Date.now() + (UNLOCK_PING_INTERVAL + (Math.random() * 2 - 1) * UNLOCK_PING_JITTER) * 1000;
                    } else {
                        const sleepMs = Math.min(1000, Math.min(target, nextPing) - now);
                        await unlockerSleep(Math.max(0, sleepMs));
                    }
                }
                if (unlockerStop) { usetStatus('Остановлено', 'err'); break; }

                await unlockerSleep(500 + Math.random() * 2000);
                try {
                    await unlockerAchievementWonData(token, achId, cfg.hardcore);
                    await unlockerAward(token, achId, cfg.hardcore);
                } catch (e) {
                    ulog('Ошибка award a=' + achId + ': ' + e.message, 'err');
                }
            }

            if (!unlockerStop) {
                ulog('=== Завершено ===', 'ok');
                usetStatus('Завершено', 'done');
            }
        } catch (e) {
            ulog('КРИТИЧЕСКАЯ ОШИБКА: ' + e.message, 'err');
            usetStatus('Ошибка: ' + e.message, 'err');
        } finally {
            unlockerRunning = false;
        }
    }

    function openUnlockerForAchievement(achId) {
        unlockerLoadConfigIntoUI();
        uUI.achs.value = String(achId);
        unlockerSaveConfigFromUI();
        unlockerPanel.classList.remove('hidden');
        uUI.log.scrollTop = uUI.log.scrollHeight;
    }

    function openUnlockerForGame(gameId) {
        unlockerLoadConfigIntoUI();
        // Попробуем подтянуть MD5 из игры, если есть на странице
        unlockerPanel.classList.remove('hidden');
        ulog('Открыто для игры #' + gameId + '. Проверьте MD5 и нажмите «Подхватить ачивки игры».', 'info');
    }

    // Парсинг ачивок со страницы игры (для подхвата)
    function collectAchievementsFromPage() {
        const out = [];
        const links = document.querySelectorAll('a[href*="/achievement/"]');
        const seen = {};
        links.forEach(function (a) {
            const m = (a.getAttribute('href') || '').match(/\/achievement\/(\d+)/);
            if (!m) return;
            const id = m[1];
            if (seen[id]) return;
            seen[id] = true;
            // Ищем заголовок рядом
            let title = '';
            const card = a.closest('li, div[class*="achievement"], article');
            if (card) {
                const tEl = card.querySelector('[class*="title"], h3, h4, strong');
                if (tEl) title = (tEl.textContent || '').trim();
            }
            if (!title) title = (a.textContent || '').trim();
            out.push({ id: id, title: title, points: 0 });
        });
        return out;
    }

    function renderUnlockerAchList(achs) {
        uUI.achList.innerHTML = '';
        if (!achs || achs.length === 0) {
            uUI.achList.innerHTML = '<em style="color:#666;font-size:12px;">Ничего не найдено.</em>';
            return;
        }
        achs.forEach(function (a) {
            const label = document.createElement('label');
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.value = a.id;
            cb.checked = true;
            const idSpan = document.createElement('span'); idSpan.className = 'ach-id'; idSpan.textContent = a.id;
            const titleSpan = document.createElement('span'); titleSpan.className = 'ach-title'; titleSpan.textContent = a.title || ('Ачивка #' + a.id);
            const ptSpan = document.createElement('span'); ptSpan.className = 'ach-points'; ptSpan.textContent = a.points ? ('★' + a.points) : '';
            label.appendChild(cb); label.appendChild(idSpan); label.appendChild(titleSpan); label.appendChild(ptSpan);
            uUI.achList.appendChild(label);
        });
    }

    function bindUnlockerUI() {
        // Автосохранение конфига при вводе
        ['user', 'pass', 'md5', 'achs', 'hardcore', 'seconds', 'presence'].forEach(function (k) {
            const el = uUI[k];
            if (!el) return;
            el.addEventListener('change', function () { unlockerSaveConfigFromUI(); });
        });

        unlockerPanel.addEventListener('click', async function (e) {
            const btn = e.target.closest('button[data-act]');
            if (!btn) return;
            const act = btn.dataset.act;
            try {
                if (act === 'login') {
                    btn.disabled = true;
                    usetStatus('Логин...', 'running');
                    try { await unlockerLogin(); } finally { btn.disabled = false; }
                }
                else if (act === 'check-token') {
                    const tok = unlockerGetToken();
                    if (!tok) { toast('Сначала войдите', 'err'); return; }
                    const cfg = unlockerSaveConfigFromUI();
                    if (!cfg.md5) { toast('Введите MD5', 'err'); return; }
                    btn.disabled = true;
                    try {
                        const gid = await unlockerResolveGameId(tok, cfg.md5);
                        usetStatus('Токен валиден. GameID=' + gid, 'done');
                        toast('GameID=' + gid);
                    } finally { btn.disabled = false; }
                }
                else if (act === 'clear-token') {
                    if (!confirm('Очистить сохранённый токен?')) return;
                    unlockerSetToken('', '');
                    usetStatus('Токен очищен', '');
                }
                else if (act === 'fetch-game-achs') {
                    unlockerSaveConfigFromUI();
                    const fromPage = collectAchievementsFromPage();
                    if (fromPage.length > 0) {
                        ulog('Подхвачено со страницы: ' + fromPage.length, 'ok');
                        renderUnlockerAchList(fromPage);
                        return;
                    }
                    const tok = unlockerGetToken();
                    if (!tok) { toast('Нет токена — войдите', 'err'); return; }
                    const cfg = unlockerGetConfig();
                    if (!cfg.md5) { toast('Введите MD5', 'err'); return; }
                    btn.disabled = true;
                    usetStatus('Загрузка ачивок игры...', 'running');
                    try {
                        const gid = await unlockerResolveGameId(tok, cfg.md5);
                        const patch = await unlockerFetchPatch(tok, gid);
                        const pd = (patch && patch.PatchData) || {};
                        const list = Object.keys(pd).map(function (id) {
                            return { id: id, title: pd[id].Title || ('Ачивка #' + id), points: pd[id].Points || 0 };
                        });
                        ulog('patch: ' + list.length + ' ачивок', 'ok');
                        renderUnlockerAchList(list);
                        usetStatus('Ачивки загружены: ' + list.length, 'done');
                    } finally { btn.disabled = false; }
                }
                else if (act === 'select-all-achs') {
                    uUI.achList.querySelectorAll('input[type="checkbox"]').forEach(function (c) { c.checked = true; });
                }
                else if (act === 'deselect-all-achs') {
                    uUI.achList.querySelectorAll('input[type="checkbox"]').forEach(function (c) { c.checked = false; });
                }
                else if (act === 'apply-selected') {
                    const ids = [];
                    uUI.achList.querySelectorAll('input[type="checkbox"]:checked').forEach(function (c) { ids.push(c.value); });
                    uUI.achs.value = ids.join(', ');
                    unlockerSaveConfigFromUI();
                    toast('В поле ID: ' + ids.length + ' ачивок');
                }
                else if (act === 'run') { unlockerRun(); }
                else if (act === 'stop') { unlockerStop = true; usetStatus('Останавливаемся...', 'running'); }
            } catch (err) {
                ulog('Ошибка: ' + err.message, 'err');
                usetStatus('Ошибка: ' + err.message, 'err');
            }
        });
    }

    // ---------- Горячие клавиши ----------
    document.addEventListener('keydown', function (e) {
        if (e.ctrlKey && e.shiftKey) {
            if (e.key === 'E' || e.key === 'e' || e.code === 'KeyE') {
                e.preventDefault(); e.stopPropagation();
                gamesPanel.classList.toggle('hidden');
                if (!gamesPanel.classList.contains('hidden')) {
                    rebuildGameConsoleOptions(); renderGameTable(); renderGameDetails();
                }
            }
            if (e.key === 'X' || e.key === 'x' || e.code === 'KeyX') {
                e.preventDefault(); e.stopPropagation();
                achsPanel.classList.toggle('hidden');
                if (!achsPanel.classList.contains('hidden')) {
                    renderAchTable(); renderAchDetails();
                }
            }
            if (e.key === 'U' || e.key === 'u' || e.code === 'KeyU') {
                e.preventDefault(); e.stopPropagation();
                unlockerPanel.classList.toggle('hidden');
                if (!unlockerPanel.classList.contains('hidden')) {
                    unlockerLoadConfigIntoUI();
                }
            }
        }
    }, true);

    // ---------- Пункт меню профиля ----------
    function injectMenuItems() {
        const signOut = findMenuLinkByText('Sign out');
        if (!signOut) return;
        if (document.querySelector('[data-ra-menu="1"]')) return;
        const dataItem = signOut.cloneNode(true);
        dataItem.dataset.raMenu = '1';
        dataItem.removeAttribute('href');
        dataItem.style.cursor = 'pointer';
        setTextContent(dataItem, 'Получить последние данные');
        dataItem.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            fetchGames().catch(function () {});
        });
        signOut.insertAdjacentElement('beforebegin', dataItem);
    }
    function findMenuLinkByText(text) {
        const target = text.toLowerCase().trim();
        const candidates = document.querySelectorAll('a, button, [role="menuitem"], li');
        for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i];
            if (el.children.length > 2) continue;
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (t === target) return el;
        }
        return null;
    }

    // ---------- Загрузка кэша при старте ----------
    try {
        const cachedGames = GM_getValue(STORAGE_GAMES, null);
        if (cachedGames) { try { GAME_ID_TO_URL = JSON.parse(cachedGames); gamesLoaded = true; } catch (e) {} }
        const cachedAchs = GM_getValue(STORAGE_ACHS, null);
        if (cachedAchs) { try { ACHS = JSON.parse(cachedAchs); achLoaded = true; } catch (e) {} }
    } catch (e) {}

    function tick() {
        if (gamesLoaded) {
            applyReplacements();
            applyStatusBadge();
            applyComment();
        }
        if (achLoaded) applyAchievementUnlockButton();
        injectMenuItems();
    }

    const observer = new MutationObserver(function () {
        if (gamesLoaded) applyReplacements();
        if (achLoaded) applyAchievementUnlockButton();
        injectMenuItems();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    setInterval(tick, 500);
    window.addEventListener('load', tick);
    document.addEventListener('DOMContentLoaded', tick);
    tick();
    mountUI();
})();