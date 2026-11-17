import { uiText } from '@/hooks/use-ui-text';
import type { ITaskflowRef } from '@/types/taskflow';

const phases: Record<string, string> = {
  '理解需求': 'Understanding requirements',
  '构建流程': 'Building workflow',
  '修正生成结果': 'Revising generated workflow',
  '校验流程': 'Validating workflow',
  '完成': 'Completed',
};

const templateVi: Record<string, [string, string]> = {
  taskflow_db_analysis_template: ['Phân tích cơ sở dữ liệu', 'Xác định định nghĩa và kế hoạch → phân tích xu hướng và chất lượng song song → rà soát → báo cáo HTML.'],
  taskflow_db_fetch_template: ['Truy vấn dữ liệu', 'Câu hỏi nghiệp vụ → đối chiếu định nghĩa → truy vấn SQL chỉ đọc → kiểm tra và ghi chú phạm vi.'],
  taskflow_db_qa_template: ['Hỏi đáp schema và tài liệu', 'Kiểm tra cấu trúc bảng và định nghĩa nghiệp vụ trước khi tổng hợp câu trả lời có nguồn dẫn.'],
};

export function taskflowTemplateText(item: ITaskflowRef, language: string) {
  const vi = language.startsWith('vi') && item.isTemplate ? templateVi[item.name] : undefined;
  return { label: vi?.[0] || item.label, description: vi?.[1] || item.description };
}

/** Translate known runtime phase labels, never arbitrary Agent messages. */
export function taskflowPhase(phase: string | undefined, language: string) {
  return phase && phases[phase] ? uiText(language, phase, phases[phase]) : phase || '';
}

const placeholderEnglish: Record<string, string> = {
  '明确本节点要完成什么、输出什么': 'Describe this node\'s objective and expected output',
  'sse:https://mcp.example.com/sse(每行一个)': 'sse:https://mcp.example.com/sse (one per line)',
  '关注趋势变化与同比 / 环比，识别异常波动并给出可能原因。': 'Describe trends, period comparisons and anomalies to investigate.',
  '请确认分析结论口径，确认后生成报告': 'Confirm the interpretation of the analysis before generating the report',
};

export function taskflowPlaceholder(value: string | null | undefined, language: string) {
  return value && placeholderEnglish[value] ? uiText(language, value, placeholderEnglish[value]) : value || undefined;
}
