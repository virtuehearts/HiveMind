import { createBrowserRouter } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import ChatPage from './pages/Chat';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [{ index: true, element: <ChatPage /> }]
  }
]);
