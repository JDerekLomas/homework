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
  Settings
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import 'katex/dist/katex.min.css';

// --- CONFIGURATION ---
const MODELS = {
  'claude-3-5-sonnet-20241022': { name: 'Claude 3.5 Sonnet', speed: 'Fast', quality: 'High' },
  'claude-sonnet-4-20250514': { name: 'Claude Sonnet 4', speed: 'Slower', quality: 'Highest' },
};

const SYSTEM_PROMPT = `You are Claude, a helpful and intelligent AI assistant created by Anthropic.

When introducing important technical concepts, you can optionally highlight them using this syntax:
~^Term|Brief definition^~

Respond naturally using Markdown formatting. Use code blocks with language tags for code.`;

// --- HELPER: Stream Generator ---
async function* streamClaudeResponse(messages, model = 'claude-3-5-sonnet-20241022') {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: SYSTEM_PROMPT,
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

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        onClick={() => onLearnMore?.(term)}
        className="mx-0.5 font-medium text-orange-600 hover:text-orange-700 border-b border-orange-300 hover:border-orange-500 transition-all"
      >
        {term}
      </button>

      {showTooltip && (
        <div className="absolute z-50 bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-64 bg-white rounded-lg shadow-xl border border-stone-200 p-3 text-sm text-stone-800 animate-in fade-in zoom-in-95 duration-150">
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
              Deep Dive
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

// Main Chat Window
const ChatWindow = ({ chat, onSendMessage, onEditMessage, onDeleteMessage, onRegenerateMessage, isActive, onClick, onLearnMore, isStreaming }) => {
  const scrollRef = useRef(null);
  const [input, setInput] = useState('');
  const [editingMessage, setEditingMessage] = useState(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chat.messages, isStreaming]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [input]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;

    if (editingMessage) {
      onEditMessage(chat.id, editingMessage, input);
      setEditingMessage(null);
    } else {
      onSendMessage(chat.id, input);
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

  if (!isActive) {
    return (
      <div
        onClick={onClick}
        className="h-full w-full bg-stone-50/50 border-r border-stone-200 cursor-pointer hover:bg-stone-100 transition-colors relative overflow-hidden group"
      >
        <div className="p-6">
          <h3 className="font-serif text-xl text-stone-400 mb-6 font-medium">Main Chat</h3>
          <div className="space-y-4 opacity-30 group-hover:opacity-60 transition-opacity">
            {chat.messages.slice(-3).map((m, i) => (
              <div key={i} className={`text-xs ${m.role === 'user' ? 'text-right' : 'text-left'}`}>
                <div className={`inline-block p-2 rounded-lg ${m.role === 'user' ? 'bg-stone-200' : 'bg-white border'}`}>
                  {m.content.substring(0, 40)}...
                </div>
              </div>
            ))}
          </div>
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-stone-100/30 backdrop-blur-sm">
            <div className="bg-white shadow-xl border border-stone-200 rounded-full px-6 py-3 text-sm font-medium text-stone-700 flex items-center gap-2">
              <ChevronLeft size={16} /> Back to Main
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full bg-white relative">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar" ref={scrollRef}>
        <div className="max-w-4xl mx-auto space-y-6 pb-8">
          {chat.messages.length === 0 && (
            <div className="text-center mt-20 space-y-4 animate-in fade-in duration-700">
              <div className="w-16 h-16 bg-gradient-to-br from-orange-500 to-amber-600 rounded-2xl mx-auto flex items-center justify-center text-white shadow-lg">
                <Sparkles size={28} />
              </div>
              <h2 className="text-2xl font-serif text-stone-800">{chat.title}</h2>
              <p className="text-stone-500 max-w-md mx-auto">
                {chat.type === 'deep-dive' ? 'Comprehensive analysis with detailed explanations' : 'Start a conversation with Claude'}
              </p>
            </div>
          )}

          {chat.messages.map((msg, idx) => (
            <Message
              key={idx}
              message={msg}
              onEdit={handleEdit}
              onDelete={(m) => onDeleteMessage(chat.id, idx)}
              onRegenerate={idx === chat.messages.length - 1 ? () => onRegenerateMessage(chat.id) : null}
              onLearnMore={onLearnMore}
              isLast={idx === chat.messages.length - 1}
              isStreaming={isStreaming && idx === chat.messages.length - 1}
            />
          ))}

          {isStreaming && chat.messages[chat.messages.length - 1]?.role !== 'assistant' && (
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
      <div className="border-t border-stone-200 p-4 bg-white">
        <div className="max-w-4xl mx-auto">
          {editingMessage && (
            <div className="mb-2 flex items-center gap-2 text-xs text-orange-600 bg-orange-50 px-3 py-2 rounded-lg">
              <Edit2 size={12} />
              Editing message
              <button onClick={cancelEdit} className="ml-auto text-stone-600 hover:text-stone-900">
                <X size={14} />
              </button>
            </div>
          )}
          <div className="bg-stone-50 border border-stone-200 rounded-xl p-3 focus-within:ring-2 focus-within:ring-orange-200 focus-within:border-orange-300 transition-all">
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
              className="w-full bg-transparent border-none focus:ring-0 resize-none text-stone-800 placeholder-stone-400 text-sm max-h-40"
              rows={1}
              disabled={isStreaming}
            />
            <div className="flex justify-between items-center mt-2 pt-2 border-t border-stone-200">
              <div className="text-xs text-stone-400">
                {chat.model && MODELS[chat.model] && (
                  <span className="flex items-center gap-1">
                    <Code size={12} />
                    {MODELS[chat.model].name}
                  </span>
                )}
              </div>
              <button
                onClick={handleSend}
                disabled={!input.trim() || isStreaming}
                className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all ${
                  input.trim() && !isStreaming
                    ? 'bg-orange-600 text-white hover:bg-orange-700 shadow-md hover:shadow-lg'
                    : 'bg-stone-200 text-stone-400 cursor-not-allowed'
                }`}
              >
                {editingMessage ? 'Update' : 'Send'}
                <Send size={14} />
              </button>
            </div>
          </div>
          <div className="text-center mt-2">
            <span className="text-[10px] text-stone-400">Claude can make mistakes. Please verify important information.</span>
          </div>
        </div>
      </div>
    </div>
  );
};

// Settings Modal
const SettingsModal = ({ isOpen, onClose, currentModel, onModelChange }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-stone-200 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-stone-900">Settings</h2>
          <button onClick={onClose} className="p-2 hover:bg-stone-100 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">Model</label>
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
        </div>
      </div>
    </div>
  );
};

// Main App
export default function App() {
  const [activeTabId, setActiveTabId] = useState('main');
  const [tabs, setTabs] = useState([
    { id: 'main', title: 'New Chat', type: 'main', messages: [], model: 'claude-3-5-sonnet-20241022' }
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const showSplitView = activeTab?.type === 'deep-dive';

  const handleSendMessage = async (chatId, text) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id === chatId) {
          return { ...t, messages: [...t.messages, { role: 'user', content: text }] };
        }
        return t;
      })
    );

    setIsStreaming(true);
    let fullResponse = '';

    try {
      const currentChat = tabsRef.current.find((t) => t.id === chatId);
      const history = currentChat ? [...currentChat.messages, { role: 'user', content: text }] : [{ role: 'user', content: text }];
      const model = currentChat?.model || 'claude-3-5-sonnet-20241022';

      const stream = streamClaudeResponse(history, model);

      // Add empty assistant message
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id === chatId) {
            return { ...t, messages: [...t.messages, { role: 'assistant', content: '' }] };
          }
          return t;
        })
      );

      for await (const chunk of stream) {
        fullResponse += chunk;
        setTabs((prev) =>
          prev.map((t) => {
            if (t.id === chatId) {
              const msgs = [...t.messages];
              msgs[msgs.length - 1].content = fullResponse;
              return { ...t, messages: msgs };
            }
            return t;
          })
        );
      }
    } catch (error) {
      console.error('Stream error:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setIsStreaming(false);
    }
  };

  const handleEditMessage = (chatId, message, newContent) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id === chatId) {
          const idx = t.messages.indexOf(message);
          if (idx !== -1) {
            const newMessages = t.messages.slice(0, idx);
            return { ...t, messages: newMessages };
          }
        }
        return t;
      })
    );
    handleSendMessage(chatId, newContent);
  };

  const handleDeleteMessage = (chatId, messageIndex) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id === chatId) {
          const newMessages = t.messages.filter((_, idx) => idx !== messageIndex);
          return { ...t, messages: newMessages };
        }
        return t;
      })
    );
  };

  const handleRegenerateMessage = (chatId) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id === chatId && t.messages.length >= 2) {
          const lastUserMessage = [...t.messages].reverse().find((m) => m.role === 'user');
          if (lastUserMessage) {
            const newMessages = t.messages.slice(0, -1);
            setTimeout(() => handleSendMessage(chatId, lastUserMessage.content), 0);
            return { ...t, messages: newMessages };
          }
        }
        return t;
      })
    );
  };

  const startDeepDive = (topic) => {
    const newTabId = `dive-${Date.now()}`;
    const newTab = {
      id: newTabId,
      title: `${topic.substring(0, 30)}...`,
      type: 'deep-dive',
      messages: [],
      model: 'claude-3-5-sonnet-20241022',
    };

    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTabId);

    setTimeout(() => {
      handleSendMessage(newTabId, `Provide a comprehensive deep dive into: ${topic}. Include technical details, examples, and practical applications.`);
    }, 100);
  };

  const closeTab = (id, e) => {
    e?.stopPropagation();
    if (id === 'main') return;
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

      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-64' : 'w-0'} flex-shrink-0 bg-stone-100 border-r border-stone-200 transition-all duration-300 overflow-hidden flex flex-col`}>
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
              setTabs((prev) => [...prev, { id: newId, title: 'New Chat', type: 'main', messages: [], model: 'claude-3-5-sonnet-20241022' }]);
              setActiveTabId(newId);
            }}
            className="w-full flex items-center gap-2 bg-white hover:bg-stone-50 border border-stone-200 text-stone-700 px-3 py-2 rounded-lg text-sm font-medium transition-all shadow-sm"
          >
            <Plus size={16} className="text-orange-600" /> New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
          <div className="text-[10px] font-semibold text-stone-400 px-2 py-1 uppercase tracking-wider">Chats</div>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center gap-2 group transition-all ${
                activeTabId === tab.id ? 'bg-stone-200 text-stone-900 font-medium' : 'text-stone-600 hover:bg-stone-200/50'
              }`}
            >
              <MessageSquare size={13} className={tab.type === 'deep-dive' ? 'text-orange-600' : ''} />
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

        <div className="p-3 border-t border-stone-200">
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
        <div className="h-12 border-b border-stone-200 bg-white flex items-center px-4 justify-between shadow-sm z-10">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-1.5 text-stone-400 hover:text-stone-600 hover:bg-stone-100 rounded transition-colors">
              <Menu size={18} />
            </button>
            <div className="flex items-center gap-2 bg-stone-100 px-3 py-1 rounded-lg">
              {tabs.slice(0, 5).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  className={`px-2 py-1 text-[11px] font-medium rounded transition-all ${
                    activeTabId === tab.id ? 'bg-white text-stone-800 shadow-sm' : 'text-stone-500 hover:text-stone-700'
                  }`}
                >
                  {tab.title.substring(0, 15)}
                  {tab.title.length > 15 ? '...' : ''}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Chat Panes */}
        <div className="flex-1 relative overflow-hidden">
          {/* Main Chat */}
          <div className={`absolute inset-0 transition-all duration-500 ${showSplitView ? 'w-80' : 'w-full'}`}>
            <ChatWindow
              chat={tabs.find((t) => t.id === 'main') || tabs[0]}
              isActive={!showSplitView}
              onClick={() => setActiveTabId('main')}
              onSendMessage={handleSendMessage}
              onEditMessage={handleEditMessage}
              onDeleteMessage={handleDeleteMessage}
              onRegenerateMessage={handleRegenerateMessage}
              onLearnMore={startDeepDive}
              isStreaming={isStreaming && activeTabId === 'main'}
            />
          </div>

          {/* Deep Dive Panel */}
          {activeTab && activeTab.type === 'deep-dive' && (
            <div className={`absolute top-0 bottom-0 right-0 bg-white shadow-2xl transition-all duration-500 ${showSplitView ? 'w-[calc(100%-20rem)]' : 'w-0'}`}>
              <ChatWindow
                chat={activeTab}
                isActive={true}
                onSendMessage={handleSendMessage}
                onEditMessage={handleEditMessage}
                onDeleteMessage={handleDeleteMessage}
                onRegenerateMessage={handleRegenerateMessage}
                onLearnMore={startDeepDive}
                isStreaming={isStreaming && activeTabId === activeTab.id}
              />
              <button
                onClick={() => closeTab(activeTab.id)}
                className="absolute top-3 right-3 p-2 bg-white hover:bg-stone-100 border border-stone-200 rounded-lg text-stone-500 hover:text-stone-700 transition-all shadow-sm"
              >
                <X size={16} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} currentModel={activeTab?.model} onModelChange={changeModel} />
    </div>
  );
}
