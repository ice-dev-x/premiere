export const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BASE_URL = "https://lamovie.org";

function cleanText(text) {
  if (!text) return "";
  return text.replace(/&amp;/g, "&").replace(/&#039;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]*>/g, "").trim();
}

function getImgUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  if (path.startsWith('/thumbs/') || path.startsWith('/backdrops/') || path.startsWith('/logos/')) {
     return `https://lamovie.org/wp-content/uploads${path}`;
  }
  return `https://lamovie.org${path}`;
}

// --- EXTRACTOR NATIVO JSON (API LA.MOVIE) ---
function extractItems(json) {
  if (!json || !json.data || !json.data.posts) return [];
  
  return json.data.posts.map(post => {
    const typeMap = { 'movies': 'peliculas', 'tvshows': 'series', 'animes': 'animes', 'kids': 'kids' };
    const route = typeMap[post.type] || 'peliculas';
    const isSerie = post.type === 'tvshows' || post.type === 'animes';
    
    let qualityBadge = post.quality && post.quality.length > 0 ? "[HD] " : "";
    
    // MEJORA: Soporte para Modo Tarjetas asegurando un backdrop
    const posterImg = getImgUrl(post.images?.poster || post.still_path);
    const backdropImg = getImgUrl(post.images?.backdrop) || posterImg;

    return {
      id: "lamovie-" + post._id,
      ref: `https://lamovie.org/${route}/${post.slug}/`,
      title: `${qualityBadge}${post.title}`,
      kind: isSerie ? "series" : "movie",
      poster: posterImg,
      backdrop: backdropImg, 
      year: post.release_date ? parseInt(post.release_date.substring(0, 4)) : null,
      overview: post.overview || "", // Expone la sinopsis desde la tarjeta
      originalType: post.type 
    };
  });
}

// --- HOME ---
export async function home() {
  const res = await kino.fetch("https://lamovie.org/wp-api/v1/listing/up?page=1", { headers: { "User-Agent": UA } });
  if (!res.ok) return [];
  const json = await res.json();
  const allItems = extractItems(json);
  
  const categories = [];
  const peliculas = allItems.filter(i => i.originalType === "movies");
  const series = allItems.filter(i => i.originalType === "tvshows");
  const animes = allItems.filter(i => i.originalType === "animes");

  if (peliculas.length > 0) categories.push({ id: "h-peliculas", title: "🎬 Películas Recién Añadidas", ref: "peliculas", items: peliculas });
  if (series.length > 0) categories.push({ id: "h-series", title: "📺 Series Recién Añadidas", ref: "tvshows", items: series });
  if (animes.length > 0) categories.push({ id: "h-animes", title: "🎌 Animes", ref: "animes", items: animes });

  return categories;
}

// --- SECTION (PESTAÑAS) ---
export async function section({ tab } = {}) {
  const tabs = [
    { id: "peliculas", label: "Películas" },
    { id: "series", label: "Series" },
    { id: "animes", label: "Animes" }
  ];

  const chosen = tabs.some((t) => t.id === tab) ? tab : "peliculas";
  const typeMap = { 'peliculas': 'movies', 'series': 'tvshows', 'animes': 'animes' };
  const routeParam = typeMap[chosen];

  // Filtramos directamente desde la API para que cargue solo la pestaña que queremos
  const res = await kino.fetch(`https://lamovie.org/wp-api/v1/listing/up?postType=${routeParam}&page=1`, { headers: { "User-Agent": UA } });
  const json = res.ok ? await res.json() : null;
  const items = extractItems(json);

  let hero = { title: "Cine Premiere", text: "Explora el mejor contenido." };
  const rows = [];

  if (items.length > 0) {
    hero = { title: items[0].title, text: items[0].overview || "Contenido destacado.", image: items[0].backdrop || items[0].poster };
    rows.push({ id: `s-${chosen}`, title: `Catálogo de ${chosen}`, ref: routeParam, items: items });
  }

  return { tabs, tab: chosen, hero, rows };
}

// --- BUSCADOR ---
export async function search(query) {
  if (!query || !query.q) return [];
  const term = encodeURIComponent(query.q);
  const url = `https://lamovie.org/wp-api/v1/search?filter=%7B%7D&postType=any&q=${term}&postsPerPage=40`;

  try {
    const res = await kino.fetch(url, { headers: { "User-Agent": UA } });
    if (res.ok) return extractItems(await res.json());
  } catch (e) {}

  return [];
}

// --- BROWSE (PAGINACIÓN REAL) ---
export async function browse(ref, cursor) {
  const page = cursor ? parseInt(cursor, 10) : 1;
  const postType = ref || "movies"; // "movies", "tvshows", o "animes"
  
  const res = await kino.fetch(`https://lamovie.org/wp-api/v1/listing/up?postType=${postType}&page=${page}`, { headers: { "User-Agent": UA } });
  if (!res.ok) return { items: [] };
  
  const json = await res.json();
  const items = extractItems(json);
  
  return { 
    items: items, 
    // Si la API devolvió items, permitimos pedir la siguiente página
    next: items.length > 0 ? String(page + 1) : null 
  };
}

