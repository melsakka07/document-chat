import express from 'express'
import multer from 'multer'
import { OpenAI } from '@langchain/openai'
import { PDFLoader } from 'langchain/document_loaders/fs/pdf'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'
import { OpenAIEmbeddings } from '@langchain/openai'
import { loadQAStuffChain, ConversationalRetrievalQAChain } from 'langchain/chains'
import * as dotenv from 'dotenv'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

dotenv.config()

// Type definitions
interface ChatRequest {
  message: string
  fileId: string
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: 'uploads/',
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, file.fieldname + '-' + uniqueSuffix + '.pdf')
  }
})

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true)
    } else {
      cb(null, false)
      return cb(new Error('Only PDF files are allowed'))
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
})

const app = express()
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Store vector stores in memory with automatic cleanup after 1 hour
const vectorStores = new Map<string, { 
  store: MemoryVectorStore, 
  timestamp: number 
}>()

// Cleanup old vector stores every hour
setInterval(() => {
  const oneHourAgo = Date.now() - 3600000
  for (const [fileId, { timestamp }] of vectorStores.entries()) {
    if (timestamp < oneHourAgo) {
      vectorStores.delete(fileId)
      // Clean up the uploaded file
      try {
        fs.unlinkSync(path.join(__dirname, 'uploads', fileId))
      } catch (error) {
        console.error('Error cleaning up file:', error)
      }
    }
  }
}, 3600000)

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'dist')))

const model = new OpenAI({
  modelName: 'gpt-3.5-turbo',
  temperature: 0.7,
  openAIApiKey: process.env.OPENAI_API_KEY,
})

// Error handler middleware
const errorHandler = (err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack)
  res.status(500).json({ error: err.message || 'Something went wrong!' })
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
      timestamp: Date.now() 
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
    const { message, fileId } = req.body as ChatRequest

    if (!message?.trim() || !fileId) {
      return res.status(400).json({ error: 'Message and fileId are required' })
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

    // Create a conversational chain
    const chain = ConversationalRetrievalQAChain.fromLLM(
      model,
      vectorStoreData.store.asRetriever(),
      {
        returnSourceDocuments: true,
        questionGeneratorTemplate: `Given the following conversation and a follow up question, rephrase the follow up question to be a standalone question that captures all relevant context from the conversation.

        Chat History:
        {chat_history}
        
        Follow Up Input: {question}
        
        Standalone question:`,
      }
    )

    // Get the response
    const response = await chain.call({
      question: message,
      chat_history: [], // You could store and pass chat history if needed
    })

    res.json({ 
      response: response.text,
      sources: response.sourceDocuments
    })
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