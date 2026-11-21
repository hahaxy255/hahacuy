// ID: ext_doujindesu
// NAME: Doujindesu
// TYPE: comic
// VERSION: 1.0.0
// COLOR: #E91E63
// ICON: https://www.google.com/s2/favicons?domain=doujin.desu.xxx&sz=64
// REFERER: https://doujin.desu.xxx/

/**
 * Ekstensi KonMik untuk Doujindesu (https://doujin.desu.xxx)
 *
 * Situs berupa React SPA; data diambil dari endpoint /api/* dan responsnya
 * terenkripsi (_enc_resp_, XOR berbasis waktu). Ekstensi ini meniru yang
 * dilakukan bundle JS situs: kirim header X-App-Secret + x-device-id, lalu
 * dekripsi respons.
 *
 * WAJIB: isi APP_SECRET dan SALT di bawah ini. Tanpa keduanya API menolak
 * permintaan (sama seperti DOUJIN_APP_SECRET / DOUJIN_SALT pada scraper asli).
 */

// ── KONFIGURASI (isi sendiri) ────────────────────────────────────────────
const APP_SECRET = '';   // ← isi nilai DOUJIN_APP_SECRET
const SALT = '';         // ← isi nilai DOUJIN_SALT

const BASE = 'https://doujin.desu.xxx';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const PAGE_SIZE = 24;
const CACHE_TTL_MS = 3600 * 1000;

// ── Dekripsi (port persis dari bundle situs) ─────────────────────────────

function generateKey(s) {
    let hash = 0;
    for (let n = 0; n < s.length; n++) {
        hash = (hash << 5) - hash + s.charCodeAt(n);
        hash |= 0;
    }
    let out = '';
    let x = Math.abs(hash) || 123456789;
    for (let n = 0; n < 32; n++) {
        x = (x * 1664525 + 1013904223) % 4294967296;
        out += String.fromCharCode(33 + (x % 93));
    }
    return out;
}

function decryptHex(hex, key) {
    const bytes = [];
    for (let d = 0; d < hex.length; d += 2) {
        const w = hex.substring(d, d + 2);
        if (!w) break;
        bytes.push(parseInt(w, 16));
    }
    const out = [];
    const keyLen = key.length;
    let n = 42;
    for (let d = 0; d < bytes.length; d++) {
        const w = bytes[d];
        const p = key.charCodeAt(d % keyLen);
        const ch = w ^ p ^ (d * 13) ^ n;
        out.push(String.fromCharCode(ch & 255));
        n = (n + w) % 256;
    }
    return out.join('');
}

// Kunci berotasi per jam; coba bucket sekarang, -1, dan +1.
function candidateKeys() {
    const bucket = Math.floor(Date.now() / 3600000);
    return [bucket, bucket - 1, bucket + 1].map(b => generateKey(`${SALT}_${b}`));
}

function decryptResponse(enc) {
    const keys = candidateKeys();
    for (let i = 0; i < keys.length; i++) {
        try {
            return JSON.parse(decodeURIComponent(decryptHex(enc, keys[i])));
        } catch (e) {
            // coba kunci berikutnya
        }
    }
    throw new Error('Gagal mendekripsi respons server (periksa APP_SECRET / SALT)');
}

// ── HTTP + cache memori ──────────────────────────────────────────────────

const memCache = {};

function deviceId() {
    return 'dev_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now().toString(36);
}

async function apiGet(path) {
    if (!APP_SECRET || !SALT) {
        throw new Error('APP_SECRET / SALT belum diisi di file ekstensi doujindesu.js');
    }

    const hit = memCache[path];
    if (hit && hit.exp > Date.now()) return hit.data;

    const res = await fetch(`${BASE}/api${path}`, {
        headers: {
            'User-Agent': UA,
            'Accept': 'application/json',
            'Referer': `${BASE}/`,
            'X-App-Secret': APP_SECRET,
            'x-app-secret': APP_SECRET,
            'x-device-id': deviceId(),
            'x-device-name': 'Desktop',
        },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);

    const text = await res.text();
    let data;
    if (text.indexOf('_enc_resp_') !== -1) {
        data = decryptResponse(JSON.parse(text)._enc_resp_);
    } else {
        data = JSON.parse(text);
    }

    memCache[path] = { data: data, exp: Date.now() + CACHE_TTL_MS };
    return data;
}

// ── Helper ───────────────────────────────────────────────────────────────

function fullUrl(u) {
    if (typeof u !== 'string' || !u) return '';
    if (/^https?:\/\//i.test(u)) return u;
    if (u.startsWith('//')) return 'https:' + u;
    if (u.startsWith('/')) return BASE + u;
    return '';
}

function toList(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.data)) return data.data;
    if (data && Array.isArray(data.results)) return data.results;
    return [];
}

