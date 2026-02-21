const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore } = require('@kelvdra/baileys')
const pino = require('pino')

const logger = pino({ level: 'silent' })

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')

    const sock = makeWASocket({
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        logger,
        browser: ['ConnectSphere', 'Chrome', '125.0.0'],
        markOnlineOnConnect: false, // VPS-friendly
        syncFullHistory: false,     // Save memory
        printQRInTerminal: true
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut
            console.log('connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect)
            if (shouldReconnect) {
                connectToWhatsApp()
            }
        } else if (connection === 'open') {
            console.log('opened connection')
        }
    })

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0]
        if (!msg.key.fromMe && m.type === 'notify') {
            const messageContent = msg.message?.conversation || msg.message?.extendedTextMessage?.text
            if (messageContent && messageContent.toLowerCase() === 'hi') {
                // Fire-and-forget read receipt
                sock.readMessages([msg.key]).catch(() => {})
                await sock.sendMessage(msg.key.remoteJid, { text: 'hello' })
            }
        }
    })
}

connectToWhatsApp()
