import { useState } from 'react'
import { DocumentArrowUpIcon, DocumentTextIcon } from '@heroicons/react/24/outline'

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [summary, setSummary] = useState<string>('')
  const [loading, setLoading] = useState(false)

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0]
    if (uploadedFile) {
      setFile(uploadedFile)
      setSummary('')
    }
  }

  const handleSummarize = async () => {
    if (!file) return

    setLoading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      // TODO: Replace with your actual API endpoint
      const response = await fetch('/api/summarize', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()
      setSummary(data.summary)
    } catch (error) {
      console.error('Error summarizing document:', error)
      alert('Error summarizing document. Please try again.')
    } finally {
      setLoading(false)
    }
  }

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
          <div className="flex flex-col items-center justify-center border-2 border-dashed border-base-300 rounded-lg p-8 mb-6">
            <DocumentArrowUpIcon className="w-12 h-12 text-primary mb-4" />
            <label className="btn btn-primary mb-4">
              Choose File
              <input
                type="file"
                className="hidden"
                accept=".pdf,.txt,.doc,.docx"
                onChange={handleFileUpload}
              />
            </label>
            {file && (
              <div className="text-center">
                <p className="text-base-content/80">Selected file:</p>
                <p className="font-semibold">{file.name}</p>
              </div>
            )}
          </div>

          <div className="flex justify-center">
            <button
              className={`btn btn-primary btn-lg ${!file || loading ? 'btn-disabled' : ''}`}
              onClick={handleSummarize}
            >
              {loading ? (
                <>
                  <span className="loading loading-spinner"></span>
                  Summarizing...
                </>
              ) : (
                'Summarize Document'
              )}
            </button>
          </div>

          {summary && (
            <div className="mt-8">
              <div className="flex items-center gap-2 mb-4">
                <DocumentTextIcon className="w-6 h-6 text-primary" />
                <h2 className="text-xl font-semibold">Summary</h2>
              </div>
              <div className="bg-base-200 rounded-lg p-6">
                <p className="whitespace-pre-wrap">{summary}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App 