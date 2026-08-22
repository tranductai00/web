# Bảng tỷ lệ hoàn — GitHub Pages + Pancake POS

## Deploy
1. Đưa toàn bộ thư mục này lên repository GitHub.
2. GitHub → Settings → Pages → Deploy from a branch → chọn branch và `/ (root)`.
3. Firebase Authentication → Authorized domains: thêm domain `*.github.io` đang dùng.
4. Publish `firestore.rules`:
   `npx firebase-tools deploy --only firestore:rules --project taidt-904f7`

## Pancake API
- Cấu hình Shop ID, Saved Filter ID, Access Token và mapping trạng thái chỉ ở:
  `bang-ti-le-hoan-admin/`
- Trang người dùng chỉ có chức năng đồng bộ dữ liệu.
- Dữ liệu được lấy theo `saved_filters_id`.
- Adapter Pancake không tính tỷ lệ. Dòng sản phẩm được chuyển về đúng bảng 5 cột rồi đưa vào `window.parseRawOrderSheet()` của source gốc.

## Fix dòng sản phẩm
Endpoint `orders/get_orders` có thể trả bản ghi rút gọn không chứa line items.
Bản này xử lý theo 3 tầng:
1. Lấy danh sách đúng Saved Filter với `es_only=true`.
2. Nếu thiếu sản phẩm, lấy lại cùng trang với `es_only=false` và merge đúng ID đơn.
3. Nếu vẫn thiếu, gọi chi tiết từng đơn `GET /orders/{ORDER_ID}` với giới hạn đồng thời và cache.

Nếu một số đơn vẫn không lấy được item, hệ thống báo rõ số đơn lỗi và không tự bịa sản phẩm.

## Bảo toàn công thức
`index 4.html` là source công thức gốc và không bị sửa.
SHA-256:
`bbfd5d17c232db002d27d6514075c35b8041bb1e27cd1369fe7ca23b7af11e1f`

Upload Excel thủ công và toàn bộ logic tính cũ vẫn sử dụng source này.
