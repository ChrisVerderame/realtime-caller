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
        system: `
You are Jack from Blackline.

Casual, fast, human.
1 sentence replies.
Never sound scripted.
`,
        messages: [{ role: "user", content: text }]
      })
    });

    const data = await res.json();

    let output = "";
    for (const b of data.content || []) {
      if (b.type === "text") output += b.text;
    }

    return output.trim() || "yeah gotcha";

  } catch (err) {
    console.log("AI ERROR:", err.message);
    return "yeah gotcha";
  }
}

// =========================
// REALTIME HANDLER
// =========================
wss.on("connection", (ws) => {
  console.log("REALTIME CONNECTED");

  let streamSid = null;

  // =========================
  // DEEPGRAM (LIVE STT)
  // =========================
  const dg = new WebSocket(
    "wss://api.deepgram.com/v1/listen?encoding=mulaw&sample_rate=8000",
    { headers: { Authorization: `Token ${DEEPGRAM_KEY}` } }
  );

  dg.on("open", () => console.log("DG CONNECTED"));

  dg.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg);

      if (!data.is_final) return;

      const transcript = data.channel?.alternatives?.[0]?.transcript;
      if (!transcript) return;

      console.log("USER:", transcript);

      const reply = await getAIResponse(transcript);
      console.log("AI:", reply);

      // =========================
      // ELEVENLABS (BUFFERED FIX)
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

      const audioBuffer = Buffer.from(await tts.arrayBuffer());

      const chunkSize = 320;

      for (let i = 0; i < audioBuffer.length; i += chunkSize) {
        if (ws.readyState !== 1 || !streamSid) break;

        const chunk = audioBuffer.slice(i, i + chunkSize);

        ws.send(JSON.stringify({
          event: "media",
          streamSid,
          media: {
            payload: chunk.toString("base64")
          }
        }));

        // 20ms pacing
        await new Promise(r => setTimeout(r, 20));
      }

    } catch (err) {
      console.log("DG ERROR:", err.message);
    }
  });

  // =========================
  // TWILIO AUDIO → DEEPGRAM
  // =========================
  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.event === "start") {
        streamSid = data.streamSid;
        console.log("STREAM STARTED:", streamSid);
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
    console.log("REALTIME CLOSED");
  });

  ws.on("error", (err) => {
    console.log("WS ERROR:", err.message);
  });
});

// =========================
// START
// =========================
server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING REALTIME AI");
});
