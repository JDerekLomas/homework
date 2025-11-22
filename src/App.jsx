import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Send,
  Plus,
  MessageSquare,
  X,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Layout,
  Sparkles,
  Cpu,
  Search,
  Menu,
  Maximize2,
  ThumbsUp,
  ThumbsDown,
  BookOpen
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';

// --- CONFIGURATION & API ---
const ANTHROPIC_API_KEY = import.meta.env.VITE_ANTHROPIC_API_KEY || "";

const SYSTEM_PROMPT = `
You are a helpful, intelligent AI assistant.
CRITICAL INSTRUCTION FOR HYPERLINKS:
When you introduce a specific technical concept, advanced vocabulary, or key entity, you MUST format it using this EXACT syntax:
~^Term Name|A concise, 50-word summary of what this term means. Write this summary for a general audience.^~

Example:
"I suggest using the ~^ReAct Pattern|The ReAct pattern is a technique where LLMs generate both reasoning traces and task-specific actions in an interleaved manner, allowing for dynamic problem solving.^~ to improve reliability."

Use this frequency moderately—only for the most important 2-3 concepts per response.
Respond in clean Markdown.
`;

const DEEP_DIVE_PROMPT = (topic) => `
Provide a comprehensive, expert-level deep dive into the concept: "${topic}".
Start with a high-level overview, then go into technical details, history, and practical applications.
Use headers, bullet points, and code examples if relevant.
`;

// --- HELPER: Stream Generator for Claude API ---
async function* streamClaudeResponse(history, prompt, isDeepDive = false) {
  // Convert history to Claude's message format
  const messages = history.map(msg => ({
    role: msg.role === 'user' ? 'user' : 'assistant',
    content: msg.content
  }));

  // Add the current prompt
  const fullPrompt = isDeepDive ? DEEP_DIVE_PROMPT(prompt) : prompt;
  messages.push({ role: 'user', content: fullPrompt });

  // API Call to Claude
  const response = await fetch(
    'https://api.anthropic.com/v1/messages',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': ANTHROPIC_API_KEY
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: messages,
        stream: true
      })
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error: ${response.status} - ${error}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep incomplete line in buffer

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);

          // Claude sends different event types
          if (parsed.type === 'content_block_delta') {
            if (parsed.delta?.text) {
              yield parsed.delta.text;
            }
          }
        } catch (e) {
          // Ignore parse errors for incomplete chunks
          console.warn('Parse error:', e);
        }
      }
    }
  }
}

// --- COMPONENTS ---

// 1. Shimmering Link Component
const ConceptLink = ({ term, definition, onLearnMore }) => {
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        onClick={() => setShowTooltip(!showTooltip)}
        className="mx-1 font-medium text-orange-600 cursor-pointer hover:text-orange-700 border-b border-orange-300 hover:border-orange-500 transition-all animate-shimmer bg-clip-text"
        style={{
            backgroundImage: 'linear-gradient(90deg, #ea580c 0%, #fb923c 50%, #ea580c 100%)',
            backgroundSize: '200% auto',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            animation: 'shimmer 3s linear infinite'
        }}
      >
        {term}
      </button>

      {/* Tooltip Popup */}
      {showTooltip && (
        <div className="absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-72 bg-white rounded-xl shadow-xl border border-stone-200 p-4 text-sm text-stone-800 animate-in fade-in zoom-in-95 duration-200">
          <div className="font-serif font-semibold mb-2 text-stone-900 text-base">{term}</div>
          <div className="text-stone-600 mb-4 leading-relaxed text-xs font-sans">
            {definition}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onLearnMore(term);
              setShowTooltip(false);
            }}
            className="w-full text-xs font-semibold bg-stone-50 hover:bg-orange-50 text-stone-600 hover:text-orange-700 py-2 rounded-lg border border-stone-100 flex items-center justify-center gap-2 transition-colors"
          >
            <Sparkles size={12} />
            Learn more
          </button>

          {/* Arrow */}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1 border-8 border-transparent border-t-white" />
        </div>
      )}
    </span>
  );
};

