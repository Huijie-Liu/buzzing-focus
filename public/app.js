const SOURCE_GROUPS = [
  { key: "breaking", label: "新闻" },
  { key: "analysis", label: "深度" },
];

const SOURCES = [
  { key: "hn", label: "Hacker News", accent: "#f0652f", group: "breaking" },
  { key: "reuters", label: "路透社", accent: "#ff8000", group: "breaking" },
  { key: "bloomberg", label: "彭博社", accent: "#0068ff", group: "breaking" },
  { key: "google", label: "Google News 美国", accent: "#1a73e8", group: "breaking" },
  { key: "google_zh", label: "Google News 中文", accent: "#34a853", group: "breaking" },
  { key: "zhihu", label: "知乎热榜", accent: "#0066ff", group: "analysis" },
  { key: "economist", label: "经济学人", accent: "#d71920", group: "analysis" },
  { key: "atlantic", label: "大西洋周刊", accent: "#111111", group: "analysis" },
  { key: "newyorker", label: "纽约客", accent: "#e60000", group: "analysis" },
  { key: "aeon", label: "Aeon 深度", accent: "#c45161", group: "analysis" },
  { key: "mit_tech", label: "MIT 科技评论", accent: "#ff5a00", group: "analysis" },
  { key: "quanta", label: "Quanta 科学", accent: "#2563eb", group: "analysis" },
];

const MAX_ITEMS_PER_TAB = 50;
const READ_STORAGE_KEY = "readArticleIds";
const THEME_STORAGE_KEY = "themeMode";
const TRANSLATION_CACHE_KEY = "tlV2";
const MAX_READ_IDS = 2000;
const MAX_TRANSLATION_CACHE = 600;
const VISIBLE_BUFFER = 10;
const TRANSLATABLE_SOURCES = new Set([
  "hn",
  "economist",
  "reuters",
  "bloomberg",
  "google",
  "atlantic",
  "newyorker",
  "aeon",
  "mit_tech",
  "washingtonpost",
]);

let translationController = null;
let translationRunId = 0;

function initialSourceGroup() {
  const stored = localStorage.getItem("activeSourceGroup");
  return SOURCE_GROUPS.some((group) => group.key === stored) ? stored : "breaking";
}

function loadReadIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(READ_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter(Boolean).slice(-MAX_READ_IDS));
  } catch {
    return new Set();
  }
}

const state = {
  activeGroup: initialSourceGroup(),
  activeSource: localStorage.getItem("activeSource") || "all",
  items: [],
  sourceCounts: new Map(),
  query: "",
  withImages: localStorage.getItem("displayMode") !== "text",
  sortMode: localStorage.getItem("sortMode") || "latest",
  theme: localStorage.getItem(THEME_STORAGE_KEY) || "light",
  loading: false,
  readIds: loadReadIds(),
};

let itemSeq = 0;

const els = {
  categoryTabs: document.querySelector("#categoryTabs"),
  tabs: document.querySelector("#sourceTabs"),
  feed: document.querySelector("#feed"),
  error: document.querySelector("#errorBox"),
  search: document.querySelector("#searchInput"),
  refresh: document.querySelector("#refreshButton"),
  theme: document.querySelector("#themeButton"),
  imageMode: document.querySelector("#imageMode"),
  textMode: document.querySelector("#textMode"),
  sortLatest: document.querySelector("#sortLatest"),
  sortTop: document.querySelector("#sortTop"),
  template: document.querySelector("#articleTemplate"),
};

function escapeText(value) {
  return String(value ?? "");
}

