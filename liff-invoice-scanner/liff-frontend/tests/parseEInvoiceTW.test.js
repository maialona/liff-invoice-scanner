// liff-frontend/tests/parseEInvoiceTW.test.js
import { describe, it, expect } from "vitest";
import { parseEInvoiceTW } from "../src/utils/parseEInvoiceTW.js";

describe("parseEInvoiceTW", () => {
  it("解析單碼（基本）", () => {
    const qr = "AB12345678:1120515:1234:12345678:1000:87654321**";
    const r = parseEInvoiceTW(qr);
    expect(r.invoice_number).toBe("AB12345678");
    expect(r.invoice_date).toBe("2023-05-15");
    expect(r.random_code).toBe("1234");
    expect(r.seller_vat).toBe("12345678");
    expect(r.amount).toBe(1000);
    expect(r.buyer_vat).toBe("87654321");
    expect(r.needSecondQr).toBe(true);
  });

  it("解析含商品明細", () => {
    const qr =
      "CD98765432:1121225:5678:87654321:2500:**商品A:2:500:1000|商品B:1:1500:1500";
    const r = parseEInvoiceTW(qr);
    expect(r.invoice_number).toBe("CD98765432");
    expect(r.invoice_date).toBe("2023-12-25");
    expect(r.amount).toBe(2500);
    expect(r.items).toHaveLength(2);
    expect(r.items[0].name).toBe("商品A");
    expect(r.items[1].subtotal).toBe(1500);
    expect(r.needSecondQr).toBe(false);
  });

  it("解析雙碼", () => {
    const left = "EF11223344:1130101:9999:11223344:5000:";
    const right = "飲料A:3:50:150|點心B:2:200:400|便當C:1:1500:1500";
    const r = parseEInvoiceTW([left, right]);
    expect(r.invoice_number).toBe("EF11223344");
    expect(r.invoice_date).toBe("2024-01-01");
    expect(r.amount).toBe(5000);
    expect(r.items).toHaveLength(3);
    expect(r.needSecondQr).toBe(false);
  });

  it("處理 URL 編碼", () => {
    const q = "GH55667788%3A1121010%3A1111%3A55667788%3A800%3A**";
    const r = parseEInvoiceTW(q);
    expect(r.invoice_number).toBe("GH55667788");
    expect(r.seller_vat).toBe("55667788");
    expect(r.amount).toBe(800);
  });

  it("無效 QR 拋錯", () => {
    expect(() => parseEInvoiceTW("invalid")).toThrow();
    expect(() => parseEInvoiceTW("")).toThrow();
  });

  it("處理西元年日期", () => {
    const q = "IJ99887766:20231115:7777:99887766:1200:**";
    const r = parseEInvoiceTW(q);
    expect(r.invoice_date).toBe("2023-11-15");
  });
});
