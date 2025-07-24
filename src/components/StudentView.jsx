import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import SafeIcon from '../common/SafeIcon';
import * as FiIcons from 'react-icons/fi';

const { 
  FiUser, 
  FiSend, 
  FiClock, 
  FiCheckCircle, 
  FiAlertCircle, 
  FiRefreshCw, 
  FiWifi, 
  FiWifiOff, 
  FiBug, 
  FiX
} = FiIcons;

function StudentView() {
  const { sessionId } = useParams();
  const [name, setName] = useState('');
  const [isJoined, setIsJoined] = useState(false);
  const [currentTask, setCurrentTask] = useState(null);
  const [answer, setAnswer] = useState('');
  const [myEntries, setMyEntries] = useState([]);
  const [selfMarking, setSelfMarking] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState(Date.now());
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [showDebug, setShowDebug] = useState(false);
  const pollIntervalRef = useRef(null);
  const realtimeSubscription = useRef(null);
  const debugLog = useRef([]);
  const heartbeatIntervalRef = useRef(null);

  // Add debug logging function
  const logDebug = (message) => {
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp}: ${message}`;
    console.log(logEntry);
    debugLog.current = [...debugLog.current, logEntry].slice(-100); // Keep last 100 logs
  };

  // Load initial data
  useEffect(() => {
    // Check for saved name
    const savedName = localStorage.getItem(`student_name_${sessionId}`);
    if (savedName) {
      setName(savedName);
      setIsJoined(true);
      logDebug(`Loaded saved name: ${savedName}`);
    }

    // Load my entries
    const loadEntries = () => {
      const entries = JSON.parse(localStorage.getItem('student_entries') || '[]');
      const mySessionEntries = entries.filter(entry => 
        entry.sessionId === sessionId && 
        entry.student_name === savedName
      );
      
      // Sort entries by timestamp (newest first)
      const sortedEntries = mySessionEntries.sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
      );
      
      setMyEntries(sortedEntries);
      logDebug(`Loaded ${sortedEntries.length} entries from localStorage`);
    };

    // Load self-marking data
    const loadMarking = () => {
      const marking = JSON.parse(localStorage.getItem(`self_marking_${sessionId}`) || '{}');
      setSelfMarking(marking);
      logDebug(`Loaded self-marking data from localStorage`);
    };

    loadEntries();
    loadMarking();
    setIsLoading(false);

    // Set up an interval to refresh entries periodically
    const refreshInterval = setInterval(() => {
      if (isJoined) {
        loadEntries();
        loadMarking();
      }
    }, 1000); // More frequent refresh - 1 second instead of 3

    return () => clearInterval(refreshInterval);
  }, [sessionId]);

  // Set up polling for session updates
  useEffect(() => {
    if (!isJoined) return;
    logDebug('Setting up session polling');

    // Poll for current task updates
    const pollForUpdates = async () => {
      try {
        logDebug('Polling for updates...');
        // Try to get session from Supabase first
        let activeSession = null;
        try {
          const { data: supabaseSessions, error } = await supabase
            .from('sessions')
            .select('*')
            .eq('session_id', sessionId)
            .eq('is_active', true)
            .order('task_number', { ascending: false })
            .limit(1);

          if (!error && supabaseSessions && supabaseSessions.length > 0) {
            activeSession = supabaseSessions[0];
            logDebug(`Active session found in Supabase: Task ${activeSession.task_number}`);
            setConnectionStatus('connected');
            setLastSyncTime(Date.now());
          } else {
            logDebug('No active session found in Supabase');
            // Check if there are any sessions at all for this session ID
            const { data: allSessions, error: allSessionsError } = await supabase
              .from('sessions')
              .select('*')
              .eq('session_id', sessionId)
              .limit(1);

            if (!allSessionsError && allSessions && allSessions.length > 0) {
              logDebug(`Found session in Supabase but it's not active`);
            } else {
              logDebug(`No sessions found in Supabase for sessionId: ${sessionId}`);
            }
          }
        } catch (error) {
          logDebug(`Supabase error: ${error.message}, falling back to localStorage`);
        }

        // If no Supabase session, try localStorage
        if (!activeSession) {
          // Get all sessions from localStorage
          const sessions = JSON.parse(localStorage.getItem('sessions') || '[]');
          logDebug(`Found ${sessions.length} sessions in localStorage`);

          // Filter for active sessions matching our sessionId
          const activeSessions = sessions.filter(s => 
            s.session_id === sessionId && s.is_active
          );
          logDebug(`Found ${activeSessions.length} active sessions for this session ID`);

          // Update connection status
          if (Date.now() - lastSyncTime > 10000) {
            setConnectionStatus('reconnecting');
          } else if (activeSessions.length > 0) {
            setConnectionStatus('connected');
          } else {
            setConnectionStatus('waiting');
          }

          // If we have active sessions, set the current task
          if (activeSessions.length > 0) {
            const latestTask = activeSessions.sort((a, b) => 
              b.task_number - a.task_number
            )[0];
            logDebug(`Setting current task from localStorage: Task ${latestTask.task_number}`);
            setCurrentTask(latestTask);
            setLastSyncTime(Date.now());
          } else {
            logDebug('No active task found in localStorage');
            setCurrentTask(null);
          }
        } else {
          // Use Supabase session
          setCurrentTask(activeSession);
          logDebug(`Current task set from Supabase: ${activeSession.question}`);
        }
      } catch (error) {
        logDebug(`Error polling for updates: ${error.message}`);
        console.error("Error polling for updates:", error);
        setConnectionStatus('error');
      }
    };

    // Handle storage events from other tabs/windows
    const handleStorageChange = (e) => {
      if (e.key === 'sessions' || e.key === null) {
        logDebug('Storage change detected for sessions');
        pollForUpdates();
        setLastSyncTime(Date.now());
      }
      
      if (e.key === 'student_entries' || e.key === null) {
        logDebug('Storage change detected for student entries');
        const entries = JSON.parse(localStorage.getItem('student_entries') || '[]');
        const mySessionEntries = entries.filter(entry => 
          entry.sessionId === sessionId && 
          entry.student_name === name
        );
        
        // Sort by timestamp (newest first)
        const sortedEntries = mySessionEntries.sort((a, b) => 
          new Date(b.timestamp) - new Date(a.timestamp)
        );
        
        setMyEntries(sortedEntries);
      }
    };

    // Listen for custom supabase-update events
    const handleSupabaseUpdate = (e) => {
      if (e.detail.table === 'sessions') {
        logDebug('Supabase update event received for sessions');
        pollForUpdates();
        setLastSyncTime(Date.now());
      }
    };

    // Handle force refresh events (from shake detection)
    const handleForceRefresh = () => {
      logDebug('Force refresh triggered');
      forceSync();
    };

    // Set up realtime subscription to Supabase
    const setupRealtimeSubscription = () => {
      try {
        // Subscribe to session changes
        realtimeSubscription.current = supabase
          .channel('session_changes')
          .on(
            'postgres_changes',
            { 
              event: '*', 
              schema: 'public', 
              table: 'sessions', 
              filter: `session_id=eq.${sessionId}` 
            },
            (payload) => {
              logDebug(`Realtime update received: ${JSON.stringify(payload)}`);
              pollForUpdates();
              setLastSyncTime(Date.now());
            }
          )
          .subscribe();

        logDebug('Supabase realtime subscription set up');
      } catch (error) {
        logDebug(`Error setting up Supabase realtime: ${error.message}`);
      }
    };

    setupRealtimeSubscription();
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('supabase-update', handleSupabaseUpdate);
    window.addEventListener('force-refresh', handleForceRefresh);

    // Network status monitoring
    const handleOnline = () => {
      logDebug('Network is back online');
      setConnectionStatus('reconnecting');
      pollForUpdates();
    };

    const handleOffline = () => {
      logDebug('Network is offline');
      setConnectionStatus('offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Set up polling interval
    pollIntervalRef.current = setInterval(pollForUpdates, 1000); // Reduced from 2000ms to 1000ms for faster updates
    pollForUpdates(); // Initial call

    // Set up heartbeat interval to keep connection alive
    heartbeatIntervalRef.current = setInterval(() => {
      sendHeartbeat();
    }, 15000); // Send heartbeat every 15 seconds

    // Send initial heartbeat
    sendHeartbeat();

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('supabase-update', handleSupabaseUpdate);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('force-refresh', handleForceRefresh);
      
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      
      if (realtimeSubscription.current) {
        realtimeSubscription.current.unsubscribe();
      }
    };
  }, [sessionId, name, isJoined, lastSyncTime]);

  // Send heartbeat to server
  const sendHeartbeat = async () => {
    if (!isJoined || !name) return;
    
    try {
      // Create a heartbeat entry for this student
      const heartbeatEntry = {
        id: `${sessionId}_${name}_heartbeat_${Date.now()}`,
        sessionId: sessionId,
        taskNumber: currentTask?.task_number || 0, // Use current task or 0 for heartbeat
        student_name: name,
        content: 'heartbeat',
        timestamp: new Date().toISOString(),
        deviceId: navigator.userAgent,
        type: 'heartbeat'
      };

      // Try to save to Supabase
      await supabase.from('student_entries').insert(heartbeatEntry).catch(err => {
        logDebug(`Error saving heartbeat to Supabase: ${err.message}`);
      });
      
      logDebug('Sent heartbeat to server');
    } catch (error) {
      logDebug(`Error sending heartbeat: ${error.message}`);
    }
  };

  const joinSession = () => {
    if (name.trim()) {
      setIsJoined(true);
      localStorage.setItem(`student_name_${sessionId}`, name);
      logDebug(`Joined session as: ${name}`);

      // Force an immediate poll for current task
      const sessions = JSON.parse(localStorage.getItem('sessions') || '[]');
      const activeSessions = sessions.filter(s => 
        s.session_id === sessionId && s.is_active
      );
      
      if (activeSessions.length > 0) {
        const latestTask = activeSessions.sort((a, b) => 
          b.task_number - a.task_number
        )[0];
        logDebug(`Found active task in localStorage: ${latestTask.question}`);
        setCurrentTask(latestTask);
      }

      // Immediately check for Supabase session
      supabase
        .from('sessions')
        .select('*')
        .eq('session_id', sessionId)
        .eq('is_active', true)
        .order('task_number', { ascending: false })
        .limit(1)
        .then(({ data }) => {
          if (data && data.length > 0) {
            logDebug(`Found active task in Supabase: ${data[0].question}`);
            setCurrentTask(data[0]);
            setConnectionStatus('connected');
          } else {
            logDebug('No active tasks found in Supabase');
            
            // Also check for any sessions with this ID to verify connection
            supabase
              .from('sessions')
              .select('*')
              .eq('session_id', sessionId)
              .limit(1)
              .then(({ data: anyData }) => {
                if (anyData && anyData.length > 0) {
                  logDebug('Found session in Supabase but it\'s not active');
                } else {
                  logDebug(`No sessions found in Supabase for sessionId: ${sessionId}`);
                }
              });
          }
        })
        .catch(err => {
          logDebug(`Error fetching session: ${err.message}`);
        });

      // Send initial connection notification
      setTimeout(() => {
        sendHeartbeat();
      }, 500);
    }
  };

  const submitAnswer = async () => {
    if (!answer.trim() || !currentTask) return;

    const entry = {
      id: `${sessionId}_${name}_${Date.now()}`,
      sessionId: sessionId,
      taskNumber: currentTask.task_number,
      student_name: name,
      content: answer,
      timestamp: new Date().toISOString(),
      deviceId: navigator.userAgent // Add device identifier
    };

    try {
      setConnectionStatus('submitting');
      logDebug(`Submitting answer: ${answer}`);

      // Try to save to Supabase first
      let savedToSupabase = false;
      try {
        const { data, error } = await supabase.from('student_entries').insert(entry);
        if (!error) {
          savedToSupabase = true;
          logDebug('Answer saved to Supabase');
        } else {
          logDebug(`Error saving to Supabase: ${error.message}`);
        }
      } catch (error) {
        logDebug(`Error saving to Supabase: ${error.message}`);
      }

      // Always save to localStorage as backup
      const existingEntries = JSON.parse(localStorage.getItem('student_entries') || '[]');
      const updatedEntries = [...existingEntries, entry];
      localStorage.setItem('student_entries', JSON.stringify(updatedEntries));
      logDebug('Answer saved to localStorage');

      // Update my entries - add new entry at the beginning for newest first order
      setMyEntries(prev => [entry, ...prev]);
      setAnswer('');

      // Trigger storage event for teacher dashboard
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'student_entries',
        newValue: JSON.stringify(updatedEntries)
      }));

      // Dispatch custom event for cross-device sync
      window.dispatchEvent(new CustomEvent('supabase-update', {
        detail: { 
          table: 'student_entries', 
          action: 'INSERT', 
          data: updatedEntries 
        }
      }));

      // Show success feedback
      setConnectionStatus('submitted');
      setTimeout(() => setConnectionStatus(savedToSupabase ? 'connected' : 'local'), 2000);
    } catch (error) {
      logDebug(`Error submitting answer: ${error.message}`);
      console.error("Error submitting answer:", error);
      setConnectionStatus('error');
      setTimeout(() => setConnectionStatus('local'), 2000);
    }
  };

  const forceSync = async () => {
    // Force refresh data from localStorage and Supabase
    setConnectionStatus('syncing');
    logDebug('Force sync requested');

    try {
      // Try Supabase first
      const { data: sessionData, error: sessionError } = await supabase
        .from('sessions')
        .select('*')
        .eq('session_id', sessionId)
        .eq('is_active', true)
        .order('task_number', { ascending: false })
        .limit(1);

      if (!sessionError && sessionData && sessionData.length > 0) {
        logDebug(`Force sync found active session in Supabase: Task ${sessionData[0].task_number}`);
        setCurrentTask(sessionData[0]);
        setConnectionStatus('connected');
      } else {
        logDebug('Force sync found no active session in Supabase');
        
        // Check if any sessions exist for this ID
        const { data: allSessions, error: allSessionsError } = await supabase
          .from('sessions')
          .select('*')
          .eq('session_id', sessionId)
          .limit(1);

        if (!allSessionsError && allSessions && allSessions.length > 0) {
          logDebug(`Found session in Supabase but it's not active`);
        } else {
          logDebug(`No sessions found in Supabase for sessionId: ${sessionId}`);
        }

        // Fallback to localStorage
        const sessions = JSON.parse(localStorage.getItem('sessions') || '[]');
        const activeSessions = sessions.filter(s => 
          s.session_id === sessionId && s.is_active
        );
        
        if (activeSessions.length > 0) {
          const latestTask = activeSessions.sort((a, b) => 
            b.task_number - a.task_number
          )[0];
          logDebug(`Force sync found active session in localStorage: Task ${latestTask.task_number}`);
          setCurrentTask(latestTask);
          setConnectionStatus('local');
        } else {
          logDebug('Force sync found no active session in localStorage');
          setCurrentTask(null);
          setConnectionStatus('waiting');
        }
      }

      // Get entries from Supabase
      const { data: entriesData, error: entriesError } = await supabase
        .from('student_entries')
        .select('*')
        .eq('sessionId', sessionId)
        .eq('student_name', name);

      if (!entriesError && entriesData && entriesData.length > 0) {
        logDebug(`Force sync found ${entriesData.length} entries in Supabase`);
        
        // Sort by timestamp (newest first)
        const sortedEntries = entriesData.sort((a, b) => 
          new Date(b.timestamp) - new Date(a.timestamp)
        );
        
        setMyEntries(sortedEntries);
      } else {
        // Fallback to localStorage for entries
        const entries = JSON.parse(localStorage.getItem('student_entries') || '[]');
        const mySessionEntries = entries.filter(entry => 
          entry.sessionId === sessionId && 
          entry.student_name === name
        );
        
        // Sort by timestamp (newest first)
        const sortedEntries = mySessionEntries.sort((a, b) => 
          new Date(b.timestamp) - new Date(a.timestamp)
        );
        
        logDebug(`Force sync found ${sortedEntries.length} entries in localStorage`);
        setMyEntries(sortedEntries);
      }

      setLastSyncTime(Date.now());

      // Send a heartbeat to ensure connection is working
      sendHeartbeat();
    } catch (error) {
      logDebug(`Error forcing sync: ${error.message}`);
      console.error("Error forcing sync:", error);
      setConnectionStatus('error');

      // Fallback to localStorage
      try {
        const sessions = JSON.parse(localStorage.getItem('sessions') || '[]');
        const activeSessions = sessions.filter(s => 
          s.session_id === sessionId && s.is_active
        );
        
        if (activeSessions.length > 0) {
          const latestTask = activeSessions.sort((a, b) => 
            b.task_number - a.task_number
          )[0];
          setCurrentTask(latestTask);
          logDebug('Fallback to localStorage successful');
        } else {
          setCurrentTask(null);
        }
        
        const entries = JSON.parse(localStorage.getItem('student_entries') || '[]');
        const mySessionEntries = entries.filter(entry => 
          entry.sessionId === sessionId && 
          entry.student_name === name
        );
        
        // Sort by timestamp (newest first)
        const sortedEntries = mySessionEntries.sort((a, b) => 
          new Date(b.timestamp) - new Date(a.timestamp)
        );
        
        setMyEntries(sortedEntries);
        setConnectionStatus('local');
      } catch (localError) {
        logDebug(`Error with localStorage fallback: ${localError.message}`);
        console.error("Error with localStorage fallback:", localError);
        setConnectionStatus('error');
      }
    }
  };

  const markAnswer = (taskNumber, answerId, isCorrect) => {
    const markingKey = `${taskNumber}_${answerId}`;
    const newMarking = { ...selfMarking, [markingKey]: isCorrect };
    setSelfMarking(newMarking);
    localStorage.setItem(`self_marking_${sessionId}`, JSON.stringify(newMarking));
  };

  const getCorrectCount = () => {
    return Object.values(selfMarking).filter(Boolean).length;
  };

  const getTaskEntries = (taskNumber) => {
    return myEntries.filter(entry => entry.taskNumber === taskNumber);
  };

  // Render debug log modal
  const renderDebugLog = () => {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col">
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
              <p>User: {name}</p>
              <p>Connection Status: {connectionStatus}</p>
              <p>Current Task: {currentTask ? `#${currentTask.task_number} - ${currentTask.question}` : 'None'}</p>
            </div>
            {debugLog.current.map((log, index) => (
              <div key={index} className="py-1 border-b border-gray-200">
                {log}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const getConnectionStatusUI = () => {
    switch (connectionStatus) {
      case 'connected':
        return (
          <span className="text-green-600 text-xs flex items-center gap-1">
            <SafeIcon icon={FiWifi} /> Connected to server
          </span>
        );
      case 'local':
        return (
          <span className="text-blue-600 text-xs flex items-center gap-1">
            <SafeIcon icon={FiWifiOff} /> Using local storage
          </span>
        );
      case 'reconnecting':
        return (
          <span className="text-yellow-600 text-xs flex items-center gap-1 animate-pulse">
            <SafeIcon icon={FiRefreshCw} className="animate-spin" /> Reconnecting...
          </span>
        );
      case 'syncing':
        return (
          <span className="text-blue-600 text-xs flex items-center gap-1">
            <SafeIcon icon={FiRefreshCw} className="animate-spin" /> Syncing...
          </span>
        );
      case 'submitting':
        return (
          <span className="text-blue-600 text-xs flex items-center gap-1">
            <SafeIcon icon={FiRefreshCw} className="animate-spin" /> Submitting...
          </span>
        );
      case 'submitted':
        return (
          <span className="text-green-600 text-xs flex items-center gap-1">
            <SafeIcon icon={FiCheckCircle} /> Answer submitted!
          </span>
        );
      case 'offline':
        return (
          <span className="text-red-600 text-xs flex items-center gap-1">
            <SafeIcon icon={FiWifiOff} /> Offline mode
          </span>
        );
      case 'waiting':
        return (
          <span className="text-yellow-600 text-xs flex items-center gap-1">
            <SafeIcon icon={FiClock} /> Waiting for activity
          </span>
        );
      case 'error':
        return (
          <span className="text-red-600 text-xs flex items-center gap-1">
            <SafeIcon icon={FiAlertCircle} /> Connection error
          </span>
        );
      default:
        return (
          <span className="text-blue-600 text-xs flex items-center gap-1">
            <SafeIcon icon={FiRefreshCw} className="animate-spin" /> Connecting...
          </span>
        );
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isJoined) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-md">
          <div className="text-center mb-6">
            <SafeIcon icon={FiUser} className="text-4xl text-blue-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-800">Join ESOL Session</h1>
            <p className="text-gray-600 mt-2">Enter your name to participate</p>
          </div>
          <div className="space-y-4">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              className="w-full p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
              onKeyPress={(e) => e.key === 'Enter' && joinSession()}
            />
            <button
              onClick={joinSession}
              disabled={!name.trim()}
              className="w-full p-4 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 text-white rounded-lg font-semibold transition-all text-lg"
            >
              Join Session
            </button>
            <div className="flex items-center justify-between">
              <p className="text-center text-xs text-gray-500">
                Session ID: {sessionId}
              </p>
              <button
                onClick={() => setShowDebug(true)}
                className="text-xs flex items-center gap-1 text-gray-400 hover:text-gray-600"
              >
                <SafeIcon icon={FiBug} className="text-xs" /> Debug
              </button>
            </div>
          </div>
        </div>
        {showDebug && renderDebugLog()}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100 p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Welcome, {name}!</h1>
              <div className="flex items-center mt-1">
                <p className="text-gray-600 mr-2">ESOL Learning Session</p>
                {getConnectionStatusUI()}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-gray-500">Correct Answers</div>
              <div className="text-2xl font-bold text-green-600">
                {getCorrectCount()}/{myEntries.length}
              </div>
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={forceSync}
              className="text-xs flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
            >
              <SafeIcon icon={FiRefreshCw} /> Refresh
            </button>
            <button
              onClick={() => setShowDebug(true)}
              className="text-xs flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            >
              <SafeIcon icon={FiBug} /> Debug
            </button>
          </div>
        </div>

        {/* Current Task */}
        {currentTask ? (
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <SafeIcon icon={FiClock} className="text-blue-500" />
              <h2 className="text-xl font-semibold">Task {currentTask.task_number}</h2>
              <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">
                {currentTask.activity_type}
              </span>
            </div>
            <div className="bg-blue-50 p-4 rounded-lg mb-6">
              <h3 className="font-semibold text-blue-800 mb-2">Question:</h3>
              <p className="text-lg text-gray-800">{currentTask.question}</p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Your Answer:
                </label>
                <input
                  type="text"
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder={currentTask.activity_type === 'wordcloud' ? 'Type one word...' : 'Type your sentence...'}
                  className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  onKeyPress={(e) => e.key === 'Enter' && submitAnswer()}
                />
              </div>
              <button
                onClick={submitAnswer}
                disabled={!answer.trim()}
                className="flex items-center justify-center gap-2 w-full p-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white rounded-lg font-semibold transition-all"
              >
                <SafeIcon icon={FiSend} /> Submit Answer
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6 text-center">
            <SafeIcon icon={FiAlertCircle} className="text-yellow-500 text-3xl mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Waiting for Teacher</h3>
            <p className="text-gray-600 mb-4">The teacher will start the next task soon...</p>
            <button
              onClick={forceSync}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"
            >
              <SafeIcon icon={FiRefreshCw} /> Check for updates
            </button>
          </div>
        )}

        {/* My Previous Answers */}
        {myEntries.length > 0 && (
          <div className="bg-white rounded-xl shadow-lg p-6">
            <h3 className="text-lg font-semibold mb-4">My Previous Answers</h3>
            <div className="space-y-3">
              {myEntries.map((entry, index) => (
                <div key={index} className="bg-gray-50 p-3 rounded border">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-gray-800 flex-1">{entry.content}</p>
                    <div className="flex gap-2 ml-4">
                      <button
                        onClick={() => markAnswer(entry.taskNumber, index, true)}
                        className={`px-3 py-1 rounded text-sm font-medium transition-all ${
                          selfMarking[`${entry.taskNumber}_${index}`] === true 
                            ? 'bg-green-500 text-white' 
                            : 'bg-gray-200 text-gray-700 hover:bg-green-100'
                        }`}
                      >
                        ✓ Correct
                      </button>
                      <button
                        onClick={() => markAnswer(entry.taskNumber, index, false)}
                        className={`px-3 py-1 rounded text-sm font-medium transition-all ${
                          selfMarking[`${entry.taskNumber}_${index}`] === false 
                            ? 'bg-red-500 text-white' 
                            : 'bg-gray-200 text-gray-700 hover:bg-red-100'
                        }`}
                      >
                        ✗ Wrong
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500">
                    {new Date(entry.timestamp).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {showDebug && renderDebugLog()}
    </div>
  );
}

export default StudentView;