const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const { Readable } = require("stream");

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const server = http.createServer(app);

const DEEPGRAM_KEY = process.env.DEEPGRAM_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const ELEVEN_KEY = process.env.ELEVEN_KEY;
const VOICE_ID = process.env.VOICE_ID;

// =========================
// HEALTH
// =========================
app.get("/", (req, res) => res.send("OK"));

// =========================
// TWIML
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
// AI
// =========================
async function getAIResponse(text) {
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
      system: "Casual, short, human.",
      messages: [{ role: "user", content: text }]
    })
  });

  const data = await res.json();
  return data.content?.[0]?.text || "yeah gotcha";
}

// =========================
// AUDIO CONVERSION
// =========================
function convertToMulaw(buffer) {
  return new Promise((resolve, reject) => {
    const stream = new Readable();
    stream.push(buffer);
    stream.push(null);

    const chunks = [];

    ffmpeg(stream)
      .audioFrequency(8000)
      .audioChannels(1)
      .format("mulaw")
      .on("error", reject)
      .on("end", () => resolve(Buffer.concat(chunks)))
      .pipe()
      .on("data", (chunk) => chunks.push(chunk));
  });
}

// =========================
// REALTIME
// =========================
wss.on("connection", (ws) => {
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

    const reply = await getAIResponse(transcript);

    // 🔥 GET WAV (NOT ULaw)
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
          model_id: "eleven_turbo_v2"
        })
      }
    );

    const rawAudio = Buffer.from(await tts.arrayBuffer());

    // 🔥 FORCE CONVERT (THIS FIXES STATIC)
    const mulaw = await convertToMulaw(rawAudio);

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
  console.log("RUNNING FINAL REALTIME");
});
