/**
 * 台灣電子發票 QR Code 解析器（完整版）
 * - 支援單碼與雙碼
 * - 支援「先右後左」與「連續兩個左碼/右碼」的提示
 * - 對常見資料格式做容錯
 *
 * 回傳物件格式：
 * {
 *   invoice_number, invoice_date(YYYY-MM-DD), random_code,
 *   seller_vat, buyer_vat, amount(Number), items(Array), raw, needSecondQr(Boolean)
 * }
 */

/** 主要入口 */
export function parseEInvoiceTW(input) {
  try {
    if (Array.isArray(input)) {
      // 兩段式：傳 [左碼, 右碼] 或 [任一碼, 另一碼]
      return parseDualQr(input[0], input[1]);
    } else {
      return parseSingleQr(input);
    }
  } catch (err) {
    throw new Error(`QR Code 解析失敗：${err.message || err}`);
  }
}

/** 判斷像不像左碼（含發票號碼與基本欄位） */
function looksLikeLeft(s) {
  if (!s || typeof s !== "string") return false;
  const str = safeDecode(s.trim());
  return /[A-Z]{2}\d{8}/.test(str) && (str.includes(":") || str.includes("**"));
}

/** 判斷像不像右碼（多行 品名:數量:單價:小計） */
function looksLikeRight(s) {
  if (!s || typeof s !== "string") return false;
  const str = safeDecode(s.trim());
  const lines = str.split(/\||\n|\r\n/).filter(Boolean);
  const colonLines = lines.filter((l) => (l.match(/:|：/g) || []).length >= 2);
  // 右碼通常沒有發票號（避免誤判）
  return colonLines.length >= 1 && !/[A-Z]{2}\d{8}/.test(str);
}

/** 解析雙碼，會自動判斷順序（先左後右 / 先右後左） */
function parseDualQr(qrA, qrB) {
  const aLeft = looksLikeLeft(qrA);
  const bLeft = looksLikeLeft(qrB);
  const aRight = looksLikeRight(qrA);
  const bRight = looksLikeRight(qrB);

  if (aLeft && bRight) return _parseLeftRight(qrA, qrB);
  if (bLeft && aRight) return _parseLeftRight(qrB, qrA);

  if (aLeft && bLeft)
    throw new Error("偵測到兩個皆似左碼，請改掃含品項明細的右碼。");
  if (aRight && bRight)
    throw new Error("偵測到兩個皆似右碼，請改掃含發票號碼的左碼。");

  // 都不明確時，仍嘗試左+右
  return _parseLeftRight(qrA, qrB);
}

function _parseLeftRight(leftQr, rightQr) {
  const basicResult = parseSingleQr(leftQr);
  try {
    const items = parseItems(rightQr);
    basicResult.items = items;
    basicResult.needSecondQr = false;
    basicResult.raw = `${leftQr}||${rightQr}`;
  } catch (error) {
    console.warn("右碼解析失敗:", error.message);
    basicResult.needSecondQr = true;
    basicResult.raw = `${leftQr}||${rightQr}`;
  }
  return basicResult;
}

/** 解析單一 QR（多半是左碼；少數左碼末尾帶品項也能解析） */
function parseSingleQr(qrString) {
  if (!qrString || typeof qrString !== "string") {
    throw new Error("QR Code 內容無效");
  }

  qrString = safeDecode(qrString.trim());

  if (!isValidTaiwanInvoiceQr(qrString)) {
    throw new Error("不是有效的台灣電子發票 QR Code");
  }

  const result = {
    invoice_number: "",
    invoice_date: "",
    random_code: "",
    seller_vat: "",
    buyer_vat: "",
    amount: 0,
    items: [],
    raw: qrString,
    needSecondQr: false,
  };

  // 依規格，左碼常見為「基本資訊**可能接明細」
  const parts = qrString.split("**");

  // 第一段：基本欄位，以 : 分隔
  const basic = (parts[0] || "").split(":");
  if (basic.length >= 5) {
    result.invoice_number = basic[0] || "";
    result.invoice_date = parseDate(basic[1]);
    result.random_code = basic[2] || "";
    result.seller_vat = basic[3] || "";
    result.amount = toInt(basic[4]);
    if (basic.length > 5) result.buyer_vat = basic[5] || "";
  } else {
    throw new Error("發票基本欄位不足");
  }

  // 第二段：若有，嘗試解析品項；否則標記需要第二碼
  if (parts.length > 1 && parts[1]) {
    try {
      result.items = parseItems(parts[1]);
      result.needSecondQr = result.items.length === 0; // 無項目仍提示第二碼
    } catch (e) {
      console.warn("左碼內品項解析失敗（多半需要第二碼）：", e.message);
      result.needSecondQr = true;
    }
  } else {
    result.needSecondQr = true;
  }

  return result;
}

/** 日期：民國(yyyMMdd) 轉 西元(YYYY-MM-DD)，或直接支援 8 碼西元 */
function parseDate(s) {
  if (!s) return "";
  const clean = String(s).replace(/[\/\-.]/g, "");

  if (/^\d{7}$/.test(clean)) {
    const roc = parseInt(clean.slice(0, 3), 10);
    const y = roc + 1911;
    const m = clean.slice(3, 5);
    const d = clean.slice(5, 7);
    return `${y}-${m}-${d}`;
  }
  if (/^\d{8}$/.test(clean)) {
    const y = clean.slice(0, 4);
    const m = clean.slice(4, 6);
    const d = clean.slice(6, 8);
    return `${y}-${m}-${d}`;
  }

  // 其他可被 Date 解析的格式
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);

  // 回傳原字串讓後端再行驗證
  return s;
}

/** 解析品項清單（支援 | / 換行、全形冒號） */
function parseItems(itemsStr) {
  if (!itemsStr) return [];
  const lines = itemsStr
    .split(/\||\n|\r\n/)
    .map((x) => x.trim())
    .filter(Boolean);
  const items = [];

  for (const line of lines) {
    const parts = line.split(/:|：/).map((x) => x.trim());
    if (parts.length >= 4) {
      items.push({
        name: parts[0],
        quantity: toInt(parts[1], 1),
        unit_price: toInt(parts[2], 0),
        subtotal: toInt(parts[3], 0),
      });
    } else if (parts.length >= 2) {
      items.push({
        name: parts[0],
        quantity: 1,
        unit_price: toInt(parts[1], 0),
        subtotal: toInt(parts[1], 0),
      });
    }
  }

  return items;
}

/** 基本檢查：發票號 or 拆分符號 */
function isValidTaiwanInvoiceQr(str) {
  return (
    /[A-Z]{2}\d{8}/.test(str) ||
    str.includes("**") ||
    (str.includes(":") && str.split(":").length >= 3)
  );
}

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function toInt(v, def = 0) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

export default { parseEInvoiceTW, parseDualQr, parseSingleQr };
