---
name: funnelmetry-ecommerce-analysis
description: Hướng dẫn phân tích dữ liệu thương mại điện tử Funnelmetry bằng metadata có phiên bản, SQL và các công cụ phân tích sẵn có.
version: 1.0.19
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

Ở lượt hỏi tiếp, xem inventory kết quả đã capture của cùng hội thoại trước khi
tính lại. Khi có tool `session_evidence`, tra artifact theo nguồn/cột/nhãn rồi
đọc số đo đã lưu bằng `artifact_id` và `read_values=true`; bảng SQL dùng
`sql_result_frame(artifact_id)` khi Python khả dụng. Đối chiếu nguồn, grain,
bộ lọc, cửa sổ thời gian và độ mới; giá trị đã lưu không tự thành metric được
chứng nhận. Inventory bị cắt vẫn có phân trang/tìm kiếm. Chỉ query phần thiếu,
đổi phạm vi hoặc cần refresh; không dựng phân bố chi tiết từ tổng hợp cũ.

Giữ đúng định dạng đầu ra người dùng yêu cầu: CSV/PNG hoặc trả lời trong chat
không kéo theo báo cáo HTML. Công cụ báo cáo vẫn dùng được khi cần. Nếu kết
xuất báo cáo lỗi, giữ phần phân tích và tệp đã tạo; nêu ngắn gọn phần chưa
hoàn thành, để chẩn đoán kỹ thuật trong các bước thực thi.

Trước khi kết luận, đối chiếu từng số và mẫu số với kết quả tool cùng phạm vi;
nếu có kết quả mâu thuẫn, kiểm tra lại điều kiện truy vấn hoặc nêu rõ chưa
xác định, không tự chọn hay tính nhẩm. Tính tỷ lệ bằng SQL hoặc công cụ tính.
Mỗi tỷ lệ cần kèm tử số, mẫu số và cùng dataset/khoảng thời gian. Tính xong
bằng tool rồi mới đưa số vào câu trả lời hoặc nội dung tiến độ; trước đó chỉ
nêu truy vấn dự kiến, không ghi “đã chạy”. Nếu truy vấn lỗi, sửa và đối chiếu
artifact thành công; không dùng SQL lỗi hoặc kết quả tự đoán để dẫn chứng.
Khi trình bày phân bố theo nhóm, giữ riêng nhóm SQL NULL, chuỗi rỗng và các
giá trị raw; không gộp chúng thành “khác” hay bỏ khỏi bảng mà không nói rõ.
Nếu chỉ trình bày nhóm người dùng yêu cầu hoặc top-N, ghi rõ đây là tập con;
mẫu số vẫn theo phạm vi đã chọn, không tự đổi sang tổng các nhóm hiển thị.
Đối chiếu tổng nhóm với tổng cùng grain, bộ lọc và khoảng thời gian bằng SQL
hoặc tool khi cần kết luận coverage; không cộng các subtotal/total chồng lấn.
COUNT(cột) bỏ NULL, còn COUNT(*) đếm dòng: chọn đúng theo grain và mẫu số.
Dấu hiệu result_coverage của sql_query chỉ mô tả các dòng được trả về, không
chứng nhận coverage của bảng nguồn hoặc lịch sử. Nếu preview bị cắt, dùng
artifact đầy đủ hoặc truy vấn tổng hợp gọn để đối chiếu trước khi kết luận.
Ở lượt hỏi tiếp, dùng lại artifact thành công đủ phạm vi; chỉ truy vấn thêm
phần còn thiếu hoặc cần cập nhật freshness. Nếu phải chạy lại, nêu lý do;
không đổi cách viết SQL chỉ để tính lại cùng số liệu đã có.
Khi chuyển sang Python, đọc kết quả đã capture bằng
`df = sql_result_frame('sql-<artifact_id>')` theo gợi ý `python_input` của SQL;
`print(SQL_RESULT_CATALOG)` cho biết ID, câu SQL và cột đang có trong phiên.
Không chép các dòng preview thành literal để phân tích nguồn. Ghi artifact ID
trong comment hoặc REPORT_RESULT không thay thế việc đọc đầu vào thật. Dữ liệu
mẫu tự tạo vẫn dùng được để thử nghiệm, nhưng phải ghi rõ phạm vi đó.
Khi xuất CSV/PNG/JSON bằng Python, dùng `output_path('exports/summary.csv')`
hoặc `output_path('plots/chart.png')`: helper tạo thư mục con trong OUTPUT_DIR
của hội thoại, không đoán đường dẫn `/app/workspace`. Gán REPORT_RESULT trực tiếp;
nếu cần in hoặc ghi JSON, dùng `result_json(REPORT_RESULT)` để chuẩn hóa kiểu
NumPy/Decimal/ngày theo contract capture, không dùng `default=str` để đổi số
hoặc boolean thành chuỗi. Mỗi lần gọi Python có biến mới; tệp trong workspace
cùng phiên được giữ lại.
Tool trả `saved_result` chứa kết quả REPORT_RESULT đã capture (có cờ truncated);
dùng ngay khi đủ phạm vi, không tính lại chỉ để in kết quả hoặc chuyển thành
JSON. `session_evidence(artifact_id=..., read_values=true)` đọc lại kết quả đã
lưu cùng nhãn/ngày. CSV đã capture trong workspace có thể đọc lại bằng
`pd.read_csv`; tool đối chiếu checksum tệp thực đọc để nối lineage. Không cần
query lại DB chỉ để dựng biểu đồ từ CSV đó. PNG được tool tự công bố khi chạy
thành công; dùng URL được trả về, không tìm thêm tool publish ảnh.
SQL date có thể đã là `datetime.date`; chuẩn hóa cột/index bằng
`pd.to_datetime` trước khi dùng `.dt` hoặc API Timestamp. Khi nhóm NULL, giữ
giá trị thiếu và cờ `is_null` riêng trong dữ liệu xuất; chỉ đổi nhãn hiển thị,
không dùng một chuỗi sentinel có thể trùng với giá trị raw thật. Với CSV có cờ
NULL riêng, dùng `keep_default_na=False` khi đọc nhãn raw rồi áp dụng cờ đó,
để chuỗi rỗng hay nhãn như `NA` không bị pandas tự chuyển thành NULL.
Không giải thích mùa thấp bằng ranh giới fixture hay chiến dịch khi chưa có
bằng chứng tương ứng; ghi rõ giả thuyết nếu cần đề xuất cách kiểm tra.
Chỉ giải thích trạng thái theo định nghĩa đã truy hồi; không tự mở rộng tên viết
tắt hoặc suy diễn chất lượng từ trạng thái. Giữ kết quả tool gọn, chỉ lấy các
cột và dòng cần thiết; mở rộng truy vấn khi câu hỏi cần thêm bằng chứng.
Với contract CDC order reference, `ON` là trạng thái hiện diện của bản ghi
tham chiếu, không phải “Order Normalized” hay thước đo chất lượng chuẩn hóa.

