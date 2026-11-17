import markdownComponents, { markdownPlugins, preprocessLaTeX } from '@/components/chat/chat-content/config';
import FinancialCitationLink from '@/new-components/financial-analysis/FinancialCitationLink';
import { cleanFinancialAnswerText, type FinancialCitation } from '@/new-components/financial-analysis/report-citations';
import { GPTVis } from '@antv/gpt-vis';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { chatSystemNotice } from '@/utils/chat-system-notice';

const MarkDownContext: React.FC<{
  children: string;
  components?: Parameters<typeof GPTVis>[0]['components'];
  onFinancialCitationClick?: (citation: FinancialCitation) => void;
}> = ({ children, components, onFinancialCitationClick }) => {
  const { i18n } = useTranslation();
  const DefaultLink = (components?.a || markdownComponents?.a) as React.ElementType | undefined;
  const localized = chatSystemNotice(children, i18n?.resolvedLanguage || i18n?.language);
  const content = localized.includes('#financial-report/') ? cleanFinancialAnswerText(localized) : localized;
  return (
    <GPTVis
      components={{
        ...markdownComponents,
        ...components,
        a: props =>
          props.href?.startsWith('#financial-report/') || !DefaultLink ? (
            <FinancialCitationLink {...props} onCitationClick={onFinancialCitationClick} />
          ) : (
            <DefaultLink {...props} />
          ),
      }}
      {...markdownPlugins}
    >
      {preprocessLaTeX(content)}
    </GPTVis>
  );
};

export default MarkDownContext;
