const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.urlencoded({ extended: true }));

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;

// =========================
// HEALTH
// =========================
app.get("/", (req, res) => {
  res.send("OK");
});

// =========================
// TWILIO VOICE
// =========================
app.all("/voice", (req, res) => {
  res.type("text/xml").send(`
<Response>
  <Connect>
    <ConversationRelay 
      url="wss://${req.headers.host}/relay"
      ttsProvider="google"
      voice="en-US-Neural2-J"
    />
  </Connect>
</Response>
  `);
});

const server = http.createServer(app);

// =========================
// RELAY WS
// =========================
const relayWss = new WebSocket.Server({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/relay") {
    relayWss.handleUpgrade(req, socket, head, (ws) => {
      relayWss.emit("connection", ws, req);
    });
  }
});

// =========================
// AI
// =========================
async function getAIResponse(history) {
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

You are on a real phone call.

TONE:
- casual
- slightly messy
- not polished
- not scripted

STYLE:
- 1 sentence most of the time
- sometimes no question
- sometimes just react
- use fillers: "yeah", "honestly", "gotcha"

RULES:
- NEVER sound like customer service
- NEVER explain too much
- NEVER repeat phrasing
- DON'T be overly helpful

GOAL:
- keep it relaxed
- move toward Chris seeing the property
`,
        messages: history
      })
    });

    const data = await res.json();

    let text = "";
    if (data?.content) {
      for (const b of data.content) {
        if (b.type === "text") text += b.text;
      }
    }

    return text.trim() || "yeah gotcha";
  } catch (err) {
    return "yeah gotcha — makes sense";
  }
}

// =========================
// CONVO
// =========================
relayWss.on("connection", (ws) => {
  console.log("RELAY CONNECTED");

  let history = [];
  let started = false;

  const speak = (text) => {
    ws.send(JSON.stringify({
      type: "text",
      token: text
    }));
  };

  ws.on("message", async (msg) => {
    try {
      const data = JSON.parse(msg);

      // FIRST LINE
      if (data.type === "prompt" && !started) {
        started = true;

        const opening = "hey — this is jack from blackline, did you fill out a form trying to sell your house?";
        history.push({ role: "assistant", content: opening });
        speak(opening);
        return;
      }

      // USER TALKING
      if (data.type === "prompt" && started) {
        const userText = data.voicePrompt || "";

        history.push({ role: "user", content: userText });

        const reply = await getAIResponse(history);

        history.push({ role: "assistant", content: reply });

        speak(reply);
      }

    } catch (err) {
      console.log("ERR:", err.message);
    }
  });
});

// =========================
// START
// =========================
server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING");
});
