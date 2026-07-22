(function() {

    function UA() {
        return { 'User-Agent': 'Mozilla/5.0' };
    }

    function extractInertiaData(html) {
        var match = html.match(/data-page="([^"]+)"/);
        if (!match) return null;
        try {
            var decoded = match[1]
                .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
                .replace(/&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            return JSON.parse(decoded);
        } catch (e) { return null; }
    }

    function imgUrl(fn) { return fn ? 'https://cdn.streamingcommunityz.sale/images/' + fn : ''; }

    function findImg(ims, t) {
        if (!ims) return '';
        for (var i = 0; i < ims.length; i++) { if (ims[i].type === t) return ims[i].filename; }
        return '';
    }

    function poster(ims) {
        if (!ims || !ims.length) return '';
        return imgUrl(findImg(ims, 'poster') || findImg(ims, 'cover_mobile') || ims[0].filename);
    }

    function banner(ims) {
        if (!ims) return '';
        return imgUrl(findImg(ims, 'background') || findImg(ims, 'cover'));
    }

    function toItem(t) {
        var type = t.type === 'tv' ? 'series' : 'movie';
        var date = t.release_date || t.last_air_date;
        return new MultimediaItem({
            title: t.name || '',
            url: '/it/titles/' + t.id + '-' + (t.slug || ''),
            posterUrl: poster(t.images),
            type: type,
            score: t.score ? parseFloat(t.score) : undefined,
            year: date ? parseInt(date.split('-')[0]) : undefined,
            status: type === 'series' ? 'ongoing' : 'completed',
            description: t.plot || '',
            bannerUrl: banner(t.images)
        });
    }

    function getId(url) {
        var m = url.match(/\/titles\/(\d+)/);
        return m ? parseInt(m[1]) : null;
    }

    async function getHome(cb) {
        cb({ success: false, errorCode: 'TEST_V5', message: 'Plugin v5 loaded' });
        return;
            var data = extractInertiaData(resp.body);
            if (!data || !data.props || !data.props.sliders) {
                return cb({ success: false, errorCode: 'PARSE_ERROR', message: 'No sliders found' });
            }
            var sliders = data.props.sliders;
            var out = {};
            for (var i = 0; i < sliders.length; i++) {
                var s = sliders[i];
                out[s.label || s.name] = [];
                if (s.titles) for (var j = 0; j < s.titles.length; j++) out[s.label || s.name].push(toItem(s.titles[j]));
            }
            cb({ success: true, data: out });
        } catch (e) {
            cb({ success: false, errorCode: 'PARSE_ERROR', message: String(e) });
        }
    }

    async function search(query, cb) {
        try {
            var base = typeof manifest !== 'undefined' && manifest.baseUrl ? manifest.baseUrl : 'https://streamingcommunityz.sale';
            var url = base + '/it/search?q=' + encodeURIComponent(query);
            var resp = await http_get(url, UA());
            if (!resp.body || resp.status >= 400) {
                return cb({ success: false, errorCode: 'SEARCH_ERROR', message: 'Status ' + resp.status });
            }
            var body = resp.body;
            var items = [];
            try {
                var result = JSON.parse(body);
                if (result.data) for (var i = 0; i < result.data.length; i++) items.push(toItem(result.data[i]));
            } catch (e) {
                var data = extractInertiaData(body);
                if (data && data.props && data.props.titles) {
                    var titles = data.props.titles.data || data.props.titles;
                    for (var j = 0; j < titles.length; j++) items.push(toItem(titles[j]));
                }
            }
            cb({ success: true, data: items });
        } catch (e) {
            cb({ success: false, errorCode: 'SEARCH_ERROR', message: String(e) });
        }
    }

    async function load(url, cb) {
        try {
            var tid = getId(url);
            if (!tid) return cb({ success: false, errorCode: 'INVALID_URL', message: 'URL non valido' });

            var base = typeof manifest !== 'undefined' && manifest.baseUrl ? manifest.baseUrl : 'https://streamingcommunityz.sale';
            var resp = await http_get(base + url, UA());
            if (!resp.body || resp.status >= 400) {
                return cb({ success: false, errorCode: 'LOAD_ERROR', message: 'Status ' + resp.status });
            }
            var data = extractInertiaData(resp.body);
            if (!data || !data.props || !data.props.title) {
                return cb({ success: false, errorCode: 'PARSE_ERROR', message: 'No title data' });
            }
            var t = data.props.title;
            var type = t.type === 'tv' ? 'series' : 'movie';
            var date = t.release_date || t.last_air_date;
            var genres = [];
            if (t.genres) for (var g = 0; g < t.genres.length; g++) genres.push(t.genres[g].name);

            var item = new MultimediaItem({
                title: t.name || '',
                url: url,
                posterUrl: poster(t.images),
                type: type,
                score: t.score ? parseFloat(t.score) : undefined,
                year: date ? parseInt(date.split('-')[0]) : undefined,
                description: t.plot || '',
                status: t.status === 'Ended' ? 'completed' : 'ongoing',
                duration: t.runtime || undefined,
                bannerUrl: banner(t.images),
                logoUrl: imgUrl(findImg(t.images, 'logo')),
                contentRating: t.age ? t.age + '+' : undefined,
                tags: genres
            });

            if (type === 'series' && t.seasons) {
                var eps = [];
                var sub = !!t.sub_ita;
                for (var s = 0; s < t.seasons.length; s++) {
                    var se = t.seasons[s];
                    var sn = se.number || (s + 1);
                    if (se.episodes && se.episodes.length > 0) {
                        for (var e = 0; e < se.episodes.length; e++) {
                            var ep = se.episodes[e];
                            eps.push(new Episode({
                                name: 'S' + sn + 'E' + ep.number + ' - ' + (ep.name || ''),
                                url: ep.video_id ? data.props.scws_url + '/embed/' + ep.video_id + '?canPlayFHD=1' : ('/it/watch/' + t.id + '?s=' + sn + '&e=' + ep.number),
                                season: sn,
                                episode: ep.number,
                                rating: ep.score ? parseFloat(ep.score) : undefined,
                                dubStatus: sub ? 'subbed' : 'none'
                            }));
                        }
                    }
                }
                if (eps.length > 0) item.episodes = eps;
            }

            cb({ success: true, data: item });
        } catch (e) {
            cb({ success: false, errorCode: 'LOAD_ERROR', message: String(e) });
        }
    }

    async function loadStreams(url, cb) {
        try {
            if (url.indexOf('vixcloud.co') >= 0 || url.indexOf('/embed/') >= 0) {
                return cb({ success: true, data: [new StreamResult({ url: url, source: 'VixCloud', quality: 'Auto' })] });
            }
            var tid = getId(url);
            if (!tid) return cb({ success: false, errorCode: 'INVALID_URL', message: 'URL non valido' });

            var base = typeof manifest !== 'undefined' && manifest.baseUrl ? manifest.baseUrl : 'https://streamingcommunityz.sale';
            var resp = await http_get(base + url, UA());
            if (!resp.body || resp.status >= 400) {
                return cb({ success: false, errorCode: 'STREAM_ERROR', message: 'Status ' + resp.status });
            }
            var data = extractInertiaData(resp.body);
            var streams = [];
            if (data && data.props && data.props.title && data.props.title.preview && data.props.title.preview.embed_url) {
                streams.push(new StreamResult({
                    url: data.props.title.preview.embed_url,
                    source: 'VixCloud',
                    quality: data.props.title.quality || 'Auto'
                }));
            }
            if (streams.length === 0) {
                return cb({ success: false, errorCode: 'NO_STREAM', message: 'Nessuno stream. Apri il sito.' });
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
// v4
