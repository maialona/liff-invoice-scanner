// backend-node/sheets.js
import { google } from "googleapis";
import fs from "fs";

let sheetsService, spreadsheetId, sheetName;

export async function initializeSheets() {
  spreadsheetId = process.env.SHEET_ID;
  sheetName = process.env.SHEET_NAME || "invoices";
  if (!spreadsheetId) throw new Error("SHEET_ID is required");

  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath || !fs.existsSync(keyPath))
    throw new Error("Service account key not found");

  const credentials = JSON.parse(fs.readFileSync(keyPath, "utf8"));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  sheetsService = google.sheets({ version: "v4", auth });

  await ensureSheetAndHeaders();
  console.log("✅ Google Sheets ready");
}

async function ensureSheetAndHeaders() {
  const ss = await sheetsService.spreadsheets.get({ spreadsheetId });
  const exists = ss.data.sheets.find((s) => s.properties.title === sheetName);
  if (!exists) {
    await sheetsService.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });
  }
  const resp = await sheetsService.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A1:J1`,
  });
  if (!resp.data.values || resp.data.values.length === 0) {
    const headers = [
      "timestamp",
      "source",
      "invoice_number",
      "invoice_date",
      "random_code",
      "seller_vat",
      "buyer_vat",
      "amount",
      "items_json",
      "raw",
    ];
    await sheetsService.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!A1:J1`,
      valueInputOption: "RAW",
      requestBody: { values: [headers] },
    });
  }
}

export async function writeInvoiceToSheet(data) {
  const timestamp = new Date().toISOString();
  const row = [
    timestamp,
    data.source || "liff",
    data.invoice_number || "",
    data.invoice_date || "",
    data.random_code || "",
    data.seller_vat || "",
    data.buyer_vat || "",
    data.amount || 0,
    data.items_json || JSON.stringify([]),
    data.raw || "",
  ];
  const res = await sheetsService.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A:J`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [row] },
  });
  const updatedRange = res.data.updates?.updatedRange; // e.g. "invoices!A2:J2"
  const leftCell = updatedRange?.split(":")[0] || "";
  const match = leftCell.match(/\d+$/);
  const rowIndex = match ? parseInt(match[0], 10) : null;
  return { success: true, row: rowIndex, timestamp };
}
