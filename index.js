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
// TWILIO VOICE (WITH TTS)
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
// RELAY WEBSOCKET
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

      // 🔥 HANDLE TWILIO PROMPT (START OF CALL)
      if (data.type === "prompt") {
        const reply = "Hey — this is Jack from Blackline, can you hear me alright?";

        ws.send(JSON.stringify({
          type: "text",
          token: reply
        }));
      }

      // 🔥 HANDLE USER SPEECH
      if (data.type === "input_text") {
        const userText = data.text;
        console.log("USER:", userText);

        const reply = "yeah gotcha — sounds good";

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
// START SERVER
// =========================
server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING");
});
