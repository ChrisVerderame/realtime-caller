const express = require("express");
const http = require("http");

const app = express();
app.use(express.urlencoded({ extended: true }));

const ELEVEN_KEY = process.env.ELEVEN_KEY;
const VOICE_ID = process.env.VOICE_ID;
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

// =========================
// MEMORY (VERY SIMPLE)
// =========================
let lastAudio = null;

// =========================
// HEALTH
// =========================
app.get("/", (req, res) => res.send("OK"));

// =========================
// AI RESPONSE
// =========================
async function getAIResponse(userText) {
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
        max_tokens: 50,
        temperature: 0.9,
        system: `
You are Jack from Blackline.

Casual, human, short.
1 sentence most of the time.
Use "yeah", "honestly", "gotcha".
Do not sound scripted.
`,
        messages: [
          { role: "user", content: userText || "hello" }
        ]
      })
    });

    const data = await res.json();

    let text = "";
    for (const b of data.content || []) {
      if (b.type === "text") text += b.text;
    }

    return text.trim() || "yeah gotcha";

  } catch (err) {
    console.log("AI ERROR:", err.message);
    return "yeah gotcha";
  }
}

// =========================
// MAIN CALL FLOW
// =========================
app.all("/voice", async (req, res) => {
  console.log("/voice hit");

  const speech = req.body.SpeechResult || "";

  console.log("USER:", speech);

  const reply = await getAIResponse(speech);

  console.log("AI:", reply);

  // =========================
  // ELEVENLABS TTS
  // =========================
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

  const audioBuffer = Buffer.from(await tts.arrayBuffer());
  lastAudio = audioBuffer;

  // =========================
  // TWIML RESPONSE
  // =========================
  res.type("text/xml").send(`
<Response>
  <Play>https://${req.headers.host}/audio</Play>
  <Gather input="speech" action="/voice" method="POST" timeout="3" />
</Response>
  `);
});

// =========================
// AUDIO ENDPOINT
// =========================
app.get("/audio", (req, res) => {
  if (!lastAudio) return res.status(404).send("No audio");

  res.set({ "Content-Type": "audio/mpeg" });
  res.send(lastAudio);
});

// =========================
// START
// =========================
const server = http.createServer(app);

server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING");
});