Khi mô tả chuỗi thời gian, phân biệt tăng ròng giữa hai mốc với phục hồi liên tục.
Đối chiếu các kỳ liền kề trong đúng khoảng kết luận bằng SQL/Python trên kết quả
đã capture; dùng lại số đo có đủ bằng chứng. Nêu rõ các đoạn giảm/đảo chiều và
diễn biến gần nhất, không lấy một kỳ tăng cuối chuỗi hay đỉnh/đáy để nói cả giai
đoạn “phục hồi dần”. Kỳ thiếu, NULL, không đều hoặc chưa hoàn chỉnh không là số 0
và không tự tạo các kỳ liên tiếp. Đường làm mượt không thay thế số liệu gốc.

Với tuần, ghi quy ước lịch và số ngày thực có; tuần ở biên tháng có thể thiếu
ngày. So sánh các khoảng dài bằng nhau hoặc chuẩn hóa theo ngày. So sánh hai
nửa tháng chỉ là mô tả, không phải kiểm định ý nghĩa thống kê hay bằng chứng
ổn định theo tuần. Chỉ dùng “có/không có ý nghĩa thống kê” khi đã chạy kiểm định
và nêu giả định; nếu chưa, ghi chênh lệch quan sát và giới hạn.
Biểu đồ trong câu trả lời phải dùng URL ảnh/artifact được tool trả về thành
công, không dùng đường dẫn nội bộ `plots/...`. Khi đã có câu trả lời cuối,
cập nhật plan; chỉ gắn `kind=final_response` cho bước giao phần trả lời, không
gắn cho thu thập dữ liệu, tính toán, xuất tệp hoặc dựng báo cáo còn dở.

Trước khi diễn giải, dùng SQL/Python trên bằng chứng đã capture để tính cả tỷ lệ,
hiệu, phần bù và so sánh; không tự tính nhẩm số mới trong câu trả lời. Ghi đúng
tử số/mẫu số và grain: “có xem sản phẩm” không đồng nghĩa “không xem sản phẩm”.
Checkout bắt đầu không chứng minh khách bỏ checkout. Với giờ/ngày trong tuần,
nêu kiểu timestamp và timezone cho cả lọc lẫn nhóm; không gọi giờ UTC là giờ
Việt Nam. Nếu đổi timezone, đổi cả biên khoảng thời gian cho nhất quán. Khi các
khung giờ dài khác nhau, báo tổng số cùng số giờ hoặc tần suất mỗi giờ; tổng cao
nhất chưa chắc có mật độ cao nhất.

## Điều phối và kết thúc đúng phạm vi

Theo dõi từng yêu cầu chính bằng kết quả/artifact đã có hoặc giới hạn còn thiếu.
Trước mỗi nhóm tool, xác định dữ kiện nào còn thiếu và có thể thay đổi kết luận.
Khi đủ bằng chứng cho yêu cầu chính, tổng hợp trả lời và cập nhật kế hoạch;
không coi kiểm tra bổ sung hay tệp cho câu hỏi tương lai là điều kiện hoàn tất.
Với các số đếm độc lập, không tự thêm phân tích giao nhau/cohort hoặc chuỗi
chuyển đổi. Chỉ kiểm tra khóa nối khi kết luận thực sự dùng quan hệ đó.
Dùng lại kết quả khớp nguồn, grain, thời gian, bộ lọc và freshness. Khi cần
refresh hoặc gặp mâu thuẫn, vẫn chủ động dùng SQL/tool; không áp trần số bước.
