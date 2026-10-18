/** Tên mặt hàng xuất hiện ở từ hai dòng trở lên trong danh sách đang bày. Ô Vật tư chỉ hiện tên;
 *  thành phẩm thuộc khách nên hai khách có thể cùng tên ("Sách A5 64 trang"), khi đó dòng phải kèm
 *  mã thì kho mới phân biệt được. */
export function tenTrungLap(ds: readonly { name?: string | null }[]): Set<string> {
  const dem = new Map<string, number>();
  for (const g of ds) {
    if (g.name) dem.set(g.name, (dem.get(g.name) ?? 0) + 1);
  }
  return new Set([...dem].filter(([, n]) => n > 1).map(([ten]) => ten));
}
