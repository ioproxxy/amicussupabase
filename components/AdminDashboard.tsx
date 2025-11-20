import React, { useState, useEffect } from 'react';
import { Message, Role } from '../types';
import { supabase } from '../src/supabaseClient';

interface AdminDashboardProps {
    onLogout: () => void;
}

interface Stats {
    totalUsers: number;
    totalMessages: number;
    userMessages: number;
    modelMessages: number;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ onLogout }) => {
  const [histories, setHistories] = useState<Record<string, Message[]>>({});
  const [stats, setStats] = useState<Stats>({ totalUsers: 0, totalMessages: 0, userMessages: 0, modelMessages: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { count: userCount } = await supabase.from('profiles').select('*', { count: 'exact', head: true });
      const { count: messagesCount } = await supabase.from('messages').select('*', { count: 'exact', head: true });
      const { count: userMsgsCount } = await supabase.from('messages').select('*', { count: 'exact', head: true }).eq('role', 'user');
      const { count: modelMsgsCount } = await supabase.from('messages').select('*', { count: 'exact', head: true }).eq('role', 'model');
      const { data: allMessages } = await supabase.from('messages').select('id, user_id, role, content, created_at').order('created_at', { ascending: true });
      const { data: profilesData } = await supabase.from('profiles').select('id');
      const emailMap: Record<string, string> = {};
      // Email mapping not available without service key; fallback to id prefix
      (profilesData || []).forEach(p => { emailMap[p.id] = p.id.substring(0, 8); });
      const grouped: Record<string, Message[]> = {};
      (allMessages || []).forEach(m => { const key = emailMap[m.user_id] || m.user_id.substring(0, 8); if (!grouped[key]) grouped[key] = []; grouped[key].push({ id: m.id, role: m.role as Role, content: m.content }); });
      setHistories(grouped);
      setStats({ totalUsers: userCount || 0, totalMessages: messagesCount || 0, userMessages: userMsgsCount || 0, modelMessages: modelMsgsCount || 0 });
      setLoading(false);
    })();
  }, []);

  const generateXml = (historiesMap: Record<string, Message[]>): string => {
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<allChatHistory>\n';
    for (const [email, history] of Object.entries(historiesMap)) {
      xml += `  <userChat id="${email}">\n`;
      history.forEach(msg => { xml += `    <message id="${msg.id}" role="${msg.role}">\n      <content><![CDATA[${msg.content}]]></content>\n    </message>\n`; });
      xml += '  </userChat>\n';
    }
    xml += '</allChatHistory>';
    return xml;
  };

  const handleDownload = () => { const xmlString = generateXml(histories); const blob = new Blob([xmlString], { type: 'application/xml' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'all_chat_history.xml'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); };

  return (
    <div className='min-h-screen bg-brand-dark text-white'>
      <header className='bg-brand-med-dark/50 backdrop-blur-sm p-4 border-b border-brand-border shadow-lg sticky top-0 z-10'>
        <div className='max-w-6xl mx-auto flex items-center justify-between'>
          <h1 className='text-xl font-bold'>Admin Dashboard</h1>
          <button onClick={onLogout} className='bg-red-600 text-white font-semibold rounded-lg px-4 py-2 text-sm'>Logout</button>
        </div>
      </header>
      <main className='p-4 md:p-6 max-w-6xl mx-auto'>
        <h2 className='text-2xl font-semibold mb-4'>Usage Analytics</h2>
        {loading ? (<p className='text-gray-400'>Loading...</p>) : (
          <div className='grid grid-cols-1 md:grid-cols-4 gap-4 mb-8'>
            <div className='bg-brand-med-dark p-4 rounded-lg border border-brand-border'><h3 className='text-gray-400 text-sm font-medium'>Total Users</h3><p className='text-3xl font-bold'>{stats.totalUsers}</p></div>
            <div className='bg-brand-med-dark p-4 rounded-lg border border-brand-border'><h3 className='text-gray-400 text-sm font-medium'>Total Messages</h3><p className='text-3xl font-bold'>{stats.totalMessages}</p></div>
            <div className='bg-brand-med-dark p-4 rounded-lg border border-brand-border'><h3 className='text-gray-400 text-sm font-medium'>User Queries</h3><p className='text-3xl font-bold'>{stats.userMessages}</p></div>
            <div className='bg-brand-med-dark p-4 rounded-lg border border-brand-border'><h3 className='text-gray-400 text-sm font-medium'>Model Responses</h3><p className='text-3xl font-bold'>{stats.modelMessages}</p></div>
          </div>
        )}
        <div className='flex justify-between items-center mb-4'>
          <h2 className='text-2xl font-semibold'>All User Chat History</h2>
          <button onClick={handleDownload} disabled={Object.keys(histories).length === 0} className='bg-pink-600 text-white font-semibold rounded-lg px-5 py-2 disabled:bg-brand-light disabled:cursor-not-allowed'>Download All as XML</button>
        </div>
        <div className='bg-brand-med-dark rounded-lg border border-brand-border max-h-[60vh] overflow-y-auto'>
          <div className='p-4 space-y-6'>
            {Object.keys(histories).length > 0 ? (
              Object.entries(histories).map(([email, history]) => (
                <div key={email} className='border border-brand-border rounded-lg p-4'>
                  <h3 className='text-md font-semibold text-amber-300/90 pb-2 mb-3 border-b border-brand-border/50'>User ID: <span className='font-normal text-gray-300'>{email}</span></h3>
                  <div className='space-y-3'>
                    {history.map(msg => (
                      <div key={msg.id} className={`p-3 rounded-lg ${msg.role === Role.USER ? 'bg-purple-800/50' : 'bg-brand-med/50'}`}>
                        <p className='text-xs font-bold capitalize text-pink-400 mb-1'>{msg.role}</p>
                        <p className='text-sm whitespace-pre-wrap'>{msg.content}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (<p className='text-gray-400 text-center py-8'>No chat history found.</p>)}
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminDashboard;