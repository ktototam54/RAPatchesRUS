// ==UserScript==
// @name         RetroAchievements Hashes Replacer
// @namespace    https://retroachievements.org/
// @version      7.6
// @description  Заменяет 'Supported Game Hashes' на 'Download Game' / 'Русская версия'. Статусы, комментарии, ссылки на ачивки. Данные тянутся с Яндекс.Диска.
// @author       You
// @match        https://retroachievements.org/*
// @match        https://www.retroachievements.org/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @connect      cloud-api.yandex.net
// @connect      disk.yandex.ru
// @connect      yandex.net
// @connect      downloader.disk.yandex.ru
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const REMOTE_PUBLIC_URL = 'https://disk.yandex.ru/d/Ggt6hPg-FCsu_w';
    const REMOTE_SCRIPT_URL = 'https://disk.yandex.ru/d/nqQw4bOmqyjFAA';
    const STORAGE_KEY = 'ra_hashes_replacer_data';
    const DOWNLOAD_TEXT = 'Download Game';
    const RU_TEXT = 'Русская версия';

    const STATUS_META = {
        mastering:     { text: 'Мастеринг',         color: '#f4a900', bg: 'rgba(244,169,0,0.15)',   border: '#f4a900' },
        beaten:        { text: 'Битен',             color: '#c8c8c8', bg: 'rgba(200,200,200,0.15)', border: '#c8c8c8' },
        ru_impossible: { text: 'Ру ром невозможен', color: '#c084fc', bg: 'rgba(192,132,252,0.15)', border: '#c084fc' }
    };

    let GAME_ID_TO_URL = {};
    let dataLoaded = false;
    let dataLoading = false;

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
                    throw new Error('Ожидается объект { "id": { drive, ru, status, comment } }');
                }
                GAME_ID_TO_URL = parsed;
                dataLoaded = true;
                GM_setValue(STORAGE_KEY, JSON.stringify(parsed));
                refreshAll();
            });
    }

    function getLocalVersion() {
        try {
            if (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version) {
                return GM_info.script.version;
            }
        } catch (e) {}
        return '?';
    }

    function updateScriptFromDisk() {
        return yandexResolve(REMOTE_SCRIPT_URL)
            .then(function (href) { return gmFetch(href); })
            .then(function (text) {
                if (!text || text.indexOf('==UserScript==') === -1) {
                    throw new Error('Файл не похож на userscript');
                }

                const remoteMatch = text.match(/@version\s+([^\s]+)/);
                const remoteVer = remoteMatch ? remoteMatch[1] : '?';
                const localVer = getLocalVersion();

                if (remoteVer === localVer) {
                    return { status: 'actual', version: localVer };
                }

                return {
                    status: 'outdated',
                    local: localVer,
                    remote: remoteVer,
                    text: text
                };
            });
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
        '.ra-game-comment .ra-ach-card::before { content: "🏆"; font-size: 13px; }'
    ].join('\n');

    const styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    (document.head || document.documentElement).appendChild(styleEl);

    function injectMenuItems() {
        const signOut = findMenuLinkByText('Sign out');
        if (!signOut) return;

        if (document.querySelector('[data-ra-menu="1"]')) return;

        // ---- «Получить последние данные» ----
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
                    const count = Object.keys(GAME_ID_TO_URL).length;
                    alert('Данные получены: ' + count + ' записей');
                })
                .catch(function (err) {
                    console.error('[RA Replacer] fetch error:', err);
                    dataItem.textContent = orig;
                    dataLoading = false;
                    alert('Не удалось получить данные: ' + err.message);
                });
        });

        // ---- «Обновить скрипт» ----
        const scriptItem = signOut.cloneNode(true);
        scriptItem.dataset.raMenu = '1';
        scriptItem.dataset.raUpdateScript = '1';
        scriptItem.removeAttribute('href');
        scriptItem.style.cursor = 'pointer';
        setTextContent(scriptItem, 'Обновить скрипт');

        scriptItem.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            if (scriptItem.dataset.busy === '1') return;
            scriptItem.dataset.busy = '1';

            const orig = scriptItem.textContent;
            scriptItem.textContent = 'Проверка...';

            updateScriptFromDisk()
                .then(function (res) {
                    scriptItem.textContent = orig;
                    scriptItem.dataset.busy = '0';

                    if (res.status === 'actual') {
                        alert('Уже актуально: ' + res.version);
                        return;
                    }

                    const ok = confirm(
                        'Доступна новая версия: ' + res.remote + '\n' +
                        'У вас установлена: ' + res.local + '\n\n' +
                        'Скопировать новую версию в буфер обмена?\n\n' +
                        'Затем:\n' +
                        '1. Открой Violentmonkey / Tampermonkey → свой скрипт → Редактировать\n' +
                        '2. Ctrl+A → Ctrl+V → Ctrl+S'
                    );
                    if (!ok) return;

                    navigator.clipboard.writeText(res.text).then(
                        function () {
                            alert('Скопировано. Вставь в редактор (Ctrl+V) и сохрани (Ctrl+S).');
                        },
                        function () {
                            alert('Не удалось записать в буфер обмена.');
                        }
                    );
                })
                .catch(function (err) {
                    console.error('[RA Replacer] update error:', err);
                    scriptItem.textContent = orig;
                    scriptItem.dataset.busy = '0';
                    alert('Не удалось проверить обновление: ' + err.message);
                });
        });

        signOut.insertAdjacentElement('beforebegin', scriptItem);
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

    try {
        const cached = GM_getValue(STORAGE_KEY, null);
        if (cached) {
            try { GAME_ID_TO_URL = JSON.parse(cached); dataLoaded = true; }
            catch (e) {}
        }
    } catch (e) {}

    yandexResolve(REMOTE_PUBLIC_URL)
        .then(function (href) { return gmFetch(href); })
        .then(function (text) {
            const parsed = JSON.parse(text);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                GAME_ID_TO_URL = parsed;
                dataLoaded = true;
                GM_setValue(STORAGE_KEY, JSON.stringify(parsed));
                refreshAll();
            }
        })
        .catch(function () {});

    function tick() {
        if (dataLoaded) {
            applyReplacements();
            applyStatusBadge();
            applyComment();
        }
        injectMenuItems();
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
})();