// 2. Message Renderer (Markdown + Custom Parser)
const MessageContent = ({ content, onLearnMore }) => {
  // Custom parsing for ~^Term|Def^~
  const parts = useMemo(() => {
    const regex = /~\^([^|]+)\|([^^]+)\^~/g;
    const result = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(content)) !== null) {
      // Text before match
      if (match.index > lastIndex) {
        result.push({ type: 'text', content: content.substring(lastIndex, match.index) });
      }
      // The Match
      result.push({
        type: 'concept',
        term: match[1],
        definition: match[2]
      });
      lastIndex = regex.lastIndex;
    }
    // Remaining text
    if (lastIndex < content.length) {
      result.push({ type: 'text', content: content.substring(lastIndex) });
    }
    return result;
  }, [content]);

  return (
    <div className="prose prose-stone max-w-none prose-p:leading-7 prose-pre:bg-stone-100 prose-pre:border prose-pre:border-stone-200 font-serif text-stone-800">
      {parts.map((part, idx) => {
        if (part.type === 'concept') {
          return (
            <ConceptLink
              key={idx}
              term={part.term}
              definition={part.definition}
              onLearnMore={onLearnMore}
            />
          );
        }
        return (
          <ReactMarkdown key={idx} components={{
            p: ({node, ...props}) => <p className="mb-4 last:mb-0" {...props} />,
            a: ({node, ...props}) => <span className="text-orange-600 underline cursor-pointer" {...props} />
          }}>
            {part.content}
          </ReactMarkdown>
        );
      })}
    </div>
  );
};

