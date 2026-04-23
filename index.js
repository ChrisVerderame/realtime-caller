const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.urlencoded({ extended: true }));

// =========================
// HEALTH
// =========================
app.get("/", (req, res) => {
  res.send("OK");
});

// =========================
// TWILIO ENTRY
// =========================
app.all("/voice", (req, res) => {
  res.type("text/xml").send(`
<Response>
  <Connect>
    <Stream url="wss://${req.headers.host}/media" />
  </Connect>
</Response>
  `);
});

// =========================
// SERVER + WS
// =========================
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// =========================
// ENV
// =========================
const DEEPGRAM_KEY = process.env.DEEPGRAM_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const ELEVEN_KEY = process.env.ELEVEN_KEY;
const VOICE_ID = process.env.VOICE_ID;

// =========================
// WS CONNECTION
// =========================
wss.on("connection", (ws) => {
  console.log("CALL CONNECTED");

  let history = [];
  let streamReady = false;

  // 🔥 Safety: log socket errors
  ws.on("error", (err) => {
    console.log("WS CONNECTION ERROR:", err.message);
  });

  // =========================
  // DEEPGRAM
  // =========================
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
      const transcript = data.channel?.alternatives?.[0]?.transcript;

      if (!transcript || transcript.length < 2) return;

      console.log("USER:", transcript);

      history.push({ role: "user", content: transcript });

      // =========================
      // AI
      // =========================
      const ai = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_KEY,
          "content-type": "application/json",
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 60,
          temperature: 0.7,
          system: `
You are Jack from Blackline.

Speak casually and naturally.

Goal:
- build light rapport
- move toward Chris seeing the property

Mention naturally:
"Chris handles everything in person and can swing by"

Keep responses short.
`,
          messages: history
        })
      });

      const aiData = await ai.json();

      let reply = "";
      if (aiData?.content) {
        for (const b of aiData.content) {
          if (b.type === "text") reply += b.text;
        }
      }

      reply = reply.trim();
      history.push({ role: "assistant", content: reply });

      console.log("AI:", reply);

      // =========================
      // WAIT UNTIL STREAM READY
      // =========================
      if (!streamReady) {
        console.log("SKIPPING AUDIO — STREAM NOT READY");
        return;
      }

      // =========================
      // ELEVENLABS μ-LAW
      // =========================
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
            output_format: "ulaw_8000"
          })
        }
      );

      const audioBuffer = await tts.arrayBuffer();

      // =========================
      // STREAM AUDIO (FIXED)
      // =========================
      const chunkSize = 320;

      for (let i = 0; i < audioBuffer.byteLength; i += chunkSize) {
        // 🔥 CRITICAL: only send if socket is OPEN
        if (ws.readyState !== 1) {
          console.log("WS NOT OPEN — STOPPING AUDIO");
          break;
        }

        const chunk = audioBuffer.slice(i, i + chunkSize);

        ws.send(JSON.stringify({
          event: "media",
          media: {
            payload: Buffer.from(chunk).toString("base64")
          }
        }));

        // 🔥 pacing (required)
        await new Promise((r) => setTimeout(r, 20));
      }

    } catch (err) {
      console.log("AI ERROR:", err);
    }
  });

  // =========================
  // TWILIO AUDIO → DEEPGRAM
  // =========================
  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.event === "start") {
        console.log("STREAM READY");
        streamReady = true;
      }

      if (data.event === "media") {
        dg.send(Buffer.from(data.media.payload, "base64"));
      }

    } catch (err) {
      console.log("WS ERROR:", err);
    }
  });

  ws.on("close", () => {
    console.log("CALL ENDED");
    dg.close();
  });
});

// =========================
// START SERVER
// =========================
server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING");
});
