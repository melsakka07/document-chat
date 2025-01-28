import { useState, useCallback, useRef, useEffect } from 'react'
import { DocumentArrowUpIcon, DocumentTextIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'

type Mode = 'summarize' | 'chat'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
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
    if (!currentMessage.trim() || !fileId || !hasProcessedFile) {
      setError('Please summarize the document first before chatting.')
      return
    }

    const newMessage: Message = { 
      role: 'user', 
      content: currentMessage,
      timestamp: Date.now()
    }
    setMessages(prev => [...prev, newMessage])
    setCurrentMessage('')
    setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: currentMessage,
          fileId: fileId,
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

      const assistantMessage: Message = { 
        role: 'assistant', 
        content: data.response,
        timestamp: Date.now()
      }
      setMessages(prev => [...prev, assistantMessage])
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
    <div className="min-h-screen bg-gradient-to-b from-base-200 to-base-300 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-primary mb-4 bg-clip-text text-transparent bg-gradient-to-r from-primary to-secondary">
            Document Summarizer
          </h1>
          <p className="text-xl text-base-content/80">
            Upload your document and get an AI-powered summary in seconds
          </p>
        </div>

        <div className="bg-base-100 rounded-2xl shadow-2xl p-8">
          {error && (
            <div className="alert alert-error mb-8" role="alert">
              <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col items-center justify-center border-2 border-dashed border-base-300 rounded-xl p-10 mb-8 bg-base-200/50 hover:bg-base-200 transition-colors duration-200">
            <DocumentArrowUpIcon className="w-16 h-16 text-primary mb-6" aria-hidden="true" />
            <label className="btn btn-primary btn-lg glass mb-4 hover:scale-105 transition-transform duration-200">
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
              <div className="text-center animate-fadeIn">
                <p className="text-base-content/80">Selected file:</p>
                <p className="font-semibold text-lg">{file.name}</p>
              </div>
            )}
          </div>

          {file && (
            <>
              <div className="flex justify-center gap-6 mb-8" role="tablist" aria-label="Document actions">
                <button
                  id="summarize-tab"
                  className={`btn btn-lg gap-3 transition-all duration-200 ${
                    mode === 'summarize' 
                      ? 'btn-primary shadow-lg hover:shadow-primary/50' 
                      : 'btn-ghost hover:btn-primary/20'
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
                  data-state={mode === 'summarize' ? 'active' : 'inactive'}
                  tabIndex={mode === 'summarize' ? 0 : -1}
                  type="button"
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
                  className={`btn btn-lg gap-3 transition-all duration-200 ${
                    mode === 'chat' 
                      ? 'btn-primary shadow-lg hover:shadow-primary/50' 
                      : 'btn-ghost hover:btn-primary/20'
                  }`}
                  onClick={() => handleModeChange('chat')}
                  disabled={!hasProcessedFile}
                  role="tab"
                  aria-controls="chat-panel"
                  aria-selected="false"
                  data-state={mode === 'chat' ? 'active' : 'inactive'}
                  tabIndex={mode === 'chat' ? 0 : -1}
                  type="button"
                >
                  <ChatBubbleLeftRightIcon className="w-6 h-6" aria-hidden="true" />
                  Chat
                </button>
              </div>

              {mode === 'summarize' && summary && (
                <div id="summarize-panel" role="tabpanel" aria-labelledby="summarize-tab">
                  <div className="mt-8 animate-fadeIn">
                    <div className="flex items-center gap-3 mb-4">
                      <DocumentTextIcon className="w-8 h-8 text-primary" aria-hidden="true" />
                      <h2 className="text-2xl font-bold">Summary</h2>
                    </div>
                    <div className="bg-base-200 rounded-xl p-8 shadow-inner">
                      <p className="whitespace-pre-wrap text-lg leading-relaxed">{summary}</p>
                    </div>
                  </div>
                </div>
              )}

              {mode === 'chat' && hasProcessedFile && (
                <div id="chat-panel" role="tabpanel" aria-labelledby="chat-tab">
                  <div className="mt-8">
                    <div className="flex items-center gap-3 mb-4">
                      <ChatBubbleLeftRightIcon className="w-8 h-8 text-primary" aria-hidden="true" />
                      <h2 className="text-2xl font-bold">Chat with Document</h2>
                    </div>
                    <div 
                      ref={chatContainerRef}
                      className="bg-base-200 rounded-xl p-6 mb-4 h-[400px] overflow-y-auto scroll-smooth shadow-inner"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {messages.map((message) => (
                        <div
                          key={message.timestamp}
                          className={`chat ${message.role === 'user' ? 'chat-end' : 'chat-start'} mb-4`}
                        >
                          <div 
                            className={`chat-bubble ${
                              message.role === 'user' 
                                ? 'chat-bubble-primary shadow-lg' 
                                : 'bg-base-300 shadow'
                            }`}
                            aria-label={message.role === 'assistant' ? 'Assistant response' : 'Your message'}
                          >
                            {message.content}
                          </div>
                        </div>
                      ))}
                      {loading && (
                        <div className="chat chat-start">
                          <div className="chat-bubble bg-base-300">
                            <span className="loading loading-dots" aria-hidden="true"></span>
                            <span className="sr-only">Loading response...</span>
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
                        className="input input-bordered input-lg flex-1 shadow-sm focus:shadow-lg transition-shadow duration-200"
                        value={currentMessage}
                        onChange={(e) => setCurrentMessage(e.target.value)}
                        disabled={loading}
                        aria-label="Chat message input"
                      />
                      <button
                        type="submit"
                        className="btn btn-primary btn-lg glass hover:scale-105 transition-transform duration-200"
                        disabled={loading}
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