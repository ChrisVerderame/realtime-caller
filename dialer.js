const client = require("twilio")(
  process.env.TWILIO_SID,
  process.env.TWILIO_AUTH
);

async function callLead(lead) {
  return client.calls.create({
    to: lead.phone,
    from: process.env.TWILIO_NUMBER,

    // 🚨 THIS IS THE FIX
    url: `sip:${process.env.LIVEKIT_SIP_ENDPOINT}`
  });
}

module.exports = { callLead };
