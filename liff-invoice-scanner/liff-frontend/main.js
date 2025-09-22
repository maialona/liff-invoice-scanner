// liff-frontend/main.js
import { parseEInvoiceTW } from "./src/utils/parseEInvoiceTW.js";

const CONFIG = {
  LIFF_ID: "2008141945-nXovAvab", // <- 替換成你的 LIFF ID
  API_ENDPOINT:
    "https://script.google.com/macros/s/AKfycbyN59-vgQuOqOWHT0OyBCfmb9aQ9GvjVpxKE8_vF4CEZMPyBChACf-RNEjtLPVDtt1c/exec", // <- GAS Web App URL 或 Node.js /api/invoices
  BEARER_TOKEN: "123_abc", // <- 只有 Node.js 版需要；GAS 可留空
};

class LiffInvoiceScanner {
  constructor() {
    this.isScanning = false;
    this.firstQrData = null;
    this.init();
  }

  async init() {
    try {
      await liff.init({ liffId: CONFIG.LIFF_ID });
      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }
      this.setupEventListeners();
    } catch (error) {
      console.error("LIFF 初始化失敗:", error);
      this.showError("應用程式初始化失敗，請重新整理頁面");
    }
  }

  setupEventListeners() {
    const scanBtn = document.getElementById("scanBtn");
    scanBtn.addEventListener("click", () => this.startScan());
  }

  async startScan() {
    if (this.isScanning) return;
    this.isScanning = true;
    this.updateScanButton(true);
    this.clearMessages();

    try {
      if (!liff.scanCodeV2) throw new Error("此環境不支援掃碼功能");
      const result = await liff.scanCodeV2();
      if (!result || !result.value) throw new Error("未掃描到有效內容");
      await this.processQrCode(result.value);
    } catch (error) {
      console.error("掃描錯誤:", error);
      const msg = error.message.includes("permissions")
        ? "請允許相機權限後重試"
        : error.message.includes("NotAllowedError")
        ? "相機權限被拒絕，請在設定中開啟權限"
        : error.message.includes("NotFoundError")
        ? "找不到相機，請確認設備支援"
        : error.message;
      this.showError(msg || "掃描失敗");
    } finally {
      this.isScanning = false;
      this.updateScanButton(false);
    }
  }

  async processQrCode(qrValue) {
    try {
      let invoiceData;
      if (this.firstQrData) {
        invoiceData = parseEInvoiceTW([this.firstQrData, qrValue]);
        this.firstQrData = null;
        this.hideDualQrHint();
      } else {
        invoiceData = parseEInvoiceTW(qrValue);
      }
      if (invoiceData.needSecondQr) {
        this.firstQrData = qrValue;
        this.showDualQrHint();
        this.displayResult(invoiceData);
        return;
      }
      this.displayResult(invoiceData);
      await this.sendToBackend(invoiceData);
    } catch (error) {
      console.error("處理 QR 碼錯誤:", error);
      this.showError(`發票解析失敗: ${error.message}`);
    }
  }

  displayResult(invoiceData) {
    const resultCard = document.getElementById("resultCard");
    const resultContent = document.getElementById("resultContent");
    resultContent.innerHTML = `
      <div class="result-item"><span class="result-label">發票號碼:</span> <span class="result-value">${
        invoiceData.invoice_number || "未知"
      }</span></div>
      <div class="result-item"><span class="result-label">開立日期:</span> <span class="result-value">${
        invoiceData.invoice_date || "未知"
      }</span></div>
      <div class="result-item"><span class="result-label">隨機碼:</span> <span class="result-value">${
        invoiceData.random_code || "未知"
      }</span></div>
      <div class="result-item"><span class="result-label">賣方統編:</span> <span class="result-value">${
        invoiceData.seller_vat || "未知"
      }</span></div>
      <div class="result-item"><span class="result-label">買方統編:</span> <span class="result-value">${
        invoiceData.buyer_vat || "無"
      }</span></div>
      <div class="result-item"><span class="result-label">總金額:</span> <span class="result-value">NT$ ${
        invoiceData.amount || 0
      }</span></div>
      <div class="result-item"><span class="result-label">商品項目:</span> <span class="result-value">${
        invoiceData.items?.length || 0
      } 項</span></div>
      ${
        invoiceData.needSecondQr
          ? '<div style="color:#ffc107;margin-top:10px;font-size:12px;">⚠️ 需要掃描第二碼以取得完整資訊</div>'
          : ""
      }
    `;
    resultCard.style.display = "block";
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
      const resp = await fetch(CONFIG.API_ENDPOINT, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      if (!resp.ok)
        throw new Error(`後端錯誤 (${resp.status}): ${await resp.text()}`);
      await resp.json();
      this.showSuccess("發票資料已成功儲存至 Google Sheet！");
    } catch (error) {
      console.error("後端呼叫失敗:", error);
      this.showError(`資料儲存失敗: ${error.message}`);
    }
  }

  updateScanButton(loading) {
    const btn = document.getElementById("scanBtn");
    if (loading) {
      btn.innerHTML = '<span class="loading"></span>掃描中...';
      btn.disabled = true;
    } else {
      btn.innerHTML = "📷 掃描發票 QR Code";
      btn.disabled = false;
    }
  }
  showSuccess(msg) {
    const s = document.getElementById("successMsg"),
      e = document.getElementById("errorMsg");
    s.textContent = msg;
    s.style.display = "block";
    e.style.display = "none";
    setTimeout(() => (s.style.display = "none"), 3000);
  }
  showError(msg) {
    const e = document.getElementById("errorMsg"),
      s = document.getElementById("successMsg");
    e.textContent = msg;
    e.style.display = "block";
    s.style.display = "none";
  }
  clearMessages() {
    document.getElementById("successMsg").style.display = "none";
    document.getElementById("errorMsg").style.display = "none";
  }
  showDualQrHint() {
    document.getElementById("dualQrHint").style.display = "block";
  }
  hideDualQrHint() {
    document.getElementById("dualQrHint").style.display = "none";
  }
}

new LiffInvoiceScanner();
