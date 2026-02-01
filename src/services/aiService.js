const { GoogleGenAI } = require('@google/genai');
const contextData = require('../config/context');
const firebaseService = require('./firebaseService');
const knowledgeService = require('./knowledgeService');

let ai = null;
const modelName = 'gemini-2.0-flash';

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

const generateResponse = async (userMessage, userId, senderPhone = 'Unknown') => {
    if (!ai) {
        return "I'm currently offline. Please try again later.";
    }

    // Save user message to Firebase
    if (userId) {
        await firebaseService.saveMessage(userId, 'user', userMessage);
    }

    // Fetch dynamic settings
    const settings = await firebaseService.getAISettings(userId);
    const baseContext = settings?.context || '';
    const currentModel = settings?.model || modelName;

    // Use RAG to get relevant context based on user message
    let ragContext = '';
    try {
        ragContext = await knowledgeService.buildContext(userId, userMessage);
    } catch (error) {
        console.error('Error fetching RAG context:', error);
    }

    // Combine base context with RAG context
    let fullContext = baseContext;
    if (ragContext) {
        fullContext += '\n\n' + ragContext;
    }

    // Check if consultant booking is enabled and add instructions
    let consultantInstructions = '';
    try {
        const consultantService = require('./consultantService');
        const consultantSettings = await consultantService.getSettings(userId);

        if (consultantSettings?.enabled) {
            consultantInstructions = `

CONSULTANT BOOKING CAPABILITY:
You can help users book consultations. When a user asks about:
- booking an appointment/consultation
- scheduling a meeting with consultant/expert/doctor
- checking availability for consultations
- wanting advice or professional consultation

BOOKING FLOW (USE INTERACTIVE BUTTONS):
1. First understand their need briefly (1 question max)
2. Once ready to book, respond with EXACTLY this format:
   "Great! Let me show you available dates. [BOOKING:dates]"
   
The [BOOKING:dates] tag will trigger interactive WhatsApp buttons for:
- Date selection (buttons)
- Time slot selection (buttons)  
- Confirmation (buttons)

CRITICAL RULES:
- When user wants to book, include [BOOKING:dates] at the end of your response
- Do NOT list dates manually - the buttons will handle this
- Keep pre-booking chat SHORT (1-2 messages max)
- If user says "book", "appointment", "schedule" etc - trigger booking quickly
- Timezone: Asia/Kolkata (IST)

EXAMPLE RESPONSES:
✅ "Sure! What would you like to consult about?"
✅ "Got it! Let me show you available slots. [BOOKING:dates]"
❌ "Here are the dates: 1. Monday, 2. Tuesday..." (DON'T DO THIS)
`;
        }
    } catch (error) {
        console.error('Error loading consultant settings:', error);
    }

    // Define function declarations for consultant booking
    const bookingTools = [];
    let consultantServiceRef = null;

    try {
        consultantServiceRef = require('./consultantService');
        const consultantSettings = await consultantServiceRef.getSettings(userId);

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
                                reason: {
                                    type: 'string',
                                    description: 'Reason for consultation'
                                }
                            },
                            required: ['date', 'timeSlot']
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

    const config = {
        temperature: 0.7,
        maxOutputTokens: 500,
        mediaResolution: 'MEDIA_RESOLUTION_UNSPECIFIED',
        tools: bookingTools,
        systemInstruction: [
            {
                text: `You are 'ConnectSphere', a WhatsApp customer support assistant for a business.

CRITICAL RULE: Keep ALL responses EXTREMELY SHORT (maximum 200 characters or 2-3 short sentences). One topic per message only!

PRIMARY DIRECTIVES:
1. GROUNDING WITH HELPFULNESS: Answer primarily based on the "Context Data". If the exact answer isn't there but you can infer a helpful response or offer related services, do so. If completely unsure, say: "I'm not sure about that specific detail, but I can help you with [one service]."
2. ZERO HALLUCINATION: Do not invent specific prices or policies not in the text.
3. WHATSAPP STYLE: 
   - MAXIMUM 2-3 SHORT SENTENCES per reply.
   - ONE topic or question at a time. Never combine multiple topics.
   - Use a step-by-step Q&A approach: Give ONE step, ask if done, then continue.
   - Use natural, friendly, human-like language.
   - Use WhatsApp's native formatting when needed:
     * *bold text* for emphasis
     * _italic text_ for slight emphasis
   - For lists, keep them SHORT (max 3 items):
     Example: "We offer:\n- Service A\n- Service B\n- Service C"
   - Never write long paragraphs.

CONVERSATION STYLE:
- Think of it like quick text messages, not emails.
- One question/answer at a time.
- Examples of GOOD responses:
  * "Got it! What's your email?"
  * "Sure! First, *restart your device*. Done?"
  * "Thanks! I'll create a ticket for you. Anything else?"
  * "We have 3 plans:\n- Basic\n- Pro\n- Enterprise\n\nWhich interests you?"

Examples of BAD responses (TOO LONG):
  * "Thank you for reaching out. I can help you with that. First, you'll need to restart your device, then check the settings, and..."
  * "We offer several services including..."

CRITICAL RULES:
- If question needs multiple steps: Give ONLY first step, ask "Done?", wait for reply
- If listing options: Maximum 3-4 items, then ask which they want
- If explaining: One sentence explanation, then ask "Need more details?"
- NEVER explain everything at once
- NEVER write more than 3 sentences

TONE:
- Warm, professional, helpful
- Like texting a friend
- Do not start with "According to..." or "As an AI..."

GOAL:
- Solve queries through SHORT back-and-forth conversation
- One step at a time, confirm, then continue

CONTEXT DATA:
${fullContext}
${consultantInstructions}`,
            }
        ],
    };

    let history = [];
    if (userId) {
        history = await firebaseService.getConversationHistory(userId);
    }

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

    try {
        let result = await ai.models.generateContent({
            model: currentModel,
            config,
            contents,
        });

        // Handle function calls
        let responseText = result.text;

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
                            // Use the sender's phone number from WhatsApp
                            functionResult = await consultantServiceRef.createBooking(userId, {
                                phone: senderPhone,
                                name: 'WhatsApp Customer',
                                reason: args.reason || 'Via WhatsApp',
                                date: args.date,
                                timeSlot: args.timeSlot
                            });
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
                            parts: [{ functionCall: part.functionCall }]
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

                    responseText = followUpResult.text;
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

        // Save AI response to Firebase
        if (userId && responseText) {
            await firebaseService.saveMessage(userId, 'model', responseText);
            // Log token usage
            await firebaseService.logTokenUsage(userId, inputTokens, outputTokens);
        }

        return responseText;
    } catch (error) {
        console.error('Error generating AI response:', error);
        return "I'm having trouble processing your request right now.";
    }
};

module.exports = {
    initialize,
    generateResponse,
    shouldReplyToMessage
};
// add a option in friend end and logic for check the bussiness porpos selection advanced features section.

// product selling.

// appoiment ticketing. for doctores 

// ticket rising for problems.

// add bot if toggiled anytrhing add ai instructions.

// also add option and interface to confim each even if it purchase(confirmed or rejection with reasons.), confirm cunsultancy , or rejection.

// if 