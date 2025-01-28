import express from 'express'
import multer from 'multer'
import { OpenAI } from '@langchain/openai'
import { PDFLoader } from 'langchain/document_loaders/fs/pdf'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'
import { OpenAIEmbeddings } from '@langchain/openai'
import { loadQAStuffChain } from 'langchain/chains'
import { RunnableSequence } from '@langchain/core/runnables'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts'
import * as dotenv from 'dotenv'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'

dotenv.config()

// Validate environment variables
if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is required')
}

// Type definitions with validation
interface ChatRequest {
  message: string
  fileId: string
  chatHistory: Array<{
    question: string
    answer: string
    timestamp?: number
  }>
}

// Security middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
})

// Configure multer with better security
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads')
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    const sanitizedFilename = file.originalname.replace(/[^a-zA-Z0-9]/g, '_')
    cb(null, `file-${uniqueSuffix}-${sanitizedFilename}`)
  }
})

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    // Validate file type
    if (file.mimetype !== 'application/pdf') {
      cb(new Error('Only PDF files are allowed'))
      return
    }
    cb(null, true)
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 1 // Only allow 1 file per request
  }
})

const app = express()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Enhanced security middleware
app.use(helmet())
app.use(limiter)
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? process.env.ALLOWED_ORIGIN : '*'
}))
app.use(express.json({ limit: '1mb' }))
app.use(express.static(path.join(__dirname, 'dist')))

// Initialize OpenAI with error handling
const model = new OpenAI({
  modelName: 'gpt-3.5-turbo',
  temperature: 0.7,
  openAIApiKey: process.env.OPENAI_API_KEY,
  maxRetries: 3,
  timeout: 30000
})

// Store vector stores in memory with automatic cleanup
const vectorStores = new Map<string, { 
  store: MemoryVectorStore
  timestamp: number
  filename: string
}>()

// Enhanced cleanup function
const cleanupOldFiles = () => {
  const oneHourAgo = Date.now() - 3600000
  for (const [fileId, { timestamp, filename }] of vectorStores.entries()) {
    if (timestamp < oneHourAgo) {
      vectorStores.delete(fileId)
      const filePath = path.join(__dirname, 'uploads', filename)
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
        }
      } catch (error) {
        console.error(`Error cleaning up file ${filename}:`, error)
      }
    }
  }
}

// Run cleanup every hour
setInterval(cleanupOldFiles, 3600000)

// Error handler middleware with better error messages
const errorHandler = (err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err)
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File size too large. Maximum size is 10MB.' })
    }
    return res.status(400).json({ error: 'File upload error: ' + err.message })
  }
  
  if (err.message.includes('Only PDF files are allowed')) {
    return res.status(415).json({ error: 'Only PDF files are allowed' })
  }

  res.status(500).json({ 
    error: process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred' 
      : err.message || 'Something went wrong!'
  })
}

app.post('/api/summarize', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    // Load the PDF
    const loader = new PDFLoader(req.file.path)
    const docs = await loader.load()

    if (docs.length === 0) {
      throw new Error('No content found in the PDF')
    }

    // Split the text into chunks
    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 2000,
      chunkOverlap: 200,
    })
    const splitDocs = await textSplitter.splitDocuments(docs)

    // Create a vector store
    const vectorStore = await MemoryVectorStore.fromDocuments(
      splitDocs,
      new OpenAIEmbeddings()
    )

    // Store the vector store with timestamp
    const fileId = req.file.filename
    vectorStores.set(fileId, { 
      store: vectorStore, 
      timestamp: Date.now(),
      filename: fileId
    })

    // Create a chain for question/answering
    const chain = loadQAStuffChain(model)

    // Generate a summary using RAG
    const question = 'Please provide a comprehensive summary of this document. Include the main points and key takeaways.'
    const relevantDocs = await vectorStore.similaritySearch(question, 3)
    const response = await chain.call({
      input_documents: relevantDocs,
      question,
    })

    res.json({ 
      summary: response.text,
      fileId: fileId
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/chat', async (req, res, next) => {
  try {
    const { message, fileId, chatHistory = [] } = req.body as ChatRequest

    if (!message?.trim()) {
      return res.status(400).json({ error: 'Message is required' })
    }

    if (!fileId) {
      return res.status(400).json({ error: 'FileId is required' })
    }

    const vectorStoreData = vectorStores.get(fileId)
    if (!vectorStoreData) {
      return res.status(404).json({ error: 'Document not found. Please upload it again.' })
    }

    // Update timestamp to keep the vector store alive
    vectorStores.set(fileId, { 
      ...vectorStoreData, 
      timestamp: Date.now() 
    })

    const prompt = ChatPromptTemplate.fromMessages([
      ['system', 'You are a helpful AI assistant analyzing a document. Answer questions based on the document content only. If you cannot find the answer in the context provided, say "I don\'t have enough information to answer that question based on the document content."'],
      new MessagesPlaceholder('chat_history'),
      ['human', 'Context: {context}\n\nQuestion: {question}']
    ])

    const chain = RunnableSequence.from([
      {
        question: (input) => input.question,
        chat_history: (input) => input.chat_history,
        context: async (input) => {
          try {
            const relevantDocs = await vectorStoreData.store.similaritySearch(input.question, 3)
            return relevantDocs.map(doc => doc.pageContent).join('\n')
          } catch (error) {
            console.error('Error in similarity search:', error)
            throw new Error('Failed to search document content')
          }
        }
      },
      prompt,
      model,
      new StringOutputParser()
    ])

    // Format chat history
    const formattedHistory = chatHistory.map(exchange => [
      ['human', exchange.question],
      ['assistant', exchange.answer]
    ]).flat()

    try {
      const response = await chain.invoke({
        question: message.trim(),
        chat_history: formattedHistory
      })

      res.json({ 
        response: response.trim(),
        timestamp: Date.now()
      })
    } catch (error) {
      console.error('Error in chat chain:', error)
      throw new Error('Failed to generate response')
    }
  } catch (error) {
    next(error)
  }
})

// Apply error handler
app.use(errorHandler)

// Cleanup uploads directory on startup
const uploadsDir = path.join(__dirname, 'uploads')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir)
}

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})