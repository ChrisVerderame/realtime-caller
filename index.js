const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const { Readable } = require("stream");

ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
app.use(express.urlencoded({ extended: true }));

const DEEPGRAM_KEY = process.env.DEEPGRAM_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const ELEVEN_KEY = process.env.ELEVEN_KEY;
const VOICE_ID = process.env.VOICE_ID;

app.get("/", (req, res) => res.send("OK"));

app.all("/voice", (req, res) => {
  res.type("text/xml").send(`
<Response>
  <Connect>
    <Stream url="wss://${req.headers.host}/media" />
  </Connect>
</Response>
  `);
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// =========================
// AI
// =========================
async function getAIResponse(history) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "content-type": "application/json",
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5",
      max_tokens: 50,
      temperature: 0.9,
      system: `
Casual, human, short. Not robotic.
`,
      messages: history
    })
  });

  const data = await res.json();

  let text = "";
  for (const b of data.content || []) {
    if (b.type === "text") text += b.text;
  }

  return text.trim() || "yeah gotcha";
}

// =========================
// AUDIO CONVERSION
// =========================
function convertToMulaw(buffer) {
  return new Promise((resolve, reject) => {
    const stream = new Readable();
    stream.push(Buffer.from(buffer));
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
// CONNECTION
// =========================
wss.on("connection", (ws) => {
  console.log("CALL CONNECTED");

  let history = [];
  let streamReady = false;

  const dg = new WebSocket(
    "wss://api.deepgram.com/v1/listen?encoding=mulaw&sample_rate=8000",
    {
      headers: { Authorization: `Token ${DEEPGRAM_KEY}` }
    }
  );

  dg.on("open", () => console.log("DG CONNECTED"));

  dg.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg);
      if (!data.is_final) return;

      const transcript = data.channel?.alternatives?.[0]?.transcript;
      if (!transcript) return;

      console.log("USER:", transcript);

      history.push({ role: "user", content: transcript });

      const reply = await getAIResponse(history);
      history.push({ role: "assistant", content: reply });

      console.log("AI:", reply);

      if (!streamReady) return;

      // ELEVENLABS RAW AUDIO
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

      const rawAudio = await tts.arrayBuffer();

      // 🔥 FORCE CONVERT
      const mulawAudio = await convertToMulaw(rawAudio);

      const chunkSize = 320;

      for (let i = 0; i < mulawAudio.length; i += chunkSize) {
        if (ws.readyState !== 1) break;

        const chunk = mulawAudio.slice(i, i + chunkSize);

        ws.send(JSON.stringify({
          event: "media",
          media: {
            payload: chunk.toString("base64")
          }
        }));

        await new Promise(r => setTimeout(r, 20));
      }

    } catch (err) {
      console.log("ERROR:", err.message);
    }
  });

  ws.on("message", (msg) => {
    const data = JSON.parse(msg);

    if (data.event === "start") {
      streamReady = true;
      console.log("STREAM READY");
    }

    if (data.event === "media" && dg.readyState === 1) {
      dg.send(Buffer.from(data.media.payload, "base64"));
    }
  });

  ws.on("close", () => {
    dg.close();
    console.log("CALL ENDED");
  });
});

server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING");
});
