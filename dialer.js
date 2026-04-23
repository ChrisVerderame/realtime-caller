const twilio = require("twilio");

const client = twilio(
  process.env.TWILIO_SID,
  process.env.TWILIO_AUTH
);

async function callLead(lead) {
  console.log("CALLING:", lead.phone);

  return client.calls.create({
    to: lead.phone,
    from: process.env.TWILIO_NUMBER,
    url: `${process.env.BASE_URL}/twilio-voice?name=${encodeURIComponent(
      lead.name
    )}&address=${encodeURIComponent(lead.address)}`
  });
}

module.exports = { callLead };
