import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import ReactECharts from 'echarts-for-react';
import SafeIcon from '../common/SafeIcon';
import * as FiIcons from 'react-icons/fi';

const { FiMonitor, FiUsers, FiClock, FiRefreshCw, FiWifi, FiWifiOff, FiAlertCircle } = FiIcons;

function DisplayScreen() {
  const { sessionId } = useParams();
  const [currentTask, setCurrentTask] = useState(null);
  const [entries, setEntries] = useState([]);
  const [timer, setTimer] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [lastSyncTime, setLastSyncTime] = useState(Date.now());
  const realtimeSubscription = useRef(null);
  const entriesSubscription = useRef(null);

  useEffect(() => {
    // Poll for updates 
    const pollForUpdates = async () => {
      // Try Supabase first
      try {
        const { data: sessionData, error: sessionError } = await supabase
          .from('sessions')
          .select('*')
          .eq('session_id', sessionId)
          .eq('is_active', true)
          .order('task_number', { ascending: false })
          .limit(1);
        
        if (!sessionError && sessionData && sessionData.length > 0) {
          const latestTask = sessionData[0];
          setCurrentTask(latestTask);
          setConnectionStatus('connected');
          setLastSyncTime(Date.now());
          
          // Get entries for current task
          const { data: entriesData, error: entriesError } = await supabase
            .from('student_entries')
            .select('*')
            .eq('sessionId', sessionId)
            .eq('taskNumber', latestTask.task_number);
          
          if (!entriesError && entriesData) {
            setEntries(entriesData);
          }
          
          // Calculate timer
          if (latestTask.start_time) {
            const startTime = new Date(latestTask.start_time);
            const now = new Date();
            const elapsed = Math.floor((now - startTime) / 1000);
            setTimer(elapsed);
          }
        } else {
          // Fallback to localStorage
          fallbackToLocalStorage();
        }
      } catch (error) {
        console.error("Error fetching from Supabase:", error);
        fallbackToLocalStorage();
      }
      
      setIsLoading(false);
    };
    
    const fallbackToLocalStorage = () => {
      // Get current active task
      const sessions = JSON.parse(localStorage.getItem('sessions') || '[]');
      const activeSessions = sessions.filter(s => 
        s.session_id === sessionId && s.is_active
      );
      
      if (activeSessions.length > 0) {
        const latestTask = activeSessions.sort((a, b) => b.task_number - a.task_number)[0];
        setCurrentTask(latestTask);
        setConnectionStatus('local');
        
        // Get entries for current task
        const allEntries = JSON.parse(localStorage.getItem('student_entries') || '[]');
        const taskEntries = allEntries.filter(entry => 
          entry.sessionId === sessionId && entry.taskNumber === latestTask.task_number
        );
        setEntries(taskEntries);
        
        // Calculate timer
        if (latestTask.start_time) {
          const startTime = new Date(latestTask.start_time);
          const now = new Date();
          const elapsed = Math.floor((now - startTime) / 1000);
          setTimer(elapsed);
        }
      } else {
        setCurrentTask(null);
        setEntries([]);
        setTimer(0);
        setConnectionStatus('waiting');
      }
    };

    // Set up Supabase realtime subscriptions
    const setupRealtimeSubscriptions = () => {
      try {
        // Subscribe to session changes
        realtimeSubscription.current = supabase
          .channel('display_session_changes')
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'sessions',
              filter: `session_id=eq.${sessionId}`
            },
            (payload) => {
              console.log('Session update received:', payload);
              pollForUpdates();
            }
          )
          .subscribe();
        
        // Subscribe to entries changes
        entriesSubscription.current = supabase
          .channel('display_entries_changes')
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'student_entries',
              filter: `sessionId=eq.${sessionId}`
            },
            (payload) => {
              console.log('Entries update received:', payload);
              if (currentTask) {
                supabase
                  .from('student_entries')
                  .select('*')
                  .eq('sessionId', sessionId)
                  .eq('taskNumber', currentTask.task_number)
                  .then(({ data }) => {
                    if (data) setEntries(data);
                  });
              }
            }
          )
          .subscribe();
      } catch (error) {
        console.error("Error setting up realtime subscriptions:", error);
      }
    };
    
    // Handle storage events from other tabs/windows
    const handleStorageChange = (e) => {
      if (e.key === 'sessions' || e.key === 'student_entries' || e.key === null) {
        pollForUpdates();
      }
    };

    // Network status monitoring
    const handleOnline = () => {
      console.log('Network is back online');
      setConnectionStatus('reconnecting');
      pollForUpdates();
    };
    
    const handleOffline = () => {
      console.log('Network is offline');
      setConnectionStatus('offline');
    };
    
    // Set up event listeners
    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    
    // Set up realtime subscriptions
    setupRealtimeSubscriptions();
    
    // Initial poll
    pollForUpdates();
    
    // Set up timer interval
    const timerInterval = setInterval(() => {
      if (currentTask && currentTask.is_active) {
        setTimer(prev => prev + 1);
      }
    }, 1000);
    
    // Set up polling interval as backup
    const pollingInterval = setInterval(pollForUpdates, 5000);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(timerInterval);
      clearInterval(pollingInterval);
      
      if (realtimeSubscription.current) {
        realtimeSubscription.current.unsubscribe();
      }
      
      if (entriesSubscription.current) {
        entriesSubscription.current.unsubscribe();
      }
    };
  }, [sessionId, currentTask]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getWordCloudData = () => {
    const wordCount = {};
    entries.forEach(entry => {
      const word = entry.content.toLowerCase().trim();
      if (word) {
        wordCount[word] = (wordCount[word] || 0) + 1;
      }
    });
    return Object.entries(wordCount).map(([name, value]) => ({
      name,
      value: Math.max(16, Math.sqrt(value) * 30),
      textStyle: {
        color: `hsl(${Math.random() * 360}, 70%, 50%)`
      }
    }));
  };

  const wordCloudOption = {
    backgroundColor: 'transparent',
    series: [{
      type: 'wordCloud',
      gridSize: 8,
      sizeRange: [20, 100],
      rotationRange: [-90, 90],
      rotationStep: 45,
      shape: 'circle',
      width: '100%',
      height: '100%',
      drawOutOfBound: false,
      textStyle: {
        fontFamily: 'Arial, sans-serif',
        fontWeight: 'bold',
      },
      emphasis: {
        focus: 'self',
        textStyle: {
          shadowBlur: 10,
          shadowColor: '#333'
        }
      },
      data: getWordCloudData()
    }],
    animation: true,
    animationDuration: 1000,
    animationEasing: 'elasticOut'
  };

  // Render connection status
  const renderConnectionStatus = () => {
    switch (connectionStatus) {
      case 'connected':
        return <span className="text-green-600 text-xs flex items-center gap-1">
          <SafeIcon icon={FiWifi} /> Connected to server
        </span>;
      case 'local':
        return <span className="text-blue-600 text-xs flex items-center gap-1">
          <SafeIcon icon={FiWifiOff} /> Using local storage
        </span>;
      case 'reconnecting':
        return <span className="text-yellow-600 text-xs flex items-center gap-1 animate-pulse">
          <SafeIcon icon={FiRefreshCw} className="animate-spin" /> Reconnecting...
        </span>;
      case 'offline':
        return <span className="text-red-600 text-xs flex items-center gap-1">
          <SafeIcon icon={FiWifiOff} /> Offline mode
        </span>;
      case 'waiting':
        return <span className="text-yellow-600 text-xs flex items-center gap-1">
          <SafeIcon icon={FiClock} /> Waiting for activity
        </span>;
      case 'error':
        return <span className="text-red-600 text-xs flex items-center gap-1">
          <SafeIcon icon={FiAlertCircle} /> Connection error
        </span>;
      default:
        return <span className="text-blue-600 text-xs flex items-center gap-1">
          <SafeIcon icon={FiRefreshCw} className="animate-spin" /> Connecting...
        </span>;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-100 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-purple-600 border-t-transparent"></div>
          <p className="mt-4 text-gray-600">Loading display...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-100">
      {/* Header */}
      <div className="bg-white shadow-sm p-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SafeIcon icon={FiMonitor} className="text-2xl text-purple-600" />
            <h1 className="text-2xl font-bold text-gray-800">ESOL Display Screen</h1>
          </div>
          <div className="flex items-center gap-2">
            {renderConnectionStatus()}
            <button 
              onClick={() => window.location.reload()} 
              className="ml-2 p-1 rounded-full hover:bg-gray-100"
              title="Refresh Display"
            >
              <SafeIcon icon={FiRefreshCw} className="text-gray-600" />
            </button>
          </div>
          {currentTask && (
            <div className="flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <SafeIcon icon={FiUsers} className="text-blue-500" />
                <span className="font-medium">{entries.length} responses</span>
              </div>
              <div className="flex items-center gap-2">
                <SafeIcon icon={FiClock} className="text-green-500" />
                <span className="font-mono text-lg font-bold">{formatTime(timer)}</span>
              </div>
              <div className="bg-purple-100 text-purple-800 px-3 py-1 rounded-full text-xs font-medium">
                Task {currentTask.task_number}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6">
        {currentTask ? (
          <div className="max-w-7xl mx-auto">
            {/* Question Display */}
            <div className="bg-white rounded-xl shadow-lg p-8 mb-6">
              <div className="text-center">
                <div className="inline-flex items-center gap-2 bg-purple-100 text-purple-800 px-4 py-2 rounded-full text-sm font-medium mb-4">
                  <span>Task {currentTask.task_number}</span>
                  <span>•</span>
                  <span className="capitalize">{currentTask.activity_type}</span>
                </div>
                <h2 className="text-3xl font-bold text-gray-800 mb-2">
                  {currentTask.question}
                </h2>
                <p className="text-lg text-gray-600">
                  {currentTask.activity_type === 'wordcloud' ? 
                    'Students are submitting single words' : 
                    'Students are submitting sentences'}
                </p>
              </div>
            </div>

            {/* Response Display */}
            <div className="bg-white rounded-xl shadow-lg p-6">
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
                <>
                  {currentTask.activity_type === 'wordcloud' ? (
                    <div className="h-[70vh]">
                      <ReactECharts 
                        option={wordCloudOption} 
                        style={{ height: '100%', width: '100%' }}
                        opts={{ renderer: 'canvas' }}
                      />
                    </div>
                  ) : (
                    <div className="max-h-[70vh] overflow-y-auto">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {entries
                          .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                          .map((entry, index) => (
                            <div 
                              key={`${entry.timestamp}-${index}`}
                              className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 p-4 rounded-lg hover:shadow-md transition-all duration-200"
                              style={{
                                animationDelay: `${index * 0.1}s`,
                                animation: 'fadeInUp 0.5s ease-out forwards'
                              }}
                            >
                              <div className="font-semibold text-purple-600 text-sm mb-2">
                                {entry.student_name}
                              </div>
                              <p className="text-gray-800 leading-relaxed">{entry.content}</p>
                              <div className="text-xs text-gray-500 mt-2">
                                {new Date(entry.timestamp).toLocaleTimeString()}
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Live Stats */}
            {entries.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                <div className="bg-white rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-blue-600">{entries.length}</div>
                  <div className="text-sm text-gray-600">Total Responses</div>
                </div>

                {currentTask.activity_type === 'wordcloud' && (
                  <div className="bg-white rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {new Set(entries.map(e => e.content.toLowerCase())).size}
                    </div>
                    <div className="text-sm text-gray-600">Unique Words</div>
                  </div>
                )}

                <div className="bg-white rounded-lg p-4 text-center">
                  <div className="text-2xl font-bold text-purple-600">{formatTime(timer)}</div>
                  <div className="text-sm text-gray-600">Time Elapsed</div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="max-w-4xl mx-auto text-center py-16">
            <div className="text-8xl mb-6">📚</div>
            <h2 className="text-3xl font-bold text-gray-800 mb-4">
              ESOL Learning Session
            </h2>
            <p className="text-xl text-gray-600 mb-8">
              Waiting for teacher to start the first task...
            </p>
            <div className="bg-white rounded-lg p-6 inline-block shadow-lg">
              <p className="text-gray-500">Session ID: <span className="font-mono text-sm">{sessionId}</span></p>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

export default DisplayScreen;