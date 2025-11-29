import { createBrowserRouter } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import ChatPage from './pages/Chat';
import MemoryManagerPage from './pages/MemoryManager';
import TrainingPage from './pages/Training';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <ChatPage /> },
      { path: 'memory', element: <MemoryManagerPage /> },
      { path: 'training', element: <TrainingPage /> }
    ]
  }
]);
