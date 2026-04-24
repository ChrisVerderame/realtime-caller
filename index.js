const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { AccessToken } = require("livekit-server-sdk");
const twilio = require("twilio");

// ---- SAFE FETCH (no node-fetch crash) ----
let fetchSafe = global.fetch;
if (!fetchSafe) {
  // minimal fallback using https
  const https = require("https");
  fetchSafe = (url, options = {}) =>
    new Promise((resolve, reject) => {
      const u = new URL(url);
      const req = https.request(
        {
          hostname: u.hostname,
          path: u.pathname + u.search,
          method: options.method || "GET",
          headers: options.headers || {},
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const body = Buffer.concat(chunks);
            resolve({
              ok: res.statusCode >= 200 && res.statusCode < 300,
              status: res.statusCode,
              json: async () => JSON.parse(body.toString()),
              arrayBuffer: async () => body,
              text: async () => body.toString(),
            });
          });
        }
      );
      req.on("error", reject);
      if (options.body) req.write(options.body);
      req.end();
    });
}

const app = express();
app.use(express.static("public"));
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ---- TWILIO ----
const client = twilio(
  process.env.TWILIO_SID,
  process.env.TWILIO_AUTH
);

// ---- UI ----
app.get("/", (req, res) => {
  res.send(`
    <html>
      <body style="font-family:sans-serif;padding:40px;">
        <h2>AI Caller</h2>
        <input id="phone" placeholder="+1203..." style="padding:10px;width:250px;" />
        <br><br>
        <button onclick="callLead()">Call Lead</button>
        <script>
          async function callLead() {
            const phone = document.getElementById("phone").value;
            await fetch("/call", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ phone })
            });
            alert("Calling " + phone);
          }
        </script>
      </body>
    </html>
  `);
});
 
// ---- CALL ----
app.post("/call", async (req, res) => {
  try {
    let { phone } = req.body;
    if (!phone) return res.status(400).send("no phone");

    const digits = String(phone).replace(/\D/g, "");
    if (digits.length === 10) phone = "+1" + digits;
    if (digits.length === 11 && digits.startsWith("1")) phone = "+" + digits;

    console.log("📞 CALLING:", phone);

    await client.calls.create({
  to: phone,
  from: process.env.TWILIO_NUMBER,
  twiml: `
    <Response>
      <Dial answerOnBridge="true">
        <Sip>sip:${process.env.LIVEKIT_SIP_ENDPOINT}?room=call-room</Sip>
      </Dial>
    </Response>
  `
});

    res.send("calling");
  } catch (err) {
    console.error("CALL ERROR:", err);
    res.status(500).send("call failed");
  }
});

// ---- TOKEN ----
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
      canSubscribe: true,
    });

    const token = await at.toJwt();

    res.json({
      token,
      url: process.env.LIVEKIT_URL,
      room,
    });
  } catch (err) {
    console.error("TOKEN ERROR:", err.message);
    res.status(500).send("Token error");
  }
});

// ---- REALTIME AI ----
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

      const aiRes = await fetchSafe("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_KEY,
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
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

OPENING:
“hey—this is Jack from Blackline, just reaching out about a form you filled out… were you looking to sell [address]?”

TONE:
natural, relaxed, confident
          `,
          messages: history.slice(-6),
        }),
      });

      const aiData = await aiRes.json();
      let reply = aiData.content?.[0]?.text || "yeah";

      console.log("AI:", reply);
      history.push({ role: "assistant", content: reply });

      const ttsRes = await fetchSafe(
        `https://api.elevenlabs.io/v1/text-to-speech/${process.env.VOICE_ID}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": process.env.ELEVEN_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: reply,
            model_id: "eleven_multilingual_v2",
            optimize_streaming_latency: 3,
          }),
        }
      );

      const buffer = Buffer.from(await ttsRes.arrayBuffer());
      ws.send(buffer.toString("base64"));
    } catch (err) {
      console.error("PROCESS ERROR:", err);
    } finally {
      isThinking = false;
    }
  });

  ws.on("message", (msg) => {
    if (dg.readyState === 1) dg.send(msg);
  });

  ws.on("close", () => dg.close());
});

// ---- START ----
server.listen(process.env.PORT || 3000, () => {
  console.log("REALTIME AI SERVER RUNNING");
});
