import { describe, expect, it } from "vitest";

import { phieu } from "../phieu-chi/components/phieuMau";
import { khoanPhieuChiCuaDon } from "./phieuGop";

describe("khoanPhieuChiCuaDon", () => {
  it("phiếu lẻ giữ đợt và số của phiếu; phiếu gộp tách theo dòng CỦA ĐƠN NÀY, số là phần của dòng", () => {
    const le = phieu({ id: 1, delivery_id: 31, amount_vnd: 200_000 });
    const gop = phieu({
      id: 2, delivery_id: null, amount_vnd: 1_464_000,
      lines: [
        { purchase_request_id: 9, purchase_code: "PMH-0009", delivery_id: null, delivery_seq_no: null, invoice_number: null, amount: 500_000 },
        { purchase_request_id: 10, purchase_code: "PMH-0010", delivery_id: 31, delivery_seq_no: 1, invoice_number: "88", amount: 764_000 },
        { purchase_request_id: 10, purchase_code: "PMH-0010", delivery_id: null, delivery_seq_no: null, invoice_number: null, amount: 200_000 },
      ],
    });
    expect(khoanPhieuChiCuaDon(10, [le, gop]).map((k) => [k.v.id, k.deliveryId, k.amount, k.gop])).toEqual([
      [1, 31, 200_000, false],
      [2, 31, 764_000, true],
      [2, null, 200_000, true],
    ]);
  });
});
