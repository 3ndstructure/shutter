// 셔터값 수집 Worker
// 엔드포인트
//   GET /api/health                       연결 확인
//   GET /api/prices?src=<id>&q=<검색어>    사이트 하나의 매물 목록
//   GET /api/photo?title=<위키 문서명>&q=<모델명>   카메라 사진 (자유 라이선스)
//   GET /api/samples?q=<모델명>            작례 사진 (Flickr 키가 있으면 Flickr, 없으면 위키미디어 공용)
//
// 필요한 설정 (wrangler secret / vars)
//   ALLOWED_ORIGINS  사이트 주소. 쉼표로 여러 개 (예: https://아이디.github.io)
//   ACCESS_KEY       개인용 수집을 켤 비밀 키 (페이지 설정에 같은 값 입력)
//   EBAY_ID, EBAY_SECRET       eBay 개발자 Production 키
//   FLICKR_KEY       (선택) Flickr API 키
//   CONTACT          위키미디어 요청에 붙일 연락처 (이메일 또는 사이트 주소)
//   DAANGN_REGION    (선택) 당근 지역 파라미터. 비우면 서울 매물만 남기는 필터만 적용
//   CACHE            (선택) KV 바인딩. 있으면 결과를 저장해 같은 요청을 반복하지 않음

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const enc = encodeURIComponent;

// kind: api = 공식 API, scrape = 개인용 수집 (ACCESS_KEY 필요)
const SOURCES = {
  ebay:    { kind: 'api',    ttl: 3600,  run: ebay },
  bunjang: { kind: 'scrape', ttl: 21600, run: bunjang },
  joongna: { kind: 'scrape', ttl: 21600, run: joongna },
  daangn:  { kind: 'scrape', ttl: 21600, run: daangn },
  fruits:  { kind: 'scrape', ttl: 21600, run: fruits },
  yahoo:   { kind: 'scrape', ttl: 21600, run: yahoo },
};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean);
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : (allowed[0] || '*'),
      'Access-Control-Allow-Headers': 'X-Shutter-Key',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Vary': 'Origin',
    };
    const json = (data, status = 200) => new Response(JSON.stringify(data), {
      status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
    });

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (origin && allowed.length && !allowed.includes(origin)) return json({ error: '허용되지 않은 사이트에서 온 요청이에요. ALLOWED_ORIGINS를 확인하세요.' }, 403);

    const keyOk = !!env.ACCESS_KEY && req.headers.get('X-Shutter-Key') === env.ACCESS_KEY;

    try {
      if (url.pathname === '/api/health') {
        return json({
          ok: true, personal: keyOk,
          ebay: !!(env.EBAY_ID && env.EBAY_SECRET),
          flickr: !!env.FLICKR_KEY, cache: !!env.CACHE,
        });
      }

      if (url.pathname === '/api/prices') {
        const id = url.searchParams.get('src');
        const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
        const src = SOURCES[id];
        if (!src) return json({ error: '알 수 없는 사이트예요.' }, 400);
        if (!q) return json({ error: '검색어가 비어 있어요.' }, 400);
        if (src.kind === 'scrape' && !keyOk) return json({ error: '개인용 수집은 개인 키가 필요해요.', needKey: true }, 401);
        const data = await withCache(env, ctx, `p:${id}:${q}`, src.ttl, () => src.run(q, env));
        return json(data);
      }

      if (url.pathname === '/api/photo') {
        const title = url.searchParams.get('title') || '';
        const q = url.searchParams.get('q') || title;
        const data = await withCache(env, ctx, `ph:${title}|${q}`, 604800, () => photo(title, q, env));
        return json(data);
      }

      if (url.pathname === '/api/samples') {
        const q = (url.searchParams.get('q') || '').trim().slice(0, 80);
        const film = url.searchParams.get('film') || '';
        if (!q) return json({ error: '검색어가 비어 있어요.' }, 400);
        const data = await withCache(env, ctx, `sm:${q}|${film}`, 86400, () => samples(q, film, env));
        return json(data);
      }

      return json({ error: '없는 경로예요.' }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 502);
    }
  },
};

/* ---------- 캐시 (KV가 있으면 사용) ---------- */
async function withCache(env, ctx, key, ttl, make) {
  if (env.CACHE) {
    const hit = await env.CACHE.get(key, 'json');
    if (hit) return { ...hit, cached: true };
  }
  const data = await make();
  data.fetchedAt = new Date().toISOString();
  // 빈 결과는 저장하지 않음 (일시적 실패로 6시간 동안 비어 보이는 것 방지)
  const hasData = Array.isArray(data.items) ? data.items.length > 0 : !!data.img;
  if (env.CACHE && hasData) ctx.waitUntil(env.CACHE.put(key, JSON.stringify(data), { expirationTtl: Math.max(60, ttl) }));
  return data;
}