function loadTranslationCache() {
  try {
    return JSON.parse(localStorage.getItem(TRANSLATION_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveTranslationCache(cache) {
  const entries = Object.entries(cache);
  if (entries.length > MAX_TRANSLATION_CACHE) {
    entries.sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0));
    cache = Object.fromEntries(entries.slice(0, MAX_TRANSLATION_CACHE));
  }
  try {
    localStorage.setItem(TRANSLATION_CACHE_KEY, JSON.stringify(cache));
  } catch { /* quota */ }
}

function saveReadIds() {
  const ids = Array.from(state.readIds).slice(-MAX_READ_IDS);
  state.readIds = new Set(ids);
  localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(ids));
}

function markRead(item, node) {
  if (!item.id || state.readIds.has(item.id)) return;
  state.readIds.add(item.id);
  saveReadIds();
  node.classList.add("read");
}

function sourceMeta(sourceKey) {
  return SOURCES.find((source) => source.key === sourceKey);
}

function sourceGroup(sourceKey) {
  return sourceMeta(sourceKey)?.group || "breaking";
}

function activeGroupSources() {
  return SOURCES.filter((source) => source.group === state.activeGroup);
}

function isInActiveGroup(item) {
  return sourceGroup(item.source) === state.activeGroup;
}

function sourceCount(sourceKey) {
  return Math.min(state.sourceCounts.get(sourceKey) || 0, MAX_ITEMS_PER_TAB);
}

function groupCount(groupKey) {
  return Math.min(
    SOURCES.filter((source) => source.group === groupKey).reduce((total, source) => {
      return total + (state.sourceCounts.get(source.key) || 0);
    }, 0),
    MAX_ITEMS_PER_TAB,
  );
}

function setActiveGroup(groupKey) {
  if (!SOURCE_GROUPS.some((group) => group.key === groupKey)) return;
  state.activeGroup = groupKey;
  localStorage.setItem("activeSourceGroup", groupKey);
  if (state.activeSource !== "all" && sourceGroup(state.activeSource) !== state.activeGroup) {
    state.activeSource = "all";
    localStorage.setItem("activeSource", "all");
  }
  render();
  startTranslationsForVisibleItems();
}

function prepareItem(item, translationCache = {}) {
  const cached = translationCache[item.id];
  if (cached?.titleZh) {
    return {
      ...item,
      titleOriginal: item.title || "",
      summaryOriginal: item.summary || "",
      titleZh: cached.titleZh,
      summaryZh: cached.summaryZh || "",
      translationStatus: "done",
    };
  }
  return {
    ...item,
    titleOriginal: item.title || "",
    summaryOriginal: item.summary || "",
    translationStatus: TRANSLATABLE_SOURCES.has(item.source) ? "pending" : "skipped",
  };
}

function displayTitle(item) {
  return item.titleZh || item.titleOriginal || item.title || item.summary || "Untitled";
}

function displaySummary(item) {
  if (item.summaryZh) return item.summaryZh;
  return item.summaryOriginal || item.summary || "";
}

function shouldTranslateItem(item) {
  return (
    TRANSLATABLE_SOURCES.has(item.source) &&
    item.translationStatus !== "streaming" &&
    item.translationStatus !== "queued" &&
    item.translationStatus !== "done" &&
    !item.titleZh
  );
}

function findItemById(id) {
  return state.items.find((item) => item.id === id);
}

function findArticleNode(id) {
  return Array.from(els.feed.querySelectorAll(".story")).find((node) => node.dataset.itemId === id);
}

function resetActiveTranslations() {
  state.items.forEach((item) => {
    if (item.translationStatus === "streaming" || item.translationStatus === "queued") {
      item.translationStatus = item.titleZh ? "done" : "pending";
    }
  });
}

function cancelTranslations() {
  translationRunId += 1;
  if (translationController) {
    translationController.abort();
    translationController = null;
  }
  resetActiveTranslations();
}

function setTheme(theme) {
  state.theme = theme === "dark" ? "dark" : "light";
  localStorage.setItem(THEME_STORAGE_KEY, state.theme);
  document.body.classList.toggle("theme-dark", state.theme === "dark");
  els.theme.querySelector("span").textContent = state.theme === "dark" ? "☀" : "☾";
  els.theme.setAttribute("aria-label", state.theme === "dark" ? "切换日间模式" : "切换夜间模式");
  els.theme.title = state.theme === "dark" ? "切换日间模式" : "切换夜间模式";
}

function formatRelativeTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Date.now() - date.getTime();
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function setMode(withImages) {
  state.withImages = withImages;
  localStorage.setItem("displayMode", withImages ? "image" : "text");
  document.body.classList.toggle("text-only", !withImages);
  els.imageMode.classList.toggle("active", withImages);
  els.textMode.classList.toggle("active", !withImages);
  render();
}

function setSortMode(mode) {
  state.sortMode = mode === "top" ? "top" : "latest";
  localStorage.setItem("sortMode", state.sortMode);
  els.sortLatest.classList.toggle("active", state.sortMode === "latest");
  els.sortTop.classList.toggle("active", state.sortMode === "top");
  render();
}

function isLiveTitle(title) {
  return /^Live\b|^LIVE\b|^\[Live\]|^【直播】|直播\|/.test(title || "");
}

function renderCategoryTabs() {
  els.categoryTabs.replaceChildren();
  SOURCE_GROUPS.forEach((group) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "category-tab";
    button.classList.toggle("active", state.activeGroup === group.key);
    button.innerHTML = `<span>${group.label}</span>`;
    button.addEventListener("click", () => setActiveGroup(group.key));
    els.categoryTabs.append(button);
  });
}

