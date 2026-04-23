const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.urlencoded({ extended: true }));

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
// CONVERSATION HANDLER
// =========================
relayWss.on("connection", (ws) => {
  console.log("RELAY CONNECTED");

  let hasOpened = false;

  const speak = (text) => {
    ws.send(JSON.stringify({
      type: "text",
      token: text
    }));
  };

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);
      console.log("RAW:", data);

      // =========================
      // CALL START
      // =========================
      if (data.type === "prompt" && !hasOpened) {
        hasOpened = true;

        speak("Hey — this is Jack from Blackline. Did you fill out something about your property?");
        return;
      }

      // =========================
      // USER SPEECH
      // =========================
      if (data.type === "input_text") {
        const user = (data.text || "").toLowerCase();
        console.log("USER:", user);

        // 🔥 VERY SIMPLE NATURAL RESPONSES
        if (user.includes("yes")) {
          speak("Gotcha — perfect. Chris is actually the guy that handles everything in person, he'd be happy to swing by and take a look.");
        } 
        else if (user.includes("no")) {
          speak("Oh gotcha — I might have caught you at a weird time. No worries at all.");
        } 
        else if (user.includes("who") || user.includes("what")) {
          speak("Yeah — we're just local, we buy properties as-is. Nothing complicated.");
        } 
        else {
          // fallback = keeps convo flowing
          speak("Yeah I hear you — honestly we keep it pretty simple, just wanted to see if it was something you'd consider.");
        }
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
