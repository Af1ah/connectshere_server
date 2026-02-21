# ConnectSphere - Project Summary

## 🌐 Project Overview
**ConnectSphere** is an AI-powered no-code platform that enables businesses to deploy intelligent WhatsApp chatbots with integrated customer consultation services. The platform combines artificial intelligence, document-based knowledge training, and human support escalation to create a comprehensive customer service solution.

## 🎯 Mission
To democratize business automation by providing a simple, no-code solution for creating sophisticated AI-powered WhatsApp customer service systems that can learn from business documents and seamlessly escalate to human consultants.

---

## 🛠️ Technical Architecture

### **Core Technology Stack**
- **Backend Framework**: Node.js with Express.js
- **Database**: Firebase Firestore (NoSQL document store)
- **AI Engine**: Google Gemini SDK (@google/genai)
- **WhatsApp Integration**: Baileys library (@rexxhayanasi/elaina-baileys)
- **Authentication**: Firebase Authentication
- **Frontend**: Vanilla HTML5/CSS3/JavaScript
- **File Processing**: Multi-format document parsers
- **Infrastructure**: Firebase Admin SDK for server operations

### **Key Dependencies**
```json
{
  "ai": "@google/genai ^1.30.0",
  "whatsapp": "@rexxhayanasi/elaina-baileys ^1.2.9", 
  "database": "firebase ^12.6.0, firebase-admin ^13.6.0",
  "server": "express ^5.1.0",
  "files": "mammoth ^1.11.0, pdf-parse ^2.4.5, xlsx ^0.18.5"
}
```

### **System Architecture**
```
Frontend Dashboard ↔ Express API ↔ Firebase (Auth/Data) 
                                  ↕
                            Gemini AI Engine
                                  ↕  
                            RAG Knowledge Base
                                  ↕
                        Baileys (WhatsApp Gateway)
```

---

## ⚙️ Core Features

### 🤖 **AI-Powered WhatsApp Bot**
- Intelligent message processing using Google Gemini
- Context-aware conversation handling with embedded message history
- **Pre-built responses** for common greetings (hi, hello, thanks, bye)
- Automatic presence updates and read receipts
- Interactive button messages and media support
- Smart reply detection and response triggers
- Multi-level caching (60s-5min) for reduced Firestore reads

### 📚 **RAG Knowledge Base System**
- Document upload and processing (PDF, Word, Excel, CSV, TXT)
- Vector embedding generation for semantic search
- Contextual information retrieval
- Knowledge base training from business documents
- Automated text extraction and indexing

### 📅 **Consultant Booking System**
- Dynamic time slot management
- Multi-timezone support (Asia/Kolkata default)
- Staff schedule configuration
- **Smart booking flow** - auto-extracts name from WhatsApp profile & reason from message
- Multi-step booking state management with skip logic for existing data
- Automated booking confirmations
- Customer escalation from bot to human

### 🔐 **Authentication & Security**
- Firebase Authentication integration
- User role management
- Secure API endpoints
- Environment-based credential management
- Session-based WhatsApp connections

### 📊 **Real-time Dashboard**
- WhatsApp connection status monitoring
- AI usage analytics
- Knowledge base management
- Booking overview and management
- QR code generation for WhatsApp setup

---

## 🔄 User Journey

### **Business Owner Flow**
1. **Landing Page** - Product introduction and feature overview
2. **Sign Up/Login** - Firebase authentication
3. **Dashboard Access** - Real-time operational overview
4. **WhatsApp Setup** - QR code scanning for bot connection
5. **Knowledge Training** - Upload business documents (PDF, Word, Excel)
6. **Bot Configuration** - Customize AI responses and behavior
7. **Go Live** - Bot starts handling customer inquiries automatically

### **Customer Interaction Flow**
1. **WhatsApp Message** - Customer sends inquiry to business number
2. **AI Processing** - Gemini analyzes message with business context
3. **RAG Retrieval** - System searches knowledge base for relevant information
4. **Intelligent Response** - AI generates contextual, business-specific reply
5. **Escalation** (if needed) - Complex queries routed to human consultant
6. **Booking System** - Customers can schedule consultation appointments
7. **Follow-up** - Automated booking confirmations and reminders

---

## 🏗️ Project Structure

