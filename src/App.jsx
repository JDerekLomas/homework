import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Send,
  Plus,
  MessageSquare,
  X,
  ChevronLeft,
  Menu,
  Sparkles,
  Copy,
  Check,
  Edit2,
  RotateCw,
  Trash2,
  Code,
  BookOpen,
  Settings,
  Cloud,
  CloudOff
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { supabase, saveChat, loadChats, deleteChat } from './supabase';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import 'katex/dist/katex.min.css';

// --- CONFIGURATION ---
const MODELS = {
  'claude-haiku-4-5': { name: 'Claude Haiku 4.5', speed: 'Fastest (4-5x faster)', quality: 'Excellent' },
  'claude-sonnet-4-5': { name: 'Claude Sonnet 4.5', speed: 'Fast', quality: 'Best Coding' },
  'claude-3-5-haiku-20241022': { name: 'Claude 3.5 Haiku', speed: 'Fastest', quality: 'Excellent' },
  'claude-3-5-sonnet-20241022': { name: 'Claude 3.5 Sonnet (Latest)', speed: 'Fast', quality: 'Excellent' },
  'claude-3-5-sonnet-20240620': { name: 'Claude 3.5 Sonnet (June)', speed: 'Fast', quality: 'Excellent' },
  'claude-3-opus-20240229': { name: 'Claude 3 Opus', speed: 'Slower', quality: 'Highest' },
  'claude-3-sonnet-20240229': { name: 'Claude 3 Sonnet', speed: 'Balanced', quality: 'Good' },
  'claude-3-haiku-20240307': { name: 'Claude 3 Haiku', speed: 'Very Fast', quality: 'Good' },
};

const DEFAULT_SYSTEM_PROMPT = `You are Claude, a helpful and intelligent AI assistant created by Anthropic.

When introducing important technical concepts, you can optionally highlight them using this syntax:
~^Term|Brief definition^~

Respond naturally using Markdown formatting. Use code blocks with language tags for code.`;

const DEFAULT_DEEP_DIVE_PROMPT = `Provide a comprehensive deep dive into: {topic}. Include technical details, examples, and practical applications.`;

// --- HELPER: Stream Generator ---
async function* streamClaudeResponse(messages, model = 'claude-haiku-4-5', systemPrompt = DEFAULT_SYSTEM_PROMPT) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: systemPrompt,
      messages: messages,
      model: model,
    })
  });

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
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            yield parsed.delta.text;
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    }
  }
}

// --- COMPONENTS ---

// Code Block Component with Copy Button
const CodeBlock = ({ language, value }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group my-4">
      <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleCopy}
          className="px-2 py-1 bg-stone-700 hover:bg-stone-600 text-white text-xs rounded flex items-center gap-1"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || 'text'}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
        }}
      >
        {value}
      </SyntaxHighlighter>
    </div>
  );
};

// Concept Link Component
const ConceptLink = ({ term, definition, onLearnMore }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const containerRef = useRef(null);
  const timeoutRef = useRef(null);

  const handleMouseEnter = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setShowTooltip(true);
  };

  const handleMouseLeave = (e) => {
    // Only hide if we're not moving to the tooltip
    timeoutRef.current = setTimeout(() => {
      setShowTooltip(false);
    }, 150);
  };

  const handleDoubleClick = () => {
    if (onLearnMore) {
      onLearnMore(term);
      setShowTooltip(false);
    }
  };

  return (
    <span
      ref={containerRef}
      className="relative inline-block"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        onClick={() => setShowTooltip(!showTooltip)}
        onDoubleClick={handleDoubleClick}
        className="mx-0.5 font-medium text-orange-600 hover:text-orange-700 border-b border-orange-300 hover:border-orange-500 transition-all"
      >
        {term}
      </button>

      {showTooltip && (
        <div
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className="absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-64 bg-white rounded-lg shadow-xl border border-stone-200 p-3 text-sm text-stone-800 animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="font-semibold mb-1 text-stone-900">{term}</div>
          <div className="text-stone-600 text-xs leading-relaxed">{definition}</div>
          {onLearnMore && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onLearnMore(term);
                setShowTooltip(false);
              }}
              className="mt-2 w-full text-xs font-medium bg-stone-50 hover:bg-orange-50 text-stone-700 hover:text-orange-700 py-1.5 rounded flex items-center justify-center gap-1 transition-colors"
            >
              <Sparkles size={11} />
              Learn More (or double-click term)
            </button>
          )}
          <div className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1 border-4 border-transparent border-t-white" />
        </div>
      )}
    </span>
  );
};

