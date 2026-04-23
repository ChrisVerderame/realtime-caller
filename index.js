const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.urlencoded({ extended: true }));

const DEEPGRAM_KEY = process.env.DEEPGRAM_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const ELEVEN_KEY = process.env.ELEVEN_KEY;
const VOICE_ID = process.env.VOICE_ID;

// =========================
// HEALTH
// =========================
app.get("/", (req, res) => res.send("OK"));

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
You are Jack from Blackline.

Casual. Human. Short.

1 sentence most of the time.
Use fillers like "yeah", "honestly", "gotcha".
Don't sound scripted.
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
// CONNECTION
// =========================
wss.on("connection", (ws) => {
  console.log("CALL CONNECTED");

  let history = [];
  let streamReady = false;

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

      const reply = await getAIResponse(history);
      history.push({ role: "assistant", content: reply });

      console.log("AI:", reply);

      if (!streamReady) return;

      // =========================
      // ELEVENLABS STREAM
      // =========================
      const tts = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`,
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

      const reader = tts.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (ws.readyState !== 1) break;

        ws.send(JSON.stringify({
          event: "media",
          media: {
            payload: Buffer.from(value).toString("base64")
          }
        }));

        // 🔥 pacing
        await new Promise(r => setTimeout(r, 20));
      }

    } catch (err) {
      console.log("AI ERROR:", err.message);
    }
  });

  // =========================
  // TWILIO AUDIO → DG
  // =========================
  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.event === "start") {
        streamReady = true;
        console.log("STREAM READY");
      }

      if (data.event === "media") {
        dg.send(Buffer.from(data.media.payload, "base64"));
      }

    } catch (err) {
      console.log("WS ERROR:", err.message);
    }
  });

  ws.on("close", () => {
    dg.close();
    console.log("CALL ENDED");
  });
});

// =========================
// START
// =========================
server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING");
});
