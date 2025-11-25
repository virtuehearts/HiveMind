import AppLayout from './components/AppLayout';

// AppLayout is used by the router; exporting a thin wrapper keeps Vite happy if someone imports App directly.
const App = () => <AppLayout />;

export default App;
