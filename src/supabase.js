import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Database schema:
//
// Table: chats
// - id (uuid, primary key)
// - title (text)
// - model (text)
// - active_subtab_id (text)
// - created_at (timestamp)
// - updated_at (timestamp)
// - user_id (uuid, optional for future auth)
//
// Table: subtabs
// - id (uuid, primary key)
// - chat_id (uuid, foreign key -> chats.id)
// - subtab_id (text, the client-side ID like 'main' or 'dive-123')
// - title (text)
// - created_at (timestamp)
//
// Table: messages
// - id (uuid, primary key)
// - subtab_id (uuid, foreign key -> subtabs.id)
// - role (text: 'user' or 'assistant')
// - content (text)
// - created_at (timestamp)
// - message_index (integer, for ordering)

// SQL to create tables:
/*
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

-- Enable Row Level Security (optional, for future auth)
alter table chats enable row level security;
alter table subtabs enable row level security;
alter table messages enable row level security;

-- For now, allow all operations (update these when adding auth)
create policy "Allow all access to chats" on chats for all using (true);
create policy "Allow all access to subtabs" on subtabs for all using (true);
create policy "Allow all access to messages" on messages for all using (true);
*/

export async function saveChat(chat) {
  if (!supabase) {
    console.warn('Supabase not configured');
    return null;
  }

  try {
    // First, check if chat already exists
    const { data: existingChat } = await supabase
      .from('chats')
      .select('id')
      .eq('id', chat.id)
      .single();

    if (existingChat) {
      // Update existing chat
      const { error: updateError } = await supabase
        .from('chats')
        .update({
          title: chat.title,
          model: chat.model,
          active_subtab_id: chat.activeSubTabId,
          updated_at: new Date().toISOString()
        })
        .eq('id', chat.id);

      if (updateError) throw updateError;

      // Delete existing subtabs and messages (cascade will handle messages)
      await supabase.from('subtabs').delete().eq('chat_id', chat.id);
    } else {
      // Insert new chat
      const { error: insertError } = await supabase
        .from('chats')
        .insert({
          id: chat.id,
          title: chat.title,
          model: chat.model,
          active_subtab_id: chat.activeSubTabId
        });

      if (insertError) throw insertError;
    }

    // Insert subtabs
    for (const subtab of chat.subTabs) {
      const { data: subtabData, error: subtabError } = await supabase
        .from('subtabs')
        .insert({
          chat_id: chat.id,
          subtab_id: subtab.id,
          title: subtab.title
        })
        .select()
        .single();

      if (subtabError) throw subtabError;

      // Insert messages for this subtab
      if (subtab.messages && subtab.messages.length > 0) {
        const messages = subtab.messages.map((msg, idx) => ({
          subtab_id: subtabData.id,
          role: msg.role,
          content: msg.content,
          message_index: idx
        }));

        const { error: messagesError } = await supabase
          .from('messages')
          .insert(messages);

        if (messagesError) throw messagesError;
      }
    }

    return chat.id;
  } catch (error) {
    console.error('Error saving chat:', error);
    return null;
  }
}

export async function loadChats() {
  if (!supabase) {
    console.warn('Supabase not configured');
    return [];
  }

  try {
    // Load all chats
    const { data: chats, error: chatsError } = await supabase
      .from('chats')
      .select(`
        id,
        title,
        model,
        active_subtab_id,
        created_at,
        subtabs (
          id,
          subtab_id,
          title,
          messages (
            role,
            content,
            message_index
          )
        )
      `)
      .order('updated_at', { ascending: false });

    if (chatsError) throw chatsError;

    // Transform to app format
    return chats.map(chat => ({
      id: chat.id,
      title: chat.title,
      model: chat.model,
      activeSubTabId: chat.active_subtab_id,
      subTabs: chat.subtabs.map(subtab => ({
        id: subtab.subtab_id,
        title: subtab.title,
        messages: subtab.messages
          .sort((a, b) => a.message_index - b.message_index)
          .map(msg => ({
            role: msg.role,
            content: msg.content
          }))
      }))
    }));
  } catch (error) {
    console.error('Error loading chats:', error);
    return [];
  }
}

export async function deleteChat(chatId) {
  if (!supabase) {
    console.warn('Supabase not configured');
    return false;
  }

  try {
    const { error } = await supabase
      .from('chats')
      .delete()
      .eq('id', chatId);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error deleting chat:', error);
    return false;
  }
}
