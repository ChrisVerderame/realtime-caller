const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.urlencoded({ extended: true }));

// =========================
// TWILIO WEBHOOK
// =========================
app.post("/voice", (req, res) => {
  res.type("text/xml").send(`
<Response>
  <Connect>
    <Stream url="wss://${req.headers.host}/media" />
  </Connect>
</Response>
  `);
});

// =========================
// WEBSOCKET HANDLER
// =========================
wss.on("connection", (ws) => {
  console.log("CALL CONNECTED");

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.event === "start") {
        console.log("STREAM STARTED");
      }

      if (data.event === "media") {
        // 🔥 FOR NOW: just respond instantly (no AI yet)
        const reply = "Hey — just testing the real time connection";

        ws.send(JSON.stringify({
          event: "media",
          media: {
            payload: Buffer.from(reply).toString("base64")
          }
        }));
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
// START SERVER
// =========================
server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING");
});
