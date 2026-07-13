import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
    process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://nixeproyzxvqzyrvsxcx.supabase.co';

const supabaseAnonKey =
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5peGVwcm95enh2cXp5cnZzeGN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4ODIxODEsImV4cCI6MjA5MjQ1ODE4MX0.YNd1J4HglBU36uB4QJ3vGf02Mkf1yJtead7anLfevU0';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
