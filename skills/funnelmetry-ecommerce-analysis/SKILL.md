---
name: funnelmetry-ecommerce-analysis
description: Hướng dẫn phân tích dữ liệu thương mại điện tử Funnelmetry bằng metadata có phiên bản, SQL và các công cụ phân tích sẵn có.
version: 1.0.2
---

# Phân tích dữ liệu Funnelmetry

Áp dụng khi người dùng hỏi về catalog, giỏ hàng, đơn hàng, funnel hoặc hành vi
trong Funnelmetry. Chọn datasource và công cụ phù hợp với câu hỏi; các công cụ,
kỹ năng và workflow khác của DB-GPT vẫn có thể được sử dụng.

1. Xác định nguồn, khoảng thời gian, đơn vị và mức chi tiết cần phân tích. Tra
   cứu semantic catalog hoặc bản Knowledge Base có nguồn và phiên bản tương ứng.
   Khi chưa có bản phù hợp, nêu rõ giới hạn và khám phá schema được cấp quyền.
   Dùng các đoạn KB đã truy hồi trong context nếu đủ để trả lời, trích dẫn
   document/version được trả về. Chỉ dùng thêm công cụ đọc KB khi thiếu hoặc
   chưa rõ định nghĩa. Nếu truy hồi không thành công, nói rõ và tiếp tục với
   nguồn đã kiểm chứng khác.
2. Kiểm tra grain, khóa liên kết, thời gian, coverage và quality của dữ liệu
   trước khi tổng hợp. Chú ý quan hệ nhiều-nhiều giữa sản phẩm, biến thể và
   danh mục để tránh đếm trùng.
3. Dùng SQL chỉ đọc hoặc công cụ sẵn có để khám phá và tính toán. Với metric
   chính thức, dùng đúng định nghĩa, binding và quality/evidence contract đã
   công bố. Phân biệt kết quả khám phá với metric chính thức.
4. Trình bày kết quả cùng nguồn, khoảng thời gian, phiên bản metadata nếu biết,
   trạng thái quality và các giới hạn ảnh hưởng tới kết luận. Không suy đoán giá
   trị bằng 0 khi dữ liệu thiếu hoặc quality bị chặn.

Giữ nguyên nhãn quality do SQL trả về. `REFERENCE_CURRENT_ONLY` chỉ cho phép
kết luận về reference hiện tại; không đổi thành `PASS`. Điều kiện “fresh PASS
lease” trong KB là yêu cầu của contract, không phải bằng chứng runtime đã đạt.
`verified_at`/`valid_until` mô tả thời hạn, không tự chứng minh đầy đủ lịch sử.
`UNVERIFIED` ở view khám phá cho phép thống kê mô tả trên các dòng quan sát
được: ghi rõ số liệu tạm thời, nguồn, grain, khoảng thời gian và giới hạn
coverage. Không kết luận toàn bộ dữ liệu không thể phân tích chỉ vì nhãn này.
Với catalog hoặc ngữ cảnh tồn kho, xem thêm `source_quality_status`,
`source_quality_verified_at` và `source_quality_valid_until`: trạng thái nguồn
`REFERENCE_CURRENT_ONLY` xác nhận phạm vi reference hiện tại theo lease, không
xác nhận lịch sử hay tự biến stock thô thành tồn khả dụng. Khi metric chính
thức bị `BLOCKED_BY_QUALITY`, không thay thế bằng số liệu thô và gọi đó là
metric đã xác nhận; có thể báo cáo riêng quan sát khám phá kèm giới hạn.
Với câu hỏi ngắn, trả lời kết quả, nguồn/grain và giới hạn liên quan; dùng lại
kết quả đã đủ bằng chứng, không truy vấn lặp hoặc tạo báo cáo ngoài yêu cầu.

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

`reference.medusa.order_recorded_state.v2` là bước cuối trong profile
`reference-commerce-current-state@2.0.0`: đếm journey có checkout và terminal
ON sau activation theo coverage epoch hợp lệ. ON có thể bị rút lại khi OFF;
snapshot baseline không tạo ON lịch sử. Medusa có thể để order `pending` khi
đơn đáp ứng predicate reference; trạng thái `pending` tự nó không quyết định ON.
Đây là mốc kết thúc funnel reference, có thể phân tích theo đúng profile và
quality, nhưng chưa chứng minh thanh toán, giao hàng hay doanh thu và không
đồng nhất với metric conversion lịch sử dựa trên `order.placed`. Ngữ cảnh giá/tồn kho CDC chưa xác nhận không mặc nhiên là giá khách thấy
hoặc tồn kho có thể bán. Search là tín hiệu xu hướng, chưa mặc định liên kết
được với cart hoặc toàn bộ funnel.

Khi phân tích order, xem `funnelmetry_explore.order_reference_coverage` theo
nguồn và epoch: `current_state_status` phản ánh lease hiện tại, còn
`historical_gap_status=INCOMPLETE` phản ánh khoảng lịch sử nguồn bị thiếu,
không có nghĩa mỗi order sai. Nếu current state sẵn sàng, có thể phân tích số
order active tại thời điểm hiện tại và nêu gap. Không lấy toàn bộ order active
làm số journey đạt terminal; cần bằng chứng checkout và transition sau
activation. Các mốc `*_received_at` là lúc Pipeline nhận record, không chứng
minh khoảng coverage liên tục hay thời điểm order thực tế. Nếu `gap_start`/
`gap_end` là UNKNOWN, không tự đoán ranh giới thời gian bị thiếu.

Các bản metadata trong Knowledge Base chỉ là bản phục vụ truy hồi. PostgreSQL
và semantic catalog của Funnelmetry giữ định nghĩa và số liệu có thẩm quyền;
kiểm tra quality hiện tại khi chạy truy vấn.
