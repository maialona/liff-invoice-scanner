// liff-frontend/src/utils/parseEInvoiceTW.js
/**
 * 台灣電子發票 QR Code 解析器（支援單碼/雙碼）
 * 使用方式：parseEInvoiceTW(qrString) 或 parseEInvoiceTW([left, right])
 */
export function parseEInvoiceTW(input) {
  try {
    return Array.isArray(input)
      ? parseDualQr(input[0], input[1])
      : parseSingleQr(input);
  } catch (error) {
    throw new Error(`QR Code 解析失敗: ${error.message}`);
  }
}

function parseSingleQr(qrString) {
  if (!qrString || typeof qrString !== "string")
    throw new Error("QR Code 內容無效");
  qrString = qrString.trim();
  try {
    qrString = decodeURIComponent(qrString);
  } catch {
    /* 忽略 URL 解碼失敗 */
  }
  if (!isValidTaiwanInvoiceQr(qrString))
    throw new Error("不是有效的台灣電子發票 QR Code");

  const parts = qrString.split("**");
  if (parts.length < 1) throw new Error("QR Code 格式不正確");

  const result = {
    invoice_number: "",
    invoice_date: "",
    random_code: "",
    seller_vat: "",
    amount: 0,
    buyer_vat: "",
    items: [],
    raw: qrString,
    needSecondQr: false,
  };

  const basicInfo = parts[0];
  const basicParts = basicInfo.split(":");

  if (basicParts.length >= 5) {
    result.invoice_number = basicParts[0] || "";
    result.invoice_date = parseDate(basicParts[1]);
    result.random_code = basicParts[2] || "";
    result.seller_vat = basicParts[3] || "";
    result.amount = parseInt(basicParts[4]) || 0;
    if (basicParts.length > 5) result.buyer_vat = basicParts[5] || "";
  }

  if (parts.length > 1 && parts[1]) {
    try {
      result.items = parseItems(parts[1]);
    } catch {
      result.needSecondQr = true;
    }
  } else {
    result.needSecondQr = true;
  }

  return result;
}

function parseDualQr(leftQr, rightQr) {
  const base = parseSingleQr(leftQr);
  try {
    base.items = parseItems(rightQr);
    base.needSecondQr = false;
    base.raw = `${leftQr}||${rightQr}`;
  } catch {
    base.raw = `${leftQr}||${rightQr}`;
  }
  return base;
}

function isValidTaiwanInvoiceQr(qr) {
  if (!qr || qr.length < 10) return false;
  const invoiceNumberPattern = /[A-Z]{2}\d{8}/;
  return invoiceNumberPattern.test(qr) || qr.includes("**") || qr.includes(":");
}

function parseDate(dateStr) {
  if (!dateStr) return "";
  const clean = dateStr.replace(/[\/\-\.]/g, "");
  if (clean.length === 7) {
    const y = parseInt(clean.substring(0, 3), 10) + 1911;
    const m = clean.substring(3, 5);
    const d = clean.substring(5, 7);
    return `${y}-${m}-${d}`;
  }
  if (clean.length === 8) {
    return `${clean.substring(0, 4)}-${clean.substring(4, 6)}-${clean.substring(
      6,
      8
    )}`;
  }
  const dt = new Date(dateStr);
  return isNaN(dt.getTime()) ? dateStr : dt.toISOString().split("T")[0];
}

function parseItems(itemsStr) {
  if (!itemsStr) return [];
  const items = [];
  const lines = itemsStr.split(/\n|\r\n|\|/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.split(":");
    if (parts.length >= 4) {
      items.push({
        name: parts[0].trim(),
        quantity: parseInt(parts[1]) || 1,
        unit_price: parseInt(parts[2]) || 0,
        subtotal: parseInt(parts[3]) || 0,
      });
    } else if (parts.length >= 2) {
      const val = parseInt(parts[1]) || 0;
      items.push({
        name: parts[0].trim(),
        quantity: 1,
        unit_price: val,
        subtotal: val,
      });
    }
  }
  return items;
}
