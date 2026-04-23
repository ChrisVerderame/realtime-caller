const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { spawn } = require("child_process");
const { AccessToken } = require("livekit-server-sdk");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static("public"));

// =========================
// TOKEN
// =========================
app.get("/token", async (req, res) => {
  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    { identity: "caller" }
  );

  at.addGrant({
    roomJoin: true,
    room: "call-room",
    canPublish: true,
    canSubscribe: true
  });

  res.json({
    token: await at.toJwt(),
    url: process.env.LIVEKIT_URL,
    room: "call-room"
  });
});

// =========================
// TWILIO WEBHOOK
// =========================
app.post("/twilio-voice", (req, res) => {
  const VoiceResponse = require("twilio").twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  const wsUrl = process.env.BASE_URL.replace("https", "wss");

  twiml.connect().stream({
    url: `${wsUrl}/`,
  });

  res.type("text/xml");
  res.send(twiml.toString());
});

// =========================
// AUDIO CONVERSION
// =========================
function convertToMulaw(buffer) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-i", "pipe:0",
      "-ar", "8000",
      "-ac", "1",
      "-f", "mulaw",
      "pipe:1"
    ]);

    let output = Buffer.alloc(0);

    ffmpeg.stdout.on("data", (chunk) => {
      output = Buffer.concat([output, chunk]);
    });

    ffmpeg.on("close", () => resolve(output));
    ffmpeg.on("error", reject);

    ffmpeg.stdin.write(buffer);
    ffmpeg.stdin.end();
  });
}

// =========================
// WEBSOCKET (CALL ENGINE)
// =========================
wss.on("connection", (ws) => {
  console.log("TWILIO CONNECTED");

  let streamSid = null;
  let history = [];
  let lastReplyTime = 0;

  const dg = new WebSocket(
    "wss://api.deepgram.com/v1/listen?encoding=mulaw&sample_rate=8000",
    { headers: { Authorization: `Token ${process.env.DEEPGRAM_KEY}` } }
  );

  dg.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg);
      const transcript = data.channel?.alternatives?.[0]?.transcript;

      if (!transcript) return;

      // debounce (prevents spam replies)
      const now = Date.now();
      if (now - lastReplyTime < 1200) return;
      lastReplyTime = now;

      console.log("USER:", transcript);

      history.push({ role: "user", content: transcript });

      // =========================
      // CLAUDE (YOUR REAL PROMPT BACK)
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
          max_tokens: 50,
          temperature: 0.9,
          system: `
You are Jack from Blackline calling a homeowner who filled out a form about possibly selling their house.

Speak like a real person on the phone:
- casual, direct, slightly imperfect
- short, natural phrases
- not scripted or robotic

Conversation style:
- acknowledge what they said
- react briefly
- then respond or ask

Examples:
- “gotcha, yeah that makes sense—are you thinking soon or just exploring?”
- “okay yeah, we see that a lot—what’s your timeline looking like?”

Early on, briefly explain:
“yeah—it really just depends on the house… we usually make market-based offers depending on condition”

Appointment transition:
“honestly easiest thing—Chris can just swing by and take a look, super quick”

Tone:
- relaxed
- conversational
- confident
`,
          messages: history.slice(-6)
        })
      });

      const aiData = await aiRes.json();
      const reply = aiData.content?.[0]?.text || "yeah";

      console.log("AI:", reply);

      history.push({ role: "assistant", content: reply });

      // =========================
      // ELEVENLABS (FAST)
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
            optimize_streaming_latency: 3
          })
        }
      );

      const audioBuffer = Buffer.from(await tts.arrayBuffer());
      const mulawAudio = await convertToMulaw(audioBuffer);

      ws.send(JSON.stringify({
        event: "media",
        streamSid,
        media: {
          payload: mulawAudio.toString("base64")
        }
      }));

    } catch (err) {
      console.error("AI ERROR:", err);
    }
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.event === "start") {
        streamSid = data.start.streamSid;
      }

      if (data.event === "media") {
        const audio = Buffer.from(data.media.payload, "base64");
        dg.send(audio);
      }

    } catch (err) {
      console.error("WS ERROR:", err.message);
    }
  });
});

// =========================
// GOOGLE + DIALER
// =========================
const { getLeads } = require("./google");
const { callLead } = require("./dialer");

app.get("/test-leads", async (req, res) => {
  const leads = await getLeads();
  res.json(leads);
});

app.get("/start-dialing", async (req, res) => {
  const leads = await getLeads();

  for (const lead of leads) {
    await callLead(lead);
    await new Promise((r) => setTimeout(r, 20000));
  }

  res.send("Dialing started");
});

// =========================
// START SERVER
// =========================
server.listen(process.env.PORT || 3000, () => {
  console.log("AI CALLER RUNNING");
});
