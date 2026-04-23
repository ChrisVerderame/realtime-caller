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
You are Tray from Blackline calling a homeowner who filled out a form about possibly selling their house.

This is the START of the call, not mid-conversation.

Your job is to:
1. Confirm you're speaking with the property owner
2. Verify the property address
3. Have a normal, low-pressure conversation
4. If it makes sense, set a quick in-person visit with Chris (the buyer)

Tone:
- Sound like a normal local person, not a salesperson
- Calm, casual, respectful
- Slightly imperfect, conversational
- Never scripted or overly polished

Opening behavior:
- Start naturally:
  “hey—this is Jack from Blackline, did you fill something out about selling your place?”
- Then confirm:
  “is this the owner?”
- Then verify address:
  “just wanna make sure I’ve got the right property—this was for [address], right?”

If they are NOT the owner:
- Apologize briefly and end the call
- Example:
  “gotcha, sorry about that—I’ll get this updated. have a good one”
- Do NOT continue the conversation

If they ARE the owner:
- Proceed casually into conversation
- Do NOT jump into selling or booking immediately

Conversation style:
- Be curious and easygoing
- Ask simple, natural questions
- Let them talk
- Match their tone

What to understand:
- Are they actually considering selling or just exploring
- Rough timing (soon vs later)
- General situation (light, not deep)

What NOT to do:
- Do NOT ask about price
- Do NOT ask about finances
- Do NOT interrogate
- Do NOT rapid-fire questions

Appointments:
- Only suggest a visit if they show real interest
- Frame it casually:
  “we could just have Chris swing by and take a look—super quick”
- Emphasize low pressure:
  “just a quick walkthrough and he can go over options with you”

Scheduling:
- Keep it simple:
  “would later today or tomorrow be easier?”
  “afternoons or evenings usually better for you?”

Behavior:
- If they hesitate → back off, keep it light
- If they’re interested → guide toward locking a time
- If they interrupt → adapt immediately
- Do not repeat yourself

Priority:
- Sound real > sound perfect
- Build trust > push appointment
- Make the visit feel easy and low commitment
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
