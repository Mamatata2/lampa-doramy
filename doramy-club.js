/* Doramy Club for Lampa, v0.2.0. Unofficial, no affiliation.
 * Catalog + Lampa torrent search; website viewing is an optional fallback.
 * Android native HTTP is required for cross-origin HTML requests without a proxy.
 * No website scripts, iframe players, DRM or antibot workarounds are executed.
 * License: MIT (this file only).
 */
(function () {
    'use strict';
    if (window.__doramyClubPlugin) return;
    window.__doramyClubPlugin = true;

    var BASE = 'https://doramy.club';
    var KEY = 'doramy_club_bookmarks_v1';
    var network, generation = 0, suppressBack = false, menuObserver;

    function text(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
    function esc(s) {
        return text(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function absolute(value, base) {
        try {
            var u = new URL(value, base || BASE + '/');
            return u.protocol === 'https:' && u.hostname === 'doramy.club' && !u.username && !u.password ? u.href : '';
        } catch (e) { return ''; }
    }
    function imageUrl(value) {
        var u = absolute(value);
        return u && /\.(?:jpg|jpeg|png|webp)(?:\?|$)/i.test(u) ? u : '';
    }
    function siteUrl(value) { return absolute(value) || BASE + '/'; }
    function stop() {
        generation++;
        if (network) network.clear();
    }
    function closeSelect() {
        suppressBack = true;
        try {
            if (Lampa.Select.closeAll) Lampa.Select.closeAll();
            else if (Lampa.Select.opened && Lampa.Select.opened()) Lampa.Select.close();
        } finally { suppressBack = false; }
    }
    function show(title, items, select, back) {
        closeSelect();
        Lampa.Select.show({
            title: esc(title), items: items,
            onSelect: select,
            onBack: function () { if (!suppressBack) { stop(); back(); } }
        });
    }
    function notice(s) { Lampa.Noty.show(s); }
    function leave() {
        stop(); closeSelect(); Lampa.Controller.toggle('menu');
    }
    function openWebsite(url) {
        url = siteUrl(url);
        // Use the native external-browser method only when available.
        try {
            if (typeof AndroidJS !== 'undefined' && typeof AndroidJS.openBrowser === 'function') {
                AndroidJS.openBrowser(url);
                return;
            }
        } catch (e) { /* use a standard link below */ }
        var a = document.createElement('a');
        a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        document.body.appendChild(a); a.click(); a.remove();
        notice('Если браузер не открылся, откройте doramy.club вручную.');
    }
    function documentFrom(html) {
        if (typeof html !== 'string') throw new Error('Сервер вернул не HTML.');
        if (/get_jhash|__js_p_|gorizontal-vertikal|cf-chl-/i.test(html)) {
            throw new Error('Сайт запросил антибот-проверку. Плагин её не проходит; откройте сайт в браузере.');
        }
        // DOMParser creates an inert document; fetched scripts are never inserted into Lampa.
        return new DOMParser().parseFromString(html, 'text/html');
    }
    function parseCatalog(html, current) {
        var doc = documentFrom(html), records = [], seen = {};
        var blocks = doc.querySelectorAll('.post-list');
        for (var i = 0; i < blocks.length; i++) {
            var block = blocks[i];
            var a = block.querySelector('.img-link a[href]');
            if (!a) continue;
            var url = absolute(a.getAttribute('href'), current);
            if (!url || !/\/\d+[^/]*\.html(?:\?|$)/.test(url) || seen[url]) continue;
            seen[url] = true;
            var name = a.querySelector('span');
            var img = a.querySelector('img');
            var title = text(name ? name.textContent : a.textContent);
            if (!title) continue;
            var meta = [];
            var original = block.querySelector('em');
            if (original) meta.push(text(original.textContent));
            var rows = block.querySelectorAll('table');
            for (var j = 0; j < rows.length; j++) meta.push(text(rows[j].textContent));
            records.push({
                title: title, url: url,
                original_title: original ? text(original.textContent) : "",
                poster: img ? imageUrl(img.getAttribute('data-src') || img.getAttribute('src')) : '',
                subtitle: meta.join(' · ')
            });
        }
        var next = '', links = doc.querySelectorAll('a[href]');
        for (var k = 0; k < links.length; k++) {
            var rel = links[k].getAttribute('rel') || '';
            var label = text(links[k].textContent);
            if (/\bnext\b/.test(rel) || /^Далее\s*(?:→|»)?$/i.test(label)) {
                var candidate = absolute(links[k].getAttribute('href'), current);
                if (candidate && candidate !== current) { next = candidate; break; }
            }
        }
        // Fail loudly if markup changed, not silently pretending there are no results.
        var empty = /ничего не найдено|ничего не нашли|по вашему запросу|ничего не удалось найти/i.test(doc.body.textContent);
        if (!records.length && !empty) throw new Error('Не найдены карточки: возможно, сайт изменил разметку или ограничил запрос.');
        return { items: records, next: next };
    }
    function parseDetail(html) {
        var doc = documentFrom(html);
        var el = doc.querySelector('.infotext');
        var meta = doc.querySelector('meta[name="description"]');
        return text(el ? el.textContent : meta ? meta.getAttribute('content') : '') || 'Описание не найдено.';
    }
    function saved() {
        var data = Lampa.Storage.get(KEY, []);
        if (!Array.isArray(data)) return [];
        return data.filter(function (x) { return x && x.title && absolute(x.url); }).slice(0, 200);
    }
    function contains(url) { return saved().some(function (x) { return x.url === url; }); }
    function toggleSaved(record) {
        var data = saved(), index = -1;
        for (var i = 0; i < data.length; i++) if (data[i].url === record.url) index = i;
        if (index >= 0) data.splice(index, 1);
        else {
            data.unshift({ title: record.title, url: siteUrl(record.url), poster: imageUrl(record.poster), original_title: record.original_title || '', subtitle: record.subtitle || '' });
            data = data.slice(0, 200);
        }
        Lampa.Storage.set(KEY, data);
        notice(index >= 0 ? 'Удалено из сохранённого' : 'Добавлено в сохранённое');
    }
    function errorScreen(message, url, retry, back) {
        show('Doramy Club: не удалось загрузить', [
            { title: 'Причина', subtitle: esc(message), action: 'info' },
            { title: 'Повторить', action: 'retry' },
            { title: 'Открыть страницу в браузере', action: 'web' },
            { title: 'Назад', action: 'back' }
        ], function (item) {
            if (item.action === 'retry') retry();
            if (item.action === 'web') openWebsite(url);
            if (item.action === 'back') back();
        }, back);
    }
    function request(url, done, back, retry) {
        stop(); var token = generation;
        show('Doramy Club', [
            { title: 'Загрузка…', subtitle: 'Ожидание — не более 20 секунд', action: 'wait' },
            { title: 'Открыть в браузере', action: 'web' },
            { title: 'Отмена', action: 'cancel' }
        ], function (item) {
            if (item.action === 'web') openWebsite(url);
            if (item.action === 'cancel') { stop(); back(); }
        }, back);
        function fail(message) {
            if (token !== generation) return;
            errorScreen(message, url, retry, back);
        }
        network.native(siteUrl(url), function (html) {
            if (token !== generation) return;
            try { done(html); }
            catch (e) { fail(e.message || 'Не удалось разобрать ответ сайта.'); }
        }, function () {
            fail('Нет ответа. Нужны доступ к сайту и нативные HTTP-запросы Android-приложения Lampa. В браузерной Lampa запрос может блокироваться CORS.');
        }, false, { dataType: 'text', timeout: 20000 });
    }
    function torrentSearch(record, query) {
        query = text(query).slice(0, 250);
        if (!query) { notice('Введите название для поиска'); return; }
        if (!Lampa.Activity || typeof Lampa.Activity.push !== 'function') {
            notice('В этой сборке нет API Lampa.Activity.push. Обновите Lampa.');
            return;
        }
        var match = /\/(\d+)[^/]*\.html/.exec(record.url || '');
        // This is a local namespaced ID, NOT a TMDB/KinoPoisk ID.
        // from_search deliberately uses free-text search and suppresses TMDB-specific filters.
        var movie = {
            id: 'doramy-club-' + (match ? match[1] : encodeURIComponent(record.title)),
            title: text(record.title), original_title: text(record.original_title || record.title),
            genres: [], img: imageUrl(record.poster), poster_path: imageUrl(record.poster)
        };
        stop(); closeSelect();
        try {
            Lampa.Activity.push({
                component: 'torrents', title: 'Торренты: ' + query,
                search: query, from_search: true, page: 1, movie: movie
            });
        } catch (e) {
            console.warn('Doramy Club: torrent activity failed', e);
            notice('Не удалось открыть поиск торрентов. Проверьте сборку и настройки парсера Lampa.');
            card(record, home);
        }
    }
    function editTorrentQuery(record, back, description) {
        Lampa.Input.edit({
            title: 'Название для поиска торрентов', value: text(record.title), free: true, nosave: true
        }, function (query) {
            query = text(query);
            if (query) torrentSearch(record, query);
            else card(record, back, description);
        });
    }
    function card(record, back, description) {
        show(record.title, [
            { title: 'Найти торренты', subtitle: 'Через текущий парсер Lampa — ваши настройки JacRed', action: 'torrents' },
            { title: 'Торренты: оригинальное название', subtitle: esc(record.original_title || 'Название не указано'), action: 'original' },
            { title: 'Изменить запрос торрентов', subtitle: 'Другое название, сезон или номер серии', action: 'query' },
            { title: 'Смотреть на doramy.club', subtitle: 'Откроется внешний браузер, не плеер Lampa', action: 'web' },
            { title: contains(record.url) ? 'Удалить из сохранённого' : 'В сохранённое', action: 'save' },
            { title: 'Описание', subtitle: description ? esc(description) : 'Загрузить описание с сайта', action: 'info' },
            { title: 'Назад', action: 'back' }
        ], function (item) {
            if (item.action === 'torrents') torrentSearch(record, record.title);
            if (item.action === 'original') {
                if (record.original_title) torrentSearch(record, record.original_title);
                else notice('Оригинальное название не указано. Используйте изменение запроса.');
            }
            if (item.action === 'query') editTorrentQuery(record, back, description);
            if (item.action === 'web') openWebsite(record.url);
            if (item.action === 'save') { toggleSaved(record); card(record, back, description); }
            if (item.action === 'back') back();
            if (item.action === 'info' && !description) {
                var retry = function () {
                    request(record.url, function (html) { card(record, back, parseDetail(html)); },
                        function () { card(record, back); }, retry);
                };
                retry();
            }
        }, back);
    }
    function catalog(url, title, back) {
        function retry() { catalog(url, title, back); }
        request(url, function (html) {
            var data = parseCatalog(html, url);
            function render() {
                var items = data.items.map(function (r) {
                    return { title: esc(r.title), subtitle: esc(r.subtitle), thumbnail: r.poster, record: r };
                });
                if (!items.length) items.push({ title: 'Ничего не найдено', action: 'none' });
                if (data.next) items.push({ title: 'Следующая страница →', action: 'next' });
                items.push({ title: 'Назад', action: 'back' });
                show(title, items, function (item) {
                    if (item.record) card(item.record, render);
                    if (item.action === 'next') catalog(data.next, title, render);
                    if (item.action === 'back') back();
                }, back);
            }
            render();
        }, back, retry);
    }
    function bookmarks() {
        var records = saved();
        var items = records.map(function (r) {
            return { title: esc(r.title), subtitle: esc(r.subtitle), thumbnail: imageUrl(r.poster), record: r };
        });
        if (!items.length) items.push({ title: 'Пока пусто', subtitle: 'Добавляйте дорамы через их карточки' });
        items.push({ title: 'Назад', action: 'back' });
        show('Дорамы — сохранённое', items, function (item) {
            if (item.record) card(item.record, bookmarks);
            if (item.action === 'back') home();
        }, home);
    }
    function search() {
        // Keep the select as the keyboard's underlying controller.
        Lampa.Input.edit({ title: 'Поиск на doramy.club', value: '', free: true, nosave: true }, function (query) {
            query = text(query);
            if (!query) return home();
            if (query.length < 3) { notice('Введите не менее трёх символов'); return home(); }
            catalog(BASE + '/?s=' + encodeURIComponent(query), 'Дорамы: ' + query, home);
        });
    }
    function home() {
        stop();
        show('Дорамы · Doramy Club', [
            { title: 'Поиск', action: 'search' },
            { title: 'Последние обновления', path: '/' },
            { title: 'Новинки', path: '/1-novinki' },
            { title: 'Корейские', path: '/strana/2-yuzhnaya-koreya' },
            { title: 'Китайские', path: '/strana/2-kitaj' },
            { title: 'Японские', path: '/strana/1-yaponiya' },
            { title: 'Тайские', path: '/strana/tailand' },
            { title: 'Фильмы', path: '/filmy' },
            { title: 'Сериалы', path: '/serialy' },
            { title: 'Сохранённое', action: 'saved' },
            { title: 'Открыть сайт в браузере', action: 'web' },
            { title: 'Закрыть', action: 'exit' }
        ], function (item) {
            if (item.path) catalog(BASE + item.path, item.title, home);
            if (item.action === 'search') search();
            if (item.action === 'saved') bookmarks();
            if (item.action === 'web') openWebsite(BASE + '/');
            if (item.action === 'exit') leave();
        }, leave);
    }
    function mount() {
        var list = $('.menu .menu__list').first();
        if (!list.length) list = $('.menu__list').first();
        if (!list.length || document.getElementById('doramy-club-menu')) return;
        var entry = $('<li class="menu__item selector" id="doramy-club-menu" data-action="doramy_club"><div class="menu__ico"></div><div class="menu__text">Дорамы</div></li>');
        entry.find('.menu__ico').html('<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 4v16M16 4v16M3 9h5M3 15h5M16 9h5M16 15h5"/></svg>');
        entry.on('hover:enter', home);
        var serials = list.find('[data-action="tv"]').first();
        if (serials.length) serials.after(entry); else list.append(entry);
    }
    function start() {
        if (!window.Lampa || !window.jQuery || !Lampa.Reguest || !Lampa.Select || !Lampa.Storage) return false;
        network = new Lampa.Reguest(); network.timeout(20000);
        mount();
        // Observe menu rebuilds without a forever-running polling interval.
        var queued = false;
        menuObserver = new MutationObserver(function () {
            if (document.getElementById('doramy-club-menu') || queued) return;
            queued = true;
            setTimeout(function () { queued = false; mount(); }, 100);
        });
        menuObserver.observe(document.body, { childList: true, subtree: true });
        return true;
    }
    var attempts = 0;
    function boot() {
        if (start()) return;
        if (++attempts < 120) setTimeout(boot, 500);
        else { window.__doramyClubPlugin = false; console.warn('Doramy Club: Lampa API not ready'); }
    }
    boot();
})();
