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

## Ước lượng và kiểm tra vòng lặp

Agent có thể cung cấp `estimated_model_calls` khi gọi `todowrite` và cập nhật
con số này khi đổi kế hoạch. Ước lượng chỉ để tham khảo, không phải budget hay
trần dừng. UI hiển thị số lần Agent chính đã thử gọi model và ước lượng nếu có;
chưa bao gồm các lượt của subagent. Nếu Agent không đưa ước lượng, UI chỉ hiện
số lượt đã dùng. Không có lần gọi model phụ để tạo ước lượng.

Sau mốc ước lượng, nếu cùng một truy vấn SQL đơn lẻ với cùng nội dung lỗi ba
lần liên tiếp, Agent dừng với `AGENT_SQL_LOOP` và giữ kết quả đã có. Một hành
động khác, batch hoặc truy vấn thành công xóa bộ đếm lặp. Không có ước lượng
thì kiểm tra này không kích hoạt; nó không nhận diện mọi loại lặp. Budget cứng
đã cấu hình vẫn độc lập; lượt không khai báo budget không có giới hạn này.

Khi một kế hoạch nhiều bước đã hoàn tất bị mở lại với đúng các đầu việc cũ,
`todowrite` giữ kế hoạch đã hoàn thành và yêu cầu Agent tổng hợp kết quả hoặc
tạo kế hoạch mô tả công việc mới. Nếu tiếp tục đặt lại cùng kế hoạch, lượt dừng
với `AGENT_PLAN_STALLED`; các kết quả SQL và bước đã ghi vẫn có thể xem lại.
Kế hoạch khác và chỉnh sửa một phần kế hoạch vẫn được phép. Cơ chế này xử lý
mẫu lặp cụ thể, không phải bộ phát hiện mọi vòng lặp.
