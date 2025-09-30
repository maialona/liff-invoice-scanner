import { parseEInvoiceTW } from "./src/utils/parseEInvoiceTW.js";

/**
 * 建議用 Vite 環境變數餵設定（.env / Netlify 環境變數）：
 *  VITE_LIFF_ID / VITE_API_ENDPOINT / VITE_BEARER_TOKEN
 * 若沒有設定，會 fallback 使用下方預設字串。
 */
const CONFIG = {
  LIFF_ID: import.meta?.env?.VITE_LIFF_ID || "2008141945-nXovAvab",
  // ✅ 換成你的後端 API（Render 或 GAS）
  API_ENDPOINT:
    import.meta?.env?.VITE_API_ENDPOINT ||
    "https://liff-invoice-scanner.onrender.com/api/invoices",
  // 如果後端有啟用 Bearer Token，再保留；否則拿掉這段與 fetch 的 Authorization header
  BEARER_TOKEN: import.meta?.env?.VITE_BEARER_TOKEN || "",
};

class LiffInvoiceScanner {
  constructor() {
    this.isScanning = false;
    this.firstQrData = null; // 暫存第一碼字串
    this.firstQrType = null; // 'left' | 'right' | 'unknown'
    this.secondTimer = null; // 第二碼倒數計時器
    this.secondTimeoutSec = 90; // 等待第二碼的秒數
    this.init();
  }

  async init() {
    try {
      await liff.init({ liffId: CONFIG.LIFF_ID });

      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      if (!liff.scanCodeV2) {
        throw new Error("此環境不支援掃碼功能（需 LINE App 或支援的瀏覽器）");
      }

      this.setupEventListeners();
      console.log("LIFF 初始化完成");
    } catch (err) {
      console.error("LIFF 初始化失敗：", err);
      this.showError("應用程式初始化失敗，請重新整理或稍後再試");
    }
  }

  setupEventListeners() {
    const scanBtn = document.getElementById("scanBtn");
    if (scanBtn)
      scanBtn.addEventListener("click", () => this.handleScanClick());

    // 提供手動貼上第二碼與取消重來
    const resultCard = document.getElementById("resultCard");
    if (resultCard) {
      const manual = document.createElement("button");
      manual.textContent = "手動貼上第二碼";
      manual.style.cssText =
        "margin-top:10px;border:1px solid #fff;background:transparent;color:#fff;padding:8px 12px;border-radius:8px;cursor:pointer;";
      manual.onclick = () => this.promptManualSecondCode();
      resultCard.appendChild(manual);

      const cancel = document.createElement("button");
      cancel.textContent = "取消第二碼並重來";
      cancel.style.cssText =
        "margin-left:8px;margin-top:10px;border:1px solid #fff;background:transparent;color:#fff;padding:8px 12px;border-radius:8px;cursor:pointer;";
      cancel.onclick = () => this.resetSecondStep();
      resultCard.appendChild(cancel);
    }
  }

  async handleScanClick() {
    if (this.isScanning) return;
    this.isScanning = true;
    this.updateScanButton(true);
    this.clearMessages();

    try {
      const { value } = await liff.scanCodeV2();
      if (!value) throw new Error("未掃描到有效內容");

      if (this.firstQrData) {
        await this.processTwoStep(value);
      } else {
        await this.processFirstStep(value);
      }
    } catch (err) {
      console.error("掃描錯誤：", err);
      this.showError(this._humanizeScanError(err));
    } finally {
      this.isScanning = false;
      this.updateScanButton(false);
    }
  }

  _humanizeScanError(error) {
    const msg = String(error?.message || error || "");
    if (/NotAllowed|permission/i.test(msg))
      return "相機權限被拒，請在系統設定開啟相機權限並重試";
    if (/NotFound/i.test(msg)) return "找不到相機，請確認裝置是否支援";
    return msg || "掃描失敗";
  }

  async processFirstStep(qrValue) {
    try {
      const parsed = parseEInvoiceTW(qrValue);

      if (parsed.needSecondQr) {
        this.firstQrData = qrValue;
        this.firstQrType = "left";
        this.showDualQrHintWithCountdown();
        this.displayResult(parsed);
        return;
      }

      // 單碼已完整（少數發票左碼末尾帶明細）
      this.displayResult(parsed);
      await this.sendToBackend(parsed);
    } catch (e) {
      // 很可能先掃到右碼（只有品項）
      this.firstQrData = qrValue;
      this.firstQrType = "right";
      this.showDualQrHintWithCountdown("偵測到右碼，請再掃含發票號碼的左碼");
      this.displayResult({ needSecondQr: true, raw: qrValue, items: [] });
    }
  }

  async processTwoStep(secondValue) {
    try {
      const left = this.firstQrType === "left" ? this.firstQrData : secondValue;
      const right =
        this.firstQrType === "left" ? secondValue : this.firstQrData;
      const merged = parseEInvoiceTW([left, right]);

      this.clearSecondCountdown();
      this.firstQrData = null;
      this.firstQrType = null;
      this.hideDualQrHint();

      this.displayResult(merged);
      await this.sendToBackend(merged);
    } catch (err) {
      this.showError(`合併解析失敗：${err.message || err}`);
    }
  }

