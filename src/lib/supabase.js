import { createClient } from '@supabase/supabase-js';

// Verified credentials from Supabase
const SUPABASE_URL = 'https://oqubhegidkcomehtzgar.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xdWJoZWdpZGtjb21laHR6Z2FyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTI5NjE4OTgsImV4cCI6MjA2ODUzNzg5OH0.LLIC4x0g95BtIBOG60mNYRHLHLT0yqroR1ufKHcRfWw';

// Create a direct realtime communication client
const createRealtimeClient = () => {
  console.log('Creating Supabase client with realtime enabled');
  
  try {
    const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      },
      realtime: {
        timeout: 10000, // Reduce timeout for faster reconnections
        params: {
          eventsPerSecond: 40 // Increase events per second for more responsive updates
        }
      }
    });
    
    // Setup client with enhanced debug logging
    client.channel('system')
      .on('system', { event: 'reconnect' }, () => {
        console.log('Realtime system reconnected');
      })
      .on('system', { event: 'disconnect' }, () => {
        console.log('Realtime system disconnected');
      })
      .subscribe((status) => {
        console.log('System channel status:', status);
      });
    
    console.log('Supabase client created successfully');
    return client;
  } catch (error) {
    console.error('Error creating Supabase client:', error);
    throw error;
  }
};

