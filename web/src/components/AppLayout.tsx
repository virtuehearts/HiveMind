import { NavLink, Outlet } from 'react-router-dom';

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
        <nav className="nav-links">
          <NavLink to="/" end>
            Chat
          </NavLink>
          <NavLink to="/generator">Generator</NavLink>
          <NavLink to="/memory">Memories</NavLink>
          <NavLink to="/training">Training</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
};

export default AppLayout;
