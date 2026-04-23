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
app.get("/token", async (req, res) => {
  try {
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
      room,
      canPublish: true,
      canSubscribe: true
    });

    // 🔥 IMPORTANT FIX
    const token = await at.toJwt();

    res.json({
      token,
      url: process.env.LIVEKIT_URL,
      room
    });

  } catch (err) {
    console.error("TOKEN ERROR:", err.message);
    res.status(500).send("Token generation failed");
  }
});

// =========================
// START SERVER
// =========================
http
  .createServer(app)
  .listen(process.env.PORT || 3000, "0.0.0.0", () => {
    console.log("LIVEKIT TOKEN SERVER RUNNING");
  });
