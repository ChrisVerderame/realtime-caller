const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { AccessToken } = require("livekit-server-sdk");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static("public"));

// =========================
// TOKEN ENDPOINT
// =========================
app.get("/token", async (req, res) => {
  try {
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
  } catch (err) {
    console.error("TOKEN ERROR:", err.message);
    res.status(500).send("Token error");
  }
});

// =========================
// TWILIO VOICE WEBHOOK
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
// WEBSOCKET (TWILIO MEDIA)
// =========================
wss.on("connection", (ws) => {
  console.log("TWILIO CONNECTED");

  let streamSid = null;

  const dg = new WebSocket(
    "wss://api.deepgram.com/v1/listen?encoding=mulaw&sample_rate=8000",
    { headers: { Authorization: `Token ${process.env.DEEPGRAM_KEY}` } }
  );

  dg.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg);
      const transcript = data.channel?.alternatives?.[0]?.transcript;

      if (!transcript || !data.is_final) return;

      console.log("USER:", transcript);

      // Claude
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
          messages: [{ role: "user", content: transcript }]
        })
      });

      const aiData = await aiRes.json();
      const reply = aiData.content?.[0]?.text || "yeah";

      console.log("AI:", reply);

      // ElevenLabs TTS
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

      const audioBuffer = Buffer.from(await tts.arrayBuffer());

      // Send back to Twilio
      ws.send(JSON.stringify({
        event: "media",
        streamSid,
        media: {
          payload: audioBuffer.toString("base64")
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
// GOOGLE SHEETS + DIALER
// =========================
const { getLeads } = require("./google");
const { callLead } = require("./dialer");

app.get("/test-leads", async (req, res) => {
  try {
    const leads = await getLeads();
    res.json(leads);
  } catch (err) {
    console.error(err);
    res.status(500).send("error fetching leads");
  }
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
