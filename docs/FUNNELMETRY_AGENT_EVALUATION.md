# Funnelmetry: kiểm thử Agent có kiểm soát

## Truy hồi Knowledge Base đã chọn

Prefetch xét tối đa tám đoạn theo truy hồi ngữ nghĩa, loại đoạn nội dung trùng,
rồi ưu tiên độ khớp từ khóa với câu hỏi (thứ hạng ngữ nghĩa dùng để phá hòa).
Tối đa ba đoạn được đưa vào prompt, chia ngân sách 3.500 ký tự nội dung để
tránh một đoạn dài che hết các đoạn khác. Trace `knowledge.prefetch` giữ
document/chunk ID và hash của đoạn đã dùng. Đây là chỉ mục dẫn xuất; Agent
vẫn cần đối chiếu schema và số liệu với datasource nếu KB thiếu hoặc không
khớp phiên bản. Không mặc định rằng chỉ chọn KB trên UI đồng nghĩa đã đọc
đúng đoạn.

## Kiểm tra claim khi kết thúc lượt phân tích

Trước khi lưu và phát ra UI, câu trả lời được kiểm tra đối với các kết luận
nghiệp vụ có rủi ro cao: thêm/bỏ giỏ, thanh toán, hoàn tiền, giao hàng,
conversion, retention, tồn kho có thể bán, quy kết nguồn UTM và quan hệ nhân
quả. Bộ kiểm tra ưu tiên SQL artifact thành công của cả Agent chính và
subagent; chỉ khi không có artifact sink mới đọc trace SQL của Agent chính.
Các thành phần bằng chứng phải xuất hiện trong cùng một truy vấn, không ghép
nhiều truy vấn riêng thành một chứng minh. Câu vượt kiểm tra được lược bỏ,
giữ câu số liệu liền trước khi có thể tách, và UI nhận ghi chú về giới hạn;
server ghi loại claim bị lược bỏ để đối chiếu trace. Kết luận trong tiêu đề
và kết luận không có công cụ cung cấp bằng chứng cũng được kiểm tra.

Đây là lớp phòng lỗi theo nhóm claim nhận diện rõ, không phải bộ chứng nhận
mọi câu văn tự do, phép tính hoặc tính đúng của dữ liệu. SQL khớp hình dạng
vẫn có thể trả về dữ liệu không hỗ trợ cách diễn giải; cần tiếp tục dựa vào
metric, quality, provenance và evidence contract. Khi lượt chỉ truy hồi tài
liệu Knowledge Base mà không chạy SQL, lớp kiểm tra không tự xoá nội dung tài
liệu vì chưa có bộ đối chiếu claim với trích dẫn KB.

Khi gửi `POST /api/v1/chat/react-agent`, có thể giới hạn lượt kiểm thử của
Agent chính dùng native tool calling bằng cách thêm vào request:

```json
{
  "ext_info": {
    "evaluation_budget": {
      "max_model_calls": 15,
      "max_provider_tokens": 150000
    }
  }
}
```

Giữ các trường `ext_info` khác như datasource, skill và KB khi gửi request.
Hai giá trị là ví dụ, có thể cấu hình riêng hoặc dùng một trong hai. Mỗi giá
trị phải là số nguyên dương. Không khai báo thì không bật giới hạn này.

- `max_model_calls` đếm các lần Agent chính thử gọi model, bao gồm retry.
- `max_provider_tokens` cộng `usage.total_tokens` do provider trả về sau từng
  lần gọi; khi không có usage, Agent dừng trước lần gọi kế tiếp. Giới hạn được
  kiểm tra trước lần gọi tiếp theo: một request đang chạy có thể vượt ngưỡng.
- Ngân sách không bao gồm embedding, indexing, context summarization hoặc model
  calls của subagent; không xem đây là giới hạn chi phí toàn hệ thống hay hóa
  đơn provider. Với Dashboard confirmation, request có budget bị từ chối vì
  đường đó không dùng Agent chính này.
- Lượt dừng vì ngân sách trả lỗi `AGENT_EVALUATION_BUDGET` và giữ trace/kết quả
  đã tạo; không tự tạo kết luận từ dữ liệu chưa được Agent tổng hợp.

