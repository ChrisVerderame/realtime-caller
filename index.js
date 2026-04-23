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

  // 🧠 conversation memory
  let history = [];

  // prevent spam duplicates
  let lastSpoken = "";

  const dg = new WebSocket(
    "wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=48000",
    { headers: { Authorization: `Token ${process.env.DEEPGRAM_KEY}` } }
  );

  dg.on("message", async (msg) => {
    const data = JSON.parse(msg);

    const transcript = data.channel?.alternatives?.[0]?.transcript;
    if (!transcript) return;

    // ⚡ allow partials (faster feel)
    if (!data.is_final && transcript.length < 5) return;

    // prevent duplicate spam
    if (transcript === lastSpoken) return;
    lastSpoken = transcript;

    console.log("USER:", transcript);

    // =========================
    // ADD TO MEMORY
    // =========================
    history.push({ role: "user", content: transcript });

    // =========================
    // AI RESPONSE (IMPROVED)
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
You are Jack from Blackline following up on a form the homeowner filled out expressing interest in selling their house.

You are already mid-conversation.

Your ONLY goal is to set an appointment.

Rules:
- NEVER reintroduce yourself
- NEVER restart the conversation
- Keep responses short and natural (under 10 words when possible)
- Sound casual, human, slightly imperfect
- Move the conversation toward booking a time to talk

What you should do:
- Confirm their interest level (are they serious or just exploring)
- Ask light qualifying questions (timeline, motivation, situation)
- Guide toward setting a specific appointment time

What you should NOT do:
- Do NOT ask about price
- Do NOT ask about finances
- Do NOT interrogate or overwhelm them
- Do NOT explain the whole process

Behavior:
- If they hesitate, soften and keep it low pressure
- If they show interest, move quickly to lock a time
- If they interrupt, adapt immediately and respond to what they said
- Do not repeat yourself

End goal:
- Secure a clear appointment time and day
- Keep it smooth, quick, and conversational
`,
        messages: history.slice(-6)
      })
    });

    const aiData = await aiRes.json();
    let reply = aiData.content?.[0]?.text || "yeah";

    // ⚡ instant feel trick
    reply = "yeah—" + reply;

    console.log("AI:", reply);

    // =========================
    // SAVE AI RESPONSE TO MEMORY
    // =========================
    history.push({ role: "assistant", content: reply });

    // =========================
    // ELEVENLABS TTS
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
// START SERVER
// =========================
server.listen(process.env.PORT || 3000, () => {
  console.log("REALTIME AI SERVER RUNNING");
});
