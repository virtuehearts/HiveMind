import { createBrowserRouter } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import ChatPage from './pages/Chat';
import SettingsPage from './pages/Settings';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <ChatPage /> },
      { path: 'settings', element: <SettingsPage /> }
    ]
  }
]);