## Ước lượng và phục hồi lỗi tool

Agent có thể cung cấp `estimated_model_calls` khi gọi `todowrite` và cập nhật
con số này khi đổi kế hoạch. Ước lượng chỉ để tham khảo, không phải budget hay
trần dừng. UI hiển thị số lần Agent chính đã thử gọi model và ước lượng nếu có;
chưa bao gồm các lượt của subagent. Nếu Agent không đưa ước lượng, UI chỉ hiện
số lượt đã dùng. Không có lần gọi model phụ để tạo ước lượng.

Ước lượng không điều khiển việc phát hiện lỗi lặp. Mỗi tool có trạng thái lỗi
riêng trong một task; batch được xem theo từng kết quả. Sau hai lần cùng lời
gọi lỗi, Agent nhận tín hiệu `RECOVERY_SUGGESTED` để đổi tham số, xem lỗi/tool
khác hoặc tổng hợp kết quả còn hiệu lực. Tool SQL không thực thi lần thứ ba
cùng truy vấn lỗi, trả `SQL_REPEATED_FAILURE` và hướng kiểm tra schema. Truy
vấn SQL khác vẫn được phép. Lỗi bảng/cột thiếu có mã và gợi ý truy vấn
`information_schema`; timeout hướng dẫn xem query plan. Một tool thành công
xóa streak lỗi của chính tool đó. Bộ phát hiện chỉ giữ fingerprint, không giữ
đầu vào hoặc dữ liệu kết quả. Nó không thay quyền truy cập, quality gate hoặc
budget đánh giá tùy chọn, cũng không bảo đảm bắt được mọi vòng lặp.

Trong cùng task, truy vấn schema `information_schema`/`pg_catalog` giống hệt
được dùng lại tối đa 60 giây; truy vấn dữ liệu nghiệp vụ luôn chạy lại để tránh
dùng kết quả cũ khi dữ liệu live thay đổi. Cache này không áp dụng cho đường
Dashboard có giới hạn discovery calls riêng.

Nếu hai truy vấn khám phá schema rộng liên tiếp trả rỗng, tool SQL từ chối truy
vấn rộng tiếp theo với `SQL_SCHEMA_DISCOVERY_EMPTY_LOOP`. Agent được hướng dẫn
kiểm tra database/schema đã chọn, truy vấn trực tiếp relation có schema đầy đủ
hoặc truy vấn metadata nhắm đúng `table_name`; truy vấn dữ liệu nghiệp vụ và
metadata nhắm bảng cụ thể vẫn dùng được. Câu trả lời cuối chỉ ghi grain mà SQL
đã kiểm chứng, và SQL minh họa tham chiếu relation chưa xác minh trong lượt
được lược bỏ để tránh đưa hướng dẫn không chạy được.

## Cơ chế phục hồi hiện hành

- `knowledge_retrieve` trả lỗi có cấu trúc. Sau hai lần lỗi giống hệt, lời gọi đọc `knowledge_retrieve`, `kb_ls` hoặc `kb_cat` lần thứ ba được bỏ qua và trả `TOOL_REPEATED_FAILURE`. Agent vẫn có thể đổi tham số hoặc dùng tool khác; các tool còn lại chỉ nhận gợi ý phục hồi.
- Truy vấn PostgreSQL dùng `statement_timeout` trong transaction; SQLite dùng cơ chế hủy truy vấn. Timeout ở tầng async giới hạn thời gian Agent chờ trong khi database hoàn tất việc hủy.
- `todowrite` trả `PLAN_ALREADY_COMPLETE` nếu mở lại đúng kế hoạch đã hoàn tất, giữ nguyên kế hoạch để Agent tổng hợp kết quả hoặc tạo kế hoạch mới thực sự khác.
- Lời gọi native tool sai định dạng lặp lại nhận gợi ý `AGENT_TOOL_CALL_RECOVERY` và vẫn được thử tiếp. Những kiểm tra lặp này không đặt trần dừng toàn task; ngân sách đánh giá được cấu hình riêng vẫn có thể dừng Agent.
