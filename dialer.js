const twilio = require("twilio");

const client = twilio(
  process.env.TWILIO_SID,
  process.env.TWILIO_AUTH
);

// normalize phone safely
function normalizePhone(phone) {
  if (!phone) return null;

  const digits = String(phone).replace(/\D/g, "");

  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;

  return null;
}

async function callLead(lead) {
  try {
    // 👇 supports BOTH formats:
    // { phone: "+1203..." } OR "+1203..."
    let phone = typeof lead === "string" ? lead : lead.phone;

    const to = normalizePhone(phone);

    if (!to) {
      console.error("❌ Invalid phone:", phone);
      return;
    }

    console.log("📞 CALLING:", to);

    const call = await client.calls.create({
      to,
      from: process.env.TWILIO_NUMBER,

      // 🔥 SIMPLE + CORRECT SIP
      twiml: `
        <Response>
          <Dial>
            <Sip>sip:${process.env.LIVEKIT_SIP_ENDPOINT}</Sip>
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
