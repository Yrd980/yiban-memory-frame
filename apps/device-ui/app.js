const state = {
  data: null,
  photoIndex: 0,
};

const $ = (id) => document.getElementById(id);

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

async function load() {
  state.data = await api("/api/state");
  render();
}

function currentPhoto() {
  const photos = state.data?.photos || [];
  if (!photos.length) return null;
  return photos[state.photoIndex % photos.length];
}

function renderClock() {
  const now = new Date();
  $("time").textContent = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  $("date").textContent = now.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

function render() {
  if (!state.data) return;
  renderClock();
  const photo = currentPhoto();
  if (photo) {
    $("photo").src = photo.imageUrl;
    $("photoTitle").textContent = photo.title;
    $("photoDesc").textContent = photo.description;
  }
  const device = state.data.device;
  $("status").textContent = device.micMuted ? "麦克风已关" : device.presence ? "面对面陪伴" : "相册模式";
  $("statusLight").classList.toggle("muted", device.micMuted);
  $("statusLight").classList.toggle("active", device.presence && !device.micMuted);
  $("presence").textContent = device.presence ? "已进入面对面陪伴，可以直接说话。" : "未检测到面对面。";
  $("presenceBtn").textContent = device.presence ? "离开相册前" : "坐到相册前";
  $("micBtn").textContent = device.micMuted ? "打开麦克风" : "关闭麦克风";
  $("micBtn").classList.toggle("secondary", device.micMuted);
  const msg = (state.data.messages || [])[0];
  $("message").textContent = msg ? `${msg.from}：${msg.content}` : "暂无新留言";
  $("messageBadge").textContent = msg ? (msg.heard ? "已读" : "新留言") : "暂无";
  $("messageBadge").classList.toggle("new", Boolean(msg && !msg.heard));
  const lastAi = [...(state.data.conversations || [])].reverse().find((item) => item.speaker === "ai");
  $("aiReply").textContent = lastAi ? lastAi.text : "坐到相册前，可以直接说话。";
  $("talkInput").placeholder = device.micMuted
    ? "麦克风已关"
    : device.presence
      ? "模拟老人说的话"
      : "先坐到相册前";
  $("talkInput").disabled = device.micMuted;
  $("replyBtn").disabled = device.micMuted;
}

async function togglePresence() {
  const presence = !state.data.device.presence;
  state.data.device = await api("/api/device/presence", {
    method: "POST",
    body: JSON.stringify({ presence }),
  });
  if (presence) await markLatestMessageHeard();
  render();
}

async function markLatestMessageHeard() {
  const msg = (state.data.messages || [])[0];
  if (!msg || msg.heard) return;
  const updated = await api(`/api/messages/${msg.id}/heard`, { method: "POST", body: "{}" });
  state.data.messages[0] = updated;
}

async function toggleMic() {
  const micMuted = !state.data.device.micMuted;
  state.data.device = await api("/api/device/mic-muted", {
    method: "POST",
    body: JSON.stringify({ micMuted }),
  });
  render();
}

async function submitTalk(event) {
  event.preventDefault();
  const input = $("talkInput");
  const text = input.value.trim();
  if (!text) return;
  if (state.data.device.micMuted) {
    $("aiReply").textContent = "麦克风已关闭。需要先打开麦克风。";
    return;
  }
  if (!state.data.device.presence) {
    $("aiReply").textContent = "请先坐到相册前，进入面对面陪伴。";
    return;
  }
  input.value = "";
  const photo = currentPhoto();
  try {
    const result = await api("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ text, photoId: photo?.id }),
    });
    state.data.conversations.push(result.elder, result.ai);
    if (result.device) state.data.device = result.device;
    render();
  } catch (error) {
    $("aiReply").textContent = error.message;
  }
}

async function submitReply() {
  const input = $("talkInput");
  const text = input.value.trim();
  const msg = (state.data.messages || [])[0];
  if (!msg) {
    $("aiReply").textContent = "现在没有家人留言需要回复。";
    return;
  }
  if (!text) {
    $("aiReply").textContent = "先说一句想回复家人的话。";
    return;
  }
  if (state.data.device.micMuted) {
    $("aiReply").textContent = "麦克风已关闭。需要先打开麦克风。";
    return;
  }
  if (!state.data.device.presence) {
    $("aiReply").textContent = "请先坐到相册前，进入面对面陪伴。";
    return;
  }
  try {
    const reply = await api(`/api/messages/${msg.id}/replies`, {
      method: "POST",
      body: JSON.stringify({ rawText: text }),
    });
    input.value = "";
    $("aiReply").textContent =
      reply.status === "local_only" ? "好，这段没有发给家人。" : `我帮你发给家人了：${reply.polishedText}`;
    await load();
  } catch (error) {
    $("aiReply").textContent = error.message;
  }
}

function rotatePhoto() {
  const photos = state.data?.photos || [];
  if (photos.length > 1 && !state.data.device.presence) {
    state.photoIndex = (state.photoIndex + 1) % photos.length;
    render();
  }
}

$("presenceBtn").addEventListener("click", togglePresence);
$("micBtn").addEventListener("click", toggleMic);
$("talkForm").addEventListener("submit", submitTalk);
$("replyBtn").addEventListener("click", submitReply);

setInterval(renderClock, 1000);
setInterval(rotatePhoto, 9000);
setInterval(load, 5000);
load();

