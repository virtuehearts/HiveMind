import { createBrowserRouter } from 'react-router-dom';
import AppLayout from './components/AppLayout';
import ChatPage from './pages/Chat';
import GeneratorPage from './pages/Generator';
import MemoryManagerPage from './pages/MemoryManager';
import SettingsPage from './pages/Settings';
import TrainingPage from './pages/Training';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <ChatPage /> },
      { path: 'generator', element: <GeneratorPage /> },
      { path: 'memory', element: <MemoryManagerPage /> },
      { path: 'training', element: <TrainingPage /> },
      { path: 'settings', element: <SettingsPage /> }
    ]
  }
]);
