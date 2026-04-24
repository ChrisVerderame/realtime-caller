const twilio = require("twilio");

const client = twilio(
  process.env.TWILIO_SID,
  process.env.TWILIO_AUTH
);

async function callLead(phone) {
  const call = await client.calls.create({
    to: phone,
    from: process.env.TWILIO_NUMBER,
    twiml: `
      <Response>
        <Dial>
          <Sip>sip:${process.env.LIVEKIT_SIP_ENDPOINT}</Sip>
        </Dial>
      </Response>
    `
  });

  console.log("CALL SID:", call.sid);
}

module.exports = { callLead };
