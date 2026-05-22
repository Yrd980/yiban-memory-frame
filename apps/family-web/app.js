const $ = (id) => document.getElementById(id);

let latestState = null;
const screenTitles = {
  home: "今天的牵挂",
  message: "给妈妈留言",
  photo: "添加照片",
  conversation: "最近对话",
  memory: "家庭记忆",
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `API ${path} failed`);
  }
  return res.json();
}

function values(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function load() {
  try {
    latestState = await api("/api/state");
    renderHero(latestState);
    renderPhotos(latestState.photos || []);
    renderSummaries(latestState.summaries || []);
    renderConversations(latestState.conversations || []);
    renderMemories(latestState.memories || []);
    renderReplies(latestState.replies || []);
  } catch (error) {
    showToast(error.message);
  }
}

function renderHero(state) {
  const photo = state.photos?.[0];
  const summary = state.summaries?.[0];
  $("deviceState").textContent = state.device?.micMuted
    ? "麦克风已关"
    : state.device?.presence
      ? "正在陪伴"
      : "相册模式";
  $("heroTitle").textContent = summary?.title || photo?.title || "等待新的回忆";
  $("heroBody").textContent = summary?.body || photo?.description || "给妈妈发一张照片或一句话，相册会在合适的时候展示。";
  if (photo?.imageUrl) $("latestPhoto").src = photo.imageUrl;
}

function renderSummaries(items) {
  $("summaryCount").textContent = `${items.length} 条`;
  $("summaries").innerHTML = items.length
    ? items
        .map(
          (item) => {
            return `
        <article class="card">
          <strong>${escapeHtml(item.title)}</strong>
          <div>${escapeHtml(item.body)}</div>
          ${renderSuggested(item.suggestedReplies, item.id)}
          <div class="meta">${escapeHtml(item.createdAt)}</div>
        </article>`;
          }
        )
        .join("")
    : `<div class="card">还没有摘要。可以先发送照片或在相册端模拟一段对话。</div>`;
}

function renderPhotos(items) {
  $("photoCount").textContent = `${items.length} 张`;
  $("photos").innerHTML = items.length
    ? items
        .map(
          (item) => `
        <article class="photo-row">
          <img src="${escapeAttribute(item.imageUrl)}" alt="${escapeAttribute(item.title)}" />
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <p>${escapeHtml(item.description)}</p>
            <button class="inline-action danger" data-delete-photo="${escapeHtml(item.id)}" type="button">删除照片</button>
          </div>
        </article>`
        )
        .join("")
    : `<div class="card">还没有照片。</div>`;
}

function renderSuggested(items = [], summaryId) {
  if (!items.length) return "";
  return `
    <div class="suggested">建议回应：${escapeHtml(items[0])}</div>
    <button class="inline-action" data-reply="${escapeHtml(items[0])}" data-summary="${escapeHtml(summaryId)}" type="button">发送这句</button>
  `;
}

function renderConversations(items) {
  $("conversationCount").textContent = `${items.length} 条`;
  $("conversations").innerHTML = items.length
    ? [...items]
        .reverse()
        .slice(0, 8)
        .map(
          (item) => `
        <article class="card">
          <strong>${item.speaker === "elder" ? "妈妈" : "忆伴"}</strong>
          <div>${escapeHtml(item.text)}</div>
          ${renderPrivacyNote(item)}
          <div class="meta">${escapeHtml(item.createdAt)}</div>
        </article>`
        )
        .join("")
    : `<div class="card">暂无对话。打开相册端后，可以模拟妈妈围绕照片说话。</div>`;
}

function renderMemories(items) {
  $("memoryCount").textContent = `${items.length} 条`;
  $("memories").innerHTML = items.length
    ? items
        .map(
          (item) => `
        <article class="card">
          <strong>${escapeHtml(item.title)}</strong>
          <div>${escapeHtml(item.content)}</div>
          <button class="inline-action danger" data-delete-memory="${escapeHtml(item.id)}" type="button">删除记忆</button>
          <div class="meta">${escapeHtml(item.confidence)} · ${escapeHtml(item.createdAt)}</div>
        </article>`
        )
        .join("")
    : `<div class="card">还没有家庭记忆。生成亲情摘要后，会沉淀一条可追溯的记忆。</div>`;
}

function renderReplies(items) {
  $("replyCount").textContent = `${items.length} 条`;
  $("replies").innerHTML = items.length
    ? items
        .filter((item) => item.sharePolicy !== "local_only")
        .slice(0, 3)
        .map(
          (item) => `
        <article class="card">
          <strong>妈妈回复了你</strong>
          <div>${escapeHtml(item.polishedText)}</div>
          <div class="meta">${escapeHtml(item.sentAt || item.createdAt)}</div>
        </article>`
        )
        .join("")
    : `<div class="card">还没有收到妈妈回复。</div>`;
}

function renderPrivacyNote(item) {
  if (item.deleted) return `<div class="privacy-note">已按老人要求删除，不进入摘要</div>`;
  if (item.privacyFlag === "do_not_share") return `<div class="privacy-note">老人要求不分享</div>`;
  if (item.privacyFlag === "local_only") return `<div class="privacy-note">只留在相册里</div>`;
  if (item.privacyFlag === "possible_sensitive") return `<div class="privacy-note">可能敏感，已从摘要中过滤</div>`;
  return "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function switchScreen(screenName) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.toggle("active", screen.dataset.screen === screenName);
  });
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.target === screenName);
  });
  $("screenTitle").textContent = screenTitles[screenName] || screenTitles.home;
}

