import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import ChatInput from './components/ChatInput';
import ChatMessage from './components/ChatMessage';
import { Message, Role, Source } from './types';
import { getSystemInstruction } from './constants';
import AIAvatar from './components/AIAvatar';
import LoginPage from './components/LoginPage';
import AdminDashboard from './components/AdminDashboard';
import { supabase } from './src/supabaseClient';
import { trackEvent } from './src/analytics';

const welcomeMessage: Message = {
  id: 'welcome-0',
  role: Role.MODEL,
  content: 'Get Simple, Straight Answers\nto Complex Legal Challenges\n\nHello! I\'m Matt, an AI guru with a strong legal research background.\n\nI\'ll help you research Kenyan Case Law, Acts of Parliament and published articles.'
};

interface CurrentUser {
  id: string;
  full_name: string | null;
  email: string | null;
  role: 'user' | 'admin' | null;
}

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [messages, setMessages] = useState<Message[]>([welcomeMessage]);
  const [sourcesByMsgId, setSourcesByMsgId] = useState<Record<string, Source[]>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);

  const chatContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;

    const handleSession = async (session: any) => {
      if (!session?.user) return;

      try {
        const { user } = session;

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('full_name, role')
          .eq('id', user.id)
          .maybeSingle();

        if (!active) return;

        if (error) {
          console.error('Profile loading error:', error);
        }

        const mapped: CurrentUser = {
          id: user.id,
          full_name:
            profile?.full_name ||
            user.email?.split('@')[0] ||
            'User',
          email: user.email,
          role: profile?.role === 'admin' ? 'admin' : 'user'
        };

        setCurrentUser(mapped);

        await loadMessages(user.id);

        if (active) trackEvent('login');
      } catch (error) {
        console.error('Authentication initialization failed:', error);
      }
    };

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        setTimeout(() => {
          if (active) void handleSession(session);
        }, 0);
      } else {
        setCurrentUser(null);
        setMessages([welcomeMessage]);
        setSourcesByMsgId({});
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [messages]);

  async function loadMessages(userId: string) {
    const { data, error } = await supabase
      .from('messages')
      .select('id, role, content, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      console.warn('Load messages error:', error.message);
      setMessages([welcomeMessage]);
      return;
    }

    if (!data || data.length === 0) {
      setMessages([welcomeMessage]);
    } else {
      setMessages([
        welcomeMessage,
        ...data.map(m => ({
          id: m.id,
          role: m.role as Role,
          content: m.content
        }))
      ]);
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleSendMessage = async (userMessage: string) => {
    if (!currentUser) {
      setInitError('Please sign in before sending a message.');
      return;
    }

    if (!userMessage.trim() || isLoading) return;

    setIsLoading(true);
    setInitError(null);

    const userMessageId = crypto.randomUUID();
    const modelMsgId = crypto.randomUUID();

    // Capture conversation history before adding the new message.
    const conversationHistory = messages
      .filter(m => m.id !== 'welcome-0' && m.content.trim())
      .slice(-20)
      .map(m => ({
        role: m.role === Role.USER ? 'user' : 'assistant',
        content: m.content
      }));

    setMessages(prev => [
      ...prev,
      {
        id: userMessageId,
        role: Role.USER,
        content: userMessage
      }
    ]);

    const { error: insertErr } = await supabase
      .from('messages')
      .insert({
        id: userMessageId,
        user_id: currentUser.id,
        role: 'user',
        content: userMessage
      });

    if (insertErr) {
      console.warn('Insert user message failed:', insertErr.message);
    }

    trackEvent('message_sent', { length: userMessage.length });

    setMessages(prev => [
      ...prev,
      {
        id: modelMsgId,
        role: Role.MODEL,
        content: ''
      }
    ]);

    let accumulatedModelContent = '';

    try {
      // Obtain the authenticated Supabase session.
      const {
        data: { session }
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        throw new Error('Your session has expired. Please sign in again.');
      }

      // Send conversation to our Vercel API, not directly to Ollama.
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          systemInstruction: getSystemInstruction(
            currentUser.full_name || 'User'
          ),
          messages: [
            ...conversationHistory,
            {
              role: 'user',
              content: userMessage
            }
          ]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Server error: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('The AI server returned an empty response.');
      }

      // Read Ollama's streaming NDJSON response.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processLine = (line: string) => {
        if (!line.trim()) return;

        const chunk = JSON.parse(line);
        const chunkText = chunk.message?.content || '';

        if (chunkText) {
          accumulatedModelContent += chunkText;

          setMessages(prev =>
            prev.map(m =>
              m.id === modelMsgId
                ? { ...m, content: accumulatedModelContent }
                : m
            )
          );
        }

        if (chunk.error) {
          throw new Error(chunk.error);
        }
      };

      while (true) {
        const { value, done } = await reader.read();

        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          processLine(line);
        }
      }

      buffer += decoder.decode();

      if (buffer.trim()) {
        processLine(buffer);
      }

      if (!accumulatedModelContent) {
        throw new Error('The AI returned an empty response.');
      }

    } catch (error: any) {
      console.error('Ollama chat error:', error);

      accumulatedModelContent =
        `Sorry, something went wrong: ${error.message || 'Unknown error'}`;

      setMessages(prev =>
        prev.map(m =>
          m.id === modelMsgId
            ? { ...m, content: accumulatedModelContent }
            : m
        )
      );

    } finally {
      setIsLoading(false);

      if (accumulatedModelContent) {
        const { error: modelInsertErr } = await supabase
          .from('messages')
          .insert({
            id: modelMsgId,
            user_id: currentUser.id,
            role: 'model',
            content: accumulatedModelContent
          });

        if (modelInsertErr) {
          console.warn(
            'Insert model message failed:',
            modelInsertErr.message
          );
        }
      }
    }
  };

  if (!currentUser) {
    return <LoginPage onAuthenticated={() => {}} />;
  }

  if (currentUser.role === 'admin') {
    return <AdminDashboard onLogout={handleLogout} />;
  }

  return (
    <div className="flex flex-col h-screen">
      <Header
        name={currentUser.full_name}
        userType={currentUser.role}
        onLogout={handleLogout}
      />

      <main
        ref={chatContainerRef}
        className="flex-1 overflow-y-auto p-4 md:p-6 bg-brand-accent"
      >
        <div className="max-w-4xl mx-auto">
          {messages.map(msg => (
            <ChatMessage
              key={msg.id}
              message={msg}
              sources={sourcesByMsgId[msg.id]}
            />
          ))}

          {isLoading &&
            messages[messages.length - 1]?.role === Role.MODEL &&
            messages[messages.length - 1]?.content === '' && (
              <div className="flex items-start gap-4 my-4">
                <AIAvatar />
                <div className="max-w-xl p-4 rounded-2xl bg-brand-med text-gray-200 rounded-tl-none">
                  <div className="flex items-center space-x-2">
                    <span className="h-2 w-2 bg-pink-400 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                    <span className="h-2 w-2 bg-pink-400 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                    <span className="h-2 w-2 bg-pink-400 rounded-full animate-bounce"></span>
                  </div>
                </div>
              </div>
            )}

          {initError && (
            <div className="text-red-400 bg-red-900/50 p-3 rounded-lg text-center">
              {initError}
            </div>
          )}
        </div>
      </main>

      <ChatInput
        onSendMessage={handleSendMessage}
        isLoading={isLoading}
      />
    </div>
  );
};

export default App;