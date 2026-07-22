(function() {
    var CDN_IMAGES = 'https://cdn.streamingcommunityz.sale/images/';

    function getHeaders() {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml'
        };
    }

    function extractInertiaData(html) {
        var match = html.match(/data-page="([^"]+)"/);
        if (!match) return null;
        try {
            var decoded = match[1]
                .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
                .replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            return JSON.parse(decoded);
        } catch (e) {
            return null;
        }
    }

    function imageUrl(filename) {
        return filename ? CDN_IMAGES + filename : '';
    }

    function findImage(images, type) {
        if (!images) return '';
        for (var i = 0; i < images.length; i++) {
            if (images[i].type === type) return images[i].filename;
        }
        return '';
    }

    function posterUrl(images) {
        if (!images || !images.length) return '';
        var p = findImage(images, 'poster') || findImage(images, 'cover_mobile') || images[0].filename;
        return imageUrl(p);
    }

    function bannerUrl(images) {
        if (!images) return '';
        var b = findImage(images, 'background') || findImage(images, 'cover');
        return imageUrl(b);
    }

    function titleToItem(t) {
        var type = t.type === 'tv' ? 'series' : 'movie';
        var date = t.release_date || t.last_air_date;
        return new MultimediaItem({
            title: t.name || '',
            url: '/it/titles/' + t.id + '-' + (t.slug || ''),
            posterUrl: posterUrl(t.images),
            type: type,
            score: t.score ? parseFloat(t.score) : undefined,
            year: date ? parseInt(date.split('-')[0]) : undefined,
            status: type === 'series' ? 'ongoing' : 'completed',
            description: t.plot || '',
            bannerUrl: bannerUrl(t.images)
        });
    }

    function extractIdFromUrl(url) {
        var m = url.match(/\/titles\/(\d+)/);
        return m ? parseInt(m[1]) : null;
    }

    // ========== getHome ==========
    async function getHome(cb) {
        try {
            var resp = await http_get(manifest.baseUrl + '/', getHeaders());
            if (!resp.body || resp.status >= 400) {
                return cb({ success: false, errorCode: 'NETWORK_ERROR', message: 'Home non disponibile' });
            }

            var data = extractInertiaData(resp.body);
            if (!data || !data.props || !data.props.sliders) {
                return cb({ success: false, errorCode: 'PARSE_ERROR', message: 'Dati home non trovati' });
            }

            var sliders = data.props.sliders;
            var result = {};

            for (var i = 0; i < sliders.length; i++) {
                var s = sliders[i];
                var label = s.label || s.name;
                result[label] = [];
                if (s.titles) {
                    for (var j = 0; j < s.titles.length; j++) {
                        result[label].push(titleToItem(s.titles[j]));
                    }
                }
            }

            if (Object.keys(result).length === 0) {
                return cb({ success: false, errorCode: 'PARSE_ERROR', message: 'Nessun contenuto' });
            }

            cb({ success: true, data: result });
        } catch (e) {
            cb({ success: false, errorCode: 'PARSE_ERROR', message: String(e) });
        }
    }

    // ========== search ==========
    async function search(query, cb) {
        try {
            var url = manifest.baseUrl + '/it/search?q=' + encodeURIComponent(query);
            var resp = await http_get(url, getHeaders());

            if (!resp.body || resp.status >= 400) {
                return cb({ success: false, errorCode: 'SEARCH_ERROR', message: 'Ricerca fallita' });
            }

            // Search returns JSON directly, check content type
            var body = resp.body;
            var result;

            // Try parsing as JSON first
            try {
                result = JSON.parse(body);
            } catch (e) {
                // Try Inertia data from HTML
                var data = extractInertiaData(body);
                if (data && data.props && data.props.titles) {
                    result = { data: data.props.titles.data || data.props.titles };
                } else {
                    return cb({ success: true, data: [] });
                }
            }

            var items = [];
            if (result && result.data) {
                for (var i = 0; i < result.data.length; i++) {
                    items.push(titleToItem(result.data[i]));
                }
            }

            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: 'SEARCH_ERROR', message: String(e) });
        }
    }

    // ========== load ==========
    async function load(url, cb) {
        try {
            var titleId = extractIdFromUrl(url);
            if (!titleId) {
                return cb({ success: false, errorCode: 'INVALID_URL', message: 'URL non valido' });
            }

            var resp = await http_get(manifest.baseUrl + url, getHeaders());
            if (!resp.body || resp.status >= 400) {
                return cb({ success: false, errorCode: 'LOAD_ERROR', message: 'Dettagli non disponibili' });
            }

            var data = extractInertiaData(resp.body);
            if (!data || !data.props || !data.props.title) {
                return cb({ success: false, errorCode: 'PARSE_ERROR', message: 'Dati non trovati' });
            }

            var t = data.props.title;
            var type = t.type === 'tv' ? 'series' : 'movie';
            var date = t.release_date || t.last_air_date;
            var genres = [];
            if (t.genres) {
                for (var g = 0; g < t.genres.length; g++) {
                    genres.push(t.genres[g].name);
                }
            }

            var item = new MultimediaItem({
                title: t.name || '',
                url: url,
                posterUrl: posterUrl(t.images),
                type: type,
                score: t.score ? parseFloat(t.score) : undefined,
                year: date ? parseInt(date.split('-')[0]) : undefined,
                description: t.plot || '',
                status: t.status === 'Ended' ? 'completed' : 'ongoing',
                duration: t.runtime || undefined,
                bannerUrl: bannerUrl(t.images),
                logoUrl: imageUrl(findImage(t.images, 'logo')),
                contentRating: t.age ? t.age + '+' : undefined,
                tags: genres,
                nextAiring: t.coming_soon ? new NextAiring({ airDate: date }) : undefined
            });

            // Build episodes from seasons
            if (type === 'series' && t.seasons) {
                var episodes = [];
                var subIta = !!t.sub_ita;

                for (var s = 0; s < t.seasons.length; s++) {
                    var season = t.seasons[s];
                    var snum = season.number || (s + 1);

                    if (season.episodes && season.episodes.length > 0) {
                        for (var e = 0; e < season.episodes.length; e++) {
                            var ep = season.episodes[e];
                            var epUrl = '';

                            if (ep.video_id) {
                                epUrl = data.props.scws_url + '/embed/' + ep.video_id + '?canPlayFHD=1';
                            }

                            episodes.push(new Episode({
                                name: 'S' + snum + 'E' + ep.number + ' - ' + (ep.name || ''),
                                url: epUrl || ('/it/watch/' + t.id + '?s=' + snum + '&e=' + ep.number),
                                season: snum,
                                episode: ep.number,
                                rating: ep.score ? parseFloat(ep.score) : undefined,
                                airDate: ep.air_date || season.release_date || undefined,
                                dubStatus: subIta ? 'subbed' : 'none'
                            }));
                        }
                    } else {
                        // Season entry without episode details (lazy loaded)
                        episodes.push(new Episode({
                            name: (season.name || ('Stagione ' + snum)) + ' (' + (season.episodes_count || 0) + ' ep)',
                            url: '/it/titles/' + t.id + '-' + t.slug + '/season-' + snum,
                            season: snum,
                            episode: 1,
                            dubStatus: subIta ? 'subbed' : 'none'
                        }));
                    }
                }

                if (episodes.length > 0) {
                    item.episodes = episodes;
                }
            }

            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: 'LOAD_ERROR', message: String(e) });
        }
    }

    // ========== loadStreams ==========
    async function loadStreams(url, cb) {
        try {
            // Direct vixcloud URL
            if (url.indexOf('vixcloud.co') >= 0) {
                return cb({
                    success: true,
                    data: [new StreamResult({ url: url, source: 'VixCloud', quality: 'Auto' })]
                });
            }

            var titleId = extractIdFromUrl(url);
            if (!titleId) {
                return cb({ success: false, errorCode: 'INVALID_URL', message: 'URL non valido' });
            }

            var resp = await http_get(manifest.baseUrl + url, getHeaders());
            if (!resp.body || resp.status >= 400) {
                return cb({ success: false, errorCode: 'STREAM_ERROR', message: 'Stream non disponibile' });
            }

            var data = extractInertiaData(resp.body);
            var streams = [];
            var scwsUrl = '';

            if (data && data.props) {
                scwsUrl = data.props.scws_url || 'https://vixcloud.co';
                var t = data.props.title;
                if (t && t.preview && t.preview.embed_url) {
                    streams.push(new StreamResult({
                        url: t.preview.embed_url,
                        source: 'VixCloud',
                        quality: t.quality || 'Auto'
                    }));
                }
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
