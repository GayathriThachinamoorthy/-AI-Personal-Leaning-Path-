import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  return <main className="shell"><span className="eyebrow">CogniPath 🎯</span><h1>Your next skill starts here.</h1><p>Create a learning path shaped around your goals, experience, and schedule.</p><a href="http://localhost:3000/#login">Create My Path <span aria-hidden="true">→</span></a></main>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
