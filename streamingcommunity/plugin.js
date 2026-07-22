(function() {
    var CDN_IMAGES = 'https://cdn.streamingcommunityz.sale/images/';
    var _cookies = {};
    var _csrfToken = '';

    function extractCookie(setCookieHeader) {
        if (!setCookieHeader) return '';
        var cookieStr = '';
        if (Array.isArray(setCookieHeader)) {
            cookieStr = setCookieHeader.join('; ');
        } else {
            cookieStr = setCookieHeader;
        }
        return cookieStr;
    }

    function parseCookies(headers) {
        var setCookie = headers['set-cookie'] || headers['Set-Cookie'] || '';
        if (!setCookie) return;
        var cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
        for (var i = 0; i < cookies.length; i++) {
            var parts = cookies[i].split(';')[0].split('=');
            if (parts.length >= 2) {
                _cookies[parts[0].trim()] = parts.slice(1).join('=');
            }
            if (parts[0].trim() === 'XSRF-TOKEN') {
                _csrfToken = decodeURIComponent(parts.slice(1).join('='));
            }
        }
    }

    function getCookieHeader() {
        var pairs = [];
        for (var key in _cookies) {
            if (_cookies.hasOwnProperty(key)) {
                pairs.push(key + '=' + _cookies[key]);
            }
        }
        return pairs.join('; ');
    }

    function getApiHeaders() {
        var h = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/json',
            'Origin': manifest.baseUrl,
            'Referer': manifest.baseUrl + '/'
        };
        if (_csrfToken) h['X-XSRF-TOKEN'] = _csrfToken;
        if (Object.keys(_cookies).length > 0) h['Cookie'] = getCookieHeader();
        return h;
    }

    function getHtmlHeaders() {
        var h = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml'
        };
        if (Object.keys(_cookies).length > 0) h['Cookie'] = getCookieHeader();
        return h;
    }

    async function initSession() {
        if (Object.keys(_cookies).length > 0) return;
        try {
            var resp = await http_get(manifest.baseUrl + '/sanctum/csrf-cookie', {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest'
            });
            parseCookies(resp.headers || {});
        } catch (e) {
            // Try to get cookies from the main page
            try {
                var resp2 = await http_get(manifest.baseUrl + '/', {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                });
                parseCookies(resp2.headers || {});
            } catch (e2) {
                // Ignore
            }
        }
    }

    function posterUrl(filename) {
        if (!filename) return '';
        return CDN_IMAGES + filename;
    }

    function extractPoster(images) {
        if (!images || !images.length) return '';
        var poster = null;
        var coverMob = null;
        for (var i = 0; i < images.length; i++) {
            if (images[i].type === 'poster') poster = images[i];
            if (images[i].type === 'cover_mobile') coverMob = images[i];
        }
        var img = poster || coverMob || images[0];
        return img ? posterUrl(img.filename) : '';
    }

    function extractBanner(images) {
        if (!images) return '';
        for (var i = 0; i < images.length; i++) {
            if (images[i].type === 'background') return posterUrl(images[i].filename);
            if (images[i].type === 'cover') return posterUrl(images[i].filename);
        }
        return '';
    }

    function extractLogo(images) {
        if (!images) return '';
        for (var i = 0; i < images.length; i++) {
            if (images[i].type === 'logo') return posterUrl(images[i].filename);
        }
        return '';
    }

    function titleToItem(t, typeOverride) {
        var type = typeOverride || (t.type === 'tv' ? 'series' : 'movie');
        var releaseDate = t.release_date || t.last_air_date;
        return new MultimediaItem({
            title: t.name || '',
            url: '/it/titles/' + t.id + '-' + (t.slug || ''),
            posterUrl: extractPoster(t.images),
            type: type,
            score: t.score ? parseFloat(t.score) : undefined,
            year: releaseDate ? parseInt(releaseDate.split('-')[0]) : undefined,
            status: type === 'series' ? 'ongoing' : 'completed',
            description: t.plot || '',
            bannerUrl: extractBanner(t.images),
            logoUrl: extractLogo(t.images)
        });
    }

    function extractIdFromUrl(url) {
        var match = url.match(/\/titles\/(\d+)/);
        return match ? parseInt(match[1]) : null;
    }

    registerSettings({
        username: { type: 'string', label: 'Email (opzionale)', default: '' },
        password: { type: 'string', label: 'Password (opzionale)', default: '', password: true }
    });

    // ===== getHome =====
    async function getHome(cb) {
        try {
            await initSession();

            var response = await http_post(
                manifest.baseUrl + '/api/sliders/fetch',
                getApiHeaders(),
                JSON.stringify({
                    sliders: [
                        { name: 'trending' },
                        { name: 'latest' },
                        { name: 'film' }
                    ]
                })
            );

            parseCookies(response.headers || {});

            if (!response.body || response.status >= 400) {
                return cb({ success: false, errorCode: 'NETWORK_ERROR', message: 'Errore ' + response.status });
            }

            var sliders = JSON.parse(response.body);
            if (!Array.isArray(sliders)) {
                return cb({ success: false, errorCode: 'PARSE_ERROR', message: 'Risposta API non valida' });
            }

            var data = {};
            for (var i = 0; i < sliders.length; i++) {
                var slider = sliders[i];
                var label = slider.label || slider.name;
                data[label] = [];
                if (slider.titles) {
                    for (var j = 0; j < slider.titles.length; j++) {
                        data[label].push(titleToItem(slider.titles[j]));
                    }
                }
            }

            if (Object.keys(data).length === 0) {
                return cb({ success: false, errorCode: 'PARSE_ERROR', message: 'Nessun contenuto trovato' });
            }

            cb({ success: true, data: data });
        } catch (e) {
            cb({ success: false, errorCode: 'PARSE_ERROR', message: String(e) });
        }
    }

    // ===== search =====
    async function search(query, cb) {
        try {
            await initSession();

            var url = manifest.baseUrl + '/it/search?q=' + encodeURIComponent(query);
            var response = await http_get(url, getApiHeaders());

            parseCookies(response.headers || {});

            if (!response.body || response.status >= 400) {
                return cb({ success: false, errorCode: 'SEARCH_ERROR', message: 'Ricerca fallita' });
            }

            var result = JSON.parse(response.body);
            var items = [];

            if (result.data) {
                for (var i = 0; i < result.data.length; i++) {
                    items.push(titleToItem(result.data[i]));
                }
            }

            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: 'SEARCH_ERROR', message: String(e) });
        }
    }

    // ===== load =====
    async function load(url, cb) {
        try {
            var titleId = extractIdFromUrl(url);
            if (!titleId) {
                return cb({ success: false, errorCode: 'INVALID_URL', message: 'URL non valido' });
            }

            await initSession();

            var response = await http_post(
                manifest.baseUrl + '/api/titles/preview/' + titleId,
                getApiHeaders(),
                '{}'
            );

            parseCookies(response.headers || {});

            if (!response.body || response.status >= 400) {
                return cb({ success: false, errorCode: 'LOAD_ERROR', message: 'Impossibile caricare i dettagli' });
            }

            var t = JSON.parse(response.body);
            var type = t.type === 'tv' ? 'series' : 'movie';
            var genres = [];
            if (t.genres) {
                for (var g = 0; g < t.genres.length; g++) {
                    genres.push(t.genres[g].name);
                }
            }
            var releaseDate = t.release_date || t.last_air_date;

            var title = t.name || '';
            if (!title && url) {
                var slugParts = url.split('-');
                if (slugParts.length > 1) {
                    title = slugParts.slice(1).join(' ');
                    title = title.replace(/\b\w/g, function(c) { return c.toUpperCase(); });
                }
            }

            var plot = t.plot || '';

            var item = new MultimediaItem({
                title: title,
                url: url,
                posterUrl: extractPoster(t.images),
                type: type,
                score: t.score ? parseFloat(t.score) : undefined,
                year: releaseDate ? parseInt(releaseDate.split('-')[0]) : undefined,
                description: plot,
                status: type === 'series' ? 'ongoing' : 'completed',
                duration: t.runtime || undefined,
                bannerUrl: extractBanner(t.images),
                logoUrl: extractLogo(t.images),
                contentRating: t.age ? t.age + '+' : undefined,
                tags: genres
            });

            if (type === 'series') {
                try {
                    var htmlResponse = await http_get(
                        manifest.baseUrl + '/it/titles/' + t.id + '-' + t.slug,
                        getHtmlHeaders()
                    );
                    parseCookies(htmlResponse.headers || {});

                    if (htmlResponse.body) {
                        var episodes = parseEpisodesFromHtml(htmlResponse.body, t.id, t.slug);
                        if (episodes.length > 0) {
                            item.episodes = episodes;
                        }
                    }
                } catch (epErr) {
                    // Episodes are optional, metadata is enough
                }
            }

            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: 'LOAD_ERROR', message: String(e) });
        }
    }

    function parseEpisodesFromHtml(html, titleId, slug) {
        var episodes = [];
        var match = html.match(/data-page="([^"]+)"/);
        if (!match) return episodes;

        try {
            var decoded = match[1]
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
                .replace(/&#039;/g, "'")
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>');
            var data = JSON.parse(decoded);
            var title = data.props && data.props.title;
            if (!title || !title.seasons) return episodes;

            var subIta = !!title.sub_ita;
            var hasSeasonsWithEpisodes = false;

            for (var s = 0; s < title.seasons.length; s++) {
                var season = title.seasons[s];
                var seasonNum = season.number || (s + 1);

                if (season.episodes && season.episodes.length > 0) {
                    hasSeasonsWithEpisodes = true;
                    for (var e = 0; e < season.episodes.length; e++) {
                        var ep = season.episodes[e];
                        episodes.push(new Episode({
                            name: 'S' + String(seasonNum) + 'E' + String(ep.number) + ' - ' + (ep.name || ''),
                            url: '/it/titles/' + titleId + '-' + slug + '/season-' + seasonNum + '#ep-' + ep.number,
                            season: seasonNum,
                            episode: ep.number,
                            rating: ep.score ? parseFloat(ep.score) : undefined,
                            dubStatus: subIta ? 'subbed' : 'none'
                        }));
                    }
                }
            }

            if (!hasSeasonsWithEpisodes && title.seasons.length > 0) {
                for (var j = 0; j < title.seasons.length; j++) {
                    var s2 = title.seasons[j];
                    var snum = s2.number || (j + 1);
                    episodes.push(new Episode({
                        name: (s2.name || ('Stagione ' + snum)) + ' (' + (s2.episodes_count || 0) + ' episodi)',
                        url: '/it/titles/' + titleId + '-' + slug + '/season-' + snum,
                        season: snum,
                        episode: 1,
                        dubStatus: subIta ? 'subbed' : 'none'
                    }));
                }
            }
        } catch (e) {
            // Parse failed, skip episodes
        }

        return episodes;
    }

    // ===== loadStreams =====
    async function loadStreams(url, cb) {
        try {
            var titleId = extractIdFromUrl(url);
            if (!titleId) {
                if (url.indexOf('vixcloud.co') >= 0) {
                    return cb({
                        success: true,
                        data: [new StreamResult({ url: url, source: 'VixCloud', quality: 'Auto' })]
                    });
                }
                return cb({ success: false, errorCode: 'INVALID_URL', message: 'URL non valido' });
            }

            await initSession();

            var response = await http_post(
                manifest.baseUrl + '/api/titles/preview/' + titleId,
                getApiHeaders(),
                '{}'
            );

            parseCookies(response.headers || {});

            if (!response.body || response.status >= 400) {
                return cb({ success: false, errorCode: 'STREAM_ERROR', message: 'Stream non disponibile' });
            }

            var t = JSON.parse(response.body);
            var streams = [];

            if (t.preview && t.preview.embed_url) {
                streams.push(new StreamResult({
                    url: t.preview.embed_url,
                    source: 'VixCloud',
                    quality: t.quality || 'Auto'
                }));
            }

            if (streams.length === 0) {
                return cb({
                    success: false,
                    errorCode: 'NO_STREAM',
                    message: 'Nessuno stream disponibile. Apri il sito nel browser.'
                });
            }

            cb({ success: true, data: streams });
        } catch (e) {
            cb({ success: false, errorCode: 'STREAM_ERROR', message: String(e) });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
