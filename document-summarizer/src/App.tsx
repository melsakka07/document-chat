import { useState, useCallback, useRef, useEffect } from 'react'
import { DocumentArrowUpIcon, DocumentTextIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'

type Mode = 'summarize' | 'chat'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  id: string // Add unique ID for better React key management
}

interface ChatHistory {
  question: string
  answer: string
  timestamp: number
}

// Utility function to generate unique IDs
const generateId = () => Math.random().toString(36).substr(2, 9)

// Custom hook for managing local storage
const useLocalStorage = <T,>(key: string, initialValue: T) => {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key)
      return item ? JSON.parse(item) : initialValue
    } catch (error) {
      console.error('Error reading from localStorage:', error)
      return initialValue
    }
  })

  const setValue = (value: T | ((val: T) => T)) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value
      setStoredValue(valueToStore)
      window.localStorage.setItem(key, JSON.stringify(valueToStore))
    } catch (error) {
      console.error('Error saving to localStorage:', error)
    }
  }

  return [storedValue, setValue] as const
}

function App() {
  // Use local storage for persistent state
  const [messages, setMessages] = useLocalStorage<Message[]>('chat-messages', [])
  const [chatHistory, setChatHistory] = useLocalStorage<ChatHistory[]>('chat-history', [])
  
  // Regular state
  const [file, setFile] = useState<File | null>(null)
  const [fileId, setFileId] = useState<string | null>(null)
  const [summary, setSummary] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<Mode>('summarize')
  const [currentMessage, setCurrentMessage] = useState('')
  const [hasProcessedFile, setHasProcessedFile] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  
  // Refs
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  // Reset state when component unmounts
  useEffect(() => {
    return () => {
      if (file) {
        URL.revokeObjectURL(URL.createObjectURL(file))
      }
      setLoading(false)
      setIsUploading(false)
    }
  }, [])

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0]
    if (!uploadedFile) return

    try {
      setIsUploading(true)
      setError(null)

      // Validate file type
      if (uploadedFile.type !== 'application/pdf') {
        throw new Error('Please upload a PDF file')
      }

      // Validate file size (10MB limit)
      if (uploadedFile.size > 10 * 1024 * 1024) {
        throw new Error('File size should be less than 10MB')
      }

      // Validate file name length
      if (uploadedFile.name.length > 255) {
        throw new Error('File name is too long')
      }

      // Reset states
      setFile(uploadedFile)
      setFileId(null)
      setSummary('')
      setMessages([])
      setHasProcessedFile(false)
      
      // Clear file input for reupload of same file
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } catch (error) {
      console.error('Error uploading file:', error)
      setError(error instanceof Error ? error.message : 'Failed to upload file')
      setFile(null)
    } finally {
      setIsUploading(false)
    }
  }, [setMessages])

  const handleSummarize = async () => {
    if (!file) {
      setError('Please upload a file first')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/summarize', {
        method: 'POST',
        body: formData,
      })

      const contentType = response.headers.get('content-type')
      if (!contentType?.includes('application/json')) {
        throw new Error('Invalid response format from server')
      }

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to summarize document')
      }

      const data = await response.json()
      
      if (!data.summary || typeof data.summary !== 'string' || !data.fileId) {
        throw new Error('Invalid response data from server')
      }

      setSummary(data.summary)
      setFileId(data.fileId)
      setHasProcessedFile(true)
    } catch (error) {
      console.error('Error summarizing document:', error)
      setError(error instanceof Error ? error.message : 'Failed to summarize document')
      setHasProcessedFile(false)
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
      timestamp: Date.now(),
      id: generateId()
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
            answer: recentMessages[i + 1].content,
            timestamp: recentMessages[i].timestamp
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
        timestamp: Date.now(),
        id: generateId()
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
            <DocumentArrowUpIcon 
              className={`w-20 h-20 text-purple-500 mb-6 ${isUploading ? 'animate-spin' : 'animate-bounce-slow'}`} 
              aria-hidden="true" 
            />
            <label 
              className={`btn btn-lg glass transition-all duration-300 bg-gradient-to-r from-indigo-500 to-purple-500 border-0 text-white shadow-lg 
                ${isUploading ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 hover:shadow-xl'}`}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  fileInputRef.current?.click()
                }
              }}
            >
              {isUploading ? 'Uploading...' : 'Choose File'}
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf"
                onChange={handleFileUpload}
                disabled={isUploading}
                aria-label="Upload PDF document"
              />
            </label>
            {file && (
              <div className="text-center mt-4 animate-fadeIn">
                <p className="text-gray-600">Selected file:</p>
                <p className="font-semibold text-lg text-purple-700 break-all max-w-md">{file.name}</p>
                <button
                  onClick={() => {
                    setFile(null)
                    setFileId(null)
                    setSummary('')
                    setMessages([])
                    setHasProcessedFile(false)
                    if (fileInputRef.current) {
                      fileInputRef.current.value = ''
                    }
                  }}
                  className="btn btn-sm btn-ghost text-red-500 mt-2 hover:bg-red-50"
                  aria-label="Remove selected file"
                >
                  Remove File
                </button>
              </div>
            )}
          </div>

          {/* Progress indicator */}
          <div className="flex justify-center mb-8" aria-label="Document processing progress">
            <ul className="steps">
              <li className={`step ${file ? 'step-primary' : ''}`}>Upload File</li>
              <li className={`step ${hasProcessedFile ? 'step-primary' : ''}`}>Process Document</li>
              <li className={`step ${mode === 'chat' && hasProcessedFile ? 'step-primary' : ''}`}>Chat</li>
            </ul>
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
                  title={!hasProcessedFile ? 'Click to process document' : 'View summary'}
                >
                  <span className="sr-only">{mode === 'summarize' ? 'Current tab:' : ''}</span>
                  {loading && mode === 'summarize' ? (
                    <span aria-live="polite">Processing...</span>
                  ) : (
                    <>
                      <DocumentTextIcon className="w-6 h-6" aria-hidden="true" />
                      <span>{!hasProcessedFile ? 'Process Document' : 'View Summary'}</span>
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
                  title={!hasProcessedFile ? 'Process document first' : 'Chat with document'}
                >
                  <span className="sr-only">{mode === 'chat' ? 'Current tab:' : ''}</span>
                  <ChatBubbleLeftRightIcon className="w-6 h-6" aria-hidden="true" />
                  <span>Chat</span>
                  {!hasProcessedFile && <span className="sr-only">(Process document first)</span>}
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
                <div 
                  id="chat-panel" 
                  role="tabpanel" 
                  aria-labelledby="chat-tab" 
                  className="animate-fadeIn"
                >
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
                      aria-label="Chat messages"
                    >
                      {messages.length === 0 && (
                        <div className="text-center text-gray-500 mt-8" role="status">
                          <p>No messages yet. Start chatting about your document!</p>
                        </div>
                      )}
                      {messages.map((message) => (
                        <div
                          key={message.id}
                          className={`chat ${message.role === 'user' ? 'chat-end' : 'chat-start'} mb-4`}
                          role="article"
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
                          >
                            {message.content}
                          </div>
                          <div className="chat-footer mt-1 text-xs opacity-70">
                            <time dateTime={new Date(message.timestamp).toISOString()}>
                              {new Date(message.timestamp).toLocaleTimeString()}
                            </time>
                          </div>
                        </div>
                      ))}
                      {loading && (
                        <div className="chat chat-start" role="status">
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
                      className="flex gap-3 sticky bottom-0 bg-white/95 backdrop-blur-sm p-2 rounded-xl" 
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
                        className={`btn btn-lg min-w-[120px] bg-gradient-to-r from-indigo-600 to-purple-600 text-white border-0 shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-300 group relative overflow-hidden
                          ${loading ? 'opacity-70 cursor-wait' : 'hover:from-indigo-500 hover:to-purple-500'}
                          ${!currentMessage.trim() ? 'opacity-50 cursor-not-allowed' : ''}
                        `}
                        disabled={loading || !currentMessage.trim()}
                        aria-label="Send message"
                      >
                        <span className="relative z-10 flex items-center gap-2 px-2">
                          {loading ? (
                            <>
                              <span className="loading loading-spinner loading-sm"></span>
                              Sending...
                            </>
                          ) : (
                            <>
                              Send
                              <svg 
                                xmlns="http://www.w3.org/2000/svg" 
                                viewBox="0 0 24 24" 
                                fill="currentColor" 
                                className="w-5 h-5 transform group-hover:translate-x-1 transition-transform"
                              >
                                <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
                              </svg>
                            </>
                          )}
                        </span>
                        <div className="absolute inset-0 bg-gradient-to-r from-purple-400 to-pink-400 opacity-0 group-hover:opacity-20 transition-opacity duration-300"></div>
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