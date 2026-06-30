const $ = (id) => document.getElementById(id);
let latestState = null;

const TITLES = {
  home: "今天的牵挂",
  message: "给妈妈留言",
  photo: "添加照片",
  conversation: "最近对话",
  memory: "家庭记忆",
};

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (!res.ok) {
    const p = await res.json().catch(() => ({}));
    throw new Error(p.error || `请求失败`);
  }
  return res.json();
}

const vals = (f) => Object.fromEntries(new FormData(f).entries());
const esc = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const escA = (s) => esc(s).replaceAll("`", "&#096;");

async function load() {
  try {
    latestState = await api("/api/state");
    renderHero(latestState);
    renderList("summaries", latestState.summaries || [], renderSummaryItem);
    renderList("photos", latestState.photos || [], renderPhotoItem);
    renderList("conversations", [...(latestState.conversations || [])].reverse().slice(0, 10), renderConvItem);
    renderList("memories", latestState.memories || [], renderMemItem);
    renderList("replies", (latestState.replies || []).filter(r => r.sharePolicy !== "local_only").slice(0, 5), renderReplyItem);
    $("summaryCount").textContent = `${(latestState.summaries || []).length} 条`;
    $("photoCount").textContent = `${(latestState.photos || []).length} 张`;
    $("conversationCount").textContent = `${(latestState.conversations || []).length} 条`;
    $("memoryCount").textContent = `${(latestState.memories || []).length} 条`;
    $("replyCount").textContent = `${(latestState.replies || []).length} 条`;
  } catch (e) { toast(e.message); }
}

function renderHero(s) {
  const p = s.photos?.[0], sm = s.summaries?.[0];
  $("deviceState").textContent = s.device?.micMuted ? "麦克风已关" : s.device?.presence ? "正在陪伴" : "相册模式";
  $("heroTitle").textContent = sm?.title || p?.title || "等待新的回忆";
  $("heroBody").textContent = sm?.body || p?.description || "给妈妈发一张照片或一句话。";
  if (p?.imageUrl) $("latestPhoto").src = p.imageUrl;
}

function renderList(id, items, fn) {
  const el = $(id);
  el.innerHTML = items.length ? items.map(fn).join("") : '<div class="empty">暂无内容</div>';
}

function renderSummaryItem(it) {
  const suggest = it.suggestedReplies?.length ? `
    <div class="bubble-suggest">建议回应：${esc(it.suggestedReplies[0])}</div>
    <button class="bubble-btn" data-reply="${escA(it.suggestedReplies[0])}" data-summary="${escA(it.id)}" type="button">发送这句</button>
  ` : "";
  return `<article class="bubble">
    <div class="bubble-title">${esc(it.title)}</div>
    <div class="bubble-text">${esc(it.body)}</div>
    ${suggest}
    <div class="bubble-meta">${esc(it.createdAt)}</div>
  </article>`;
}

function renderPhotoItem(it) {
  const aiBadge = it.aiAnalyzed ? '<span class="ai-badge">AI</span>' : '';
  return `<article class="photo-item">
    <img class="photo-thumb" src="${escA(it.imageUrl)}" alt="${escA(it.title)}" />
    <div class="photo-info">
      <strong>${esc(it.title)}${aiBadge}</strong>
      <p>${esc(it.description)}</p>
    </div>
    <button class="btn-del-photo" data-delete-photo="${escA(it.id)}" type="button">删除</button>
  </article>`;
}

function renderConvItem(it) {
  const priv = it.deleted ? '<div class="bubble-tag">已删除</div>'
    : it.privacyFlag === "do_not_share" ? '<div class="bubble-tag">不分享</div>'
    : it.privacyFlag === "local_only" ? '<div class="bubble-tag">仅本地</div>'
    : it.privacyFlag === "possible_sensitive" ? '<div class="bubble-tag">可能敏感</div>' : "";
  return `<article class="bubble">
    <div class="bubble-title">${it.speaker === "elder" ? "妈妈" : "忆伴"}</div>
    <div class="bubble-text">${esc(it.text)}</div>
    ${priv}
    <div class="bubble-meta">${esc(it.createdAt)}</div>
  </article>`;
}

