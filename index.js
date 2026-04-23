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
// TWILIO VOICE ENTRY
// =========================
app.all("/voice", (req, res) => {
  console.log("VOICE HIT");

  res.type("text/xml").send(`
<Response>
  <Connect>
    <Stream url="wss://${req.headers.host}/media" />
  </Connect>
</Response>
  `);
});

// =========================
// WEBSOCKET SERVER
// =========================
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  console.log("CALL CONNECTED");

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.event === "start") {
        console.log("STREAM STARTED");
      }

      if (data.event === "media") {
        // 🔥 FOR NOW: just log incoming audio packets
        console.log("AUDIO RECEIVED");
      }

    } catch (err) {
      console.log("ERROR:", err);
    }
  });

  ws.on("close", () => {
    console.log("CALL ENDED");
  });
});

// =========================
// START SERVER (RAILWAY SAFE)
// =========================
server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING");
});
