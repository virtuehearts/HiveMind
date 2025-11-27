import { Outlet } from 'react-router-dom';

const AppLayout = () => {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">🐝</span>
          <div>
            <p className="brand-title">HiveMind</p>
            <p className="brand-subtitle">Local Ollama router</p>
          </div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
};

export default AppLayout;
