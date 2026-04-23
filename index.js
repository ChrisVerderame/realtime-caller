const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { AccessToken } = require("livekit-server-sdk");

const app = express();
app.use(express.static("public"));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// =========================
// TOKEN
// =========================
app.get("/token", async (req, res) => {
  const room = "call-room";

  const identity =
    req.query.identity ||
    "user-" + Math.random().toString(36).substring(7);

  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    { identity }
  );

  at.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canSubscribe: true
  });

  const token = await at.toJwt();

  res.json({
    token,
    url: process.env.LIVEKIT_URL,
    room
  });
});

// =========================
// REALTIME AI WS
// =========================
wss.on("connection", (ws) => {
  console.log("AI WS CONNECTED");

  const dg = new WebSocket(
    "wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=48000",
    { headers: { Authorization: `Token ${process.env.DEEPGRAM_KEY}` } }
  );

  dg.on("message", async (msg) => {
    const data = JSON.parse(msg);

    if (!data.is_final) return;

    const text = data.channel?.alternatives?.[0]?.transcript;
    if (!text) return;

    console.log("USER:", text);

    // 🔥 AI RESPONSE
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_KEY,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 20,
        messages: [{ role: "user", content: text }]
      })
    });

    const aiData = await aiRes.json();
    const reply = aiData.content?.[0]?.text || "yeah";

    console.log("AI:", reply);

    // 🔥 ELEVENLABS
    const tts = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${process.env.VOICE_ID}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVEN_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          text: reply,
          model_id: "eleven_multilingual_v2"
        })
      }
    );

    const audio = Buffer.from(await tts.arrayBuffer());

    // send back to browser
    ws.send(audio.toString("base64"));
  });

  ws.on("message", (msg) => {
    if (dg.readyState === 1) {
      dg.send(msg);
    }
  });

  ws.on("close", () => dg.close());
});

// =========================
server.listen(process.env.PORT || 3000, () => {
  console.log("REALTIME AI SERVER RUNNING");
});
