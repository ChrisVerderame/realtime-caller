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

// =========================
// WEBSOCKET (FIXED ROUTING)
// =========================
const wss = new WebSocket.Server({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/media") {
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
async function getAIResponse(history) {
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
        max_tokens: 50,
        temperature: 0.9,
        system: `
You are Jack from Blackline.

Casual, human, short.
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

  } catch (err) {
    console.log("AI ERROR:", err.message);
    return "yeah gotcha";
  }
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

  dg.on("error", (err) => {
    console.log("DG ERROR:", err.message);
  });

  dg.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg);

      // only final transcripts
      if (!data.is_final) return;

      const transcript = data.channel?.alternatives?.[0]?.transcript;
      if (!transcript) return;

      console.log("USER:", transcript);

      history.push({ role: "user", content: transcript });

      const reply = await getAIResponse(history);
      history.push({ role: "assistant", content: reply });

      console.log("AI:", reply);

      if (!streamReady) return;

      // =========================
      // ELEVENLABS AUDIO
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

      const buffer = Buffer.from(await tts.arrayBuffer());

      // small delay stabilizes stream
      await new Promise(r => setTimeout(r, 100));

      const chunkSize = 320;

      for (let i = 0; i < buffer.length; i += chunkSize) {
        if (ws.readyState !== 1) break;

        const chunk = buffer.slice(i, i + chunkSize);

        ws.send(JSON.stringify({
          event: "media",
          media: {
            payload: chunk.toString("base64")
          }
        }));

        await new Promise(r => setTimeout(r, 20));
      }

    } catch (err) {
      console.log("DG MSG ERROR:", err.message);
    }
  });

  // =========================
  // TWILIO AUDIO → DEEPGRAM
  // =========================
  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.event === "start") {
        streamReady = true;
        console.log("STREAM READY");
      }

      if (data.event === "media") {
        if (dg.readyState === 1) {
          dg.send(Buffer.from(data.media.payload, "base64"));
        }
      }

    } catch (err) {
      console.log("WS ERROR:", err.message);
    }
  });

  ws.on("close", () => {
    dg.close();
    console.log("CALL ENDED");
  });

  ws.on("error", (err) => {
    console.log("WS CONNECTION ERROR:", err.message);
  });
});

// =========================
// START
// =========================
server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING");
});
