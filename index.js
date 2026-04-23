const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.urlencoded({ extended: true }));

// =========================
// HEALTH CHECK
// =========================
app.get("/", (req, res) => {
  res.send("OK");
});

// =========================
// TWILIO VOICE ENTRY (NEW)
// =========================
app.all("/voice", (req, res) => {
  res.type("text/xml").send(`
<Response>
  <Connect>
    <ConversationRelay url="wss://${req.headers.host}/relay" />
  </Connect>
</Response>
  `);
});

// =========================
// SERVER SETUP
// =========================
const server = http.createServer(app);

// =========================
// RELAY WEBSOCKET (REAL-TIME)
// =========================
const relayWss = new WebSocket.Server({ noServer: true });

// Handle upgrade requests
server.on("upgrade", (req, socket, head) => {
  if (req.url === "/relay") {
    relayWss.handleUpgrade(req, socket, head, (ws) => {
      relayWss.emit("connection", ws, req);
    });
  }
});

// =========================
// RELAY CONNECTION HANDLER
// =========================
relayWss.on("connection", (ws) => {
  console.log("RELAY CONNECTED");

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      // =========================
      // USER SPEECH
      // =========================
      if (data.type === "input_text") {
        const userText = data.text;

        console.log("USER:", userText);

        // 🔥 TEST RESPONSE (INSTANT)
        const reply = "yeah gotcha — sounds good";

        ws.send(JSON.stringify({
          type: "response",
          text: reply
        }));
      }

    } catch (err) {
      console.log("RELAY ERROR:", err.message);
    }
  });

  ws.on("close", () => {
    console.log("RELAY CLOSED");
  });

  ws.on("error", (err) => {
    console.log("RELAY WS ERROR:", err.message);
  });
});

// =========================
// START SERVER (RAILWAY SAFE)
// =========================
server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING");
});
