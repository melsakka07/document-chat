import { useState, useCallback, useRef, useEffect } from 'react'
import { DocumentArrowUpIcon, DocumentTextIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'

type Mode = 'summarize' | 'chat'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

interface ChatHistory {
  question: string
  answer: string
}

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [fileId, setFileId] = useState<string | null>(null)
  const [summary, setSummary] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<Mode>('summarize')
  const [messages, setMessages] = useState<Message[]>([])
  const [currentMessage, setCurrentMessage] = useState('')
  const [hasProcessedFile, setHasProcessedFile] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chatHistory, setChatHistory] = useState<ChatHistory[]>([])
  
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
    }
  }, [messages])

  // Focus input when switching to chat mode
  useEffect(() => {
    if (mode === 'chat' && inputRef.current) {
      inputRef.current.focus()
    }
  }, [mode])

  // Handle Enter key in chat input
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !loading) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // Clear error after 5 seconds
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [error])

  // Cleanup function for file upload
  useEffect(() => {
    return () => {
      if (file) {
        URL.revokeObjectURL(URL.createObjectURL(file))
      }
    }
  }, [file])

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0]
    if (uploadedFile) {
      if (uploadedFile.type !== 'application/pdf') {
        setError('Please upload a PDF file')
        return
      }
      if (uploadedFile.size > 10 * 1024 * 1024) {
        setError('File size should be less than 10MB')
        return
      }
      setFile(uploadedFile)
      setFileId(null)
      setSummary('')
      setMessages([])
      setHasProcessedFile(false)
      setError(null)
    }
  }, [])

  const handleSummarize = async () => {
    if (!file) return

    setLoading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/summarize', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to summarize document')
      }

      const data = await response.json()
      setSummary(data.summary)
      setFileId(data.fileId)
      setHasProcessedFile(true)
    } catch (error) {
      console.error('Error summarizing document:', error)
      setError(error instanceof Error ? error.message : 'Failed to summarize document')
    } finally {
      setLoading(false)
    }
  }

  const handleSendMessage = async () => {
    const trimmedMessage = currentMessage.trim()
    if (!trimmedMessage || !fileId || !hasProcessedFile) {
      setError('Please summarize the document first before chatting.')
      return
    }

    if (loading) {
      return
    }

    const newMessage: Message = { 
      role: 'user', 
      content: trimmedMessage,
      timestamp: Date.now()
    }
    setMessages(prev => [...prev, newMessage])
    setCurrentMessage('')
    setLoading(true)
    setError(null)

    try {
      // Get the last 4 messages (2 exchanges) for context
      const recentMessages = messages.slice(-4)
      const formattedHistory = []
      
      // Format messages into question-answer pairs
      for (let i = 0; i < recentMessages.length - 1; i += 2) {
        if (recentMessages[i].role === 'user' && recentMessages[i + 1]?.role === 'assistant') {
          formattedHistory.push({
            question: recentMessages[i].content,
            answer: recentMessages[i + 1].content
          })
        }
      }

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: trimmedMessage,
          fileId: fileId,
          chatHistory: formattedHistory
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to get chat response')
      }

      const data = await response.json()
      if (data.error) {
        throw new Error(data.error)
      }

      if (!data.response || typeof data.response !== 'string') {
        throw new Error('Invalid response format from server')
      }

      const assistantMessage: Message = { 
        role: 'assistant', 
        content: data.response.trim(),
        timestamp: Date.now()
      }
      setMessages(prev => [...prev, assistantMessage])
      setChatHistory(formattedHistory)
    } catch (error) {
      console.error('Error sending message:', error)
      setError(error instanceof Error ? error.message : 'Failed to send message')
      setMessages(prev => prev.slice(0, -1))
    } finally {
      setLoading(false)
    }
  }

  const handleModeChange = useCallback((newMode: Mode) => {
    if (newMode === 'chat' && !hasProcessedFile) {
      setError('Please summarize the document first before chatting.')
      return
    }
    setMode(newMode)
    setError(null)
  }, [hasProcessedFile])

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 py-8 px-4 transition-all duration-500">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12 animate-fadeIn">
          <h1 className="text-6xl font-bold mb-4 text-white drop-shadow-lg hover:scale-105 transition-transform duration-300">
            Document Summarizer
          </h1>
          <p className="text-xl text-white/90 font-light">
            Upload your document and get an AI-powered summary in seconds
          </p>
        </div>

        <div className="bg-white/95 backdrop-blur-lg rounded-3xl shadow-2xl p-8 transition-all duration-300 hover:shadow-3xl">
          {error && (
            <div className="alert alert-error mb-8 rounded-2xl shadow-lg animate-slideIn" role="alert">
              <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-medium">{error}</span>
            </div>
          )}

          <div className="flex flex-col items-center justify-center border-2 border-dashed border-purple-300 rounded-2xl p-10 mb-8 bg-gradient-to-b from-white to-purple-50 hover:from-purple-50 hover:to-white transition-all duration-300">
            <DocumentArrowUpIcon className="w-20 h-20 text-purple-500 mb-6 animate-bounce-slow" aria-hidden="true" />
            <label className="btn btn-primary btn-lg glass hover:scale-105 transition-all duration-300 bg-gradient-to-r from-indigo-500 to-purple-500 border-0 text-white shadow-lg hover:shadow-xl">
              Choose File
              <input
                type="file"
                className="hidden"
                accept=".pdf"
                onChange={handleFileUpload}
                aria-label="Upload PDF document"
              />
            </label>
            {file && (
              <div className="text-center mt-4 animate-fadeIn">
                <p className="text-gray-600">Selected file:</p>
                <p className="font-semibold text-lg text-purple-700">{file.name}</p>
              </div>
            )}
          </div>

          {file && (
            <>
              <div className="flex justify-center gap-6 mb-8" role="tablist" aria-label="Document actions">
                <button
                  id="summarize-tab"
                  className={`btn btn-lg gap-3 transition-all duration-300 ${
                    mode === 'summarize' 
                      ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg hover:shadow-xl scale-105' 
                      : 'bg-white text-gray-700 hover:bg-purple-50'
                  } ${loading && mode === 'summarize' ? 'loading' : ''}`}
                  onClick={() => {
                    handleModeChange('summarize')
                    if (mode === 'summarize' && !summary) {
                      handleSummarize()
                    }
                  }}
                  disabled={loading && mode === 'summarize'}
                  role="tab"
                  aria-controls="summarize-panel"
                  aria-selected="true"
                >
                  {loading && mode === 'summarize' ? (
                    'Summarizing...'
                  ) : (
                    <>
                      <DocumentTextIcon className="w-6 h-6" aria-hidden="true" />
                      Summarize
                    </>
                  )}
                </button>
                <button
                  id="chat-tab"
                  className={`btn btn-lg gap-3 transition-all duration-300 ${
                    mode === 'chat' 
                      ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg hover:shadow-xl scale-105' 
                      : 'bg-white text-gray-700 hover:bg-purple-50'
                  }`}
                  onClick={() => handleModeChange('chat')}
                  disabled={!hasProcessedFile}
                  role="tab"
                  aria-controls="chat-panel"
                  aria-selected="false"
                >
                  <ChatBubbleLeftRightIcon className="w-6 h-6" aria-hidden="true" />
                  Chat
                </button>
              </div>

              {mode === 'summarize' && summary && (
                <div id="summarize-panel" role="tabpanel" aria-labelledby="summarize-tab" className="animate-fadeIn">
                  <div className="mt-8">
                    <div className="flex items-center gap-3 mb-4">
                      <DocumentTextIcon className="w-8 h-8 text-purple-500" aria-hidden="true" />
                      <h2 className="text-2xl font-bold text-gray-800">Summary</h2>
                    </div>
                    <div className="bg-white rounded-2xl p-8 shadow-inner border border-purple-100">
                      <p className="whitespace-pre-wrap text-lg leading-relaxed text-gray-700">{summary}</p>
                    </div>
                  </div>
                </div>
              )}

              {mode === 'chat' && hasProcessedFile && (
                <div id="chat-panel" role="tabpanel" aria-labelledby="chat-tab" className="animate-fadeIn">
                  <div className="mt-8">
                    <div className="flex items-center gap-3 mb-4">
                      <ChatBubbleLeftRightIcon className="w-8 h-8 text-purple-500" aria-hidden="true" />
                      <h2 className="text-2xl font-bold text-gray-800">Chat with Document</h2>
                    </div>
                    <div 
                      ref={chatContainerRef}
                      className="bg-gradient-to-br from-white to-purple-50 rounded-2xl p-6 mb-4 h-[400px] overflow-y-auto scroll-smooth shadow-inner border border-purple-100"
                      aria-live="polite"
                      aria-atomic="true"
                      role="log"
                    >
                      {messages.length === 0 && (
                        <div className="text-center text-gray-500 mt-8">
                          <p>No messages yet. Start chatting about your document!</p>
                        </div>
                      )}
                      {messages.map((message) => (
                        <div
                          key={message.timestamp}
                          className={`chat ${message.role === 'user' ? 'chat-end' : 'chat-start'} mb-4`}
                        >
                          <div className="chat-header mb-1 text-xs opacity-70">
                            {message.role === 'user' ? 'You' : 'AI Assistant'}
                          </div>
                          <div 
                            className={`chat-bubble max-w-[80%] ${
                              message.role === 'user' 
                                ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg' 
                                : 'bg-white text-gray-700 shadow border border-purple-100'
                            }`}
                            role="article"
                            aria-label={`${message.role === 'user' ? 'Your message' : 'Assistant response'}`}
                          >
                            {message.content}
                          </div>
                          <div className="chat-footer mt-1 text-xs opacity-70">
                            {new Date(message.timestamp).toLocaleTimeString()}
                          </div>
                        </div>
                      ))}
                      {loading && (
                        <div className="chat chat-start">
                          <div className="chat-header mb-1 text-xs opacity-70">
                            AI Assistant
                          </div>
                          <div className="chat-bubble bg-white text-gray-700 shadow border border-purple-100">
                            <span className="loading loading-dots loading-md" aria-label="Assistant is typing"></span>
                          </div>
                        </div>
                      )}
                    </div>
                    <form 
                      className="flex gap-3" 
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (!loading) handleSendMessage()
                      }}
                    >
                      <input
                        ref={inputRef}
                        type="text"
                        placeholder="Ask a question about your document..."
                        className="input input-bordered input-lg flex-1 bg-white shadow-sm hover:shadow-md focus:shadow-lg transition-all duration-300 border-purple-100 focus:border-purple-300 placeholder-gray-400"
                        value={currentMessage}
                        onChange={(e) => setCurrentMessage(e.target.value)}
                        onKeyDown={handleKeyPress}
                        disabled={loading}
                        aria-label="Chat message input"
                      />
                      <button
                        type="submit"
                        className="btn btn-lg bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0 shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={loading || !currentMessage.trim()}
                        aria-label="Send message"
                      >
                        Send
                      </button>
                    </form>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default App 