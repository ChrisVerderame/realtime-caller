const express = require("express");
const http = require("http");

const app = express();
app.use(express.urlencoded({ extended: true }));

// =========================
// HEALTH CHECK
// =========================
app.get("/", (req, res) => {
  res.send("OK");
});

// =========================
// SIP VOICE HANDLER
// =========================
app.all("/voice", (req, res) => {
  console.log("/voice hit");

  res.type("text/xml").send(`
<Response>
  <Say voice="Polly.Joanna">
    Hey — this is Jack from Blackline. Can you hear me alright?
  </Say>
</Response>
  `);
});

// =========================
// START SERVER
// =========================
const server = http.createServer(app);

server.listen(process.env.PORT || 3000, "0.0.0.0", () => {
  console.log("RUNNING");
});