function renderTabs() {
  els.tabs.replaceChildren();
  const sources = [
    { key: "all", label: "全部", accent: "#191b1f" },
    ...activeGroupSources(),
  ];
  if (state.activeSource !== "all" && !sources.some((source) => source.key === state.activeSource)) {
    state.activeSource = "all";
    localStorage.setItem("activeSource", "all");
  }
  sources.forEach((source) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab";
    button.style.setProperty("--accent", source.accent);
    button.classList.toggle("active", state.activeSource === source.key);
    const count = source.key === "all" ? groupCount(state.activeGroup) : sourceCount(source.key);
    button.innerHTML = `<span>${source.label}</span><b>${count}</b>`;
    button.addEventListener("click", () => {
      state.activeSource = source.key;
      localStorage.setItem("activeSource", source.key);
      render();
      startTranslationsForVisibleItems();
    });
    els.tabs.append(button);
  });
}

function getFilteredItems() {
  const query = state.query.trim().toLowerCase();
  const limit = state.activeSource === "all" ? 100 : MAX_ITEMS_PER_TAB;
  let results = state.items.filter((item) => {
    if (!isInActiveGroup(item)) return false;
    if (state.activeSource !== "all" && item.source !== state.activeSource) return false;
    if (!query) return true;
    return `${item.titleOriginal} ${item.summaryOriginal} ${item.titleZh || ""} ${item.summaryZh || ""} ${item.sourceLabel}`.toLowerCase().includes(query);
  });

  if (state.sortMode === "latest") {
    results.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
  } else {
    results.sort((a, b) => ((a._seq || 0) - (b._seq || 0)));
  }

  return results.slice(0, limit);
}