async function getText(url, extra = {}) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9,ja;q=0.8,en;q=0.7', ...extra },
    cf: { cacheTtl: 0 },
  });
  if (!r.ok) throw new Error(`${new URL(url).hostname} 응답 ${r.status}`);
  return r.text();
}
const toNum = v => {
  if (v == null) return NaN;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/[^\d.]/g, ''));
  return n;
};
const stripTags = s => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

/* ---------- 공식 API: eBay Browse ---------- */
async function ebayToken(env) {
  if (env.CACHE) {
    const t = await env.CACHE.get('ebay:token');
    if (t) return t;
  }
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + btoa(`${env.EBAY_ID.trim()}:${env.EBAY_SECRET.trim()}`),
    },
    body: 'grant_type=client_credentials&scope=' + enc('https://api.ebay.com/oauth/api_scope'),
  });
  if (!r.ok) throw new Error(`eBay 인증 실패 ${r.status}`);
  const d = await r.json();
  if (env.CACHE) await env.CACHE.put('ebay:token', d.access_token, { expirationTtl: Math.max(60, (d.expires_in || 7200) - 300) });
  return d.access_token;
}
async function ebay(q, env) {
  if (!env.EBAY_ID || !env.EBAY_SECRET) throw new Error('eBay API 키가 설정되지 않았어요.');
  const token = await ebayToken(env);
  // 625 = Cameras & Photo
  const r = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?q=${enc(q)}&category_ids=625&limit=60`, {
    headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' },
  });
  if (!r.ok) throw new Error(`eBay API 응답 ${r.status}`);
  const d = await r.json();
  return {
    items: (d.itemSummaries || []).map(it => ({
      title: it.title, price: toNum(it.price?.value), cur: it.price?.currency || 'USD',
      url: it.itemWebUrl, img: it.image?.imageUrl || it.thumbnailImages?.[0]?.imageUrl,
      seller: it.seller?.username, cond: it.condition, used: it.condition !== 'New', sold: false,
      auction: (it.buyingOptions || []).includes('AUCTION'),
    })).filter(i => i.price > 0),
  };
}

/* ---------- 개인용 수집: 번개장터 ---------- */
async function bunjang(q) {
  try {
    const t = await getText(`https://api.bunjang.co.kr/api/1/find_v2.json?q=${enc(q)}&order=score&page=0&n=60&stat_device=w`, { Accept: 'application/json' });
    const d = JSON.parse(t);
    const items = (d.list || []).filter(it => !it.ad).map(it => ({
      title: it.name, price: toNum(it.price), cur: 'KRW',
      url: `https://m.bunjang.co.kr/products/${it.pid}`,
      img: (it.product_image || '').replace('{res}', '400'),
      seller: it.location || '', sold: it.status && String(it.status) !== '0', used: true,
    })).filter(i => i.price > 0);
    if (items.length) return { items };
  } catch (e) { /* 아래 방식으로 다시 시도 */ }
  return { items: await fromPage(`https://m.bunjang.co.kr/search/products?q=${enc(q)}`, id => `https://m.bunjang.co.kr/products/${id}`), via: 'page' };
}

/* ---------- 개인용 수집: 중고나라 ---------- */
async function joongna(q) {
  return { items: await fromPage(`https://web.joongna.com/search/${enc(q)}`, id => `https://web.joongna.com/product/${id}`) };
}

/* ---------- 개인용 수집: 당근 (서울) ---------- */
async function daangn(q, env) {
  const region = env.DAANGN_REGION ? `in=${enc(env.DAANGN_REGION)}&` : '';
  const items = await fromPage(`https://www.daangn.com/kr/buy-sell/?${region}search=${enc(q)}`, id => `https://www.daangn.com/kr/buy-sell/${id}`);
  // 지역 정보가 있는 매물은 서울만 남김
  const seoul = items.filter(i => !i.region || /서울/.test(i.region));
  return { items: seoul, note: '서울 매물만 표시' };
}

/* ---------- 개인용 수집: 후르츠패밀리 (실험) ---------- */
async function fruits(q) {
  return { items: await fromPage(`https://fruitsfamily.com/search?query=${enc(q)}`, id => `https://fruitsfamily.com/product/${id}`), note: '앱 중심 사이트라 결과가 없을 수 있어요' };
}

