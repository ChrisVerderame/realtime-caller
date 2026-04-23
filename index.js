const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

// =========================
// HEALTH
// =========================
app.get("/", (req, res) => res.send("OK"));

// =========================
// SIP ENTRY (NO AUDIO HERE)
// =========================
app.all("/voice", (req, res) => {
  res.type("text/xml").send(`
<Response>
  <Dial>
    <Sip>sip:realtime@${req.headers.host}</Sip>
  </Dial>
</Response>
  `);
});

// =========================
// REALTIME WS SERVER
// =========================
const wss = new WebSocket.Server({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/realtime") {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

// =========================
// AUDIO SESSION
// =========================
wss.on("connection", (ws) => {
  console.log("REALTIME CONNECTED");

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      // Twilio sends audio here
      if (data.event === "media") {
        // 🔥 FOR NOW: ECHO BACK AUDIO
        ws.send(JSON.stringify({
          event: "media",
          media: {
            payload: data.media.payload
          }
        }));
      }

    } catch (err) {
      console.log("ERR:", err.message);
    }
  });

  ws.on("close", () => {
    console.log("REALTIME CLOSED");
  });
});

// =========================
// START
// =========================
server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING REALTIME");
});