function renderArticle(item) {
  const node = els.template.content.firstElementChild.cloneNode(true);
  const mainUrl = item.url || item.discussionUrl || "#";
  const hasImage = state.withImages && Boolean(item.image);
  const markCurrentRead = () => markRead(item, node);

  node.dataset.itemId = item.id || "";
  node.classList.toggle("has-image", hasImage);
  node.classList.toggle("read", state.readIds.has(item.id));
  node.classList.toggle("translating", item.translationStatus === "streaming" || item.translationStatus === "queued");
  node.classList.toggle("translated", item.translationStatus === "done");
  node.style.setProperty("--source-color", item.accent || "#191b1f");

  const media = node.querySelector(".media");
  const img = node.querySelector("img");
  if (hasImage) {
    media.href = mainUrl;
    media.addEventListener("click", markCurrentRead);
    img.src = item.image;
    img.onerror = () => {
      img.remove();
      const err = document.createElement("div");
      err.className = "media-error";
      err.textContent = "无图";
      media.appendChild(err);
    };
  } else {
    media.remove();
  }

  const srcEl = node.querySelector(".source");
  srcEl.textContent = item.sourceLabel;
  const srcHome = sourceMeta(item.source)?.home || "#";
  if (srcHome !== "#") srcEl.href = srcHome;

  const time = node.querySelector("time");
  time.textContent = formatRelativeTime(item.publishedAt);
  if (item.publishedAt) time.dateTime = item.publishedAt;

  const hnStat = node.querySelector(".hn-stat");
  if (item.source === "hn") {
    const score = Number.isFinite(Number(item.score)) ? `${item.score} points` : "";
    const comments = Number.isFinite(Number(item.comments)) ? `${item.comments} comments` : "";
    hnStat.textContent = [score, comments].filter(Boolean).join(" · ");
  } else {
    hnStat.remove();
  }

  const title = node.querySelector(".title");
  title.href = mainUrl;
  title.textContent = escapeText(displayTitle(item));
  if (isLiveTitle(item.titleOriginal || item.title || "")) {
    const badge = document.createElement("span");
    badge.className = "live-badge";
    badge.textContent = "LIVE";
    title.appendChild(badge);
  }
  title.addEventListener("click", markCurrentRead);

  const origTitle = (item.titleEn || item.titleOriginal || "").trim();
  const shownTitle = displayTitle(item).trim();
  const origEl = node.querySelector(".original-title");
  if (origTitle && shownTitle && origTitle !== shownTitle) {
    origEl.textContent = origTitle;
    origEl.hidden = false;
  } else {
    origEl.hidden = true;
  }

  const summary = node.querySelector(".summary");
  const summaryText = displaySummary(item);
  summary.textContent = escapeText(summaryText);
  summary.hidden = !summaryText;

  const origin = node.querySelector(".origin");
  origin.href = item.url || mainUrl;
  origin.addEventListener("click", markCurrentRead);

  const discussion = node.querySelector(".discussion");
  if (item.discussionUrl && item.discussionUrl.startsWith("http") && item.discussionUrl !== mainUrl) {
    discussion.href = item.discussionUrl;
    discussion.addEventListener("click", markCurrentRead);
  } else {
    discussion.remove();
  }

  return node;
}

function updateArticleNode(item, animate = false) {
  const node = findArticleNode(item.id);
  if (!node) return;
  node.classList.toggle("translating", item.translationStatus === "streaming" || item.translationStatus === "queued");
  node.classList.toggle("translated", item.translationStatus === "done");

  const title = node.querySelector(".title");
  const summary = node.querySelector(".summary");
  title.textContent = escapeText(displayTitle(item));

  const origTitle = (item.titleEn || item.titleOriginal || "").trim();
  const shownTitle = displayTitle(item).trim();
  const origEl = node.querySelector(".original-title");
  if (origEl) {
    if (origTitle && shownTitle && origTitle !== shownTitle) {
      origEl.textContent = origTitle;
      origEl.hidden = false;
    } else {
      origEl.hidden = true;
    }
  }

  const summaryText = displaySummary(item);
  summary.textContent = escapeText(summaryText);
  summary.hidden = !summaryText;

  if (animate) {
    node.classList.remove("translation-swap");
    void node.offsetWidth;
    node.classList.add("translation-swap");
  }
}

function translationPayload(item) {
  return {
    id: item.id,
    source: item.source,
    title: item.titleOriginal || item.title || "",
    summary: item.summaryOriginal || item.summary || "",
  };
}

function handleTranslationEvent(event) {
  if (!event || !event.id) return;
  const item = findItemById(event.id);
  if (!item) return;

  if (event.type === "start" || event.type === "chunk") {
    if (item.translationStatus !== "streaming") {
      item.translationStatus = "streaming";
      updateArticleNode(item);
    }
    return;
  }

  if (event.type === "done") {
    item.titleZh = event.title || item.titleZh;
    item.summaryZh = event.summary || "";
    item.translationStatus = "done";
    updateArticleNode(item, true);
    const cache = loadTranslationCache();
    cache[item.id] = { titleZh: item.titleZh, summaryZh: item.summaryZh, savedAt: Date.now() };
    saveTranslationCache(cache);
    return;
  }

  if (event.type === "error") {
    item.translationStatus = "error";
    updateArticleNode(item);
  }
}

