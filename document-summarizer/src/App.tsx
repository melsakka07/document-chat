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
    <div className="min-h-screen bg-base-200 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-primary mb-2">Document Summarizer</h1>
          <p className="text-lg text-base-content/80">
            Upload your document and get an AI-powered summary in seconds
          </p>
        </div>

        <div className="bg-base-100 rounded-box shadow-lg p-6">
          {error && (
            <div className="alert alert-error mb-6" role="alert">
              <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col items-center justify-center border-2 border-dashed border-base-300 rounded-lg p-8 mb-6">
            <DocumentArrowUpIcon className="w-12 h-12 text-primary mb-4" aria-hidden="true" />
            <label className="btn btn-primary mb-4">
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
              <div className="text-center">
                <p className="text-base-content/80">Selected file:</p>
                <p className="font-semibold">{file.name}</p>
              </div>
            )}
          </div>

          {file && (
            <>
              <div className="flex justify-center gap-4 mb-6" role="tablist" aria-label="Document actions">
                <button
                  id="summarize-tab"
                  className={`btn btn-outline ${mode === 'summarize' ? 'btn-primary' : ''}`}
                  onClick={() => handleModeChange('summarize')}
                  role="tab"
                  aria-controls="summarize-panel"
                  aria-selected="true"
                  tabIndex={mode === 'summarize' ? 0 : -1}
                  type="button"
                >
                  <DocumentTextIcon className="w-5 h-5 mr-2" aria-hidden="true" />
                  Summarize
                </button>
                <button
                  id="chat-tab"
                  className={`btn btn-outline ${mode === 'chat' ? 'btn-primary' : ''}`}
                  onClick={() => handleModeChange('chat')}
                  disabled={!hasProcessedFile}
                  role="tab"
                  aria-controls="chat-panel"
                  aria-selected="false"
                  tabIndex={mode === 'chat' ? 0 : -1}
                  type="button"
                >
                  <ChatBubbleLeftRightIcon className="w-5 h-5 mr-2" aria-hidden="true" />
                  Chat
                </button>
              </div>

              {mode === 'summarize' && (
                <div id="summarize-panel" role="tabpanel" aria-labelledby="summarize-tab">
                  <div className="flex justify-center">
                    <button
                      className={`btn btn-primary btn-lg ${loading ? 'btn-disabled' : ''}`}
                      onClick={handleSummarize}
                      disabled={loading}
                      type="button"
                    >
                      {loading ? (
                        <>
                          <span className="loading loading-spinner" aria-hidden="true"></span>
                          <span>Summarizing...</span>
                        </>
                      ) : (
                        'Summarize Document'
                      )}
                    </button>
                  </div>

                  {summary && (
                    <div className="mt-8">
                      <div className="flex items-center gap-2 mb-4">
                        <DocumentTextIcon className="w-6 h-6 text-primary" aria-hidden="true" />
                        <h2 className="text-xl font-semibold">Summary</h2>
                      </div>
                      <div className="bg-base-200 rounded-lg p-6">
                        <p className="whitespace-pre-wrap">{summary}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {mode === 'chat' && hasProcessedFile && (
                <div id="chat-panel" role="tabpanel" aria-labelledby="chat-tab">
                  <div className="mt-8">
                    <div className="flex items-center gap-2 mb-4">
                      <ChatBubbleLeftRightIcon className="w-6 h-6 text-primary" aria-hidden="true" />
                      <h2 className="text-xl font-semibold">Chat with Document</h2>
                    </div>
                    <div 
                      ref={chatContainerRef}
                      className="bg-base-200 rounded-lg p-6 mb-4 h-[400px] overflow-y-auto scroll-smooth"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {messages.map((message) => (
                        <div
                          key={message.timestamp}
                          className={`chat ${message.role === 'user' ? 'chat-end' : 'chat-start'} mb-4`}
                        >
                          <div 
                            className={`chat-bubble ${message.role === 'user' ? 'chat-bubble-primary' : ''}`}
                            aria-label={message.role === 'assistant' ? 'Assistant response' : 'Your message'}
                          >
                            {message.content}
                          </div>
                        </div>
                      ))}
                      {loading && (
                        <div className="chat chat-start">
                          <div className="chat-bubble">
                            <span className="loading loading-dots" aria-hidden="true"></span>
                            <span className="sr-only">Loading response...</span>
                          </div>
                        </div>
                      )}
                    </div>
                    <form 
                      className="flex gap-2" 
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (!loading) handleSendMessage()
                      }}
                    >
                      <input
                        ref={inputRef}
                        type="text"
                        placeholder="Ask a question about your document..."
                        className="input input-bordered flex-1"
                        value={currentMessage}
                        onChange={(e) => setCurrentMessage(e.target.value)}
                        disabled={loading}
                        aria-label="Chat message input"
                      />
                      <button
                        type="submit"
                        className={`btn btn-primary ${loading ? 'btn-disabled' : ''}`}
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