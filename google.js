async function getLeads() {
  const res = await fetch(process.env.GOOGLE_SHEET_CSV_URL);
  const text = await res.text();

  const rows = text.split("\n").slice(1); // skip header

  return rows
    .map((row) => {
      const [name, phone, address] = row.split(",");
      if (!phone) return null;

      return {
        name: name?.trim(),
        phone: phone?.trim(),
        address: address?.trim(),
      };
    })
    .filter(Boolean);
}

module.exports = { getLeads };