async function streamTranslations(items, runId, signal) {
  try {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: items.map(translationPayload) }),
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.body) throw new Error("当前浏览器不支持流式响应");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim() || runId !== translationRunId) continue;
        const event = JSON.parse(line);
        if (event.type === "complete") continue;
        handleTranslationEvent(event);
      }

      if (done) break;
    }

    if (buffer.trim() && runId === translationRunId) {
      const event = JSON.parse(buffer);
      if (event.type !== "complete") handleTranslationEvent(event);
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      items.forEach((item) => {
        if (item.translationStatus === "streaming" || item.translationStatus === "queued") {
          item.translationStatus = "error";
          updateArticleNode(item);
        }
      });
    }
  } finally {
    if (runId === translationRunId) {
      translationController = null;
      drainPendingQueue();
    }
  }
}

function getVisibleItemIds() {
  const ids = new Set();
  const viewH = window.innerHeight;
  const margin = viewH;
  els.feed.querySelectorAll(".story").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.bottom >= -margin && r.top <= viewH + margin) {
      ids.add(el.dataset.itemId);
    }
  });
  return ids;
}

function translateBatch(batch) {
  if (!batch.length) return;
  batch.forEach((item) => {
    item.translationStatus = "queued";
    updateArticleNode(item);
  });
  translationController = new AbortController();
  const runId = ++translationRunId;
  streamTranslations(batch, runId, translationController.signal);
}

function startTranslationsForVisibleItems() {
  translationRunId += 1;
  if (translationController) {
    translationController.abort();
    translationController = null;
  }
  resetActiveTranslations();

  const visibleIds = getVisibleItemIds();
  const pending = getFilteredItems().filter(shouldTranslateItem);
  if (!pending.length) return;

  const visible = pending.filter((item) => visibleIds.has(item.id));
  const buffer = pending.filter((item) => !visibleIds.has(item.id)).slice(0, VISIBLE_BUFFER);
  translateBatch([...visible, ...buffer]);
}

let scrollTimer = null;
let pendingQueue = [];

function onScrollTranslate() {
  if (scrollTimer) clearTimeout(scrollTimer);
  scrollTimer = setTimeout(() => {
    const visibleIds = getVisibleItemIds();
    const pending = getFilteredItems().filter(shouldTranslateItem);
    const needsWork = pending.filter((item) => visibleIds.has(item.id));
    if (!needsWork.length) return;

    if (translationController) {
      pendingQueue = [...new Set([...pendingQueue, ...needsWork.map(i => i.id)])];
      return;
    }

    const buffer = pending.filter((item) => !visibleIds.has(item.id)).slice(0, VISIBLE_BUFFER);
    translateBatch([...needsWork, ...buffer]);
  }, 300);
}

function drainPendingQueue() {
  if (!pendingQueue.length) return;
  const ids = new Set(pendingQueue);
  pendingQueue = [];
  const items = getFilteredItems().filter(item => ids.has(item.id) && shouldTranslateItem(item));
  if (items.length) {
    translateBatch(items);
  }
}

function renderSkeleton() {
  const count = state.activeSource === "all" ? 6 : 4;
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const skel = document.createElement("div");
    skel.className = "skeleton";
    skel.style.animationDelay = `${i * 0.05}s`;
    skel.innerHTML =
      '<div class="bar meta"></div><div class="bar title"></div><div class="bar summary"></div>';
    fragment.appendChild(skel);
  }
  return fragment;
}

