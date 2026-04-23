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
  let lastTranscript = "";
  let isThinking = false;
  let lastResponseTime = 0;

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

      transcript = transcript.toLowerCase().trim();

      if (transcript === lastTranscript) return;
      lastTranscript = transcript;

      const now = Date.now();
      if (now - lastResponseTime < 1000) return;
      lastResponseTime = now;

      if (isThinking) return;
      isThinking = true;

      console.log("USER:", transcript);

      history.push({ role: "user", content: transcript });

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
          max_tokens: 40,
          temperature: 0.95,
          system: `
You are Jack from Blackline calling a homeowner who filled out a form about possibly selling their house.

Speak for voice, never for text.

- Use contractions (I’m, we’re, that’s)
- Use short, natural phrases (5–12 words)
- It’s okay to be slightly messy

Questions must SOUND like questions:
- add softeners: “like”, “usually”, “looking like”
- examples:
  - “what’s your timeline?” → “what’s your timeline looking like?”
  - “are you the owner?” → “are you the owner there?”

Use light fillers naturally:
- “yeah”, “gotcha”, “okay”, “makes sense”

Use soft transitions:
- “so”, “gotcha—so”, “okay so”

Avoid:
- formal phrasing
- perfectly structured sentences

Speak like a real person:
- casual
- quick
- slightly imperfect
- not scripted

Opening:
"hey—this is Manny from Blackline, just reaching out about a form you filled out… were you looking to sell [address]?"

Conversation style:
- react FIRST, then respond
- acknowledge naturally:
  "gotcha"
  "yeah that makes sense"
  "okay I hear you"

  Always react to what they said before asking anything.

Pattern:
[acknowledge] → [brief comment] → [next question]

Examples:
User: “just exploring”
AI: “gotcha, yeah that makes sense—are you thinking sometime soon or just seeing what’s out there?”

User: “needs a lot of work”
AI: “okay yeah, we see that all the time—what kind of timeline are you on with it?”

Do NOT:
- stack questions
- over-confirm things
- sound robotic
- repeat yourself
- ask for the address
- ask how much they want to sell for

Flow:
- if they confirm → move forward naturally
- don’t re-ask things already answered

Positioning:
- you're just figuring out their situation
- not selling anything

Explain naturally:
"yeah—we do buy houses, we just don’t throw numbers out over the phone… wouldn’t really be fair if something’s off in person"

If they ask what you do or how it works:

Explain it simply and naturally:

- We buy houses
- The way we buy depends on their situation
- For nicer houses that don’t need much work, we can be closer to retail value
- For houses that need work, the offer reflects condition and market value

Speak casually, like a real person:
"yeah—it really just depends on the house… if it’s in good shape we can usually get pretty close to retail, if it needs work we factor that in"

Then ALWAYS pivot:

When moving to an appointment:

- keep it casual and assumptive
- don’t “ask for permission” too formally

Bad:
“would you like to schedule an appointment?”

Good:
“honestly easiest thing—Chris can just swing by and take a look, super quick”

Then:
“what’s usually better for you, later today or tomorrow?”

- Chris is the one who handles that in detail
- Keep it natural:
  "Chris can break all that down way better when he sees it"

Then move toward appointment:
- "he can swing by and take a look real quick"
- "what’s usually better for you, later today or tomorrow?"

Appointments:
- Chris handles appointments
- say naturally:
  "Chris can swing by real quick"
  "he handles that side"

Numbers:
- speak naturally
- NEVER say "dot"
- say "10.10" as "ten ten"

Tone:
- relaxed
- conversational
- low pressure
- enthusiastic

Important:
- respond to what they said first
- then guide conversation
`,
          messages: history.slice(-6)
        })
      });

      const aiData = await aiRes.json();
      let reply = aiData.content?.[0]?.text || "yeah";

      console.log("AI:", reply);

      history.push({ role: "assistant", content: reply });

      // =========================
      // ELEVENLABS (FAST + HUMAN)
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
              stability: 0.10,
              similarity_boost: 0.8,
              style: 0.7,
              use_speaker_boost: true
            }
          })
        }
      );

      const arrayBuffer = await ttsRes.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);

      ws.send(audioBuffer.toString("base64"));

    } catch (err) {
      console.error("PROCESS ERROR:", err);
    } finally {
      isThinking = false;
    }
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
