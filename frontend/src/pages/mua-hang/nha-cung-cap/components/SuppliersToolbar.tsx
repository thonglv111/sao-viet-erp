// Đầu màn Nhà cung cấp — khuôn danh sách Kinh doanh đã duyệt (`lds-dau` + `lds-loc` dính mép trên
// lưới, 07/10/2026): hàng tên màn + nút thêm; thẻ lọc có dải lọc nhanh trạng thái hợp tác (số đếm ở
// máy chủ, toàn danh mục) rồi hàng ô tìm + `ThanhLoc` (kỳ + Nhóm / Số sao).
// Trạng thái chỉ chọn ở dải lọc nhanh — không lặp thành ô "Trạng thái" trong nút Lọc.
import type { ReactNode } from "react";
import { Button } from "../../../../components/Button";
import { LocNhanhTrangThai, OTim } from "../../../../components/LuoiDs";

export type TrangThaiNcc = "" | "active" | "inactive";

export function SuppliersToolbar({
  q,
  onQ,
  boLoc,
  chonCot,
  trangThai,
  onTrangThai,
  dem,
  canCreate,
  openCreate,
  banner,
}: {
  q: string;
  onQ: (v: string) => void;
  /** Thanh lọc chung (`ThanhLoc`) — đặt ngay sau ô tìm. */
  boLoc: ReactNode;
  /** Nút "Cột" (`ChonCot`) — đứng cuối hàng ô tìm. */
  chonCot: ReactNode;
  trangThai: TrangThaiNcc;
  onTrangThai: (v: TrangThaiNcc) => void;
  /** Số đếm toàn danh mục (`/api/suppliers/tong-quan`); null = chưa tải. */
  dem: { tong: number; dangHopTac: number; tamNgung: number } | null;
  canCreate: boolean;
  openCreate: () => void;
  /** Lời báo lỗi: giữa đầu màn và thẻ lọc — chen giữa thẻ lọc và lưới là gãy tấm. */
  banner?: ReactNode;
}) {
  return (
    <>
      <header className="lds-dau">
        <h1 className="lds-dau__ten">Nhà cung cấp</h1>
        {canCreate && (
          <div className="lds-dau__nut">
            <Button variant="accent" onClick={openCreate}>
              + Thêm nhà cung cấp
            </Button>
          </div>
        )}
      </header>
      {banner}
      <section className="lds-loc">
        <LocNhanhTrangThai
          muc={[
            { key: "", label: "Tất cả", count: dem?.tong },
            { key: "active", label: "Đang hợp tác", mau: "la", count: dem?.dangHopTac },
            { key: "inactive", label: "Tạm ngừng", mau: "xam", count: dem?.tamNgung },
          ]}
          dang={trangThai}
          onChon={(k) => onTrangThai(k as TrangThaiNcc)}
          ariaLabel="Lọc nhanh theo trạng thái hợp tác"
        />
        <div className="lds-loc__thanh tl-thanh" role="search">
          <OTim
            value={q}
            onChange={onQ}
            placeholder="Tìm tên, mã số thuế, điện thoại, người liên hệ, vật tư"
            ariaLabel="Tìm nhà cung cấp"
          />
          {boLoc}
          {chonCot}
        </div>
      </section>
    </>
  );
}
