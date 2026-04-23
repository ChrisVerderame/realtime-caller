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

  res.json({
    token: await at.toJwt(),
    url: process.env.LIVEKIT_URL,
    room
  });
});

// =========================
// WS
// =========================
wss.on("connection", (ws) => {
  console.log("AI WS CONNECTED");

  let history = [];
  let isThinking = false;
  let lastResponseTime = 0;

  // 🧠 CALL STATE
  let stage = "intro"; // intro → owner → address → conversation
  let introDone = false;
  let lastTranscript = "";

  const dg = new WebSocket(
    "wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=48000",
    { headers: { Authorization: `Token ${process.env.DEEPGRAM_KEY}` } }
  );

  dg.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg);
      let transcript = data.channel?.alternatives?.[0]?.transcript;
      if (!transcript) return;

      if (!data.is_final) return;

      // 🔥 normalize transcript (prevents duplicates)
      transcript = transcript.toLowerCase().trim();

      if (transcript === lastTranscript) return;
      lastTranscript = transcript;

      const now = Date.now();
      if (now - lastResponseTime < 1200) return;
      lastResponseTime = now;

      if (isThinking) return;
      isThinking = true;

      console.log("USER:", transcript);

      history.push({ role: "user", content: transcript });

      // =========================
      // STAGE CONTROL
      // =========================
      if (!introDone) {
        introDone = true;
      }

      // move stages based on convo
      if (stage === "intro") stage = "owner";
      else if (stage === "owner") stage = "address";
      else if (stage === "address") stage = "conversation";

      // =========================
      // AI
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
          max_tokens: 60,
          temperature: 0.9,
          system: `
You are Jack from Blackline calling a homeowner who filled out a form about possibly selling their house.

This is the first time you're speaking to them.

Speak like a normal person:
- casual
- direct
- not overly structured
- not robotic

Opening:
- Keep it simple and natural

Example style:
"hey—this is Manny from Blackline, just reaching out about a form you filled out… were you looking to sell [address]?"

Do NOT:
- stack multiple confirmations
- ask things in a rigid sequence
- sound like you're checking boxes

Flow:
- Ask naturally, not formally
- If they confirm, move forward immediately
- Do NOT re-ask something they already answered

If wrong person:
- apologize quickly and end call

If correct:
- have a normal conversation

Goal:
- if it makes sense, set a quick in-person visit with Chris (the buyer)

Tone:
- relaxed
- conversational
- low pressure

Important:
- one question at a time
- don’t over-explain
- don’t repeat yourself
- don’t restart the intro

Speak like:
- a guy following up
NOT
- a company verifying information

Current stage: ${stage}
Intro already done: ${introDone}
`,
          messages: history.slice(-6)
        })
      });

      const aiData = await aiRes.json();
      let reply = aiData.content?.[0]?.text || "okay";

      console.log("AI:", reply);

      history.push({ role: "assistant", content: reply });

      // =========================
      // TTS
      // =========================
      const ttsRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${process.env.VOICE_ID}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": process.env.ELEVEN_KEY,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            text: reply,
            model_id: "eleven_multilingual_v2",
            optimize_streaming_latency: 0,
            voice_settings: {
              stability: 0.25,
              similarity_boost: 0.75,
              style: 0.4,
              use_speaker_boost: true
            }
          })
        }
      );

      const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());

      ws.send(audioBuffer.toString("base64"));

    } catch (err) {
      console.error(err);
    } finally {
      isThinking = false;
    }
  });

  ws.on("message", (msg) => {
    if (dg.readyState === 1) dg.send(msg);
  });

  ws.on("close", () => dg.close());
});

server.listen(process.env.PORT || 3000, () => {
  console.log("SERVER RUNNING");
});
