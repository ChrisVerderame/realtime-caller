const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.urlencoded({ extended: true }));

// =========================
// ENV
// =========================
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
// AI CALL FUNCTION
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
        max_tokens: 80,
        temperature: 0.7,
        system: `
You are Jack from Blackline Acquisitions.

You are calling about a property the person submitted.

STYLE:
- casual
- human
- slightly imperfect
- NOT robotic
- short responses (1–2 sentences max)

RULES:
- never ask for address
- never ask about mortgage or price
- don't interrogate
- react naturally like a human

GOAL:
- build light rapport
- move toward setting up Chris to see the property

IMPORTANT:
- don't repeat yourself
- don't sound scripted
- sometimes just react without asking a question
`,
        messages: history
      })
    });

    const data = await res.json();

    let text = "";
    if (data?.content) {
      for (const block of data.content) {
        if (block.type === "text") text += block.text;
      }
    }

    return text.trim();

  } catch (err) {
    console.log("AI ERROR:", err.message);
    return "yeah gotcha — that makes sense";
  }
}

// =========================
// CONVERSATION
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
      console.log("RAW:", data);

      // =========================
      // START CALL
      // =========================
      if (data.type === "prompt" && !started) {
        started = true;

        const opening = "Hey — this is Jack from Blackline. Did you fill something out about your property?";
        
        history.push({ role: "assistant", content: opening });
        speak(opening);
        return;
      }

      // =========================
      // USER SPEECH
      // =========================
      if (data.type === "prompt" && started) {
        const userText = data.voicePrompt || "";
        console.log("USER:", userText);

        history.push({ role: "user", content: userText });

        const aiReply = await getAIResponse(history);

        history.push({ role: "assistant", content: aiReply });

        speak(aiReply);
      }

    } catch (err) {
      console.log("ERROR:", err.message);
    }
  });

  ws.on("close", () => {
    console.log("RELAY CLOSED");
  });
});

// =========================
// START
// =========================
server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING");
});
