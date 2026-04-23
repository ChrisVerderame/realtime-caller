async function getLeads() {
  const res = await fetch(process.env.GOOGLE_SHEET_CSV_URL);
  const text = await res.text();

  const rows = text.split("\n").slice(1);

  return rows.map((row) => {
    let [name, phone, address] = row.split(",");

    if (!phone) return null;

    let cleaned = phone.replace(/\D/g, "");

    if (cleaned.length === 10) cleaned = "+1" + cleaned;
    else if (cleaned.length === 11) cleaned = "+" + cleaned;

    return {
      name: name?.trim(),
      phone: cleaned,
      address: address?.trim(),
    };
  }).filter(Boolean);
}

module.exports = { getLeads };
