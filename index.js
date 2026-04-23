const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

// ENV
const DEEPGRAM_KEY = process.env.DEEPGRAM_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const ELEVEN_KEY = process.env.ELEVEN_KEY;
const VOICE_ID = process.env.VOICE_ID;

// =========================
// HEALTH
// =========================
app.get("/", (req, res) => res.send("OK"));

// =========================
// TWIML ENTRY
// =========================
app.all("/voice", (req, res) => {
  res.type("text/xml").send(`
<Response>
  <Connect>
    <Stream url="wss://${req.headers.host}/realtime" />
  </Connect>
</Response>
  `);
});

// =========================
// WS SETUP
// =========================
const wss = new WebSocket.Server({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/realtime") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

// =========================
// μ-LAW CONVERSION (PURE JS)
// =========================
function linearToMulaw(sample) {
  const MULAW_MAX = 0x1FFF;
  const MULAW_BIAS = 33;

  let sign = (sample >> 8) & 0x80;
  if (sign) sample = -sample;

  sample = Math.min(sample, MULAW_MAX);
  sample += MULAW_BIAS;

  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; expMask >>= 1) {
    exponent--;
  }

  let mantissa = (sample >> (exponent + 3)) & 0x0F;
  let mulaw = ~(sign | (exponent << 4) | mantissa);

  return mulaw & 0xFF;
}

function pcm16ToMulaw(buffer) {
  const out = Buffer.alloc(buffer.length / 2);

  for (let i = 0, j = 0; i < buffer.length; i += 2, j++) {
    const sample = buffer.readInt16LE(i);
    out[j] = linearToMulaw(sample);
  }

  return out;
}

// =========================
// AI RESPONSE
// =========================
async function getAIResponse(text) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 60,
        temperature: 0.9,
        system: "Casual, human, short responses.",
        messages: [{ role: "user", content: text }]
      })
    });

    const data = await res.json();
    return data.content?.[0]?.text || "yeah gotcha";

  } catch {
    return "yeah gotcha";
  }
}

// =========================
// REALTIME HANDLER
// =========================
wss.on("connection", (ws) => {
  console.log("REALTIME CONNECTED");

  let streamSid = null;

  const dg = new WebSocket(
    "wss://api.deepgram.com/v1/listen?encoding=mulaw&sample_rate=8000",
    { headers: { Authorization: `Token ${DEEPGRAM_KEY}` } }
  );

  dg.on("message", async (msg) => {
    const data = JSON.parse(msg);
    if (!data.is_final) return;

    const transcript = data.channel?.alternatives?.[0]?.transcript;
    if (!transcript) return;

    console.log("USER:", transcript);

    const reply = await getAIResponse(transcript);
    console.log("AI:", reply);

    // 🔥 GET PCM AUDIO (NOT MP3)
    const tts = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVEN_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: reply,
          model_id: "eleven_turbo_v2",
          output_format: "pcm_16000"
        })
      }
    );

    const pcm = Buffer.from(await tts.arrayBuffer());

    // 🔥 DOWNSAMPLE 16k → 8k (simple skip)
    const downsampled = Buffer.alloc(pcm.length / 2);
    for (let i = 0, j = 0; j < downsampled.length; i += 4, j += 2) {
      downsampled[j] = pcm[i];
      downsampled[j + 1] = pcm[i + 1];
    }

    const mulaw = pcm16ToMulaw(downsampled);

    const chunkSize = 320;

    for (let i = 0; i < mulaw.length; i += chunkSize) {
      if (ws.readyState !== 1 || !streamSid) break;

      const chunk = mulaw.slice(i, i + chunkSize);

      ws.send(JSON.stringify({
        event: "media",
        streamSid,
        media: {
          payload: chunk.toString("base64")
        }
      }));

      await new Promise(r => setTimeout(r, 20));
    }
  });

  ws.on("message", (msg) => {
    const data = JSON.parse(msg);

    if (data.event === "start") {
      streamSid = data.streamSid;
    }

    if (data.event === "media" && dg.readyState === 1) {
      dg.send(Buffer.from(data.media.payload, "base64"));
    }
  });

  ws.on("close", () => dg.close());
});

// =========================
// START
// =========================
server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING CLEAN REALTIME");
});
