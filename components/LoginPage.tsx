import React, { useState } from 'react';
import { supabase } from '../src/supabaseClient';

interface LoginPageProps {
  onAuthenticated: () => void;
}

const LoginPage: React.FC<LoginPageProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'signin' | 'signup'>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resendStatus, setResendStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const normalizeWhatsapp = (val: string) => val.replace(/\s+/g, '').replace(/^00/, '+');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pendingEmail) return; // Block resubmission while awaiting confirmation
    setLoading(true);
    try {
      if (mode === 'signup') {
        const whatsappNumber = normalizeWhatsapp(whatsapp);
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password: pw,
          options: { data: { full_name: name, whatsapp_number: whatsappNumber } }
        });
        if (signUpError) throw signUpError;
        if (data.user) {
          // Maintain profiles table for name/role only (whatsapp stored in metadata Option A)
          await supabase.from('profiles').upsert({
            id: data.user.id,
            full_name: name,
            role: 'user'
          });
          // If email confirmation enabled, data.session will be null until link clicked
          if (!data.session) {
            setPendingEmail(email);
            return; // Stop further handling; show confirmation screen
          }
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (signInError) throw signInError;
      }
      onAuthenticated();
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (!pendingEmail) return;
    setResendStatus('sending');
    try {
      const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: pendingEmail });
      if (resendError) throw resendError;
      setResendStatus('sent');
      setTimeout(() => setResendStatus('idle'), 6000);
    } catch (e: any) {
      setResendStatus('error');
      setError(e.message || 'Resend failed');
      setTimeout(() => setResendStatus('idle'), 6000);
    }
  };

  if (pendingEmail) {
    return (
      <div className="min-h-screen bg-brand-dark flex flex-col items-center justify-center text-white p-4 text-center">
        <div className="w-full max-w-[541px] px-4 mb-8">
          <img src="https://boboz.co.ke/wp-content/uploads/2025/11/amicus_1_logo.png" alt="Amicus Pro Logo" className="w-full h-auto" />
        </div>
        <div className="w-full max-w-md bg-brand-med-dark rounded-lg p-8 border border-brand-border">
          <h2 className="text-2xl font-bold mb-4 text-brand-accent">Confirm Your Email</h2>
          <p className="text-sm text-gray-300 mb-4">We sent a confirmation link to <span className="font-semibold">{pendingEmail}</span>. Please check your inbox (and spam) then click the link to activate your account.</p>
          <div className="space-y-3">
            <button onClick={handleResend} disabled={resendStatus === 'sending'} className="w-full py-2 px-4 rounded-md text-sm font-medium text-white bg-pink-600 hover:bg-pink-700 disabled:opacity-50">
              {resendStatus === 'sending' ? 'Resending...' : resendStatus === 'sent' ? 'Email Sent ?' : 'Resend Email'}
            </button>
            <button onClick={() => { setPendingEmail(null); setMode('signin'); }} className="w-full py-2 px-4 rounded-md text-sm font-medium text-pink-400 bg-brand-med hover:bg-brand-med-dark border border-brand-border">
              Back to Sign In
            </button>
          </div>
          {error && <div className="text-red-400 text-xs mt-4">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-dark flex flex-col items-center justify-center text-white p-4">
      <div className="w-full max-w-[541px] px-4 mb-8">
        <img src="https://boboz.co.ke/wp-content/uploads/2025/11/amicus_1_logo.png" alt="Amicus Pro Logo" className="w-full h-auto" />
      </div>
      <div className="w-full max-w-4xl bg-brand-med-dark rounded-lg shadow-2xl border border-brand-border flex flex-col md:flex-row overflow-hidden">
        <div className="w-full md:w-1/2 p-8 bg-brand-med flex flex-col justify-center">
          <h1 className="font-extrabold text-2xl md:text-3xl leading-tight text-brand-accent mb-4">Get Simple, Straight Answers to Complex Legal Challenges</h1>
          <p className="text-md text-gray-200 mb-4">Hello! I'm Matt, an AI guru with a strong legal research background.</p>
          <p className="text-gray-300 text-sm">I'll search and compile insightful legal info on ANY QUESTION, sourcing my answers from Kenyan Case Law, Acts of Parliament and Published articles.</p>
        </div>
        <div className="w-full md:w-1/2 p-8">
          <h2 className="text-2xl font-bold text-center text-gray-200 mb-6">{mode === 'signup' ? 'Create Account' : 'Sign In'}</h2>
          <form onSubmit={handleSubmit} className="space-y-6">
            {mode === 'signup' && (
              <>
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-gray-400">Full Name</label>
                  <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 block w-full bg-brand-med border border-brand-border rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-pink-500 focus:border-pink-500" required autoComplete="name" />
                </div>
                <div>
                  <label htmlFor="whatsapp" className="block text-sm font-medium text-gray-400">WhatsApp Number (E.164 e.g. +254712345678)</label>
                  <input id="whatsapp" type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className="mt-1 block w-full bg-brand-med border border-brand-border rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-pink-500 focus:border-pink-500" required autoComplete="tel" />
                </div>
              </>
            )}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-400">Email Address</label>
              <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 block w-full bg-brand-med border border-brand-border rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-pink-500 focus:border-pink-500" required autoComplete="email" />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-400">Password</label>
              <input id="password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} className="mt-1 block w-full bg-brand-med border border-brand-border rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-pink-500 focus:border-pink-500" required autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
            </div>
            {error && <div className="text-red-400 text-sm">{error}</div>}
            <div>
              <button type="submit" disabled={loading} className="w-full flex justify-center py-2 px-4 rounded-md text-sm font-medium text-white bg-pink-600 hover:bg-pink-700 disabled:opacity-50">{loading ? 'Please wait...' : (mode === 'signup' ? 'Sign Up & Start Chatting' : 'Sign In')}</button>
            </div>
          </form>
          <div className="mt-4 text-center text-xs text-gray-400">
            {mode === 'signup' ? (
              <button onClick={() => setMode('signin')} className="text-pink-400 hover:underline">Already have an account? Sign in</button>
            ) : (
              <button onClick={() => setMode('signup')} className="text-pink-400 hover:underline">Need an account? Sign up</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
