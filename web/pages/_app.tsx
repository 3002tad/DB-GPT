import { ChatContext, ChatContextProvider } from '@/app/chat-context';
import { discoverFunnelmetryActor, FunnelmetryIdentityContext } from '@/app/funnelmetry-identity';
import SideBar from '@/components/layout/side-bar';
import { NewTaskProvider } from '@/modules/new-task';
import FloatHelper from '@/new-components/layout/FloatHelper';
import DashboardRouteFrame from '@/new-components/dashboard/DashboardRouteFrame';
import { STORAGE_LANG_KEY, STORAGE_THEME_KEY, STORAGE_USERINFO_KEY, STORAGE_USERINFO_VALID_TIME_KEY } from '@/utils/constants/index';
import { App, ConfigProvider, MappingAlgorithm, theme } from 'antd';
import enUS from 'antd/locale/en_US';
import viVN from 'antd/locale/vi_VN';
import zhCN from 'antd/locale/zh_CN';
import classNames from 'classnames';
import type { AppProps } from 'next/app';
import Head from 'next/head';
import { useRouter } from 'next/router';
import React, { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../app/i18n';
import '../nprogress.css';
import '../styles/globals.css';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
// import TopProgressBar from '@/components/layout/top-progress-bar';

const antdDarkTheme: MappingAlgorithm = (seedToken, mapToken) => {
  return {
    ...theme.darkAlgorithm(seedToken, mapToken),
    colorBgBase: '#232734',
    colorBorder: '#828282',
    colorBgContainer: '#232734',
  };
};

function CssWrapper({ children }: { children: React.ReactElement }) {
  const { mode } = useContext(ChatContext);
  const { i18n } = useTranslation();

  useEffect(() => {
    if (mode) {
      document.body?.classList?.add(mode);
      if (mode === 'light') {
        document.body?.classList?.remove('dark');
      } else {
        document.body?.classList?.remove('light');
      }
    }
  }, [mode]);

  useEffect(() => {
    i18n.changeLanguage?.(window.localStorage.getItem(STORAGE_LANG_KEY) || 'vi');
  }, [i18n]);

  return (
    <div>
      {/* <TopProgressBar /> */}
      {children}
    </div>
  );
}

function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const { isMenuExpand, mode, setMode } = useContext(ChatContext);
  const { i18n } = useTranslation();
  const [isLogin, setIsLogin] = useState(false);
  const [authError, setAuthError] = useState('');
  const [pipelineRole, setPipelineRole] = useState('');
  const [integrated, setIntegrated] = useState(process.env.NEXT_PUBLIC_FUNNELMETRY_IDENTITY === '1');
  const [embedded, setEmbedded] = useState(false);

  const router = useRouter();
  const isPublicShare = router.pathname.startsWith('/share') || router.pathname.startsWith('/dashboard-share');

  // 登录检测
  const handleAuth = async () => {
    setIsLogin(false);
    try {
      const actor = await discoverFunnelmetryActor();
      if (actor) {
        setIntegrated(true);
        localStorage.setItem(STORAGE_USERINFO_KEY, JSON.stringify({
          user_id: actor.id, user_no: actor.id, nick_name: actor.id, role: actor.role,
        }));
        localStorage.setItem(STORAGE_USERINFO_VALID_TIME_KEY, Date.now().toString());
        setAuthError('');
        setPipelineRole(actor.role);
        setIsLogin(true);
        return;
      }
      setIntegrated(false);
    } catch {
      localStorage.removeItem(STORAGE_USERINFO_KEY);
      localStorage.removeItem(STORAGE_USERINFO_VALID_TIME_KEY);
      setPipelineRole('');
      setAuthError('Phiên đăng nhập AI không khả dụng. Hãy mở lại AI từ Funnelmetry.');
      return;
    }
    // 如果已有登录信息，直接展示首页
    // if (localStorage.getItem(STORAGE_USERINFO_KEY)) {
    //   setIsLogin(true);
    //   return;
    // }

    // MOCK User info
    const user = {
      user_channel: `dbgpt`,
      user_no: `001`,
      nick_name: `dbgpt`,
    };
    if (user) {
      localStorage.setItem(STORAGE_USERINFO_KEY, JSON.stringify(user));
      localStorage.setItem(STORAGE_USERINFO_VALID_TIME_KEY, Date.now().toString());
      setIsLogin(true);
    }
  };

  useEffect(() => {
    // Publication tokens authorize these pages independently of a workspace
    // session. Do not trigger a failed login request or clear stored identity.
    if (isPublicShare) return;
    handleAuth();
  }, [isPublicShare]);

  useEffect(() => {
    const framed = window.self !== window.top && integrated;
    setEmbedded(framed);
    document.body.classList.toggle('funnelmetry-ai-embedded', framed);
    if (!framed) return;
    const parentOrigin = process.env.NEXT_PUBLIC_FUNNELMETRY_UI_ORIGIN;
    if (!parentOrigin) return;
    i18n.changeLanguage('vi');
    localStorage.setItem(STORAGE_LANG_KEY, 'vi');
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== parentOrigin) return;
      const data = event.data;
      if (data?.type === 'funnelmetry:ai-theme' && (data.theme === 'light' || data.theme === 'dark')) {
        setMode(data.theme);
        localStorage.setItem(STORAGE_THEME_KEY, data.theme);
      }
    };
    window.addEventListener('message', onMessage);
    return () => {
      document.body.classList.remove('funnelmetry-ai-embedded');
      window.removeEventListener('message', onMessage);
    };
  }, [i18n, router, setMode, integrated]);

  useEffect(() => {
    const parentOrigin = process.env.NEXT_PUBLIC_FUNNELMETRY_UI_ORIGIN;
    if (embedded && isLogin && parentOrigin) {
      window.parent.postMessage({ type: 'funnelmetry:ai-ready', path: router.pathname }, parentOrigin);
    }
  }, [embedded, isLogin, router.pathname]);

  if (!isLogin && !isPublicShare) {
    return authError ? <div role='alert' style={{ padding: 24 }}>{authError}</div> : null;
  }
  if (integrated && pipelineRole === 'analyst' &&
      ['/construct/models-config', '/construct/database',
       '/models_evaluation', '/observability'].some(
        path => router.pathname === path || router.pathname.startsWith(`${path}/`),
      )) {
    return <div role='alert' style={{ padding: 24 }}>Trang cấu hình này chỉ dành cho quản trị viên.</div>;
  }

  const renderContent = () => {
    // Hide sidebar for mobile, share pages, and task replay mode (from_task)
    const hideSidebar =
      router.pathname.includes('mobile') || isPublicShare || !!router.query.from_task;

    if (router.pathname.includes('mobile') || isPublicShare) {
      return <>{children}</>;
    }
    return (
      <div className='flex w-screen h-screen overflow-hidden'>
        <Head>
          <meta name='viewport' content='initial-scale=1.0, width=device-width, maximum-scale=1' />
        </Head>
        {router.pathname !== '/construct/app/extra' && !hideSidebar && (
          <div className={classNames('transition-[width]', isMenuExpand ? 'w-60' : 'w-20', 'hidden', 'md:block')}>
            <SideBar />
          </div>
        )}
        <div className='flex flex-col flex-1 min-w-0 min-h-0 relative overflow-hidden'>
          {router.pathname.startsWith('/dashboards') ? <DashboardRouteFrame>{children}</DashboardRouteFrame> : children}
        </div>
        {!hideSidebar && !embedded && <FloatHelper />}
      </div>
    );
  };

  return (
    <FunnelmetryIdentityContext.Provider value={{ integrated, role: pipelineRole }}>
      <ConfigProvider
        locale={i18n.language.startsWith('vi') ? viVN : i18n.language.startsWith('zh') ? zhCN : enUS}
        theme={{
          token: {
            colorPrimary: '#0C75FC',
            borderRadius: 4,
          },
          algorithm: mode === 'dark' ? antdDarkTheme : undefined,
        }}
      >
        <App>{renderContent()}</App>
      </ConfigProvider>
    </FunnelmetryIdentityContext.Provider>
  );
}

function MyApp({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const publicView = router.pathname.startsWith('/share') || router.pathname.startsWith('/dashboard-share');
  return (
    <ChatContextProvider publicView={publicView}>
      <NewTaskProvider>
        <CssWrapper>
          <LayoutWrapper>
            <Component {...pageProps} />
          </LayoutWrapper>
        </CssWrapper>
      </NewTaskProvider>
    </ChatContextProvider>
  );
}

export default MyApp;
