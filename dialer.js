const twilio = require("twilio");

const client = twilio(
  process.env.TWILIO_SID,
  process.env.TWILIO_AUTH
);

function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, "");

  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;

  return null;
}

async function callLead(lead) {
  try {
    const to = normalizePhone(lead.phone);

    if (!to) {
      console.error("Invalid phone:", lead.phone);
      return;
    }

    // 🔥 THIS is the important line
    const sip = "sips:call-room@3l6qw17ipmp.sip.livekit.cloud;transport=tls";

    console.log("CALLING:", to);
    console.log("SIP TARGET:", sip);

    await client.calls.create({
      to,
      from: process.env.TWILIO_NUMBER,

      // 👇 THIS is TwiML (just instructions)
      twiml: `
        <Response>
          <Dial>
            <Sip>${sip}</Sip>
          </Dial>
        </Response>
      `
    });

  } catch (err) {
    console.error("CALL ERROR:", err.message);
  }
}

module.exports = { callLead };
