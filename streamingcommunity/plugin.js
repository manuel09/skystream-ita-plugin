(function() {

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
        try {
            var base = typeof manifest !== 'undefined' && manifest.baseUrl ? manifest.baseUrl : 'https://streamingcommunityz.sale';
            var resp = await http_get(base + '/');
            if (!resp.body || resp.status >= 400) {
                return cb({ success: false, errorCode: 'NETWORK_ERROR', message: 'Status ' + resp.status });
            }
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
            var resp = await http_get(url);
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
        cb({ success: true, data: new MultimediaItem({
            title: 'Test Movie',
            url: url,
            posterUrl: 'https://cdn.streamingcommunityz.sale/images/81fa02ec-1135-4ee3-ab28-7f7a08288477.webp',
            type: 'movie',
            streams: [new StreamResult({ url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', source: 'Test' })]
        })});
    }

    async function loadStreams(url, cb) {
        try {
            if (url.indexOf('vixcloud.co') >= 0 || url.indexOf('/embed/') >= 0) {
                var streams = [new StreamResult({ url: url, source: 'VixCloud' })];
                return cb({ success: true, data: streams });
            }
            var tid = getId(url);
            if (!tid) return cb({ success: false, errorCode: 'INVALID_URL', message: 'URL non valido' });

            var base = typeof manifest !== 'undefined' && manifest.baseUrl ? manifest.baseUrl : 'https://streamingcommunityz.sale';
            var resp = await http_get(base + url);
            var streams = [];
            if (resp.body && resp.status < 400) {
                var data = extractInertiaData(resp.body);
                if (data && data.props && data.props.title && data.props.title.preview && data.props.title.preview.embed_url) {
                    streams.push(new StreamResult({ url: data.props.title.preview.embed_url, source: 'VixCloud' }));
                }
            }
            if (streams.length === 0) {
                return cb({ success: false, errorCode: 'NO_STREAM', message: 'Stream non disponibile. Apri il sito nel browser.' });
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
