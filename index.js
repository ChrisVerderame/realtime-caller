const express = require("express");
const http = require("http");

const app = express();
app.use(express.urlencoded({ extended: true }));

const ELEVEN_KEY = process.env.ELEVEN_KEY;
const VOICE_ID = process.env.VOICE_ID;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

// =========================
// MEMORY (simple)
// =========================
let lastAudio = null;

// =========================
// HEALTH
// =========================
app.get("/", (req, res) => res.send("OK"));

// =========================
// AI (FAST)
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
        max_tokens: 30, // 🔥 faster
        temperature: 0.8,
        system: `
You are Jack from Blackline.

Talk like a normal human.
Short responses.
1 sentence max.
Never robotic.
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
// VOICE ROUTE
// =========================
app.all("/voice", async (req, res) => {
  const speech = req.body.SpeechResult || "";

  console.log("USER:", speech);

  const reply = await getAIResponse(speech);
  console.log("AI:", reply);

  // 🔥 ElevenLabs (fastest config)
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
        model_id: "eleven_turbo_v2"
      })
    }
  );

  const buffer = Buffer.from(await tts.arrayBuffer());
  lastAudio = buffer;

  res.type("text/xml").send(`
<Response>
  <Play>https://${req.headers.host}/audio</Play>
  <Gather 
    input="speech" 
    action="/voice" 
    method="POST"
    timeout="1"
    speechTimeout="auto"
  />
</Response>
  `);
});

// =========================
// AUDIO
// =========================
app.get("/audio", (req, res) => {
  if (!lastAudio) return res.status(404).send("No audio");

  res.set({ "Content-Type": "audio/mpeg" });
  res.send(lastAudio);
});

// =========================
// START
// =========================
http.createServer(app).listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING FAST CLEAN VERSION");
});
