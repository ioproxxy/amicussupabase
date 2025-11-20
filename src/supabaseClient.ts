import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://mzdclssjndpdhckmknve.supabase.co';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseAnonKey) {
  console.warn('Missing Supabase anon key environment variable');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey || '');