// 3. Chat Window Component
const ChatWindow = ({ chat, onSendMessage, isActive, onClick, onLearnMore, isStreaming }) => {
  const scrollRef = useRef(null);
  const [input, setInput] = useState('');
  const [selectionMenu, setSelectionMenu] = useState({ visible: false, x: 0, y: 0, text: '' });
  const containerRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat.messages, isStreaming]);

  // Selection Menu Handler
  useEffect(() => {
    const handleSelection = () => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !containerRef.current?.contains(selection.anchorNode)) {
            setSelectionMenu({ visible: false, x: 0, y: 0, text: '' });
            return;
        }

        const text = selection.toString().trim();
        if (text.length < 2) return;

        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();

        setSelectionMenu({
            visible: true,
            x: rect.left + (rect.width / 2),
            y: rect.top - 10,
            text: text
        });
    };

    document.addEventListener('selectionchange', handleSelection);
    return () => document.removeEventListener('selectionchange', handleSelection);
  }, []);

  const handleSend = () => {
    if (!input.trim()) return;
    onSendMessage(chat.id, input);
    setInput('');
  };

  // If inactive (sidebar mode/squeezed mode), show simplified view
  if (!isActive) {
    return (
      <div
        onClick={onClick}
        className="h-full w-full bg-stone-50/50 border-r border-stone-200 cursor-pointer hover:bg-stone-100 transition-colors relative overflow-hidden group"
      >
        <div className="p-6">
            <h3 className="font-serif text-xl text-stone-400 mb-6 font-medium">Main Thread</h3>
            <div className="space-y-6 opacity-30 group-hover:opacity-60 transition-opacity mask-image-b">
                {chat.messages.slice(-4).map((m, i) => (
                    <div key={i} className={`text-xs ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
                        <div className={`inline-block p-3 rounded-xl shadow-sm ${m.role === 'user' ? 'bg-stone-200' : 'bg-white border'}`}>
                           {m.content.substring(0, 50)}...
                        </div>
                    </div>
                ))}
            </div>
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-stone-100/30 backdrop-blur-[1px]">
                <div className="bg-white shadow-xl border border-stone-200 rounded-full px-6 py-3 text-sm font-medium text-stone-700 flex items-center gap-2 transform scale-95 group-hover:scale-100 transition-transform">
                    <ChevronLeft size={16} /> Back to Main Chat
                </div>
            </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-white relative font-sans" ref={containerRef}>

      {/* Selection Menu Overlay */}
      {selectionMenu.visible && (
          <div
            className="fixed z-50 flex items-center gap-1 bg-stone-900 text-stone-100 rounded-lg shadow-xl p-1 transform -translate-x-1/2 -translate-y-full animate-in fade-in zoom-in-95 duration-200"
            style={{ left: selectionMenu.x, top: selectionMenu.y }}
            onMouseDown={(e) => e.preventDefault()}
          >
              <button className="p-1.5 hover:bg-stone-700 rounded transition-colors" title="Thumbs Up">
                  <ThumbsUp size={14} />
              </button>
              <div className="w-px h-4 bg-stone-700 mx-0.5" />
              <button className="p-1.5 hover:bg-stone-700 rounded transition-colors" title="Thumbs Down">
                  <ThumbsDown size={14} />
              </button>
              <div className="w-px h-4 bg-stone-700 mx-0.5" />
              <button
                onClick={() => {
                    onLearnMore(selectionMenu.text);
                    window.getSelection().removeAllRanges();
                    setSelectionMenu(prev => ({...prev, visible: false}));
                }}
                className="flex items-center gap-1.5 px-2 py-1 hover:bg-stone-700 rounded text-xs font-medium transition-colors whitespace-nowrap"
              >
                  <BookOpen size={14} className="text-orange-400" />
                  Learn More
              </button>
          </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar scroll-smooth" ref={scrollRef}>
        <div className="max-w-3xl mx-auto space-y-8 pb-10">
          {chat.messages.length === 0 && (
            <div className="text-center mt-24 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
              <div className="w-20 h-20 bg-white border border-stone-100 shadow-sm rounded-2xl mx-auto flex items-center justify-center mb-6">
                <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-amber-600 rounded-xl flex items-center justify-center text-white shadow-inner">
                    {chat.type === 'deep-dive' ? <Layout size={32}/> : <Sparkles size={32} />}
                </div>
              </div>
              <h2 className="text-3xl font-serif text-stone-800 tracking-tight">
                {chat.title}
              </h2>
              <p className="text-stone-500 max-w-md mx-auto text-lg">
                {chat.type === 'deep-dive'
                  ? "Streaming comprehensive analysis..."
                  : "Start a conversation. I'll highlight key concepts for you to explore."}
              </p>
            </div>
          )}

          {chat.messages.map((msg, idx) => (
            <div key={idx} className={`flex gap-4 md:gap-6 ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group`}>
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-600 to-amber-700 flex-shrink-0 flex items-center justify-center text-white font-bold text-xs shadow-sm mt-1">
                  AI
                </div>
              )}

              <div className={`max-w-[85%] ${msg.role === 'user' ? 'bg-stone-100 text-stone-800 px-5 py-3.5 rounded-2xl rounded-tr-sm' : ''}`}>
                 {msg.role === 'user' ? (
                     <div className="text-base whitespace-pre-wrap font-sans">{msg.content}</div>
                 ) : (
                     <MessageContent content={msg.content} onLearnMore={onLearnMore} />
                 )}
              </div>
            </div>
          ))}

          {isStreaming && chat.messages[chat.messages.length - 1]?.role !== 'assistant' && (
             <div className="flex gap-4">
                <div className="w-8 h-8 rounded-lg bg-stone-200 flex-shrink-0 flex items-center justify-center mt-1 animate-pulse" />
                <div className="flex items-center gap-1 mt-3">
                    <div className="w-2 h-2 bg-stone-300 rounded-full animate-bounce" style={{animationDelay: '0ms'}}/>
                    <div className="w-2 h-2 bg-stone-300 rounded-full animate-bounce" style={{animationDelay: '150ms'}}/>
                    <div className="w-2 h-2 bg-stone-300 rounded-full animate-bounce" style={{animationDelay: '300ms'}}/>
                </div>
             </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="p-4 bg-white/80 backdrop-blur-md sticky bottom-0 z-10">
        <div className="max-w-3xl mx-auto relative">
          <div className="bg-white border border-stone-200 rounded-2xl p-3 shadow-sm focus-within:ring-2 focus-within:ring-orange-100 focus-within:border-orange-300 transition-all hover:border-stone-300">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder={chat.type === 'deep-dive' ? "Ask follow-up questions about this topic..." : "How can I help you today?"}
              className="w-full bg-transparent border-none focus:ring-0 resize-none text-stone-800 placeholder-stone-400 min-h-[48px] max-h-32 text-base py-2 px-1 font-sans"
              rows={1}
            />
            <div className="flex justify-between items-center mt-2 pt-2 border-t border-stone-100">
                <div className="flex gap-2 text-stone-400">
                    <button className="p-2 hover:bg-stone-100 rounded-lg transition-colors" title="Add Attachment"><Plus size={18} /></button>
                    <button className="p-2 hover:bg-stone-100 rounded-lg transition-colors hidden sm:block" title="Use Microphone"><Maximize2 size={16} /></button>
                </div>
                <button
                    onClick={handleSend}
                    disabled={!input.trim() || isStreaming}
                    className={`p-2 px-4 rounded-lg transition-all font-medium text-sm flex items-center gap-2 ${input.trim() ? 'bg-orange-600 text-white shadow-md hover:bg-orange-700 hover:shadow-lg transform hover:-translate-y-0.5' : 'bg-stone-100 text-stone-400 cursor-not-allowed'}`}
                >
                    Send <Send size={14} />
                </button>
            </div>
          </div>
          <div className="text-center mt-3">
            <span className="text-[11px] text-stone-400 font-medium">Claude Sonnet 4 • Results may vary</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// --- MAIN APP COMPONENT ---

export default function App() {
  const [activeTabId, setActiveTabId] = useState('main');
  const [tabs, setTabs] = useState([
    { id: 'main', title: 'New Chat', type: 'main', messages: [] }
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const activeTab = tabs.find(t => t.id === activeTabId);
  const showSplitView = activeTab?.type === 'deep-dive';

  const handleSendMessage = async (chatId, text) => {
    // Check for API key
    if (!ANTHROPIC_API_KEY) {
      alert('Please set your VITE_ANTHROPIC_API_KEY in the .env file');
      return;
    }

    // 1. Optimistically update UI with user message
    setTabs(prev => prev.map(t => {
      if (t.id === chatId) {
        return { ...t, messages: [...t.messages, { role: 'user', content: text }] };
      }
      return t;
    }));

    setIsStreaming(true);
    let fullResponse = "";

    try {
      let currentChat = tabsRef.current.find(t => t.id === chatId);
      let history = currentChat ? [...currentChat.messages] : [];
      history.push({ role: 'user', content: text });

      const isDeepDive = currentChat?.type === 'deep-dive';

      // Start Stream
      const stream = streamClaudeResponse(history, text, isDeepDive);

      for await (const chunk of stream) {
        fullResponse += chunk;
        setTabs(prev => prev.map(t => {
          if (t.id === chatId) {
            const msgs = [...t.messages];
            const lastMsg = msgs[msgs.length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
               lastMsg.content = fullResponse;
            } else {
               msgs.push({ role: 'assistant', content: fullResponse });
            }
            return { ...t, messages: msgs };
          }
          return t;
        }));
      }
    } catch (error) {
      console.error("Stream error:", error);
      alert(`Error: ${error.message}`);
    } finally {
      setIsStreaming(false);
    }
  };

  const startDeepDive = (topic) => {
    const newTabId = `dive-${Date.now()}`;
    const newTab = {
      id: newTabId,
      title: `Deep Dive: ${topic}`,
      type: 'deep-dive',
      messages: []
    };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTabId);

    setTimeout(() => {
        handleSendMessage(newTabId, `Start deep dive on: ${topic}`);
    }, 100);
  };

  const closeTab = (id, e) => {
    e.stopPropagation();
    const newTabs = tabs.filter(t => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id) {
      setActiveTabId(newTabs[newTabs.length - 1].id);
    }
  };

  return (
    <div className="flex h-screen w-full bg-stone-50 text-stone-900 font-sans overflow-hidden selection:bg-orange-100 selection:text-orange-900">
      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% center; }
          100% { background-position: -200% center; }
        }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e5e5e4; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #d6d3d1; }
      `}</style>

      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-64' : 'w-0'} flex-shrink-0 bg-stone-100 border-r border-stone-200 transition-all duration-300 ease-in-out overflow-hidden flex flex-col`}>
        <div className="p-4 flex items-center justify-between">
            <div className="font-serif font-semibold text-stone-700 tracking-tight flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-orange-600 to-amber-700 rounded-lg text-white flex items-center justify-center font-bold font-sans shadow-sm">C</div>
                Claude <span className="text-[10px] uppercase tracking-wider text-stone-400 font-sans font-normal mt-1">Chat</span>
            </div>
        </div>

        <div className="px-3 py-2">
            <button
                onClick={() => {
                    setActiveTabId('main');
                }}
                className="w-full flex items-center gap-2 bg-white hover:bg-stone-50 border border-stone-200 shadow-sm text-stone-700 px-3 py-2.5 rounded-lg text-sm font-medium transition-all"
            >
                <Plus size={16} className="text-orange-600" /> New Chat
            </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1">
             <div className="text-xs font-medium text-stone-400 px-2 py-2 uppercase tracking-wider">Recents</div>
             {tabs.map(tab => (
                 <button
                    key={tab.id}
                    onClick={() => setActiveTabId(tab.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate flex items-center gap-2 group transition-colors ${activeTabId === tab.id ? 'bg-stone-200 text-stone-900' : 'text-stone-600 hover:bg-stone-200/50'}`}
                 >
                    {tab.type === 'deep-dive' ? <Layout size={14} className="text-orange-600" /> : <MessageSquare size={14} />}
                    <span className="truncate flex-1 font-medium">{tab.title}</span>
                    {tab.id !== 'main' && (
                        <X
                            size={12}
                            className="opacity-0 group-hover:opacity-100 hover:text-red-500"
                            onClick={(e) => closeTab(tab.id, e)}
                        />
                    )}
                 </button>
             ))}
        </div>

        <div className="p-4 border-t border-stone-200">
            <div className="flex items-center gap-3 text-sm text-stone-600 cursor-pointer hover:text-stone-900 transition-colors p-2 hover:bg-stone-200/50 rounded-xl">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-stone-400 to-stone-500 flex items-center justify-center text-white font-bold text-xs">
                    U
                </div>
                <div className="flex-1">
                    <div className="font-medium">User Account</div>
                    <div className="text-xs text-stone-400">Free Plan</div>
                </div>
            </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full relative">

        {/* Top Bar */}
        <div className="h-14 border-b border-stone-200 bg-white flex items-center px-4 justify-between flex-shrink-0 z-20 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
            <div className="flex items-center gap-4 overflow-x-auto no-scrollbar w-full">
                <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded-lg transition-colors">
                    <Menu size={20} />
                </button>

                {/* Tabs */}
                <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-lg">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTabId(tab.id)}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center gap-2 border ${
                                activeTabId === tab.id
                                ? 'bg-white text-stone-800 shadow-sm border-stone-200'
                                : 'text-stone-500 hover:text-stone-700 hover:bg-stone-200/50 border-transparent'
                            }`}
                        >
                            {tab.type === 'deep-dive' && <Sparkles size={12} className="text-orange-500" />}
                            {tab.title}
                        </button>
                    ))}
                </div>
            </div>
        </div>

        {/* Sliding Panes Container */}
        <div className="flex-1 relative overflow-hidden bg-stone-100">

            {/* Pane 1: Main Chat */}
            <div
                className={`absolute top-0 bottom-0 left-0 transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] shadow-2xl z-10 overflow-hidden border-r border-stone-200
                    ${showSplitView ? 'w-[320px] translate-x-0' : 'w-full translate-x-0'}
                `}
            >
                 <ChatWindow
                    chat={tabs.find(t => t.id === 'main')}
                    isActive={!showSplitView}
                    onClick={() => setActiveTabId('main')}
                    onSendMessage={handleSendMessage}
                    onLearnMore={startDeepDive}
                    isStreaming={isStreaming}
                />
            </div>

            {/* Pane 2: Deep Dive */}
            <div
                className={`absolute top-0 bottom-0 right-0 bg-white transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] z-20 shadow-[-20px_0_40px_rgba(0,0,0,0.05)]
                    ${showSplitView ? 'w-[calc(100%-320px)] translate-x-0' : 'w-[calc(100%-320px)] translate-x-full'}
                `}
            >
                 {activeTab && activeTab.type === 'deep-dive' && (
                     <>
                        <ChatWindow
                            chat={activeTab}
                            isActive={true}
                            onSendMessage={handleSendMessage}
                            onLearnMore={startDeepDive}
                            isStreaming={isStreaming}
                        />

                        <button
                            onClick={() => setActiveTabId('main')}
                            className="absolute top-4 right-4 p-2 bg-white border border-stone-200 hover:bg-stone-50 rounded-lg text-stone-500 transition-colors shadow-sm"
                            title="Close Deep Dive"
                        >
                            <X size={18} />
                        </button>
                    </>
                 )}
            </div>

        </div>

      </div>
    </div>
  );
}
