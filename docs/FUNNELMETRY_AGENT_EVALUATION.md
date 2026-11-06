# Funnelmetry: kiểm thử Agent có kiểm soát

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

## Cơ chế phục hồi hiện hành

- `knowledge_retrieve` trả lỗi có cấu trúc. Sau hai lần lỗi giống hệt, lời gọi đọc `knowledge_retrieve`, `kb_ls` hoặc `kb_cat` lần thứ ba được bỏ qua và trả `TOOL_REPEATED_FAILURE`. Agent vẫn có thể đổi tham số hoặc dùng tool khác; các tool còn lại chỉ nhận gợi ý phục hồi.
- Truy vấn PostgreSQL dùng `statement_timeout` trong transaction; SQLite dùng cơ chế hủy truy vấn. Timeout ở tầng async giới hạn thời gian Agent chờ trong khi database hoàn tất việc hủy.
- `todowrite` trả `PLAN_ALREADY_COMPLETE` nếu mở lại đúng kế hoạch đã hoàn tất, giữ nguyên kế hoạch để Agent tổng hợp kết quả hoặc tạo kế hoạch mới thực sự khác.
- Lời gọi native tool sai định dạng lặp lại nhận gợi ý `AGENT_TOOL_CALL_RECOVERY` và vẫn được thử tiếp. Những kiểm tra lặp này không đặt trần dừng toàn task; ngân sách đánh giá được cấu hình riêng vẫn có thể dừng Agent.
