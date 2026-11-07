---
name: funnelmetry-ecommerce-analysis
description: Hướng dẫn phân tích dữ liệu thương mại điện tử Funnelmetry bằng metadata có phiên bản, SQL và các công cụ phân tích sẵn có.
version: 1.0.8
---

# Phân tích dữ liệu Funnelmetry

Áp dụng khi người dùng hỏi về catalog, giỏ hàng, đơn hàng, funnel hoặc hành vi
trong Funnelmetry. Chọn datasource và công cụ phù hợp với câu hỏi; các công cụ,
kỹ năng và workflow khác của DB-GPT vẫn có thể được sử dụng.

1. Xác định nguồn, khoảng thời gian, đơn vị và mức chi tiết cần phân tích. Tra
   semantic catalog hoặc Knowledge Base khớp nguồn và phiên bản. Dùng lại đoạn
   KB đã truy hồi nếu đủ; chỉ đọc thêm khi thiếu định nghĩa. Nếu KB không khả
   dụng, khám phá schema được cấp quyền và nêu giới hạn của kết quả.
2. Kiểm tra grain, khóa nối, fanout, thời gian, coverage và quality trước khi
   tổng hợp. Lấy tên view/cột, relationship và ý nghĩa từng trạng thái từ
   semantic catalog/KB hiện hành và SQL thực tế; không suy đoán từ tên bảng.
3. Dùng SQL chỉ đọc hoặc công cụ đã đăng ký để khám phá và tính toán. Với metric
   chính thức, dùng đúng định nghĩa, binding và quality/evidence contract.
   Khi gọi `sql_query`, truyền đối tượng có khóa `sql` chứa câu truy vấn.
   Phân biệt số liệu khám phá với metric đã công bố. Chỉ chạy script có thật
   trong skill tương ứng; khi tool báo thiếu cột hoặc script, đọc gợi ý và sửa
   lời gọi thay vì lặp nguyên lệnh hoặc đoán tên khác.
4. Giữ nguyên nhãn quality và provenance của kết quả. Trình bày nguồn, grain,
   khoảng thời gian, phiên bản metadata nếu biết và giới hạn ảnh hưởng đến kết
   luận. Không biến dữ liệu thiếu thành số 0, trạng thái reference hiện tại
   thành lịch sử đầy đủ, hay quan sát thô thành metric được xác nhận.

Các số đếm ở grain khác nhau không tự tạo funnel. Chỉ gọi tỷ lệ là conversion
khi có cùng cohort, khóa nối, quy tắc thời gian/thứ tự, loại fanout và contract
metric phù hợp. Khi chưa đủ điều kiện, trình bày các số đếm riêng và dữ kiện
còn thiếu. Không suy ra thanh toán, giao hàng hay doanh thu từ trạng thái đơn
hàng nếu không có evidence vòng đời tương ứng.

Dùng lại schema, coverage và kết quả SQL đã đủ bằng chứng trong cùng lượt phân
tích; chỉ đọc lại khi đầu vào, nguồn, freshness thay đổi hoặc kết quả trước
thiếu/lỗi. Với câu hỏi ngắn, trả lời gọn theo yêu cầu; không tạo báo cáo hoặc
truy vấn lặp ngoài nhu cầu. Trích dẫn KB chỉ khi đã truy hồi thực sự và nêu
document/version được trả về. PostgreSQL cùng semantic catalog của Funnelmetry
là nguồn định nghĩa và số liệu có thẩm quyền; KB là bản dẫn xuất để truy hồi.
