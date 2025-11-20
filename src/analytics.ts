import { supabase } from './supabaseClient';

export async function trackEvent(eventType: string, metadata?: Record<string, any>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  await supabase.from('events').insert({
    user_id: session.user.id,
    event_type: eventType,
    metadata: metadata || {}
  });
}
