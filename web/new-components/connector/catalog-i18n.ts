type CatalogCopy = { name: string; description: string };

const builtInCopy: Record<string, { en: CatalogCopy; vi: CatalogCopy }> = {
  feishu: { en: { name: 'Lark', description: 'Messages, documents and calendar integration' }, vi: { name: 'Lark', description: 'Tích hợp tin nhắn, tài liệu và lịch' } },
  dingtalk: { en: { name: 'DingTalk', description: 'Group messages and bot notifications' }, vi: { name: 'DingTalk', description: 'Tin nhắn nhóm và thông báo bot' } },
  yuque: { en: { name: 'Yuque', description: 'Read and write knowledge base documents' }, vi: { name: 'Yuque', description: 'Đọc và ghi tài liệu kho tri thức' } },
  github: { en: { name: 'GitHub', description: 'Manage GitHub issues, pull requests and repositories' }, vi: { name: 'GitHub', description: 'Quản lý issue, pull request và kho mã GitHub' } },
  notion: { en: { name: 'Notion', description: 'Read and write pages and databases; organize knowledge' }, vi: { name: 'Notion', description: 'Đọc, ghi trang và cơ sở dữ liệu; sắp xếp tri thức' } },
  linear: { en: { name: 'Linear', description: 'Collaborate on issues and projects; create and update tasks' }, vi: { name: 'Linear', description: 'Phối hợp xử lý issue, dự án; tạo và cập nhật tác vụ' } },
  tavily: { en: { name: 'Tavily', description: 'LLM-oriented web search with Markdown summaries' }, vi: { name: 'Tavily', description: 'Tìm kiếm web cho LLM với bản tóm tắt Markdown' } },
  keenable: { en: { name: 'Keenable Search', description: 'Search and extract web pages; optional API key for higher limits' }, vi: { name: 'Keenable Search', description: 'Tìm kiếm và trích xuất trang web; API key tùy chọn để tăng giới hạn' } },
  deepwiki: { en: { name: 'DeepWiki', description: 'AI explanations and questions about GitHub repositories' }, vi: { name: 'DeepWiki', description: 'Giải thích và hỏi đáp bằng AI về kho GitHub' } },
  custom_mcp: { en: { name: 'Custom MCP Server', description: 'Connect an SSE or Streamable HTTP MCP Server' }, vi: { name: 'MCP Server tùy chỉnh', description: 'Kết nối MCP Server qua SSE hoặc Streamable HTTP' } },
};

export function localizeConnectorCatalog(type: string, locale: string, fallback: CatalogCopy): CatalogCopy {
  if (locale.startsWith('zh')) return fallback;
  return builtInCopy[type]?.[locale.startsWith('vi') ? 'vi' : 'en'] ?? fallback;
}

export function localizeConnectorField(name: string, locale: string, fallback: string): string {
  if (locale.startsWith('zh')) return fallback;
  const labels: Record<string, [string, string]> = {
    auth_type: ['Authentication', 'Phương thức xác thực'],
    token: ['Token', 'Token'],
    header_name: ['Token header name', 'Tên header token'],
    server_uri: ['Endpoint URL', 'URL endpoint'],
    transport: ['Transport protocol', 'Giao thức truyền'],
    description: ['Connector description', 'Mô tả kết nối'],
  };
  return labels[name]?.[locale.startsWith('vi') ? 1 : 0] ?? fallback;
}
