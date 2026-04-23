const express = require("express");
const http = require("http");

const app = express();
app.use(express.urlencoded({ extended: true }));

const ELEVEN_KEY = process.env.ELEVEN_KEY;
const VOICE_ID = process.env.VOICE_ID;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

let lastAudio = null;

// =========================
// HEALTH
// =========================
app.get("/", (req, res) => res.send("OK"));

// =========================
// AI (FASTER)
// =========================
async function getAIResponse(text) {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "content-type": "application/json",
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 25, // 🔥 faster
        temperature: 0.8,
        system: `
You are Jack from Blackline.

Casual, quick, human.
1 sentence max.
`,
        messages: [{ role: "user", content: text || "hello" }]
      })
    });

    const data = await res.json();

    let output = "";
    for (const b of data.content || []) {
      if (b.type === "text") output += b.text;
    }

    return output.trim() || "yeah gotcha";

  } catch {
    return "yeah gotcha";
  }
}

// =========================
// VOICE LOOP
// =========================
app.all("/voice", async (req, res) => {
  const speech = req.body.SpeechResult || "";

  console.log("USER:", speech);

  const reply = await getAIResponse(speech);
  console.log("AI:", reply);

  const tts = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": ELEVEN_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: reply,
        model_id: "eleven_multilingual_v2",
        voice_settings: {
          stability: 0.4,
          similarity_boost: 0.8
        }
      })
    }
  );

  const buffer = Buffer.from(await tts.arrayBuffer());
  lastAudio = buffer;

  const audioUrl = `https://${req.headers.host}/audio?ts=${Date.now()}`;

  res.type("text/xml").send(`
<Response>
  <Play>${audioUrl}</Play>

  <Gather 
    input="speech"
    action="/voice"
    method="POST"
    timeout="2"
    speechTimeout="auto"
  />

  <!-- 🔥 THIS KEEPS CALL ALIVE -->
  <Redirect>/voice</Redirect>
</Response>
  `);
});

// =========================
// AUDIO
// =========================
app.get("/audio", (req, res) => {
  if (!lastAudio) return res.status(404).send("No audio");

  res.set({
    "Content-Type": "audio/mpeg",
    "Content-Length": lastAudio.length,
    "Cache-Control": "no-cache, no-store, must-revalidate"
  });

  res.end(lastAudio);
});

// =========================
// START
// =========================
http.createServer(app).listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING STABLE LOOP");
});
