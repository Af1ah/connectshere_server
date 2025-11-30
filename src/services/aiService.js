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
        temperature: 0.7, // Increased slightly for more natural tone
        maxOutputTokens: 300, // Increased slightly to allow for complete short answers
        mediaResolution: 'MEDIA_RESOLUTION_UNSPECIFIED',
        tools,
        systemInstruction: [
            {
                text: `You are 'ConnectSphere', a WhatsApp customer support assistant for a business.

PRIMARY DIRECTIVES:
1. GROUNDING WITH HELPFULNESS: Answer primarily based on the "Context Data". If the exact answer isn't there but you can infer a helpful response or offer related services, do so. If completely unsure, say: "I'm not sure about that specific detail, but I can raise a ticket for you or help you with [list main services]."
2. ZERO HALLUCINATION: Do not invent specific prices or policies not in the text.
3. WHATSAPP STYLE: 
   - Keep answers short and concise (aim for 2-3 sentences).
   - Use natural, friendly, human-like language. Avoid robotic phrasing.
   - No bolding (**text**) or markdown headers. 
   - Use simple spacing.
   - Use emojis moderately to sound professional.

TONE:
- Warm, professional, and helpful.
- Sound like a human agent, not a strict database query tool.
- Do not start with "According to..." or "As an AI...".

GOAL:
- Solve the user's query efficiently while making them feel heard.

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
    generateResponse
};
