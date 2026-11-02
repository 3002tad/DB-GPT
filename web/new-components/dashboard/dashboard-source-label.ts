const sourceLabelsVi: Record<string, string> = {
  Walmart_Sales: 'Dữ liệu bán lẻ Walmart', walmart_sales_demo: 'Dữ liệu bán lẻ Walmart',
  olist_ecommerce_demo: 'Dữ liệu thương mại điện tử Olist', apple_financial_demo: 'Báo cáo tài chính công khai Apple',
  sqlite_marketing_showcase: 'Tiếp thị cửa hàng · Dữ liệu mẫu tổng hợp',
  sqlite_operations_showcase: 'Kinh doanh toàn quốc · Dữ liệu mẫu tổng hợp',
  sqlite_healthcare_showcase: 'Dịch vụ y tế · Dữ liệu mẫu tổng hợp',
  sqlite_rural_showcase: 'Tài chính phổ cập · Dữ liệu mẫu tổng hợp',
  sqlite_heart_cleveland: 'UCI Cleveland · Dữ liệu nghiên cứu công khai',
  sqlite_voice_lab: 'Tương tác giọng nói AI · Dữ liệu mẫu tổng hợp',
  sqlite_itsm: 'Phiếu dịch vụ lịch sử UCI', sqlite_energy: 'Năng lượng hộ gia đình UCI',
  sqlite_maintenance: 'Mẫu công nghiệp tổng hợp UCI', sqlite_students: 'Điểm khóa học UCI',
  upload_001_3a6ee8a2d1ad4a2a: 'Dữ liệu đơn hàng Northwind',
};
const sourceLabelsEn: Record<string, string> = {
  Walmart_Sales: 'Walmart retail data', walmart_sales_demo: 'Walmart retail data',
  olist_ecommerce_demo: 'Olist e-commerce data', apple_financial_demo: 'Apple public financial reports',
  sqlite_marketing_showcase: 'Store marketing · Synthetic demo data',
  sqlite_operations_showcase: 'National operations · Synthetic demo data',
  sqlite_healthcare_showcase: 'Healthcare services · Synthetic demo data',
  sqlite_rural_showcase: 'Inclusive finance · Synthetic demo data',
  sqlite_heart_cleveland: 'UCI Cleveland · Public research data',
  sqlite_voice_lab: 'AI voice interaction · Synthetic demo data',
  sqlite_itsm: 'UCI historical service tickets', sqlite_energy: 'UCI residential energy measurements',
  sqlite_maintenance: 'UCI synthetic industrial samples', sqlite_students: 'UCI student course grades',
  upload_001_3a6ee8a2d1ad4a2a: 'Northwind order data',
};

export const dashboardSourceLabel = (id: string, locale = 'zh') =>
  locale.startsWith('vi') ? sourceLabelsVi[id] || (id.startsWith('upload_') ? 'Bộ dữ liệu đã tải lên' : id) :
  !locale.startsWith('zh') ? sourceLabelsEn[id] || (id.startsWith('upload_') ? 'Uploaded dataset' : id) :
  ({
    Walmart_Sales: 'Walmart 零售数据',
    walmart_sales_demo: 'Walmart 零售数据',
    olist_ecommerce_demo: 'Olist 电商数据',
    apple_financial_demo: 'Apple 公开财报',
    sqlite_marketing_showcase: '门店营销 · 合成演示数据',
    sqlite_operations_showcase: '全国经营 · 合成演示数据',
    sqlite_healthcare_showcase: '医疗服务 · 合成演示数据',
    sqlite_rural_showcase: '普惠金融 · 合成演示数据',
    sqlite_heart_cleveland: 'UCI Cleveland · 公开研究数据',
    sqlite_voice_lab: 'AI 语音交互 · 合成演示数据',
    sqlite_itsm: 'UCI 历史服务工单',
    sqlite_energy: 'UCI 住宅实测能耗',
    sqlite_maintenance: 'UCI 合成工业样本',
    sqlite_students: 'UCI 葡语课程成绩',
    upload_001_3a6ee8a2d1ad4a2a: 'Northwind 订单数据',
  })[id] || (id.startsWith('upload_') ? '上传的数据集' : id);