/* ---------- 개인용 수집: 야후옥션 낙찰가 ---------- */
async function yahoo(q) {
  const html = await getText(`https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=${enc(q)}&va=${enc(q)}&b=1&n=50`);
  const items = [];
  const blocks = html.split(/<li class="Product"/).slice(1);
  for (const b of blocks) {
    const link = b.match(/href="(https:\/\/(?:page\.)?auctions\.yahoo\.co\.jp\/jp\/auction\/[^"]+)"/);
    const title = b.match(/data-auction-title="([^"]+)"/) || b.match(/class="Product__titleLink[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    const price = b.match(/class="Product__priceValue[^"]*"[^>]*>([\d,]+)\s*円/);
    const img = b.match(/<img[^>]+src="(https:\/\/[^"]+)"/);
    if (link && title && price) items.push({
      title: stripTags(title[1]), price: toNum(price[1]), cur: 'JPY', url: link[1],
      img: img ? img[1] : '', sold: true, used: true,
    });
  }
  if (!items.length) return { items: await fromPage(`https://auctions.yahoo.co.jp/closedsearch/closedsearch?p=${enc(q)}`, null), via: 'page' };
  return { items };
}

/* ---------- 공통: 페이지 안에 들어 있는 데이터에서 매물 찾기 ----------
   사이트 구조가 바뀌어도 버틸 수 있게, 페이지에 박힌 JSON(Next.js, JSON-LD, 상태 객체)을
   전부 훑어서 "제목 + 가격"을 가진 객체를 매물로 봅니다. */
async function fromPage(url, idToUrl) {
  const html = await getText(url);
  const base = new URL(url);
  const blobs = [];
  for (const m of html.matchAll(/<script[^>]*type="application\/(?:ld\+)?json"[^>]*>([\s\S]*?)<\/script>/g)) blobs.push(m[1]);
  for (const m of html.matchAll(/window\.(?:__remixContext|__NUXT__|__INITIAL_STATE__|__APOLLO_STATE__|__PRELOADED_STATE__)\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/g)) blobs.push(m[1]);
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g)) {
    try { blobs.push(JSON.parse(`"${m[1]}"`)); } catch (e) { /* 무시 */ }
  }
  const found = new Map();
  const seen = new WeakSet();
  const pick = (o, keys) => { for (const k of keys) if (o[k] != null && o[k] !== '') return o[k]; };
  const walk = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 40 || seen.has(o)) return;
    seen.add(o);
    if (Array.isArray(o)) { o.forEach(v => walk(v, depth + 1)); return; }
    const title = pick(o, ['title', 'name', 'subject', 'productName', 'articleTitle']);
    let price = pick(o, ['price', 'priceKrw', 'price_krw', 'productPrice', 'salePrice', 'sellPrice', 'amount']);
    if (price && typeof price === 'object') price = pick(price, ['value', 'amount', 'price']);
    if (price == null && o.offers) { const of = Array.isArray(o.offers) ? o.offers[0] : o.offers; price = of && pick(of, ['price', 'lowPrice']); }
    const p = toNum(price);
    if (typeof title === 'string' && title.length > 3 && p > 1000) {
      let href = pick(o, ['url', 'href', 'link', 'webUrl', 'shareUrl']);
      const id = pick(o, ['id', 'seq', 'productSeq', 'productId', 'articleId', 'pid', 'uid']);
      if (typeof href === 'string') href = new URL(href, base).toString();
      else if (id != null && idToUrl) href = idToUrl(id);
      let img = pick(o, ['image', 'imageUrl', 'thumbnail', 'thumbnailUrl', 'thumbnailImage', 'url_image', 'mainImage', 'img', 'images', 'media']);
      if (Array.isArray(img)) img = img[0];
      if (img && typeof img === 'object') img = pick(img, ['url', 'src', 'imageUrl', 'origin']);
      let region = pick(o, ['region', 'regionName', 'location', 'locationName', 'address', 'area']);
      if (region && typeof region === 'object') region = pick(region, ['name', 'fullName', 'name3', 'displayName']);
      const status = String(pick(o, ['status', 'state', 'saleStatus', 'tradeStatus']) || '');
      const k = `${title}|${p}`;
      if (href && !found.has(k)) found.set(k, {
        title: stripTags(title), price: p, cur: 'KRW', url: href,
        img: typeof img === 'string' ? img : '', region: typeof region === 'string' ? region : '',
        sold: /sold|complete|판매완료|거래완료|closed/i.test(status), used: true,
      });
    }
    for (const v of Object.values(o)) walk(v, depth + 1);
  };
  for (const b of blobs) {
    try { walk(JSON.parse(b), 0); } catch (e) {
      // __next_f 조각처럼 JSON이 아닌 문자열 안에 JSON이 섞인 경우
      for (const m of String(b).matchAll(/\{"[^{}]{0,40}"[\s\S]{0,4000}?\}/g)) { try { walk(JSON.parse(m[0]), 0); } catch (_) {} }
    }
  }
  return [...found.values()].slice(0, 80);
}