// Enhanced Message Renderer
const MessageContent = ({ content, onLearnMore }) => {
  const parts = useMemo(() => {
    const regex = /~\^([^|]+)\|([^^]+)\^~/g;
    const result = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        result.push({ type: 'text', content: content.substring(lastIndex, match.index) });
      }
      result.push({ type: 'concept', term: match[1], definition: match[2] });
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < content.length) {
      result.push({ type: 'text', content: content.substring(lastIndex) });
    }
    return result;
  }, [content]);

  return (
    <div className="prose prose-stone max-w-none prose-sm prose-pre:p-0 prose-pre:m-0 prose-code:text-orange-600 prose-code:bg-orange-50 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none">
      {parts.map((part, idx) => {
        if (part.type === 'concept') {
          return <ConceptLink key={idx} term={part.term} definition={part.definition} onLearnMore={onLearnMore} />;
        }
        return (
          <ReactMarkdown
            key={idx}
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex, rehypeRaw]}
            components={{
              code({ node, inline, className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const value = String(children).replace(/\n$/, '');

                if (!inline && match) {
                  return <CodeBlock language={match[1]} value={value} />;
                }

                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              },
              p: ({ node, ...props }) => <p className="mb-3 last:mb-0 leading-7" {...props} />,
              a: ({ node, ...props }) => (
                <a className="text-orange-600 hover:text-orange-700 underline" target="_blank" rel="noopener noreferrer" {...props} />
              ),
            }}
          >
            {part.content}
          </ReactMarkdown>
        );
      })}
    </div>
  );
};

