import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, Chat } from "@google/genai";
import Header from './components/Header';
import ChatInput from './components/ChatInput';
import ChatMessage from './components/ChatMessage';
import LoginPage from './components/LoginPage';
import AdminDashboard from './components/AdminDashboard';
import { Message, Role, Source } from './types';
import { getSystemInstruction } from './constants';
import AIAvatar from './components/AIAvatar';
import { supabase } from './supabaseClient';
import { trackEvent } from './analytics';

const welcomeMessage: Message = {
  id: 'welcome-0',
  role: Role.MODEL,
  content: "Get Simple, Straight Answers\nto Complex Legal Challenges \n\nHello! I'm Matt, an AI guru with a strong legal research background.\n\nI'll search and compile insightful legal info on ANY QUESTION, sourcing my answers from Kenyan Case Law, Acts of parliament and published articles."
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
  const [dbStatus, setDbStatus] = useState<'pending' | 'ok' | 'error'>('pending');
  const [dbMessage, setDbMessage] = useState<string>('Testing database connection...');
  const chatRef = useRef<Chat | null>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const testDbConnection = useCallback(async () => {
    try {
      // Lightweight head query against profiles table
      const { error } = await supabase.from('profiles').select('id', { head: true, count: 'exact' });
      if (error) {
        setDbStatus('error');
        setDbMessage(error.message);
      } else {
        setDbStatus('ok');
        setDbMessage('Connected');
      }
    } catch (e: any) {
      setDbStatus('error');
      setDbMessage(e.message || 'Unknown error');
    }
  }, []);

  useEffect(() => { testDbConnection(); }, [testDbConnection]);

  const initChat = useCallback(() => {
    if (!currentUser?.full_name) return;
    try {
      const apiKey = import.meta.env.GEMINI_API_KEY || import.meta.env.VITE_GEMINI_API_KEY || (process.env as any).API_KEY;
      if (!apiKey) {
        throw new Error("Gemini API key env variable not set.");
      }
      const ai = new GoogleGenAI({ apiKey });
      const chatInstance = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
          systemInstruction: getSystemInstruction(currentUser.full_name),
          tools: [{ googleSearch: {} }],
        },
      });
      chatRef.current = chatInstance;
    } catch (e: any) {
      setInitError(e.message || 'Initialization failed');
      console.error(e);
    }
  }, [currentUser?.full_name]);

  // Auth state listener
  useEffect(() => {
    const subscription = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const { user } = session;
        // Fetch profile
        const { data: profile } = await supabase.from('profiles')
          .select('full_name, role')
          .eq('id', user.id)
          .single();
        const mapped: CurrentUser = {
          id: user.id,
            full_name: profile?.full_name || user.email?.split('@')[0] || 'User',
          email: user.email,
          role: (profile?.role as 'user' | 'admin') || 'user'
        };
        setCurrentUser(mapped);
        await loadMessages(user.id);
        trackEvent('login');
      } else {
        setCurrentUser(null);
        setMessages([welcomeMessage]);
        chatRef.current = null;
      }
    });
    return () => { subscription.data.subscription.unsubscribe(); };
  }, []);

  // Initialize chat when user changes
  useEffect(() => {
    if (currentUser?.role === 'user' || currentUser?.role === 'admin') {
      initChat();
    }
  }, [currentUser, initChat]);

  // Scroll on new messages
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
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
      // Prepend welcome only once
      setMessages([welcomeMessage, ...data.map(m => ({ id: m.id, role: m.role as Role, content: m.content }))]);
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleSendMessage = async (userMessage: string) => {
    if (!chatRef.current || !currentUser) {
      setInitError('Chat not initialized.');
      return;
    }
    setIsLoading(true);
    setInitError(null);

    // Insert user message to DB
    const userMessageId = crypto.randomUUID();
    setMessages(prev => [...prev, { id: userMessageId, role: Role.USER, content: userMessage }]);

    const { error: insertErr } = await supabase.from('messages').insert({
      id: userMessageId,
      user_id: currentUser.id,
      role: 'user',
      content: userMessage
    });
    if (insertErr) console.warn('Insert user message failed:', insertErr.message);

    trackEvent('message_sent', { length: userMessage.length });

    // Placeholder for model streaming
    const modelMsgId = crypto.randomUUID();
    setMessages(prev => [...prev, { id: modelMsgId, role: Role.MODEL, content: '' }]);

    const currentSources: Source[] = [];
    const sourceUris = new Set<string>();

    try {
      const stream = await chatRef.current.sendMessageStream({ message: userMessage });
      for await (const chunk of stream) {
        const chunkText = chunk.text || '';
        const groundingChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (groundingChunks) {
          for (const c of groundingChunks) {
            if (c.web?.uri && !sourceUris.has(c.web.uri)) {
              const newSource = { uri: c.web.uri, title: c.web.title || c.web.uri };
              currentSources.push(newSource);
              sourceUris.add(newSource.uri);
            }
          }
        }
        setMessages(prev =>
          prev.map(m => m.id === modelMsgId ? { ...m, content: m.content + chunkText } : m)
        );
      }
    } catch (e: any) {
      const errorMessage = e.message || 'Unknown error';
      setMessages(prev =>
        prev.map(m => m.id === modelMsgId
          ? { ...m, content: `Sorry, something went wrong: ${errorMessage}` }
          : m)
      );
      console.error(e);
    } finally {
      setIsLoading(false);
      if (currentSources.length > 0) {
        setSourcesByMsgId(prev => ({ ...prev, [modelMsgId]: currentSources }));
      }
      // Persist final model message
      const modelContent = messages.find(m => m.id === modelMsgId)?.content ||
        messages.filter(m => m.id === modelMsgId)[0]?.content;
      const finalModelMsg = messages.find(m => m.id === modelMsgId);
      const contentToSave = finalModelMsg?.content || '';
      if (contentToSave) {
        const { error: modelInsertErr } = await supabase.from('messages').insert({
          id: modelMsgId,
          user_id: currentUser.id,
          role: 'model',
          content: contentToSave
        });
        if (modelInsertErr) console.warn('Insert model message failed:', modelInsertErr.message);
      }
    }
  };

  if (!currentUser) {
    return <LoginPage onAuthenticated={() => { /* state handled by listener */ }} />;
  }

  if (currentUser.role === 'admin') {
    return <AdminDashboard onLogout={handleLogout} />;
  }

  return (
    <div className="flex flex-col h-screen">
      <Header name={currentUser.full_name} userType={currentUser.role} onLogout={handleLogout} />
      {/* DB status banner */}
      <div className={`text-xs px-3 py-1 text-center ${dbStatus === 'ok' ? 'bg-green-700/40 text-green-300' : dbStatus === 'error' ? 'bg-red-800/40 text-red-300' : 'bg-brand-med text-gray-300'}`}>DB: {dbMessage}</div>
      <main ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 md:p-6 bg-brand-accent">
        <div className="max-w-4xl mx-auto">
          {messages.map(msg => (
            <ChatMessage key={msg.id} message={msg} sources={sourcesByMsgId[msg.id]} />
          ))}
          {isLoading && messages[messages.length - 1]?.role === Role.MODEL &&
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
            <div className="text-red-400 bg-red-900/50 p-3 rounded-lg text-center">{initError}</div>
          )}
        </div>
      </main>
      <ChatInput onSendMessage={handleSendMessage} isLoading={isLoading} />
    </div>
  );
};

export default App;