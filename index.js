const express = require("express");
const http = require("http");

const app = express();
app.use(express.urlencoded({ extended: true }));

const ELEVEN_KEY = process.env.ELEVEN_KEY;
const VOICE_ID = process.env.VOICE_ID;

// =========================
// HEALTH
// =========================
app.get("/", (req, res) => res.send("OK"));

// =========================
// AUDIO STORAGE (TEMP)
// =========================
let lastAudio = null;

// =========================
// VOICE ROUTE
// =========================
app.all("/voice", async (req, res) => {
  console.log("/voice hit");

  // generate ElevenLabs audio
  const tts = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVEN_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: "hey — this is jack from blackline, just calling about your property",
        model_id: "eleven_turbo_v2"
      })
    }
  );

  const audioBuffer = Buffer.from(await tts.arrayBuffer());
  lastAudio = audioBuffer;

  res.type("text/xml").send(`
<Response>
  <Play>https://${req.headers.host}/audio</Play>
</Response>
  `);
});

// =========================
// AUDIO ENDPOINT
// =========================
app.get("/audio", (req, res) => {
  if (!lastAudio) {
    return res.status(404).send("No audio");
  }

  res.set({
    "Content-Type": "audio/mpeg"
  });

  res.send(lastAudio);
});

// =========================
// START
// =========================
const server = http.createServer(app);

server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING");
});