document.querySelectorAll(".nav-item").forEach((item) => {
  item.addEventListener("click", () => switchScreen(item.dataset.target));
});

document.addEventListener("click", async (event) => {
  const replyButton = event.target.closest("[data-reply]");
  if (replyButton) {
    try {
      await api("/api/messages", {
        method: "POST",
        body: JSON.stringify({ from: "女儿", content: replyButton.dataset.reply }),
      });
      switchScreen("message");
      $("messageForm").content.value = "";
      showToast("已发送到相册");
      await load();
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  const deleteButton = event.target.closest("[data-delete-memory]");
  if (deleteButton) {
    try {
      await api(`/api/memories/${deleteButton.dataset.deleteMemory}`, { method: "DELETE" });
      showToast("记忆已删除");
      await load();
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  const deletePhotoButton = event.target.closest("[data-delete-photo]");
  if (deletePhotoButton) {
    try {
      await api(`/api/photos/${deletePhotoButton.dataset.deletePhoto}`, { method: "DELETE" });
      showToast("照片已删除");
      await load();
    } catch (error) {
      showToast(error.message);
    }
  }
});

$("fillReplyBtn").addEventListener("click", () => {
  switchScreen("message");
  const form = $("messageForm");
  const summary = latestState?.summaries?.[0];
  form.content.value =
    summary?.suggestedReplies?.[0] || "妈，这张照片我也很喜欢。您再给我讲讲那时候的事。";
  form.content.focus();
});

$("messageForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/messages", { method: "POST", body: JSON.stringify(values(event.target)) });
    event.target.content.value = "";
    showToast("已发送到相册");
    await load();
  } catch (error) {
    showToast(error.message);
  }
});

$("photoForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/photos", { method: "POST", body: JSON.stringify(values(event.target)) });
    event.target.reset();
    $("photoImageUrl").value = "";
    $("photoPreview").hidden = true;
    $("photoPreview").removeAttribute("src");
    showToast("照片已加入相册");
    await load();
  } catch (error) {
    showToast(error.message);
  }
});

$("photoFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("请选择图片文件");
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    showToast("演示版请选 2MB 以内图片");
    event.target.value = "";
    return;
  }
  const imageUrl = await readFileAsDataUrl(file);
  $("photoImageUrl").value = imageUrl;
  $("photoPreview").src = imageUrl;
  $("photoPreview").hidden = false;
});

$("summaryBtn").addEventListener("click", async () => {
  try {
    await api("/api/summaries/generate", { method: "POST", body: "{}" });
    showToast("已生成亲情摘要");
    await load();
  } catch (error) {
    showToast(error.message);
  }
});

$("resetBtn").addEventListener("click", async () => {
  try {
    await api("/api/dev/reset", { method: "POST", body: "{}" });
    showToast("演示数据已重置");
    await load();
  } catch (error) {
    showToast(error.message);
  }
});

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.hidden = true;
  }, 1800);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

setInterval(load, 5000);
load();