function renderFeed() {
  const items = getFilteredItems();
  els.feed.replaceChildren();
  if (state.loading && !items.length) {
    els.feed.appendChild(renderSkeleton());
    return;
  }
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = state.query.trim() ? "没有匹配的内容" : "暂无内容，请刷新重试";
    els.feed.append(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  items.forEach((item) => fragment.append(renderArticle(item)));
  els.feed.append(fragment);
}

function renderErrors(errors = []) {
  if (!errors.length) {
    els.error.hidden = true;
    els.error.textContent = "";
    return;
  }
  const names = errors.map((error) => SOURCES.find((source) => source.key === error.source)?.label || error.source);
  els.error.hidden = false;
  els.error.textContent = `部分来源暂时不可用：${names.join("、")}`;
}

function render() {
  renderCategoryTabs();
  renderTabs();
  renderFeed();
}

async function loadFeed() {
  cancelTranslations();
  state.loading = true;
  state.items = [];
  state.sourceCounts = new Map();
  itemSeq = 0;
  els.refresh.classList.add("loading");
  renderFeed();

  try {
    const response = await fetch("/api/feed?source=all", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.body) throw new Error("浏览器不支持流式响应");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const translationCache = loadTranslationCache();

    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "source") {
            const prepared = (event.items || []).map(item => {
              const p = prepareItem(item, translationCache);
              p._seq = ++itemSeq;
              return p;
            });
            state.items.push(...prepared);
            state.sourceCounts.set(event.key, event.count);
            state.loading = false;
            render();
            startTranslationsForVisibleItems();
          } else if (event.type === "done") {
            renderErrors(event.errors || []);
          }
        } catch { /* skip malformed lines */ }
      }

      if (done) break;
    }

  } catch (error) {
    els.error.hidden = false;
    els.error.textContent = `无法读取 feed：${error.message}`;
  } finally {
    state.loading = false;
    els.refresh.classList.remove("loading");
    render();
    startTranslationsForVisibleItems();
  }
}

els.search.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderFeed();
  startTranslationsForVisibleItems();
});

els.refresh.addEventListener("click", loadFeed);
els.theme.addEventListener("click", () => setTheme(state.theme === "dark" ? "light" : "dark"));
els.imageMode.addEventListener("click", () => setMode(true));
els.textMode.addEventListener("click", () => setMode(false));
els.sortLatest.addEventListener("click", () => setSortMode("latest"));
els.sortTop.addEventListener("click", () => setSortMode("top"));

window.addEventListener("scroll", onScrollTranslate, { passive: true });

const scrollTopBtn = document.createElement("button");
scrollTopBtn.className = "scroll-top";
scrollTopBtn.type = "button";
scrollTopBtn.innerHTML = "&#8593;";
scrollTopBtn.setAttribute("aria-label", "回到顶部");
scrollTopBtn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
document.body.appendChild(scrollTopBtn);

window.addEventListener("scroll", () => {
  scrollTopBtn.classList.toggle("visible", window.scrollY > 600);
}, { passive: true });

let previewTimer = null;
let previewPopup = null;

function removePreview() {
  if (previewTimer) clearTimeout(previewTimer);
  if (previewPopup) {
    previewPopup.remove();
    previewPopup = null;
  }
}

