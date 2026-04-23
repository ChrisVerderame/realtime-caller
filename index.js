const express = require("express");

const app = express();

// health check
app.get("/", (req, res) => {
  res.send("OK");
});

// twilio test route
app.all("/voice", (req, res) => {
  res.type("text/xml").send(`
<Response>
  <Say>It works</Say>
</Response>
  `);
});

// IMPORTANT: use Railway port
const PORT = process.env.PORT || 3000;

// IMPORTANT: bind 0.0.0.0
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});
