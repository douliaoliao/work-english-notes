/* global document, window, location, history, fetch */
(function () {
  "use strict";

  const SECTION_LABELS = {
    chinese: "中文原意",
    english: "最终英文",
    qa: "会议问答",
    corrections: "重点纠正",
    expressions: "重点表达",
    vocab: "重点词汇",
    pending: "待确认",
    review: "下次复习",
    note: "备注",
    other: "其他",
  };

  const state = {
    notes: [],
    mode: localStorage.getItem("workEnglish.mode") || "all",
    query: "",
    currentId: null,
  };

  const $dates = document.getElementById("dates");
  const $main = document.getElementById("main");
  const $q = document.getElementById("q");

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function normalize(s) {
    return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function parseRoute() {
    const raw = (location.hash || "").replace(/^#\/?/, "");
    const params = new URLSearchParams(raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : raw.startsWith("?") ? raw.slice(1) : "");
    // Support #/2026-11-25, #/2026-11-25?q=..., #/?q=...
    let id = raw.split("?")[0];
    if (id.startsWith("?")) id = "";
    const q = params.get("q") || "";
    return { id, q };
  }

  function setRoute({ id, q }, replace) {
    let hash = "#/";
    if (id) hash += encodeURIComponent(id);
    if (q) hash += (id ? "?" : "?") + "q=" + encodeURIComponent(q);
    if (replace) history.replaceState(null, "", hash);
    else history.pushState(null, "", hash);
  }

  function applyMode(mode) {
    state.mode = mode;
    localStorage.setItem("workEnglish.mode", mode);
    document.body.classList.toggle("hide-en", mode === "hide-en");
    document.body.classList.toggle("hide-zh", mode === "hide-zh");
    document.querySelectorAll(".modes button").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.mode === mode);
    });
  }

  function highlightHtml(html, query) {
    if (!query) return html;
    const raw = normalize(query);
    if (!raw) return html;
    const tokens = raw.split(" ").filter(Boolean);
    const holder = document.createElement("div");
    holder.innerHTML = html;
    const walker = document.createTreeWalker(holder, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      const text = node.nodeValue;
      if (!text || !text.trim()) continue;
      const lower = text.toLowerCase();
      let ranges = [];
      for (const tok of tokens) {
        let from = 0;
        while (from < lower.length) {
          const i = lower.indexOf(tok, from);
          if (i === -1) break;
          ranges.push([i, i + tok.length]);
          from = i + tok.length;
        }
      }
      if (!ranges.length) continue;
      ranges.sort((a, b) => a[0] - b[0]);
      const merged = [];
      for (const r of ranges) {
        const last = merged[merged.length - 1];
        if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
        else merged.push(r.slice());
      }
      const frag = document.createDocumentFragment();
      let cursor = 0;
      for (const [a, b] of merged) {
        if (a > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, a)));
        const mark = document.createElement("mark");
        mark.textContent = text.slice(a, b);
        frag.appendChild(mark);
        cursor = b;
      }
      if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
      node.parentNode.replaceChild(frag, node);
    }
    return holder.innerHTML;
  }

  function renderBlocks(blocks, query) {
    if (!blocks || !blocks.length) return "";
    return blocks.map((b) => {
      if (b.type === "paragraph") return "<p>" + highlightHtml(b.html, query) + "</p>";
      if (b.type === "list") {
        const items = (b.html_items || []).map((it) => "<li>" + highlightHtml(it, query) + "</li>").join("");
        return "<ul>" + items + "</ul>";
      }
      return "";
    }).join("");
  }

  function renderTable(block, query, kind) {
    if (!block || !block.columns) return "";
    const cls = kind === "corrections" ? "sheet corrections" : "sheet";
    const head = block.columns.map((c) => "<th>" + highlightHtml(escapeHtml(c), query) + "</th>").join("");
    const body = block.rows.map((row) => {
      return "<tr>" + row.map((cell) => "<td>" + highlightHtml(escapeHtml(cell), query) + "</td>").join("") + "</tr>";
    }).join("");
    return "<div style='overflow-x:auto'><table class='" + cls + "'><thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody></table></div>";
  }

  function copyButton(label) {
    return '<button type="button" class="copy-btn" data-copy>' + escapeHtml(label) + "</button>";
  }

  function hiddenPlaceholder(kind) {
    if (kind === "en") return '<p class="placeholder">英文已隐藏，说完后再对照。</p>';
    return '<p class="placeholder">中文已隐藏，先试着用英文说。</p>';
  }

  function headingOf(section) {
    return SECTION_LABELS[section.type] || section.heading || "记录";
  }

  function renderPair(chinese, english, query) {
    const zhBody = chinese ? renderBlocks(chinese.blocks, query) : "";
    const enBody = english ? renderBlocks(english.blocks, query) : "";
    let html = '<div class="pair">';
    if (chinese) {
      html += '<section class="card chinese chinese-slot">' +
        "<h3>" + escapeHtml(headingOf(chinese)) + "</h3>" +
        '<div class="body chinese-content">' + zhBody + "</div>" +
        hiddenPlaceholder("zh") +
        "</section>";
    }
    if (english) {
      html += '<section class="card english english-slot">' +
        "<h3>" + escapeHtml(headingOf(english)) + "</h3>" +
        '<div class="body english-content" data-copy-source>' + enBody + "</div>" +
        hiddenPlaceholder("en") +
        '<div class="card-tools english-content">' + copyButton("复制英文") + "</div>" +
        "</section>";
    }
    html += "</div>";
    return html;
  }

  function renderQA(section, query) {
    const items = (section.items || []).map((it) => {
      return '<article class="qa">' +
        '<div class="q">' +
          '<div class="tag">Q</div>' +
          '<div class="english-slot"><div class="qa-en english-content">' + highlightHtml(escapeHtml(it.q_en), query) + "</div>" + hiddenPlaceholder("en") + "</div>" +
          (it.q_zh ? '<div class="chinese-slot"><p class="qa-zh chinese-content">' + highlightHtml(escapeHtml(it.q_zh), query) + "</p>" + hiddenPlaceholder("zh") + "</div>" : "") +
        "</div>" +
        '<div class="a">' +
          '<div class="tag">A</div>' +
          '<div class="english-slot"><div class="qa-en english-content" data-copy-source>' + highlightHtml(escapeHtml(it.a_en), query) + "</div>" + hiddenPlaceholder("en") + "</div>" +
          (it.a_zh ? '<div class="chinese-slot"><p class="qa-zh chinese-content">' + highlightHtml(escapeHtml(it.a_zh), query) + "</p>" + hiddenPlaceholder("zh") + "</div>" : "") +
        "</div>" +
        "</article>";
    }).join("");
    const supplements = (section.supplements || []).map((sp) => {
      return '<div class="supplement">' +
        '<div class="label">' + highlightHtml(escapeHtml(sp.label), query) + "</div>" +
        (sp.en ? '<div class="english-slot"><div class="sup-en english-content" data-copy-source>' + highlightHtml(escapeHtml(sp.en), query) + "</div>" + hiddenPlaceholder("en") + "</div>" : "") +
        (sp.zh ? '<div class="chinese-slot"><p class="sup-zh chinese-content">' + highlightHtml(escapeHtml(sp.zh), query) + "</p>" + hiddenPlaceholder("zh") + "</div>" : "") +
        "</div>";
    }).join("");
    return '<section class="block">' +
      '<div class="block-head"><h3>' + escapeHtml(headingOf(section)) + "</h3></div>" +
      (section.preamble ? '<p class="prose">' + highlightHtml(escapeHtml(section.preamble), query) + "</p>" : "") +
      '<div class="qa-list">' + items + "</div>" +
      supplements +
      "</section>";
  }

  function firstTable(section) {
    return (section.blocks || []).find((b) => b.type === "table");
  }

  function renderGeneric(section, query) {
    const table = firstTable(section);
    const otherBlocks = (section.blocks || []).filter((b) => b.type !== "table");
    const cls = section.type === "note" || section.type === "pending" || section.type === "review" ? section.type : "block";
    let inner = "";
    if (otherBlocks.length) inner += '<div class="prose">' + renderBlocks(otherBlocks, query) + "</div>";
    if (table) inner += renderTable(table, query, section.type);
    return '<section class="' + cls + ' block">' +
      '<div class="block-head"><h3>' + escapeHtml(headingOf(section)) + "</h3></div>" +
      inner +
      "</section>";
  }

  function renderSections(sections, query) {
    let html = "";
    let i = 0;
    while (i < sections.length) {
      const cur = sections[i];
      const next = sections[i + 1];
      if (cur.type === "chinese" && next && next.type === "english") {
        html += renderPair(cur, next, query);
        i += 2;
        continue;
      }
      if (cur.type === "english" && next && next.type === "chinese") {
        html += renderPair(next, cur, query);
        i += 2;
        continue;
      }
      if (cur.type === "chinese") {
        html += renderPair(cur, null, query);
        i += 1;
        continue;
      }
      if (cur.type === "english") {
        html += renderPair(null, cur, query);
        i += 1;
        continue;
      }
      if (cur.type === "qa") {
        html += renderQA(cur, query);
        i += 1;
        continue;
      }
      html += renderGeneric(cur, query);
      i += 1;
    }
    return html;
  }

  function renderDay(note, query) {
    const scenes = note.scenes || [];
    let body = "";
    for (const scene of scenes) {
      if (scene.title) body += '<h3 class="scene-title">' + highlightHtml(escapeHtml(scene.title), query) + "</h3>";
      body += renderSections(scene.sections || [], query);
    }
    $main.innerHTML =
      '<div class="day-head">' +
        "<div>" +
          '<p class="day-meta">' + escapeHtml(note.date) + " · " + escapeHtml(note.weekday) + "</p>" +
          "<h2>" + highlightHtml(escapeHtml(note.title), query) + "</h2>" +
        "</div>" +
      "</div>" +
      body;
  }

  function snippetAround(text, query) {
    const src = String(text || "").replace(/\s+/g, " ").trim();
    if (!src) return "";
    const q = normalize(query);
    const lower = src.toLowerCase();
    let idx = q ? lower.indexOf(q.split(" ")[0]) : 0;
    if (idx < 0) idx = 0;
    const start = Math.max(0, idx - 40);
    const chunk = (start > 0 ? "…" : "") + src.slice(start, start + 180) + (start + 180 < src.length ? "…" : "");
    return highlightHtml(escapeHtml(chunk), query);
  }

  function searchNotes(query) {
    const q = normalize(query);
    if (!q) return state.notes;
    const tokens = q.split(" ").filter(Boolean);
    return state.notes.filter((note) => {
      const hay = normalize(note.search_text);
      return tokens.every((t) => hay.includes(t));
    });
  }

  function renderSearch(query) {
    const hits = searchNotes(query);
    if (!hits.length) {
      $main.innerHTML = '<p class="empty">没有找到包含“' + escapeHtml(query) + "”的记录。</p>";
      return;
    }
    const cards = hits.map((note) => {
      return '<a class="result" href="#/' + encodeURIComponent(note.id) + "?q=" + encodeURIComponent(query) + '">' +
        '<div class="when">' + escapeHtml(note.date) + " · " + escapeHtml(note.weekday) + "</div>" +
        "<h3>" + highlightHtml(escapeHtml(note.title), query) + "</h3>" +
        '<div class="snippet">' + snippetAround(note.search_text, query) + "</div>" +
        "</a>";
    }).join("");
    $main.innerHTML = '<p class="search-summary">找到 ' + hits.length + " 篇与“" + escapeHtml(query) + "”相关的记录</p>" + cards;
  }

  function renderDates(activeId, query) {
    const visible = query ? searchNotes(query) : state.notes;
    const ids = new Set(visible.map((n) => n.id));
    $dates.innerHTML = '<div class="dates-label">日期 · ' + state.notes.length + " 篇</div>" +
      state.notes.map((note) => {
        const active = note.id === activeId && !query;
        const dim = query && !ids.has(note.id);
        const href = "#/" + encodeURIComponent(note.id);
        return '<a class="date-item' + (active ? " is-active" : "") + '" href="' + href + '" style="' + (dim ? "opacity:.38" : "") + '">' +
          '<div class="when"><b>' + escapeHtml(note.date.slice(5)) + "</b><span>" + escapeHtml(note.weekday) + "</span></div>" +
          '<div class="ttl">' + escapeHtml(note.title) + "</div>" +
          "</a>";
      }).join("");
  }

  function render() {
    const route = parseRoute();
    state.query = route.q;
    if ($q.value !== route.q) $q.value = route.q;
    const notes = state.notes;
    if (!notes.length) {
      $dates.innerHTML = "";
      $main.innerHTML = '<p class="empty">还没有练习记录。在 notes/ 下新增一份按日期命名的 Markdown，然后重新构建网站。</p>';
      return;
    }
    let id = route.id;
    if (id && !notes.some((n) => n.id === id)) id = "";
    if (route.q && !id) {
      state.currentId = null;
      renderDates(null, route.q);
      renderSearch(route.q);
      document.title = "搜索：" + route.q + " · 工作英语复习";
      return;
    }
    if (!id) id = notes[0].id;
    state.currentId = id;
    const note = notes.find((n) => n.id === id);
    renderDates(id, "");
    renderDay(note, route.q);
    document.title = note.date + " " + note.title + " · 工作英语复习";
  }

  function onCopy(btn) {
    const source = btn.closest(".card, .qa, .supplement, section");
    const node = (source && source.querySelector("[data-copy-source]")) || source;
    const text = node ? node.innerText.trim() : "";
    if (!text) return;
    const done = () => {
      const prev = btn.textContent;
      btn.textContent = "已复制";
      setTimeout(() => { btn.textContent = prev; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => {});
    }
  }

  function bind() {
    document.querySelectorAll(".modes button").forEach((btn) => {
      btn.addEventListener("click", () => applyMode(btn.dataset.mode));
    });
    let timer = null;
    $q.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const q = $q.value.trim();
        setRoute({ id: q ? "" : (state.currentId || ""), q }, true);
        render();
      }, 160);
    });
    document.querySelector(".search").addEventListener("submit", (e) => {
      e.preventDefault();
      const q = $q.value.trim();
      setRoute({ id: q ? "" : (state.currentId || ""), q }, true);
      render();
    });
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-copy]");
      if (btn) onCopy(btn);
    });
    window.addEventListener("hashchange", render);
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement !== $q && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        $q.focus();
        $q.select();
      }
    });
  }

  applyMode(state.mode);
  bind();

  fetch("data/notes.json", { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error("无法读取 notes.json（" + res.status + "）");
      return res.json();
    })
    .then((data) => {
      state.notes = data.notes || [];
      const route = parseRoute();
      if (!route.id && !route.q && state.notes[0]) {
        setRoute({ id: state.notes[0].id, q: "" }, true);
      }
      render();
    })
    .catch((err) => {
      $main.innerHTML = '<p class="error">页面数据加载失败。请先运行 <code>python3 scripts/build.py</code>，再用本地或网站服务器打开 site/。<br>' + escapeHtml(err.message) + "</p>";
    });
})();
