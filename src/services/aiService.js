const { GoogleGenAI } = require('@google/genai');
const contextData = require('../config/context');
const firebaseService = require('./firebaseService');

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

const generateResponse = async (userMessage, userId) => {
    if (!ai) {
        return "I'm currently offline. Please try again later.";
    }

    // Save user message to Firebase
    if (userId) {
        await firebaseService.saveMessage(userId, 'user', userMessage);
    }

    // Fetch dynamic settings
    const settings = await firebaseService.getAISettings(userId);
    const currentContext = settings?.context || contextData;
    const currentModel = settings?.model || modelName;

    // Append file content to context
    let fullContext = currentContext;
    if (settings?.files && settings.files.length > 0) {
        fullContext += '\n\n--- ADDITIONAL KNOWLEDGE BASE ---\n';
        settings.files.forEach(file => {
            fullContext += `\n[File: ${file.name} (${file.type})]\n${file.content}\n`;
        });
    }

    const tools = [];
    const config = {
        temperature: 0.7,
        maxOutputTokens: 150, // Reduced to force shorter responses
        mediaResolution: 'MEDIA_RESOLUTION_UNSPECIFIED',
        tools,
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
${fullContext}`,
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
        const result = await ai.models.generateContent({
            model: currentModel,
            config,
            contents,
        });

        const responseText = result.text;

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