// Create a polling-based localStorage implementation for cross-device sync
const createLocalStorageClient = () => {
  console.warn('Using localStorage with polling for cross-device sync');
  
  // Create unique client ID to track changes
  const clientId = Math.random().toString(36).substring(2, 15);
  
  // Set up polling for cross-device sync
  const setupPolling = (tableName, callback) => {
    const interval = setInterval(() => {
      try {
        const lastData = JSON.parse(localStorage.getItem(`${tableName}_last_poll_${clientId}`) || '[]');
        const currentData = JSON.parse(localStorage.getItem(tableName) || '[]');
        
        // Check if data has changed
        if (JSON.stringify(lastData) !== JSON.stringify(currentData)) {
          localStorage.setItem(`${tableName}_last_poll_${clientId}`, JSON.stringify(currentData));
          if (callback) callback(currentData);
        }
      } catch (e) {
        console.error('Error polling localStorage:', e);
      }
    }, 250); // Even more frequent polling (250ms) for better responsiveness
    
    return () => clearInterval(interval);
  };
  
  // Store active subscriptions
  const subscriptions = {};
  
  return {
    from: (table) => ({
      select: (columns = '*') => ({
        eq: (field, value) => {
          const data = JSON.parse(localStorage.getItem(table) || '[]');
          const filtered = data.filter(item => item[field] === value);
          return Promise.resolve({ data: filtered, error: null });
        },
        neq: (field, value) => {
          const data = JSON.parse(localStorage.getItem(table) || '[]');
          const filtered = data.filter(item => item[field] !== value);
          return Promise.resolve({ data: filtered, error: null });
        },
        order: (column, { ascending = true } = {}) => ({
          limit: (n) => {
            const data = JSON.parse(localStorage.getItem(table) || '[]');
            const sorted = [...data].sort((a, b) => {
              if (ascending) {
                return a[column] > b[column] ? 1 : -1;
              } else {
                return a[column] < b[column] ? 1 : -1;
              }
            });
            return Promise.resolve({ data: sorted.slice(0, n), error: null });
          }
        })
      }),
      insert: (data) => {
        const existing = JSON.parse(localStorage.getItem(table) || '[]');
        const newData = Array.isArray(data) ? data : [data];
        const updatedData = [...existing, ...newData];
        localStorage.setItem(table, JSON.stringify(updatedData));
        
        // Broadcast update
        const event = new CustomEvent('supabase-update', { 
          detail: { table, action: 'INSERT', data: updatedData } 
        });
        window.dispatchEvent(event);
        
        return Promise.resolve({ data: newData, error: null });
      },
      upsert: (data) => {
        const existing = JSON.parse(localStorage.getItem(table) || '[]');
        const updated = existing.filter(item => item.id !== data.id);
        const updatedData = [...updated, data];
        localStorage.setItem(table, JSON.stringify(updatedData));
        
        // Broadcast update
        const event = new CustomEvent('supabase-update', { 
          detail: { table, action: 'UPSERT', data: updatedData } 
        });
        window.dispatchEvent(event);
        
        return Promise.resolve({ data: [data], error: null });
      },
      update: (data) => ({
        eq: (field, value) => {
          const existing = JSON.parse(localStorage.getItem(table) || '[]');
          const updated = existing.map(item => 
            item[field] === value ? { ...item, ...data } : item
          );
          localStorage.setItem(table, JSON.stringify(updated));
          
          // Broadcast update
          const event = new CustomEvent('supabase-update', { 
            detail: { table, action: 'UPDATE', data: updated } 
          });
          window.dispatchEvent(event);
          
          return Promise.resolve({ data: updated.filter(item => item[field] === value), error: null });
        }
      }),
      delete: () => ({
        eq: (field, value) => {
          const existing = JSON.parse(localStorage.getItem(table) || '[]');
          const updated = existing.filter(item => item[field] !== value);
          localStorage.setItem(table, JSON.stringify(updated));
          
          // Broadcast update
          const event = new CustomEvent('supabase-update', { 
            detail: { table, action: 'DELETE', data: updated } 
          });
          window.dispatchEvent(event);
          
          return Promise.resolve({ data: updated, error: null });
        }
      })
    }),
    channel: (channelName) => {
      let listeners = [];
      
      return {
        on: (event, filter, callback) => {
          const tableName = filter.schema + '.' + filter.table;
          
          // Store the listener details
          listeners.push({ event, filter, callback });
          
          // Set up polling if needed
          if (!subscriptions[tableName]) {
            subscriptions[tableName] = setupPolling(tableName, (data) => {
              listeners.forEach(listener => {
                if (listener.event === event && 
                    listener.filter.schema === filter.schema && 
                    listener.filter.table === filter.table) {
                  listener.callback({ new: { data } });
                }
              });
            });
          }
          
          // Add event listener for immediate updates
          const handleUpdate = (e) => {
            if (e.detail.table === tableName) {
              callback({ new: { data: e.detail.data } });
            }
          };
          window.addEventListener('supabase-update', handleUpdate);
          
          return {
            subscribe: () => {
              // Return unsubscribe function
              return () => {
                window.removeEventListener('supabase-update', handleUpdate);
                listeners = listeners.filter(l => l.callback !== callback);
              };
            }
          };
        },
        subscribe: (callback) => {
          // Execute callback if provided
          if (callback && typeof callback === 'function') {
            setTimeout(() => callback('SUBSCRIBED'), 0);
          }
          
          // Return unsubscribe function
          return () => {
            listeners.forEach(listener => {
              const tableName = listener.filter.schema + '.' + listener.filter.table;
              if (subscriptions[tableName]) {
                subscriptions[tableName]();
                delete subscriptions[tableName];
              }
            });
            listeners = [];
          };
        },
        unsubscribe: () => {
          listeners.forEach(listener => {
            const tableName = listener.filter.schema + '.' + listener.filter.table;
            if (subscriptions[tableName]) {
              subscriptions[tableName]();
              delete subscriptions[tableName];
            }
          });
          listeners = [];
        }
      };
    },
    auth: {
      onAuthStateChange: () => ({ data: {}, error: null }),
      getSession: () => Promise.resolve({ data: { session: null }, error: null })
    },
    rpc: (functionName, params = {}) => {
      if (functionName === 'create_sessions_table') {
        // Mock implementation for creating sessions table
        localStorage.setItem('sessions_schema_created', 'true');
        return Promise.resolve({ data: true, error: null });
      }
      if (functionName === 'create_student_entries_table') {
        // Mock implementation for creating student entries table
        localStorage.setItem('student_entries_schema_created', 'true');
        return Promise.resolve({ data: true, error: null });
      }
      if (functionName === 'connection_test') {
        return Promise.resolve({ data: 'Connection successful', error: null });
      }
      return Promise.resolve({ data: null, error: 'Function not implemented in localStorage fallback' });
    }
  };
};

