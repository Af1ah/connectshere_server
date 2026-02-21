const { GoogleGenAI } = require('@google/genai');
const contextData = require('../config/context');
const firebaseService = require('./firebaseService');
const knowledgeService = require('./knowledgeService');

let ai = null;
const modelName = 'gemini-3-flash-preview';

// ==================== PRE-BUILT RESPONSES ====================
// Common greetings that don't need AI processing - saves API calls & reads
const GREETING_PATTERNS = [
    /^(hi+|hey+|hello+|hii+|hyy+|hola|yo+)[\s!?.]*$/i,
    /^(good\s*(morning|afternoon|evening|night))[\s!?.]*$/i,
    /^(sup|wassup|whatsup|what'?s\s*up)[\s!?.]*$/i,
    /^(howdy|hiya|heya)[\s!?.]*$/i,
];

const GREETING_RESPONSES = [
    "Hey there! 👋 How can I help you today?",
    "Hi! 👋 What can I do for you?",
    "Hello! 👋 How may I assist you?",
    "Hey! 👋 What brings you here today?",
];

const THANKS_PATTERNS = [
    /^(thanks?|thank\s*you|thx|ty|tysm|thanku)[\s!?.]*$/i,
    /^(ok\s*thanks?|okay\s*thanks?)[\s!?.]*$/i,
];

const THANKS_RESPONSES = [
    "You're welcome! 😊 Let me know if you need anything else.",
    "Happy to help! 😊 Anything else I can assist with?",
    "No problem! 😊 Feel free to ask if you have more questions.",
];

const BYE_PATTERNS = [
    /^(bye+|byee*|goodbye|good\s*bye|see\s*ya|cya|later|gtg)[\s!?.]*$/i,
    /^(take\s*care|tc)[\s!?.]*$/i,
];

const BYE_RESPONSES = [
    "Goodbye! 👋 Have a great day!",
    "Take care! 👋 Feel free to reach out anytime.",
    "Bye! 👋 See you next time!",
];

// ==================== SMART CONTEXT DETECTION ====================
// Detect if message needs full context (RAG, booking) vs lightweight response
const SIMPLE_CHAT_PATTERNS = [
    /^(how are you|how r u|how're you|hru|how do you do)[\s?!.]*$/i,
    /^(what'?s up|sup|wassup|whatsup)[\s?!.]*$/i,
    /^(good|great|fine|ok|okay|cool|nice|awesome|perfect|alright)[\s!.]*$/i,
    /^(yes|no|yeah|yep|nope|nah|sure|maybe)[\s!.]*$/i,
    /^(lol|haha|hehe|😂|😊|👍|🙏|❤️|🔥)[\s!.]*$/i,
    /^(same|me too|agreed|exactly|right|true)[\s!.]*$/i,
    /^(nothing|nm|ntg|not much)[\s!.]*$/i,
    /^(i see|got it|understood|makes sense|i understand)[\s!.]*$/i,
];

const BOOKING_INTENT_PATTERNS = [
    /book|appointment|schedule|slot|consult|meet|meeting/i,
    /available.*time|when.*free|when.*available/i,
];

const KNOWLEDGE_INTENT_PATTERNS = [
    /price|cost|how much|charge|fee|rate/i,
    /service|product|offer|provide|sell/i,
    /policy|return|refund|warranty|guarantee/i,
    /how (do|can|to)|what (is|are)|tell me|explain/i,
    /support|help with|issue|problem|fix|repair/i,
    /contact|email|phone|address|location|hours/i,
];

/**
 * Analyze message to determine what context is needed
 * Returns: { needsRAG: boolean, needsBooking: boolean, historyLimit: number, isSimple: boolean }
 */
const analyzeMessageIntent = (message) => {
    const trimmed = (message || '').trim();
    
    // Simple chat - minimal context needed
    if (trimmed.length < 30 && SIMPLE_CHAT_PATTERNS.some(p => p.test(trimmed))) {
        return { needsRAG: false, needsBooking: false, historyLimit: 3, isSimple: true };
    }
    
    // Booking intent - needs booking tools but maybe not full RAG
    if (BOOKING_INTENT_PATTERNS.some(p => p.test(trimmed))) {
        return { needsRAG: false, needsBooking: true, historyLimit: 5, isSimple: false };
    }
    
    // Knowledge query - needs RAG
    if (KNOWLEDGE_INTENT_PATTERNS.some(p => p.test(trimmed))) {
        return { needsRAG: true, needsBooking: false, historyLimit: 5, isSimple: false };
    }
    
    // Default: full context for longer/complex messages
    return { needsRAG: true, needsBooking: true, historyLimit: 10, isSimple: false };
};
// ==================================================================

// REMOVED: OK_PATTERNS - too risky, "ok", "yes", "sure" are commonly used during conversations
// These should go through normal AI processing to maintain context

/**
 * Check if message matches pre-built response patterns
 * Returns response string if matched, null otherwise
 */
const getPrebuiltResponse = (message, isInBookingFlow = false) => {
    const trimmed = (message || '').trim();
    if (!trimmed || trimmed.length > 50) return null; // Skip long messages
    
    // Skip booking button IDs - these shouldn't reach AI at all
    if (/^(date_|slot_|confirm_|cancel_|option_)/.test(trimmed)) {
        return null;
    }
    
    // Don't use pre-built responses during active booking flow
    // User might say "hi" or "thanks" but mean something contextual
    if (isInBookingFlow) {
        return null;
    }
    
    // Check greetings - only for standalone greetings
    if (GREETING_PATTERNS.some(p => p.test(trimmed))) {
        return GREETING_RESPONSES[Math.floor(Math.random() * GREETING_RESPONSES.length)];
    }
    
    // Check thanks
    if (THANKS_PATTERNS.some(p => p.test(trimmed))) {
        return THANKS_RESPONSES[Math.floor(Math.random() * THANKS_RESPONSES.length)];
    }
    
    // Check bye
    if (BYE_PATTERNS.some(p => p.test(trimmed))) {
        return BYE_RESPONSES[Math.floor(Math.random() * BYE_RESPONSES.length)];
    }
    
    return null;
};
// ==============================================================

const initialize = () => {
    if (process.env.GEMINI_API_KEY) {
        ai = new GoogleGenAI({
            apiKey: process.env.GEMINI_API_KEY,
        });
    } else {
        console.warn('GEMINI_API_KEY is not set. AI features will be disabled.');
    }
};

const shouldReplyToMessage = (userMessage) => {
    // Smart detection - only reply/quote when contextually appropriate
    const replyTriggers = [
        /\?$/,  // Questions
        /^(hi|hello|hey)/i,  // Greetings
        /please/i,  // Polite requests
        /urgent|important|asap/i,  // Urgent messages
        /help|assist/i  // Help requests
    ];

    return replyTriggers.some(trigger => trigger.test(userMessage));
};

const extractTextFromModelResult = (result) => {
    const parts = result?.candidates?.[0]?.content?.parts || [];
    return parts
        .filter((part) => typeof part?.text === 'string')
        .map((part) => part.text)
        .join('')
        .trim();
};

// Simple in-memory cache for settings (TTL: 60 seconds)
const settingsCache = new Map();
const CACHE_TTL_MS = 60000;

const getCachedSettings = async (userId, fetcher, cacheKey) => {
    const fullKey = `${userId}:${cacheKey}`;
    const cached = settingsCache.get(fullKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        return cached.data;
    }
    const data = await fetcher();
    settingsCache.set(fullKey, { data, timestamp: Date.now() });
    return data;
};

const clearUserCache = (userId) => {
    for (const key of settingsCache.keys()) {
        if (key.startsWith(`${userId}:`)) {
            settingsCache.delete(key);
        }
    }
    console.log(`Cleared cache for user ${userId}`);
};

const generateResponse = async (userMessage, userId, senderPhone = 'Unknown', senderName = null, conversationId = null) => {
    const startTime = Date.now();
    const timings = {};

    // ==================== PRE-BUILT RESPONSE CHECK ====================
    // Check for common greetings/phrases BEFORE any expensive operations
    // This saves: AI API call, Firestore reads, RAG search, etc.
    const prebuiltResponse = getPrebuiltResponse(userMessage);
    if (prebuiltResponse) {
        console.log(`[AI] Pre-built response for: "${userMessage.substring(0, 20)}..." (${Date.now() - startTime}ms)`);
        
        // Save the conversation exchange (1 write instead of 2)
        if (userId) {
            firebaseService.saveConversationExchange(userId, userMessage, prebuiltResponse, conversationId)
                .catch(err => console.error('Error saving prebuilt exchange:', err));
        }
        
        return prebuiltResponse;
    }
    // ==================================================================

    if (!ai) {
        return "I'm currently offline. Please try again later.";
    }

    // ==================== SMART CONTEXT LOADING ====================
    // Analyze message to determine what context is actually needed
    const intent = analyzeMessageIntent(userMessage);
    console.log(`[AI] Intent: RAG=${intent.needsRAG}, Booking=${intent.needsBooking}, Simple=${intent.isSimple}, History=${intent.historyLimit}`);
    // ===============================================================

    // Run multiple independent operations in PARALLEL for better performance
    const parallelStart = Date.now();
    
    // Helper: timeout wrapper to prevent slow operations from blocking
    const withTimeout = (promise, ms, fallback) => 
        Promise.race([promise, new Promise(resolve => setTimeout(() => resolve(fallback), ms))]);
    
    const [settings, ragContext, consultantSettings, history] = await Promise.all([
        // 1. Get AI settings (cached)
        getCachedSettings(userId, () => firebaseService.getAISettings(userId), 'ai'),
        
        // 2. Build RAG context ONLY if needed (skip for simple chats)
        intent.needsRAG ? withTimeout(
            knowledgeService.buildContext(userId, userMessage).catch(error => {
                console.error('Error fetching RAG context:', error);
                return '';
            }),
            3000,
            ''
        ) : Promise.resolve(''),
        
        // 3. Get consultant settings ONLY if booking might be needed
        intent.needsBooking ? getCachedSettings(userId, async () => {
            try {
                const consultantService = require('./consultantService');
                return await consultantService.getSettings(userId);
            } catch (e) { return null; }
        }, 'consultant') : Promise.resolve(null),
        
        // 4. Get conversation history (limited based on intent)
        userId ? firebaseService.getConversationHistory(userId, intent.historyLimit, conversationId) : Promise.resolve([])
    ]);
    
    timings.parallel = Date.now() - parallelStart;

    // NOTE: User message will be saved together with response using saveConversationExchange

    const baseContext = settings?.context || '';
    const currentModel = settings?.model || modelName;

    // Combine base context with RAG context
    let fullContext = baseContext;
    if (ragContext) {
        fullContext += '\n\n' + ragContext;
    }

    // Check if consultant booking is enabled and add instructions
    let consultantInstructions = '';
    if (consultantSettings?.enabled) {
        consultantInstructions = `

CONSULTANT BOOKING (ONLY WHEN USER EXPLICITLY ASKS):
You can help users book consultations ONLY when they EXPLICITLY request it.

TRIGGER BOOKING ONLY IF USER SAYS:
- "I want to book" / "book appointment"
- "schedule a consultation"
- "I need an appointment"

DO NOT trigger booking for:
- General questions or greetings
- Product inquiries
- "I don't want to book" or similar rejections
- When user hasn't asked for booking

WHEN USER WANTS TO BOOK:
1. If reason is already clear from context, skip asking for reason
2. Respond with: "[BOOKING:dates]" at the end

EXAMPLE:
User: "I want to book for PC advice"
→ "Sure! Let me show available slots. [BOOKING:dates]"

User: "Hi, tell me about your services"
→ Just answer their question. DO NOT offer booking.
`;
    }

    // Define function declarations for consultant booking
    const bookingTools = [];
    let consultantServiceRef = null;

    try {
        consultantServiceRef = require('./consultantService');
        // Use already-fetched consultantSettings from parallel call
        if (consultantSettings?.enabled) {
            bookingTools.push({
                functionDeclarations: [
                    {
                        name: 'get_available_slots',
                        description: 'Get available time slots for a specific date. Call this when user wants to see available times for booking.',
                        parameters: {
                            type: 'object',
                            properties: {
                                date: {
                                    type: 'string',
                                    description: 'Date in YYYY-MM-DD format (e.g., 2026-01-27)'
                                }
                            },
                            required: ['date']
                        }
                    },
                    {
                        name: 'create_booking',
                        description: 'Create a consultation booking. Call this when user confirms they want to book a specific time slot.',
                        parameters: {
                            type: 'object',
                            properties: {
                                date: {
                                    type: 'string',
                                    description: 'Date in YYYY-MM-DD format'
                                },
                                timeSlot: {
                                    type: 'string',
                                    description: 'Time slot in HH:MM format (e.g., 14:00)'
                                },
                                name: {
                                    type: 'string',
                                    description: 'Customer name for booking'
                                },
                                reason: {
                                    type: 'string',
                                    description: 'Reason for consultation'
                                }
                            },
                            required: ['date', 'timeSlot', 'name', 'reason']
                        }
                    },
                    {
                        name: 'get_next_available_dates',
                        description: 'Get the next available dates for booking consultations',
                        parameters: {
                            type: 'object',
                            properties: {
                                count: {
                                    type: 'number',
                                    description: 'Number of dates to return (default 5)'
                                }
                            }
                        }
                    }
                ]
            });
        }
    } catch (error) {
        console.error('Error setting up booking tools:', error);
    }

    // ==================== DYNAMIC SYSTEM PROMPT ====================
    // Use lightweight prompt for simple chats to save tokens
    let systemPrompt;
    
    if (intent.isSimple) {
        // ~100 tokens vs ~500 tokens for full prompt
        systemPrompt = `You are a friendly WhatsApp business assistant.
Keep responses SHORT (1-2 sentences max). Be warm and conversational.
Context: ${baseContext.substring(0, 200)}`;
    } else {
        // Full prompt for complex queries
        systemPrompt = `You are 'ConnectSphere', a 2026-grade WhatsApp business assistant.

CRITICAL: Keep ALL responses SHORT (2-3 sentences max). One topic per message.

RULES:
1. KNOWLEDGE FIRST: Use RAG knowledge as truth. Don't invent prices/policies.
2. WHATSAPP STYLE: Short sentences, friendly tone, *bold* for emphasis.
3. ONE STEP AT A TIME: Give one step, ask "Done?", then continue.

${fullContext ? `\nKNOWLEDGE:\n${fullContext}` : ''}
${consultantInstructions}`;
    }
    // ===============================================================

    const config = {
        temperature: 0.7,
        maxOutputTokens: 400, // Fixed: 150 was cutting off responses mid-sentence
        mediaResolution: 'MEDIA_RESOLUTION_UNSPECIFIED',
        tools: intent.needsBooking ? bookingTools : [],
        systemInstruction: [{ text: systemPrompt }],
    };

    // history already fetched in parallel block above

    const contents = [
        ...history,
        {
            role: 'user',
            parts: [
                {
                    text: userMessage,
                },
            ],
        },
    ];

    // AI generation timing
    const genStart = Date.now();
    try {
        let result = await ai.models.generateContent({
            model: currentModel,
            config,
            contents,
        });

        // Handle function calls
        let responseText = extractTextFromModelResult(result);

        // Check if there's a function call
        if (result.candidates?.[0]?.content?.parts) {
            for (const part of result.candidates[0].content.parts) {
                if (part.functionCall) {
                    const functionName = part.functionCall.name;
                    const args = part.functionCall.args || {};

                    console.log(`Function call: ${functionName}`, args);

                    let functionResult = {};

                    try {
                        if (functionName === 'get_available_slots' && consultantServiceRef) {
                            functionResult = await consultantServiceRef.getAvailableSlots(userId, args.date);
                        } else if (functionName === 'create_booking' && consultantServiceRef) {
                            if (!args.name || !args.reason) {
                                functionResult = {
                                    success: false,
                                    missingFields: [
                                        ...(!args.name ? ['name'] : []),
                                        ...(!args.reason ? ['reason'] : [])
                                    ],
                                    message: 'Missing required booking details'
                                };
                            } else {
                            // Use the sender's phone number from WhatsApp
                            functionResult = await consultantServiceRef.createBooking(userId, {
                                phone: senderPhone,
                                name: args.name || senderName || 'WhatsApp Customer',
                                reason: args.reason,
                                date: args.date,
                                timeSlot: args.timeSlot
                            });
                            }
                        } else if (functionName === 'get_next_available_dates' && consultantServiceRef) {
                            functionResult = await consultantServiceRef.getNextAvailableDates(userId, args.count || 5);
                        }
                    } catch (err) {
                        console.error('Function execution error:', err);
                        functionResult = { error: 'Failed to execute booking action' };
                    }

                    // Send function result back to model for final response
                    const functionResponseContents = [
                        ...contents,
                        {
                            role: 'model',
                            parts: [part]
                        },
                        {
                            role: 'function',
                            parts: [{
                                functionResponse: {
                                    name: functionName,
                                    response: { result: functionResult }
                                }
                            }]
                        }
                    ];

                    const followUpResult = await ai.models.generateContent({
                        model: currentModel,
                        config: { ...config, tools: [] }, // Remove tools for follow-up to get text response
                        contents: functionResponseContents,
                    });

                    responseText = extractTextFromModelResult(followUpResult);
                    result = followUpResult;
                }
            }
        }

        // Ensure responseText is never undefined or null
        if (!responseText) {
            responseText = "I processed your request. Is there anything else I can help with?";
        }

        // Calculate or estimate token usage
        let inputTokens = 0;
        let outputTokens = 0;

        if (result.usageMetadata) {
            inputTokens = result.usageMetadata.promptTokenCount || 0;
            outputTokens = result.usageMetadata.candidatesTokenCount || 0;
        } else {
            // Fallback estimation: ~4 chars per token
            try {
                const inputText = contents.reduce((acc, curr) => {
                    if (curr.parts && curr.parts[0] && curr.parts[0].text) {
                        return acc + curr.parts[0].text;
                    }
                    return acc;
                }, '');
                inputTokens = Math.ceil(inputText.length / 4);
                outputTokens = Math.ceil((responseText || '').length / 4);
            } catch (e) {
                console.error('Error calculating tokens:', e);
                inputTokens = 0;
                outputTokens = 0;
            }
        }

        // Ensure they are numbers
        inputTokens = Number.isFinite(inputTokens) ? inputTokens : 0;
        outputTokens = Number.isFinite(outputTokens) ? outputTokens : 0;

        timings.generation = Date.now() - genStart;
        timings.total = Date.now() - startTime;

        // Log performance timings for debugging slow responses
        console.log(`[Perf] User ${userId}: parallel=${timings.parallel}ms, gen=${timings.generation}ms, total=${timings.total}ms`);

        // Save conversation exchange to Firebase (fire and forget - don't block)
        // NEW: Single write for both user message + AI response
        if (userId && responseText) {
            Promise.all([
                firebaseService.saveConversationExchange(userId, userMessage, responseText, conversationId),
                firebaseService.logTokenUsage(userId, inputTokens, outputTokens)
            ]).catch(err => console.error('Error saving conversation/tokens:', err));
        }

        return responseText;
    } catch (error) {
        console.error('Error generating AI response:', error?.message || error);
        if (error?.status) console.error('API Status:', error.status);
        if (error?.code) console.error('Error code:', error.code);
        return "I'm having trouble processing your request right now.";
    }
};

module.exports = {
    initialize,
    generateResponse,
    shouldReplyToMessage,
    clearUserCache,
    getPrebuiltResponse
};