function renderMemItem(it) {
  return `<article class="bubble">
    <div class="bubble-title">${esc(it.title)}</div>
    <div class="bubble-text">${esc(it.content)}</div>
    <button class="bubble-btn danger" data-delete-memory="${escA(it.id)}" type="button">删除记忆</button>
    <div class="bubble-meta">${esc(it.confidence)} · ${esc(it.createdAt)}</div>
  </article>`;
}

function renderReplyItem(it) {
  return `<article class="bubble">
    <div class="bubble-title">妈妈回复了你</div>
    <div class="bubble-text">${esc(it.polishedText)}</div>
    <div class="bubble-meta">${esc(it.sentAt || it.createdAt)}</div>
  </article>`;
}

function switchView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.dataset.screen === name));
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.target === name));
  $("screenTitle").textContent = TITLES[name] || TITLES.home;
}

document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => switchView(t.dataset.target)));

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-reply]");
  if (btn) {
    try {
      await api("/api/messages", { method: "POST", body: JSON.stringify({ from: "女儿", content: btn.dataset.reply }) });
      switchView("message");
      $("messageForm").content.value = "";
      toast("已发送到相册");
      await load();
    } catch (err) { toast(err.message); }
    return;
  }
  const dm = e.target.closest("[data-delete-memory]");
  if (dm) {
    try { await api(`/api/memories/${dm.dataset.deleteMemory}`, { method: "DELETE" }); toast("记忆已删除"); await load(); }
    catch (err) { toast(err.message); }
    return;
  }
  const dp = e.target.closest("[data-delete-photo]");
  if (dp) {
    try { await api(`/api/photos/${dp.dataset.deletePhoto}`, { method: "DELETE" }); toast("照片已删除"); await load(); }
    catch (err) { toast(err.message); }
  }
});

$("fillReplyBtn").addEventListener("click", () => {
  switchView("message");
  const f = $("messageForm"), s = latestState?.summaries?.[0];
  f.content.value = s?.suggestedReplies?.[0] || "妈，这张照片我也很喜欢。您再给我讲讲那时候的事。";
  f.content.focus();
});

$("messageForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try { await api("/api/messages", { method: "POST", body: JSON.stringify(vals(e.target)) }); e.target.content.value = ""; toast("已发送到相册"); await load(); }
  catch (err) { toast(err.message); }
});

$("photoForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const imageUrl = $("photoImageUrl").value;
  if (!imageUrl) { toast("请先选择照片"); return; }
  $("aiStatus").hidden = false;
  try {
    await api("/api/photos", { method: "POST", body: JSON.stringify(vals(e.target)) });
    e.target.reset();
    $("photoImageUrl").value = "";
    $("photoPreview").hidden = true;
    $("photoPreview").removeAttribute("src");
    toast("照片已加入相册");
    await load();
  } catch (err) { toast(err.message); }
  finally { $("aiStatus").hidden = true; }
});

$("photoFile").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (!f) return;
  if (!f.type.startsWith("image/")) { toast("请选择图片"); return; }
  if (f.size > 2 * 1024 * 1024) { toast("演示版请选 2MB 以内"); e.target.value = ""; return; }
  const url = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => no(r.error); r.readAsDataURL(f); });
  $("photoImageUrl").value = url;
  $("photoPreview").src = url;
  $("photoPreview").hidden = false;
});

$("summaryBtn").addEventListener("click", async () => {
  try { await api("/api/summaries/generate", { method: "POST", body: "{}" }); toast("已生成亲情摘要"); await load(); }
  catch (err) { toast(err.message); }
});

$("resetBtn").addEventListener("click", async () => {
  try { await api("/api/dev/reset", { method: "POST", body: "{}" }); toast("演示数据已重置"); await load(); }
  catch (err) { toast(err.message); }
});

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 2000);
}

setInterval(load, 5000);
load();