/* ---------- 카메라 사진: 위키백과 대표 이미지 중 자유 라이선스만 ---------- */
function wmHeaders(env) {
  return { 'User-Agent': `ShutterPrice/1.0 (${env.CONTACT || 'personal camera price tool'})` };
}
async function photo(title, q, env) {
  const H = wmHeaders(env);
  const tryPages = [];
  if (title) {
    const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&titles=${enc(title)}&prop=pageimages|info&piprop=name&inprop=url`, { headers: H });
    const d = await r.json();
    tryPages.push(...Object.values(d.query?.pages || {}));
  }
  if (!tryPages.some(p => p.pageimage)) {
    const r = await fetch(`https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrsearch=${enc(q + ' camera')}&gsrlimit=4&prop=pageimages|info&piprop=name&inprop=url`, { headers: H });
    const d = await r.json();
    tryPages.push(...Object.values(d.query?.pages || {}).sort((a, b) => a.index - b.index));
  }
  for (const p of tryPages) {
    if (!p.pageimage) continue;
    const r = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=${enc('File:' + p.pageimage)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=720`, { headers: H });
    const d = await r.json();
    const info = Object.values(d.query?.pages || {})[0]?.imageinfo?.[0];
    if (!info) continue; // 위키미디어 공용에 없음 = 자유 라이선스가 아님
    const m = info.extmetadata || {};
    return {
      img: info.thumburl || info.url, page: p.fullurl, pageTitle: p.title, file: info.descriptionurl,
      license: stripTags(m.LicenseShortName?.value || ''), artist: stripTags(m.Artist?.value || ''),
    };
  }
  return { img: null };
}

/* ---------- 작례 ---------- */
const FLICKR_LICENSES = { 1: 'CC BY-NC-SA', 2: 'CC BY-NC', 3: 'CC BY-NC-ND', 4: 'CC BY', 5: 'CC BY-SA', 6: 'CC BY-ND', 7: '저작권 없음', 9: 'CC0', 10: '퍼블릭 도메인' };
async function samples(q, film, env) {
  const text = film ? `${q} ${film}` : q;
  if (env.FLICKR_KEY) {
    const r = await fetch(`https://www.flickr.com/services/rest/?method=flickr.photos.search&api_key=${env.FLICKR_KEY}&text=${enc(text)}&license=1,2,3,4,5,6,7,9,10&sort=relevance&content_types=0&media=photos&safe_search=1&extras=url_m,url_l,owner_name,license&per_page=36&format=json&nojsoncallback=1`);
    const d = await r.json();
    if (d.stat === 'ok') {
      const items = (d.photos?.photo || []).filter(p => p.url_m).map(p => ({
        img: p.url_m, big: p.url_l || p.url_m, w: +p.width_m, h: +p.height_m,
        title: p.title, by: p.ownername, license: FLICKR_LICENSES[p.license] || '',
        url: `https://www.flickr.com/photos/${p.owner}/${p.id}`,
      }));
      if (items.length) return { source: 'Flickr', items };
    }
  }
  // 위키미디어 공용 "Taken with <모델>" 분류
  const H = wmHeaders(env);
  const r = await fetch(`https://commons.wikimedia.org/w/api.php?action=query&format=json&generator=categorymembers&gcmtitle=${enc('Category:Taken with ' + q)}&gcmtype=file&gcmlimit=36&prop=imageinfo&iiprop=url|extmetadata|size&iiurlwidth=480`, { headers: H });
  const d = await r.json();
  const items = Object.values(d.query?.pages || {}).map(p => {
    const i = p.imageinfo?.[0] || {}, m = i.extmetadata || {};
    return {
      img: i.thumburl, big: i.url, w: i.thumbwidth, h: i.thumbheight, title: p.title.replace(/^File:/, '').replace(/\.\w+$/, ''),
      by: stripTags(m.Artist?.value || ''), license: stripTags(m.LicenseShortName?.value || ''), url: i.descriptionurl,
    };
  }).filter(i => i.img && !/\.(svg|pdf|tif)/i.test(i.big || ''));
  return { source: 'Wikimedia Commons', items };
}
