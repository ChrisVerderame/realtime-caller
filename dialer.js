const twilio = require("twilio");

const client = twilio(
  process.env.TWILIO_SID,
  process.env.TWILIO_AUTH
);

// normalize phone to E.164 (+1XXXXXXXXXX)
function normalizePhone(phone) {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, "");

  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  if (digits.startsWith("+")) return digits;

  return null;
}

async function callLead(lead) {
  try {
    const to = normalizePhone(lead.phone);

    if (!to) {
      console.error("❌ Invalid phone:", lead.phone);
      return;
    }

    const sipTarget = `sip:${process.env.LIVEKIT_SIP_ENDPOINT};transport=tls`;

    console.log("📞 CALLING:", to);
    console.log("➡️  SIP TARGET:", sipTarget);

    const call = await client.calls.create({
      to,
      from: process.env.TWILIO_NUMBER,

      // 🔥 THIS is the key line (Twilio → LiveKit directly)
      url: sipTarget
    });

    console.log("✅ Call SID:", call.sid);
    return call;

  } catch (err) {
    console.error("❌ Call failed:", err.message);
  }
}

module.exports = { callLead };
