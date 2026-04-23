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
    <ConversationRelay url="wss://${req.headers.host}/relay" />
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
// RELAY HANDLER
// =========================
relayWss.on("connection", (ws) => {
  console.log("RELAY CONNECTED");

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      console.log("RAW:", data);

      // 🔥 ConversationRelay sends speech like this
      if (data.type === "input_text") {
        const userText = data.text;

        console.log("USER:", userText);

        const reply = "yeah gotcha — sounds good";

        // 🔥 CORRECT FORMAT
        ws.send(JSON.stringify({
          type: "text",
          token: reply
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
// START
// =========================
server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING");
});