async function showPreview(url, target) {
  removePreview();
  const el = target;
  previewTimer = setTimeout(async () => {
    try {
      const resp = await fetch(`/api/preview?url=${encodeURIComponent(url)}`);
      if (!resp.ok) return;
      const data = await resp.json();
      const snippet = (data.snippet || "").trim();
      if (!snippet) return;

      previewPopup = document.createElement("div");
      previewPopup.className = "preview-popup";
      previewPopup.textContent = snippet;
      document.body.appendChild(previewPopup);

      const rect = el.getBoundingClientRect();
      previewPopup.style.top = `${rect.bottom + 6}px`;
      previewPopup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 396))}px`;
    } catch {
      /* ignore preview failures */
    }
  }, 400);
}

els.feed.addEventListener("mouseover", (e) => {
  const link = e.target.closest(".title[href]");
  if (!link || !link.href.startsWith("http")) {
    removePreview();
    return;
  }
  showPreview(link.href, link);
});

els.feed.addEventListener("mouseout", (e) => {
  if (e.target.closest(".title[href]")) removePreview();
});

window.addEventListener("scroll", removePreview, { passive: true });

let vimStep = 0;

let navIdx = 0;
let navGlowEl = null;
let navGlowTimer = null;

function navGlow(el) {
  if (navGlowEl && navGlowEl !== el) {
    navGlowEl.style.boxShadow = "";
    navGlowEl.style.transition = "";
  }
  if (navGlowTimer) clearTimeout(navGlowTimer);
  navGlowEl = el;
  el.style.boxShadow = "0 0 0 3px var(--source-color, #191b1f)";
  el.style.transition = "box-shadow 0.15s ease-in";
}

function navCard(dir) {
  const cards = [...els.feed.querySelectorAll(".story")];
  if (!cards.length) return;

  if (navGlowEl) {
    navIdx = Math.min(Math.max(navIdx + dir, 0), cards.length - 1);
  } else {
    navIdx = 0;
  }

  cards[navIdx].scrollIntoView({ block: "start", behavior: "instant" });
  navGlow(cards[navIdx]);
}

function navOpen() {
  const cards = [...els.feed.querySelectorAll(".story")];
  if (!cards.length || navIdx >= cards.length) return;
  const link = cards[navIdx].querySelector(".title[href]");
  if (link) window.open(link.href, "_blank");
}

function navSource(dir) {
  const sources = [{ key: "all" }, ...activeGroupSources()];
  const idx = sources.findIndex(s => s.key === state.activeSource);
  const next = sources[(idx + dir + sources.length) % sources.length];
  state.activeSource = next.key;
  localStorage.setItem("activeSource", next.key);
  render();
  startTranslationsForVisibleItems();
}

function toggleHelp() {
  const existing = document.querySelector(".kbd-help");
  if (existing) { existing.remove(); return; }
  const rows = [
    ["j / k", "下一篇 / 上一篇"],
    ["Enter", "打开选中文章"],
    ["n / p", "下一个源 / 上一个源"],
    ["1 / 2", "新闻 / 深度"],
    ["/", "搜索"],
    ["r", "刷新"],
    ["s", "最新 / 热门"],
    ["m", "有图 / 无图"],
    ["t", "明暗主题"],
    ["g g", "回到顶部"],
    ["G", "跳到底部"],
    ["d / u", "下半页 / 上半页"],
    ["?", "显示 / 隐藏此帮助"],
  ];
  const el = document.createElement("div");
  el.className = "kbd-help";
  el.innerHTML = `<div class="kbd-title">Keyboard Shortcuts</div>${rows.map(r => `<div class="kbd-row"><kbd>${r[0]}</kbd><span>${r[1]}</span></div>`).join("")}`;
  el.addEventListener("click", () => el.remove());
  document.body.appendChild(el);
}

function handleVimKey(e) {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  if (k === "Escape") { document.activeElement?.blur(); removePreview(); const h = document.querySelector(".kbd-help"); if (h) h.remove(); return; }
  if (k === "/") { e.preventDefault(); els.search.focus(); els.search.select(); return; }
  if (k === "?") { e.preventDefault(); toggleHelp(); return; }
  if (k === "Enter") { e.preventDefault(); navOpen(); return; }
  if (k === "j" || k === "J") { e.preventDefault(); navCard(1); return; }
  if (k === "k" || k === "K") { e.preventDefault(); navCard(-1); return; }
  if (k === "n" || k === "N") { e.preventDefault(); navSource(1); return; }
  if (k === "p" || k === "P") { e.preventDefault(); navSource(-1); return; }
  if (k === "G") { e.preventDefault(); window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); return; }
  if (k === "g") {
    if (vimStep === 1) { window.scrollTo({ top: 0, behavior: "smooth" }); vimStep = 0; return; }
    vimStep = 1;
    clearTimeout(window._vimT);
    window._vimT = setTimeout(() => { vimStep = 0; }, 400);
    return;
  }
  if (k === "d") { window.scrollBy({ top: window.innerHeight * 0.5, behavior: "smooth" }); return; }
  if (k === "u") { window.scrollBy({ top: -window.innerHeight * 0.5, behavior: "smooth" }); return; }
  if (k === "r") { loadFeed(); return; }
  if (k === "m") { setMode(!state.withImages); return; }
  if (k === "t") { setTheme(state.theme === "dark" ? "light" : "dark"); return; }
  if (k === "s") { setSortMode(state.sortMode === "latest" ? "top" : "latest"); return; }
  if (k === "1") { setActiveGroup("breaking"); return; }
  if (k === "2") { setActiveGroup("analysis"); return; }
}

document.addEventListener("keydown", handleVimKey);

setTheme(state.theme);
setMode(state.withImages);
setSortMode(state.sortMode);
loadFeed();