// --- EXTRACCIÓN DE METADATOS Y CAPÍTULOS ---
export async function episodes(ref) {
  const res = await kino.fetch(ref, { headers: { "User-Agent": UA } });
  if (!res.ok) throw kino.error("not_found", "No se pudo cargar la información");
  const html = await res.text();

  const metadata = {};
  const descMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
  if (descMatch) metadata.overview = cleanText(descMatch[1]);

  const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
  if (titleMatch) {
    const yearMatch = titleMatch[1].match(/\((\d{4})\)/);
    if (yearMatch) metadata.year = parseInt(yearMatch[1], 10);
  }

  const bgMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i);
  if (bgMatch) {
    metadata.backdrop = bgMatch[1];
    metadata.poster = bgMatch[1]; 
  }

  const episodesList = [];
  const isSerie = ref.includes('/series/') || ref.includes('/animes/') || ref.includes('/doramas/');

  if (isSerie) {
    const idMatch = html.match(/\?p=(\d+)/);
    if (idMatch) {
      const seriesId = idMatch[1];
      let currentSeason = 1;
      
      while (currentSeason <= 20) { 
        const epUrl = `https://lamovie.org/wp-api/v1/single/episodes/list?_id=${seriesId}&season=${currentSeason}&page=1&postsPerPage=100`;
        const epRes = await kino.fetch(epUrl, { headers: { "User-Agent": UA } });
        if (!epRes.ok) break; 
        const epJson = await epRes.json();
        
        if (!epJson || !epJson.data || !epJson.data.posts || epJson.data.posts.length === 0) break; 
        
        for (const ep of epJson.data.posts) {
           episodesList.push({
              season: ep.season_number,
              number: ep.episode_number,
              ref: `https://lamovie.org/episodio/${ep.slug}/?id=${ep._id}`, 
              title: `Episodio ${ep.episode_number}`,
              overview: ep.overview || "",
              still: getImgUrl(ep.still_path)
           });
        }
        currentSeason++;
      }
    }
    if (episodesList.length === 0) episodesList.push({ season: 1, number: 1, ref: ref, title: "Reproducir Serie" });
    
    // Si es serie, devolvemos 'series'
    return { series: metadata, episodes: episodesList };
    
  } else {
    episodesList.push({ season: 1, number: 1, ref: ref, title: "Reproducir Película", overview: metadata.overview });
    
    // MEJORA: Si es película, devolvemos 'movie' y exponemos el overview para la TV
    return { movie: metadata, overview: metadata.overview || "", episodes: episodesList };
  }
}

