import { json, type MetaFunction } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';
import { createClient } from '@supabase/supabase-js';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { useEffect, useState } from 'react';

const supabase = createClient(
  'https://vwzbimkcpcctewshmtdc.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ3emJpbWtjcGNjdGV3c2htdGRjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzcxMTIwMTAsImV4cCI6MjA1MjY4ODAxMH0.nwuRmvPOV-4b0lXPHZ4g54zQHZ7gYKCGbO7uw0T0AYk',
);

export const meta: MetaFunction = () => {
  return [{ title: 'Bolt' }, { name: 'description', content: 'Talk with Bolt, an AI assistant from StackBlitz' }];
};

type Session = {
  user: object;
};

export const loader = () => json({});

export default function Index() {
  const [session, setSession] = useState<Session | null>();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (!session) {
    console.log(session);

    return session === null ? (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <Auth
          supabaseClient={supabase}
          appearance={{
            theme: ThemeSupa,
          }}
        />
      </div>
    ) : (
      <></>
    );
  } else {
    return (
      <div className="flex flex-col h-full w-full bg-bolt-elements-background-depth-1">
        <BackgroundRays />
        <Header />
        <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
      </div>
    );
  }
}
