import type { XlVatTuTuLap } from "../api/client";

/** Câu toast sau khi phát hành: số lệnh xuống xưởng, số yêu cầu xuất vừa tự gửi kho, và món nào
 *  chưa tự lập được (tổ xin tay). `giai` là chữ rê chuột: mỗi món một dòng kèm lý do. */
export function cauBaoPhatHanh(soLenh: number, vatTu?: XlVatTuTuLap | null): { chu: string; giai?: string } {
  const cau = [soLenh > 1 ? `Đã phát hành ${soLenh} lệnh xuống xưởng.` : "Đã phát hành xuống xưởng."];
  if (vatTu && vatTu.so_yeu_cau > 0) cau.push(`Đã gửi kho ${vatTu.so_yeu_cau} yêu cầu xuất.`);
  const bo = vatTu?.bo_qua ?? [];
  if (bo.length === 0) return { chu: cau.join(" ") };
  cau.push(`${bo.length} món chưa tự lập được, tổ xin tay.`);
  return {
    chu: cau.join(" "),
    giai: bo.map((b) => `${b.ten_cong_doan}: ${b.ten_hang} — ${b.ly_do}`).join("\n"),
  };
}
