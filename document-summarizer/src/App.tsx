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

// Enhanced error handling with types
type ErrorType = {
  message: string
  type: 'error' | 'warning' | 'info'
  id: string
}

// Custom hook for managing errors
const useErrorHandler = () => {
  const [errors, setErrors] = useState<ErrorType[]>([])
  
  const addError = useCallback((message: string, type: ErrorType['type'] = 'error') => {
    const newError = {
      message,
      type,
      id: generateId()
    }
    setErrors(prev => [...prev, newError])
    
    // Auto-remove error after 5 seconds
    setTimeout(() => {
      setErrors(prev => prev.filter(e => e.id !== newError.id))
    }, 5000)
  }, [])
  
  return { errors, addError }
}

function App() {
  // Use custom error handler
  const { errors, addError } = useErrorHandler()
  
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
  const [isUploading, setIsUploading] = useState(false)
  
  // Refs with types
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Cleanup file URLs
      if (file) {
        URL.revokeObjectURL(URL.createObjectURL(file))
      }
      // Abort any pending requests
      if (abortControllerRef.current) {
        abortControllerRef.current.abort()
      }
      // Reset states
      setLoading(false)
      setIsUploading(false)
    }
  }, [file])

  // Handle file upload with better error handling
  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0]
    if (!uploadedFile) return

    try {
      setIsUploading(true)

      // Validate file type
      if (uploadedFile.type !== 'application/pdf') {
        throw new Error('Please upload a PDF file')
      }

      // Validate file size (10MB)
      if (uploadedFile.size > 10 * 1024 * 1024) {
        throw new Error('File size should be less than 10MB')
      }

      // Validate file name
      if (uploadedFile.name.length > 255) {
        throw new Error('File name is too long')
      }

      // Reset states
      setFile(uploadedFile)
      setFileId(null)
      setSummary('')
      setMessages([])
      setHasProcessedFile(false)
      
      // Clear file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }

      addError('File uploaded successfully!', 'info')
    } catch (error) {
      console.error('Error uploading file:', error)
      addError(error instanceof Error ? error.message : 'Failed to upload file')
      setFile(null)
    } finally {
      setIsUploading(false)
    }
  }, [setMessages, addError])

  const handleSummarize = async () => {
    if (!file) {
      addError('Please upload a file first')
      return
    }

    setLoading(true)

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
      addError(error instanceof Error ? error.message : 'Failed to summarize document')
      setHasProcessedFile(false)
    } finally {
      setLoading(false)
    }
  }

  // Handle message sending with better error handling
  const handleSendMessage = async () => {
    const trimmedMessage = currentMessage.trim()
    if (!trimmedMessage || !fileId || !hasProcessedFile) {
      addError('Please summarize the document first before chatting.')
      return
    }

    if (loading) return

    // Create new abort controller
    abortControllerRef.current = new AbortController()

    const newMessage: Message = { 
      role: 'user', 
      content: trimmedMessage,
      timestamp: Date.now(),
      id: generateId()
    }

    try {
      setMessages(prev => [...prev, newMessage])
      setCurrentMessage('')
      setLoading(true)

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: trimmedMessage,
          fileId: fileId,
          chatHistory: messages
            .slice(-4)
            .reduce<ChatHistory[]>((acc, msg, i, arr) => {
              if (i % 2 === 0 && arr[i + 1]) {
                acc.push({
                  question: msg.content,
                  answer: arr[i + 1].content,
                  timestamp: msg.timestamp
                })
              }
              return acc
            }, [])
        }),
        signal: abortControllerRef.current.signal
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to get chat response')
      }

      const data = await response.json()
      
      if (!data.response || typeof data.response !== 'string') {
        throw new Error('Invalid response format from server')
      }

      const assistantMessage: Message = { 
        role: 'assistant', 
        content: data.response.trim(),
        timestamp: data.timestamp || Date.now(),
        id: generateId()
      }
      
      setMessages(prev => [...prev, assistantMessage])
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        addError('Request cancelled', 'info')
      } else {
        console.error('Error sending message:', error)
        addError(error instanceof Error ? error.message : 'Failed to send message')
        setMessages(prev => prev.slice(0, -1))
      }
    } finally {
      setLoading(false)
      abortControllerRef.current = null
    }
  }

  const handleModeChange = useCallback((newMode: Mode) => {
    if (newMode === 'chat' && !hasProcessedFile) {
      addError('Please summarize the document first before chatting.')
      return
    }
    setMode(newMode)
  }, [hasProcessedFile, addError])

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 py-8 px-4 sm:px-6 lg:px-8 transition-all duration-500">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12 animate-fadeIn">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold mb-4 text-white drop-shadow-lg hover:scale-105 transition-transform duration-300 bg-clip-text">
            Document Summarizer
          </h1>
          <p className="text-lg sm:text-xl text-white/90 font-light max-w-2xl mx-auto">
            Upload your document and get an AI-powered summary in seconds
          </p>
        </div>

        <div className="bg-white/95 backdrop-blur-lg rounded-3xl shadow-2xl p-4 sm:p-6 lg:p-8 transition-all duration-300 hover:shadow-3xl">
          <div className="space-y-4">
            {errors.map((error) => (
              <div 
                key={error.id} 
                className={`alert ${
                  error.type === 'error' ? 'alert-error' :
                  error.type === 'warning' ? 'alert-warning' :
                  'alert-info'
                } mb-4 rounded-2xl shadow-lg animate-slideIn`} 
                role="alert"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-medium">{error.message}</span>
              </div>
            ))}

            <div className="flex flex-col items-center justify-center border-2 border-dashed border-purple-300 rounded-2xl p-6 sm:p-8 lg:p-10 bg-gradient-to-b from-white to-purple-50 hover:from-purple-50 hover:to-white transition-all duration-300">
              <DocumentArrowUpIcon 
                className={`w-16 h-16 sm:w-20 sm:h-20 text-purple-500 mb-6 ${
                  isUploading ? 'animate-spin' : 'animate-bounce-slow'
                }`} 
                aria-hidden="true" 
              />
              <label 
                className={`btn btn-lg glass transition-all duration-300 bg-gradient-to-r from-indigo-500 to-purple-500 border-0 text-white shadow-lg group
                  ${isUploading ? 'opacity-50 cursor-not-allowed' : 'hover:scale-105 hover:shadow-xl'}`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    fileInputRef.current?.click()
                  }
                }}
              >
                <span className="relative z-10 flex items-center gap-2">
                  {isUploading ? (
                    <>
                      <span className="loading loading-spinner loading-sm"></span>
                      Uploading...
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                      Choose File
                    </>
                  )}
                </span>
                <div className="absolute inset-0 bg-gradient-to-r from-purple-400 to-pink-400 opacity-0 group-hover:opacity-20 transition-opacity duration-300"></div>
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
                    className="btn btn-sm btn-ghost text-red-500 mt-2 hover:bg-red-50 transition-colors duration-200"
                    aria-label="Remove selected file"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    Remove File
                  </button>
                </div>
              )}
            </div>

            {/* Progress Steps */}
            <div className="py-4 px-2 overflow-x-auto">
              <div className="flex justify-center min-w-[300px]" aria-label="Document processing progress">
                <ul className="steps steps-horizontal w-full max-w-2xl">
                  <li className={`step ${file ? 'step-primary' : ''} transition-colors duration-300`}>
                    <span className="text-sm sm:text-base">Upload</span>
                  </li>
                  <li className={`step ${hasProcessedFile ? 'step-primary' : ''} transition-colors duration-300`}>
                    <span className="text-sm sm:text-base">Process</span>
                  </li>
                  <li className={`step ${mode === 'chat' && hasProcessedFile ? 'step-primary' : ''} transition-colors duration-300`}>
                    <span className="text-sm sm:text-base">Chat</span>
                  </li>
                </ul>
              </div>
            </div>

            {file && (
              <div className="space-y-6">
                <div className="flex flex-wrap justify-center gap-4" role="tablist" aria-label="Document actions">
                  <button
                    id="summarize-tab"
                    className={`btn btn-lg gap-3 transition-all duration-300 flex-1 sm:flex-none min-w-[160px] ${
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
                    className={`btn btn-lg gap-3 transition-all duration-300 flex-1 sm:flex-none min-w-[160px] ${
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
                      <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-inner border border-purple-100">
                        <p className="whitespace-pre-wrap text-base sm:text-lg leading-relaxed text-gray-700">{summary}</p>
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
                        className="bg-gradient-to-br from-white to-purple-50 rounded-2xl p-4 sm:p-6 mb-4 h-[400px] sm:h-[500px] overflow-y-auto scroll-smooth shadow-inner border border-purple-100"
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
                            className={`chat ${message.role === 'user' ? 'chat-end' : 'chat-start'} mb-4 animate-fadeIn`}
                            role="article"
                            aria-label={`${message.role === 'user' ? 'Your message' : 'Assistant response'}`}
                          >
                            <div className="chat-header mb-1 text-xs opacity-70">
                              <span className="font-medium">
                                {message.role === 'user' ? 'You' : 'AI Assistant'}
                              </span>
                              <time 
                                dateTime={new Date(message.timestamp).toISOString()}
                                className="ml-2"
                                aria-label="Message time"
                              >
                                {new Date(message.timestamp).toLocaleTimeString()}
                              </time>
                            </div>
                            <div 
                              className={`chat-bubble max-w-[85%] sm:max-w-[75%] ${
                                message.role === 'user' 
                                  ? 'bg-gradient-to-r from-indigo-500 to-purple-500 text-white shadow-lg' 
                                  : 'bg-white text-gray-700 shadow border border-purple-100'
                              }`}
                            >
                              {message.content}
                            </div>
                          </div>
                        ))}
                        {loading && (
                          <div className="chat chat-start animate-fadeIn" role="status">
                            <div className="chat-header mb-1 text-xs opacity-70">
                              <span className="font-medium">AI Assistant</span>
                            </div>
                            <div className="chat-bubble bg-white text-gray-700 shadow border border-purple-100">
                              <span className="loading loading-dots loading-md" aria-label="Assistant is typing"></span>
                            </div>
                          </div>
                        )}
                      </div>
                      <form 
                        className="flex flex-col sm:flex-row gap-3 sticky bottom-0 bg-white/95 backdrop-blur-sm p-2 rounded-xl" 
                        onSubmit={(e) => {
                          e.preventDefault()
                          if (!loading) handleSendMessage()
                        }}
                        aria-label="Chat message form"
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
                          maxLength={500}
                          required
                        />
                        <button
                          type="submit"
                          className={`btn btn-lg sm:min-w-[120px] bg-gradient-to-r from-indigo-600 to-purple-600 text-white border-0 shadow-xl hover:shadow-2xl hover:scale-105 transition-all duration-300 group relative overflow-hidden
                            ${loading ? 'opacity-70 cursor-wait' : 'hover:from-indigo-500 hover:to-purple-500'}
                            ${!currentMessage.trim() ? 'opacity-50 cursor-not-allowed' : ''}
                          `}
                          disabled={loading || !currentMessage.trim()}
                          aria-label={loading ? 'Sending message...' : 'Send message'}
                        >
                          <span className="relative z-10 flex items-center gap-2 px-2">
                            {loading ? (
                              <>
                                <span className="loading loading-spinner loading-sm" aria-hidden="true"></span>
                                <span>Sending...</span>
                              </>
                            ) : (
                              <>
                                <span>Send</span>
                                <svg 
                                  xmlns="http://www.w3.org/2000/svg" 
                                  viewBox="0 0 24 24" 
                                  fill="currentColor" 
                                  className="w-5 h-5 transform group-hover:translate-x-1 transition-transform"
                                  aria-hidden="true"
                                >
                                  <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
                                </svg>
                              </>
                            )}
                          </span>
                          <div 
                            className="absolute inset-0 bg-gradient-to-r from-purple-400 to-pink-400 opacity-0 group-hover:opacity-20 transition-opacity duration-300"
                            aria-hidden="true"
                          ></div>
                        </button>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default App 