// --- REPRODUCTOR BLINDADO ---
export async function resolve(ref) {
  
  async function extractVideo(url) {
    let streamUrl = null;
    let streamHeaders = { "Referer": url, "User-Agent": UA };

    const autoUrl = url + (url.includes('?') ? '&' : '?') + 'autoplay=1&autoPlay=1&autostart=true';

    try {
      const rPage = await kino.fetch(url, { headers: { "Accept": "text/html", "Referer": "https://lamovie.org/", "User-Agent": UA }, timeoutMs: 8000 });
      if (rPage.ok) {
        const html = await rPage.text();
        const findStreamInCode = (code) => {
          const cleanCode = code.replace(/\\\//g, "/");
          const m = cleanCode.match(/(?:file|src|url)["']?\s*:\s*["'](https?:\/\/[^"']+\.(?:m3u8|mp4)[^"']*)["']/i) || 
                    cleanCode.match(/https?:\/\/[^\s"'\\<>]+?\.(?:m3u8|mp4)(?:\?[^\s"'\\<>]*)?/i);
          return m ? (m[1] || m[0]) : null;
        };

        streamUrl = findStreamInCode(html);

        if (!streamUrl) {
          const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
          if (scripts) {
            for (const s of scripts) {
              if (s.includes('eval(function(p,a,c,k,e,d)')) {
                const scriptSospechoso = s.replace(/<script[^>]*>|<\/script>/gi, "").trim();
                const packerMatch = scriptSospechoso.match(/eval\((function\(p,a,c,k,e,d\)[\s\S]+)\)/);
                if (packerMatch) {
                  try {
                    const unpackedCode = new Function("return (" + packerMatch[1] + ");")();
                    streamUrl = findStreamInCode(unpackedCode);
                    if (streamUrl) break;
                  } catch (err) {}
                }
              }
            }
          }
        }
      }
    } catch (err) {}

    if (!streamUrl) {
      const page = await kino.browser.capture(autoUrl, { headers: { "Referer": "https://lamovie.org/" }, timeoutMs: 25000 });
      if (page && page.media && page.media.length > 0) {
        const validMedia = page.media.find(m => m.url.includes('.m3u8') || m.url.includes('.mp4')) || page.media[0];
        streamUrl = validMedia.url;
        if (validMedia.headers) streamHeaders = validMedia.headers;
      }
    }

    if (streamUrl) return { url: streamUrl, headers: streamHeaders };
    throw new Error("No se pudo interceptar el video.");
  }

  if (ref.includes("|||")) {
    const parts = ref.split("|||");
    const stream = await extractVideo(parts[1]);
    return { url: stream.url, headers: stream.headers };
  }

  let postId = null;
  const refIdMatch = ref.match(/[?&]id=(\d+)/);
  if (refIdMatch) {
    postId = refIdMatch[1];
  } else {
    const pageRes = await kino.fetch(ref, { headers: { "User-Agent": UA } });
    const html = await pageRes.text();
    const idMatch = html.match(/\?p=(\d+)/);
    if (!idMatch) throw kino.error("not_found", "No se encontró el ID del video");
    postId = idMatch[1];
  }

  const apiRes = await kino.fetch(`https://lamovie.org/wp-api/v1/player?postId=${postId}&demo=0`, {
    headers: { "User-Agent": UA, "Referer": ref }
  });
  const playerJson = await apiRes.json();

  const servers = [];
  function extractServers(obj) {
    if (!obj) return;
    if (typeof obj === 'object') {
      if (obj.url && typeof obj.url === 'string' && obj.url.startsWith('http')) {
        const urlStr = obj.url.toLowerCase();
        const isDownload = urlStr.includes('1fichier') || urlStr.includes('megaup') || 
                           urlStr.includes('mediafire') || urlStr.includes('mega.nz') ||
                           urlStr.includes('.rar') || urlStr.includes('.zip') || urlStr.includes('.mkv');

        if (!isDownload) {
          let rawLang = (obj.lang || obj.language || "").toLowerCase();
          let serverName = obj.name || obj.server || "Online";
          let quality = obj.quality || "";

          let lang = "";
          if (rawLang.includes("latino") && (rawLang.includes("ingl") || rawLang.includes("sub"))) lang = "Dual";
          else if (rawLang.includes("latino")) lang = "Lat";
          else if (rawLang.includes("sub") || rawLang.includes("ingl")) lang = "Sub";
          else if (rawLang.includes("espa") || rawLang.includes("castellano")) lang = "Esp";
          else lang = rawLang.charAt(0).toUpperCase() + rawLang.slice(1);

          let cleanQuality = quality.replace(/dual/ig, "").trim();
          let labelBase = lang ? `${lang} ${serverName}` : serverName;
          let label = cleanQuality ? `${labelBase} [${cleanQuality}]` : labelBase;

          servers.push({ label: label, url: obj.url });
        }
      } else {
        for (let key in obj) {
          if (key.toLowerCase() !== 'downloads' && key.toLowerCase() !== 'links') {
            extractServers(obj[key]);
          }
        }
      }
    }
  }
  extractServers(playerJson);

  if (servers.length === 0) throw kino.error("unavailable", "No se encontraron servidores válidos");

  let uniqueServers = [];
  const seenUrls = new Set();
  const labelCounts = {};

  for (let s of servers) {
    if (!seenUrls.has(s.url)) { 
      seenUrls.add(s.url);
      if (labelCounts[s.label]) {
        labelCounts[s.label]++;
        uniqueServers.push({ label: `${s.label.replace(' [', ` ${labelCounts[s.label]} [`)}`, url: s.url });
      } else {
        labelCounts[s.label] = 1;
        uniqueServers.push(s);
      }
    }
  }

  uniqueServers.sort((a, b) => {
    const score = (name) => {
      const lower = name.toLowerCase();
      if (lower.includes('lamovie') || lower.includes('ovimeos') || lower.includes('videoapp')) return 100;
      if (lower.includes('goodstream')) return 80;
      if (lower.includes('voe')) return 30; 
      if (lower.includes('dood')) return 10;
      return 50;
    };
    return score(b.label) - score(a.label);
  });

  let stream = null;
  let lastErr = null;
  
  for (let i = 0; i < uniqueServers.length; i++) {
    try {
      const extracted = await extractVideo(uniqueServers[i].url);
      stream = { url: extracted.url, headers: extracted.headers || {}, label: uniqueServers[i].label };
      
      const alts = [];
      for (let j = 0; j < uniqueServers.length; j++) {
         if (j === i) continue;
         alts.push({ label: uniqueServers[j].label, ref: `${ref}|||${uniqueServers[j].url}` });
      }
      if (alts.length > 0) stream.alternatives = alts;
      return stream;
    } catch (e) { lastErr = e; }
  }
  
  throw lastErr || kino.error("unavailable", "No se pudo extraer el video de los servidores.");
}