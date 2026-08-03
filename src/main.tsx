import React from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider, theme } from 'antd'
import viVN from 'antd/locale/vi_VN'
import { App } from './App.tsx'
import 'highlight.js/styles/github-dark.css'
import './styles.css'

const srsTheme = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#5b8cff',
    colorInfo: '#5b8cff',
    colorSuccess: '#2fb574',
    colorWarning: '#f0972a',
    colorError: '#f04a4f',
    colorBgBase: '#0b0d12',
    colorBgContainer: '#161a23',
    colorBgElevated: '#1b2029',
    colorBorder: '#262c38',
    colorBorderSecondary: '#1f2531',
    borderRadius: 10,
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  components: {
    Table: { headerBg: '#12151b', rowHoverBg: 'rgba(255,255,255,.03)' },
    Segmented: { itemSelectedBg: '#5b8cff' },
  },
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider theme={srsTheme} locale={viVN}>
      <App />
    </ConfigProvider>
  </React.StrictMode>,
)
