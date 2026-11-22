// ==UserScript==
// @name         RetroAchievements Hashes Replacer
// @namespace    https://retroachievements.org/
// @description  Заменяет 'Supported Game Hashes' на 'Download Game' / 'Русская версия'.
// @version      11.6
// @author       Sianor
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

    // ============================================================
    // КАРТА МОДУЛЕЙ (ищите по заголовкам ==== MODULE: ... ====)
    // ------------------------------------------------------------
    // CONFIG & CONSTANTS           — URL, storage, глобальные переменные
    // API RA (READ-ONLY)           — fetchGameInfo, fetchAchievementInfo
    // DATA: GAMES / ACHS           — загрузка, кэш
    // GAME PAGE REPLACER           — applyReplacements / StatusBadge / Comment
    // UI GAMES (Ctrl+Shift+E)      — таблица, фильтры, редактирование
    // UI ACHS  (Ctrl+Shift+X)      — таблица ачивок
    // ACH PAGE UNLOCK BUTTON       — кнопка "Активировать" + мини-модалка
    // UNLOCKER ENGINE              — login2, gameid, patch, unlocks, startsession, ping, award
    // UNLOCKER PLAN UI (Ctrl+Shift+U) — план с drag&drop и селектором минут
    // MODALS & TOASTS              — общие модалки
    // BOOTSTRAP                    — монтирование, hotkeys, observer, tick
    // ============================================================

    // ==== MODULE: CONFIG & CONSTANTS ====
    const REMOTE_GAMES_URL  = 'https://raw.githubusercontent.com/ktototam54/RAPatchesRUS/refs/heads/main/rahashesreplacer.json';
    const REMOTE_ACHS_URL   = 'https://raw.githubusercontent.com/ktototam54/RAPatchesRUS/refs/heads/main/raachievements.json';
    const STORAGE_GAMES     = 'ra_hashes_replacer_data';
    const STORAGE_ACHS      = 'ra_achievements_data';
    const DOWNLOAD_TEXT = 'Download Game';
    const RU_TEXT = 'Русская версия';

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

    const APP_CFG_A = 'U2lhbm9y';
    const APP_CFG_B = 'NDAxbHpRcWxjRFJvQ3ZjNFFXYXJTbzFNbEFHZm5UTEI=';
    function decodeCfg(str) { try { return atob(str); } catch (e) { return ''; } }

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
                method: 'GET', url: url,
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

    // ==== MODULE: API RA (READ-ONLY) ====
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
                title: data.Title || '', description: data.Description || '',
                points: data.Points || 0, full: data.Title || ('Ачивка #' + achId)
            };
        });
    }

    // ==== MODULE: TOASTS ====
    let toastEl = null, toastTimer = null;
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

    // ==== MODULE: DATA GAMES / ACHS ====
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
            // Синхронизация плана Unlocker с новыми данными
            try {
                if (typeof unlockerLoadPlanFromConfig === 'function') {
                    unlockerLoadPlanFromConfig(unlockerGetConfig());
                }
            } catch (e) {}
        }).catch(function (err) { toast('Ошибка: ' + err.message, 'err'); throw err; });
    }

    // ==== MODULE: GAME PAGE REPLACER ====
    function findTextNode(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        let node;
        while ((node = walker.nextNode())) if (node.textContent.trim().length > 0) return node;
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

        document.querySelectorAll('a[href*="/hashes"]').forEach(function (original) {
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
                    clone.dataset.raRu = '1'; clone.dataset.raReplaced = '1';
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

        // EN + RU варианты
        const wantToPlay =
            findButtonByText('Want to Play') ||
            findButtonByText('Want to play') ||
            findButtonByText('Хочу сыграть') ||
            findButtonByText('Хочу играть');
        if (!wantToPlay) return;

        const meta = STATUS_META[entry.status];
        const badge = wantToPlay.cloneNode(true);
        badge.dataset.raStatusBadge = '1';
        badge.removeAttribute('href'); badge.removeAttribute('id');
        badge.style.cursor = 'default'; badge.style.pointerEvents = 'none';
        badge.style.color = meta.color; badge.style.borderColor = meta.border; badge.style.background = meta.bg;
        badge.querySelectorAll('svg').forEach(function (el) { el.remove(); });
        badge.querySelectorAll('img').forEach(function (el) { el.remove(); });
        badge.textContent = '';
        const txt = document.createElement('span');
        txt.textContent = meta.text; txt.style.color = meta.color;
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
            if ((el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase() === target) return el;
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
        label.className = 'ra-game-comment-label'; label.textContent = 'Комментарий';
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
                    first.insertAdjacentElement('beforebegin', block); return;
                }
            }
        }
        let shots = null;
        const candidates = document.querySelectorAll('div[class*="grid-cols-2"]');
        for (let i = 0; i < candidates.length; i++) if (candidates[i].querySelector('img')) { shots = candidates[i]; break; }
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
        applyReplacements(); applyStatusBadge(); applyComment();
    }
    // ==== MODULE: CSS ====
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
        '.raru-panel.unlocker { width: 520px; height: auto; max-height: 82vh; }',
        '.raru-panel.unlocker .db-title::before { content: "🔓"; }',
        '.raru-panel .unlocker-body { padding: 10px; display: flex; flex-direction: column; gap: 8px; max-height: calc(82vh - 40px); overflow-y: auto; }',
        '.raru-panel .unlocker-section { border: 1px solid #40444b; border-radius: 6px; padding: 8px; background: #2c2f33; display: flex; flex-direction: column; gap: 6px; }',
        '.raru-panel .unlocker-section-title { color: #f4a900; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }',
        '.raru-panel .unlocker-row { display: flex; gap: 8px; align-items: center; }',
        '.raru-panel .unlocker-row label { color: #b9bbbe; font-size: 12px; min-width: 120px; }',
        '.raru-panel .unlocker-row input, .raru-panel .unlocker-row select, .raru-panel .unlocker-row textarea { background: #23272a; color: #dcddde; border: 1px solid #4f545c; border-radius: 4px; padding: 5px 8px; font-size: 12px; font-family: inherit; flex: 1; box-sizing: border-box; }',
        '.raru-panel .unlocker-row textarea { min-height: 44px; resize: vertical; }',
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
        '.raru-panel .unlocker-log { background: #1a1a1a; border: 1px solid #333; border-radius: 4px; padding: 6px; font-family: monospace; font-size: 11px; color: #b9bbbe; height: 90px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }',
        '.raru-panel .unlocker-log .err { color: #f87171; }',
        '.raru-panel .unlocker-log .ok { color: #68d391; }',
        '.raru-panel .unlocker-log .info { color: #63b3ed; }',
        '.raru-panel .unlocker-status { font-size: 12px; color: #b9bbbe; padding: 6px 10px; border-radius: 4px; background: #23272a; border: 1px solid #40444b; }',
        '.raru-panel .unlocker-status.running { color: #f4a900; border-color: #f4a900; background: rgba(244,169,0,0.1); }',
        '.raru-panel .unlocker-status.done { color: #68d391; border-color: #38a169; background: rgba(104,211,145,0.1); }',
        '.raru-panel .unlocker-status.err { color: #f87171; border-color: #8a3a3a; background: rgba(248,113,113,0.1); }',
        '.raru-panel .unlocker-plan { max-height: 220px; overflow-y: auto; border: 1px solid #40444b; border-radius: 4px; padding: 4px; background: #23272a; display: flex; flex-direction: column; gap: 4px; }',
        '.raru-panel .unlocker-plan .plan-row { display: flex; align-items: center; gap: 6px; padding: 4px 6px; background: #2c2f33; border-radius: 4px; border: 1px solid #383c42; cursor: grab; }',
        '.raru-panel .unlocker-plan .plan-row.dragging { opacity: 0.5; }',
        '.raru-panel .unlocker-plan .plan-row.done { opacity: 0.55; border-color: #38a169; }',
        '.raru-panel .unlocker-plan .plan-row .drag { color: #888; font-family: monospace; cursor: grab; }',
        '.raru-panel .unlocker-plan .plan-row .ach-icon { font-size: 14px; }',
        '.raru-panel .unlocker-plan .plan-row .ach-id { font-family: monospace; color: #b9bbbe; min-width: 56px; }',
        '.raru-panel .unlocker-plan .plan-row .ach-title { flex: 1; color: #fff; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
        '.raru-panel .unlocker-plan .plan-row select { background: #23272a; color: #dcddde; border: 1px solid #4f545c; border-radius: 4px; padding: 2px 4px; font-size: 11px; }',
        '.raru-panel .unlocker-plan .plan-row .rm { background: transparent; color: #f87171; border: none; cursor: pointer; font-size: 13px; padding: 0 4px; }',
        '.raru-panel .unlocker-plan .plan-row .rm:hover { color: #fff; background: #6b2a2a; border-radius: 3px; }',

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
        '#raru-toast.info { background: #2b6cb0; }',

        // Modal (quick unlock on ach page)
        '#raru-quick-modal { display: none; position: fixed; inset: 0; z-index: 1000002; }',
        '#raru-quick-modal .raru-modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.6); }',
        '#raru-quick-modal .raru-modal-box { position: relative; margin: 10vh auto 0; width: 420px; max-width: 92vw; background: #23272a; color: #dcddde; border: 1px solid #40444b; border-radius: 8px; padding: 14px; box-shadow: 0 10px 40px rgba(0,0,0,0.7); font-size: 13px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }',
        '#raru-quick-modal .raru-modal-title { color: #f4a900; font-weight: 600; font-size: 14px; margin-bottom: 10px; }',
        '#raru-quick-modal .raru-modal-row { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }',
        '#raru-quick-modal .raru-modal-row label { min-width: 120px; color: #b9bbbe; font-size: 12px; }',
        '#raru-quick-modal .raru-modal-row input, #raru-quick-modal .raru-modal-row select { flex: 1; background: #2c2f33; color: #dcddde; border: 1px solid #4f545c; border-radius: 4px; padding: 5px 8px; font-size: 12px; box-sizing: border-box; }',
        '#raru-quick-modal .raru-modal-actions { display: flex; gap: 8px; margin-top: 10px; }',
        '#raru-quick-modal .raru-modal-actions button { background: #40444b; color: #dcddde; border: 1px solid #4f545c; border-radius: 4px; padding: 6px 12px; cursor: pointer; font-size: 12px; font-weight: 600; }',
        '#raru-quick-modal .raru-modal-actions button.primary { background: #276749; border-color: #38a169; color: #fff; }',
        '#raru-quick-modal .raru-modal-actions button:disabled { opacity: 0.4; cursor: not-allowed; }',
        '#raru-quick-modal .raru-modal-log { margin-top: 8px; background: #1a1a1a; border: 1px solid #333; border-radius: 4px; padding: 6px; font-family: monospace; font-size: 11px; color: #b9bbbe; height: 90px; overflow-y: auto; white-space: pre-wrap; }',
        '#raru-quick-modal .raru-modal-log .err { color: #f87171; }',
        '#raru-quick-modal .raru-modal-log .ok { color: #68d391; }',
        '#raru-quick-modal .raru-modal-log .info { color: #63b3ed; }'
    ].join('\n');

    const styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    (document.head || document.documentElement).appendChild(styleEl);

    // ==== MODULE: UI GAMES PANEL ====
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

    // ==== MODULE: UI ACHS PANEL ====
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

    // ==== MODULE: UI UNLOCKER PANEL ====
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
                    '<button data-act="check-token">Проверить токен</button>' +
                    '<button class="danger" data-act="clear-token">Очистить токен</button>' +
                '</div>' +
            '</div>' +
            '<div class="unlocker-section">' +
                '<div class="unlocker-section-title">Параметры</div>' +
                '<div class="unlocker-row"><label>Хеш ROM (MD5):</label><input type="text" id="raru-unlocker-md5" placeholder="32 hex" maxlength="32" /></div>' +
                '<div class="unlocker-row"><label>Хардкор:</label><select id="raru-unlocker-hardcore"><option value="0">Softcore</option><option value="1">Hardcore</option></select></div>' +
                '<div class="unlocker-row"><label>Rich Presence:</label><textarea id="raru-unlocker-presence" placeholder="In menu, Stage 1, Boss fight"></textarea></div>' +
            '</div>' +
            '<div class="unlocker-section">' +
                '<div class="unlocker-section-title">План разблокировки</div>' +
                '<div class="unlocker-actions" style="margin-bottom:6px;">' +
                '<button data-act="plan-add-ach">+ Добавить ачивку</button>' +
                '<button class="primary" data-act="plan-parse-page">📥 Парсить со страницы игры</button>' +
                '<button data-act="plan-clear">✕ Очистить</button>' +
                '</div>' +
                '<div class="unlocker-plan" id="raru-unlocker-plan"></div>' +
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
    // ==== MODULE: BOOTSTRAP MOUNT ====
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
            tr.appendChild(td); gamesTbody.appendChild(tr); return;
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
                currentGameId = r.id; isEditingGame = false;
                renderGameTable(); renderGameDetails();
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
                link: e.link || ('https://retroachievements.org/achievement/' + id),
                minutes: e.minutes || 0
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
            tdLink.style.fontSize = '12px'; tdLink.style.color = '#63b3ed';
            tdLink.textContent = r.link + (r.minutes ? ' (' + r.minutes + ' мин)' : '');

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
        const be = document.createElement('button'); be.className = 'edit'; be.textContent = '✎ Редактировать';
        be.addEventListener('click', function () { isEditingAch = true; renderAchDetails(); });
        a.appendChild(be);
        const bl = document.createElement('button'); bl.textContent = '🔗 Открыть на RA';
        bl.addEventListener('click', function () { window.open(r.link, '_blank', 'noopener,noreferrer'); });
        a.appendChild(bl);
        const badd = document.createElement('button'); badd.className = 'primary'; badd.textContent = '+ В план Unlocker';
        badd.addEventListener('click', function () {
            if (!unlockerPlan.find(function (p) { return p.id === r.id; })) {
                const entry = ACHS[r.id] || {};
                unlockerPlan.push({
                    id: r.id,
                    title: entry.title || r.title,
                    minutes: entry.minutes || 5,
                    done: false, startedAt: null, finishedAt: null
                });
                unlockerSavePlanToConfig();
                toast('Добавлено в план: #' + r.id);
            } else {
                toast('Уже в плане', 'info');
            }
        });
        a.appendChild(badd);
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

        const md5Row = document.createElement('div'); md5Row.className = 'edit-row';
        const md5Label = document.createElement('label'); md5Label.textContent = 'MD5 игры:';
        const md5Input = document.createElement('input'); md5Input.type = 'text'; md5Input.value = entry.md5 || ''; md5Input.placeholder = '32 hex (опционально)'; md5Input.maxLength = 32;
        md5Row.appendChild(md5Label); md5Row.appendChild(md5Input); achDetails.appendChild(md5Row);

        const minRow = document.createElement('div'); minRow.className = 'edit-row';
        const minLabel = document.createElement('label'); minLabel.textContent = 'Задержка (мин):';
        const minInput = document.createElement('input'); minInput.type = 'number'; minInput.min = '1'; minInput.max = '600'; minInput.value = String(entry.minutes || 5);
        minRow.appendChild(minLabel); minRow.appendChild(minInput); achDetails.appendChild(minRow);

        const presRow = document.createElement('div'); presRow.className = 'edit-row';
        const presLabel = document.createElement('label'); presLabel.textContent = 'Rich Presence:';
        const presInput = document.createElement('input'); presInput.type = 'text'; presInput.value = entry.presence || ''; presInput.placeholder = 'In menu, Stage 1 (опционально)';
        presRow.appendChild(presLabel); presRow.appendChild(presInput); achDetails.appendChild(presRow);

        const actions = document.createElement('div'); actions.className = 'detail-actions';
        const btnSave = document.createElement('button'); btnSave.className = 'primary'; btnSave.textContent = '✓ Сохранить';
        btnSave.addEventListener('click', function () {
            const obj = ACHS[r.id] || {};
            const t = titleInput.value.trim();
            const l = linkInput.value.trim();
            const m = md5Input.value.trim().toLowerCase();
            const mins = parseInt(minInput.value, 10) || 5;
            const pres = presInput.value.trim();
            if (t) obj.title = t;
            if (l) obj.link = l;
            if (m && /^[0-9a-f]{32}$/.test(m)) obj.md5 = m; else delete obj.md5;
            obj.minutes = mins;
            if (pres) obj.presence = pres; else delete obj.presence;
            ACHS[r.id] = obj;
            GM_setValue(STORAGE_ACHS, JSON.stringify(ACHS));
            // Обновить план если есть
            const p = unlockerPlan.find(function (x) { return x.id === r.id; });
            if (p) { p.title = obj.title || p.title; p.minutes = mins; unlockerRenderPlan(); }
            unlockerSavePlanToConfig();
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
                        if (!ACHS[id].minutes) ACHS[id].minutes = 5;
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
    // ACH PAGE UNLOCK BUTTON + QUICK MODAL
    // ============================================================
    function applyAchievementUnlockButton() {
        const achId = getCurrentAchievementId();
        if (!achId) return;
        if (!ACHS || !ACHS[achId]) return; // показываем только если ачивка есть в базе
        const anchor =
            findButtonByText('Report an issue') ||
            findButtonByText('Сообщить о проблеме') ||
            findButtonByText('Report Issue');
        if (!anchor) return;
        if (anchor.previousElementSibling && anchor.previousElementSibling.dataset.raUnlockBtn === '1') return;

        const btn = document.createElement('button');
        btn.dataset.raUnlockBtn = '1';
        btn.textContent = '🔓 Активировать';
        btn.style.background = '#1a7f37'; btn.style.color = '#fff';
        btn.style.border = '1px solid #2ea043'; btn.style.borderRadius = '6px';
        btn.style.padding = '4px 12px'; btn.style.fontWeight = '600';
        btn.style.fontSize = '13px'; btn.style.cursor = 'pointer';
        btn.style.marginRight = '8px';
        btn.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            openAchQuickUnlockModal(achId);
        });
        anchor.parentElement.insertBefore(btn, anchor);
    }

    function refreshAchievementPageUI() {
        document.querySelectorAll('[data-ra-unlock-btn="1"]').forEach(function (el) { el.remove(); });
        applyAchievementUnlockButton();
    }

    let quickModalEl = null;
    function ensureQuickModal() {
        if (quickModalEl) return quickModalEl;
        const m = document.createElement('div');
        m.id = 'raru-quick-modal';
        m.innerHTML =
            '<div class="raru-modal-backdrop"></div>' +
            '<div class="raru-modal-box">' +
                '<div class="raru-modal-title">Быстрая разблокировка</div>' +
                '<div class="raru-modal-row"><label>Логин:</label><input type="text" id="raru-qm-user" autocomplete="username" /></div>' +
                '<div class="raru-modal-row"><label>Пароль:</label><input type="password" id="raru-qm-pass" autocomplete="current-password" /></div>' +
                '<div class="raru-modal-row" id="raru-qm-cred-hint" style="display:none;color:#68d391;font-size:12px;">Логин/пароль уже сохранены — можно оставить поля пустыми</div>' +
                '<div class="raru-modal-row"><label>Режим:</label><select id="raru-qm-hardcore"><option value="0">Softcore</option><option value="1">Hardcore</option></select></div>' +
                '<div class="raru-modal-row"><label>Ачивка:</label><span id="raru-qm-ach" style="color:#f4a900;font-weight:600;"></span></div>' +
                '<div class="raru-modal-row"><label>Задержка (мин):</label><input type="number" id="raru-qm-minutes" min="0" max="600" value="1" /></div>' +
                '<div class="raru-modal-actions">' +
                    '<button class="primary" data-act="qm-run">▶ Активировать</button>' +
                    '<button data-act="qm-cancel">✕ Отмена</button>' +
                '</div>' +
                '<div class="raru-modal-log" id="raru-qm-log"></div>' +
            '</div>';
        document.body.appendChild(m);
        m.addEventListener('click', function (e) {
            if (e.target.classList.contains('raru-modal-backdrop')) closeQuickModal();
            const btn = e.target.closest('button[data-act]');
            if (!btn) return;
            if (btn.dataset.act === 'qm-cancel') closeQuickModal();
            else if (btn.dataset.act === 'qm-run') runQuickUnlock(btn);
        });
        quickModalEl = m;
        return m;
    }

    function closeQuickModal() { if (quickModalEl) quickModalEl.style.display = 'none'; }

    function openAchQuickUnlockModal(achId) {
        const m = ensureQuickModal();
        const entry = ACHS[achId] || {};
        const cfg = unlockerGetConfig();
        const hasCreds = !!(cfg.user && (cfg.pass || unlockerGetToken()));
        m.querySelector('#raru-qm-user').value = hasCreds ? '' : (cfg.user || '');
        m.querySelector('#raru-qm-pass').value = hasCreds ? '' : (cfg.pass || '');
        m.querySelector('#raru-qm-user').placeholder = hasCreds ? '(сохранён)' : 'Sianor';
        m.querySelector('#raru-qm-pass').placeholder = hasCreds ? '(сохранён)' : '••••••••';
        m.querySelector('#raru-qm-cred-hint').style.display = hasCreds ? 'block' : 'none';
        m.querySelector('#raru-qm-hardcore').value = String(cfg.hardcore || 0);
        m.querySelector('#raru-qm-ach').textContent = '#' + achId + ' — ' + (entry.title || '');
        m.querySelector('#raru-qm-minutes').value = String(entry.minutes || 1);
        m.querySelector('#raru-qm-log').textContent = '';
        m.style.display = 'block';
    }

    async function runQuickUnlock(btn) {
        const m = quickModalEl;
        const achId = getCurrentAchievementId();
        if (!achId) return;
        const entry = ACHS[achId] || {};
        const logEl = m.querySelector('#raru-qm-log');
        const log = function (msg, cls) {
            const d = document.createElement('div');
            if (cls) d.className = cls;
            d.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
            logEl.appendChild(d);
            logEl.scrollTop = logEl.scrollHeight;
        };

        const cfg = unlockerGetConfig();
        const userIn = m.querySelector('#raru-qm-user').value.trim();
        const passIn = m.querySelector('#raru-qm-pass').value;
        const user = userIn || cfg.user;
        const pass = passIn || cfg.pass;
        if (!user) { log('Нужен логин', 'err'); return; }
        const hardcore = parseInt(m.querySelector('#raru-qm-hardcore').value, 10) || 0;
       let minutes = parseInt(m.querySelector('#raru-qm-minutes').value, 10);
        if (isNaN(minutes) || minutes < 0) minutes = 0;
        const md5 = (entry.md5 || cfg.md5 || '').toLowerCase();
        if (!/^[0-9a-f]{32}$/.test(md5)) {
            log('Нет MD5 (заполните md5 в записи ачивки через Ctrl+Shift+X)', 'err'); return;
        }

        if (userIn || passIn) { cfg.user = user; cfg.pass = pass; unlockerSetConfig(cfg); }

        btn.disabled = true;
        log('Старт: #' + achId + ', hc=' + hardcore + ', задержка=' + minutes + ' мин', 'info');
        try {
            await unlockerRunSingle({
                token: unlockerGetToken(),
                user: user, pass: pass, md5: md5,
                achId: parseInt(achId, 10), hardcore: hardcore,
                delayMs: minutes * 60 * 1000,
                presenceList: parsePresenceList(entry.presence || cfg.presence || 'In menu'),
                log: log
            });
            log('Готово', 'ok');
        } catch (e) { log('Ошибка: ' + e.message, 'err'); }
        finally { btn.disabled = false; }
    }

    // ============================================================
    // UNLOCKER — ENGINE
    // ============================================================
    const uUI = {
        status: unlockerPanel.querySelector('#raru-unlocker-status'),
        user: unlockerPanel.querySelector('#raru-unlocker-user'),
        pass: unlockerPanel.querySelector('#raru-unlocker-pass'),
        token: unlockerPanel.querySelector('#raru-unlocker-token'),
        md5: unlockerPanel.querySelector('#raru-unlocker-md5'),
        hardcore: unlockerPanel.querySelector('#raru-unlocker-hardcore'),
        presence: unlockerPanel.querySelector('#raru-unlocker-presence'),
        plan: unlockerPanel.querySelector('#raru-unlocker-plan'),
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
        return { user: '', pass: '', md5: '', hardcore: 0, presence: 'In menu, Stage 1, Boss fight', plan: [] };
    }
    function unlockerSetConfig(cfg) { GM_setValue(STORAGE_UNLOCK_CFG, JSON.stringify(cfg)); }
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
        if (uUI.token) uUI.token.textContent = token ? token.slice(0, 8) + '…' + token.slice(-4) : '—';
    }

    function unlockerLoadConfigIntoUI() {
        const cfg = unlockerGetConfig();
        uUI.user.value = cfg.user || '';
        uUI.pass.value = cfg.pass || '';
        uUI.md5.value = cfg.md5 || '';
        uUI.hardcore.value = String(cfg.hardcore || 0);
        uUI.presence.value = cfg.presence || 'In menu, Stage 1, Boss fight';
        const tok = unlockerGetToken();
        uUI.token.textContent = tok ? tok.slice(0, 8) + '…' + tok.slice(-4) : '—';
        unlockerLoadPlanFromConfig(cfg);
    }

    function unlockerSaveConfigFromUI() {
        const cfg = unlockerGetConfig();
        cfg.user = uUI.user.value.trim();
        cfg.pass = uUI.pass.value;
        cfg.md5 = uUI.md5.value.trim().toLowerCase();
        cfg.hardcore = parseInt(uUI.hardcore.value, 10) || 0;
        cfg.presence = uUI.presence.value.trim() || 'In menu';
        cfg.plan = unlockerPlan.map(function (p) { return { id: p.id, title: p.title, minutes: p.minutes }; });
        unlockerSetConfig(cfg);
        return cfg;
    }

    function unlockerPost(payload) {
        return new Promise(function (resolve, reject) {
            const body = Object.keys(payload).map(function (k) {
                return encodeURIComponent(k) + '=' + encodeURIComponent(payload[k] == null ? '' : payload[k]);
            }).join('&');
            GM_xmlhttpRequest({
                method: 'POST', url: UNLOCK_DOREQUEST,
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UNLOCK_UA },
                data: body, timeout: 20000,
                onload: function (res) {
                    if (res.status >= 200 && res.status < 300) {
                        let j; try { j = JSON.parse(res.responseText); } catch (e) { j = { _raw: res.responseText }; }
                        resolve(j);
                    } else if (res.status === 401 || res.status === 403) {
                        reject(new Error('HTTP ' + res.status + ' (неверный логин/токен)'));
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
            ulog('login2 ok', 'ok'); usetStatus('Токен получен', 'done');
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
            ulog('patch g=' + gameId + ': ' + n + ' ачивок', 'info');
            return data;
        });
    }

    function unlockerFetchUnlocks(token, gameId, hardcore) {
        const cfg = unlockerGetConfig();
        return unlockerPost({ r: 'unlocks', u: cfg.user, t: token, g: gameId, h: hardcore }).then(function (data) {
            const ids = new Set((data && data.UserUnlocks) || []);
            ulog('unlocks: уже есть ' + ids.size, 'info');
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
            ulog('ping presence=' + JSON.stringify(presence), 'info');
            return data;
        });
    }

    function unlockerAchievementWonData(token, achId, hardcore) {
        const cfg = unlockerGetConfig();
        return unlockerPost({ r: 'achievementwondata', u: cfg.user, t: token, a: achId, h: hardcore }).then(function (data) {
            ulog('wondata a=' + achId, 'info');
            return data;
        });
    }

    // Простейший MD5 (hex) — для подписи award
    function md5hex(str) {
        function rotl(x, n) { return (x << n) | (x >>> (32 - n)); }
        function tohex(n) { let s = '', i; for (i = 0; i < 4; i++) s += ((n >> (i * 8 + 4)) & 0xf).toString(16) + ((n >> (i * 8)) & 0xf).toString(16); return s; }
        function utf8(s) { return unescape(encodeURIComponent(s)); }
        const bytes = utf8(str); const len = bytes.length; const words = [];
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
            a = ff(a, b, c, d, words[i] || 0, 7, -680876936); d = ff(d, a, b, c, words[i + 1] || 0, 12, -389564586);
            c = ff(c, d, a, b, words[i + 2] || 0, 17, 606105819); b = ff(b, c, d, a, words[i + 3] || 0, 22, -1044525330);
            a = ff(a, b, c, d, words[i + 4] || 0, 7, -176418897); d = ff(d, a, b, c, words[i + 5] || 0, 12, 1200080426);
            c = ff(c, d, a, b, words[i + 6] || 0, 17, -1473231341); b = ff(b, c, d, a, words[i + 7] || 0, 22, -45705983);
            a = ff(a, b, c, d, words[i + 8] || 0, 7, 1770035416); d = ff(d, a, b, c, words[i + 9] || 0, 12, -1958414417);
            c = ff(c, d, a, b, words[i + 10] || 0, 17, -42063); b = ff(b, c, d, a, words[i + 11] || 0, 22, -1990404162);
            a = ff(a, b, c, d, words[i + 12] || 0, 7, 1804603682); d = ff(d, a, b, c, words[i + 13] || 0, 12, -40341101);
            c = ff(c, d, a, b, words[i + 14] || 0, 17, -1502002290); b = ff(b, c, d, a, words[i + 15] || 0, 22, 1236535329);
            a = gg(a, b, c, d, words[i + 1] || 0, 5, -165796510); d = gg(d, a, b, c, words[i + 6] || 0, 9, -1069501632);
            c = gg(c, d, a, b, words[i + 11] || 0, 14, 643717713); b = gg(b, c, d, a, words[i] || 0, 20, -373897302);
            a = gg(a, b, c, d, words[i + 5] || 0, 5, -701558691); d = gg(d, a, b, c, words[i + 10] || 0, 9, 38016083);
            c = gg(c, d, a, b, words[i + 15] || 0, 14, -660478335); b = gg(b, c, d, a, words[i + 4] || 0, 20, -405537848);
            a = gg(a, b, c, d, words[i + 9] || 0, 5, 568446438); d = gg(d, a, b, c, words[i + 14] || 0, 9, -1019803690);
            c = gg(c, d, a, b, words[i + 3] || 0, 14, -187363961); b = gg(b, c, d, a, words[i + 8] || 0, 20, 1163531501);
            a = gg(a, b, c, d, words[i + 13] || 0, 5, -1444681467); d = gg(d, a, b, c, words[i + 2] || 0, 9, -51403784);
            c = gg(c, d, a, b, words[i + 7] || 0, 14, 1735328473); b = gg(b, c, d, a, words[i + 12] || 0, 20, -1926607734);
            a = hh(a, b, c, d, words[i + 5] || 0, 4, -378558); d = hh(d, a, b, c, words[i + 8] || 0, 11, -2022574463);
            c = hh(c, d, a, b, words[i + 11] || 0, 16, 1839030562); b = hh(b, c, d, a, words[i + 14] || 0, 23, -35309556);
            a = hh(a, b, c, d, words[i + 1] || 0, 4, -1530992060); d = hh(d, a, b, c, words[i + 4] || 0, 11, 1272893353);
            c = hh(c, d, a, b, words[i + 7] || 0, 16, -155497632); b = hh(b, c, d, a, words[i + 10] || 0, 23, -1094730640);
            a = hh(a, b, c, d, words[i + 13] || 0, 4, 681279174); d = hh(d, a, b, c, words[i] || 0, 11, -358537222);
            c = hh(c, d, a, b, words[i + 3] || 0, 16, -722521979); b = hh(b, c, d, a, words[i + 6] || 0, 23, 76029189);
            a = hh(a, b, c, d, words[i + 9] || 0, 4, -640364487); d = hh(d, a, b, c, words[i + 12] || 0, 11, -421815835);
            c = hh(c, d, a, b, words[i + 15] || 0, 16, 530742520); b = hh(b, c, d, a, words[i + 2] || 0, 23, -995338651);
            a = ii(a, b, c, d, words[i] || 0, 6, -198630844); d = ii(d, a, b, c, words[i + 7] || 0, 10, 1126891415);
            c = ii(c, d, a, b, words[i + 14] || 0, 15, -1416354905); b = ii(b, c, d, a, words[i + 5] || 0, 21, -57434055);
            a = ii(a, b, c, d, words[i + 12] || 0, 6, 1700485571); d = ii(d, a, b, c, words[i + 3] || 0, 10, -1894986606);
            c = ii(c, d, a, b, words[i + 10] || 0, 15, -1051523); b = ii(b, c, d, a, words[i + 1] || 0, 21, -2054922799);
            a = ii(a, b, c, d, words[i + 8] || 0, 6, 1873313359); d = ii(d, a, b, c, words[i + 15] || 0, 10, -30611744);
            c = ii(c, d, a, b, words[i + 6] || 0, 15, -1560198380); b = ii(b, c, d, a, words[i + 13] || 0, 21, 1309151649);
            a = ii(a, b, c, d, words[i + 4] || 0, 6, -145523070); d = ii(d, a, b, c, words[i + 11] || 0, 10, -1120210379);
            c = ii(c, d, a, b, words[i + 2] || 0, 15, 718787259); b = ii(b, c, d, a, words[i + 9] || 0, 21, -343485551);
            a = (a + oa) | 0; b = (b + ob) | 0; c = (c + oc) | 0; d = (d + od) | 0;
        }
        return (tohex(a) + tohex(b) + tohex(c) + tohex(d)).toLowerCase();
    }

    function unlockerAward(token, achId, hardcore) {
        const cfg = unlockerGetConfig();
        const v = md5hex(String(achId) + token + String(hardcore));
        return unlockerPost({ r: 'awardachievement', u: cfg.user, t: token, a: achId, h: hardcore, v: v }).then(function (data) {
            const ok = data && data.Success;
            ulog('award a=' + achId + ' Success=' + ok, ok ? 'ok' : 'err');
            return data;
        });
    }

    function unlockerSleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
    function parsePresenceList(raw) { return (raw || '').split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s; }); }

    // Одиночная разблокировка (для quick modal)
    async function unlockerRunSingle(opts) {
        const { user, pass, md5, achId, hardcore, delayMs, presenceList, log } = opts;
        let token = opts.token || unlockerGetToken();
        if (!token) {
            const data = await unlockerPost({ r: 'login2', u: user, p: pass });
            token = data && data.Token;
            if (!token) throw new Error('login2 не вернул Token: ' + JSON.stringify(data));
            unlockerSetToken(token, user);
            log('login2 ok', 'ok');
        }
        let gameId;
        try { gameId = await unlockerResolveGameId(token, md5); }
        catch (e) {
            log('Токен отклонён, перелогин', 'err');
            const data = await unlockerPost({ r: 'login2', u: user, p: pass });
            token = data && data.Token;
            if (!token) throw new Error('login2 не вернул Token');
            unlockerSetToken(token, user);
            gameId = await unlockerResolveGameId(token, md5);
        }
        await unlockerStartSession(token, gameId, md5, hardcore);
        const already = await unlockerFetchUnlocks(token, gameId, hardcore);
        if (already.has(achId)) { log('Уже выбита ранее', 'info'); return; }
                const plist = (presenceList && presenceList.length) ? presenceList : ['Playing'];

        if (delayMs <= 0) {
            // 0 минут — один пинг и сразу выдача
            try { await unlockerPing(token, gameId, md5, plist[Math.floor(Math.random() * plist.length)]); }
            catch (e) { log('ping failed: ' + e.message, 'err'); }
            if (unlockerStop) { log('Остановлено', 'err'); return; }
            await unlockerAchievementWonData(token, achId, hardcore);
            await unlockerAward(token, achId, hardcore);
            return;
        }

        const t0 = Date.now();
        const target = t0 + delayMs;
        let nextPing = t0 + 5000 + Math.random() * 10000;
        while (Date.now() < target && !unlockerStop) {
            const now = Date.now();
            if (now >= nextPing) {
                try { await unlockerPing(token, gameId, md5, plist[Math.floor(Math.random() * plist.length)]); }
                catch (e) { log('ping failed: ' + e.message, 'err'); }
                nextPing = Date.now() + (UNLOCK_PING_INTERVAL + (Math.random() * 2 - 1) * UNLOCK_PING_JITTER) * 1000;
            } else {
                const sleepMs = Math.min(1000, Math.min(target, nextPing) - now);
                await unlockerSleep(Math.max(0, sleepMs));
            }
        }
        if (unlockerStop) { log('Остановлено', 'err'); return; }
        await unlockerSleep(500 + Math.random() * 1500);
        await unlockerAchievementWonData(token, achId, hardcore);
        await unlockerAward(token, achId, hardcore);
    }

    // Плановая разблокировка (для Unlocker UI)
    async function unlockerRun() {
        if (unlockerRunning) { toast('Уже запущено', 'err'); return; }
        const cfg = unlockerSaveConfigFromUI();
        if (!cfg.user || !cfg.pass) { usetStatus('Ошибка: нужны логин/пароль', 'err'); return; }
        if (!/^[0-9a-f]{32}$/.test(cfg.md5)) { usetStatus('Ошибка: MD5 должен быть 32 hex', 'err'); return; }
        if (!unlockerPlan || unlockerPlan.length === 0) { usetStatus('Ошибка: план пуст', 'err'); return; }

        unlockerRunning = true;
        unlockerStop = false;
        usetStatus('Запущено...', 'running');
        ulog('=== Старт: ' + unlockerPlan.length + ' ачивок ===', 'info');

        try {
            let token = unlockerGetToken();
            if (!token) { ulog('Токена нет, логинимся...', 'info'); token = await unlockerLogin(); }
            let gameId;
            try { gameId = await unlockerResolveGameId(token, cfg.md5); }
            catch (e) {
                ulog('Токен отклонён, перелогин', 'err');
                token = await unlockerLogin();
                gameId = await unlockerResolveGameId(token, cfg.md5);
            }
            await unlockerFetchPatch(token, gameId);
            const already = await unlockerFetchUnlocks(token, gameId, cfg.hardcore);
            await unlockerStartSession(token, gameId, cfg.md5, cfg.hardcore);

            const presenceList = parsePresenceList(cfg.presence);
            if (presenceList.length === 0) presenceList.push('Playing');

            let nextPing = Date.now() + 5000 + Math.random() * 10000;

            while (!unlockerStop) {
                const item = unlockerPlan.find(function (p) { return !p.done; });
                if (!item) break;

                if (already.has(item.id)) {
                    ulog('Уже выбита: ' + item.id, 'info');
                    item.done = true; unlockerRenderPlan();
                    continue;
                }

                                item.startedAt = Date.now();
                const isZero = item.minutes === 0;
                const target = item.startedAt + item.minutes * 60 * 1000;
                ulog('▶ #' + item.id + (isZero ? ' (0 мин — мгновенный финиш остальных)' : ' через ' + item.minutes + ' мин'), 'info');
                unlockerRenderPlan();

                // --- 0 минут: 1 пинг и выдать всё оставшееся разом ---
                if (isZero) {
                    // Один пинг (Rich Presence), чтобы сервер "увидел" сессию
                    try {
                        const p = presenceList[Math.floor(Math.random() * presenceList.length)];
                        await unlockerPing(token, gameId, cfg.md5, p);
                    } catch (e) { ulog('ping failed: ' + e.message, 'err'); }

                    // Выдаём ВСЁ, что осталось (включая текущую), по порядку, без пауз и пингов
                    while (!unlockerStop) {
                        const next = unlockerPlan.find(function (p) { return !p.done; });
                        if (!next) break;
                        if (already.has(next.id)) {
                            ulog('Уже выбита: ' + next.id, 'info');
                            next.done = true; unlockerRenderPlan();
                            continue;
                        }
                        try {
                            await unlockerAchievementWonData(token, next.id, cfg.hardcore);
                            await unlockerAward(token, next.id, cfg.hardcore);
                            next.done = true; next.finishedAt = Date.now();
                            unlockerRenderPlan();
                        } catch (e) {
                            ulog('Ошибка award #' + next.id + ': ' + e.message, 'err');
                            next.done = true; unlockerRenderPlan();
                        }
                    }
                    break; // выходим из внешнего while — всё разом выдано
                }

                // --- обычное ожидание минут ---
                while (Date.now() < target && !unlockerStop) {
                    const now = Date.now();
                    if (now >= nextPing) {
                        try { await unlockerPing(token, gameId, cfg.md5, presenceList[Math.floor(Math.random() * presenceList.length)]); }
                        catch (e) { ulog('ping failed: ' + e.message, 'err'); }
                        nextPing = Date.now() + (UNLOCK_PING_INTERVAL + (Math.random() * 2 - 1) * UNLOCK_PING_JITTER) * 1000;
                    } else {
                        const sleepMs = Math.min(1000, Math.min(target, nextPing) - now);
                        await unlockerSleep(Math.max(0, sleepMs));
                    }
                }
                if (unlockerStop) break;

                await unlockerSleep(500 + Math.random() * 1500);
                try {
                    await unlockerAchievementWonData(token, item.id, cfg.hardcore);
                    await unlockerAward(token, item.id, cfg.hardcore);
                    item.done = true; item.finishedAt = Date.now();
                    unlockerRenderPlan();
                } catch (e) {
                    ulog('Ошибка award #' + item.id + ': ' + e.message, 'err');
                    item.done = true; unlockerRenderPlan();
                }
            }

            if (unlockerStop) { usetStatus('Остановлено', 'err'); ulog('Остановлено', 'err'); }
            else { usetStatus('Все ачивки выполнены', 'done'); ulog('=== Все выполнены, пинги прекращены ===', 'ok'); }
        } catch (e) {
            ulog('КРИТИЧЕСКАЯ ОШИБКА: ' + e.message, 'err');
            usetStatus('Ошибка: ' + e.message, 'err');
        } finally {
            unlockerRunning = false;
        }
    }

    // ==== MODULE: UNLOCKER PLAN UI ====
    let unlockerPlan = [];
    const PLAN_MINUTES = [1, 2, 5, 10, 15, 20, 30, 40, 60, 90, 120];

    function unlockerRenderPlan() {
        const el = uUI.plan;
        if (!el) return;
        el.innerHTML = '';
        if (!unlockerPlan.length) {
            el.innerHTML = '<em style="color:#666;font-size:12px;padding:6px;">План пуст. Нажмите «+ Добавить ачивку».</em>';
            return;
        }
            unlockerPlan.forEach(function (p, idx) {
            const row = document.createElement('div');
            row.className = 'plan-row' + (p.done ? ' done' : '');
            row.draggable = true;
            row.dataset.idx = String(idx);

            const drag = document.createElement('span'); drag.className = 'drag'; drag.textContent = '☰';
            const icon = document.createElement('span'); icon.className = 'ach-icon'; icon.textContent = '🏆';
            const idS = document.createElement('span'); idS.className = 'ach-id'; idS.textContent = p.id;
            const title = document.createElement('span'); title.className = 'ach-title';
            title.textContent = p.title || ('Ачивка #' + p.id);

            // ← Новый input вместо select
            const minInput = document.createElement('input');
            minInput.type = 'number';
            minInput.min = '0';
            minInput.max = '600';
            minInput.value = String(p.minutes);
            minInput.style.width = '64px';
            minInput.style.background = '#23272a';
            minInput.style.color = '#dcddde';
            minInput.style.border = '1px solid #4f545c';
            minInput.style.borderRadius = '4px';
            minInput.style.padding = '2px 4px';
            minInput.style.fontSize = '11px';
            minInput.style.textAlign = 'center';
            minInput.title = 'Минуты (0 = мгновенно всё оставшееся)';
            minInput.addEventListener('change', function () {
                const v = parseInt(minInput.value, 10);
                p.minutes = (isNaN(v) || v < 0) ? 0 : v;
                minInput.value = String(p.minutes);
                if (p.done) { p.done = false; p.startedAt = null; p.finishedAt = null; }
                unlockerSavePlanToConfig();
            });

            const rm = document.createElement('button');
            rm.className = 'rm'; rm.textContent = '✕'; rm.title = 'Удалить';
            rm.addEventListener('click', function () {
                unlockerPlan.splice(idx, 1);
                unlockerRenderPlan(); unlockerSavePlanToConfig();
            });

            row.appendChild(drag); row.appendChild(icon); row.appendChild(idS);
            row.appendChild(title); row.appendChild(minInput); row.appendChild(rm);
            el.appendChild(row);
        });

        let dragIdx = null;
        el.querySelectorAll('.plan-row').forEach(function (row) {
            row.addEventListener('dragstart', function (e) {
                dragIdx = parseInt(row.dataset.idx, 10);
                row.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', String(dragIdx)); } catch (err) {}
            });
            row.addEventListener('dragend', function () { row.classList.remove('dragging'); dragIdx = null; });
            row.addEventListener('dragover', function (e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
            row.addEventListener('drop', function (e) {
                e.preventDefault();
                if (dragIdx === null) return;
                const dropIdx = parseInt(row.dataset.idx, 10);
                if (dropIdx === dragIdx) return;
                const moved = unlockerPlan.splice(dragIdx, 1)[0];
                unlockerPlan.splice(dropIdx, 0, moved);
                unlockerRenderPlan(); unlockerSavePlanToConfig();
            });
        });
    }

        function unlockerSavePlanToConfig() {
        // План Unlocker хранится ТОЛЬКО в конфиге, НЕ в ACHS (чтобы не попадать в UI Ctrl+Shift+X)
        const cfg = unlockerGetConfig();
        cfg.plan = unlockerPlan.map(function (p) { return { id: p.id, title: p.title, minutes: p.minutes }; });
        unlockerSetConfig(cfg);
    }

            function unlockerLoadPlanFromConfig(cfg) {
        const src = cfg.plan || [];
        unlockerPlan = src.map(function (p) {
            return {
                id: String(p.id),
                title: p.title || '',
                minutes: p.minutes || 1,
                done: false, startedAt: null, finishedAt: null
            };
        });
        unlockerRenderPlan();
        // Подтянуть названия для тех, у кого пусто
        const noTitle = unlockerPlan.filter(function (p) { return !p.title; }).map(function (p) { return p.id; });
        if (noTitle.length) enqueueTitleFetch(noTitle);
    }

    // ==== PARSER: GAME PAGE ACHIEVEMENTS ====
    // Собирает ID ачивок со страницы /game/ID. Названия подтянем через API.
    function parseAchievementsFromGamePage() {
        if (!/^\/game\/\d+/.test(window.location.pathname)) return [];
        const out = [];
        const seen = {};
        const links = document.querySelectorAll('a[href*="/achievement/"]');
        links.forEach(function (a) {
            const m = (a.getAttribute('href') || '').match(/\/achievement\/(\d+)/);
            if (!m) return;
            const id = m[1];
            if (seen[id]) return;
            seen[id] = true;
            out.push({ id: id, title: '' });
        });
        return out;
    }

    let titleFetchQueue = [];
    let titleFetchActive = 0;
    const TITLE_FETCH_PARALLEL = 5;

    function enqueueTitleFetch(ids) {
        ids.forEach(function (id) {
            const p = unlockerPlan.find(function (x) { return x.id === String(id); });
            if (p && p.title) return; // уже есть
            if (titleFetchQueue.indexOf(String(id)) !== -1) return;
            titleFetchQueue.push(String(id));
        });
        pumpTitleFetch();
    }

    function pumpTitleFetch() {
        while (titleFetchActive < TITLE_FETCH_PARALLEL && titleFetchQueue.length > 0) {
            const id = titleFetchQueue.shift();
            titleFetchActive++;
            fetchAchievementInfo(id).then(function (info) {
                const p = unlockerPlan.find(function (x) { return x.id === id; });
                if (p) {
                    p.title = info.full || ('Ачивка #' + id);
                    unlockerRenderPlan();
                    unlockerSavePlanToConfig();
                }
            }).catch(function () {
                const p = unlockerPlan.find(function (x) { return x.id === id; });
                if (p && !p.title) { p.title = 'Ачивка #' + id; unlockerRenderPlan(); }
            }).then(function () {
                titleFetchActive--;
                pumpTitleFetch();
            });
        }
    }

    // ==== CTRL+SHIFT+CLICK по ачивке на странице игры → в план Unlocker ====
    function addAchToPlanById(achId) {
        const id = String(achId);
        if (!unlockerPlan) unlockerPlan = [];
        if (unlockerPlan.find(function (p) { return p.id === id; })) {
            toast('Ачивка #' + id + ' уже в плане', 'info');
            return;
        }
        unlockerPlan.push({
            id: id,
            title: '',
            minutes: 5,
            done: false, startedAt: null, finishedAt: null
        });
        unlockerRenderPlan();
        unlockerSavePlanToConfig();
        enqueueTitleFetch([id]);
        toast('Добавлено в план Unlocker: #' + id);
    }

    function handleAchClickWithModifier(e) {
        // Только на страницах /game/ID и /achievement/ID
        if (!/^\/(game|achievement)\/\d+/.test(window.location.pathname)) return;
        if (!e.ctrlKey || !e.shiftKey) return;

        const a = e.target.closest && e.target.closest('a[href*="/achievement/"]');
        if (!a) return;
        const m = (a.getAttribute('href') || '').match(/\/achievement\/(\d+)/);
        if (!m) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        addAchToPlanById(m[1]);

        // На всякий случай: открываем панель Unlocker, чтобы было видно
        if (unlockerPanel.classList.contains('hidden')) {
            unlockerPanel.classList.remove('hidden');
            unlockerLoadConfigIntoUI();
        }
        return false;
    }

    // Перехватываем клики (capture, чтобы сработало раньше ссылки)
    document.addEventListener('click', handleAchClickWithModifier, true);
    // Некоторые RA-ссылки — <a> с <button> внутри, ловим и mousedown на всякий
    document.addEventListener('auxclick', handleAchClickWithModifier, true);

  function bindUnlockerUI() {
        ['user', 'pass', 'md5', 'hardcore', 'presence'].forEach(function (k) {
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
                    btn.disabled = true; usetStatus('Логин...', 'running');
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
                    if (!confirm('Очистить токен?')) return;
                    unlockerSetToken('', '');
                    usetStatus('Токен очищен', '');
                }
                              else if (act === 'plan-parse-page') {
                    const parsed = parseAchievementsFromGamePage();
                    if (!parsed.length) {
                        toast('На этой странице нет ачивок (откройте /game/ID)', 'err');
                        return;
                    }
                    let added = 0;
                    const newIds = [];
                    parsed.forEach(function (a) {
                        if (unlockerPlan.find(function (p) { return p.id === a.id; })) return;
                        unlockerPlan.push({
                            id: a.id,
                            title: '',
                            minutes: 5,
                            done: false, startedAt: null, finishedAt: null
                        });
                        newIds.push(a.id);
                        added++;
                    });
                    unlockerRenderPlan();
                    unlockerSavePlanToConfig();
                    // Подтянуть названия пакетно
                    if (newIds.length) enqueueTitleFetch(newIds);
                    toast('Добавлено в план: ' + added + ' (всего: ' + unlockerPlan.length + ')');
                }
                  else if (act === 'plan-add-ach') {
                    const raw = prompt('ID ачивки (можно несколько через запятую):', '');
                    if (!raw) return;
                    const ids = raw.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return /^\d+$/.test(s); });
                    if (!ids.length) { toast('Введите числовые ID', 'err'); return; }
                    const newIds = [];
                    ids.forEach(function (id) {
                        if (unlockerPlan.find(function (p) { return p.id === id; })) return;
                        unlockerPlan.push({
                            id: id, title: '',
                            minutes: 5,
                            done: false, startedAt: null, finishedAt: null
                        });
                        newIds.push(id);
                    });
                    if (newIds.length) enqueueTitleFetch(newIds);
                }
                else if (act === 'plan-clear') {
                    if (!confirm('Очистить план?')) return;
                    unlockerPlan = []; unlockerRenderPlan(); unlockerSavePlanToConfig();
                }
                else if (act === 'run') { unlockerRun(); }
                else if (act === 'stop') { unlockerStop = true; usetStatus('Останавливаемся...', 'running'); }
            } catch (err) {
                ulog('Ошибка: ' + err.message, 'err');
                usetStatus('Ошибка: ' + err.message, 'err');
            }
        });
    }

    // ==== MODULE: HOTKEYS ====
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
                if (!achsPanel.classList.contains('hidden')) { renderAchTable(); renderAchDetails(); }
            }
            if (e.key === 'U' || e.key === 'u' || e.code === 'KeyU') {
                e.preventDefault(); e.stopPropagation();
                unlockerPanel.classList.toggle('hidden');
                if (!unlockerPanel.classList.contains('hidden')) { unlockerLoadConfigIntoUI(); }
            }
        }
    }, true);

    // ==== MODULE: PROFILE MENU ITEM ====
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
            toast('Обновляю данные игр и достижений...', 'info');
            fetchGames().catch(function () {});
            fetchAchs().catch(function () {});
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

    // ==== MODULE: BOOTSTRAP ====
    try {
        const cachedGames = GM_getValue(STORAGE_GAMES, null);
        if (cachedGames) { try { GAME_ID_TO_URL = JSON.parse(cachedGames); gamesLoaded = true; } catch (e) {} }
        const cachedAchs = GM_getValue(STORAGE_ACHS, null);
        if (cachedAchs) { try { ACHS = JSON.parse(cachedAchs); achLoaded = true; } catch (e) {} }
    } catch (e) {}

    function tick() {
        if (gamesLoaded) { applyReplacements(); applyStatusBadge(); applyComment(); }
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