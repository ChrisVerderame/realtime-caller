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

  // 🔥 CONNECT TO DEEPGRAM
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

Speak casually like a real human.

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
      // ELEVENLABS (FIXED AUDIO)
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
            model_id: "eleven_turbo_v2"
          })
        }
      );

      const audioBuffer = await tts.arrayBuffer();

      // 🔥 SEND AUDIO BACK TO TWILIO
      const base64Audio = Buffer.from(audioBuffer).toString("base64");

      ws.send(JSON.stringify({
        event: "media",
        media: {
          payload: base64Audio
        }
      }));

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
// START
// =========================
server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING");
});