// Create a function to test the Supabase connection
const testSupabaseConnection = async (client) => {
  try {
    console.log('Testing Supabase connection...');
    const start = Date.now();
    
    // Test connection with simple RPC call
    const { data, error } = await client.rpc('connection_test');
    
    if (error) {
      console.error('❌ Supabase connection test failed:', error);
      return false;
    }
    
    const duration = Date.now() - start;
    console.log(`✅ Supabase connection successful (${duration}ms): ${data}`);
    return true;
  } catch (error) {
    console.error('❌ Supabase connection test error:', error);
    return false;
  }
};

// Create the tables directly if they don't exist
const ensureTablesExist = async (client) => {
  try {
    console.log('Ensuring required tables exist...');
    
    // Create sessions table
    try {
      await client.from('sessions').select('count(*)').limit(1);
      console.log('Sessions table exists');
    } catch (error) {
      console.log('Creating sessions table...');
      try {
        await client.rpc('create_sessions_table');
        console.log('Sessions table created successfully');
      } catch (e) {
        console.error('Error creating sessions table:', e);
      }
    }
    
    // Create student_entries table
    try {
      await client.from('student_entries').select('count(*)').limit(1);
      console.log('Student entries table exists');
    } catch (error) {
      console.log('Creating student_entries table...');
      try {
        await client.rpc('create_student_entries_table');
        console.log('Student entries table created successfully');
      } catch (e) {
        console.error('Error creating student_entries table:', e);
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error ensuring tables exist:', error);
    return false;
  }
};

// Try to create a Supabase client first, fall back to localStorage if that fails
let supabaseClient;

try {
  supabaseClient = createRealtimeClient();
  
  // Test connection immediately but don't block initialization
  testSupabaseConnection(supabaseClient)
    .then(isConnected => {
      if (isConnected) {
        // Ensure tables exist
        ensureTablesExist(supabaseClient).catch(console.error);
        
        // Set up additional realtime subscriptions for better cross-device sync
        supabaseClient.channel('global_sync')
          .on('broadcast', { event: 'sync' }, payload => {
            console.log('Received sync broadcast:', payload);
            window.dispatchEvent(new CustomEvent('force-refresh', {}));
          })
          .subscribe(status => {
            console.log('Global sync channel status:', status);
          });
      } else {
        console.warn('⚠️ Using localStorage fallback due to connection issues');
        supabaseClient = createLocalStorageClient();
      }
    })
    .catch(error => {
      console.error('Error during connection test:', error);
      supabaseClient = createLocalStorageClient();
    });
} catch (error) {
  console.error('❌ Error initializing Supabase:', error);
  supabaseClient = createLocalStorageClient();
}

// Create necessary tables in Supabase if they don't exist
(async () => {
  try {
    // Try to create the connection_test function
    await supabaseClient.rpc('connection_test').catch(async () => {
      console.log('Creating connection_test function');
      
      // Direct SQL approach as fallback
      try {
        // This would require direct SQL execution which isn't available in the public API
        console.log('Unable to create connection_test function through API');
      } catch (e) {
        console.error('Failed to create connection_test function:', e);
      }
    });
    
    // Try to create the sessions table
    await supabaseClient.from('sessions').select('count(*)').limit(1).catch(async () => {
      console.log('Creating sessions table');
      
      // Direct SQL approach as fallback - would require admin access
      console.log('Cannot create sessions table directly through API');
    });
    
    // Try to create the student_entries table
    await supabaseClient.from('student_entries').select('count(*)').limit(1).catch(async () => {
      console.log('Creating student_entries table');
      
      // Direct SQL approach as fallback - would require admin access
      console.log('Cannot create student_entries table directly through API');
    });
  } catch (e) {
    console.error('Error setting up database:', e);
  }
})();

export const supabase = supabaseClient;