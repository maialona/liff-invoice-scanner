// backend-node/index.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import { initializeSheets, writeInvoiceToSheet } from "./sheets.js";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 3000;

// 安全性
app.use(helmet({ crossOriginEmbedderPolicy: false }));

// CORS（允許你的前端網域）
const allowed = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin || allowed.includes(origin)) return cb(null, true);
      cb(new Error("Not allowed by CORS"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json({ limit: "1mb" }));

// Bearer Token 簡易驗證
function auth(req, res, next) {
  const need =
    !!process.env.API_BEARER_TOKEN &&
    process.env.API_BEARER_TOKEN !== "your_secure_random_token_here";
  if (!need) return next();
  const token = (req.headers.authorization || "").split(" ")[1];
  if (!token) return res.status(401).json({ error: "Access token required" });
  if (token !== process.env.API_BEARER_TOKEN)
    return res.status(403).json({ error: "Invalid access token" });
  next();
}

// 健康檢查
app.get("/health", (_, res) =>
  res.json({ status: "OK", ts: new Date().toISOString() })
);

// 主 API：前端把解析結果丟進來
app.post("/api/invoices", auth, async (req, res) => {
  const err = validate(req.body);
  if (err) return res.status(400).json({ error: err });
  try {
    const result = await writeInvoiceToSheet(req.body);
    res.json({ success: true, message: "saved", ...result });
  } catch (e) {
    console.error(e);
    res
      .status(500)
      .json({ error: "Internal server error", details: e.message });
  }
});

// 404 與 CORS 錯誤
app.use((req, res) => res.status(404).json({ error: "Not Found" }));
app.use((err, req, res, next) => {
  if (err?.message === "Not allowed by CORS")
    return res.status(403).json({ error: "CORS policy violation" });
  next(err);
});

function validate(d) {
  if (!d) return "Missing body";
  const need = ["invoice_number", "invoice_date", "seller_vat", "amount"];
  for (const k of need) if (!d[k] && d[k] !== 0) return `Missing field: ${k}`;
  if (!/^[A-Z]{2}\d{8}$/.test(d.invoice_number)) return "Bad invoice_number";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.invoice_date))
    return "Bad invoice_date (YYYY-MM-DD)";
  if (typeof d.amount !== "number" || d.amount < 0) return "Bad amount";
  return null;
}

(async () => {
  try {
    await initializeSheets();
    app.listen(PORT, () => console.log(`🚀 Node backend running on :${PORT}`));
  } catch (e) {
    console.error("Startup failed:", e);
    process.exit(1);
  }
})();
