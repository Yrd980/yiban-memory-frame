import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const dataDir = join(root, "data");
const stateFile = join(dataDir, "demo-state.json");

const XIAOMI_BASE_URL = process.env.XIAOMI_BASE_URL || "https://token-plan-cn.xiaomimimo.com";
const XIAOMI_API_ENDPOINT = process.env.XIAOMI_API_ENDPOINT || `${XIAOMI_BASE_URL}/v1/chat/completions`;
const XIAOMI_API_KEY = process.env.ANTHROPIC_AUTH_TOKEN || process.env.XIAOMI_API_KEY || "";
const XIAOMI_MODEL = process.env.XIAOMI_MODEL || "mimo-v2.5-pro";
const XIAOMI_VISION_MODEL = process.env.XIAOMI_VISION_MODEL || "mimo-v2.5";
const XIAOMI_ASR_ENDPOINT = `${XIAOMI_BASE_URL}/v1/audio/transcriptions`;
const XIAOMI_TTS_ENDPOINT = `${XIAOMI_BASE_URL}/v1/audio/speech`;

const now = () => new Date().toISOString();

const defaultState = () => ({
  device: {
    presence: false,
    micMuted: false,
    mode: "IDLE_ALBUM",
    network: "online",
  },
  photos: [
    {
      id: "photo_001",
      title: "小宝在公园放风筝",
      description: "女儿发来的新照片。小宝在草地上跑着放风筝，看起来很开心。",
      people: ["小宝", "女儿"],
      sceneTags: ["公园", "放风筝", "春天"],
      memoryPrompts: ["小宝放风筝的样子，让你想起谁小时候？", "以前家里春天常去哪里玩？"],
      imageUrl:
        "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1800&q=80",
      uploadedAt: now(),
    },
    {
      id: "photo_002",
      title: "老家的饭桌",
      description: "一张家里人围坐吃饭的照片，桌上有饺子和热汤。",
      people: ["妈妈", "女儿", "小宝"],
      sceneTags: ["老家", "团圆饭", "饺子"],
      memoryPrompts: ["以前过年包饺子时，谁最会擀皮？", "这张饭桌让你想起哪次团圆？"],
      imageUrl:
        "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1800&q=80",
      uploadedAt: now(),
    },
  ],
  messages: [
    {
      id: "msg_001",
      from: "女儿",
      content: "妈，小宝今天去公园放风筝了，给你看看。",
      createdAt: now(),
      heard: false,
    },
  ],
  conversations: [],
  replies: [],
  summaries: [],
  memories: [],
});

let state = defaultState();

async function loadState() {
  try {
    const raw = await readFile(stateFile, "utf8");
    state = { ...defaultState(), ...JSON.parse(raw) };
  } catch (error) {
    if (error.code !== "ENOENT") console.error(error);
    state = defaultState();
    await saveState();
  }
}

async function saveState() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(stateFile, JSON.stringify(state, null, 2), "utf8");
}

