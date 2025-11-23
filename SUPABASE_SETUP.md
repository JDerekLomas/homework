# Supabase Setup Instructions

This app now includes Supabase integration for persistent chat storage across devices.

## Quick Setup

### 1. Create a Supabase Project

1. Go to [supabase.com](https://supabase.com) and sign up/login
2. Click "New Project"
3. Fill in project details and wait for setup to complete

### 2. Get Your Credentials

1. In your Supabase project dashboard, go to **Settings** → **API**
2. Copy these two values:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **anon/public key** (starts with `eyJ...`)

### 3. Update Environment Variables

Update your `.env` file:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### 4. Create Database Tables

In your Supabase project:

1. Go to **SQL Editor**
2. Click **New Query**
3. Paste the following SQL and run it:

```sql
-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Chats table
create table chats (
  id uuid default uuid_generate_v4() primary key,
  title text not null,
  model text not null,
  active_subtab_id text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  user_id uuid
);

-- Subtabs table
create table subtabs (
  id uuid default uuid_generate_v4() primary key,
  chat_id uuid references chats(id) on delete cascade not null,
  subtab_id text not null,
  title text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Messages table
create table messages (
  id uuid default uuid_generate_v4() primary key,
  subtab_id uuid references subtabs(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  message_index integer not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Indexes for better performance
create index idx_subtabs_chat_id on subtabs(chat_id);
create index idx_messages_subtab_id on messages(subtab_id);
create index idx_messages_ordering on messages(subtab_id, message_index);

-- Enable Row Level Security
alter table chats enable row level security;
alter table subtabs enable row level security;
alter table messages enable row level security;

-- Allow all access (update these policies when adding auth)
create policy "Allow all access to chats" on chats for all using (true);
create policy "Allow all access to subtabs" on subtabs for all using (true);
create policy "Allow all access to messages" on messages for all using (true);
```

### 5. Deploy to Vercel

When deploying to Vercel, add these environment variables in your project settings:

1. Go to your Vercel project
2. Click **Settings** → **Environment Variables**
3. Add:
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key
   - `VITE_ANTHROPIC_API_KEY` = your Anthropic API key

4. Redeploy your project

## Features

- **Auto-save**: Chats are automatically saved to Supabase (debounced to 1 second)
- **Sync across devices**: Access your chats from any device
- **Offline mode**: App works without Supabase (local only)
- **Save indicator**: Shows sync status in the sidebar

## Security Notes

The current setup allows public access to all data (no authentication). This is fine for personal use, but for production:

1. Enable Supabase Authentication
2. Update RLS policies to restrict access by user
3. Add `user_id` to chats table based on auth user

## Troubleshooting

**"Offline mode" shown in sidebar:**
- Check that `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set in `.env`
- Restart dev server after changing `.env`

**Chats not saving:**
- Check browser console for errors
- Verify tables were created correctly in Supabase
- Check RLS policies allow insert/update

**Build errors:**
- Make sure `@supabase/supabase-js` is installed
- Run `npm install` to ensure all dependencies are present
