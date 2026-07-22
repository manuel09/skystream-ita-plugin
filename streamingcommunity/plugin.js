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
        var out = {};
        for (var i = 0; i < data.props.sliders.length; i++) {
            var s = data.props.sliders[i];
            out[s.label || s.name] = [];
            if (s.titles) for (var j = 0; j < s.titles.length; j++) out[s.label || s.name].push(toItem(s.titles[j]));
        }
        return out;
    }

    async function search(query) {
        var resp = await http_get(base + '/it/search?q=' + encodeURIComponent(query));
        if (!resp.body || resp.status >= 400) return [];
        try {
            var result = JSON.parse(resp.body);
            var items = [];
            if (result.data) for (var i = 0; i < result.data.length; i++) items.push(toItem(result.data[i]));
            return items;
        } catch (e) {
            var data = extractInertiaData(resp.body);
            if (data && data.props && data.props.titles) {
                var titles = data.props.titles.data || data.props.titles;
                var items = [];
                for (var j = 0; j < titles.length; j++) items.push(toItem(titles[j]));
                return items;
            }
        }
        return [];
    }

    async function load(url) {
        if (typeof manifest !== 'undefined' && manifest.baseUrl) base = manifest.baseUrl;
        var resp = await http_get(base + url);
        if (!resp.body || resp.status >= 400) throw new Error('Status ' + resp.status);
        var data = extractInertiaData(resp.body);
        if (!data || !data.props || !data.props.title) throw new Error('No data');
        var t = data.props.title;
        var isSeries = t.type === 'tv';
        var date = t.release_date || t.last_air_date;
        var genres = [];
        if (t.genres) for (var g = 0; g < t.genres.length; g++) genres.push(t.genres[g].name);
        var embedUrl = (t.preview && t.preview.embed_url) ? t.preview.embed_url : null;

        var item = new MultimediaItem({
            title: t.name || '',
            url: embedUrl || url,
            posterUrl: poster(t.images),
            type: isSeries ? 'series' : 'movie',
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

        if (embedUrl) {
            item.streams = [new StreamResult({ url: embedUrl, source: 'VixCloud' })];
        }

        if (isSeries && t.seasons) {
            var eps = [];
            var sub = !!t.sub_ita;
            var scws = data.props.scws_url || 'https://vixcloud.co';
            for (var s = 0; s < t.seasons.length; s++) {
                var se = t.seasons[s];
                var sn = se.number || (s + 1);
                if (se.episodes && se.episodes.length > 0) {
                    for (var e = 0; e < se.episodes.length; e++) {
                        var ep = se.episodes[e];
                        var epUrl = ep.video_id ? scws + '/embed/' + ep.video_id + '?canPlayFHD=1' : '';
                        eps.push(new Episode({
                            name: 'S' + sn + 'E' + ep.number + ' - ' + (ep.name || ''),
                            url: epUrl || ('/it/titles/' + t.id + '-' + t.slug + '/season-' + sn),
                            season: sn,
                            episode: ep.number,
                            rating: ep.score ? parseFloat(ep.score) : undefined,
                            dubStatus: sub ? 'subbed' : 'none',
                            streams: epUrl ? [new StreamResult({ url: epUrl, source: 'VixCloud' })] : undefined
                        }));
                    }
                }
            }
            if (eps.length > 0) item.episodes = eps;
        }

        return item;
    }

    async function loadStreams(url) {
        if (url.indexOf('vixcloud.co') >= 0 || url.indexOf('/embed/') >= 0) {
            return [new StreamResult({ url: url, source: 'VixCloud' })];
        }
        var tid = getId(url);
        if (!tid) throw new Error('Invalid URL');
        if (typeof manifest !== 'undefined' && manifest.baseUrl) base = manifest.baseUrl;
        var resp = await http_get(base + url);
        if (resp.body && resp.status < 400) {
            var data = extractInertiaData(resp.body);
            if (data && data.props && data.props.title && data.props.title.preview && data.props.title.preview.embed_url) {
                return [new StreamResult({ url: data.props.title.preview.embed_url, source: 'VixCloud' })];
            }
        }
        throw new Error('No stream available');
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();
