// Inline stroke-icon set — no icon dependency. Line style (1.75 stroke,
// 24-grid, currentColor) so icons inherit the sidebar text color and the
// rust active state. Add a glyph here, then reference it by name in the nav.
import type { ReactNode, SVGProps } from "react";

const ICONS = {
  // Overview
  grid: (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ),
  // Nội quy công ty — quyển sách đóng gáy. CỐ Ý không dùng lại `clipboard`: glyph đó đã gánh
  // 3 mục khác trong rail (Yêu cầu mua hàng · Loại sản phẩm · Khuôn bế), thêm lần 4 là trùng.
  book: (
    <>
      <path d="M5 4.5a1.5 1.5 0 0 1 1.5-1.5H19v15H6.5A1.5 1.5 0 0 0 5 19.5Z" />
      <path d="M5 19.5A1.5 1.5 0 0 1 6.5 18H19v3H6.5A1.5 1.5 0 0 1 5 19.5Z" />
      <path d="M9 7.5h6M9 11h6" />
    </>
  ),
  // Bài ghép — sheets xếp lớp (nhiều bài chung một tờ in)
  layers: (
    <>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="M3 12l9 5 9-5" />
      <path d="M3 16l9 5 9-5" />
    </>
  ),
  // Sản phẩm
  box: (
    <>
      <path d="M12 2.6 3.7 7v10L12 21.4 20.3 17V7L12 2.6Z" />
      <path d="M3.9 7.2 12 11.8l8.1-4.6" />
      <path d="M12 11.8v9.4" />
    </>
  ),
  // Tính giá thành
  calculator: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <rect x="8" y="6.5" width="8" height="3" rx="0.8" />
      <path d="M8.5 13h.01M12 13h.01M15.5 13h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01" />
    </>
  ),
  // Báo giá in ấn
  fileText: (
    <>
      <path d="M14 2.6H7A2 2 0 0 0 5 4.6v14.8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.6Z" />
      <path d="M14 2.6V7.6h5" />
      <path d="M8.5 13h7M8.5 16.5h7" />
    </>
  ),
  // Hợp đồng
  fileCheck: (
    <>
      <path d="M14 2.6H7A2 2 0 0 0 5 4.6v14.8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.6Z" />
      <path d="M14 2.6V7.6h5" />
      <path d="m9 14.6 2 2 4-4.2" />
    </>
  ),
  // Đơn hàng bán
  cart: (
    <>
      <circle cx="9.2" cy="20" r="1.4" />
      <circle cx="17" cy="20" r="1.4" />
      <path d="M2.5 3h2.2l2.3 11.3a1.5 1.5 0 0 0 1.5 1.2h8.2a1.5 1.5 0 0 0 1.5-1.2L20.6 7H6.1" />
    </>
  ),
  // Khách hàng
  users: (
    <>
      <path d="M15.5 20v-1.6a3.8 3.8 0 0 0-3.8-3.8H6.3a3.8 3.8 0 0 0-3.8 3.8V20" />
      <circle cx="9" cy="7.5" r="3.4" />
      <path d="M21.5 20v-1.6a3.8 3.8 0 0 0-2.9-3.7" />
      <path d="M15.5 4.2a3.8 3.8 0 0 1 0 7.3" />
    </>
  ),
  // Theo dõi sản xuất
  activity: <path d="M3 12h3.6l2.6-7.2 5 14.4 2.6-7.2H21" />,
  // Lệnh sản xuất
  clipboard: (
    <>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
      <rect x="8.75" y="2.5" width="6.5" height="3.8" rx="1.2" />
      <path d="M9 11h6M9 14.6h6M9 18.2h3.5" />
    </>
  ),
  // Kế hoạch SX
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 9.8h17" />
      <path d="M8.5 2.6v4.4M15.5 2.6v4.4" />
    </>
  ),
  // Kho
  warehouse: (
    <>
      <path d="M3 8.6 12 4l9 4.6" />
      <path d="M5 10.4V20h14v-9.6" />
      <rect x="9" y="13.5" width="6" height="6.5" />
    </>
  ),
  // Kho kỹ thuật số
  database: (
    <>
      <ellipse cx="12" cy="5.8" rx="7.5" ry="3.1" />
      <path d="M4.5 5.8v6.2c0 1.7 3.36 3.1 7.5 3.1s7.5-1.4 7.5-3.1V5.8" />
      <path d="M4.5 12v6.2c0 1.7 3.36 3.1 7.5 3.1s7.5-1.4 7.5-3.1V12" />
    </>
  ),
  // Mua hàng
  bag: (
    <>
      <path d="M5.2 8h13.6l-1 12.2a1.2 1.2 0 0 1-1.2 1.1H7.4a1.2 1.2 0 0 1-1.2-1.1Z" />
      <path d="M8.5 8V6.4a3.5 3.5 0 0 1 7 0V8" />
    </>
  ),
  // Nhà cung cấp
  truck: (
    <>
      <rect x="2.5" y="6.5" width="11" height="9.5" rx="1" />
      <path d="M13.5 9.5h3.7l3.3 3.3V16h-7Z" />
      <circle cx="6.6" cy="18.2" r="1.7" />
      <circle cx="17" cy="18.2" r="1.7" />
    </>
  ),
  // Vai trò (roles / permissions)
  shield: (
    <>
      <path d="M12 2.6 5 5.4v5.2c0 4.3 3 7.6 7 8.8 4-1.2 7-4.5 7-8.8V5.4L12 2.6Z" />
      <path d="m9 11.6 2 2 4-4.2" />
    </>
  ),
  // Phòng ban (departments)
  building: (
    <>
      <rect x="3" y="4" width="11" height="17" rx="1" />
      <path d="M14 9h6a1 1 0 0 1 1 1v11h-7" />
      <path d="M6.5 8h4M6.5 12h4M6.5 16h4" />
      <path d="M17 13h1M17 17h1" />
    </>
  ),
  // Thông báo (chuông)
  bell: (
    <>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 6-2.5 7.5-2.5 7.5h17S18 14.5 18 8.5Z" />
      <path d="M10.3 20a2 2 0 0 0 3.4 0" />
    </>
  ),
  // Row actions
  eye: (
    <>
      <path d="M2.8 12s3.35-6.7 9.2-6.7 9.2 6.7 9.2 6.7-3.35 6.7-9.2 6.7-9.2-6.7-9.2-6.7Z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  printer: (
    <>
      <path d="M6.5 9V3.5h11V9" />
      <rect x="4" y="9" width="16" height="8" rx="2" />
      <path d="M7 14.5h10v6H7z" />
      <path d="M16.5 12h.01" />
    </>
  ),
  pencil: (
    <>
      <path d="m4 20 4.2-1 10.6-10.6a2 2 0 0 0-2.8-2.8L5.4 16.2Z" />
      <path d="m14.5 7.1 2.8 2.8M4 20l1.4-3.8 2.8 2.8Z" />
    </>
  ),
  send: (
    <>
      <path d="m21 3-7.4 18-3.1-7.5L3 10.4Z" />
      <path d="M10.5 13.5 21 3" />
    </>
  ),
  check: <path d="m4.5 12.5 4.7 4.7L19.8 6.8" />,
  x: <path d="m6 6 12 12M18 6 6 18" />,
  packageCheck: (
    <>
      <path d="M12 2.8 4 7v10l8 4.2 8-4.2V7Z" />
      <path d="M4.2 7.2 12 11.5l7.8-4.3M12 11.5v9.3" />
      <path d="m8.3 5 7.8 4.3" />
      <path d="m14.8 15.6 1.4 1.4 2.8-3" />
    </>
  ),
  ban: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m5.6 5.6 12.8 12.8" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15M9 7V4h6v3M7 7l.8 13h8.4L17 7" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  // Khóa dòng lịch (đã chốt máy + giờ)
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
      <path d="M12 14.5v2.5" />
    </>
  ),
  // Mở khóa
  lockOpen: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 7.7-1.5" />
      <path d="M12 14.5v2.5" />
    </>
  ),
  // Ẩn/hiện nhóm cột (menu "Cột")
  columns: (
    <>
      <rect x="3.5" y="4" width="17" height="16" rx="2" />
      <path d="M9.5 4v16M15 4v16" />
    </>
  ),
  // Affordance
  chevron: <path d="m6 9 6 6 6-6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  phone: (
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  ),
  mail: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="m3 6 9 7 9-7" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  mapPin: (
    <>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
      <circle cx="12" cy="10" r="3" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <path d="M8.7 8.3 20 18M8.7 15.7 20 6" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.3 9.3a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.3-2.7 3.9" />
      <path d="M12 17.2h.01" />
    </>
  ),
  camera: (
    <>
      <path d="M14.5 4h-5L8 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4l-1.5-3Z" />
      <circle cx="12" cy="13" r="3" />
    </>
  ),
  alert: (
    <>
      <path d="M12 9v4M12 17h.01" />
      <path d="m10.29 3.86-8.6 15A1 1 0 0 0 2.56 20.36h18.88a1 1 0 0 0 .87-1.5l-8.6-15a1 1 0 0 0-1.72 0z" />
    </>
  ),
  zap: (
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4M12 8h.01" />
    </>
  ),
  barChart: (
    <>
      <path d="M12 20V10M18 20V4M6 20v-6" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  refresh: (
    <>
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19" />
    </>
  ),
  // Quy trình / luồng: hai nút trái gộp vào một nút phải
  workflow: (
    <>
      <rect x="3" y="3.5" width="6.5" height="5.5" rx="1.3" />
      <rect x="3" y="15" width="6.5" height="5.5" rx="1.3" />
      <rect x="14.5" y="9.25" width="6.5" height="5.5" rx="1.3" />
      <path d="M9.5 6.25h2.5a2 2 0 0 1 2 2v3.75" />
      <path d="M9.5 17.75h2.5a2 2 0 0 0 2-2v-1.75" />
    </>
  ),
  // Mũi tên hướng phải
  arrowRight: <path d="M5 12h14M13 5l7 7-7 7" />,
  // Maximize / Focus
  maximize: (
    <>
      <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />
    </>
  ),
  edit: (
    <>
      <path d="m4 20 4.2-1 10.6-10.6a2 2 0 0 0-2.8-2.8L5.4 16.2Z" />
      <path d="m14.5 7.1 2.8 2.8" />
    </>
  ),
  cpu: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M15 2v2M9 2v2M15 20v2M9 20v2M20 15h2M20 9h2M2 15h2M2 9h2" />
    </>
  ),
  minus: <path d="M5 12h14" />,
  table: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
    </>
  ),
  layout: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </>
  ),
  // Bánh răng cấu hình. CỐ Ý tách khỏi `edit`: `edit` là sửa nội dung một bản ghi, còn glyph này
  // là chỉnh tham số của cả khối (khổ giấy, hao hụt…), hai nghĩa khác nhau trong sơ đồ bài ghép.
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.28 7l1.9 1.1M17.82 15.9l1.9 1.1M4.28 17l1.9-1.1M17.82 8.1l1.9-1.1" />
    </>
  ),
  // Mắt xích — bước thuộc LSX khác (phụ thuộc chéo lệnh) trên sơ đồ DAG.
  link: (
    <>
      <path d="M10.5 13.5a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.66-5.66l-1.3 1.3" />
      <path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2.6 2.6a4 4 0 0 0 5.66 5.66l1.3-1.3" />
    </>
  ),
  // Mắt xích ĐỨT — tách lượt chạy chung, mỗi lệnh lấy lại bước của chính nó.
  unlink: (
    <>
      <path d="M14.4 9.6a4 4 0 0 1 0 5.66l-2.1 2.1a4 4 0 0 1-5.66-5.66l1-1" />
      <path d="M9.6 14.4a4 4 0 0 1 0-5.66l2.1-2.1a4 4 0 0 1 5.66 5.66l-1 1" />
      <path d="M3.5 3.5 6 6M20.5 20.5 18 18" />
    </>
  ),
  // Mũi tên vòng ngược — dựng lại / xếp lại từ đầu.
  rotateCcw: (
    <>
      <path d="M3 12a9 9 0 1 0 2.64-6.36L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  // Toàn màn hình — mũi tên chéo bung ra 2 góc. Khác `maximize` (4 ngoặc góc = căn vừa khung nhìn).
  fullscreen: (
    <>
      <path d="M14 4h6v6M20 4l-7 7" />
      <path d="M10 20H4v-6M4 20l7-7" />
    </>
  ),
  play: <path d="M7 4.5v15l13-7.5-13-7.5Z" />,
  pause: (
    <>
      <path d="M8.5 4.5v15M15.5 4.5v15" />
    </>
  ),
  square: <rect x="5" y="5" width="14" height="14" rx="1.5" />,
  // Tay cầm kéo thả 6 chấm
  // Ba chấm ngang — nút "thao tác khác" mở menu của một hàng.
  more: (
    <>
      <circle cx="5" cy="12" r="1.2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
      <circle cx="19" cy="12" r="1.2" fill="currentColor" />
    </>
  ),
  grip: (
    <>
      <circle cx="9" cy="12" r="1" fill="currentColor" />
      <circle cx="9" cy="6" r="1" fill="currentColor" />
      <circle cx="9" cy="18" r="1" fill="currentColor" />
      <circle cx="15" cy="12" r="1" fill="currentColor" />
      <circle cx="15" cy="6" r="1" fill="currentColor" />
      <circle cx="15" cy="18" r="1" fill="currentColor" />
    </>
  ),
  // Tệp đính kèm: kẹp giấy (nhãn tab/khối) · tải lên · tải về.
  paperclip: (
    <>
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </>
  ),
  // Lọc trạng thái — quả cầu (thay emoji 🌐: emoji đổi hình theo font từng máy, máy thiếu font
  // emoji thì ra ô vuông tofu — cùng lý do đã ghi ở SaoNcc.tsx)
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.4 3.8 5.5 3.8 9S14.5 18.6 12 21c-2.5-2.4-3.8-5.5-3.8-9S9.5 5.4 12 3Z" />
    </>
  ),
  // Lọc theo sao — ngôi sao nét, cùng hình với sao trong SaoNcc
  star: (
    <path d="m12 3.2 2.7 5.6 6.1.85-4.45 4.3 1.08 6.05L12 17.15l-5.43 2.87 1.08-6.05L3.2 9.65l6.1-.85Z" />
  ),
  // Huy hiệu "Đối tác Uy tín" (thay emoji 🏆)
  trophy: (
    <>
      <path d="M7 3.5h10v6a5 5 0 0 1-10 0Z" />
      <path d="M7 5H4v1.5A3.5 3.5 0 0 0 7.5 10M17 5h3v1.5A3.5 3.5 0 0 1 16.5 10" />
      <path d="M12 14.5v3M8 20.5h8" />
    </>
  ),
  // Gợi ý / mách nước (thay emoji 💡)
  bulb: (
    <>
      <path d="M9.2 16.5a6 6 0 1 1 5.6 0" />
      <path d="M9.5 16.5h5M10 19.5h4M10.5 22h3" />
    </>
  ),
  upload: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5M12 3v12" />
    </>
  ),
  download: (
    <>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5M12 15V3" />
    </>
  ),

  // ---- Rail điều hướng: MỖI MỤC MỘT GLYPH (05/10/2026) -------------------------------------
  // Trước đó cả rail xoay vòng ~12 glyph (users ×3, truck ×3, bag ×4, activity ×4…) nên nhìn icon
  // không đoán được mục. Các glyph dưới đây chỉ thêm, KHÔNG sửa glyph cũ — glyph cũ còn được
  // hàng chục màn dùng làm nhãn khối/nút.
  userCircle: (
    <>
      <circle cx="12" cy="12" r="9.25" />
      <circle cx="12" cy="10" r="3.4" />
      <path d="M6.4 19.2a6.2 6.2 0 0 1 11.2 0" />
    </>
  ),
  // Giao hàng — tuyến của lượt xe qua nhiều điểm giao
  route: (
    <>
      <circle cx="6" cy="18.5" r="2.5" />
      <circle cx="18" cy="5.5" r="2.5" />
      <path d="M8.5 18.5h8.25a3.25 3.25 0 0 0 0-6.5H7.25a3.25 3.25 0 0 1 0-6.5h8.25" />
    </>
  ),
  // Khách hàng — người + ngôi sao nhỏ (khách quen)
  contact: (
    <>
      <circle cx="9.5" cy="8" r="3.75" />
      <path d="M3 20.5v-1a5.5 5.5 0 0 1 9.4-3.9" />
      <path d="m17.5 13.2 1.2 2.4 2.6.4-1.9 1.85.45 2.6-2.35-1.25-2.35 1.25.45-2.6L13.7 16l2.6-.4Z" />
    </>
  ),
  // Kế hoạch sản xuất — bảng kẹp có danh sách việc
  clipboardList: (
    <>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
      <rect x="8.75" y="2.5" width="6.5" height="3.8" rx="1.2" />
      <path d="M12 11h4M12 15.5h4M8.5 11h.01M8.5 15.5h.01" />
    </>
  ),
  // Hồ sơ lệnh sản xuất — tập hồ sơ mở
  folderOpen: (
    <>
      <path d="M3 18.5V5.5A1.5 1.5 0 0 1 4.5 4h4.1a1.5 1.5 0 0 1 1.2.6l1.1 1.4h7.6A1.5 1.5 0 0 1 20 7.5V9.5" />
      <path d="M3 18.5 5.6 11a1.5 1.5 0 0 1 1.42-1h13.4a1 1 0 0 1 .95 1.3l-2.3 7.2a1.5 1.5 0 0 1-1.43 1H4.5A1.5 1.5 0 0 1 3 18.5Z" />
    </>
  ),
  // Theo dõi sản xuất — đồng hồ đo
  gauge: (
    <>
      <path d="M3.5 17a9 9 0 1 1 17 0" />
      <path d="m12 14 4-5" />
      <circle cx="12" cy="14.5" r="1.4" />
      <path d="M6.2 12h.01M12 6.5h.01M17.8 12h.01" />
    </>
  ),
  // Xếp lịch — biểu đồ Gantt
  gantt: (
    <>
      <path d="M3.5 3.5v15a2 2 0 0 0 2 2h15" />
      <path d="M8 7.5h7M11 12h7.5M9 16.5h5" />
    </>
  ),
  // Tổ sản xuất — mũ bảo hộ
  hardHat: (
    <>
      <path d="M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5" />
      <path d="M14 6a6 6 0 0 1 6 6v3" />
      <path d="M4 15v-3a6 6 0 0 1 6-6" />
      <rect x="2" y="15" width="20" height="4" rx="1" />
    </>
  ),
  // KCS — huy hiệu đạt chuẩn
  badgeCheck: (
    <>
      <path d="M12 2.8 14.3 4.4l2.8-.1.9 2.65 2.25 1.7-.85 2.7.85 2.7-2.25 1.7-.9 2.65-2.8-.1L12 21.2l-2.3-1.6-2.8.1-.9-2.65-2.25-1.7.85-2.7-.85-2.7L6 6.95l.9-2.65 2.8.1Z" />
      <path d="m8.8 12.2 2.2 2.2 4.2-4.4" />
    </>
  ),
  // Sửa chữa máy — cờ lê
  wrench: (
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.4-3.4a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9Z" />
  ),
  // Phiếu bảo trì — bảng kẹp có dấu tích
  clipboardCheck: (
    <>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
      <rect x="8.75" y="2.5" width="6.5" height="3.8" rx="1.2" />
      <path d="m9 13.5 2.2 2.2 4-4.2" />
    </>
  ),
  // Yêu cầu mua hàng — tờ giấy có dấu cộng
  filePlus: (
    <>
      <path d="M14 2.6H7A2 2 0 0 0 5 4.6v14.8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.6Z" />
      <path d="M14 2.6V7.6h5" />
      <path d="M12 11.5v6M9 14.5h6" />
    </>
  ),
  // Nhà cung cấp — cửa hàng có mái hiên
  store: (
    <>
      <path d="M3.5 8.5 5 4h14l1.5 4.5" />
      <path d="M3.5 8.5a2.83 2.83 0 0 0 5.67 0 2.83 2.83 0 0 0 5.66 0 2.83 2.83 0 0 0 5.67 0" />
      <path d="M5 11.2V20h14v-8.8" />
      <path d="M9.5 20v-4.5h5V20" />
    </>
  ),
  // Đơn mua hàng (kế toán DUYỆT) — con dấu
  stamp: (
    <>
      <path d="M5 21h14" />
      <path d="M4 15.5A2.5 2.5 0 0 1 6.5 13h11a2.5 2.5 0 0 1 2.5 2.5V17a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z" />
      <path d="M14 13V8.6c0-1.4 1-1.6 1-3.6a3 3 0 0 0-6 0c0 2 1 2.2 1 3.6V13" />
    </>
  ),
  // Phiếu chi / Phiếu thu — tờ tiền + mũi tên ra / vào
  banknoteOut: (
    <>
      <path d="M12 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4.5" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M6 12h.01M19 22v-6M16 19l3-3 3 3" />
    </>
  ),
  banknoteIn: (
    <>
      <path d="M12 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4.5" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M6 12h.01M19 16v6M16 19l3 3 3-3" />
    </>
  ),
  // Công nợ phải trả — ví
  wallet: (
    <>
      <path d="M19 7.5V5a1 1 0 0 0-1-1H5.5a2 2 0 0 0 0 4H20a1 1 0 0 1 1 1v3" />
      <path d="M3.5 6v12.5a2 2 0 0 0 2 2H20a1 1 0 0 0 1-1v-3" />
      <path d="M21 12h-3.5a2 2 0 0 0 0 4H21Z" />
    </>
  ),
  // Công nợ phải thu — bàn tay nhận xu
  handCoins: (
    <>
      <path d="M11 15h2a2 2 0 1 0 0-4h-3c-.6 0-1.1.2-1.4.6L3 17" />
      <path d="m7 21 1.6-1.4c.3-.4.8-.6 1.4-.6h4c1.1 0 2.1-.4 2.8-1.2l4.6-4.4a2 2 0 0 0-2.75-2.9l-4.2 3.9" />
      <path d="m2 16 6 6" />
      <circle cx="16" cy="9" r="2.9" />
      <circle cx="6" cy="5" r="3" />
    </>
  ),
  // Tài khoản ngân hàng — toà nhà ngân hàng
  landmark: (
    <>
      <path d="M3 21h18M5 18h14" />
      <path d="M6.5 18v-7M10 18v-7M14 18v-7M17.5 18v-7" />
      <path d="M12 2.8 3.5 7.5V9h17V7.5Z" />
    </>
  ),
  // Yêu cầu nhập xuất kho — hai chiều vào/ra
  transfer: (
    <>
      <path d="M8 3 4 7l4 4" />
      <path d="M4 7h16" />
      <path d="m16 21 4-4-4-4" />
      <path d="M20 17H4" />
    </>
  ),
  // Báo cáo kinh doanh (doanh số theo kỳ) · Báo cáo kho (nhập–xuất theo kho)
  chartLine: (
    <>
      <path d="M3.5 3.5v15a2 2 0 0 0 2 2h15" />
      <path d="m19 8.5-5 5-4-4-3 3" />
    </>
  ),
  chartColumn: (
    <>
      <path d="M3.5 3.5v15a2 2 0 0 0 2 2h15" />
      <path d="M8 16.5v-3M12.5 16.5V7M17 16.5v-6" />
    </>
  ),
  // Công đoạn — danh sách có đánh số thứ tự
  listOrdered: (
    <>
      <path d="M10 6h11M10 12h11M10 18h11" />
      <path d="M4 6h1v4M4 10h2" />
      <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
    </>
  ),
  // Đơn vị & quy đổi — thước kẻ
  ruler: (
    <>
      <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z" />
      <path d="m14.5 12.5 2-2M11.5 9.5l2-2M8.5 6.5l2-2M17.5 15.5l2-2" />
    </>
  ),
  // Giấy — chồng tờ
  paper: (
    <>
      <rect x="4" y="6.5" width="12.5" height="15" rx="1.5" />
      <path d="M7.5 6.5V4a1.5 1.5 0 0 1 1.5-1.5h9.5A1.5 1.5 0 0 1 20 4v12.5a1.5 1.5 0 0 1-1.5 1.5h-2" />
      <path d="M7 11h6.5M7 14.5h6.5M7 18h4" />
    </>
  ),
  // Tiêu chí KCS — danh sách có tích
  listChecks: (
    <>
      <path d="m3 6.5 1.6 1.6L8 4.8M3 15.5l1.6 1.6L8 13.8" />
      <path d="M12 6.5h9M12 12h9M12 17.5h9" />
    </>
  ),
  // Phòng ban — sơ đồ tổ chức
  network: (
    <>
      <rect x="9" y="2.5" width="6" height="5.5" rx="1" />
      <rect x="2.5" y="16" width="6" height="5.5" rx="1" />
      <rect x="15.5" y="16" width="6" height="5.5" rx="1" />
      <path d="M12 8v4M5.5 16v-3a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v3" />
    </>
  ),
  // Hồ sơ nhân sự — thẻ nhân viên
  idCard: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <circle cx="8.5" cy="10.5" r="2" />
      <path d="M5.4 15.5a3.3 3.3 0 0 1 6.2 0" />
      <path d="M14.5 10h4M14.5 13.5h4" />
    </>
  ),
  // Nghỉ phép — lịch có dấu gạch chéo (ngày nghỉ)
  calendarX: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 9.8h17M8.5 2.6v4.4M15.5 2.6v4.4" />
      <path d="m10 13.3 4 4M14 13.3l-4 4" />
    </>
  ),
  // Tăng ca — đồng hồ cộng thêm giờ
  clockPlus: (
    <>
      <path d="M21.4 13.3a9.25 9.25 0 1 0-8.1 8.1" />
      <path d="M12 7v5l3 1.8" />
      <path d="M16 19h6M19 16v6" />
    </>
  ),
  // Lương — chồng xu
  coins: (
    <>
      <circle cx="8.5" cy="8.5" r="6" />
      <path d="M18.1 10.4a6 6 0 1 1-7.7 7.7" />
      <path d="M7.5 6.5h1v4" />
      <path d="m16.7 13.9.7.7-2.8 2.8" />
    </>
  ),
  // Đơn hàng bán — đơn sinh khi khách chốt, đi tới hoá đơn: tờ hoá đơn răng cưa
  receipt: (
    <>
      <path d="M4 2.5v19l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1v-19l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M15.5 8h-7M15.5 12h-7M13 16H8.5" />
    </>
  ),
  // Kế hoạch vật tư — bảng CÂN ĐỐI cần / có / thiếu
  scale: (
    <>
      <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
      <path d="M7 21h10M12 3v18" />
      <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
    </>
  ),
  // Chấm công — bấm VÀO/RA theo GPS, phải đứng trong bán kính điểm làm việc
  mapPinCheck: (
    <>
      <path d="M19.4 12.9c.4-1 .6-1.95.6-2.9a8 8 0 0 0-16 0c0 5 5.54 10.2 7.4 11.8a1 1 0 0 0 1.2 0l.8-.73" />
      <circle cx="12" cy="10" r="3" />
      <path d="m16 18.5 2 2 4-4" />
    </>
  ),
  // Khuôn — tấm khuôn bế: ván có đường dao (nét đứt) theo hình hộp trải phẳng, nét liền là nét gấp
  dieCut: (
    <>
      <rect x="2" y="2.5" width="20" height="19" rx="2" />
      <path d="M4 9.5h4V6h4v3.5h8v5h-4V18h-4v-3.5H4Z" strokeDasharray="1.8 1.5" />
      <path d="M8 9.5v5M12 9.5v5M16 9.5v5" strokeWidth={1.1} />
    </>
  ),
  // Vật tư khác (mực · keo · màng · kẽm) — hộp/lon vật tư tiêu hao
  canister: (
    <>
      <rect x="5" y="3" width="14" height="3" rx="1" />
      <path d="M6 6v13.5A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V6" />
      <path d="M6 10h12M6 17h12" />
      <path d="M12 11.6c-.9 1-1.35 1.65-1.35 2.2a1.35 1.35 0 0 0 2.7 0c0-.55-.45-1.2-1.35-2.2Z" />
    </>
  ),
  // Thiết bị & Máy móc — máy in khổ rộng (máy in offset là phần lớn danh mục máy): khay nạp tờ,
  // thân máy có khe lô, tờ ra phía dưới. Khác `printer` (máy in văn phòng, nút In ở các màn).
  machine: (
    <>
      <path d="M6.5 7V3.5h11V7" />
      <rect x="2" y="7" width="20" height="9.5" rx="2" />
      <path d="M5.5 11h13M18.5 13.5h.01" />
      <path d="M6.5 16.5v4h11v-4" />
    </>
  ),
  // Tài sản & CCDC — máy móc, dụng cụ xưởng dùng nhiều năm: hộp đồ nghề
  toolbox: (
    <>
      <rect x="2.5" y="8" width="19" height="12" rx="2" />
      <path d="M8.5 8V5.5A1.5 1.5 0 0 1 10 4h4a1.5 1.5 0 0 1 1.5 1.5V8" />
      <path d="M2.5 13h19M7.5 11.5v3M16.5 11.5v3" />
    </>
  ),
  // Khai báo kho — khai kho + kệ/ô cất hàng: giá kệ có thùng
  shelves: (
    <>
      <path d="M4 3v18M20 3v18M4 9h16M4 15h16M4 21h16" />
      <rect x="7" y="5" width="4.5" height="4" rx=".5" />
      <rect x="12.5" y="11" width="4.5" height="4" rx=".5" />
      <rect x="7" y="17" width="4.5" height="4" rx=".5" />
    </>
  ),
  // Báo cáo công nợ — sổ tổng hợp / sổ chi tiết 331 · 131 kiểu MISA
  bookOpen: (
    <>
      <path d="M12 7v14" />
      <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3Z" />
      <path d="M5.5 8h3M5.5 12h3M15.5 8h3M15.5 12h3" />
    </>
  ),
  // Nội quy công ty — văn bản quy định: cuộn giấy
  scrollText: (
    <>
      <path d="M15 8h-5M15 12h-5" />
      <path d="M19 17V5a2 2 0 0 0-2-2H4" />
      <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
    </>
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICONS;

export function Icon({
  name,
  size = 18,
  ...rest
}: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {ICONS[name]}
    </svg>
  );
}
