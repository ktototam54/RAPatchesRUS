// ==UserScript==
// @name         RetroAchievements Hashes Replacer
// @namespace    https://retroachievements.org/
// @version      8.3
// @description  Заменяет 'Supported Game Hashes' на 'Download Game' / 'Русская версия'. Статусы, комментарии, ссылки на ачивки. UI в стиле базы данных с редактированием.
// @author       You
// @match        https://retroachievements.org/*
// @match        https://www.retroachievements.org/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/ktototam54/RAPatchesRUS/refs/heads/main/rahashesreplacer.js
// @downloadURL  https://raw.githubusercontent.com/ktototam54/RAPatchesRUS/refs/heads/main/rahashesreplacer.js
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const REMOTE_PUBLIC_URL = 'https://raw.githubusercontent.com/ktototam54/RAPatchesRUS/refs/heads/main/rahashesreplacer.json';
    const STORAGE_KEY = 'ra_hashes_replacer_data';
    const TIME_KEY = 'ra_hashes_replacer_last_fetch';
    const DOWNLOAD_TEXT = 'Download Game';
    const RU_TEXT = 'Русская версия';
    const DATA_FRESH_MS = 60 * 60 * 1000;

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
    let dataLoaded = false;
    let dataLoading = false;
    let lastFetchTime = 0;
    let hasChanges = false;
    let wasFresh = false;
    let selectedGameId = null;
    let sortColumn = 'id';
    let sortAsc = true;

    // ---- Фильтры ----
    let filterText = '';
    let filterConsole = '';
    let filterStatus = '';
    let filterDrive = false;
    let filterRu = false;
    let filterComment = false;

    function getCurrentGameId() {
        const m = window.location.pathname.match(/^\/game\/(\d+)/);
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

    function fetchRemoteData() {
        dataLoading = true;
        updateStatus();
        return gmFetch(REMOTE_PUBLIC_URL)
            .then(function (text) {
                let parsed;
                try { parsed = JSON.parse(text); }
                catch (e) { throw new Error('Файл не является JSON'); }
                if (typeof parsed !== 'object' || Array.isArray(parsed)) {
                    throw new Error('Ожидается объект { "id": { drive, ru, status, comment, name } }');
                }
                GAME_ID_TO_URL = parsed;
                dataLoaded = true;
                lastFetchTime = Date.now();
                hasChanges = false;
                wasFresh = true;
                GM_setValue(TIME_KEY, lastFetchTime);
                GM_setValue(STORAGE_KEY, JSON.stringify(parsed));
                refreshAll();
                rebuildConsoleOptions();
                renderTable();
                updateStatus();
            })
            .catch(function (err) {
                dataLoading = false;
                updateStatus('Ошибка: ' + err.message, true);
                throw err;
            });
    }

    function isDataFresh() {
        return lastFetchTime > 0 && (Date.now() - lastFetchTime) < DATA_FRESH_MS;
    }

    function parseName(fullName) {
        if (!fullName) return { name: '', console: '' };
        const m = fullName.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
        if (m) return { name: m[1].trim(), console: m[2].trim() };
        return { name: fullName, console: '' };
    }

    // ---------- Вставка блоков в страницу RA ----------
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
            if (el.children.length === 0 && /^\d+$/.test(el.textContent.trim())) {
                el.remove();
            }
        });
    }

    function bindClick(a, url) {
        a.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
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
        let node;
        let replaced = false;
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
            if (!cs.gap || cs.gap === 'normal' || cs.gap === '0px') {
                badge.style.marginRight = '8px';
            }
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
        let lastIndex = 0;
        let m;
        while ((m = re.exec(raw)) !== null) {
            if (m.index > lastIndex) {
                container.appendChild(document.createTextNode(raw.slice(lastIndex, m.index)));
            }
            const kind = m[1].toLowerCase();
            const value = m[2];
            if (kind === 'ach' || kind === 'achievement') {
                const a = document.createElement('a');
                a.className = 'ra-ach-card';
                a.href = 'https://retroachievements.org/achievement/' + encodeURIComponent(value);
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.title = 'Ачивка #' + value;
                a.textContent = 'Ачивка #' + value;
                container.appendChild(a);
            } else if (kind === 'game') {
                const a = document.createElement('a');
                a.className = 'ra-ach-link';
                a.href = 'https://retroachievements.org/game/' + encodeURIComponent(value);
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.textContent = value;
                container.appendChild(a);
            } else if (kind === 'user') {
                const a = document.createElement('a');
                a.className = 'ra-ach-link';
                a.href = 'https://retroachievements.org/user/' + encodeURIComponent(value);
                a.target = '_blank';
                a.rel = 'noopener noreferrer';
                a.textContent = value;
                container.appendChild(a);
            }
            lastIndex = re.lastIndex;
        }
        if (lastIndex < raw.length) {
            container.appendChild(document.createTextNode(raw.slice(lastIndex)));
        }
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
        block.appendChild(label);
        block.appendChild(text);

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
            if (candidates[i].querySelector('img')) {
                shots = candidates[i];
                break;
            }
        }
        if (shots) {
            shots.insertAdjacentElement('afterend', block);
            return;
        }
        if (baseSet) {
            let el = baseSet;
            for (let i = 0; i < 8; i++) {
                if (!el.parentElement) break;
                el = el.parentElement;
                if (el === document.body) break;
                const cls = (el.className || '').toString();
                if (cls.indexOf('bg-embed') !== -1) {
                    el.insertAdjacentElement('beforebegin', block);
                    return;
                }
            }
            baseSet.insertAdjacentElement('beforebegin', block);
        }
    }

    function refreshAll() {
        document.querySelectorAll('a[data-ra-replaced="1"]').forEach(function (a) {
            a.dataset.raReplaced = '';
        });
        document.querySelectorAll('a[data-ra-ru="1"]').forEach(function (a) {
            a.remove();
        });
        document.querySelectorAll('[data-ra-status-badge="1"]').forEach(function (el) {
            el.remove();
        });
        document.querySelectorAll('[data-ra-comment="1"]').forEach(function (el) {
            el.remove();
        });
        applyReplacements();
        applyStatusBadge();
        applyComment();
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

        '#raru-panel { position: fixed; right: 20px; bottom: 20px; width: 1180px; max-width: 96vw; height: 760px; max-height: 92vh; background: #23272a; color: #dcddde; border: 1px solid #40444b; border-radius: 8px; z-index: 999999; display: flex; flex-direction: column; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; box-shadow: 0 10px 40px rgba(0,0,0,0.7); }',
        '#raru-panel.hidden { display: none; }',
        '#raru-panel .db-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; background: #2c2f33; border-bottom: 1px solid #40444b; border-radius: 8px 8px 0 0; }',
        '#raru-panel .db-title { font-weight: 600; color: #f4a900; font-size: 14px; display: flex; align-items: center; gap: 8px; }',
        '#raru-panel .db-title::before { content: "🗃"; }',
        '#raru-panel .db-header .db-status { color: #999; font-size: 12px; }',
        '#raru-panel .db-header .db-status.err { color: #d97a7a; }',

        '#raru-panel .db-toolbar { padding: 8px 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; border-bottom: 1px solid #40444b; background: #23272a; }',
        '#raru-panel .db-toolbar button { background: #40444b; color: #dcddde; border: 1px solid #4f545c; border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 12px; }',
        '#raru-panel .db-toolbar button:hover { background: #4f545c; }',
        '#raru-panel .db-toolbar button.primary { background: #2b6cb0; border-color: #3182ce; color: #fff; font-weight: 600; }',
        '#raru-panel .db-toolbar button.primary:hover { background: #3182ce; }',
        '#raru-panel .db-toolbar button.success { background: #276749; border-color: #38a169; color: #fff; font-weight: 600; }',
        '#raru-panel .db-toolbar button.success:hover { background: #38a169; }',
        '#raru-panel .db-toolbar input[type="text"] { background: #2c2f33; color: #dcddde; border: 1px solid #4f545c; border-radius: 4px; padding: 5px 8px; font-size: 12px; flex: 1; min-width: 180px; max-width: 320px; }',
        '#raru-panel .db-toolbar input[type="text"]:focus { outline: none; border-color: #f4a900; }',
        '#raru-panel .db-toolbar select { background: #2c2f33; color: #dcddde; border: 1px solid #4f545c; border-radius: 4px; padding: 5px 8px; font-size: 12px; max-width: 220px; }',
        '#raru-panel .db-toolbar select:focus { outline: none; border-color: #f4a900; }',
        '#raru-panel .db-toolbar label.chk { display: inline-flex; align-items: center; gap: 4px; color: #b9bbbe; font-size: 12px; cursor: pointer; user-select: none; padding: 4px 6px; border-radius: 4px; }',
        '#raru-panel .db-toolbar label.chk:hover { background: #2c2f33; color: #fff; }',
        '#raru-panel .db-toolbar label.chk input { accent-color: #f4a900; margin: 0; }',
        '#raru-panel .db-toolbar .counter { color: #888; font-size: 12px; margin-left: auto; white-space: nowrap; }',

        '#raru-panel .db-table-wrap { flex: 1; overflow: auto; background: #23272a; }',
        '#raru-panel table.db-table { width: 100%; border-collapse: collapse; font-size: 13px; }',
        '#raru-panel table.db-table thead th { position: sticky; top: 0; background: #2c2f33; color: #b9bbbe; padding: 8px 10px; text-align: left; border-bottom: 1px solid #40444b; cursor: pointer; user-select: none; font-weight: 600; font-size: 12px; z-index: 2; }',
        '#raru-panel table.db-table thead th:hover { color: #f4a900; }',
        '#raru-panel table.db-table thead th.sorted-asc::after { content: " ▲"; color: #f4a900; font-size: 9px; }',
        '#raru-panel table.db-table thead th.sorted-desc::after { content: " ▼"; color: #f4a900; font-size: 9px; }',
        '#raru-panel table.db-table tbody tr { border-bottom: 1px solid #2c2f33; cursor: pointer; }',
        '#raru-panel table.db-table tbody tr:nth-child(even) { background: #262a2d; }',
        '#raru-panel table.db-table tbody tr:hover { background: #32363a; }',
        '#raru-panel table.db-table tbody tr.selected { background: #2b6cb0; }',
        '#raru-panel table.db-table tbody tr.selected td { color: #fff; }',
        '#raru-panel table.db-table tbody td { padding: 6px 10px; vertical-align: top; color: #dcddde; }',
        '#raru-panel table.db-table tbody td.id { font-family: monospace; color: #b9bbbe; width: 70px; }',
        '#raru-panel table.db-table tbody td.console { color: #b9bbbe; width: 170px; font-size: 12px; }',
        '#raru-panel table.db-table tbody td.name { color: #fff; }',
        '#raru-panel table.db-table tbody td.status { width: 120px; font-size: 12px; }',
        '#raru-panel table.db-table tbody td.links { width: 300px; font-size: 12px; }',
        '#raru-panel .status-chip { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; font-weight: 600; }',
        '#raru-panel .link-pill { display: inline-block; padding: 1px 6px; border-radius: 3px; margin-right: 4px; font-size: 11px; }',
        '#raru-panel .link-pill.drive { background: rgba(43,108,176,0.3); color: #63b3ed; }',
        '#raru-panel .link-pill.ru { background: rgba(104,211,145,0.25); color: #68d391; }',
        '#raru-panel .link-pill.comment { background: rgba(246,224,94,0.2); color: #f6e05e; }',
        '#raru-panel .no-rows { padding: 20px; text-align: center; color: #888; font-style: italic; }',

        '#raru-panel .db-details { border-top: 1px solid #40444b; background: #2c2f33; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; min-height: 130px; max-height: 200px; border-radius: 0 0 8px 8px; }',
        '#raru-panel .db-details .detail-title { color: #f4a900; font-weight: 600; font-size: 14px; }',
        '#raru-panel .db-details .detail-comment { font-size: 12px; color: #b9bbbe; white-space: pre-wrap; overflow-y: auto; flex: 1; max-height: 80px; }',
        '#raru-panel .db-details .detail-actions { display: flex; gap: 8px; flex-wrap: wrap; }',
        '#raru-panel .db-details .detail-actions button { background: #40444b; color: #dcddde; border: 1px solid #4f545c; border-radius: 4px; padding: 5px 12px; cursor: pointer; font-size: 12px; font-weight: 600; }',
        '#raru-panel .db-details .detail-actions button:hover { background: #4f545c; }',
        '#raru-panel .db-details .detail-actions button.drive { background: #2b6cb0; border-color: #3182ce; color: #fff; }',
        '#raru-panel .db-details .detail-actions button.drive:hover { background: #3182ce; }',
        '#raru-panel .db-details .detail-actions button.ru { background: #276749; border-color: #38a169; color: #fff; }',
        '#raru-panel .db-details .detail-actions button.ru:hover { background: #38a169; }',
        '#raru-panel .db-details .detail-actions button.edit { background: #6b4f1c; border-color: #8a6a2a; color: #fff; }',
        '#raru-panel .db-details .detail-actions button.edit:hover { background: #8a6a2a; }',
        '#raru-panel .db-details .detail-actions button:disabled { opacity: 0.4; cursor: not-allowed; }',

        // ---- Модальное окно редактирования ----
        '#raru-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1000000; display: flex; align-items: center; justify-content: center; }',
        '#raru-modal-overlay.hidden { display: none; }',
        '#raru-modal { background: #2c2f33; color: #dcddde; border: 1px solid #40444b; border-radius: 8px; width: 640px; max-width: 95vw; max-height: 90vh; overflow-y: auto; padding: 16px 20px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; box-shadow: 0 12px 48px rgba(0,0,0,0.8); }',
        '#raru-modal h2 { margin: 0 0 12px; font-size: 16px; color: #f4a900; }',
        '#raru-modal .field { margin-bottom: 10px; display: flex; flex-direction: column; gap: 4px; }',
        '#raru-modal .field label { font-size: 12px; color: #b9bbbe; }',
        '#raru-modal input[type="text"], #raru-modal select, #raru-modal textarea { background: #23272a; color: #dcddde; border: 1px solid #4f545c; border-radius: 4px; padding: 6px 8px; font-size: 13px; font-family: inherit; width: 100%; box-sizing: border-box; }',
        '#raru-modal textarea { min-height: 70px; resize: vertical; }',
        '#raru-modal input:focus, #raru-modal select:focus, #raru-modal textarea:focus { outline: none; border-color: #f4a900; }',
        '#raru-modal input[disabled] { opacity: 0.6; cursor: not-allowed; }',
        '#raru-modal .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }',
        '#raru-modal .actions button { background: #40444b; color: #dcddde; border: 1px solid #4f545c; border-radius: 4px; padding: 6px 14px; cursor: pointer; font-size: 13px; font-weight: 600; }',
        '#raru-modal .actions button:hover { background: #4f545c; }',
        '#raru-modal .actions button.primary { background: #2b6cb0; border-color: #3182ce; color: #fff; }',
        '#raru-modal .actions button.primary:hover { background: #3182ce; }',
        '#raru-modal .actions button.danger { background: #6b2a2a; border-color: #8a3a3a; color: #fff; }',
        '#raru-modal .actions button.danger:hover { background: #8a3a3a; }'
    ].join('\n');

    const styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    (document.head || document.documentElement).appendChild(styleEl);

    // ---------- Панель ----------
    const panel = document.createElement('div');
    panel.id = 'raru-panel';
    panel.className = 'hidden';
    panel.innerHTML =
        '<div class="db-header">' +
            '<div class="db-title">RA RU ROM Database</div>' +
            '<div class="db-status" id="raru-db-status">—</div>' +
        '</div>' +
        '<div class="db-toolbar">' +
            '<button class="primary" data-act="fetch-remote">Обновить данные</button>' +
            '<button class="success" data-act="add-new">+ Новая игра</button>' +
            '<button class="success" data-act="save-local">Сохранить</button>' +
            '<button data-act="export">Экспорт в файл</button>' +
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
            '<button data-act="clear-filters">Сбросить</button>' +
            '<span class="counter" id="raru-counter"></span>' +
        '</div>' +
        '<div class="db-table-wrap">' +
            '<table class="db-table">' +
                '<thead>' +
                    '<tr>' +
                        '<th data-sort="id">Game ID</th>' +
                        '<th data-sort="console">Консоль</th>' +
                        '<th data-sort="name">Название игры</th>' +
                        '<th data-sort="status">Статус</th>' +
                        '<th data-sort="links">Доступные файлы / Ссылки</th>' +
                    '</tr>' +
                '</thead>' +
                '<tbody id="raru-tbody"></tbody>' +
            '</table>' +
        '</div>' +
        '<div class="db-details" id="raru-details">' +
            '<div class="detail-title" id="raru-detail-title">Выберите игру в списке</div>' +
            '<div class="detail-comment" id="raru-detail-comment"></div>' +
            '<div class="detail-actions" id="raru-detail-actions"></div>' +
        '</div>';

    // ---------- Модальное окно редактирования ----------
    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'raru-modal-overlay';
    modalOverlay.className = 'hidden';
    modalOverlay.innerHTML =
        '<div id="raru-modal">' +
            '<h2 id="raru-modal-title">Редактирование</h2>' +
            '<div class="field"><label>Game ID</label><input type="text" id="raru-edit-id" placeholder="например 2606" /></div>' +
            '<div class="field"><label>Название игры (с консолью в скобках, например: Resident Evil 4 (PlayStation 2))</label><input type="text" id="raru-edit-name" placeholder="Resident Evil 4 (PlayStation 2)" /></div>' +
            '<div class="field"><label>Drive (Google Drive ссылка)</label><input type="text" id="raru-edit-drive" placeholder="https://drive.google.com/..." /></div>' +
            '<div class="field"><label>Русская версия (ссылка)</label><input type="text" id="raru-edit-ru" placeholder="https://disk.yandex.ru/..." /></div>' +
            '<div class="field"><label>Статус</label><select id="raru-edit-status"></select></div>' +
            '<div class="field"><label>Комментарий</label><textarea id="raru-edit-comment" placeholder="Поддерживаются ссылки: [ach=ID], [game=ID], [user=ИМЯ]"></textarea></div>' +
            '<div class="actions">' +
                '<button class="danger" id="raru-edit-delete">Удалить</button>' +
                '<button id="raru-edit-cancel">Отмена</button>' +
                '<button class="primary" id="raru-edit-save">Сохранить</button>' +
            '</div>' +
        '</div>';

    // Заполняем селект статусов
    const editStatusSelect = modalOverlay.querySelector('#raru-edit-status');
    STATUS_OPTIONS.forEach(function (o) {
        const opt = document.createElement('option');
        opt.value = o.value;
        opt.textContent = o.label;
        editStatusSelect.appendChild(opt);
    });

    function mountUI() {
        if (!document.body) return setTimeout(mountUI, 50);
        document.body.appendChild(panel);
        document.body.appendChild(modalOverlay);
        bindUI();
        rebuildConsoleOptions();
        renderTable();
        updateStatus();
    }

    const tbody = panel.querySelector('#raru-tbody');
    const searchInput = panel.querySelector('#raru-search');
    const filterConsoleSelect = panel.querySelector('#raru-filter-console');
    const filterStatusSelect = panel.querySelector('#raru-filter-status');
    const filterDriveChk = panel.querySelector('#raru-filter-drive');
    const filterRuChk = panel.querySelector('#raru-filter-ru');
    const filterCommentChk = panel.querySelector('#raru-filter-comment');
    const dbStatus = panel.querySelector('#raru-db-status');
    const counter = panel.querySelector('#raru-counter');
    const detailTitle = panel.querySelector('#raru-detail-title');
    const detailComment = panel.querySelector('#raru-detail-comment');
    const detailActions = panel.querySelector('#raru-detail-actions');

    // ---------- Модалка ----------
    const modalTitle = modalOverlay.querySelector('#raru-modal-title');
    const editIdInput = modalOverlay.querySelector('#raru-edit-id');
    const editNameInput = modalOverlay.querySelector('#raru-edit-name');
    const editDriveInput = modalOverlay.querySelector('#raru-edit-drive');
    const editRuInput = modalOverlay.querySelector('#raru-edit-ru');
    const editCommentInput = modalOverlay.querySelector('#raru-edit-comment');
    const editDeleteBtn = modalOverlay.querySelector('#raru-edit-delete');
    const editCancelBtn = modalOverlay.querySelector('#raru-edit-cancel');
    const editSaveBtn = modalOverlay.querySelector('#raru-edit-save');

    let editingIsNew = false;

    function openEditModal(gameId) {
        editingIsNew = false;
        const entry = GAME_ID_TO_URL[gameId] || {};
        modalTitle.textContent = 'Редактирование игры #' + gameId;
        editIdInput.value = gameId;
        editIdInput.disabled = true;
        editNameInput.value = entry.name || '';
        editDriveInput.value = entry.drive || '';
        editRuInput.value = entry.ru || '';
        editStatusSelect.value = entry.status || '';
        editCommentInput.value = entry.comment || '';
        editDeleteBtn.style.display = '';
        modalOverlay.classList.remove('hidden');
        editNameInput.focus();
    }

    function openNewModal() {
        editingIsNew = true;
        modalTitle.textContent = 'Новая игра';
        editIdInput.value = '';
        editIdInput.disabled = false;
        editNameInput.value = '';
        editDriveInput.value = '';
        editRuInput.value = '';
        editStatusSelect.value = '';
        editCommentInput.value = '';
        editDeleteBtn.style.display = 'none';
        modalOverlay.classList.remove('hidden');
        editIdInput.focus();
    }

    function closeModal() {
        modalOverlay.classList.add('hidden');
    }

    function saveFromModal() {
        const id = editIdInput.value.trim();
        if (!id || !/^\d+$/.test(id)) {
            alert('Game ID должен быть числом');
            return;
        }
        const obj = {};
        const nameVal = editNameInput.value.trim();
        const driveVal = editDriveInput.value.trim();
        const ruVal = editRuInput.value.trim();
        const statusVal = editStatusSelect.value;
        const commentVal = editCommentInput.value.trim();

        if (nameVal) obj.name = nameVal;
        if (driveVal) obj.drive = driveVal;
        if (ruVal) obj.ru = ruVal;
        if (statusVal) obj.status = statusVal;
        if (commentVal) obj.comment = commentVal;

        GAME_ID_TO_URL[id] = obj;
        hasChanges = true;
        saveData(GAME_ID_TO_URL);
        closeModal();
        rebuildConsoleOptions();
        renderTable();
        renderDetails();
        refreshAll();
    }

    function deleteFromModal() {
        const id = editIdInput.value.trim();
        if (!id) return;
        if (!confirm('Удалить игру #' + id + '?')) return;
        delete GAME_ID_TO_URL[id];
        hasChanges = true;
        saveData(GAME_ID_TO_URL);
        closeModal();
        rebuildConsoleOptions();
        renderTable();
        renderDetails();
        refreshAll();
    }

    editSaveBtn.addEventListener('click', saveFromModal);
    editCancelBtn.addEventListener('click', closeModal);
    editDeleteBtn.addEventListener('click', deleteFromModal);
    modalOverlay.addEventListener('click', function (e) {
        if (e.target === modalOverlay) closeModal();
    });

    function updateStatus(errMsg, isErr) {
        if (errMsg) {
            dbStatus.textContent = errMsg;
            dbStatus.className = 'db-status err';
            return;
        }
        if (dataLoading) {
            dbStatus.textContent = 'Загрузка...';
            dbStatus.className = 'db-status';
            return;
        }
        if (!lastFetchTime) {
            dbStatus.textContent = 'Данные не загружены';
            dbStatus.className = 'db-status err';
            return;
        }
        const msLeft = Math.max(0, DATA_FRESH_MS - (Date.now() - lastFetchTime));
        const total = Math.floor(msLeft / 1000);
        const mm = Math.floor(total / 60);
        const ss = total % 60;
        const t = new Date(lastFetchTime);
        const pad = function (n) { return String(n).padStart(2, '0'); };
        dbStatus.textContent = 'Обновлено: ' + pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds()) +
            ' · до устаревания ' + pad(mm) + ':' + pad(ss);
        dbStatus.className = 'db-status';
    }

    function getRows() {
        const rows = [];
        Object.keys(GAME_ID_TO_URL).forEach(function (id) {
            const e = GAME_ID_TO_URL[id];
            if (!e) return;
            const parsed = parseName(e.name || '');
            rows.push({
                id: id,
                idNum: parseInt(id, 10) || 0,
                name: parsed.name || ('Игра #' + id),
                console: parsed.console || '—',
                status: e.status || '',
                statusText: STATUS_META[e.status] ? STATUS_META[e.status].text : '',
                comment: e.comment || '',
                drive: e.drive || '',
                ru: e.ru || ''
            });
        });
        return rows;
    }

    function applyFilters(rows) {
        let result = rows;

        if (filterText) {
            const f = filterText.toLowerCase();
            result = result.filter(function (r) {
                return (
                    r.id.toLowerCase().indexOf(f) !== -1 ||
                    r.name.toLowerCase().indexOf(f) !== -1 ||
                    r.console.toLowerCase().indexOf(f) !== -1 ||
                    r.statusText.toLowerCase().indexOf(f) !== -1 ||
                    r.comment.toLowerCase().indexOf(f) !== -1
                );
            });
        }

        if (filterConsole) {
            result = result.filter(function (r) { return r.console === filterConsole; });
        }

        if (filterStatus === '__none__') {
            result = result.filter(function (r) { return !r.status; });
        } else if (filterStatus) {
            result = result.filter(function (r) { return r.status === filterStatus; });
        }

        if (filterDrive) {
            result = result.filter(function (r) { return !!r.drive; });
        }
        if (filterRu) {
            result = result.filter(function (r) { return !!r.ru; });
        }
        if (filterComment) {
            result = result.filter(function (r) { return !!r.comment; });
        }

        return result;
    }

    function sortRows(rows) {
        const dir = sortAsc ? 1 : -1;
        rows.sort(function (a, b) {
            let va, vb;
            switch (sortColumn) {
                case 'console': va = a.console.toLowerCase(); vb = b.console.toLowerCase(); break;
                case 'name':    va = a.name.toLowerCase();    vb = b.name.toLowerCase();    break;
                case 'status':  va = a.statusText.toLowerCase(); vb = b.statusText.toLowerCase(); break;
                case 'links':   va = (a.drive ? 1 : 0) + (a.ru ? 1 : 0) + (a.comment ? 1 : 0); vb = (b.drive ? 1 : 0) + (b.ru ? 1 : 0) + (b.comment ? 1 : 0); break;
                default:        va = a.idNum; vb = b.idNum;
            }
            if (va < vb) return -1 * dir;
            if (va > vb) return 1 * dir;
            return 0;
        });
        return rows;
    }

    function rebuildConsoleOptions() {
        const rows = getRows();
        const unique = new Set();
        rows.forEach(function (r) {
            if (r.console && r.console !== '—') unique.add(r.console);
        });
        const list = Array.from(unique).sort(function (a, b) {
            return a.localeCompare(b);
        });

        const currentValue = filterConsole;
        filterConsoleSelect.innerHTML = '<option value="">Все консоли</option>';
        list.forEach(function (c) {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            filterConsoleSelect.appendChild(opt);
        });
        if (currentValue && list.indexOf(currentValue) !== -1) {
            filterConsoleSelect.value = currentValue;
        } else {
            filterConsole = '';
        }
    }

    function renderTable() {
        const allRows = getRows();
        const filtered = applyFilters(allRows);
        const rows = sortRows(filtered);

        counter.textContent = 'Найдено: ' + rows.length + ' из ' + allRows.length;

        tbody.innerHTML = '';
        if (rows.length === 0) {
            const tr = document.createElement('tr');
            const td = document.createElement('td');
            td.colSpan = 5;
            td.className = 'no-rows';
            td.textContent = 'Ничего не найдено';
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }

        rows.forEach(function (r) {
            const tr = document.createElement('tr');
            if (r.id === selectedGameId) tr.classList.add('selected');
            tr.dataset.id = r.id;

            const tdId = document.createElement('td');
            tdId.className = 'id';
            tdId.textContent = r.id;

            const tdConsole = document.createElement('td');
            tdConsole.className = 'console';
            tdConsole.textContent = r.console;

            const tdName = document.createElement('td');
            tdName.className = 'name';
            tdName.textContent = r.name;

            const tdStatus = document.createElement('td');
            tdStatus.className = 'status';
            if (r.status && STATUS_META[r.status]) {
                const m = STATUS_META[r.status];
                const chip = document.createElement('span');
                chip.className = 'status-chip';
                chip.textContent = m.text;
                chip.style.color = m.color;
                chip.style.background = m.bg;
                chip.style.border = '1px solid ' + m.border;
                tdStatus.appendChild(chip);
            } else {
                tdStatus.textContent = '—';
                tdStatus.style.color = '#666';
            }

            const tdLinks = document.createElement('td');
            tdLinks.className = 'links';
            if (r.drive) {
                const s = document.createElement('span');
                s.className = 'link-pill drive';
                s.textContent = '💾 Drive';
                tdLinks.appendChild(s);
            }
            if (r.ru) {
                const s = document.createElement('span');
                s.className = 'link-pill ru';
                s.textContent = '🇷🇺 Русская версия';
                tdLinks.appendChild(s);
            }
            if (r.comment) {
                const s = document.createElement('span');
                s.className = 'link-pill comment';
                s.textContent = '💬 Комментарий';
                tdLinks.appendChild(s);
            }
            if (!r.drive && !r.ru && !r.comment) {
                tdLinks.textContent = '—';
                tdLinks.style.color = '#666';
            }

            tr.appendChild(tdId);
            tr.appendChild(tdConsole);
            tr.appendChild(tdName);
            tr.appendChild(tdStatus);
            tr.appendChild(tdLinks);

            tr.addEventListener('click', function () {
                selectedGameId = r.id;
                renderTable();
                renderDetails();
            });

            tr.addEventListener('dblclick', function () {
                openEditModal(r.id);
            });

            tbody.appendChild(tr);
        });
    }

    function renderDetails() {
        detailActions.innerHTML = '';
        if (!selectedGameId || !GAME_ID_TO_URL[selectedGameId]) {
            detailTitle.textContent = 'Выберите игру в списке';
            detailComment.textContent = '';
            return;
        }
        const r = getRows().find(function (x) { return x.id === selectedGameId; });
        if (!r) return;

        detailTitle.textContent = '[' + r.id + '] ' + r.name + (r.console && r.console !== '—' ? ' (' + r.console + ')' : '');
        detailComment.textContent = r.comment || '';

        const btnDrive = document.createElement('button');
        btnDrive.className = 'drive';
        btnDrive.textContent = '💾 Скачать Game (Drive)';
        btnDrive.disabled = !r.drive;
        if (r.drive) {
            btnDrive.addEventListener('click', function () {
                window.open(r.drive, '_blank', 'noopener,noreferrer');
            });
        }
        detailActions.appendChild(btnDrive);

        const btnRu = document.createElement('button');
        btnRu.className = 'ru';
        btnRu.textContent = '🇷🇺 Русская версия';
        btnRu.disabled = !r.ru;
        if (r.ru) {
            btnRu.addEventListener('click', function () {
                window.open(r.ru, '_blank', 'noopener,noreferrer');
            });
        }
        detailActions.appendChild(btnRu);

        const btnEdit = document.createElement('button');
        btnEdit.className = 'edit';
        btnEdit.textContent = '✎ Редактировать';
        btnEdit.addEventListener('click', function () {
            openEditModal(r.id);
        });
        detailActions.appendChild(btnEdit);

        const btnRa = document.createElement('button');
        btnRa.textContent = '🔗 Страница на RA';
        btnRa.addEventListener('click', function () {
            window.open('https://retroachievements.org/game/' + r.id, '_blank', 'noopener,noreferrer');
        });
        detailActions.appendChild(btnRa);
    }

    function clearFilters() {
        filterText = '';
        filterConsole = '';
        filterStatus = '';
        filterDrive = false;
        filterRu = false;
        filterComment = false;
        searchInput.value = '';
        filterConsoleSelect.value = '';
        filterStatusSelect.value = '';
        filterDriveChk.checked = false;
        filterRuChk.checked = false;
        filterCommentChk.checked = false;
        renderTable();
    }

    function saveData(data) {
        GM_setValue(STORAGE_KEY, JSON.stringify(data));
    }

    function bindUI() {
        searchInput.addEventListener('input', function () {
            filterText = searchInput.value.trim();
            renderTable();
        });

        filterConsoleSelect.addEventListener('change', function () {
            filterConsole = filterConsoleSelect.value;
            renderTable();
        });

        filterStatusSelect.addEventListener('change', function () {
            filterStatus = filterStatusSelect.value;
            renderTable();
        });

        filterDriveChk.addEventListener('change', function () {
            filterDrive = filterDriveChk.checked;
            renderTable();
        });
        filterRuChk.addEventListener('change', function () {
            filterRu = filterRuChk.checked;
            renderTable();
        });
        filterCommentChk.addEventListener('change', function () {
            filterComment = filterCommentChk.checked;
            renderTable();
        });

        panel.querySelectorAll('th[data-sort]').forEach(function (th) {
            th.addEventListener('click', function () {
                const col = th.dataset.sort;
                if (sortColumn === col) {
                    sortAsc = !sortAsc;
                } else {
                    sortColumn = col;
                    sortAsc = true;
                }
                panel.querySelectorAll('th[data-sort]').forEach(function (t) {
                    t.classList.remove('sorted-asc', 'sorted-desc');
                });
                th.classList.add(sortAsc ? 'sorted-asc' : 'sorted-desc');
                renderTable();
            });
        });

        panel.addEventListener('click', function (e) {
            const btn = e.target.closest('button[data-act]');
            if (!btn) return;
            const act = btn.dataset.act;

            if (act === 'fetch-remote') {
                if (!confirm('Загрузить свежие данные с GitHub? Несохранённые правки будут потеряны.')) return;
                fetchRemoteData()
                    .then(function () { renderTable(); })
                    .catch(function (err) {
                        console.error('[RA Replacer] fetch error:', err);
                    });
            } else if (act === 'add-new') {
                openNewModal();
            } else if (act === 'save-local') {
                saveData(GAME_ID_TO_URL);
                hasChanges = true;
                alert('Сохранено локально. Не забудь нажать «Экспорт в файл» и залить JSON в репозиторий GitHub.');
            } else if (act === 'export') {
                exportToFile();
            } else if (act === 'clear-filters') {
                clearFilters();
            }
        });
    }

    function exportToFile() {
        const json = JSON.stringify(GAME_ID_TO_URL, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'rahashesreplacer.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    }

    document.addEventListener('keydown', function (e) {
        if (e.ctrlKey && e.shiftKey && (e.key === 'E' || e.key === 'e' || e.code === 'KeyE')) {
            e.preventDefault();
            e.stopPropagation();
            panel.classList.toggle('hidden');
            if (!panel.classList.contains('hidden')) {
                rebuildConsoleOptions();
                renderTable();
                renderDetails();
                updateStatus();
            }
        }
        if (e.key === 'Escape' && !modalOverlay.classList.contains('hidden')) {
            closeModal();
        }
    }, true);

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
            e.preventDefault();
            e.stopPropagation();
            fetchRemoteData()
                .then(function () {
                    alert('Данные получены: ' + Object.keys(GAME_ID_TO_URL).length + ' записей');
                })
                .catch(function (err) {
                    alert('Не удалось получить данные: ' + err.message);
                });
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

    try {
        const cached = GM_getValue(STORAGE_KEY, null);
        if (cached) {
            try { GAME_ID_TO_URL = JSON.parse(cached); dataLoaded = true; }
            catch (e) {}
        }
        const savedTime = GM_getValue(TIME_KEY, 0);
        if (savedTime && typeof savedTime === 'number') lastFetchTime = savedTime;
    } catch (e) {}

    function tick() {
        if (dataLoaded) {
            applyReplacements();
            applyStatusBadge();
            applyComment();
        }
        injectMenuItems();
        if (!panel.classList.contains('hidden')) updateStatus();
        const nowFresh = isDataFresh();
        if (wasFresh && !nowFresh) {
            wasFresh = false;
        } else if (nowFresh) {
            wasFresh = true;
        }
    }

    const observer = new MutationObserver(function () {
        if (dataLoaded) applyReplacements();
        injectMenuItems();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    setInterval(tick, 500);
    setInterval(function () {
        if (!panel.classList.contains('hidden')) updateStatus();
    }, 1000);
    window.addEventListener('load', tick);
    document.addEventListener('DOMContentLoaded', tick);
    tick();
    mountUI();
})();