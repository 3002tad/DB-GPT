---
name: funnelmetry-ecommerce-analysis
description: Hướng dẫn phân tích dữ liệu thương mại điện tử Funnelmetry bằng metadata có phiên bản, SQL và các công cụ phân tích sẵn có.
version: 1.0.0
---

# Phân tích dữ liệu Funnelmetry

Áp dụng khi người dùng hỏi về catalog, giỏ hàng, đơn hàng, funnel hoặc hành vi
trong Funnelmetry. Chọn datasource và công cụ phù hợp với câu hỏi; các công cụ,
kỹ năng và workflow khác của DB-GPT vẫn có thể được sử dụng.

1. Xác định nguồn, khoảng thời gian, đơn vị và mức chi tiết cần phân tích. Tra
   cứu semantic catalog hoặc bản Knowledge Base có nguồn và phiên bản tương ứng.
   Khi chưa có bản phù hợp, nêu rõ giới hạn và khám phá schema được cấp quyền.
   Nếu người dùng đã chọn Knowledge Base liên quan, hãy dùng `kb_grep` hoặc
   `kb_cat` để đọc định nghĩa phù hợp và trích dẫn document được trả về. Nếu
   truy hồi không thành công, nói rõ và tiếp tục với nguồn đã kiểm chứng khác.
2. Kiểm tra grain, khóa liên kết, thời gian, coverage và quality của dữ liệu
   trước khi tổng hợp. Chú ý quan hệ nhiều-nhiều giữa sản phẩm, biến thể và
   danh mục để tránh đếm trùng.
3. Dùng SQL chỉ đọc hoặc công cụ sẵn có để khám phá và tính toán. Với metric
   chính thức, dùng đúng định nghĩa, binding và quality/evidence contract đã
   công bố. Phân biệt kết quả khám phá với metric chính thức.
4. Trình bày kết quả cùng nguồn, khoảng thời gian, phiên bản metadata nếu biết,
   trạng thái quality và các giới hạn ảnh hưởng tới kết luận. Không suy đoán giá
   trị bằng 0 khi dữ liệu thiếu hoặc quality bị chặn.

Khi dùng `sql_query`, luôn gửi đầy đủ đối tượng JSON có khóa `sql`, ví dụ
`{"sql":"SELECT ..."}`; không gọi tool nếu chưa có câu SQL. Đối với số sản
phẩm reference hiện tại, `funnelmetry_ai.current_product_summary` cung cấp số
đếm và quality cùng source. `funnelmetry_ai.reference_offer_metadata` cung cấp
định nghĩa/version, không phải nguồn số đếm. Khi trích nguồn hãy phân biệt view
chứa dữ liệu, view metadata và tên datasource. Chỉ nêu KB đã được truy hồi khi
có kết quả retrieval; việc người dùng chọn KB không tự chứng minh đã truy hồi.
Các cột của `current_product_summary` là `source_id`, `status`,
`coverage_epoch_id`, `verified_at`, `valid_until` và `product_count`; không tự
giả định có cột `quality_status`, `source_view` hay `data_source`. Khi dùng view
khác, kiểm tra schema thực tế trước khi chọn tên cột.

`reference.medusa.order_recorded_state` là trạng thái reference hiện tại; nó
không tự chứng minh đơn đã đặt thành công, đã thanh toán, doanh thu hoặc chuyển
đổi. Ngữ cảnh giá/tồn kho CDC chưa xác nhận không mặc nhiên là giá khách thấy
hoặc tồn kho có thể bán. Search là tín hiệu xu hướng, chưa mặc định liên kết
được với cart hoặc toàn bộ funnel.

Các bản metadata trong Knowledge Base chỉ là bản phục vụ truy hồi. PostgreSQL
và semantic catalog của Funnelmetry giữ định nghĩa và số liệu có thẩm quyền;
kiểm tra quality hiện tại khi chạy truy vấn.
