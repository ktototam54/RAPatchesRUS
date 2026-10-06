// ==UserScript==
// @name         RetroAchievements Hashes Replacer
// @namespace    https://retroachievements.org/
// @version      6.7
// @description  Заменяет 'Supported Game Hashes' на 'Download Game' / 'Русская версия'. Статусы, комментарии, ссылки на ачивки. Данные тянутся с Яндекс.Диска вручную.
// @author       You
// @match        https://retroachievements.org/*
// @match        https://www.retroachievements.org/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      cloud-api.yandex.net
// @connect      disk.yandex.ru
// @connect      yandex.net
// @connect      downloader.disk.yandex.ru
// @updateURL    https://raw.githubusercontent.com/ktototam54/RAPatchesRUS/refs/heads/main/rahashesreplacer.js
// @downloadURL  https://raw.githubusercontent.com/ktototam54/RAPatchesRUS/refs/heads/main/rahashesreplacer.js
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const REMOTE_PUBLIC_URL = 'https://disk.yandex.ru/d/Ggt6hPg-FCsu_w';
    const STORAGE_KEY = 'ra_hashes_replacer_data';
    const TIME_KEY = 'ra_hashes_replacer_last_fetch';
    const DOWNLOAD_TEXT = 'Download Game';
    const RU_TEXT = 'Русская версия';
    const DATA_FRESH_MS = 60 * 60 * 1000;

    const STATUS_OPTIONS = [
        { value: '',              label: '—' },
        { value: 'mastering',     label: 'Мастеринг' },
        { value: 'beaten',        label: 'Битен' },
        { value: 'ru_impossible', label: 'Ру ром невозможен' }
    ];
    const STATUS_META = {
        mastering:     { text: 'Мастеринг',         color: '#f4a900', bg: 'rgba(244,169,0,0.15)',   border: '#f4a900' },
        beaten:        { text: 'Битен',             color: '#c8c8c8', bg: 'rgba(200,200,200,0.15)', border: '#c8c8c8' },
        ru_impossible: { text: 'Ру ром невозможен', color: '#c084fc', bg: 'rgba(192,132,252,0.15)', border: '#c084fc' }
    };

    let GAME_ID_TO_URL = {};
    let dataLoaded = false;
    let dataLoading = false;
    let lastFetchTime = 0;

    function getCurrentGameId() {
        const m = window.location.pathname.match(/^\/game\/(\d+)/);
        return m ? m[1] : null;
    }

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

    function yandexResolve(publicUrl) {
        const api = 'https://cloud-api.yandex.net/v1/disk/public/resources/download'
                  + '?public_key=' + encodeURIComponent(publicUrl);
        return gmFetch(api).then(function (text) {
            let json;
            try { json = JSON.parse(text); }
            catch (e) { throw new Error('API Диска вернул не JSON'); }
            if (!json.href) throw new Error('Не удалось получить ссылку на файл (возможно, файл не публичный)');
            return json.href;
        });
    }

    function fetchRemoteData() {
        return yandexResolve(REMOTE_PUBLIC_URL)
            .then(function (href) { return gmFetch(href); })
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
                GM_setValue(TIME_KEY, lastFetchTime);
                GM_setValue(STORAGE_KEY, JSON.stringify(parsed));
                refreshAll();
            });
    }

    function isDataFresh() {
        return lastFetchTime > 0 && (Date.now() - lastFetchTime) < DATA_FRESH_MS;
    }

    function minutesSinceFetch() {
        if (!lastFetchTime) return null;
        return Math.floor((Date.now() - lastFetchTime) / 60000);
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

        for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i];
            if (el.closest('.dropdown-menu, [role="menu"], [hidden]')) continue;
            const title = (el.getAttribute('title') || '').toLowerCase();
            const aria = (el.getAttribute('aria-label') || '').toLowerCase();
            if (title === target || aria === target) return el;
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

    const CSS = [
        '.ra-game-comment { margin: 12px 0; padding: 12px 16px; background: #1a1a1a; border: 1px solid #333; border-left: 3px solid #4a90d9; border-radius: 6px; color: #d0d0d0; font-size: 14px; line-height: 1.6; word-break: break-word; }',
        '.ra-game-comment .ra-game-comment-label { display: block; font-size: 11px; color: #4a90d9; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; font-weight: 600; }',
        '.ra-game-comment .ra-game-comment-text { white-space: pre-wrap; }',
        '.ra-game-comment .ra-ach-link { color: #4a90d9; text-decoration: none; font-weight: 600; }',
        '.ra-game-comment .ra-ach-link:hover { text-decoration: underline; }',
        '.ra-game-comment .ra-ach-card { display: inline-flex; align-items: center; gap: 6px; vertical-align: middle; padding: 2px 10px 2px 8px; margin: 0 2px; background: rgba(74,144,217,0.12); border: 1px solid rgba(74,144,217,0.4); border-radius: 6px; color: #cfe3f7; text-decoration: none; font-size: 12px; line-height: 1.4; font-weight: 600; }',
        '.ra-game-comment .ra-ach-card:hover { background: rgba(74,144,217,0.2); text-decoration: none; }',
        '.ra-game-comment .ra-ach-card::before { content: "🏆"; font-size: 13px; }',

        '#ra-replacer-panel { position: fixed; right: 20px; bottom: 20px; width: 720px; max-height: 80vh; background: #1e1e1e; color: #e6e6e6; border: 1px solid #444; border-radius: 10px; z-index: 999999; display: flex; flex-direction: column; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; box-shadow: 0 8px 32px rgba(0,0,0,0.6); }',
        '#ra-replacer-panel.hidden { display: none; }',
        '#ra-replacer-panel .header { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-bottom: 1px solid #333; font-weight: 600; color: #f4a900; }',
        '#ra-replacer-panel .header .close { background: transparent; border: none; color: #999; font-size: 18px; cursor: pointer; }',
        '#ra-replacer-panel .header .close:hover { color: #fff; }',
        '#ra-replacer-panel .body { padding: 12px 14px; overflow-y: auto; }',
        '#ra-replacer-panel .row { display: grid; grid-template-columns: 60px 1fr 100px 28px 64px; gap: 6px; margin-bottom: 6px; align-items: center; padding: 4px 6px; border-radius: 5px; }',
        '#ra-replacer-panel .row.has-comment { border-left: 3px solid #4a90d9; margin-left: -6px; padding-left: 8px; }',
        '#ra-replacer-panel .row.current { background: rgba(244,169,0,0.10); border-left: 3px solid #f4a900; margin-left: -6px; padding-left: 8px; }',
        '#ra-replacer-panel .row.current.has-comment { border-left-color: #f4a900; }',
        '#ra-replacer-panel .row .id-cell { color: #bbb; font-family: monospace; font-size: 12px; text-align: right; padding-right: 4px; }',
        '#ra-replacer-panel .row .name-cell { font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #e6e6e6; }',
        '#ra-replacer-panel .row .name-cell a { color: #f4a900; text-decoration: none; }',
        '#ra-replacer-panel .row .name-cell a:hover { text-decoration: underline; }',
        '#ra-replacer-panel .row .status-cell { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
        '#ra-replacer-panel input, #ra-replacer-panel select, #ra-replacer-panel textarea { background: #2a2a2a; border: 1px solid #444; color: #e6e6e6; padding: 4px 7px; border-radius: 5px; font-size: 12px; width: 100%; box-sizing: border-box; font-family: inherit; }',
        '#ra-replacer-panel textarea { resize: vertical; min-height: 32px; }',
        '#ra-replacer-panel input:focus, #ra-replacer-panel select:focus, #ra-replacer-panel textarea:focus { outline: none; border-color: #f4a900; }',
        '#ra-replacer-panel .row.header-row { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; }',
        '#ra-replacer-panel button.act { background: #333; color: #e6e6e6; border: 1px solid #444; border-radius: 5px; cursor: pointer; padding: 4px 8px; font-size: 12px; }',
        '#ra-replacer-panel button.act:hover { background: #3d3d3d; }',
        '#ra-replacer-panel button.act:disabled { opacity: 0.6; cursor: not-allowed; }',
        '#ra-replacer-panel button.primary { background: #f4a900; color: #1a1a1a; border: none; font-weight: 600; }',
        '#ra-replacer-panel button.primary:hover { background: #ffbe2e; }',
        '#ra-replacer-panel .footer { padding: 12px 14px; border-top: 1px solid #333; display: flex; flex-wrap: wrap; gap: 6px; }',
        '#ra-replacer-panel .toolbar { display: flex; gap: 6px; margin-bottom: 10px; }',
        '#ra-replacer-panel .hint { font-size: 11px; color: #888; margin: 6px 0 0; }',
        '#ra-replacer-panel .search { margin-bottom: 0; flex: 1; }',
        '#ra-replacer-panel .row-btn { background: transparent; border: none; cursor: pointer; font-size: 14px; padding: 0; line-height: 1; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px; }',
        '#ra-replacer-panel .row-btn:hover { background: #333; }',
        '#ra-replacer-panel .row-btn.go { color: #7ab8f5; }',
        '#ra-replacer-panel .row-btn.edit { color: #f4a900; }',
        '#ra-replacer-panel .row-btn.ok { color: #6ac46a; }',
        '#ra-replacer-panel .row-btn.cancel { color: #d97a7a; }',
        '#ra-replacer-panel .row-btn.del { color: #c96; }',
        '#ra-replacer-panel .row-btn.del:hover { color: #f66; }',
        '#ra-replacer-toast { position: fixed; bottom: 20px; left: 20px; background: #2e7d32; color: #fff; padding: 8px 14px; border-radius: 6px; font-size: 12px; z-index: 1000000; opacity: 0; transition: opacity .3s; pointer-events: none; }',
        '#ra-replacer-toast.show { opacity: 1; }',
        '#ra-replacer-toast.err { background: #c62828; }'
    ].join('\n');

    const styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    (document.head || document.documentElement).appendChild(styleEl);

    const panel = document.createElement('div');
    panel.id = 'ra-replacer-panel';
    panel.className = 'hidden';
    panel.innerHTML =
        '<div class="header">' +
            '<span>RA Hashes Replacer — Ctrl+Shift+E</span>' +
            '<button class="close" title="Закрыть">✕</button>' +
        '</div>' +
        '<div class="body">' +
            '<div class="toolbar">' +
                '<input class="search" type="text" placeholder="Поиск по ID, названию или статусу..." />' +
                '<button class="act" data-act="go-search" title="Перейти на страницу игры по ID">🔗 Перейти</button>' +
                '<button class="act" data-act="add-current">+ Текущая игра</button>' +
            '</div>' +
            '<div class="row header-row">' +
                '<div>ID</div><div>Название</div><div>Статус</div><div></div><div></div>' +
            '</div>' +
            '<div class="rows"></div>' +
            '<p class="hint">В комментарии: [ach=ID], [achievement=ID], [game=ID], [user=ИМЯ]. Название игры задаётся вручную в режиме редактирования (✎).</p>' +
        '</div>' +
        '<div class="footer">' +
            '<button class="act primary" data-act="fetch-remote">Получить последние данные</button>' +
            '<button class="act" data-act="save" id="ra-save-btn">Сохранить</button>' +
            '<button class="act" data-act="export">Экспорт в файл</button>' +
        '</div>' +
        '<p class="hint" id="ra-save-hint" style="padding: 0 14px 12px; margin: 0;">Перед внесением данных убедитесь, что у вас последние данные — нажмите «Получить последние данные».</p>';

    const toastEl = document.createElement('div');
    toastEl.id = 'ra-replacer-toast';

    function mountUI() {
        if (!document.body) return setTimeout(mountUI, 50);
        document.body.appendChild(panel);
        document.body.appendChild(toastEl);
        renderRows();
        updateSaveState();
    }

    const rowsContainer = panel.querySelector('.rows');
    const searchInput = panel.querySelector('.search');

    let filterText = '';
    let toastTimer = null;

    function toast(msg, isErr) {
        toastEl.textContent = msg;
        toastEl.className = isErr ? 'err show' : 'show';
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            toastEl.className = isErr ? 'err' : '';
        }, 2600);
    }

    function updateSaveState() {
        const saveBtn = panel.querySelector('#ra-save-btn');
        const hint = panel.querySelector('#ra-save-hint');
        if (!saveBtn || !hint) return;

        if (!isDataFresh()) {
            saveBtn.disabled = true;
            saveBtn.title = 'Сначала получите последние данные';
            if (lastFetchTime === 0) {
                hint.textContent = 'Перед внесением данных убедитесь, что у вас последние данные — нажмите «Получить последние данные».';
            } else {
                hint.textContent = 'Данные устарели (получены ' + minutesSinceFetch() + ' мин. назад). Нажмите «Получить последние данные» ещё раз.';
            }
            hint.style.color = '#d97a7a';
        } else {
            saveBtn.disabled = false;
            saveBtn.title = 'Сохранить изменения';
            hint.textContent = 'Данные свежие (получены ' + minutesSinceFetch() + ' мин. назад). Можно сохранять.';
            hint.style.color = '#6ac46a';
        }
    }

    function navigateToGame(id) {
        if (!id || !/^\d+$/.test(String(id))) {
            toast('Введите числовой ID игры', true);
            return false;
        }
        window.location.href = 'https://retroachievements.org/game/' + id;
        return true;
    }

    function renderRows() {
        rowsContainer.innerHTML = '';
        const currentId = getCurrentGameId();

        const ids = Object.keys(GAME_ID_TO_URL).sort(function (a, b) {
            if (a === currentId) return -1;
            if (b === currentId) return 1;
            const na = parseInt(a, 10), nb = parseInt(b, 10);
            if (!isNaN(na) && !isNaN(nb)) return na - nb;
            return a.localeCompare(b);
        });

        ids.forEach(function (id) {
            const entry = GAME_ID_TO_URL[id] || {};
            const displayName = entry.name ? entry.name : ('Игра #' + id);

            if (filterText) {
                const f = filterText.toLowerCase();
                const haystack = (id + ' ' + displayName + ' ' + (entry.drive || '') + ' ' + (entry.ru || '') + ' ' + (entry.status || '') + ' ' + (entry.comment || '')).toLowerCase();
                if (haystack.indexOf(f) === -1) return;
            }

            const row = document.createElement('div');
            row.className = 'row';
            if (id === currentId) row.classList.add('current');
            if (entry.comment) row.classList.add('has-comment');
            row.dataset.id = id;
            row.dataset.mode = 'view';

            const idCell = document.createElement('div');
            idCell.className = 'id-cell';
            idCell.textContent = id;

            const nameCell = document.createElement('div');
            nameCell.className = 'name-cell';

            let href = null;
            if (entry.drive) href = entry.drive;
            else if (entry.ru) href = entry.ru;
            else href = 'https://retroachievements.org/game/' + id;

            const a = document.createElement('a');
            a.href = href;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = displayName;
            a.title = displayName;
            nameCell.appendChild(a);

            const statusCell = document.createElement('div');
            statusCell.className = 'status-cell';
            if (entry.status && STATUS_META[entry.status]) {
                const m = STATUS_META[entry.status];
                const chip = document.createElement('span');
                chip.textContent = m.text;
                chip.style.color = m.color;
                chip.style.border = '1px solid ' + m.border;
                chip.style.background = m.bg;
                chip.style.padding = '1px 6px';
                chip.style.borderRadius = '4px';
                chip.style.fontWeight = '600';
                statusCell.appendChild(chip);
            } else {
                statusCell.textContent = '—';
                statusCell.style.color = '#666';
            }

            const goBtn = document.createElement('button');
            goBtn.className = 'row-btn go';
            goBtn.textContent = '🔗';
            goBtn.title = 'Перейти на страницу игры';
            goBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                navigateToGame(id);
            });

            const actionsCell = document.createElement('div');
            actionsCell.style.display = 'flex';
            actionsCell.style.gap = '2px';

            const editBtn = document.createElement('button');
            editBtn.className = 'row-btn edit';
            editBtn.textContent = '✎';
            editBtn.title = 'Редактировать';
            editBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (!isDataFresh()) {
                    toast('Сначала получите последние данные', true);
                    return;
                }
                enterEditMode(row, id);
            });

            const delBtn = document.createElement('button');
            delBtn.className = 'row-btn del';
            delBtn.textContent = '🗑';
            delBtn.title = 'Удалить';
            delBtn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                if (!isDataFresh()) {
                    toast('Сначала получите последние данные', true);
                    return;
                }
                delete GAME_ID_TO_URL[id];
                saveData(GAME_ID_TO_URL);
                renderRows();
                refreshAll();
            });

            actionsCell.appendChild(editBtn);
            actionsCell.appendChild(delBtn);

            row.appendChild(idCell);
            row.appendChild(nameCell);
            row.appendChild(statusCell);
            row.appendChild(goBtn);
            row.appendChild(actionsCell);

            rowsContainer.appendChild(row);
        });
    }

    function enterEditMode(row, id) {
        const entry = GAME_ID_TO_URL[id] || {};
        row.dataset.mode = 'edit';
        row.innerHTML = '';

        row.style.gridTemplateColumns = '60px 1fr 1fr 1fr 90px 64px';
        row.style.gridTemplateRows = 'auto auto';

        const idCell = document.createElement('div');
        idCell.className = 'id-cell';
        idCell.textContent = id;

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = entry.name || '';
        nameInput.placeholder = 'Название игры (например: Resident Evil 4 (PS2))';

        const driveInput = document.createElement('input');
        driveInput.type = 'text';
        driveInput.value = entry.drive || '';
        driveInput.placeholder = 'https://drive.google.com/...';

        const ruInput = document.createElement('input');
        ruInput.type = 'text';
        ruInput.value = entry.ru || '';
        ruInput.placeholder = 'Русская версия (опционально)';

        const statusSelect = document.createElement('select');
        STATUS_OPTIONS.forEach(function (opt) {
            const o = document.createElement('option');
            o.value = opt.value;
            o.textContent = opt.label;
            statusSelect.appendChild(o);
        });
        statusSelect.value = entry.status || '';

        const actionsCell = document.createElement('div');
        actionsCell.style.display = 'flex';
        actionsCell.style.gap = '2px';

        const okBtn = document.createElement('button');
        okBtn.className = 'row-btn ok';
        okBtn.textContent = '✓';
        okBtn.title = 'Сохранить';
        okBtn.addEventListener('click', function () {
            const nameVal = nameInput.value.trim();
            const driveVal = driveInput.value.trim();
            const ruVal = ruInput.value.trim();
            const statusVal = statusSelect.value;
            const commentVal = commentInput.value.trim();

            if (!nameVal && !driveVal && !ruVal && !statusVal && !commentVal) {
                delete GAME_ID_TO_URL[id];
            } else {
                const obj = {};
                if (nameVal) obj.name = nameVal;
                if (driveVal) obj.drive = driveVal;
                if (ruVal) obj.ru = ruVal;
                if (statusVal) obj.status = statusVal;
                if (commentVal) obj.comment = commentVal;
                GAME_ID_TO_URL[id] = obj;
            }
            saveData(GAME_ID_TO_URL);
            renderRows();
            refreshAll();
        });

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'row-btn cancel';
        cancelBtn.textContent = '✕';
        cancelBtn.title = 'Отмена';
        cancelBtn.addEventListener('click', function () {
            renderRows();
        });

        actionsCell.appendChild(okBtn);
        actionsCell.appendChild(cancelBtn);

        const commentInput = document.createElement('textarea');
        commentInput.value = entry.comment || '';
        commentInput.placeholder = 'Комментарий. Ссылки: [ach=ID], [game=ID], [user=ИМЯ]';
        commentInput.rows = 2;
        commentInput.style.gridColumn = '2 / span 5';
        commentInput.style.gridRow = '2';

        row.appendChild(idCell);
        row.appendChild(nameInput);
        row.appendChild(driveInput);
        row.appendChild(ruInput);
        row.appendChild(statusSelect);
        row.appendChild(actionsCell);
        row.appendChild(commentInput);
    }

    function saveData(data) {
        GM_setValue(STORAGE_KEY, JSON.stringify(data));
    }

    searchInput.addEventListener('input', function () {
        filterText = searchInput.value.trim();
        renderRows();
    });

    searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && /^\d+$/.test(searchInput.value.trim())) {
            navigateToGame(searchInput.value.trim());
        }
    });

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
        toast('Файл сохранён: rahashesreplacer.json');
    }

    panel.addEventListener('click', function (e) {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const act = btn.dataset.act;

        if (act === 'save') {
            if (!isDataFresh()) {
                toast('Сначала получите последние данные — нажмите «Получить последние данные»', true);
                return;
            }
            saveData(GAME_ID_TO_URL);
            toast('Сохранено локально');
            refreshAll();
        } else if (act === 'add-current') {
            if (!isDataFresh()) {
                toast('Сначала получите последние данные', true);
                return;
            }
            const currentId = getCurrentGameId();
            if (!currentId) {
                toast('Откройте страницу игры, чтобы добавить её', true);
                return;
            }
            if (!GAME_ID_TO_URL[currentId]) {
                GAME_ID_TO_URL[currentId] = {};
                saveData(GAME_ID_TO_URL);
            }
            renderRows();
            const row = rowsContainer.querySelector('.row[data-id="' + currentId + '"]');
            if (row) {
                enterEditMode(row, currentId);
                const nameInput = row.querySelector('input');
                if (nameInput) nameInput.focus();
            }
        } else if (act === 'export') {
            exportToFile();
        } else if (act === 'fetch-remote') {
            btn.disabled = true;
            const orig = btn.textContent;
            btn.textContent = 'Загрузка...';
            fetchRemoteData()
                .then(function () {
                    btn.disabled = false;
                    btn.textContent = orig;
                    toast('Данные получены: ' + Object.keys(GAME_ID_TO_URL).length + ' записей');
                    updateSaveState();
                })
                .catch(function (err) {
                    btn.disabled = false;
                    btn.textContent = orig;
                    toast('Ошибка: ' + err.message, true);
                });
        } else if (act === 'go-search') {
            const v = searchInput.value.trim();
            if (/^\d+$/.test(v)) {
                navigateToGame(v);
            } else {
                const m = v.match(/\/game\/(\d+)/);
                if (m) navigateToGame(m[1]);
                else toast('Введите ID игры или ссылку на неё', true);
            }
        }
    });

    panel.querySelector('.close').addEventListener('click', function () {
        panel.classList.add('hidden');
    });

    document.addEventListener('keydown', function (e) {
        if (e.ctrlKey && e.shiftKey && (e.key === 'E' || e.key === 'e' || e.code === 'KeyE')) {
            e.preventDefault();
            e.stopPropagation();
            panel.classList.toggle('hidden');
            if (!panel.classList.contains('hidden')) {
                renderRows();
                updateSaveState();
            }
        }
    }, true);

    function injectMenuItems() {
        const signOut = findMenuLinkByText('Sign out');
        if (!signOut) return;

        if (document.querySelector('[data-ra-menu="1"]')) return;

        const dataItem = signOut.cloneNode(true);
        dataItem.dataset.raMenu = '1';
        dataItem.dataset.raFetchData = '1';
        dataItem.removeAttribute('href');
        dataItem.style.cursor = 'pointer';
        setTextContent(dataItem, 'Получить последние данные');

        dataItem.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (dataLoading) return;
            dataLoading = true;

            const orig = dataItem.textContent;
            dataItem.textContent = 'Загрузка...';

            fetchRemoteData()
                .then(function () {
                    dataItem.textContent = orig;
                    dataLoading = false;
                    alert('Данные получены: ' + Object.keys(GAME_ID_TO_URL).length + ' записей');
                    updateSaveState();
                })
                .catch(function (err) {
                    console.error('[RA Replacer] fetch error:', err);
                    dataItem.textContent = orig;
                    dataLoading = false;
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
            if (t === target) {
                return el;
            }
        }
        return null;
    }

    // Загружаем локально сохранённые данные и время последнего получения.
    // С Яндекс.Диска автоматически НЕ тянем.
    try {
        const cached = GM_getValue(STORAGE_KEY, null);
        if (cached) {
            try { GAME_ID_TO_URL = JSON.parse(cached); dataLoaded = true; }
            catch (e) {}
        }
        const savedTime = GM_getValue(TIME_KEY, 0);
        if (savedTime && typeof savedTime === 'number') {
            lastFetchTime = savedTime;
        }
    } catch (e) {}

    function tick() {
        if (dataLoaded) {
            applyReplacements();
            applyStatusBadge();
            applyComment();
        }
        injectMenuItems();
        if (!panel.classList.contains('hidden')) updateSaveState();
    }

    const observer = new MutationObserver(function () {
        if (dataLoaded) applyReplacements();
        injectMenuItems();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    setInterval(tick, 500);
    window.addEventListener('load', tick);
    document.addEventListener('DOMContentLoaded', tick);
    tick();
    mountUI();
})();