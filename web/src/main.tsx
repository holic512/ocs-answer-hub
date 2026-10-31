/**
 * @file main.tsx
 * @project ocs-answer-hub
 * @module 前端入口
 * @description 挂载路由、应用状态与统一样式。
 * @logic App 声明路由，布局组件承载主内容出口。
 * @dependencies React, react-router, App, state/app
 * @index_tags entry, router
 * @author holic512
 */
import {createRoot} from 'react-dom/client';
import {BrowserRouter} from 'react-router';
import App from './App';
import {AppProvider} from './state/app';
import './style.css';
import './provider-test.css';
createRoot(document.getElementById('root')!).render(<BrowserRouter><AppProvider><App/></AppProvider></BrowserRouter>);
