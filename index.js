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
// SIP ENTRY → TWIML
// =========================
app.all("/voice", (req, res) => {
  res.type("text/xml").send(`
<Response>
  <Connect>
    <Stream url="wss://${req.headers.host}/realtime" />
  </Connect>
</Response>
  `);
});

// =========================
// WS SERVER (REALTIME)
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
// REALTIME AUDIO HANDLER
// =========================
wss.on("connection", (ws) => {
  console.log("REALTIME CONNECTED");

  let streamSid = null;

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      // 🔥 capture streamSid
      if (data.event === "start") {
        streamSid = data.streamSid;
        console.log("STREAM STARTED:", streamSid);
      }

      // 🔥 echo audio back (FIXED)
      if (data.event === "media") {
        if (ws.readyState === 1 && streamSid) {
          ws.send(JSON.stringify({
            event: "media",
            streamSid: streamSid,
            media: {
              payload: data.media.payload
            }
          }));
        }
      }

    } catch (err) {
      console.log("ERROR:", err.message);
    }
  });

  ws.on("close", () => {
    console.log("REALTIME CLOSED");
  });

  ws.on("error", (err) => {
    console.log("WS ERROR:", err.message);
  });
});

// =========================
// START SERVER
// =========================
server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING REALTIME");
});
