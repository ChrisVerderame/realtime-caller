const express = require("express");
const http = require("http");
const { AccessToken } = require("livekit-server-sdk");

const app = express();

app.get("/", (req, res) => {
  res.send("LIVEKIT READY");
});

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
    room,
    canPublish: true,
    canSubscribe: true
  });

  res.json({
    token: at.toJwt(),
    url: process.env.LIVEKIT_URL,
    room
  });
});

http.createServer(app).listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("LIVEKIT TOKEN SERVER RUNNING");
});
