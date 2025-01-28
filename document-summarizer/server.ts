import express from 'express'
import multer from 'multer'
import { OpenAI } from '@langchain/openai'
import { PDFLoader } from 'langchain/document_loaders/fs/pdf'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { MemoryVectorStore } from 'langchain/vectorstores/memory'
import { OpenAIEmbeddings } from 'langchain/embeddings/openai'
import { loadQAStuffChain } from 'langchain/chains'
import * as dotenv from 'dotenv'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'

dotenv.config()

const app = express()
const upload = multer({ dest: 'uploads/' })
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

app.use(cors())
app.use(express.json())
app.use(express.static(path.join(__dirname, 'dist')))

const model = new OpenAI({
  modelName: 'gpt-3.5-turbo',
  temperature: 0.7,
  openAIApiKey: process.env.OPENAI_API_KEY,
})

app.post('/api/summarize', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    // Load the PDF
    const loader = new PDFLoader(req.file.path)
    const docs = await loader.load()

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

    // Create a chain for question/answering
    const chain = loadQAStuffChain(model)

    // Generate a summary using RAG
    const question = 'Please provide a comprehensive summary of this document. Include the main points and key takeaways.'
    const relevantDocs = await vectorStore.similaritySearch(question, 3)
    const response = await chain.call({
      input_documents: relevantDocs,
      question,
    })

    res.json({ summary: response.text })
  } catch (error) {
    console.error('Error processing document:', error)
    res.status(500).json({ error: 'Error processing document' })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
}) 