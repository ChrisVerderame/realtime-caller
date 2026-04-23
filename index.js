const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// REQUIRED for Twilio POST
app.use(express.urlencoded({ extended: true }));

// ✅ HEALTH CHECK (IMPORTANT)
app.get("/", (req, res) => {
  res.send("SERVER RUNNING");
});

// ✅ TWILIO ROUTE (SAFE)
app.all("/voice", (req, res) => {
  console.log("VOICE HIT");

  res.set("Content-Type", "text/xml");

  res.send(`
<Response>
  <Say>Connected</Say>
</Response>
  `);
});

// ✅ WEBSOCKET (we'll use later)
wss.on("connection", (ws) => {
  console.log("WS CONNECTED");
});

// ✅ START SERVER (RAILWAY SAFE)
server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING");
});
