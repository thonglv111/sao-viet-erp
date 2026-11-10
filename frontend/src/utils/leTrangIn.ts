/**
 * CSS khổ + lề trang cho các tờ in mở bằng cửa sổ riêng (`window.open` + `document.write`).
 *
 * Lề của TRÌNH DUYỆT (`@page margin`) để bằng 0: Chrome in giờ, tiêu đề trang, đường dẫn và số
 * trang vào chính dải lề đó khi ô "Đầu trang và chân trang" trong hộp in đang tick — tờ gửi
 * khách dính "about:blank" hay tên hệ thống (07/11/2026). Lề 0 thì không còn chỗ in.
 *
 * Lề thật chuyển thành padding của `body`, lặp lại ở MỖI trang nhờ `box-decoration-break:
 * clone` — thiếu nó thì tờ dài sang trang 2 dính sát mép giấy. Selector `html body` để thắng
 * mọi luật `body{padding:0}` của từng tờ, dù đứng trước hay sau.
 */
export function leTrangIn(kho: string, le: string): string {
  return `@page{size:${kho};margin:0}`
    + `html body{padding:${le};-webkit-box-decoration-break:clone;box-decoration-break:clone}`;
}
