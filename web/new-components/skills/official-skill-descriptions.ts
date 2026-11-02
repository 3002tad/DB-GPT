/** Display-only translations; never rewrite skill instructions or custom content. */
const descriptions: Record<string, { vi: string; en: string }> = {
  'antv-g2-chart': { vi: 'Tạo biểu đồ rõ ràng, tương tác bằng G2.', en: 'Create clear, interactive charts using G2.' },
  'agent-browser': { vi: 'Dùng trình duyệt để xem trang, tìm thông tin và thực hiện tác vụ web.', en: 'Use a browser to inspect pages, find information and perform web tasks.' },
  'business-report': { vi: 'Tạo báo cáo kinh doanh có cấu trúc từ kết quả phân tích SQL hoặc Python.', en: 'Create structured business reports from SQL or Python analysis results.' },
  'csv-data-analysis': { vi: 'Phân tích tệp CSV và Excel, kiểm tra chất lượng và tóm tắt xu hướng.', en: 'Analyze CSV and Excel files, inspect quality and summarize trends.' },
  'dashboard-builder': { vi: 'Lập kế hoạch chỉ số và tạo bảng điều khiển có thể chỉnh sửa từ nguồn dữ liệu.', en: 'Plan metrics and create editable dashboards from a data source.' },
  'dashboard-chart-configuration': { vi: 'Đề xuất ánh xạ trường và thay đổi biểu đồ sau khi xác thực bằng truy vấn chỉ đọc; duy trì liên kết dữ liệu đã công bố, không tạo bảng điều khiển trùng lặp.', en: 'Propose field mappings and chart changes validated by read-only queries, maintaining published data bindings without creating duplicate dashboards.' },
  'dashboard-collaboration': { vi: 'Dựa trên dữ liệu, vùng chọn, hội thoại và chú thích biểu đồ để đưa ra đề xuất hoặc thay đổi có thể kiểm chứng.', en: 'Use data, selections, conversations and chart annotations to suggest or produce verifiable changes.' },
  'dashboard-filter-configuration': { vi: 'Cấu hình bộ lọc chung, liên kết trường, giá trị và tham số truy vấn; kiểm tra lựa chọn trống, một hoặc nhiều giá trị.', en: 'Configure global filters and align fields, values and query parameters; verify empty, single and multiple selections.' },
  'financial-report-analyzer': { vi: 'Phân tích báo cáo tài chính và so sánh các chỉ số tài chính.', en: 'Analyze financial reports and compare financial indicators.' },
  'skill-creator': { vi: 'Tạo kỹ năng có thể tái sử dụng với quy trình và cách kiểm chứng rõ ràng.', en: 'Create reusable skills with clear workflows and validation.' },
  'walmart-sales-analyzer': { vi: 'Phân tích dữ liệu bán hàng Walmart mẫu.', en: 'Analyze the bundled Walmart sales example.' },
  'datapulse-viz-design': { vi: 'Thiết kế bảng điều khiển tăng trưởng và giữ chân người dùng.', en: 'Design dashboards for product growth and retention.' },
  'nexusai-viz-design': { vi: 'Thiết kế bảng điều khiển vận hành và dịch vụ AI.', en: 'Design dashboards for AI services and operations.' },
  'learnhub-viz-design': { vi: 'Thiết kế bảng điều khiển tiến độ và kết quả học tập.', en: 'Design dashboards for learning progress and outcomes.' },
  'brutal-viz-design': { vi: 'Thiết kế bảng điều khiển chiến dịch theo phong cách áp phích.', en: 'Design bold, poster-style campaign dashboards.' },
  'pawspa-viz-design': { vi: 'Thiết kế bảng điều khiển vận hành cửa hàng thú cưng.', en: 'Design dashboards for pet store operations.' },
  'serenityspa-viz-design': { vi: 'Thiết kế bảng điều khiển lịch hẹn và dịch vụ spa.', en: 'Design dashboards for spa appointments and services.' },
};

export function officialSkillDescription(name: string, language: string | undefined, fallback: string): string {
  const locale = language?.toLowerCase() || '';
  if (locale.startsWith('zh')) return fallback;
  const entry = descriptions[name];
  if (!entry) return fallback;
  return locale.startsWith('vi') ? entry.vi : entry.en;
}