  showDualQrHintWithCountdown(customMsg) {
    const hint = document.getElementById("dualQrHint");
    if (!hint) return;

    let remain = this.secondTimeoutSec;
    const render = () => {
      hint.style.display = "block";
      hint.innerHTML =
        (customMsg || "偵測到第一碼，請再掃描另一個 QR 碼以取得完整明細") +
        `<div style="margin-top:6px;font-size:12px;opacity:.85;">倒數 ${remain}s，逾時會自動取消</div>`;
    };
    render();

    this.clearSecondCountdown();
    this.secondTimer = setInterval(() => {
      remain -= 1;
      render();
      if (remain <= 0) this.resetSecondStep();
    }, 1000);
  }

  clearSecondCountdown() {
    if (this.secondTimer) {
      clearInterval(this.secondTimer);
      this.secondTimer = null;
    }
  }

  resetSecondStep() {
    this.clearSecondCountdown();
    this.firstQrData = null;
    this.firstQrType = null;
    this.hideDualQrHint();
    this.showError("已取消等待第二碼，請重新掃描。");
  }

  async promptManualSecondCode() {
    if (!this.firstQrData) {
      this.showError("請先掃描其中一個 QR 碼，再手動貼上另一個。");
      return;
    }
    const manual = prompt("請貼上另一個 QR 的字串（可從條碼掃描 App 複製）：");
    if (!manual) return;
    await this.processTwoStep(manual);
  }

  displayResult(invoiceData) {
    const card = document.getElementById("resultCard");
    const content = document.getElementById("resultContent");
    if (!card || !content) return;

    const html = `
      <div class="result-item"><span class="result-label">發票號碼:</span>
        <span class="result-value">${
          invoiceData.invoice_number || "未知"
        }</span></div>
      <div class="result-item"><span class="result-label">開立日期:</span>
        <span class="result-value">${
          invoiceData.invoice_date || "未知"
        }</span></div>
      <div class="result-item"><span class="result-label">隨機碼:</span>
        <span class="result-value">${
          invoiceData.random_code || "未知"
        }</span></div>
      <div class="result-item"><span class="result-label">賣方統編:</span>
        <span class="result-value">${
          invoiceData.seller_vat || "未知"
        }</span></div>
      <div class="result-item"><span class="result-label">買方統編:</span>
        <span class="result-value">${invoiceData.buyer_vat || "無"}</span></div>
      <div class="result-item"><span class="result-label">總金額:</span>
        <span class="result-value">NT$ ${Number(
          invoiceData.amount || 0
        )}</span></div>
      <div class="result-item"><span class="result-label">商品項目:</span>
        <span class="result-value">${
          invoiceData.items?.length || 0
        } 項</span></div>
      ${
        invoiceData.needSecondQr
          ? '<div style="color:#ffc107;margin-top:10px;font-size:12px;">⚠️ 需要掃描另一個 QR 碼以取得完整資訊</div>'
          : ""
      }
    `;
    content.innerHTML = html;
    card.style.display = "block";
  }

  async sendToBackend(invoiceData) {
    try {
      const payload = {
        timestamp: new Date().toISOString(),
        source: "liff",
        ...invoiceData,
        items_json: JSON.stringify(invoiceData.items || []),
      };

      const headers = { "Content-Type": "application/json" };
      if (CONFIG.BEARER_TOKEN && CONFIG.BEARER_TOKEN !== "YOUR_BEARER_TOKEN") {
        headers["Authorization"] = `Bearer ${CONFIG.BEARER_TOKEN}`;
      }

      // 後端為 Node/Render：請填完整 API，例如 https://xxx.onrender.com/api/invoices
      // 若你是用 GAS，請把 CONFIG.API_ENDPOINT 改成 GAS Web App URL（POST）
      const res = await fetch(CONFIG.API_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`後端錯誤 (${res.status})：${t}`);
      }

      const result = await res.json();
      console.log("後端回應：", result);
      this.showSuccess("發票資料已成功儲存至 Google Sheet！");
    } catch (err) {
      console.error("送後端失敗：", err);
      this.showError(`資料儲存失敗：${err.message || err}`);
    }
  }

  /* UI helpers */
  updateScanButton(isLoading) {
    const btn = document.getElementById("scanBtn");
    if (!btn) return;
    if (isLoading) {
      btn.innerHTML = '<span class="loading"></span>掃描中...';
      btn.disabled = true;
    } else {
      btn.innerHTML = "📷 掃描發票 QR Code";
      btn.disabled = false;
    }
  }

  showSuccess(msg) {
    const ok = document.getElementById("successMsg");
    const err = document.getElementById("errorMsg");
    if (ok) {
      ok.textContent = msg;
      ok.style.display = "block";
    }
    if (err) err.style.display = "none";
    setTimeout(() => ok && (ok.style.display = "none"), 3000);
  }

  showError(msg) {
    const ok = document.getElementById("successMsg");
    const err = document.getElementById("errorMsg");
    if (err) {
      err.textContent = msg;
      err.style.display = "block";
    }
    if (ok) ok.style.display = "none";
  }

  clearMessages() {
    const ok = document.getElementById("successMsg");
    const err = document.getElementById("errorMsg");
    if (ok) ok.style.display = "none";
    if (err) err.style.display = "none";
  }

  showDualQrHint() {
    const el = document.getElementById("dualQrHint");
    if (el) el.style.display = "block";
  }
  hideDualQrHint() {
    const el = document.getElementById("dualQrHint");
    if (el) el.style.display = "none";
  }
}

// 初始化
new LiffInvoiceScanner();
