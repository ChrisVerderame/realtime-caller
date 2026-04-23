const express = require("express");
const http = require("http");
const { AccessToken } = require("livekit-server-sdk");

const app = express();

// =========================
// HEALTH
// =========================
app.get("/", (req, res) => {
  res.send("LIVEKIT READY");
});

// =========================
// TOKEN ENDPOINT
// =========================
app.get("/token", (req, res) => {
  const room = "call-room";

  const identity =
    req.query.identity ||
    "user-" + Math.random().toString(36).substring(7);

  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    { identity }
  );

  at.addGrant({
    roomJoin: true,
    room: room,
    canPublish: true,
    canSubscribe: true
  });

  const token = at.toJwt();

  res.json({
    token,
    url: process.env.LIVEKIT_URL,
    room
  });
});

// =========================
// START SERVER
// =========================
http
  .createServer(app)
  .listen(process.env.PORT || 3000, "0.0.0.0", () => {
    console.log("LIVEKIT TOKEN SERVER RUNNING");
  });
