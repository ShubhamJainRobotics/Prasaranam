import React, { useState, useEffect, useRef } from 'react';
import { api, RelayApiError } from '../../lib/api.js';
import { AnswerStatement, type AnswerStatementData } from './AnswerStatement.js';
import { LoadingSkeleton } from '../ui/LoadingSkeleton.js';
import { EmptyState } from '../ui/EmptyState.js';
import type { ConversationSummary, ConversationMessage } from '@relay/contracts';

interface Props {
  projectId: string;
}

export const ChatPanel: React.FC<Props> = ({ projectId }) => {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [hasStaleHistory, setHasStaleHistory] = useState(false);
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);

  const [questionInput, setQuestionInput] = useState('');
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [isAsking, setIsAsking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [staleError, setStaleError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isAsking]);

  // Load conversations for project
  const loadConversations = async (autoSelectLatest = true) => {
    try {
      setLoadingConversations(true);
      setErrorMessage(null);
      const res = await api.get<ConversationSummary[]>(`/projects/${projectId}/conversations`);
      setConversations(res);
      if (res.length > 0 && autoSelectLatest && !activeConversationId && res[0]) {
        setActiveConversationId(res[0].id);
      }
    } catch (err) {
      const apiErr = err as RelayApiError;
      setErrorMessage(apiErr.message || 'Failed to load conversations');
    } finally {
      setLoadingConversations(false);
    }
  };

  useEffect(() => {
    loadConversations();
  }, [projectId]);

  // Load messages when active conversation changes
  const loadMessages = async (convId: string) => {
    try {
      setLoadingMessages(true);
      setErrorMessage(null);
      setStaleError(null);
      const res = await api.get<{
        messages: ConversationMessage[];
        hasStaleHistory: boolean;
        historyUnavailableNotice: string | null;
      }>(`/conversations/${convId}/messages`);

      setMessages(res.messages || []);
      setHasStaleHistory(res.hasStaleHistory || false);
      setHistoryNotice(res.historyUnavailableNotice || null);
    } catch (err) {
      const apiErr = err as RelayApiError;
      setErrorMessage(apiErr.message || 'Failed to load messages');
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    if (activeConversationId) {
      loadMessages(activeConversationId);
    } else {
      setMessages([]);
    }
  }, [activeConversationId]);

  // Start new conversation
  const handleStartNewConversation = async () => {
    try {
      setErrorMessage(null);
      const res = await api.post<{ id: string }>(`/projects/${projectId}/conversations`);
      await loadConversations(false);
      setActiveConversationId(res.id);
      setMessages([]);
      setHasStaleHistory(false);
      setHistoryNotice(null);
    } catch (err) {
      const apiErr = err as RelayApiError;
      setErrorMessage(apiErr.message || 'Failed to create new conversation');
    }
  };

  // Submit question
  const handleSubmitQuestion = async (e?: React.FormEvent, overrideQuestion?: string) => {
    if (e) e.preventDefault();
    const q = (overrideQuestion || questionInput).trim();
    if (!q || isAsking) return;

    let targetConvId = activeConversationId;

    // Create a new conversation if none active
    if (!targetConvId) {
      try {
        const newConv = await api.post<{ id: string }>(`/projects/${projectId}/conversations`);
        targetConvId = newConv.id;
        setActiveConversationId(newConv.id);
        await loadConversations(false);
      } catch (err) {
        const apiErr = err as RelayApiError;
        setErrorMessage(apiErr.message || 'Could not initiate conversation');
        return;
      }
    }

    // Optimistic user message append
    const tempUserMsg: ConversationMessage = {
      id: `temp-${Date.now()}`,
      conversationId: targetConvId,
      projectId,
      role: 'user',
      body: { question: q },
      accessEpoch: 'current',
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, tempUserMsg]);
    setQuestionInput('');
    setIsAsking(true);
    setStaleError(null);
    setErrorMessage(null);

    try {
      const res = await api.post<{
        id: string;
        role: 'assistant';
        body: AnswerStatementData;
        accessEpoch: string;
        createdAt: string;
      }>(`/conversations/${targetConvId}/messages`, { question: q });

      const assistantMsg: ConversationMessage = {
        id: res.id,
        conversationId: targetConvId,
        projectId,
        role: 'assistant',
        body: res.body as unknown as Record<string, unknown>,
        accessEpoch: res.accessEpoch,
        createdAt: res.createdAt,
      };

      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const apiErr = err as RelayApiError;
      if (apiErr.code === 'STALE_CONTEXT' || apiErr.status === 409) {
        setStaleError(
          'Project access changed during question processing. History has been refreshed. Please retry your question.'
        );
        // Reload messages to refresh view
        loadMessages(targetConvId);
      } else if (apiErr.code === 'QUOTA_EXCEEDED' || apiErr.code === 'RATE_LIMIT_EXCEEDED') {
        setErrorMessage(
          apiErr.message || 'AI quota or rate limit exceeded. Please try again later.'
        );
      } else {
        setErrorMessage(
          apiErr.message || 'Failed to get answer. Please check your network or try again.'
        );
      }
    } finally {
      setIsAsking(false);
    }
  };

  return (
    <div className="flex h-[calc(100vh-12rem)] bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
      {/* Sidebar: Conversation List */}
      <div className="w-72 border-r border-slate-200 bg-slate-50 flex flex-col shrink-0">
        <div className="p-3 border-b border-slate-200 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
            Conversations
          </span>
          <button
            type="button"
            data-testid="new-conversation-btn"
            onClick={handleStartNewConversation}
            className="inline-flex items-center text-xs font-medium text-indigo-600 hover:text-indigo-800 bg-white px-2 py-1 rounded border border-indigo-200 hover:border-indigo-300 shadow-2xs"
          >
            + New
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {loadingConversations ? (
            <div className="p-3">
              <LoadingSkeleton lines={3} />
            </div>
          ) : conversations.length === 0 ? (
            <div className="p-4 text-center text-xs text-slate-500">
              No conversations yet. Start one to ask questions grounded in project evidence.
            </div>
          ) : (
            conversations.map((c) => {
              const isActive = c.id === activeConversationId;
              const dateStr = c.lastMessageAt || c.createdAt;
              const formattedDate = new Date(dateStr).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <button
                  key={c.id}
                  type="button"
                  data-testid={`conversation-item-${c.id}`}
                  onClick={() => setActiveConversationId(c.id)}
                  className={`w-full text-left p-2.5 rounded-lg text-xs transition-colors flex flex-col space-y-1 ${
                    isActive
                      ? 'bg-indigo-50 border border-indigo-200 text-indigo-950 font-medium'
                      : 'hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate font-semibold">💬 Q&A Session</span>
                    <span className="text-[10px] text-slate-400">
                      {c.messageCount ? `${c.messageCount} msgs` : 'Empty'}
                    </span>
                  </div>
                  <span className="text-[10px] text-slate-400">{formattedDate}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col bg-white overflow-hidden">
        {/* Banner: History Unavailable after access change */}
        {hasStaleHistory && historyNotice && (
          <div
            data-testid="history-unavailable-notice"
            className="p-3 bg-amber-50 border-b border-amber-200 flex items-center text-xs text-amber-800"
          >
            <svg
              className="w-4 h-4 mr-2 shrink-0 text-amber-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <span>{historyNotice}</span>
          </div>
        )}

        {/* Stale Error Alert */}
        {staleError && (
          <div className="p-3 bg-rose-50 border-b border-rose-200 flex items-center justify-between text-xs text-rose-800">
            <span>{staleError}</span>
            <button
              type="button"
              onClick={() => setStaleError(null)}
              className="text-rose-500 hover:text-rose-700 font-semibold ml-2"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* General Error Alert */}
        {errorMessage && (
          <div className="p-3 bg-rose-50 border-b border-rose-200 flex items-center justify-between text-xs text-rose-800">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="text-rose-500 hover:text-rose-700 font-semibold ml-2"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Messages Scroll Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loadingMessages ? (
            <div className="space-y-4 p-4">
              <LoadingSkeleton lines={4} />
            </div>
          ) : messages.length === 0 ? (
            <div className="h-full flex items-center justify-center p-8">
              <EmptyState
                title="Evidence-Grounded Q&A"
                description="Ask any question about project decisions, architecture, risks, or tasks. Answers are synthesized strictly from accessible evidence."
              />
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === 'user';

              return (
                <div
                  key={msg.id}
                  data-testid={`chat-message-${msg.id}`}
                  className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center space-x-1.5 mb-1 text-[11px] text-slate-400">
                    <span className="font-medium text-slate-600">
                      {isUser ? 'You' : 'Relay Knowledge Assistant'}
                    </span>
                    <span>•</span>
                    <span>
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <div
                    className={`max-w-3xl rounded-xl p-4 shadow-2xs ${
                      isUser
                        ? 'bg-indigo-600 text-white rounded-tr-none text-sm leading-relaxed'
                        : 'bg-white border border-slate-200 rounded-tl-none text-slate-900 w-full'
                    }`}
                  >
                    {isUser ? (
                      <p className="whitespace-pre-wrap">{(msg.body as any)?.question || ''}</p>
                    ) : (
                      <AnswerStatement
                        answer={msg.body as unknown as AnswerStatementData}
                        onSelectClarification={(followUp) =>
                          handleSubmitQuestion(undefined, followUp)
                        }
                      />
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/* Assistant Typing / Thinking Skeleton */}
          {isAsking && (
            <div className="flex flex-col items-start space-y-1">
              <div className="text-[11px] text-slate-400 font-medium">
                Relay Knowledge Assistant
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-xl rounded-tl-none p-4 max-w-xl w-full">
                <div className="flex items-center space-x-2 text-xs text-slate-500 mb-2">
                  <div className="w-2 h-2 rounded-full bg-indigo-600 animate-ping" />
                  <span>Searching accessible project claims & verifying evidence...</span>
                </div>
                <LoadingSkeleton lines={2} />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Question Input Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50/50">
          <form onSubmit={(e) => handleSubmitQuestion(e)} className="flex items-center gap-2">
            <input
              type="text"
              data-testid="qa-question-input"
              value={questionInput}
              onChange={(e) => setQuestionInput(e.target.value)}
              placeholder="Ask an evidence-grounded question about this project..."
              disabled={isAsking}
              className="flex-1 px-4 py-2.5 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 disabled:opacity-60 disabled:bg-slate-100"
            />
            <button
              type="submit"
              data-testid="qa-submit-btn"
              disabled={!questionInput.trim() || isAsking}
              className="inline-flex items-center px-4 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg shadow-2xs transition-colors shrink-0"
            >
              {isAsking ? 'Thinking...' : 'Ask'}
            </button>
          </form>
          <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
            <span>Only citations from sources you are authorised to read will be retrieved.</span>
            <span>History refreshes automatically on access changes.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
