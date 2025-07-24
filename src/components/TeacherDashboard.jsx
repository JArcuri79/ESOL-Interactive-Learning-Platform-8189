import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { v4 as uuidv4 } from 'uuid';
import { saveAs } from 'file-saver';
import SafeIcon from '../common/SafeIcon';
import * as FiIcons from 'react-icons/fi';
import QRCodeGenerator from './QRCodeGenerator';
import { motion, AnimatePresence } from 'framer-motion';

const { 
  FiPlay, 
  FiPause, 
  FiSkipForward, 
  FiDownload, 
  FiTrash2, 
  FiUsers, 
  FiClock, 
  FiExpand, 
  FiX, 
  FiRefreshCw, 
  FiCheckCircle, 
  FiLink, 
  FiCopy, 
  FiAlertTriangle,
  FiActivity,
  FiExternalLink,
  FiBug
} = FiIcons;

function TeacherDashboard() {
  const [sessionId, setSessionId] = useState('');
  const [currentTask, setCurrentTask] = useState({
    type: 'wordcloud',
    question: '',
    isActive: false,
    taskNumber: 1
  });
  const [entries, setEntries] = useState([]);
  const [connectedStudents, setConnectedStudents] = useState([]);
  const [allSessionData, setAllSessionData] = useState([]);
  const [timer, setTimer] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [sessionFinished, setSessionFinished] = useState(false);
  const [isStudentListExpanded, setIsStudentListExpanded] = useState(false);
  const [syncStatus, setSyncStatus] = useState({ status: 'ready', lastSync: Date.now() });
  const [linkCopied, setLinkCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [showDebug, setShowDebug] = useState(false);
  const [debugLog, setDebugLog] = useState([]);
  const [displayUrl, setDisplayUrl] = useState('');
  const broadcastChannelRef = useRef(null);
  const studentLink = useRef('');
  const entriesPollingRef = useRef(null);
  const lastProcessedEntryRef = useRef(null);

  // Add debug logging function
  const logDebug = (message) => {
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp}: ${message}`;
    console.log(logEntry);
    setDebugLog(prev => [...prev.slice(-99), logEntry]);
  };

  // Initialize session ID and broadcast channel
  useEffect(() => {
    if (!sessionId) {
      const existingSessionId = localStorage.getItem('current_session_id');
      if (existingSessionId) {
        setSessionId(existingSessionId);
        logDebug(`Loaded existing session ID: ${existingSessionId}`);
      } else {
        const newSessionId = uuidv4();
        setSessionId(newSessionId);
        localStorage.setItem('current_session_id', newSessionId);
        logDebug(`Generated new session ID: ${newSessionId}`);
      }
    }

    // Set student link
    const baseUrl = window.location.origin;
    const path = window.location.pathname.split('/').slice(0, -1).join('/');
    studentLink.current = `${baseUrl}${path}/#/student/${sessionId}`;
    logDebug(`Set student link: ${studentLink.current}`);

    // Set display screen link
    const displayScreenUrl = `${baseUrl}${path}/#/display/${sessionId}`;
    setDisplayUrl(displayScreenUrl);

    // Try to set up BroadcastChannel for better cross-tab communication if supported
    try {
      if ('BroadcastChannel' in window) {
        broadcastChannelRef.current = new BroadcastChannel('esol_session_channel');
        logDebug('BroadcastChannel created successfully');
        
        broadcastChannelRef.current.onmessage = (event) => {
          const { type, data } = event.data;
          
          if (type === 'SESSION_UPDATE') {
            logDebug('Received SESSION_UPDATE via BroadcastChannel');
            setSyncStatus({ status: 'synced', lastSync: Date.now() });
          } else if (type === 'NEW_ENTRY') {
            logDebug('Received NEW_ENTRY via BroadcastChannel');
            updateEntries();
          } else if (type === 'STUDENT_CONNECTED') {
            logDebug(`Student connected: ${data.student_name}`);
            updateConnectedStudents();
          }
        };
      } else {
        logDebug('BroadcastChannel not supported in this browser');
      }
    } catch (error) {
      logDebug(`BroadcastChannel error: ${error.message}`);
    }

    return () => {
      if (broadcastChannelRef.current) {
        broadcastChannelRef.current.close();
        logDebug('BroadcastChannel closed');
      }
    };
  }, [sessionId]);

  // Timer effect
  useEffect(() => {
    let interval;
    if (isTimerRunning) {
      interval = setInterval(() => {
        setTimer(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerRunning]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Function to broadcast updates to other tabs/devices
  const broadcastUpdate = (type, data) => {
    logDebug(`Broadcasting update: ${type}`);
    
    if (broadcastChannelRef.current) {
      broadcastChannelRef.current.postMessage({ type, data });
      logDebug('Sent via BroadcastChannel');
    }
    
    const eventKey = type === 'SESSION_UPDATE' ? 'sessions' : 'student_entries';
    window.dispatchEvent(new StorageEvent('storage', {
      key: eventKey,
      newValue: JSON.stringify(data)
    }));
    logDebug('Dispatched StorageEvent');
    
    window.dispatchEvent(new CustomEvent('supabase-update', {
      detail: { 
        table: eventKey, 
        action: 'UPDATE', 
        data 
      }
    }));
    logDebug('Dispatched CustomEvent supabase-update');
    
    setSyncStatus({ status: 'syncing', lastSync: Date.now() });
    setTimeout(() => setSyncStatus({ status: 'synced', lastSync: Date.now() }), 1000);
  };

  const copyStudentLink = () => {
    navigator.clipboard.writeText(studentLink.current)
      .then(() => {
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
        logDebug('Student link copied to clipboard');
      })
      .catch(err => {
        logDebug(`Could not copy text: ${err.message}`);
        const textArea = document.createElement("textarea");
        textArea.value = studentLink.current;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
      });
  };

  const openDisplayScreen = () => {
    window.open(displayUrl, '_blank');
  };

  const handleTask = async () => {
    if (currentTask.isActive) {
      await stopTask();
      setCurrentTask(prev => ({
        ...prev,
        taskNumber: prev.taskNumber + 1,
        isActive: false,
        question: ''
      }));
      logDebug(`Task ${currentTask.taskNumber} stopped, incremented to task ${currentTask.taskNumber + 1}`);
    } else {
      if (!currentTask.question.trim()) {
        alert('Please enter a question first');
        return;
      }
      await startTask();
    }
  };

  const startTask = async () => {
    logDebug(`Starting task ${currentTask.taskNumber}`);
    setCurrentTask(prev => ({ ...prev, isActive: true }));
    setIsTimerRunning(true);
    setEntries([]);
    setErrorMessage(null);
    lastProcessedEntryRef.current = null;

    const taskData = {
      id: `${sessionId}_task_${currentTask.taskNumber}`,
      session_id: sessionId,
      task_number: currentTask.taskNumber,
      activity_type: currentTask.type,
      question: currentTask.question,
      is_active: true,
      start_time: new Date().toISOString(),
      last_updated: Date.now()
    };
    
    logDebug('Cleaning up any existing tasks with the same number');
    try {
      await supabase
        .from('sessions')
        .delete()
        .eq('session_id', sessionId)
        .eq('task_number', currentTask.taskNumber);
      
      logDebug('Deleted any existing tasks with the same number from Supabase');
    } catch (error) {
      logDebug(`Error cleaning up existing tasks: ${error.message}`);
    }
    
    const sessions = JSON.parse(localStorage.getItem('sessions') || '[]');
    const updatedSessions = sessions.filter(s => 
      s.session_id !== sessionId || s.task_number !== currentTask.taskNumber
    );
    updatedSessions.push(taskData);
    localStorage.setItem('sessions', JSON.stringify(updatedSessions));
    logDebug('Task saved to localStorage');
    
    broadcastUpdate('SESSION_UPDATE', updatedSessions);

    try {
      logDebug('Saving task to Supabase');
      const { error } = await supabase.from('sessions').upsert(taskData);
      if (error) {
        throw error;
      }
      logDebug('Task saved to Supabase successfully');
    } catch (error) {
      logDebug(`Error saving task to Supabase: ${error.message}`);
      setErrorMessage('Failed to save to Supabase. Using local storage only.');
    }
  };

  const stopTask = async () => {
    logDebug(`Stopping task ${currentTask.taskNumber}`);
    setCurrentTask(prev => ({ ...prev, isActive: false }));
    setIsTimerRunning(false);
    setErrorMessage(null);

    const taskResult = {
      taskNumber: currentTask.taskNumber,
      type: currentTask.type,
      question: currentTask.question,
      entries: [...entries],
      duration: timer,
      completedAt: new Date().toISOString()
    };

    setAllSessionData(prev => [...prev, taskResult]);
    logDebug(`Task ${currentTask.taskNumber} completed with ${entries.length} entries`);

    const sessions = JSON.parse(localStorage.getItem('sessions') || '[]');
    const updatedSessions = sessions.map(s => 
      s.id === `${sessionId}_task_${currentTask.taskNumber}` 
        ? { 
            ...s, 
            is_active: false, 
            end_time: new Date().toISOString(), 
            duration: timer,
            last_updated: Date.now()
          } 
        : s
    );
    localStorage.setItem('sessions', JSON.stringify(updatedSessions));
    logDebug('Task updated in localStorage');
    
    broadcastUpdate('SESSION_UPDATE', updatedSessions);

    try {
      logDebug('Updating task in Supabase');
      const { error } = await supabase.from('sessions').update({
        is_active: false,
        end_time: new Date().toISOString(),
        duration: timer,
        last_updated: Date.now()
      }).eq('id', `${sessionId}_task_${currentTask.taskNumber}`);
      
      if (error) {
        throw error;
      }
      logDebug('Task updated in Supabase successfully');
    } catch (error) {
      logDebug(`Error updating task in Supabase: ${error.message}`);
      setErrorMessage('Failed to update Supabase. Using local storage only.');
    }
  };

  const finishSession = () => {
    if (currentTask.isActive) {
      stopTask();
    }
    setSessionFinished(true);
    logDebug('Session finished');
  };

  const downloadReport = () => {
    const csvData = [];
    csvData.push('Task,Type,Question,Student Name,Answer,Timestamp,Duration');
    
    allSessionData.forEach(task => {
      task.entries.forEach(entry => {
        csvData.push(`${task.taskNumber},${task.type},${task.question},${entry.student_name},${entry.content},${entry.timestamp},${task.duration}s`);
      });
    });

    const csv = csvData.join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    saveAs(blob, `esol_session_${sessionId}_${new Date().toISOString().split('T')[0]}.csv`);
    logDebug('Report downloaded as CSV');
  };

  const clearSession = () => {
    if (confirm('Are you sure you want to clear all session data?')) {
      setAllSessionData([]);
      setEntries([]);
      setTimer(0);
      setCurrentTask({
        type: 'wordcloud',
        question: '',
        isActive: false,
        taskNumber: 1
      });
      setSessionFinished(false);
      setErrorMessage(null);
      lastProcessedEntryRef.current = null;
      
      localStorage.removeItem('student_entries');
      localStorage.removeItem('sessions');
      logDebug('Session data cleared from localStorage');
      
      broadcastUpdate('SESSION_UPDATE', []);
      broadcastUpdate('NEW_ENTRY', []);

      try {
        supabase.from('sessions').delete().eq('session_id', sessionId);
        supabase.from('student_entries').delete().eq('sessionId', sessionId);
        logDebug('Session cleared from Supabase');
      } catch (error) {
        logDebug(`Error clearing session from Supabase: ${error.message}`);
      }
    }
  };

  // FIXED: Function to update entries from localStorage and Supabase
  const updateEntries = async () => {
    if (!sessionId) {
      logDebug('No sessionId available, skipping entry update');
      return;
    }
    
    logDebug(`Updating entries for session: ${sessionId}, current task: ${currentTask?.taskNumber || 'none'}`);
    
    let foundEntries = [];
    
    try {
      // First try to get entries from Supabase
      const { data: supabaseEntries, error } = await supabase
        .from('student_entries')
        .select('*')
        .eq('sessionId', sessionId)
        .neq('type', 'heartbeat') // Exclude heartbeat entries
        .order('timestamp', { ascending: false }); // Sort by timestamp newest first
      
      if (!error && supabaseEntries && supabaseEntries.length > 0) {
        logDebug(`Loaded ${supabaseEntries.length} entries from Supabase`);
        foundEntries = supabaseEntries;
      } else {
        logDebug(`No entries found in Supabase or error: ${error?.message || 'none'}`);
      }
    } catch (error) {
      logDebug(`Error fetching entries from Supabase: ${error.message}`);
    }
    
    // Also check localStorage
    const studentEntries = JSON.parse(localStorage.getItem('student_entries') || '[]');
    const localEntries = studentEntries.filter(entry => 
      entry.sessionId === sessionId &&
      entry.type !== 'heartbeat' // Exclude heartbeat entries
    );
    
    logDebug(`Found ${localEntries.length} entries in localStorage`);
    
    // Combine and deduplicate entries
    const allEntries = [...foundEntries, ...localEntries];
    const uniqueEntries = allEntries.filter((entry, index, self) => 
      index === self.findIndex((e) => e.id === entry.id || 
        (e.sessionId === entry.sessionId && 
         e.student_name === entry.student_name && 
         e.content === entry.content && 
         e.timestamp === entry.timestamp))
    );
    
    // Sort by timestamp (newest first)
    const sortedEntries = uniqueEntries.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );
    
    logDebug(`Total unique entries found: ${sortedEntries.length}`);
    
    // If we have a current active task, filter for that task
    if (currentTask && currentTask.isActive && currentTask.taskNumber) {
      const currentTaskEntries = sortedEntries.filter(entry => 
        entry.taskNumber === currentTask.taskNumber
      );
      logDebug(`Filtered to ${currentTaskEntries.length} entries for current task ${currentTask.taskNumber}`);
      setEntries(currentTaskEntries);
    } else {
      // Show all entries if no active task
      logDebug(`No active task, showing all ${sortedEntries.length} entries`);
      setEntries(sortedEntries);
    }
    
    // Update lastProcessedEntry if we have entries
    if (sortedEntries.length > 0) {
      const mostRecent = new Date(sortedEntries[0].timestamp).getTime();
      if (!lastProcessedEntryRef.current || mostRecent > lastProcessedEntryRef.current) {
        lastProcessedEntryRef.current = mostRecent;
        logDebug(`Updated last processed entry timestamp: ${new Date(mostRecent).toISOString()}`);
      }
    }
  };

  // Function to update connected students
  const updateConnectedStudents = async () => {
    logDebug('Updating connected students list');
    
    try {
      const { data: entries, error } = await supabase
        .from('student_entries')
        .select('student_name, deviceId, timestamp')
        .eq('sessionId', sessionId);
      
      if (!error && entries) {
        const studentMap = new Map();
        entries.forEach(entry => {
          const timestamp = new Date(entry.timestamp);
          if (!studentMap.has(entry.student_name) || 
              timestamp > new Date(studentMap.get(entry.student_name).lastActivity)) {
            studentMap.set(entry.student_name, {
              name: entry.student_name,
              lastActivity: entry.timestamp,
              deviceId: entry.deviceId
            });
          }
        });
        
        const studentData = Array.from(studentMap.values());
        logDebug(`Found ${studentData.length} connected students`);
        setConnectedStudents(studentData);
      } else {
        const localEntries = JSON.parse(localStorage.getItem('student_entries') || '[]');
        const sessionEntries = localEntries.filter(entry => entry.sessionId === sessionId);
        
        const studentMap = new Map();
        sessionEntries.forEach(entry => {
          const timestamp = new Date(entry.timestamp);
          if (!studentMap.has(entry.student_name) || 
              timestamp > new Date(studentMap.get(entry.student_name).lastActivity)) {
            studentMap.set(entry.student_name, {
              name: entry.student_name,
              lastActivity: entry.timestamp,
              deviceId: entry.deviceId
            });
          }
        });
        
        const studentData = Array.from(studentMap.values());
        setConnectedStudents(studentData);
        logDebug(`Found ${studentData.length} connected students in localStorage`);
      }
    } catch (error) {
      logDebug(`Error updating connected students: ${error.message}`);
    }
  };

  // Force sync data
  const forceSync = async () => {
    setSyncStatus({ status: 'syncing', lastSync: Date.now() });
    logDebug('Force syncing data');
    setErrorMessage(null);
    
    try {
      const { data: sessionData, error } = await supabase
        .from('sessions')
        .select('*')
        .eq('session_id', sessionId)
        .eq('task_number', currentTask.taskNumber);
      
      if (error) {
        throw new Error(`Error fetching session: ${error.message}`);
      }
      
      if (sessionData && sessionData.length > 0) {
        logDebug('Session found in Supabase');
      } else {
        logDebug('Session not found in Supabase');
        if (currentTask.isActive) {
          logDebug('Creating active session in Supabase');
          const taskData = {
            id: `${sessionId}_task_${currentTask.taskNumber}`,
            session_id: sessionId,
            task_number: currentTask.taskNumber,
            activity_type: currentTask.type,
            question: currentTask.question,
            is_active: true,
            start_time: new Date().toISOString(),
            last_updated: Date.now()
          };
          
          const { error: upsertError } = await supabase.from('sessions').upsert(taskData);
          if (upsertError) {
            throw new Error(`Error creating session: ${upsertError.message}`);
          }
          logDebug('Session created in Supabase');
        }
      }
      
      lastProcessedEntryRef.current = null;
      await updateEntries();
      await updateConnectedStudents();
    } catch (error) {
      logDebug(`Error syncing with Supabase: ${error.message}`);
      setErrorMessage(`Sync error: ${error.message}. Using local storage.`);
      
      lastProcessedEntryRef.current = null;
      updateEntries();
      updateConnectedStudents();
    }
    
    const sessions = JSON.parse(localStorage.getItem('sessions') || '[]');
    broadcastUpdate('SESSION_UPDATE', sessions);
    
    setTimeout(() => {
      setSyncStatus({ status: 'synced', lastSync: Date.now() });
    }, 1000);
  };

  // FIXED: Setup more frequent polling for entries
  useEffect(() => {
    if (entriesPollingRef.current) {
      clearInterval(entriesPollingRef.current);
      entriesPollingRef.current = null;
    }
    
    // Always poll for entries, more frequently when task is active
    const pollInterval = currentTask && currentTask.isActive ? 500 : 2000; // 500ms when active, 2s when inactive
    
    logDebug(`Setting up entry polling with ${pollInterval}ms interval`);
    entriesPollingRef.current = setInterval(() => {
      updateEntries();
      updateConnectedStudents();
    }, pollInterval);
    
    // Initial update
    updateEntries();
    updateConnectedStudents();
    
    return () => {
      if (entriesPollingRef.current) {
        clearInterval(entriesPollingRef.current);
      }
    };
  }, [sessionId, currentTask?.isActive, currentTask?.taskNumber]);

  // Listen for storage events and custom events
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === 'student_entries' || e.key === null) {
        logDebug('Storage change detected for student entries');
        updateEntries();
        updateConnectedStudents();
      }
      
      if (e.key === 'sessions' || e.key === null) {
        logDebug('Storage change detected for sessions');
      }
    };

    const handleSupabaseUpdate = (e) => {
      if (e.detail.table === 'student_entries') {
        logDebug('Supabase update event received for student entries');
        updateEntries();
        updateConnectedStudents();
      }
    };

    const handleForceRefresh = () => {
      logDebug('Force refresh triggered');
      forceSync();
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('supabase-update', handleSupabaseUpdate);
    window.addEventListener('force-refresh', handleForceRefresh);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('supabase-update', handleSupabaseUpdate);
      window.removeEventListener('force-refresh', handleForceRefresh);
    };
  }, [sessionId, currentTask]);

  // Subscribe to Supabase realtime updates
  useEffect(() => {
    if (!sessionId) return;
    logDebug('Setting up Supabase realtime subscriptions');

    const entriesSubscription = supabase
      .channel('student_entries_channel')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'student_entries',
          filter: `sessionId=eq.${sessionId}`
        },
        (payload) => {
          logDebug('Realtime update received for student entries');
          updateEntries();
          updateConnectedStudents();
        }
      )
      .subscribe();

    const sessionsSubscription = supabase
      .channel('sessions_channel')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sessions',
          filter: `session_id=eq.${sessionId}`
        },
        (payload) => {
          logDebug('Realtime update received for sessions');
          forceSync();
        }
      )
      .subscribe();

    return () => {
      entriesSubscription.unsubscribe();
      sessionsSubscription.unsubscribe();
      logDebug('Realtime subscriptions unsubscribed');
    };
  }, [sessionId]);

  // Render connected students modal
  const renderConnectedStudents = () => {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col"
          >
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-2xl font-bold text-gray-800">
                Connected Students ({connectedStudents.length})
              </h2>
              <button
                onClick={() => setIsStudentListExpanded(false)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <SafeIcon icon={FiX} className="text-2xl text-gray-600" />
              </button>
            </div>
            <div className="flex-1 p-6 overflow-auto">
              {connectedStudents.length === 0 ? (
                <p className="text-gray-500 text-center py-8">No students connected yet</p>
              ) : (
                <ul className="divide-y divide-gray-200">
                  {connectedStudents.map((student, index) => (
                    <li key={index} className="py-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium text-gray-800">{student.name}</p>
                          <p className="text-xs text-gray-500">
                            Last activity: {new Date(student.lastActivity).toLocaleTimeString()}
                          </p>
                          <p className="text-xs text-gray-400 truncate max-w-[240px]">
                            {student.deviceId?.substring(0, 60) || "Unknown device"}
                          </p>
                        </div>
                        <div className="flex items-center">
                          <span className="inline-block h-3 w-3 rounded-full bg-green-500"></span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  };

  // Render debug log modal
  const renderDebugLog = () => {
    return (
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col"
          >
            <div className="flex items-center justify-between p-6 border-b">
              <h2 className="text-2xl font-bold text-gray-800">Debug Log</h2>
              <button
                onClick={() => setShowDebug(false)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors"
              >
                <SafeIcon icon={FiX} className="text-2xl text-gray-600" />
              </button>
            </div>
            <div className="flex-1 p-4 overflow-auto bg-gray-100 font-mono text-xs">
              <div className="mb-4 p-3 bg-yellow-50 border-l-4 border-yellow-500">
                <p className="font-bold">Session ID: {sessionId}</p>
                <p>Current Task: {currentTask ? `#${currentTask.taskNumber} - ${currentTask.question}` : 'None'}</p>
                <p>Connected Students: {connectedStudents.length}</p>
                <p>Entries: {entries.length}</p>
                <p>Supabase URL: {SUPABASE_URL}</p>
                <p>Last Processed Entry: {lastProcessedEntryRef.current ? new Date(lastProcessedEntryRef.current).toISOString() : 'None'}</p>
              </div>
              {debugLog.map((log, index) => (
                <div key={index} className="py-1 border-b border-gray-200">
                  {log}
                </div>
              ))}
            </div>
            <div className="p-4 border-t flex justify-between">
              <button
                onClick={() => setDebugLog([])}
                className="px-4 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200"
              >
                Clear Log
              </button>
              <button
                onClick={async () => {
                  try {
                    const { data, error } = await supabase.rpc('connection_test');
                    if (error) {
                      throw new Error(error.message);
                    }
                    setDebugLog(prev => [...prev, `Connection test: ${data || 'Success'}`]);
                  } catch (error) {
                    setDebugLog(prev => [...prev, `Connection test failed: ${error.message}`]);
                  }
                }}
                className="px-4 py-2 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
              >
                Test Connection
              </button>
              <button
                onClick={() => {
                  const logText = debugLog.join('\n');
                  const blob = new Blob([logText], { type: 'text/plain' });
                  saveAs(blob, `debug_log_${new Date().toISOString()}.txt`);
                }}
                className="px-4 py-2 bg-green-100 text-green-700 rounded hover:bg-green-200"
              >
                Download Log
              </button>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>
    );
  };

  // Render sync status
  const renderSyncStatus = () => {
    switch (syncStatus.status) {
      case 'syncing':
        return (
          <span className="text-blue-600 text-xs flex items-center gap-1">
            <SafeIcon icon={FiRefreshCw} className="animate-spin" /> Syncing...
          </span>
        );
      case 'synced':
        return (
          <span className="text-green-600 text-xs flex items-center gap-1">
            <SafeIcon icon={FiCheckCircle} /> Synced
          </span>
        );
      default:
        return (
          <span className="text-gray-500 text-xs flex items-center gap-1">
            <SafeIcon icon={FiRefreshCw} /> Ready
          </span>
        );
    }
  };

  // Render the student responses section
  const renderStudentResponses = () => {
    return (
      <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Student Responses ({entries.length})</h3>
          <button
            onClick={updateEntries}
            className="text-xs flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
          >
            <SafeIcon icon={FiRefreshCw} /> Refresh
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {entries.length === 0 ? (
            <div className="text-center py-16">
              <div className="text-6xl mb-4">⏳</div>
              <h3 className="text-xl font-semibold text-gray-600 mb-2">
                Waiting for responses...
              </h3>
              <p className="text-gray-500">
                Students will see their submissions appear here in real-time
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {entries.map((entry, index) => (
                <motion.div
                  key={`${entry.id || entry.timestamp}-${index}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 p-4 rounded-lg hover:shadow-md transition-all duration-200"
                >
                  <div className="font-semibold text-purple-600 text-sm mb-2">
                    {entry.student_name}
                  </div>
                  <p className="text-gray-800 leading-relaxed">{entry.content}</p>
                  <div className="text-xs text-gray-500 mt-2">
                    Task {entry.taskNumber} - {new Date(entry.timestamp).toLocaleTimeString()}
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-bold text-gray-800">ESOL Teacher Dashboard</h1>
            <div className="flex items-center gap-2">
              {renderSyncStatus()}
              <button
                onClick={forceSync}
                className="text-xs flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
              >
                <SafeIcon icon={FiRefreshCw} /> Force Sync
              </button>
              <button
                onClick={() => setShowDebug(true)}
                className="text-xs flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                <SafeIcon icon={FiBug} /> Debug
              </button>
            </div>
          </div>
          
          {errorMessage && (
            <div className="mb-4 p-3 bg-red-50 border-l-4 border-red-500 text-red-700 flex items-start">
              <SafeIcon icon={FiAlertTriangle} className="mr-2 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold">Sync Error</p>
                <p className="text-sm">{errorMessage}</p>
              </div>
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <div className="bg-blue-50 p-4 rounded-lg mb-4">
                <div className="flex items-center gap-2">
                  <SafeIcon icon={FiUsers} className="text-blue-600" />
                  <span className="font-semibold">Session ID:</span>
                </div>
                <p className="text-sm text-gray-600 break-all">{sessionId}</p>
              </div>
              
              <div className="bg-white border-2 border-dashed border-gray-300 p-4 rounded-lg text-center">
                <div className="flex justify-center mb-2">
                  <QRCodeGenerator 
                    value={studentLink.current}
                    size={180}
                  />
                </div>
                <p className="text-sm text-gray-600 mb-2">Students scan to join</p>
                
                <div className="flex items-center">
                  <input
                    type="text"
                    value={studentLink.current}
                    readOnly
                    className="flex-1 p-2 text-xs border border-gray-300 rounded-l-lg bg-gray-50 overflow-hidden"
                  />
                  <button
                    onClick={copyStudentLink}
                    className={`p-2 ${linkCopied ? 'bg-green-500' : 'bg-blue-500'} text-white rounded-r-lg hover:bg-opacity-90 transition-colors`}
                  >
                    <SafeIcon icon={linkCopied ? FiCheckCircle : FiCopy} className="text-sm" />
                  </button>
                </div>
                {linkCopied && (
                  <p className="text-xs text-green-600 mt-1">Link copied to clipboard!</p>
                )}
              </div>
            </div>
            
            <div className="bg-gray-50 p-6 rounded-lg">
              <h2 className="text-xl font-semibold mb-4">
                {currentTask.isActive 
                  ? `Task ${currentTask.taskNumber} (Running)` 
                  : `Task ${currentTask.taskNumber} Settings`}
              </h2>
              
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Activity Type</label>
                  <select 
                    value={currentTask.type}
                    onChange={(e) => setCurrentTask(prev => ({ ...prev, type: e.target.value }))}
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    disabled={currentTask.isActive}
                  >
                    <option value="wordcloud">Word Cloud</option>
                    <option value="sentences">Sentences</option>
                  </select>
                </div>
                
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <SafeIcon icon={FiClock} className="text-green-600" />
                    <span className="font-semibold text-sm">Timer:</span>
                  </div>
                  <p className="text-2xl font-bold text-green-600 mt-2">{formatTime(timer)}</p>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Question</label>
                <input
                  type="text"
                  value={currentTask.question}
                  onChange={(e) => setCurrentTask(prev => ({ ...prev, question: e.target.value }))}
                  placeholder="e.g., A person who has muscles is..."
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
                  disabled={currentTask.isActive}
                />
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleTask}
                  className={`flex items-center gap-2 px-6 py-3 rounded-lg font-semibold transition-all ${
                    currentTask.isActive 
                      ? 'bg-red-500 hover:bg-red-600 text-white' 
                      : 'bg-green-500 hover:bg-green-600 text-white'
                  }`}
                >
                  <SafeIcon icon={currentTask.isActive ? FiPause : FiPlay} />
                  {currentTask.isActive ? 'Stop Task' : 'Start Task'}
                </button>

                <button
                  onClick={finishSession}
                  className="flex items-center gap-2 px-6 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-lg font-semibold transition-all"
                >
                  Finish Session
                </button>
                
                <button
                  onClick={openDisplayScreen}
                  className="flex items-center gap-2 px-6 py-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg font-semibold transition-all ml-auto"
                >
                  <SafeIcon icon={FiActivity} />
                  Open Display Screen
                  <SafeIcon icon={FiExternalLink} className="ml-1 text-sm" />
                </button>
              </div>
              
              <div className="mt-4">
                <div 
                  className="bg-yellow-50 p-3 rounded-lg cursor-pointer hover:bg-yellow-100 transition-colors flex justify-between items-center"
                  onClick={() => setIsStudentListExpanded(true)}
                >
                  <div className="flex items-center gap-2">
                    <SafeIcon icon={FiUsers} className="text-yellow-600" />
                    <span className="font-semibold">Connected Students:</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <p className="text-xl font-bold text-yellow-600">{connectedStudents.length}</p>
                    <p className="text-xs text-yellow-600">Click to view details</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {renderStudentResponses()}

          {allSessionData.length > 0 && (
            <div className="mt-6 bg-gray-50 p-6 rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold">Session Summary</h3>
                <div className="flex gap-2">
                  <button
                    onClick={downloadReport}
                    className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-all"
                  >
                    <SafeIcon icon={FiDownload} />
                    Download CSV
                  </button>
                  <button
                    onClick={clearSession}
                    className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-medium transition-all"
                  >
                    <SafeIcon icon={FiTrash2} />
                    Clear Data
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {allSessionData.map((task, index) => (
                  <div key={index} className="bg-white p-4 rounded-lg border">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-semibold">Task {task.taskNumber}</h4>
                      <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                        {task.type}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mb-2">{task.question}</p>
                    <div className="text-xs text-gray-500">
                      <p>Entries: {task.entries.length}</p>
                      <p>Duration: {formatTime(task.duration)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {isStudentListExpanded && renderConnectedStudents()}
      {showDebug && renderDebugLog()}
    </div>
  );
}

const SUPABASE_URL = 'https://oqubhegidkcomehtzgar.supabase.co';

export default TeacherDashboard;