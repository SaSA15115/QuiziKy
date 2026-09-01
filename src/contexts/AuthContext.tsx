import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Session } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase, supabaseProjectUrl } from '@/integrations/supabase/client';

const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification('Quiz App', { 
        body: message,
        icon: '/favicon.ico',
        badge: '/favicon.ico'
      });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          new Notification('Quiz App', { 
            body: message,
            icon: '/favicon.ico',
            badge: '/favicon.ico'
          });
        }
      });
    }
  }
};

export type UserRole = 'teacher' | 'student' | 'personal';

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  joinedAt?: string;
  profilePicture?: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  login: (email: string, password: string) => Promise<boolean>;
  signup: (email: string, password: string, name: string, role: UserRole) => Promise<AuthActionResult>;
  logout: () => void;
  isAuthenticated: boolean;
  loading: boolean;
  isConfigured: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch user profile from profiles table
  const fetchUserProfile = async (userId: string): Promise<User | null> => {
    if (!supabase) return null;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) {
        console.error('Error fetching user profile:', error);
        return null;
      }

      // Check for locally saved profile data (like profile picture)
      const localUserData = localStorage.getItem('user');
      const localProfile = localUserData ? JSON.parse(localUserData) : null;

      return {
        id: data.user_id,
        email: data.email,
        name: data.name,
        role: data.role as UserRole,
        joinedAt: data.created_at,
        profilePicture: localProfile?.profilePicture || data.avatar_url
      };
    } catch (error) {
      console.error('Error fetching user profile:', error);
      return null;
    }
  };

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    // Request notification permission on app load
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        
        if (session?.user) {
          // Defer the profile fetch with setTimeout to prevent deadlock
          setTimeout(async () => {
            const userProfile = await fetchUserProfile(session.user.id);
            setUser(userProfile);
            setLoading(false);
            
            // Show welcome notification only, let React Router handle navigation
            if (userProfile && window.location.pathname === '/auth') {
              showNotification(`Welcome ${userProfile.name}! You're now signed in.`, 'success');
            }
          }, 0);
        } else {
          setUser(null);
          setLoading(false);
        }
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      
      if (session?.user) {
        setTimeout(async () => {
          const userProfile = await fetchUserProfile(session.user.id);
          setUser(userProfile);
          setLoading(false);
        }, 0);
      } else {
        setLoading(false);
      }
    }).catch((error) => {
      console.error('Error restoring Supabase session:', error);
      setUser(null);
      setSession(null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const login = async (email: string, password: string): Promise<boolean> => {
    if (!supabase) return false;

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('Login error:', error);
        return false;
      }

      if (data.user) {
        showNotification('Successfully signed in!', 'success');
        return true;
      }

      return false;
    } catch (error) {
      console.error('Login error:', error);
      return false;
    }
  };

  const signup = async (email: string, password: string, name: string, role: UserRole): Promise<AuthActionResult> => {
    if (!supabase) {
      return { success: false, error: 'Supabase is not configured. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.' };
    }

    try {
      const redirectUrl = `${window.location.origin}/`;
      const submittedEmail = email.trim();

      console.info('Supabase sign-up request', {
        projectUrl: supabaseProjectUrl,
        email: submittedEmail,
      });

      const { data, error } = await supabase.auth.signUp({
        email: submittedEmail,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            name,
            role,
          },
        },
      });

      if (error) {
        console.error('Supabase sign-up error', {
          message: error.message,
          status: error.status,
        });
        return { success: false, error: error.message };
      }

      if (data.user) {
        showNotification('Account created! Please check your email to confirm your account.', 'success');
        return { success: true };
      }

      return { success: false, error: 'Supabase did not return a user for this sign-up request.' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred while creating the account.';
      console.error('Supabase sign-up exception', { message });
      return { success: false, error: message };
    }
  };

  const logout = async () => {
    if (!supabase) {
      setUser(null);
      setSession(null);
      return;
    }

    try {
      await supabase.auth.signOut();
      setUser(null);
      setSession(null);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      session,
      login,
      signup,
      logout,
      isAuthenticated: !!user,
      loading,
      isConfigured: isSupabaseConfigured
    }}>
      {children}
    </AuthContext.Provider>
  );
};
