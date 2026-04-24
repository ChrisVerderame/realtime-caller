const twilio = require("twilio");

const client = twilio(
  process.env.TWILIO_SID,
  process.env.TWILIO_AUTH
);

// normalize phone → +1XXXXXXXXXX
function normalizePhone(phone) {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, "");

  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;

  return null;
}

async function callLead(lead) {
  try {
    const to = normalizePhone(lead.phone);

    if (!to) {
      console.error("❌ Invalid phone:", lead.phone);
      return;
    }

    // 🔥 CRITICAL FIX: include username (caller@)
    const sip = `sip:caller@${process.env.LIVEKIT_SIP_ENDPOINT};transport=tls`;

    console.log("📞 CALLING:", to);
    console.log("➡️ SIP TARGET:", sip);

    const call = await client.calls.create({
      to,
      from: process.env.TWILIO_NUMBER,

      // 🔥 MUST use twiml (NOT url)
      twiml: `
        <Response>
          <Dial>
            <Sip>${sip}</Sip>
          </Dial>
        </Response>
      `
    });

    console.log("✅ Call SID:", call.sid);
    return call;

  } catch (err) {
    console.error("❌ CALL ERROR:", err.message);
  }
}

module.exports = { callLead };