// API mengirim HTML ter-encode dua kali (mis. &amp;gt;), jadi decode dua pass.
function cleanSynopsis(html) {
    if (!html) return '';
    const decode = s => s
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&');
    let d = decode(String(html));
    if (d.includes('&lt;') || d.includes('&gt;') || d.includes('&quot;')) d = decode(d);
    return d
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function nameOf(v) {
    if (typeof v === 'string') return v;
    if (v && typeof v.name === 'string') return v.name;
    return '';
}

var KonmikExtension = {
    /**
     * Katalog / pencarian. API mengabaikan `page`, jadi paginasi pakai `offset`.
     */
    async getList(page = 1, query = '', filters = {}) {
        const p = Math.max(1, parseInt(page) || 1);
        const f = filters || {};
        let sort = 'newest';
        if (f.sort === 'popular') sort = 'views';
        else if (f.sort === 'rating') sort = 'rating';

        // Format sesuai situs: /api/manga?search=&genre=&status=&type=&sort=newest&limit=24&offset=0
        const q = encodeURIComponent((query || '').trim());
        const genre = encodeURIComponent(f.genre || '');
        const status = encodeURIComponent(f.status || '');
        const type = encodeURIComponent(f.type || '');
        const offset = (p - 1) * PAGE_SIZE;

        const data = await apiGet(
            `/manga?search=${q}&genre=${genre}&status=${status}&type=${type}&sort=${sort}&limit=${PAGE_SIZE}&offset=${offset}`
        );
        const list = toList(data);

        const mangaList = list
            .filter(item => item && typeof item === 'object' && item.slug)
            .map(item => {
                const ch = Array.isArray(item.chapters) ? item.chapters[0] : null;
                return {
                    id: String(item.slug),
                    title: item.title || 'Untitled',
                    cover_url: fullUrl(item.cover_url),
                    latest_chapter: ch && ch.chapter_number != null ? `Ch. ${ch.chapter_number}` : '',
                    rating: item.rating != null ? String(item.rating) : '0',
                    views: item.views != null ? String(item.views) : '-'
                };
            });

        return { manga_list: mangaList };
    },

    /**
     * Detail komik + daftar chapter (terbaru di atas).
     */
    async getDetail(slug) {
        const d = await apiGet(`/manga/${encodeURIComponent(slug)}`);
        if (!d || typeof d !== 'object') throw new Error('Komik tidak ditemukan');

        const genres = (Array.isArray(d.manga_genres) ? d.manga_genres : [])
            .map(g => (g && g.genres && typeof g.genres.name === 'string') ? g.genres.name : '')
            .filter(Boolean);

        const chapters = (Array.isArray(d.chapters) ? d.chapters : [])
            .filter(ch => ch && ch.id != null)
            .map(ch => ({
                _n: parseFloat(ch.chapter_number),
                id: String(ch.id),
                title: (typeof ch.title === 'string' && ch.title)
                    ? ch.title
                    : `Chapter ${ch.chapter_number != null ? ch.chapter_number : ''}`.trim(),
                endpoint: String(ch.id),
                date: formatDate(ch.created_at)
            }));

        chapters.sort((a, b) => (isNaN(b._n) ? 0 : b._n) - (isNaN(a._n) ? 0 : a._n));
        chapters.forEach(c => { delete c._n; });

        const author = nameOf(d.author);
        const artist = nameOf(d.artist);

        return {
            title: d.title || 'Untitled',
            cover_url: fullUrl(d.cover_url),
            description: cleanSynopsis(d.description) || 'Tidak ada deskripsi.',
            author: author || 'Unknown',
            artist: artist || author || 'Unknown',
            rating: d.rating != null ? String(d.rating) : '0',
            views: Number.isFinite(d.views) ? String(d.views) : '-',
            genres: genres,
            chapters: chapters
        };
    },

    /**
     * URL gambar sebuah chapter. `endpoint` = id chapter.
     */
    async getChapterImages(endpoint) {
        const ch = await apiGet(`/chapters/${encodeURIComponent(endpoint)}`);
        const urls = (ch && Array.isArray(ch.content_urls)) ? ch.content_urls : [];
        const images = urls.map(fullUrl).filter(Boolean);
        if (images.length === 0) throw new Error('Chapter ini belum memiliki gambar');
        return images;
    }
};