async function resetState() {
  state = defaultState();
  await saveState();
  return state;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function findPhoto(id) {
  return state.photos.find((photo) => photo.id === id) || state.photos[0];
}

function detectPrivacyIntent(text) {
  if (/删掉|删除|delete/i.test(text)) return "delete_last";
  if (/别听|休息吧|不用了|关掉|stop listening|stop/i.test(text)) return "stop_listening";
  if (/别发|不要告诉|别告诉|不分享|do not share|don't share|dont share/i.test(text)) return "do_not_share";
  if (/只记着|只记在|留在相册|local only|keep it here/i.test(text)) return "local_only";
  return "normal";
}

function isSensitive(text) {
  return /借钱|银行卡|密码|房子|遗嘱|医院|诊断|药|不想活|打架|吵架|报警/.test(text);
}

function findRelatedMemory(photoId) {
  return state.memories.find(
    (memory) =>
      memory.sharePolicy === "family_visible" &&
      memory.sensitivity === "normal" &&
      (memory.relatedPhotoIds || []).includes(photoId)
  );
}

function shortMemory(memory) {
  const content = String(memory.content || memory.title || "").replace(/\s+/g, " ");
  return content.length > 42 ? `${content.slice(0, 42)}...` : content;
}

async function xiaomiVision(imageDataUrl) {
  const res = await fetch(XIAOMI_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${XIAOMI_API_KEY}`,
    },
    body: JSON.stringify({
      model: XIAOMI_VISION_MODEL,
      messages: [
        {
          role: "system",
          content: `你是一位照片分析助手。请分析这张家庭照片，返回严格JSON格式，不要加其他文字：
{"title":"照片标题，15字以内，温馨自然","description":"照片描述，30-50字，像在给老人描述这张照片","people":["人物1","人物2"],"sceneTags":["场景1","场景2","场景3"],"memoryPrompts":["回忆引导问题1，让老人想起过去","回忆引导问题2，与照片内容相关"]}`,
        },
        {
          role: "user",
          content: [
            { type: "text", text: "请分析这张家庭照片。" },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ],
        },
      ],
      temperature: 0.7,
      max_tokens: 512,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("empty vision response");
  return JSON.parse(text);
}

async function xiaomiASR(audioBuffer, mimeType) {
  const boundary = `----FormBoundary${Date.now().toString(36)}`;
  const parts = [];
  parts.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="audio.webm"\r\n` +
    `Content-Type: ${mimeType || "audio/webm"}\r\n\r\n`
  );
  parts.push(audioBuffer);
  parts.push("\r\n");
  parts.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="model"\r\n\r\n`
  );
  parts.push(Buffer.from("mimo-v2.5-asr"));
  parts.push("\r\n");
  parts.push(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="language"\r\n\r\n`
  );
  parts.push(Buffer.from("zh"));
  parts.push("\r\n");
  parts.push(`--${boundary}--\r\n`);
  const body = Buffer.concat(parts.map((p) => (typeof p === "string" ? Buffer.from(p) : p)));
  const res = await fetch(XIAOMI_ASR_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${XIAOMI_API_KEY}`,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body,
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.text || data.choices?.[0]?.message?.content || "";
}

async function xiaomiTTS(text) {
  const res = await fetch(XIAOMI_TTS_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${XIAOMI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "mimo-v2.5-tts",
      input: text,
      voice: "alloy",
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`TTS failed: ${res.status} ${errText}`);
  }
  return {
    audioBuffer: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get("content-type") || "audio/mpeg",
  };
}

async function xiaomiChat(messages) {
  const res = await fetch(XIAOMI_API_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${XIAOMI_API_KEY}`,
    },
    body: JSON.stringify({ model: XIAOMI_MODEL, messages, temperature: 0.7, max_tokens: 512 }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("empty response from Xiaomi API");
  return text;
}

async function createAiReply(text, photo, privacyIntent, relatedMemory) {
  const prompt = photo?.memoryPrompts?.[0] || "这张照片让你想起什么？";
  if (privacyIntent === "delete_last") return "好，刚才那段已经删掉了。";
  if (privacyIntent === "stop_listening") return "好，我们先休息。";
  if (privacyIntent === "do_not_share") return "好，这段不发给家人。";
  if (privacyIntent === "local_only") return "好，我只记在相册里。";
  if (/告诉|回复|帮我说|发给/.test(text)) {
    return "我可以帮你整理成一段清楚的话。你想让我按原意发给家人吗？";
  }
  try {
    const context = [
      `照片信息：${photo.title}，人物：${photo.people.join("、")}，场景：${photo.sceneTags.join("、")}`,
      `老人说：${text}`,
      relatedMemory ? `相关记忆：${shortMemory(relatedMemory)}` : "",
      `引导话题：${prompt}`,
    ]
      .filter(Boolean)
      .join("\n");
    return await xiaomiChat([
      {
        role: "system",
        content:
          "你是一位温暖的AI陪伴助手，正在和一位老人聊天。老人正在看家庭照片并讲述回忆。请用简短、温暖、自然的语气回复，像一位亲切的朋友。不要用敬语，不要说'您'，用'你'就好。回复控制在2-3句话以内。",
      },
      { role: "user", content: context },
    ]);
  } catch (err) {
    console.error("createAiReply failed:", err.message);
    return `这张照片里有${photo.people.join("、")}，是在${photo.sceneTags.join("、")}的场景。${prompt}`;
  }
}

async function polishReply(text) {
  try {
    return await xiaomiChat([
      {
        role: "system",
        content:
          "你是一位文字整理助手。请把老人的原话整理成通顺、自然的表达，保持原意不变，不要添加任何额外内容。只输出整理后的文字，不要加引号或前缀。",
      },
      { role: "user", content: text },
    ]);
  } catch (err) {
    console.error("polishReply failed:", err.message);
    return text;
  }
}

function normalizeImageUrl(value) {
  const imageUrl = String(value || "").trim();
  if (!imageUrl) {
    return "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=1800&q=80";
  }
  if (!/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(imageUrl)) {
    return "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=1800&q=80";
  }
  if (imageUrl.length > 3_000_000) {
    throw new Error("image is too large");
  }
  return imageUrl;
}

async function createSummary() {
  const allowedTurns = state.conversations.filter(
    (item) =>
      item.speaker === "elder" &&
      !item.deleted &&
      item.summaryAllowed !== false &&
      item.privacyFlag !== "local_only" &&
      item.privacyFlag !== "private" &&
      detectPrivacyIntent(item.text) === "normal"
  );
  const lastElder = [...allowedTurns].reverse().find((item) => !isSensitive(item.text));
  const sourcePhoto = lastElder ? findPhoto(lastElder.photoId) : state.photos[0];

  let title, body, suggestedReplies;
  try {
    const context = lastElder
      ? `老人今天围绕照片「${sourcePhoto.title}」（人物：${sourcePhoto.people.join("、")}，场景：${sourcePhoto.sceneTags.join("、")}）聊到：${lastElder.text}`
      : `相册里新增了「${sourcePhoto.title}」（人物：${sourcePhoto.people.join("、")}，场景：${sourcePhoto.sceneTags.join("、")}），老人还没有聊过。`;
    const aiResult = await xiaomiChat([
      {
        role: "system",
        content: `你是家庭亲情助手。请根据老人的聊天内容生成一段摘要，发送给在外的子女。
请严格返回JSON格式，不要加其他文字：
{"title":"一句话标题，15字以内","body":"摘要正文，50-80字，温暖地描述老人聊了什么","suggestedReplies":["建议子女回复1，15字以内","建议子女回复2，15字以内"]}`,
      },
      { role: "user", content: context },
    ]);
    const parsed = JSON.parse(aiResult);
    title = parsed.title;
    body = parsed.body;
    suggestedReplies = parsed.suggestedReplies;
  } catch (err) {
    console.error("createSummary AI failed:", err.message);
    title = lastElder ? "今天有一段值得回应的回忆" : "可以从一张新照片开始聊起";
    body = lastElder
      ? `妈妈今天围绕「${sourcePhoto.title}」聊到：${lastElder.text}。可以顺着这张照片回一句话，接住这段回忆。`
      : `相册里新增了「${sourcePhoto.title}」。可以先发一句简短留言，邀请老人看照片、讲讲过去。`;
    suggestedReplies = ["这张照片我也很喜欢，您再给我讲讲那时候的事。", "周末我再发几张照片给您看。"];
  }

  const summary = {
    id: makeId("summary"),
    type: lastElder ? "daily_memory" : "photo_prompt",
    title,
    body,
    suggestedReplies,
    sourceTurnIds: lastElder ? [lastElder.id] : [],
    sourcePhotoIds: sourcePhoto ? [sourcePhoto.id] : [],
    sensitivity: "normal",
    shareStatus: "ready",
    createdAt: new Date().toLocaleString("zh-CN"),
  };
  state.summaries.unshift(summary);
  if (lastElder) createMemoryFromSummary(summary, sourcePhoto, lastElder);
  return summary;
}

function createMemoryFromSummary(summary, photo, turn) {
  const memory = {
    id: makeId("memory"),
    type: "photo_memory",
    title: summary.title,
    content: turn?.text ? `妈妈说：${turn.text}` : summary.body,
    people: photo?.people || [],
    places: photo?.sceneTags || [],
    relatedPhotoIds: photo ? [photo.id] : [],
    sourceTurnIds: turn ? [turn.id] : [],
    sourceSummaryId: summary.id,
    confidence: "confirmed_by_elder",
    sharePolicy: "family_visible",
    sensitivity: summary.sensitivity,
    createdAt: new Date().toLocaleString("zh-CN"),
  };
  state.memories.unshift(memory);
  return memory;
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/state") return sendJson(res, 200, state);

  if (req.method === "POST" && pathname === "/api/dev/reset") {
    return sendJson(res, 200, await resetState());
  }

  if (req.method === "GET" && pathname === "/api/memories") return sendJson(res, 200, { memories: state.memories });

  const memoryDeleteMatch = pathname.match(/^\/api\/memories\/([^/]+)$/);
  if (req.method === "DELETE" && memoryDeleteMatch) {
    const index = state.memories.findIndex((memory) => memory.id === memoryDeleteMatch[1]);
    if (index === -1) return sendJson(res, 404, { error: "memory not found" });
    const [deleted] = state.memories.splice(index, 1);
    await saveState();
    return sendJson(res, 200, { deleted });
  }

  if (req.method === "POST" && pathname === "/api/device/presence") {
    const body = await readBody(req);
    state.device.presence = Boolean(body.presence);
    state.device.mode = state.device.presence ? "FACE_TO_FACE_READY" : "IDLE_ALBUM";
    await saveState();
    return sendJson(res, 200, state.device);
  }

  if (req.method === "POST" && pathname === "/api/device/mic-muted") {
    const body = await readBody(req);
    state.device.micMuted = Boolean(body.micMuted);
    state.device.mode = state.device.micMuted ? "MIC_MUTED" : state.device.presence ? "FACE_TO_FACE_READY" : "IDLE_ALBUM";
    await saveState();
    return sendJson(res, 200, state.device);
  }

  if (req.method === "POST" && pathname === "/api/messages") {
    const body = await readBody(req);
    const message = {
      id: makeId("msg"),
      from: String(body.from || "家人").trim(),
      content: String(body.content || "").trim(),
      createdAt: new Date().toLocaleString("zh-CN"),
      heard: false,
    };
    if (!message.content) return sendJson(res, 400, { error: "content is required" });
    state.messages.unshift(message);
    await saveState();
    return sendJson(res, 201, message);
  }

  const messageHeardMatch = pathname.match(/^\/api\/messages\/([^/]+)\/heard$/);
  if (req.method === "POST" && messageHeardMatch) {
    const message = state.messages.find((item) => item.id === messageHeardMatch[1]);
    if (!message) return sendJson(res, 404, { error: "message not found" });
    message.heard = true;
    message.heardAt = new Date().toLocaleString("zh-CN");
    await saveState();
    return sendJson(res, 200, message);
  }

  const messageReplyMatch = pathname.match(/^\/api\/messages\/([^/]+)\/replies$/);
  if (req.method === "POST" && messageReplyMatch) {
    if (state.device.micMuted) return sendJson(res, 409, { error: "麦克风已关闭，不能回复留言。" });
    if (!state.device.presence) return sendJson(res, 409, { error: "请先进入面对面陪伴模式。" });
    const message = state.messages.find((item) => item.id === messageReplyMatch[1]);
    if (!message) return sendJson(res, 404, { error: "message not found" });
    const body = await readBody(req);
    const rawText = String(body.rawText || "").trim();
    if (!rawText) return sendJson(res, 400, { error: "rawText is required" });
    const privacyIntent = detectPrivacyIntent(rawText);
    if (privacyIntent === "do_not_share" || privacyIntent === "local_only") {
      const reply = {
        id: makeId("reply"),
        messageId: message.id,
        rawText,
        polishedText: "这段回复已按老人要求留在相册里，没有发给家人。",
        status: "local_only",
        sharePolicy: "local_only",
        createdAt: new Date().toLocaleString("zh-CN"),
        sentAt: null,
      };
      state.replies.unshift(reply);
      await saveState();
      return sendJson(res, 201, reply);
    }
    const reply = {
      id: makeId("reply"),
      messageId: message.id,
      rawText,
      polishedText: await polishReply(rawText),
      status: "sent",
      sharePolicy: "send_to_sender",
      createdAt: new Date().toLocaleString("zh-CN"),
      sentAt: new Date().toLocaleString("zh-CN"),
    };
    message.repliedAt = reply.sentAt;
    state.replies.unshift(reply);
    await saveState();
    return sendJson(res, 201, reply);
  }

  if (req.method === "POST" && pathname === "/api/photos") {
    const body = await readBody(req);
    let imageUrl;
    try {
      imageUrl = normalizeImageUrl(body.imageUrl);
    } catch {
      return sendJson(res, 413, { error: "图片太大，演示版请使用 2MB 以内图片。" });
    }
    const rawTitle = String(body.title || "").trim();
    const rawDescription = String(body.description || "").trim();
    const rawPeople = String(body.people || "").trim();
    const rawSceneTags = String(body.sceneTags || "").trim();
    const rawMemoryPrompts = String(body.memoryPrompts || "").trim();
    const needsAI = !rawTitle && !rawDescription && !rawPeople;
    let aiMeta = null;
    if (needsAI && imageUrl) {
      try {
        aiMeta = await xiaomiVision(imageUrl);
      } catch (err) {
        console.error("photo vision analysis failed:", err.message);
      }
    }
    const photo = {
      id: makeId("photo"),
      title: rawTitle || aiMeta?.title || "新的家庭照片",
      description: rawDescription || aiMeta?.description || "家人新添加了一张照片。",
      people: (rawPeople ? rawPeople.split(/[、,，]/) : aiMeta?.people || ["家人"])
        .map((item) => item.trim())
        .filter(Boolean),
      sceneTags: (rawSceneTags ? rawSceneTags.split(/[、,，]/) : aiMeta?.sceneTags || ["家庭"])
        .map((item) => item.trim())
        .filter(Boolean),
      memoryPrompts: (rawMemoryPrompts ? rawMemoryPrompts.split(/\r?\n/) : aiMeta?.memoryPrompts || ["这张照片让你想起什么？"])
        .map((item) => item.trim())
        .filter(Boolean),
      imageUrl,
      uploadedAt: now(),
      aiAnalyzed: Boolean(aiMeta),
    };
    state.photos.unshift(photo);
    await saveState();
    return sendJson(res, 201, photo);
  }

  const photoDeleteMatch = pathname.match(/^\/api\/photos\/([^/]+)$/);
  if (req.method === "DELETE" && photoDeleteMatch) {
    const index = state.photos.findIndex((photo) => photo.id === photoDeleteMatch[1]);
    if (index === -1) return sendJson(res, 404, { error: "photo not found" });
    if (state.photos.length <= 1) return sendJson(res, 409, { error: "相册至少保留一张照片。" });
    const [deleted] = state.photos.splice(index, 1);
    state.memories = state.memories.map((memory) => ({
      ...memory,
      relatedPhotoIds: (memory.relatedPhotoIds || []).filter((id) => id !== deleted.id),
    }));
    await saveState();
    return sendJson(res, 200, { deleted });
  }

  const audioFileMatch = pathname.match(/^\/api\/audio\/file\/([^/]+\.mp3)$/);
  if (req.method === "GET" && audioFileMatch) {
    const safeName = audioFileMatch[1].replace(/[^a-z0-9_.]/gi, "");
    const filePath = join(dataDir, safeName);
    try {
      const data = await readFile(filePath);
      res.writeHead(200, { "Content-Type": "audio/mpeg", "Content-Length": data.length });
      res.end(data);
    } catch {
      return sendJson(res, 404, { error: "audio not found" });
    }
  }

  if (req.method === "POST" && pathname === "/api/audio/transcribe") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const audioBuffer = Buffer.concat(chunks);
    if (audioBuffer.length === 0) return sendJson(res, 400, { error: "empty audio" });
    if (audioBuffer.length > 10 * 1024 * 1024) return sendJson(res, 413, { error: "audio too large" });
    const mimeType = req.headers["content-type"] || "audio/webm";
    try {
      const text = await xiaomiASR(audioBuffer, mimeType);
      return sendJson(res, 200, { text: text.trim() });
    } catch (err) {
      console.error("ASR failed:", err.message);
      return sendJson(res, 502, { error: "语音识别失败，请重试。" });
    }
  }

  if (req.method === "POST" && pathname === "/api/audio/speak") {
    const body = await readBody(req);
    const text = String(body.text || "").trim();
    if (!text) return sendJson(res, 400, { error: "text is required" });
    if (text.length > 500) return sendJson(res, 400, { error: "text too long" });
    try {
      const { audioBuffer, contentType } = await xiaomiTTS(text);
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": audioBuffer.length,
        "Cache-Control": "no-cache",
      });
      res.end(audioBuffer);
    } catch (err) {
      console.error("TTS failed:", err.message);
      return sendJson(res, 502, { error: "语音合成失败。" });
    }
  }

  if (req.method === "POST" && pathname === "/api/conversations") {
    if (state.device.micMuted) return sendJson(res, 409, { error: "麦克风已关闭，不能继续输入。" });
    if (!state.device.presence) return sendJson(res, 409, { error: "请先进入面对面陪伴模式。" });
    const body = await readBody(req);
    const text = String(body.text || "").trim();
    if (!text) return sendJson(res, 400, { error: "text is required" });
    const photo = findPhoto(body.photoId);
    const privacyIntent = detectPrivacyIntent(text);
    const sensitive = isSensitive(text);
    let deletedTurn = null;
    if (privacyIntent === "delete_last") {
      deletedTurn = [...state.conversations].reverse().find((item) => item.speaker === "elder" && !item.deleted);
      if (deletedTurn) {
        deletedTurn.deleted = true;
        deletedTurn.summaryAllowed = false;
        deletedTurn.memoryAllowed = false;
        deletedTurn.privacyFlag = "deleted";
      }
    }
    if (privacyIntent === "stop_listening") {
      state.device.presence = false;
      state.device.mode = state.device.micMuted ? "MIC_MUTED" : "IDLE_ALBUM";
    }
    const relatedMemory = findRelatedMemory(photo.id);
    const summaryAllowed = privacyIntent === "normal" && !sensitive;
    const privacyFlag =
      privacyIntent === "do_not_share"
        ? "do_not_share"
        : privacyIntent === "local_only"
          ? "local_only"
          : privacyIntent === "delete_last"
            ? "deleted"
            : sensitive
              ? "possible_sensitive"
              : "normal";
    const elder = {
      id: makeId("conv"),
      speaker: "elder",
      text,
      photoId: photo.id,
      privacyFlag,
      summaryAllowed,
      memoryAllowed: privacyIntent !== "delete_last" && privacyIntent !== "stop_listening",
      deleted: privacyIntent === "delete_last",
      sensitivity: sensitive ? "possible_sensitive" : "normal",
      createdAt: new Date().toLocaleString("zh-CN"),
    };
    const ai = {
      id: makeId("conv"),
      speaker: "ai",
      text: await createAiReply(text, photo, privacyIntent, relatedMemory),
      photoId: photo.id,
      relatedMemoryId: relatedMemory?.id || null,
      privacyFlag: "system",
      summaryAllowed: false,
      memoryAllowed: false,
      deleted: false,
      sensitivity: "normal",
      createdAt: new Date().toLocaleString("zh-CN"),
    };
    state.conversations.push(elder, ai);
    let aiAudioUrl = null;
    try {
      const { audioBuffer } = await xiaomiTTS(ai.text);
      const audioId = makeId("audio");
      const audioFile = join(dataDir, `${audioId}.mp3`);
      await writeFile(audioFile, audioBuffer);
      aiAudioUrl = `/api/audio/file/${audioId}.mp3`;
    } catch (err) {
      console.error("TTS for AI reply failed:", err.message);
    }
    await saveState();
    return sendJson(res, 201, { elder, ai, aiAudioUrl, device: state.device, deletedTurn });
  }

  if (req.method === "POST" && pathname === "/api/summaries/generate") {
    const summary = await createSummary();
    await saveState();
    return sendJson(res, 201, summary);
  }

  return sendJson(res, 404, { error: "not found" });
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
};

async function serveStatic(res, pathname) {
  const route =
    pathname === "/" ? "apps/family-web/index.html" : pathname.startsWith("/device/") ? `apps/device-ui/${pathname.slice(8) || "index.html"}` : `apps/family-web/${pathname.slice(1)}`;
  const safePath = normalize(route).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);
  const data = await readFile(filePath);
  res.writeHead(200, { "Content-Type": mime[extname(filePath)] || "application/octet-stream" });
  res.end(data);
}

await loadState();

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url.pathname);
    return await serveStatic(res, url.pathname);
  } catch (error) {
    if (error.code === "ENOENT") return sendJson(res, 404, { error: "not found" });
    console.error(error);
    return sendJson(res, 500, { error: "internal server error" });
  }
}).listen(port, () => {
  console.log(`Yiban Memory Frame dev server: http://localhost:${port}`);
  console.log(`Device UI: http://localhost:${port}/device/`);
});
