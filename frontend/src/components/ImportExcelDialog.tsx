// Dialog "Nhập Excel" — HAI BƯỚC: chọn file → XEM TRƯỚC → "Xác nhận nhập".
import { useState, type DragEvent } from "react";
import { Button } from "./Button";
import { DetailModal } from "./DetailModal";
import { Icon } from "./Icons";
import { ApiError } from "../api/client";
import type { ImportExcelOut } from "../api/rebuildCatalog";
import "./import-excel-dialog.css";

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImportExcelDialog({
  ten,
  chay: chayNgoai,
  onClose,
  onImported,
  taiMau,
  luat,
  kieu = "mac-dinh",
  moTaMau,
}: {
  /** Tên thứ đang nhập, số ít viết thường — vd "công đoạn", "giấy", "hồ sơ nhân sự". */
  ten: string;
  /** Gọi endpoint nhập của màn. `preview` không được ghi gì; `commit` mới chốt. */
  chay: (file: File, mode: "preview" | "commit") => Promise<ImportExcelOut>;
  onClose: () => void;
  /** Đã ghi xong — nơi gọi tải lại bảng rồi mới đóng. */
  onImported: () => void;
  /** Có thì hiện nút "Tải file mẫu" ngay trong dialog (màn nào có endpoint mẫu riêng). */
  taiMau?: () => void | Promise<void>;
  /** Câu mô tả luật nhập của màn — thay dòng mặc định (vốn viết cho danh mục). */
  luat?: string;
  /** "ba-buoc": ba bước đánh số theo đúng thứ tự làm (1 Tải file mẫu → 2 Điền → 3 Chọn file), file
   *  lỗi thì nút chính thành "Chọn lại file". Mặc định giữ dáng cũ — 13 màn danh mục + Nhân sự
   *  chưa duyệt đổi (Tài sản dùng trước, thiết kế 05/10/2026 màn 5). */
  kieu?: "mac-dinh" | "ba-buoc";
  /** Chỉ dáng "ba-buoc": một câu dưới bước 1 (vd "Mỗi dòng một tài sản đang dùng."). */
  moTaMau?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [xem, setXem] = useState<ImportExcelOut | null>(null); // kết quả XEM TRƯỚC
  const [xong, setXong] = useState<ImportExcelOut | null>(null); // kết quả đã CHỐT
  const [isDragOver, setIsDragOver] = useState(false);

  async function chay(f: File, mode: "preview" | "commit") {
    setBusy(true);
    setError(null);
    try {
      const kq = await chayNgoai(f, mode);
      if (mode === "commit" && kq.da_ghi) setXong(kq);
      else setXem(kq);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Không đọc được file.");
    } finally {
      setBusy(false);
    }
  }

  function chonFile(f: File | null) {
    setFile(f);
    setXem(null);
    setXong(null);
    if (f) void chay(f, "preview");
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) setIsDragOver(true);
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const droppedFile = files[0];
      if (droppedFile.name.endsWith(".xlsx")) {
        chonFile(droppedFile);
      } else {
        setError("Chỉ chấp nhận file Excel dạng .xlsx");
      }
    }
  }

  const kq = xong ?? xem;
  const dungDuoc = Boolean(xem && xem.hop_le && file && !xong);
  const seDoi = kq ? kq.tao_moi + kq.cap_nhat : 0;

  if (kieu === "ba-buoc") {
    const coLoi = Boolean(kq && !kq.hop_le && !xong);
    return (
      <DetailModal
        title={`Nhập ${ten} từ Excel`}
        onClose={onClose}
        footer={
          xong ? (
            <Button variant="accent" onClick={onImported}>Xong</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose} disabled={busy}>Hủy</Button>
              {coLoi ? (
                <Button variant="accent" disabled={busy} onClick={() => chonFile(null)}>Chọn lại file</Button>
              ) : dungDuoc ? (
                <Button variant="accent" loading={busy} onClick={() => { if (file) void chay(file, "commit"); }}>
                  {seDoi > 0 ? `Nhập ${seDoi} ${ten}` : `Nhập ${ten}`}
                </Button>
              ) : null}
            </>
          )
        }
      >
        {xong ? (
          <div className="banner banner--success" role="status">
            Đã nhập xong {kq?.tao_moi ?? 0} {ten}
            {kq && kq.cap_nhat > 0 ? `, cập nhật ${kq.cap_nhat}` : ""}.
          </div>
        ) : (
          <ol className="imx__buoc">
            {taiMau && (
              <li>
                <span className="imx__buoc-so">1</span>
                <div>
                  <h4>Tải file mẫu</h4>
                  {moTaMau && <p>{moTaMau}</p>}
                  <Button variant="secondary" onClick={() => void taiMau()} disabled={busy}>
                    <Icon name="download" size={14} /> Tải file mẫu (.xlsx)
                  </Button>
                </div>
              </li>
            )}
            <li>
              <span className="imx__buoc-so">{taiMau ? 2 : 1}</span>
              <div>
                <h4>Điền vào file</h4>
                {luat && <p>{luat}</p>}
              </div>
            </li>
            <li>
              <span className="imx__buoc-so">{taiMau ? 3 : 2}</span>
              <div>
                <h4>Chọn file đã điền</h4>
                {!file ? (
                  <div
                    className={`imx__dropzone imx__dropzone--gon${isDragOver ? " imx__dropzone--active" : ""}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <input type="file" accept=".xlsx" disabled={busy} className="imx__input-hidden"
                      aria-label="Chọn file Excel"
                      onChange={(e) => { chonFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                    <Icon name="upload" size={20} />
                    <span className="imx__dropzone-title">Kéo thả file vào đây</span>
                    <span className="imx__dropzone-sub">hoặc bấm để chọn file .xlsx</span>
                  </div>
                ) : (
                  <div className="imx__file-card">
                    <div className="imx__file-info">
                      <Icon name="table" size={18} />
                      <div>
                        <div className="imx__file-name">{file.name}</div>
                        <div className="imx__file-size">
                          {busy ? "Đang đọc file…" : kq ? `${kq.tong_dong} dòng` : formatFileSize(file.size)}
                        </div>
                      </div>
                    </div>
                    <button type="button" className="imx__doi" disabled={busy} onClick={() => chonFile(null)}>
                      Chọn file khác
                    </button>
                  </div>
                )}
                {error && <div className="banner banner--error" role="alert">{error}</div>}
                {kq && (
                  <p className={kq.hop_le ? "imx__kq" : "imx__kq imx__kq--loi"} role="status">
                    {!kq.hop_le
                      ? `${kq.loi.length} chỗ chưa đúng — sửa trong file rồi chọn lại. Chưa dòng nào được ghi.`
                      : kq.thay_doi
                        ? `Đọc được ${kq.tong_dong} dòng: ${kq.tao_moi} thêm mới, ${kq.cap_nhat} cập nhật, ${kq.khong_doi} không đổi.`
                        : `Đọc được ${kq.tong_dong} dòng, không có lỗi. Bấm Nhập để ghi.`}
                  </p>
                )}
                {kq && kq.hop_le && (kq.canh_bao?.length ?? 0) > 0 && (
                  <ul className="imx__canh-bao">
                    {kq.canh_bao!.map((c, i) => <li key={i}>Dòng {c.dong}: {c.noi_dung}</li>)}
                  </ul>
                )}
                {kq && kq.hop_le && (kq.thay_doi?.length ?? 0) > 0 && (
                  <div className="imx__wrap">
                    <table className="imx__table">
                      <thead>
                        <tr>
                          <th style={{ width: "9%" }}>Dòng</th>
                          <th style={{ width: "30%" }}>Mặt hàng</th>
                          <th style={{ width: "15%" }}>Cột</th>
                          <th>Cũ</th>
                          <th>Mới</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kq.thay_doi!.map((t, i) => (
                          <tr key={i}>
                            <td className="imx__num">{t.dong}</td>
                            <td title={t.ma}>{t.ten || t.ma}</td>
                            <td>{t.cot}</td>
                            <td>{t.cu || <span className="imx__mo">Chưa có</span>}</td>
                            <td>{t.moi}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {kq && kq.loi.length > 0 && (
                  <div className="imx__wrap">
                    <table className="imx__table">
                      <thead>
                        <tr>
                          <th style={{ width: "14%" }}>Dòng</th>
                          <th style={{ width: "30%" }}>Cột</th>
                          <th>Lỗi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kq.loi.map((l, i) => (
                          <tr key={i}>
                            <td className="imx__num">{l.dong}</td>
                            <td>{l.cot}</td>
                            <td>{l.ly_do}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </li>
          </ol>
        )}
      </DetailModal>
    );
  }

  return (
    <DetailModal
      kicker="Nhập Excel"
      title={`Nhập ${ten} từ Excel`}
      onClose={onClose}
      footer={
        xong ? (
          <Button variant="primary" onClick={onImported}>
            Xong
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Huỷ
            </Button>
            {dungDuoc ? (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => {
                  if (file) void chay(file, "commit");
                }}
              >
                {seDoi > 0 ? `Xác nhận nhập ${seDoi} dòng` : "Xác nhận nhập"}
              </Button>
            ) : (
              <Button variant="primary" disabled>
                Xác nhận nhập
              </Button>
            )}
          </>
        )
      }
    >
      {!xong && (
        <>
          {/* Khối Hướng Dẫn & Quy Tắc Nhập Trình Bày Gọn Gàng */}
          <div className="imx__rules-box">
            <div className="imx__rules-title">
              <Icon name="info" size={14} />
              <span>Quy tắc nhập dữ liệu</span>
            </div>
            {luat ? (
              <p className="imx__hint" style={{ margin: 0 }}>
                {luat}
              </p>
            ) : (
              <ul className="imx__rules-list">
                <li>
                  <strong>Tải file chuẩn:</strong> Dùng nút <em>"Xuất Excel"</em> hoặc{" "}
                  <em>"Tải file mẫu"</em> bên dưới để lấy file đúng cấu trúc.
                </li>
                <li>
                  <strong>Xử lý dòng:</strong> Mã đã có sẽ <strong>CẬP NHẬT</strong>, mã mới sẽ{" "}
                  <strong>TẠO MỚI</strong>.
                </li>
                <li>
                  <strong>An toàn dữ liệu:</strong> Cả file là 1 lượt xử lý. Nếu có 1 dòng chưa hợp
                  lệ, hệ thống sẽ tạm thời không ghi dữ liệu.
                </li>
              </ul>
            )}
          </div>

          {/* Vùng Chọn & Kéo - Thả File Dropzone */}
          {!file ? (
            <div
              className={`imx__dropzone${isDragOver ? " imx__dropzone--active" : ""}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept=".xlsx"
                disabled={busy}
                className="imx__input-hidden"
                onChange={(e) => {
                  chonFile(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
              <span className="imx__dropzone-icon">
                <Icon name="upload" size={24} />
              </span>
              <span className="imx__dropzone-title">Kéo & thả file Excel (.xlsx) vào đây</span>
              <span className="imx__dropzone-sub">Hoặc bấm vào vùng này để chọn file từ máy tính</span>
            </div>
          ) : (
            /* Thẻ Xem Trước File Đã Chọn */
            <div className="imx__file-card">
              <div className="imx__file-info">
                <div className="imx__file-icon">
                  <Icon name="table" size={20} />
                </div>
                <div>
                  <div className="imx__file-name">{file.name}</div>
                  <div className="imx__file-size">{formatFileSize(file.size)}</div>
                </div>
              </div>
              <button
                type="button"
                className="imx__file-remove"
                title="Đổi file khác"
                disabled={busy}
                onClick={() => chonFile(null)}
              >
                <Icon name="x" size={16} />
              </button>
            </div>
          )}

          {/* Nút Tải File Mẫu (Nổi bật & Dễ nhìn) */}
          {taiMau && (
            <div className="imx__template-action">
              <span className="imx__hint">Chưa có file mẫu?</span>
              <Button variant="ghost" onClick={() => void taiMau()} disabled={busy}>
                <Icon name="download" size={14} style={{ marginRight: 6 }} />
                Tải file mẫu (.xlsx)
              </Button>
            </div>
          )}

          {busy && <p className="imx__hint" style={{ marginTop: 8 }}>⏳ Đang kiểm tra & đọc nội dung file…</p>}
        </>
      )}

      {error && <div className="banner banner--error" style={{ marginTop: 12 }} role="alert">{error}</div>}

      {/* Bảng Kết Quả Xem Trước Dữ Liệu & Danh Sách Lỗi */}
      {kq && (
        <>
          <div
            className={`banner ${!kq.hop_le ? "banner--error" : xong ? "banner--success" : "banner--warn"}`}
            style={{ marginTop: 12 }}
            role="status"
          >
            {xong
              ? `🎉 Đã nhập xong: ${kq.tao_moi} dòng tạo mới, ${kq.cap_nhat} dòng cập nhật` +
                (kq.khong_doi > 0 ? `, ${kq.khong_doi} dòng không đổi.` : ".")
              : !kq.hop_le
                ? `⚠️ File có ${kq.loi.length} chỗ chưa hợp lệ — sửa trong file rồi chọn lại. ` +
                  "Chưa có dòng nào được ghi."
                : `✅ Đọc được ${kq.tong_dong} dòng: ${kq.tao_moi} tạo mới, ${kq.cap_nhat} cập nhật` +
                  (kq.khong_doi > 0 ? `, ${kq.khong_doi} không đổi.` : ".")}
          </div>

          {kq.loi.length > 0 && (
            <div className="imx__wrap">
              <table className="imx__table">
                <thead>
                  <tr>
                    <th style={{ width: "22%" }}>Sheet</th>
                    <th style={{ width: "10%" }}>Dòng</th>
                    <th style={{ width: "22%" }}>Cột</th>
                    <th>Lý do</th>
                  </tr>
                </thead>
                <tbody>
                  {kq.loi.map((l, i) => (
                    <tr key={i}>
                      <td>{l.sheet}</td>
                      <td className="imx__num">{l.dong}</td>
                      <td>{l.cot}</td>
                      <td>{l.ly_do}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </DetailModal>
  );
}