```
connectsphere/
├── 📁 src/
│   ├── config/          # Firebase & context configuration
│   ├── controllers/     # API request handlers
│   ├── middleware/      # Authentication & validation
│   ├── routes/          # Express API routes
│   ├── services/        # Core business logic
│   └── utils/           # Helper functions & file parsers
├── 📁 frontend/         # Dashboard & landing pages
├── 📁 tests/           # Unit & integration tests
├── 📁 docs/            # Project documentation
├── 📁 scripts/         # Database migration scripts
├── 📁 assets/          # Static resources (fonts, images)
└── 📁 public/          # Public web assets
```

### **Key Services**
- `whatsappService.js` - WhatsApp bot management & message handling
- `aiService.js` - Gemini AI integration, response generation & pre-built responses
- `knowledgeService.js` - RAG knowledge base operations (5-min cache)
- `consultantService.js` - Booking system, staff management & smart booking flow
- `firebaseService.js` - Database operations, conversation management & auto-cleanup
- `embeddingService.js` - Vector embeddings for semantic search
- `bookingStateManager.js` - Multi-step booking conversation state tracking

---

## 🎯 Value Proposition

### **For Businesses**
- **No-Code Solution**: Deploy sophisticated chatbots without programming
- **Cost Effective**: Reduce customer service overhead with AI automation
- **Scalable**: Handle unlimited customer inquiries 24/7
- **Intelligent**: Context-aware responses based on business knowledge
- **Flexible**: Easy escalation to human support when needed

### **For Customers**
- **Instant Responses**: Immediate answers to common questions
- **Accurate Information**: Responses based on actual business data
- **Seamless Experience**: Natural conversation flow on familiar WhatsApp
- **Human Backup**: Option to connect with real consultants
- **Convenient Booking**: Easy appointment scheduling system

---

## 🚀 Key Innovations

1. **Document-Trained AI**: Chatbots learn from business-specific documents
2. **Semantic Knowledge Search**: RAG implementation for contextual accuracy
3. **WhatsApp-Native Integration**: Native WhatsApp Business API integration
4. **Hybrid AI-Human Support**: Seamless escalation between bot and consultants
5. **No-Code Deployment**: Business owners can set up without technical knowledge

---

## 📈 Future Roadmap

### **Phase 2 Features**
- Multi-language support
- Voice message processing
- Analytics dashboard expansion
- CRM integration capabilities
- Advanced booking workflows

### **Phase 3 Vision**
- Marketplace for business templates
- Custom AI model fine-tuning
- Multi-channel support (Telegram, SMS)
- Advanced automation workflows
- Enterprise-grade security features

---

## 📋 Technical Specifications

### **Requirements**
- Node.js ≥ 16.0.0
- Firebase project with Firestore enabled
- Google Gemini API key
- WhatsApp Business phone number

### **Environment Variables**
- `GEMINI_API_KEY` - Google AI API access
- `GOOGLE_APPLICATION_CREDENTIALS` - Firebase admin credentials
- `PORT` - Server port (default: 3000)
- `WHATSAPP_PRESENCE_UPDATES` - Enable/disable presence features

### **Performance Metrics**
- Response time: <2 seconds average
- Concurrent users: 1000+ supported
- Document processing: Up to 50MB files
- Knowledge base: Unlimited documents
- Availability: 99.9% uptime target

---

## 📝 License & Contact

**License**: ISC License  
**Author**: Af1ah  
**Repository**: https://github.com/af1ah/connectsphere  
**Website**: https://connectsphere.dev  

---

*Last Updated: February 21, 2026*

---

## 🔧 Performance Optimizations (v2.0)

### **Firestore Read Reduction**
- **Embedded Messages**: Conversations use embedded array instead of subcollections (90%+ read reduction)
- **Multi-level Caching**:
  - AI Settings: 60 second cache
  - Consultant Settings: 2 minute cache
  - RAG Knowledge: 5 minute cache
- **Pre-built Responses**: Common patterns (greetings, thanks, bye) skip AI entirely
- **Parallel Operations**: Independent Firestore reads executed concurrently

### **Data Lifecycle Management**
- **Auto-cleanup**: Conversations older than 2 days automatically deleted
- **Usage Retention**: Usage logs kept indefinitely for analytics
- **Max Messages**: 100 messages per conversation (oldest auto-trimmed)

### **Storage Model**
```
# Old Model (Expensive)
users/{userId}/conversations/{convId}/messages/{msgId}  ← N reads per conversation

# New Model (Optimized)
users/{userId}/conversations/{convId}
├── messages: [...embedded array...]                   ← 1 read per conversation
```