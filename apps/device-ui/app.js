const state = {
  data: null,
  photoIndex: 0,
};

const $ = (id) => document.getElementById(id);

let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;
let voiceSupported = false;

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
  $("micBtn").classList.toggle("muted", device.micMuted);
  const msg = (state.data.messages || [])[0];
  $("message").textContent = msg ? `${msg.from}：${msg.content}` : "暂无新留言";
  $("messageBadge").textContent = msg ? (msg.heard ? "已读" : "新留言") : "暂无";
  $("messageBadge").classList.toggle("new", Boolean(msg && !msg.heard));
  const lastAi = [...(state.data.conversations || [])].reverse().find((item) => item.speaker === "ai");
  $("aiReply").textContent = lastAi ? lastAi.text : "坐到相册前，可以直接说话。";
  $("talkInput").placeholder = device.micMuted
    ? "麦克风已关"
    : device.presence
      ? "也可以打字输入"
      : "先坐到相册前";
  $("talkInput").disabled = device.micMuted;
  $("replyBtn").disabled = device.micMuted;
  if (voiceSupported) {
    $("talkBtn").disabled = device.micMuted || !device.presence;
  }
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
  try {
    const res = await fetch("/api/audio/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `${msg.from}说：${msg.content}` }),
    });
    if (res.ok) {
      const blob = await res.blob();
      playAudio(URL.createObjectURL(blob));
    }
  } catch (err) {
    console.error("TTS for message failed:", err);
  }
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

function playAudio(url) {
  const audio = new Audio(url);
  audio.play().catch(() => {
    console.warn("audio autoplay blocked");
  });
}

async function initVoice() {
  if (!window.MediaRecorder) return false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

async function startRecording() {
  if (isRecording) return;
  if (state.data.device.micMuted || !state.data.device.presence) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm",
    });
    audioChunks = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      processRecording();
    };
    mediaRecorder.start();
    isRecording = true;
    $("talkBtn").classList.add("recording");
    $("talkBtnText").textContent = "松开发送";
    $("voiceStatus").hidden = false;
    $("voiceStatusText").textContent = "正在听...";
  } catch (err) {
    $("aiReply").textContent = "无法打开麦克风，请检查权限。";
  }
}

function stopRecording() {
  if (!isRecording || !mediaRecorder) return;
  mediaRecorder.stop();
  isRecording = false;
  $("talkBtn").classList.remove("recording");
  $("talkBtnText").textContent = "按住说话";
  $("voiceStatusText").textContent = "正在识别...";
}

async function processRecording() {
  if (audioChunks.length === 0) {
    $("voiceStatus").hidden = true;
    return;
  }
  const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
  audioChunks = [];
  try {
    const res = await fetch("/api/audio/transcribe", {
      method: "POST",
      headers: { "Content-Type": blob.type },
      body: blob,
    });
    if (!res.ok) throw new Error("识别失败");
    const { text } = await res.json();
    if (!text) {
      $("aiReply").textContent = "没听清，再说一次好吗？";
      $("voiceStatus").hidden = true;
      return;
    }
    $("voiceStatusText").textContent = `听到：${text}`;
    await sendConversation(text);
  } catch (err) {
    $("aiReply").textContent = err.message || "语音识别出了问题。";
  }
  $("voiceStatus").hidden = true;
}

async function sendConversation(text) {
  if (state.data.device.micMuted) {
    $("aiReply").textContent = "麦克风已关闭。";
    return;
  }
  if (!state.data.device.presence) {
    $("aiReply").textContent = "请先坐到相册前。";
    return;
  }
  const photo = currentPhoto();
  try {
    const result = await api("/api/conversations", {
      method: "POST",
      body: JSON.stringify({ text, photoId: photo?.id }),
    });
    state.data.conversations.push(result.elder, result.ai);
    if (result.device) state.data.device = result.device;
    render();
    if (result.aiAudioUrl) {
      playAudio(result.aiAudioUrl);
    }
  } catch (error) {
    $("aiReply").textContent = error.message;
  }
}

async function submitTalk(event) {
  event.preventDefault();
  const input = $("talkInput");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  await sendConversation(text);
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

const talkBtn = $("talkBtn");
talkBtn.addEventListener("mousedown", startRecording);
talkBtn.addEventListener("mouseup", stopRecording);
talkBtn.addEventListener("mouseleave", stopRecording);
talkBtn.addEventListener("touchstart", (e) => { e.preventDefault(); startRecording(); });
talkBtn.addEventListener("touchend", (e) => { e.preventDefault(); stopRecording(); });

$("presenceBtn").addEventListener("click", togglePresence);
$("micBtn").addEventListener("click", toggleMic);
$("talkForm").addEventListener("submit", submitTalk);
$("replyBtn").addEventListener("click", submitReply);

setInterval(renderClock, 1000);
setInterval(rotatePhoto, 9000);
setInterval(load, 5000);

initVoice().then((supported) => {
  voiceSupported = supported;
  if (!supported) {
    talkBtn.hidden = true;
  } else {
    talkBtn.disabled = true;
  }
  load();
});

