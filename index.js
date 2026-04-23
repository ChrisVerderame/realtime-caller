const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { AccessToken } = require("livekit-server-sdk");

const app = express();
app.use(express.static("public"));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// =========================
// TOKEN ENDPOINT
// =========================
app.get("/token", async (req, res) => {
  try {
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

  } catch (err) {
    console.error("TOKEN ERROR:", err.message);
    res.status(500).send("Token error");
  }
});

// =========================
// REALTIME AI WS
// =========================
wss.on("connection", (ws) => {
  console.log("AI WS CONNECTED");

  let history = [];
  let lastSpoken = "";
  let isThinking = false;

  const dg = new WebSocket(
    "wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=48000",
    { headers: { Authorization: `Token ${process.env.DEEPGRAM_KEY}` } }
  );

  dg.on("message", async (msg) => {
    const data = JSON.parse(msg);

    const transcript = data.channel?.alternatives?.[0]?.transcript;
    if (!transcript) return;

    // 🔥 ONLY FINAL TRANSCRIPTS (prevents spam + cutting)
    if (!data.is_final) return;

    // prevent duplicates
    if (transcript === lastSpoken) return;
    lastSpoken = transcript;

    // prevent overlapping AI responses
    if (isThinking) return;
    isThinking = true;

    console.log("USER:", transcript);

    // =========================
    // MEMORY
    // =========================
    history.push({ role: "user", content: transcript });

    try {
      // =========================
      // AI RESPONSE
      // =========================
      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_KEY,
          "content-type": "application/json",
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 15,
          temperature: 0.9,
          system: `
You are Jack from Blackline calling a homeowner who filled out a form about selling their house.

Start of call:
- Confirm they filled out the form
- Ask if they are the owner
- Verify the property address

If NOT owner:
- Apologize briefly and end call politely

If owner:
- Have a natural, low-pressure conversation

Goal:
- If it makes sense, set a quick in-person visit with Chris (the buyer)

Tone:
- Sound like a normal local person
- Casual, not salesy
- Short responses (1 sentence)

Rules:
- NEVER repeat your intro
- NEVER sound scripted
- DO NOT push
- DO NOT ask about price or finances

Appointments:
- Frame as quick visit:
  "Chris can swing by real quick"
- Keep it low pressure
`,
          messages: history.slice(-6)
        })
      });

      const aiData = await aiRes.json();
      let reply = aiData.content?.[0]?.text || "yeah";

      // small natural filler
      reply = "yeah—" + reply;

      console.log("AI:", reply);

      // save memory
      history.push({ role: "assistant", content: reply });

      // =========================
      // ELEVENLABS
      // =========================
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
            model_id: "eleven_multilingual_v2",
            voice_settings: {
              stability: 0.3,
              similarity_boost: 0.7,
              style: 0.2,
              use_speaker_boost: true
            }
          })
        }
      );

      const audio = Buffer.from(await tts.arrayBuffer());

      ws.send(audio.toString("base64"));

    } catch (err) {
      console.error("AI ERROR:", err);
    }

    // 🔥 release lock AFTER everything finishes
    isThinking = false;
  });

  ws.on("message", (msg) => {
    if (dg.readyState === 1) {
      dg.send(msg);
    }
  });

  ws.on("close", () => dg.close());
});

// =========================
// START SERVER
// =========================
server.listen(process.env.PORT || 3000, () => {
  console.log("REALTIME AI SERVER RUNNING");
});
