async function getLeads() {
  const res = await fetch(process.env.GOOGLE_SHEET_CSV_URL);
  const text = await res.text();

  const rows = text.split("\n").slice(1); // skip header

  return rows
    .map((row) => {
      let [name, phone, address] = row.split(",");

      if (!phone) return null;

      // Clean all non-digits
      let cleaned = phone.replace(/\D/g, "");

      // Format to E.164
      if (cleaned.length === 10) {
        cleaned = "+1" + cleaned;
      } else if (cleaned.length === 11 && cleaned.startsWith("1")) {
        cleaned = "+" + cleaned;
      } else {
        cleaned = "+" + cleaned;
      }

      return {
        name: name?.trim(),
        phone: cleaned,
        address: address?.trim(),
      };
    })
    .filter(Boolean);
}

module.exports = { getLeads };
