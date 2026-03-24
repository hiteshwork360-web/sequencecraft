export const config = { runtime: 'edge' };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });

  try {
    const { company_website, persona_linkedin, company_linkedin, email } = await req.json();
    const domain = extractDomain(company_website || email?.split('@')[1] || '');

    // Run all fetches in parallel — fail gracefully on each
    const [websiteData, newsData, linkedinData] = await Promise.allSettled([
      fetchWebsiteMeta(company_website || `https://${domain}`),
      fetchGoogleNews(domain),
      fetchLinkedInMeta(company_linkedin || persona_linkedin),
    ]);

    const signals = [];

    // ── Website signals ───────────────────────────────────────────────────────
    if (websiteData.status === 'fulfilled' && websiteData.value) {
      const w = websiteData.value;
      if (w.description) signals.push({
        type:   'website',
        icon:   '🌐',
        text:   w.description,
        source: domain,
        raw:    w,
      });
      if (w.title && w.title !== w.description) signals.push({
        type:   'website',
        icon:   '🏢',
        text:   `Company: ${w.title}`,
        source: domain,
      });
    }

    // ── News signals ──────────────────────────────────────────────────────────
    if (newsData.status === 'fulfilled' && newsData.value?.length) {
      newsData.value.slice(0, 3).forEach(item => {
        signals.push({
          type:   'news',
          icon:   '🗞',
          text:   item.title,
          source: item.source || 'Google News',
          date:   item.date,
        });
      });
    }

    // ── LinkedIn signals ──────────────────────────────────────────────────────
    if (linkedinData.status === 'fulfilled' && linkedinData.value) {
      const li = linkedinData.value;
      if (li.description) signals.push({
        type:   'linkedin',
        icon:   '💼',
        text:   li.description,
        source: 'LinkedIn',
      });
    }

    return new Response(JSON.stringify({
      ok:      true,
      domain,
      signals,
      sources_used: [...new Set(signals.map(s => s.type))],
    }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (err) {
    console.error('research error:', err);
    // Always return ok:true with empty signals — never block generation
    return new Response(JSON.stringify({ ok: true, signals: [], sources_used: [] }), {
      status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }
}

// ── Fetch website meta tags ───────────────────────────────────────────────────
async function fetchWebsiteMeta(url) {
  if (!url) return null;
  const fullUrl = url.startsWith('http') ? url : `https://${url}`;
  const res = await fetchWithTimeout(fullUrl, 4000);
  if (!res.ok) return null;
  const html = await res.text();

  const get = (pattern) => {
    const m = html.match(pattern);
    return m ? m[1].replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim() : null;
  };

  const title = get(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{5,200})["']/i)
             || get(/<meta[^>]+content=["']([^"']{5,200})["'][^>]+property=["']og:title["']/i)
             || get(/<title[^>]*>([^<]{3,150})<\/title>/i);

  const description = get(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{10,300})["']/i)
                   || get(/<meta[^>]+content=["']([^"']{10,300})["'][^>]+property=["']og:description["']/i)
                   || get(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,300})["']/i)
                   || get(/<meta[^>]+content=["']([^"']{10,300})["'][^>]+name=["']description["']/i);

  if (!title && !description) return null;
  return { title, description };
}

// ── Fetch Google News RSS (free, no API key) ──────────────────────────────────
async function fetchGoogleNews(domain) {
  if (!domain) return [];
  // Search for company name (strip TLD for better results)
  const company = domain.split('.')[0];
  const query   = encodeURIComponent(`"${company}"`);
  const rssUrl  = `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`;

  const res = await fetchWithTimeout(rssUrl, 4000);
  if (!res.ok) return [];
  const xml = await res.text();

  // Parse RSS items
  const items   = [];
  const itemReg = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemReg.exec(xml)) !== null && items.length < 4) {
    const item  = match[1];
    const title = (item.match(/<title><!\[CDATA\[([^\]]+)\]\]><\/title>/) || item.match(/<title>([^<]+)<\/title>/))?.[1];
    const date  = item.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1];
    const src   = item.match(/<source[^>]*>([^<]+)<\/source>/)?.[1];
    if (title && title.length > 10) {
      items.push({ title: title.trim(), date, source: src });
    }
  }
  return items;
}

// ── Fetch LinkedIn page meta ──────────────────────────────────────────────────
async function fetchLinkedInMeta(url) {
  if (!url || !url.includes('linkedin.com')) return null;
  // LinkedIn blocks most scrapers — we try but gracefully return null
  try {
    const res = await fetchWithTimeout(url, 3000, {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    });
    if (!res.ok) return null;
    const html = await res.text();
    const desc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,300})["']/i)?.[1]
              || html.match(/<meta[^>]+content=["']([^"']{10,300})["'][^>]+name=["']description["']/i)?.[1];
    return desc ? { description: desc.trim() } : null;
  } catch {
    return null;
  }
}

// ── Timeout wrapper ───────────────────────────────────────────────────────────
async function fetchWithTimeout(url, ms, extraHeaders = {}) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal:  controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (SequenceCraft Research Bot)',
        ...extraHeaders,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function extractDomain(url) {
  try {
    const u = url.startsWith('http') ? url : `https://${url}`;
    return new URL(u).hostname.replace('www.', '');
  } catch {
    return url?.replace('www.', '') || '';
  }
}