// Message Component with Actions
const Message = ({ message, onEdit, onDelete, onRegenerate, onCopy, onLearnMore, isLast, isStreaming }) => {
  const [showActions, setShowActions] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={`flex gap-4 group ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {message.role === 'assistant' && (
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-600 to-amber-700 flex-shrink-0 flex items-center justify-center text-white font-bold text-xs shadow-sm mt-1">
          AI
        </div>
      )}

      <div className={`max-w-[85%] relative ${message.role === 'user' ? 'bg-stone-100 text-stone-800 px-5 py-3 rounded-2xl rounded-tr-sm' : ''}`}>
        {message.role === 'user' ? (
          <div className="text-sm whitespace-pre-wrap">{message.content}</div>
        ) : (
          <MessageContent content={message.content} onLearnMore={onLearnMore} />
        )}

        {/* Message Actions */}
        {showActions && !isStreaming && (
          <div className="absolute -bottom-8 left-0 flex items-center gap-1 bg-white border border-stone-200 rounded-lg shadow-lg p-1 animate-in fade-in slide-in-from-top-2 duration-150">
            <button
              onClick={handleCopy}
              className="p-1.5 hover:bg-stone-100 rounded text-stone-600 hover:text-stone-900 transition-colors"
              title="Copy"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
            {message.role === 'assistant' && isLast && onRegenerate && (
              <button
                onClick={onRegenerate}
                className="p-1.5 hover:bg-stone-100 rounded text-stone-600 hover:text-stone-900 transition-colors"
                title="Regenerate"
              >
                <RotateCw size={14} />
              </button>
            )}
            {message.role === 'user' && onEdit && (
              <button
                onClick={() => onEdit(message)}
                className="p-1.5 hover:bg-stone-100 rounded text-stone-600 hover:text-stone-900 transition-colors"
                title="Edit"
              >
                <Edit2 size={14} />
              </button>
            )}
            {onDelete && (
              <button
                onClick={() => onDelete(message)}
                className="p-1.5 hover:bg-stone-100 rounded text-red-600 hover:text-red-700 transition-colors"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Main Chat Window with SubTabs
const ChatWindow = ({ chat, onSendMessage, onEditMessage, onDeleteMessage, onRegenerateMessage, onLearnMore, isStreaming, onSubTabChange, onCloseSubTab }) => {
  const scrollRef = useRef(null);
  const [input, setInput] = useState('');
  const [editingMessage, setEditingMessage] = useState(null);
  const textareaRef = useRef(null);

  const activeSubTab = chat.subTabs.find((st) => st.id === chat.activeSubTabId) || chat.subTabs[0];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeSubTab?.messages, isStreaming]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [input]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    if (editingMessage) {
      onEditMessage(chat.id, activeSubTab.id, editingMessage, input);
      setEditingMessage(null);
    } else {
      onSendMessage(chat.id, activeSubTab.id, input);
    }
    setInput('');
  };

  const handleEdit = (message) => {
    setEditingMessage(message);
    setInput(message.content);
    textareaRef.current?.focus();
  };

  const cancelEdit = () => {
    setEditingMessage(null);
    setInput('');
  };

  return (
    <div className="flex flex-col h-full w-full bg-white relative">
      {/* SubTab Bar */}
      <div className="border-b border-stone-200 bg-white">
        <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar px-2">
          {chat.subTabs.map((subTab) => (
            <button
              key={subTab.id}
              onClick={() => onSubTabChange(chat.id, subTab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-all whitespace-nowrap group ${
                chat.activeSubTabId === subTab.id
                  ? 'border-orange-600 text-orange-600'
                  : 'border-transparent text-stone-600 hover:text-stone-900'
              }`}
            >
              <span>{subTab.title}</span>
              {subTab.id !== 'main' && chat.subTabs.length > 1 && (
                <X
                  size={14}
                  className="opacity-0 group-hover:opacity-100 hover:text-red-600 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseSubTab(chat.id, subTab.id);
                  }}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar" ref={scrollRef}>
        <div className="max-w-4xl mx-auto space-y-4 pb-6">
          {activeSubTab.messages.length === 0 && (
            <div className="text-center mt-16 space-y-3 animate-in fade-in duration-700">
              <div className="w-12 h-12 bg-gradient-to-br from-orange-500 to-amber-600 rounded-xl mx-auto flex items-center justify-center text-white shadow-lg">
                <Sparkles size={20} />
              </div>
              <h2 className="text-lg font-semibold text-stone-800">{chat.title}</h2>
              <p className="text-xs text-stone-500 max-w-md mx-auto">Start a conversation with Claude</p>
            </div>
          )}

          {activeSubTab.messages.map((msg, idx) => (
            <Message
              key={idx}
              message={msg}
              onEdit={handleEdit}
              onDelete={() => onDeleteMessage(chat.id, activeSubTab.id, idx)}
              onRegenerate={idx === activeSubTab.messages.length - 1 ? () => onRegenerateMessage(chat.id, activeSubTab.id) : null}
              onLearnMore={onLearnMore}
              isLast={idx === activeSubTab.messages.length - 1}
              isStreaming={isStreaming && idx === activeSubTab.messages.length - 1}
            />
          ))}

          {isStreaming && activeSubTab.messages[activeSubTab.messages.length - 1]?.role !== 'assistant' && (
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-lg bg-stone-200 flex-shrink-0 animate-pulse" />
              <div className="flex items-center gap-1 mt-2">
                <div className="w-2 h-2 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div className="border-t border-stone-200 p-3 bg-white">
        <div className="max-w-4xl mx-auto">
          {editingMessage && (
            <div className="mb-2 flex items-center gap-2 text-[11px] text-orange-600 bg-orange-50 px-2 py-1.5 rounded-lg">
              <Edit2 size={11} />
              Editing message
              <button onClick={cancelEdit} className="ml-auto text-stone-600 hover:text-stone-900">
                <X size={12} />
              </button>
            </div>
          )}
          <div className="bg-stone-50 border border-stone-200 rounded-lg p-2.5 focus-within:ring-2 focus-within:ring-orange-200 focus-within:border-orange-300 transition-all">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
                if (e.key === 'Escape' && editingMessage) {
                  cancelEdit();
                }
              }}
              placeholder="Message Claude..."
              className="w-full bg-transparent border-none focus:ring-0 resize-none text-stone-800 placeholder-stone-400 text-[13px] max-h-32 leading-relaxed"
              rows={1}
              disabled={isStreaming}
            />
            <div className="flex justify-between items-center mt-1.5 pt-1.5 border-t border-stone-200">
              <div className="text-[10px] text-stone-400">
                {chat.model && MODELS[chat.model] && (
                  <span className="flex items-center gap-1">
                    <Code size={10} />
                    {MODELS[chat.model].name}
                  </span>
                )}
              </div>
              <button
                onClick={handleSend}
                disabled={!input.trim() || isStreaming}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-1.5 transition-all ${
                  input.trim() && !isStreaming
                    ? 'bg-orange-600 text-white hover:bg-orange-700 shadow-sm hover:shadow-md'
                    : 'bg-stone-200 text-stone-400 cursor-not-allowed'
                }`}
              >
                {editingMessage ? 'Update' : 'Send'}
                <Send size={12} />
              </button>
            </div>
          </div>
          <div className="text-center mt-1.5">
            <span className="text-[9px] text-stone-400">Claude can make mistakes. Verify important information.</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// Settings Modal
const SettingsModal = ({ isOpen, onClose, currentModel, onModelChange, prompts, onPromptsChange }) => {
  const [activeTab, setActiveTab] = useState('model');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-stone-200 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-stone-900">Settings</h2>
          <button onClick={onClose} className="p-2 hover:bg-stone-100 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="border-b border-stone-200 px-6">
          <div className="flex gap-4">
            <button
              onClick={() => setActiveTab('model')}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'model'
                  ? 'border-orange-600 text-orange-600'
                  : 'border-transparent text-stone-600 hover:text-stone-900'
              }`}
            >
              Model
            </button>
            <button
              onClick={() => setActiveTab('prompts')}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === 'prompts'
                  ? 'border-orange-600 text-orange-600'
                  : 'border-transparent text-stone-600 hover:text-stone-900'
              }`}
            >
              Prompts
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'model' && (
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-3">Select Model</label>
              <div className="space-y-2">
                {Object.entries(MODELS).map(([key, model]) => (
                  <button
                    key={key}
                    onClick={() => onModelChange(key)}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                      currentModel === key
                        ? 'border-orange-500 bg-orange-50'
                        : 'border-stone-200 hover:border-stone-300 hover:bg-stone-50'
                    }`}
                  >
                    <div className="font-medium text-stone-900">{model.name}</div>
                    <div className="text-xs text-stone-600 mt-1">
                      Speed: {model.speed} • Quality: {model.quality}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'prompts' && (
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-stone-700">System Prompt</label>
                  <button
                    onClick={() => onPromptsChange({ ...prompts, system: DEFAULT_SYSTEM_PROMPT })}
                    className="text-xs text-orange-600 hover:text-orange-700 font-medium"
                  >
                    Reset to default
                  </button>
                </div>
                <textarea
                  value={prompts.system}
                  onChange={(e) => onPromptsChange({ ...prompts, system: e.target.value })}
                  className="w-full h-32 px-3 py-2 border border-stone-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-none"
                  placeholder="Enter system prompt..."
                />
                <p className="text-xs text-stone-500 mt-1">Used for all chat conversations</p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-stone-700">Deep Dive Prompt</label>
                  <button
                    onClick={() => onPromptsChange({ ...prompts, deepDive: DEFAULT_DEEP_DIVE_PROMPT })}
                    className="text-xs text-orange-600 hover:text-orange-700 font-medium"
                  >
                    Reset to default
                  </button>
                </div>
                <textarea
                  value={prompts.deepDive}
                  onChange={(e) => onPromptsChange({ ...prompts, deepDive: e.target.value })}
                  className="w-full h-24 px-3 py-2 border border-stone-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-orange-500 focus:border-orange-500 resize-none"
                  placeholder="Enter deep dive prompt template..."
                />
                <p className="text-xs text-stone-500 mt-1">Use {'{topic}'} as placeholder for the concept. Example: "Explain {'{topic}'} in detail"</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Main App
export default function App() {
  const [activeTabId, setActiveTabId] = useState('main');
  const [tabs, setTabs] = useState([
    {
      id: 'main',
      title: 'New Chat',
      model: 'claude-haiku-4-5',
      activeSubTabId: 'main',
      subTabs: [
        { id: 'main', title: 'Chat', messages: [] }
      ]
    }
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Custom prompts
  const [prompts, setPrompts] = useState(() => {
    const saved = localStorage.getItem('customPrompts');
    return saved ? JSON.parse(saved) : {
      system: DEFAULT_SYSTEM_PROMPT,
      deepDive: DEFAULT_DEEP_DIVE_PROMPT,
    };
  });

  // Save prompts to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('customPrompts', JSON.stringify(prompts));
  }, [prompts]);

  // Supabase sync state
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const saveTimeoutRef = useRef(null);

  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // Load chats from Supabase on mount
  useEffect(() => {
    async function loadInitialChats() {
      if (!supabase) return;

      const savedChats = await loadChats();
      if (savedChats && savedChats.length > 0) {
        setTabs(savedChats);
        setActiveTabId(savedChats[0].id);
      }
    }
    loadInitialChats();
  }, []);

  // Auto-save chats to Supabase (debounced)
  useEffect(() => {
    if (!supabase || tabs.length === 0) return;

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      setIsSaving(true);

      // Save all chats
      for (const chat of tabs) {
        await saveChat(chat);
      }

      setIsSaving(false);
      setLastSaved(new Date());
    }, 1000); // Debounce for 1 second

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [tabs]);

  // Detect mobile and auto-close sidebar
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile && sidebarOpen) {
        setSidebarOpen(false);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Auto-close sidebar on mobile when starting to chat
  useEffect(() => {
    if (isMobile && isStreaming && sidebarOpen) {
      setSidebarOpen(false);
    }
  }, [isStreaming, isMobile]);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const activeSubTab = activeTab?.subTabs.find((st) => st.id === activeTab.activeSubTabId);

  const handleSendMessage = async (chatId, subTabId, text) => {
    setTabs((prev) =>
      prev.map((chat) => {
        if (chat.id === chatId) {
          return {
            ...chat,
            subTabs: chat.subTabs.map((st) =>
              st.id === subTabId
                ? { ...st, messages: [...st.messages, { role: 'user', content: text }] }
                : st
            )
          };
        }
        return chat;
      })
    );

    setIsStreaming(true);
    let fullResponse = '';

    try {
      const currentChat = tabsRef.current.find((t) => t.id === chatId);
      const currentSubTab = currentChat?.subTabs.find((st) => st.id === subTabId);
      const history = currentSubTab ? [...currentSubTab.messages, { role: 'user', content: text }] : [{ role: 'user', content: text }];
      const model = currentChat?.model || 'claude-haiku-4-5';

      const stream = streamClaudeResponse(history, model, prompts.system);

      setTabs((prev) =>
        prev.map((chat) => {
          if (chat.id === chatId) {
            return {
              ...chat,
              subTabs: chat.subTabs.map((st) =>
                st.id === subTabId
                  ? { ...st, messages: [...st.messages, { role: 'assistant', content: '' }] }
                  : st
              )
            };
          }
          return chat;
        })
      );

      for await (const chunk of stream) {
        fullResponse += chunk;
        setTabs((prev) =>
          prev.map((chat) => {
            if (chat.id === chatId) {
              return {
                ...chat,
                subTabs: chat.subTabs.map((st) => {
                  if (st.id === subTabId) {
                    const msgs = [...st.messages];
                    msgs[msgs.length - 1].content = fullResponse;
                    return { ...st, messages: msgs };
                  }
                  return st;
                })
              };
            }
            return chat;
          })
        );
      }

      // Auto-generate chat title from first message
      const currentChatAfter = tabsRef.current.find((t) => t.id === chatId);
      const mainSubTab = currentChatAfter?.subTabs.find((st) => st.id === 'main');
      if (currentChatAfter?.title === 'New Chat' && mainSubTab?.messages.length === 2) {
        const firstUserMsg = mainSubTab.messages[0]?.content || '';
        const title = firstUserMsg.length > 40
          ? firstUserMsg.substring(0, 40).trim() + '...'
          : firstUserMsg.trim() || 'New Chat';

        setTabs((prev) =>
          prev.map((chat) =>
            chat.id === chatId ? { ...chat, title } : chat
          )
        );
      }
    } catch (error) {
      console.error('Stream error:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleEditMessage = (chatId, subTabId, message, newContent) => {
    setTabs((prev) =>
      prev.map((chat) => {
        if (chat.id === chatId) {
          return {
            ...chat,
            subTabs: chat.subTabs.map((st) => {
              if (st.id === subTabId) {
                const idx = st.messages.indexOf(message);
                if (idx !== -1) {
                  return { ...st, messages: st.messages.slice(0, idx) };
                }
              }
              return st;
            })
          };
        }
        return chat;
      })
    );
    handleSendMessage(chatId, subTabId, newContent);
  };

  const handleDeleteMessage = (chatId, subTabId, messageIndex) => {
    setTabs((prev) =>
      prev.map((chat) => {
        if (chat.id === chatId) {
          return {
            ...chat,
            subTabs: chat.subTabs.map((st) =>
              st.id === subTabId
                ? { ...st, messages: st.messages.filter((_, idx) => idx !== messageIndex) }
                : st
            )
          };
        }
        return chat;
      })
    );
  };

  const handleRegenerateMessage = (chatId, subTabId) => {
    setTabs((prev) =>
      prev.map((chat) => {
        if (chat.id === chatId) {
          return {
            ...chat,
            subTabs: chat.subTabs.map((st) => {
              if (st.id === subTabId && st.messages.length >= 2) {
                const lastUserMessage = [...st.messages].reverse().find((m) => m.role === 'user');
                if (lastUserMessage) {
                  setTimeout(() => handleSendMessage(chatId, subTabId, lastUserMessage.content), 0);
                  return { ...st, messages: st.messages.slice(0, -1) };
                }
              }
              return st;
            })
          };
        }
        return chat;
      })
    );
  };

  const startDeepDive = (topic) => {
    if (!activeTab) return;

    const newSubTabId = `dive-${Date.now()}`;
    const newSubTab = {
      id: newSubTabId,
      title: topic.substring(0, 20),
      messages: []
    };

    setTabs((prev) =>
      prev.map((chat) => {
        if (chat.id === activeTabId) {
          return {
            ...chat,
            activeSubTabId: newSubTabId,
            subTabs: [...chat.subTabs, newSubTab]
          };
        }
        return chat;
      })
    );

    setTimeout(() => {
      const promptText = prompts.deepDive.replace('{topic}', topic);
      handleSendMessage(activeTabId, newSubTabId, promptText);
    }, 100);
  };

  const changeSubTab = (chatId, subTabId) => {
    setTabs((prev) =>
      prev.map((chat) =>
        chat.id === chatId ? { ...chat, activeSubTabId: subTabId } : chat
      )
    );
  };

  const closeSubTab = (chatId, subTabId) => {
    setTabs((prev) =>
      prev.map((chat) => {
        if (chat.id === chatId) {
          const newSubTabs = chat.subTabs.filter((st) => st.id !== subTabId);
          if (newSubTabs.length === 0) return chat; // Don't allow closing last subtab

          const newActiveSubTabId = chat.activeSubTabId === subTabId
            ? newSubTabs[0].id
            : chat.activeSubTabId;

          return { ...chat, subTabs: newSubTabs, activeSubTabId: newActiveSubTabId };
        }
        return chat;
      })
    );
  };

  const closeTab = async (id, e) => {
    e?.stopPropagation();
    if (id === 'main') return;

    // Delete from Supabase
    if (supabase) {
      await deleteChat(id);
    }

    const newTabs = tabs.filter((t) => t.id !== id);
    setTabs(newTabs);
    if (activeTabId === id) {
      setActiveTabId(newTabs[newTabs.length - 1].id);
    }
  };

  const changeModel = (model) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id === activeTabId) {
          return { ...t, model };
        }
        return t;
      })
    );
    setSettingsOpen(false);
  };

  return (
    <div className="flex h-screen w-full bg-stone-50 text-stone-900 overflow-hidden selection:bg-orange-100">
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #d6d3d1; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #a8a29e; }
      `}</style>

      {/* Mobile backdrop */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        ${isMobile ? 'fixed left-0 top-0 bottom-0 z-50' : 'relative'}
        ${sidebarOpen ? 'w-64 translate-x-0' : 'w-0 -translate-x-full md:translate-x-0'}
        flex-shrink-0 bg-stone-100 border-r border-stone-200
        transition-all duration-300 overflow-hidden flex flex-col
        ${isMobile ? 'shadow-2xl' : ''}
      `}>
        <div className="p-4 flex items-center justify-between border-b border-stone-200">
          <div className="font-semibold text-stone-700 flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-br from-orange-600 to-amber-700 rounded-lg text-white flex items-center justify-center text-xs font-bold shadow">
              C
            </div>
            <span className="text-sm">Claude Chat</span>
          </div>
        </div>

        <div className="p-3">
          <button
            onClick={() => {
              const newId = `chat-${Date.now()}`;
              setTabs((prev) => [...prev, {
                id: newId,
                title: 'New Chat',
                model: 'claude-haiku-4-5',
                activeSubTabId: 'main',
                subTabs: [{ id: 'main', title: 'Chat', messages: [] }]
              }]);
              setActiveTabId(newId);
              if (isMobile) setSidebarOpen(false);
            }}
            className="w-full flex items-center gap-2 bg-white hover:bg-stone-50 border border-stone-200 text-stone-700 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all shadow-sm"
          >
            <Plus size={14} className="text-orange-600" /> New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar">
          <div className="text-[9px] font-semibold text-stone-400 px-2 py-1 uppercase tracking-wider">Chats</div>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTabId(tab.id);
                if (isMobile) setSidebarOpen(false);
              }}
              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] flex items-center gap-2 group transition-all ${
                activeTabId === tab.id ? 'bg-stone-200 text-stone-900 font-medium' : 'text-stone-600 hover:bg-stone-200/50'
              }`}
            >
              <MessageSquare size={12} />
              <span className="truncate flex-1">{tab.title}</span>
              {tab.id !== 'main' && (
                <X
                  size={12}
                  className="opacity-0 group-hover:opacity-100 hover:text-red-600 transition-opacity"
                  onClick={(e) => closeTab(tab.id, e)}
                />
              )}
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-stone-200 space-y-2">
          {/* Sync Status */}
          {supabase && (
            <div className="flex items-center gap-2 px-3 py-2 text-[10px] text-stone-500">
              {isSaving ? (
                <>
                  <Cloud size={12} className="animate-pulse text-orange-600" />
                  <span>Saving...</span>
                </>
              ) : lastSaved ? (
                <>
                  <Cloud size={12} className="text-green-600" />
                  <span>Saved {new Date(lastSaved).toLocaleTimeString()}</span>
                </>
              ) : (
                <>
                  <Cloud size={12} className="text-stone-400" />
                  <span>Sync enabled</span>
                </>
              )}
            </div>
          )}
          {!supabase && (
            <div className="flex items-center gap-2 px-3 py-2 text-[10px] text-stone-400">
              <CloudOff size={12} />
              <span>Offline mode</span>
            </div>
          )}

          <button
            onClick={() => setSettingsOpen(true)}
            className="w-full flex items-center gap-2 text-stone-600 hover:text-stone-900 hover:bg-stone-200/50 px-3 py-2 rounded-lg text-xs transition-all"
          >
            <Settings size={14} />
            Settings
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full relative">
        {/* Top Bar */}
        <div className="h-12 md:h-10 border-b border-stone-200 bg-white flex items-center px-3 md:px-3 justify-between shadow-sm z-10">
          <div className="flex items-center gap-2 flex-1">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors"
            >
              <Menu size={16} />
            </button>

            {/* Mobile: Show current chat title */}
            <div className="md:hidden flex-1">
              <h1 className="font-medium text-stone-900 text-xs truncate">
                {activeTab?.title || 'New Chat'}
              </h1>
            </div>

            {/* Desktop: Show all tabs */}
            <div className="hidden md:flex items-center gap-1 flex-1 overflow-x-auto custom-scrollbar">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md transition-all whitespace-nowrap group ${
                    activeTabId === tab.id
                      ? 'bg-white text-stone-800 shadow-sm border border-stone-200'
                      : 'text-stone-600 hover:bg-stone-100'
                  }`}
                >
                  <MessageSquare size={11} className="text-stone-400" />
                  <span className="max-w-[100px] truncate">
                    {tab.title}
                  </span>
                  {tabs.length > 1 && (
                    <X
                      size={12}
                      className="opacity-0 group-hover:opacity-100 hover:text-red-600 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        setTabs((prev) => prev.filter((t) => t.id !== tab.id));
                        if (activeTabId === tab.id && tabs.length > 1) {
                          setActiveTabId(tabs[0].id === tab.id ? tabs[1].id : tabs[0].id);
                        }
                      }}
                    />
                  )}
                </button>
              ))}
              <button
                onClick={() => {
                  const newId = `chat-${Date.now()}`;
                  setTabs((prev) => [...prev, {
                    id: newId,
                    title: 'New Chat',
                    model: 'claude-haiku-4-5',
                    activeSubTabId: 'main',
                    subTabs: [{ id: 'main', title: 'Chat', messages: [] }]
                  }]);
                  setActiveTabId(newId);
                }}
                className="flex items-center gap-1 px-1.5 py-1 text-stone-500 hover:text-orange-600 hover:bg-stone-100 rounded-md transition-all"
                title="New Chat"
              >
                <Plus size={12} />
              </button>
            </div>
          </div>
        </div>

        {/* Chat Window */}
        <div className="flex-1 overflow-hidden">
          {activeTab ? (
            <ChatWindow
              chat={activeTab}
              onSendMessage={handleSendMessage}
              onEditMessage={handleEditMessage}
              onDeleteMessage={handleDeleteMessage}
              onRegenerateMessage={handleRegenerateMessage}
              onLearnMore={startDeepDive}
              isStreaming={isStreaming}
              onSubTabChange={changeSubTab}
              onCloseSubTab={closeSubTab}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-stone-400">
              <p>No chat selected</p>
            </div>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        currentModel={activeTab?.model}
        onModelChange={changeModel}
        prompts={prompts}
        onPromptsChange={setPrompts}
      />
    </div>
  );
}
