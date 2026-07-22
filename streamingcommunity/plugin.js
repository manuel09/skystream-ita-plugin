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

    var base = 'https://streamingcommunityz.sale';

    async function getHome() {
        var resp = await http_get(base + '/');
        if (!resp.body || resp.status >= 400) throw new Error('Status ' + resp.status);
        var data = extractInertiaData(resp.body);
        if (!data || !data.props || !data.props.sliders) throw new Error('No sliders');
        var sliders = data.props.sliders;
        var out = {};
        for (var i = 0; i < sliders.length; i++) {
            var s = sliders[i];
            out[s.label || s.name] = [];
            if (s.titles) for (var j = 0; j < s.titles.length; j++) out[s.label || s.name].push(toItem(s.titles[j]));
        }
        return out;
    }

    async function search(query) {
        var resp = await http_get(base + '/it/search?q=' + encodeURIComponent(query));
        if (!resp.body || resp.status >= 400) return [];
        var items = [];
        try {
            var result = JSON.parse(resp.body);
            if (result.data) for (var i = 0; i < result.data.length; i++) items.push(toItem(result.data[i]));
        } catch (e) {
            var data = extractInertiaData(resp.body);
            if (data && data.props && data.props.titles) {
                var titles = data.props.titles.data || data.props.titles;
                for (var j = 0; j < titles.length; j++) items.push(toItem(titles[j]));
            }
        }
        return items;
    }

    async function load(url) {
        return new MultimediaItem({
            title: 'TEST - Premi Play',
            url: url,
            posterUrl: 'https://cdn.streamingcommunityz.sale/images/81fa02ec-1135-4ee3-ab28-7f7a08288477.webp',
            type: 'movie',
            description: 'Questo è un test. Se vedi questo, load funziona.',
            streams: [new StreamResult({ url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', source: 'Test' })]
        });
    }

    async function loadStreams(url) {
        if (url.indexOf('vixcloud.co') >= 0 || url.indexOf('/embed/') >= 0) {
            return [new StreamResult({ url: url, source: 'VixCloud' })];
        }
        var tid = getId(url);
        if (!tid) throw new Error('URL non valido');
        if (typeof manifest !== 'undefined') base = manifest.baseUrl || base;
        var resp = await http_get(base + url);
        var streams = [];
        if (resp.body && resp.status < 400) {
            var data = extractInertiaData(resp.body);
            if (data && data.props && data.props.title && data.props.title.preview && data.props.title.preview.embed_url) {
                streams.push(new StreamResult({ url: data.props.title.preview.embed_url, source: 'VixCloud' }));
            }
        }
        if (streams.length === 0) throw new Error('Nessuno stream');
        return streams;
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
