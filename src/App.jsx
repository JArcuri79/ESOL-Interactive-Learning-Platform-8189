import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import TeacherDashboard from './components/TeacherDashboard';
import StudentView from './components/StudentView';
import DisplayScreen from './components/DisplayScreen';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<TeacherDashboard />} />
        <Route path="/student/:sessionId" element={<StudentView />} />
        <Route path="/display/:sessionId" element={<DisplayScreen />} />
      </Routes>
    </Router>
  );
}

export default App;