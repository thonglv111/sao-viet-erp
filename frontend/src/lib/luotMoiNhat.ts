// Bỏ kết quả của lượt tải CŨ khi lượt mới đã bắt đầu (lỗi #48 bấm thử 18/10/2026): đổi kỳ / đổi
// lọc liên tiếp thì các lượt gọi về không theo thứ tự gửi, lượt về sau cùng đè state dù nó là lượt
// cũ. `bat()` mở một lượt và trả hàm hỏi "lượt này còn là mới nhất không" để gọi trước mỗi lần ghi.
export function taoLuot(): { bat(): () => boolean } {
  let so = 0;
  return {
    bat() {
      const cua = ++so;
      return () => cua === so;
    },
  };
}
