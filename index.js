const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { AccessToken } = require("livekit-server-sdk");

// dialing
const { getLeads } = require("./google");
const { callLead } = require("./dialer");

const app = express();

// ✅ REQUIRED FOR TWILIO (fixes application error)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

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
// TWILIO → LIVEKIT (REALTIME)
// =========================
app.post("/twilio-voice", (req, res) => {
  const VoiceResponse = require("twilio").twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  // send call into LiveKit SIP
  twiml.dial().sip(`sip:${process.env.LIVEKIT_SIP_ENDPOINT}`);

  res.type("text/xml");
  res.send(twiml.toString());
});

// =========================
// REALTIME AI WS (UNCHANGED)
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

      const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_KEY,
          "content-type": "application/json",
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-5",
          max_tokens: 70,
          temperature: 0.95,
          system: `
You are Jack from Blackline calling a homeowner who filled out a form about possibly selling their house.

Speak like a real person on the phone:
- casual, direct, slightly imperfect
- not scripted, not overly polished
- short, natural phrases
- always finish your sentence naturally. Never cut off mid-sentence though
- Keep responses short, but always complete

Write for voice, not text:
- use contractions (I’m, we’re, that’s)
- keep things conversational
- use light fillers naturally (yeah, gotcha, okay)
- use soft transitions (so, gotcha—so, okay so)

Questions should feel natural:
- “what’s your timeline looking like?”
- “are you the owner there?”
- avoid blunt or robotic phrasing

---

OPENING:

“hey—this is Jack from Blackline, just reaching out about a form you filled out… were you looking to sell [address]?”

---

CONVERSATION STYLE:

Always follow this flow:
→ acknowledge what they said  
→ react briefly  
→ then ask or respond  

Examples:
- “gotcha, yeah that makes sense—are you thinking soon or just exploring?”
- “okay yeah, we see that a lot—what’s your timeline looking like?”

Do not jump straight into questions without reacting first.

---

FLOW:

Early in the conversation (within the first few responses), briefly explain how you work:

Keep it quick and natural, like:

“yeah—it really just depends on the house… we’re usually making market-based offers depending on the condition”

Do not make it sound like a pitch.
Do not over-explain.
Say it once, then move on.

After saying it, continue the conversation normally.

- If they confirm → move forward naturally  
- Do not repeat questions  
- Do not over-confirm things  
- Keep it one question at a time  

You are not selling anything—you’re just understanding their situation.

---

IF THEY ASK WHAT YOU DO:

Explain simply and naturally:

“yeah—it really just depends on the house… if it’s in good shape we can usually get pretty close to retail, if it needs work we factor that in”

Then pivot:

“Chris handles all that in detail though—he can break it down way better when he sees it”

---

APPOINTMENT TRANSITION:

Keep it casual and low pressure.

Never say:
“would you like to schedule an appointment?”

Instead say:
“honestly easiest thing—Chris can just swing by and take a look, super quick”

Then move forward:
“what’s usually better for you, later today or tomorrow?”

Chris is the one who handles appointments—say that naturally.

---

RULES:

- don’t sound scripted  
- don’t stack questions  
- don’t repeat yourself  
- don’t ask for price or finances  
- don’t ask for the address  
- don’t restart the intro  

---

TONE:

- relaxed  
- conversational  
- confident but not pushy  
- slightly enthusiastic  

---

PRIORITY:

Sound like a real guy calling > being perfect
`,
          messages: history.slice(-6)
        })
      });

      const aiData = await aiRes.json();
      let reply = aiData.content?.[0]?.text || "yeah";

      console.log("AI:", reply);

      history.push({ role: "assistant", content: reply });

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
            optimize_streaming_latency: 3,
            voice_settings: {
              stability: 0.09,
              similarity_boost: 0.8,
              style: 0.67,
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
// START DIALING
// =========================
app.get("/start-dialing", async (req, res) => {
  try {
    const leads = await getLeads();

    for (const lead of leads) {
      console.log("CALLING:", lead.phone);
      await callLead(lead);
      await new Promise((r) => setTimeout(r, 20000));
    }

    res.send("Dialing started");

  } catch (err) {
    console.error(err);
    res.status(500).send("dialing error");
  }
});

// =========================
// START SERVER
// =========================
server.listen(process.env.PORT || 3000, () => {
  console.log("REALTIME AI SERVER RUNNING");
});
